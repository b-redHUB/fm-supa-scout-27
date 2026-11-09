"""Re-discover the FM27 memory layout after a game patch.

Every field has a statistical signature (e.g. "u16 in 1940..2100 with spread" = birth year).
Among offsets matching a signature we take the one nearest the old offset, so an unchanged
layout reproduces itself exactly. Attribute names follow FM's fixed internal order and are
never re-learned; fm27.validate() checks they still line up.

    python calibrate.py              # re-discover against running game, print diff, save
    python calibrate.py --check      # re-discover, print diff, don't save (self-test)
"""
import sys

import numpy as np

import fm27
from mem import Proc

CLASSES = ['ACTUAL_PLAYER', 'PLAYING_DATA', 'TEAM', 'NATION', 'FULL_CONTRACT', 'CLUB']
SAMPLE = 400  # objects used for pointer-chasing checks


def find_vtables(dll_path, log):
    from rtti import PE, vtables
    log('reading RTTI from game_plugin.dll (~1 min)...')
    out = {}
    for n, v, off in vtables(PE(dll_path), '^(' + '|'.join(CLASSES) + ')@db$'):
        if off == 0:
            out.setdefault(n.split('@')[0], v)
    missing = set(CLASSES) - set(out)
    if missing:
        raise RuntimeError(f'RTTI classes not found: {missing} -- the game may have changed a lot')
    return out


def nearest(cands, old, what):
    if not cands:
        raise RuntimeError(f'calibration failed: no candidate for {what}')
    return min(cands, key=lambda c: (abs(c - old), c))


def u16col(d, o):
    return d[:, o].astype(np.int64) | (d[:, o + 1].astype(np.int64) << 8)


def u64col(d, o):
    return np.ascontiguousarray(d[:, o:o + 8]).view('<u8')[:, 0]


def collect(p, vt_abs, log):
    objs = fm27.find_objects(p, vt_abs)
    rows, addrs = [], []
    for o in objs:
        b = p.read(o, fm27.OBJ_SIZE)
        if len(b) == fm27.OBJ_SIZE:
            rows.append(np.frombuffer(b, np.uint8))
            addrs.append(o)
    log(f'{len(rows)} player objects')
    return np.array(rows), addrs


def run(p, old, log=print):
    base, dll = p.module(fm27.DLL_NAME)
    vts = old.get('vtables', {})
    if not (all(vts.get(c) for c in CLASSES) and len(fm27.find_objects(p, base + vts['ACTUAL_PLAYER'])) > 1000):
        vts = find_vtables(dll, log)  # vtables moved (code changed): re-derive from RTTI
    d, addrs = collect(p, base + vts['ACTUAL_PLAYER'], log)
    if len(d) < 1000:
        raise RuntimeError(f'only {len(d)} player objects -- load a save first')
    O, L = old['player'], {k: dict(v) if isinstance(v, dict) else v for k, v in old.items()}
    P = L['player']
    W = fm27.OBJ_SIZE

    # embedded PLAYING_DATA: offset holding its vtable in (nearly) every object
    pdv = base + vts['PLAYING_DATA']
    c = [o for o in range(0, W - 8, 8) if (u64col(d, o) == pdv).mean() > 0.9]
    P['PD'] = pd = nearest(c, O['PD'], 'PLAYING_DATA')
    d = d[u64col(d, pd) == pdv]  # drop junk/freed objects

    # positions: 15 bytes in 1..20, each player has a 20
    def is_pos(o):
        blk = d[:, o:o + 15]
        return ((blk >= 1) & (blk <= 20)).mean() > 0.995 and (blk.max(1) == 20).mean() > 0.95 and blk.std() > 3
    L['pd']['POS'] = posk = nearest([k for k in range(0, 64) if is_pos(pd + k)], old['pd']['POS'], 'positions')

    # attributes: 54 bytes in 1..100 right after positions
    def is_att(o):
        blk = d[:, o:o + 54]
        return ((blk >= 1) & (blk <= 100)).mean() > 0.99 and blk.std() > 10
    L['pd']['ATT'] = attk = nearest([k for k in range(posk + 15, posk + 48) if is_att(pd + k)], old['pd']['ATT'], 'attributes')

    # CA/PA: adjacent u16s, both <= 200, PA >= CA nearly always
    cands = []
    for k in range((attk + 55) // 2 * 2, fm27.OBJ_SIZE - pd - 4, 2):
        ca, pa = u16col(d, pd + k), u16col(d, pd + k + 2)
        if ca.max() <= 200 and pa.max() <= 200 and (pa >= ca).mean() > 0.97 and ca.std() > 10 and pa.mean() > ca.mean() + 5:
            cands.append(k)
    L['pd']['CA'] = cak = nearest(cands, old['pd']['CA'], 'CA/PA')
    L['pd']['PA'] = cak + 2

    # birth date: (doy, year) with year spread
    def is_dob(o):
        y, dd = u16col(d, o + 2), u16col(d, o)
        return ((y >= 1940) & (y <= 2100)).mean() > 0.99 and ((dd >= 1) & (dd <= 366)).mean() > 0.99 and y.std() > 3
    P['DOB'] = nearest([o for o in range(0, W - 4, 2) if is_dob(o)], O['DOB'], 'birth date')

    # update stamp = game date source: (packed doy, year) with year constant across players and
    # low 9 bits a valid, recent day (players are touched by the game every few days)
    def is_stamp(o):
        y, dd = u16col(d, o + 2), u16col(d, o) & 0x1FF
        top = np.bincount(y).argmax()
        return 1950 < top < 2300 and (y == top).mean() > 0.5 and ((dd >= 1) & (dd <= 366)).mean() > 0.99  # new games mix stamp years
    P['STAMP'] = nearest([o for o in range(0, W - 4, 2) if is_stamp(o)], O['STAMP'], 'date stamp')

    # height: u8 in 140..215 with spread
    def is_height(o):
        h = d[:, o]
        return ((h >= 140) & (h <= 215)).mean() > 0.99 and h.std() > 4
    P['HEIGHT'] = h = nearest([o for o in range(W) if is_height(o)], O['HEIGHT'], 'height')
    # no clean signature for these; they sit at fixed distances from height in every build seen so far
    for k in ('VALUE', 'ASKING', 'LAST_FEE'):
        P[k] = h + (O[k] - O['HEIGHT'])
    P['GENDER'] = h + (O['GENDER'] - O['HEIGHT'])

    # personality: 8 bytes in 0..20, at least 7 with full spread
    def is_pers(o):
        blk = d[:, o:o + 8]
        return blk.max() <= 20 and sum(len(np.unique(blk[:, i])) >= 15 for i in range(8)) >= 7 and blk[:, 0].min() >= 1
    P['PERSONALITY'] = nearest([o for o in range(W - 8) if is_pers(o)], O['PERSONALITY'], 'personality')


    # pointer fields: chase a sample
    p_ = fm27.Reader(p, L)
    idx = np.linspace(0, len(d) - 1, min(SAMPLE, len(d))).astype(int)
    S = d[idx]

    def target_vt(o):
        out = []
        for v in u64col(S, o):
            t = p.u64(int(v)) if 0x10000 < int(v) < 0x7fffffffffff else None
            out.append((t - base) if t else None)
        return out

    targets = {o: target_vt(o) for o in range(0, W - 8, 8)}

    def ptr_field(cls, frac, old_o, what):
        want = vts[cls]
        c = [o for o, ts in targets.items() if np.mean([t == want for t in ts]) > frac]
        return nearest(c, old_o, what)
    P['TEAM'] = ptr_field('TEAM', 0.8, O['TEAM'], 'team pointer')
    P['NATION'] = ptr_field('NATION', 0.95, O['NATION'], 'nation pointer')
    P['CONTRACT'] = ptr_field('FULL_CONTRACT', 0.8, O['CONTRACT'], 'contract pointer')

    def name_ok(o):
        return np.mean([bool(p_.name2(int(v))) for v in u64col(S, o)]) > 0.9
    names = [o for o in range(0, W - 16, 8) if name_ok(o) and name_ok(o + 8)]
    P['FIRST'] = f = nearest(names, O['FIRST'], 'name pointers')
    P['LAST'] = f + 8

    # sub-object fields: keep old offsets if they still read sensibly, else search
    teams = [int(v) for v in u64col(S, P['TEAM']) if v]
    clubs = [p_.ptr(t + L['team']['CLUB']) for t in teams]
    if np.mean([p.u64(c) == base + vts['CLUB'] if c else False for c in clubs]) < 0.9:
        raise RuntimeError('team->club link moved; recalibrate by hand (see README)')
    for key in ('NAME', 'SHORT'):
        if np.mean([bool(p_.lpstr(p_.ptr(c + L['club'][key]))) for c in clubs if c]) < 0.9:
            raise RuntimeError(f'club {key} offset moved; recalibrate by hand')
    nats = [int(v) for v in u64col(S, P['NATION'])]
    for key in ('NAME', 'CODE'):
        if np.mean([bool(p_.lpstr(p_.ptr(n + L['nation'][key]))) for n in nats]) < 0.9:
            raise RuntimeError(f'nation {key} offset moved; recalibrate by hand')

    # Attribute slot names are NOT re-learned: they follow FM's internal attribute order, which has been
    # stable for many versions. (Statistical relabelling was tried and scrambled names on a different save.)
    L['vtables'] = vts
    return L


def diff(a, b, path=''):
    out = []
    for k in sorted(set(a) | set(b)):
        if k == 'build':
            continue
        x, y = a.get(k), b.get(k)
        if isinstance(x, dict) and isinstance(y, dict):
            out += diff(x, y, f'{path}{k}.')
        elif x != y:
            out.append(f'{path}{k}: {x} -> {y}')
    return out


if __name__ == '__main__':
    p = Proc()
    old = fm27.load_layout()
    new = run(p, old)
    changes = diff(old, new)
    print('\n'.join(changes) or 'layout unchanged')
    if '--check' not in sys.argv:
        new['build'] = fm27.build_id(p.module(fm27.DLL_NAME)[1])
        fm27.save_layout(new)
        print('saved layout.json')
