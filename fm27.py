"""FM27 live player reader. Read-only: finds every db::ACTUAL_PLAYER in fm.exe memory.

All offsets live in layout.json (reverse-engineered 2026-11-08). When game_plugin.dll changes
(a game patch), calibrate.py re-discovers them; scan() does that automatically.
"""
import datetime
import json
import os
import struct

import numpy as np

from mem import Proc

HERE = os.path.dirname(os.path.abspath(__file__))
LAYOUT = os.path.join(HERE, 'layout.json')
DLL_NAME = 'game_plugin.dll'
OBJ_SIZE = 1024  # db::ACTUAL_PLAYER is ~968 bytes

POSITIONS = 'GK SW DL DC DR DM ML MC MR AML AMC AMR ST WBL WBR'.split()
# ponytail: personality order inferred from correlations (Spo/Tem move together, Con opposes them,
# Amb opposes Loy). Order unconfirmed -- verify against an in-game personality description.
PERSONALITY = ['Adaptability', 'Ambition', 'Loyalty', 'Pressure', 'Professionalism', 'Sportsmanship', 'Temperament', 'Controversy']


def load_layout():
    with open(LAYOUT) as f:
        return json.load(f)


def save_layout(L):
    with open(LAYOUT, 'w') as f:
        json.dump(L, f, indent=1)


def build_id(path):
    st = os.stat(path)
    return f'{st.st_size}:{int(st.st_mtime)}'


def find_objects(p, vt):
    return p.find_u64([vt])[vt]


class GameLoading(RuntimeError):
    """FM is still building/loading the save: objects exist but aren't filled in yet. Retry shortly."""


class Reader:
    """Pointer/string reads with caching for shared objects (clubs, nations)."""

    def __init__(self, p, L):
        self.p, self.L, self.cache = p, L, {}

    def ptr(self, a):
        v = self.p.u64(a) if a else None
        return v if v and 0x10000 < v < 0x7fffffffffff else None

    def lpstr(self, a):
        b = self.p.read(a, 132) if a else b''
        if len(b) < 4:
            return ''
        n = struct.unpack_from('<I', b)[0]
        return b[4:4 + n].decode('utf-8', 'replace') if 0 < n <= 128 else ''

    def name2(self, a):  # pointer -> name record -> len-prefixed string
        return self.lpstr(self.ptr(a)) if a else ''

    def club(self, team):
        if not team:
            return None
        if team not in self.cache:
            c, n = self.L['club'], self.L['nation']
            club = self.ptr(team + self.L['team']['CLUB'])
            cn = self.ptr(club + c['NATION']) if club else None
            self.cache[team] = (self.lpstr(self.ptr(club + c['NAME'])), self.lpstr(self.ptr(club + c['SHORT'])),
                                self.lpstr(self.ptr(cn + n['NAME'])) if cn else '', club) if club else None
        return self.cache[team]

    def nation(self, a):
        if not a:
            return ('', '')
        if a not in self.cache:
            n = self.L['nation']
            self.cache[a] = (self.lpstr(self.ptr(a + n['NAME'])), self.lpstr(self.ptr(a + n['CODE'])))
        return self.cache[a]


def unset(v):
    return None if v >= 0xFFFFFF00 else v


def date_of(doy, year):
    try:
        return (datetime.date(year, 1, 1) + datetime.timedelta(doy - 1)).isoformat()
    except (ValueError, OverflowError):
        return None


def today(blobs, L):
    """Current game date (doy, year) = latest per-player update stamp. The game touches players every few
    days, so this can trail the real in-game date slightly. ponytail: a true global date would be exact."""
    o = L['player']['STAMP']
    st = [struct.unpack_from('<HH', b, o) for b in blobs]
    valid = [(d & 0x1FF, y) for d, y in st if 1 <= (d & 0x1FF) <= 366 and 1900 < y < 2300]
    if not valid:
        raise GameLoading('no valid date stamps yet')
    # latest year that a real share of players carry (a new game mixes 2024-2026 stamps from the database)
    counts = {}
    for _, y in valid:
        counts[y] = counts.get(y, 0) + 1
    year = max(y for y, c in counts.items() if c >= 0.05 * len(valid))
    return max(d for d, y in valid if y == year), year


def quick_date(p, objs, L, base):
    """Cheap status check from a sample of known player objects: (iso date or None, fraction still valid)."""
    vt = base + L['vtables']['ACTUAL_PLAYER']
    blobs = [b for o in objs for b in [p.read(o, OBJ_SIZE)] if len(b) == OBJ_SIZE and struct.unpack_from('<Q', b)[0] == vt]
    if not blobs:
        return None, 0.0
    try:
        return date_of(*today(blobs, L)), len(blobs) / len(objs)
    except GameLoading:
        return None, len(blobs) / len(objs)

def read_loans(p, objs, L):
    """{player obj: [(loan team ptr, end date iso)]} from db::LOAN_CONTRACT (includes past loans)."""
    lo = L['loan']
    out = {}
    for a in objs:
        b = p.read(a, 96)
        if len(b) < 96:
            continue
        pl = struct.unpack_from('<Q', b, lo['PLAYER'])[0] - lo['PLAYER_ADJ']
        team = struct.unpack_from('<Q', b, lo['TEAM'])[0]
        d, y = struct.unpack_from('<HH', b, lo['END'])
        out.setdefault(pl, []).append((team, date_of(d & 0x1FF, y)))  # low 9 bits = day of year
    return out


def read_managers(p, r, objs, L, base):
    """Human managers' clubs: [{id, name}] via HUMAN_NON_PLAYER -> FULL_CONTRACT -> TEAM -> CLUB."""
    h = L['human']
    out = []
    for a in objs:
        c = r.ptr(a - h['VT_OFFSET'] + h['CONTRACT'])
        if not c or p.u64(c) != base + L['vtables']['FULL_CONTRACT']:
            continue
        team = r.ptr(c + L['contract']['TEAM'])
        club = r.club(team)
        if club and club[3] not in [m['id'] for m in out]:
            out.append({'id': club[3], 'name': club[0], 'teamId': team})
    return out


def parse(r, obj, b, now, L, loans):
    """b = OBJ_SIZE bytes at obj, now = (doy, year). Returns dict or None for junk/freed objects."""
    P, D, C = L['player'], L['pd'], L['contract']
    u16 = lambda o: struct.unpack_from('<H', b, o)[0]
    q = lambda o: struct.unpack_from('<Q', b, o)[0]
    bd, by = u16(P['DOB']), u16(P['DOB'] + 2)
    nd, ny = now
    if not (1940 <= by <= ny and 1 <= bd <= 366):
        return None
    last = r.name2(q(P['LAST']))
    if not last:
        return None
    first = r.name2(q(P['FIRST']))
    pd = P['PD']
    att = b[pd + D['ATT']: pd + D['ATT'] + 54]
    pos = list(b[pd + D['POS']: pd + D['POS'] + 15])
    c = r.ptr(obj + P['CONTRACT'])
    cb = r.p.read(c, 128) if c else b''
    wage = exp = exp_date = parent_team = release = None
    if len(cb) == 128:
        beg, end = struct.unpack_from('<QQ', cb, C['CLAUSES'])
        if 0 < end - beg <= 400 and (end - beg) % 8 == 0:
            cl = r.p.read(beg, end - beg)
            for i in range(0, len(cl), 8):
                amt, meta = struct.unpack_from('<II', cl, i)
                if (meta >> 16) & 0xFF == C['RELEASE_TYPE'] and amt != 0xFFFFFFFF:
                    release = amt
        wage = struct.unpack_from('<I', cb, C['WAGE'])[0]
        ed, ey = struct.unpack_from('<HH', cb, C['EXPIRY'])
        parent_team = struct.unpack_from('<Q', cb, C['TEAM'])[0]
        if ey >= 1950 and wage < 50_000_000:
            exp, exp_date = ey, date_of(ed, ey)
        else:
            wage = None
    team = q(P['TEAM'])
    club = r.club(team)
    parent = r.club(parent_team) if parent_team and parent_team != team else None
    if parent and club and parent[3] == club[3]:
        parent = None  # same club, different squad (reserves/U21), not a loan
    loan_end = next((d for t, d in loans.get(obj, []) if t == team), None) if parent else None
    nation, code = r.nation(q(P['NATION']))
    pers = b[P['PERSONALITY']: P['PERSONALITY'] + 8]
    return {
        'id': obj,
        'name': f'{first} {last}'.strip(),
        'first': first, 'last': last,
        'age': ny - by - (nd < bd),
        'dob': date_of(bd, by),
        'height': b[P['HEIGHT']],
        'nation': nation, 'nationCode': code,
        'club': club[0] if club else '', 'clubShort': club[1] if club else '', 'clubNation': club[2] if club else '',
        'clubId': club[3] if club else None, 'teamId': team or None,
        # on loan: contract belongs to another club than the one he plays for
        # parentClub without a loan = registered at an affiliate / B team of the contract club
        'parentClub': parent[0] if parent else None, 'parentClubId': parent[3] if parent else None,
        'onLoan': loan_end is not None, 'loanEnds': loan_end,
        'value': unset(struct.unpack_from('<I', b, P['VALUE'])[0]),  # FM transfer value
        'askingPrice': unset(struct.unpack_from('<I', b, P['ASKING'])[0]),  # only when transfer listed
        'lastFee': unset(struct.unpack_from('<I', b, P['LAST_FEE'])[0]) or None,
        'releaseClause': release,  # minimum fee release clause (Aramburu: 42,951,596 shows as £43m)
        'wage': wage, 'expires': exp, 'expiresDate': exp_date,
        'ca': u16(pd + D['CA']), 'pa': u16(pd + D['PA']),
        'pr': pos,
        'a': [att[int(s)] for s in L['_slot_order']],
        'per': list(pers),
        '_team': q(P['TEAM']),
        'female': bool(b[P['GENDER']] >> P['GENDER_BIT'] & 1),  # FM's gender flag
    }


def _finish(players):
    for pl in players:
        pl.pop('_team')
    return players


def ensure_layout(p, log=print):
    """Load layout.json; if the game DLL changed, recalibrate. Returns (layout, recalibrated?)."""
    base, path = p.module(DLL_NAME)
    L = load_layout()
    bid = build_id(path)
    if L.get('build') == bid:
        return L, False
    log(f'game_plugin.dll changed ({L.get("build")} -> {bid}); recalibrating...')
    import calibrate
    L = calibrate.run(p, L, log=log)
    L['build'] = bid
    save_layout(L)
    return L, True


def scan(pid=None, log=print):
    """Returns dict: players, date (iso), build, recalibrated, issues."""
    p = Proc(pid)
    L, recal = ensure_layout(p, log)
    L['_slot_order'] = sorted(L['slots'], key=int)
    base = p.module_base(DLL_NAME)
    r = Reader(p, L)
    V = L['vtables']
    vp, vl, vh = base + V['ACTUAL_PLAYER'], base + V.get('LOAN_CONTRACT', 1), base + V.get('HUMAN_NON_PLAYER_2', 1)
    found = p.find_u64([vp, vl, vh])  # one pass over memory for all three
    raw = [(o, b) for o in found[vp] for b in [p.read(o, OBJ_SIZE)] if len(b) == OBJ_SIZE]
    if not raw:
        raise GameLoading('No players in memory yet -- is a save loaded?')
    now = today([b for _, b in raw], L)
    extra_issues = []
    try:
        loans = read_loans(p, found[vl], L)
        managers = read_managers(p, r, found[vh], L, base)
    except Exception as e:  # ponytail: optional data; a patch that moves these shouldn't break scouting
        loans, managers = {}, []
        extra_issues.append(f'loans/my club unavailable: {e}')
    if not managers:
        extra_issues.append('could not detect your club -- pick it on the My Club page')
    players, seen = [], set()
    for obj, b in raw:
        pl = parse(r, obj, b, now, L, loans)
        if pl:
            k = (pl['name'], pl['dob'], pl['height'])
            if k not in seen:  # ponytail: freed copies can linger; first-found wins
                seen.add(k)
                players.append(pl)
    if len(players) < 1000:
        raise GameLoading(f'only {len(players)} players readable so far')
    players = _finish(players)
    return {
        'players': players,
        'sample': [pl['id'] for pl in players[::max(1, len(players) // 300)]],  # for cheap status polls
        'attrKeys': [L['slots'][s] for s in L['_slot_order']],
        'personalityKeys': PERSONALITY,
        'positions': POSITIONS,
        'date': date_of(*now),
        'build': L['build'],
        'recalibrated': recal,
        'myClubs': managers,
        'warnings': extra_issues,  # non-fatal: shown softly in the UI
        'issues': validate(players, L),
    }


def validate(players, L):
    """Sanity checks that catch a wrong layout. Empty list = healthy."""
    issues = []
    n = len(players)
    if n < 1000:
        return [f'only {n} players found']
    keys = [L['slots'][s] for s in sorted(L['slots'], key=int)]
    A = np.array([p['a'] for p in players], float)
    pct = lambda cond: 100 * sum(1 for p in players if cond(p)) / n
    checks = [
        (pct(lambda p: 15 <= p['age'] <= 45), 95, 'ages 15-45'),
        (pct(lambda p: p['ca'] <= p['pa'] <= 200), 97, 'CA <= PA <= 200'),
        (pct(lambda p: max(p['pr']) == 20), 95, 'has a natural position'),
        (pct(lambda p: 140 <= p['height'] <= 215), 98, 'height 140-215cm'),
        (pct(lambda p: p['nation']), 98, 'has a nationality'),
        (pct(lambda p: p['club']), 80, 'has a club'),
    ]
    for got, need, what in checks:
        if got < need:
            issues.append(f'{what}: {got:.0f}% (expected >= {need}%)')
    gk = np.array([p['pr'][0] == 20 for p in players])
    if 'Ref' in keys and gk.any():
        ref = A[:, keys.index('Ref')]
        if ref[gk].mean() < ref[~gk].mean() + 25:
            issues.append('goalkeeper attributes look misaligned')
    if 'Fin' in keys:
        st = np.array([p['pr'][POSITIONS.index('ST')] == 20 for p in players])
        dc = np.array([p['pr'][POSITIONS.index('DC')] == 20 for p in players])
        fin, tck = A[:, keys.index('Fin')], A[:, keys.index('Tck')]
        if not (fin[st].mean() > fin[dc].mean() + 15 and tck[dc].mean() > tck[st].mean() + 15):
            issues.append('outfield attributes look misaligned')
    return issues


if __name__ == '__main__':
    import sys
    import time
    t = time.time()
    res = scan(log=lambda m: print(m, file=sys.stderr))
    print(len(res['players']), 'players in', round(time.time() - t, 1), 's', res['date'], res['issues'], file=sys.stderr)
    with open(sys.argv[1] if len(sys.argv) > 1 else 'players.json', 'w') as f:
        json.dump(res, f)
