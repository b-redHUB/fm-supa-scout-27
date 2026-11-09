"""Simulated-patch test: corrupt the layout (shift offsets), recalibrate,
expect the true layout back. Needs FM27 running with a save. python selftest_calibrate.py"""
import copy
import random

import calibrate
import fm27
from mem import Proc

true = fm27.load_layout()
bad = copy.deepcopy(true)
for k in bad['player']:
    bad['player'][k] += random.choice([-6, -4, 4, 6])
for k in ('VALUE', 'ASKING', 'LAST_FEE', 'GENDER'):  # anchored to HEIGHT: neighbours move together in a real patch
    bad['player'][k] = true['player'][k] - true['player']['HEIGHT'] + bad['player']['HEIGHT']
bad['pd']['CA'] += 4
new = calibrate.run(Proc(), bad, log=lambda m: None)
d = calibrate.diff(true, new)
assert not d, d
print('ok: recovered true layout from corrupted one')
