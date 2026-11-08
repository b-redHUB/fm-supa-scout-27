"""Live check against the running game:  python fm27.py players.json && python test_fm27.py
Checks generic sanity on any save, plus known players for the saves we have screenshots/knowledge of."""
import json
import sys

res = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'players.json', encoding='utf-8'))
K, ps = res['attrKeys'], res['players']
for p in ps:
    p['attrs'] = {k: round(v / 5) for k, v in zip(K, p['a'])}
    p['positions'] = [res['positions'][i] for i, r in enumerate(p['pr']) if r >= 15]
by = {p['name']: p for p in ps}
assert not res['issues'], res['issues']
assert res['myClubs'], 'manager club not detected'
assert all(p['female'] for p in ps if p['club'] in ('OL Lyonnes', 'Gotham FC'))
print('generic ok:', len(ps), 'players, game date', res['date'], 'club', res['myClubs'][0]['name'])

if 'Virgil van Dijk' in by:  # real-world database save (2026 start)
    v, h = by['Virgil van Dijk'], by['Erling Haaland']
    assert all(v['attrs'][k] >= 14 for k in ('Tck', 'Mar', 'Hea', 'Jum', 'Str', 'Pos')), v['attrs']
    assert all(h['attrs'][k] >= 16 for k in ('Fin', 'OtB', 'Pac', 'Str')) and h['attrs']['Tck'] <= 10, h['attrs']
    assert h['attrs']['LeftFoot'] > h['attrs']['RightFoot'], 'Haaland is left-footed'
    assert 'DC' in v['positions'] and 'ST' in h['positions']
    if 'Jon Aramburu' in by:  # release clause shown in game as £43m
        assert abs(by['Jon Aramburu']['releaseClause'] - 43_000_000) < 500_000, by['Jon Aramburu']['releaseClause']
    print('real-database spot checks ok')
