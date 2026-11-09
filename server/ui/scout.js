// FM Supa Scout: role ratings from live attributes (1-20 scale). Browser + node.

const ATTRS = {
  Technical: ['Cor', 'Cro', 'Dri', 'Fin', 'Fir', 'Fre', 'Hea', 'Lon', 'LTh', 'Mar', 'Pas', 'Pen', 'Tck', 'Tec'],
  Mental: ['Agg', 'Ant', 'Bra', 'Cmp', 'Cnt', 'Dec', 'Det', 'Fla', 'Ldr', 'OtB', 'Pos', 'Tea', 'Vis', 'Wor'],
  Physical: ['Acc', 'Agi', 'Bal', 'Jum', 'Nat', 'Pac', 'Sta', 'Str'],
  Goalkeeping: ['Aer', 'Cmd', 'Com', 'Ecc', 'Han', 'Kic', '1v1', 'Pun', 'Ref', 'TRO', 'Thr'],
};

// role: [key attributes, preferred attributes]. Edit freely — this is the tuning knob.
const ROLES = {
  'Goalkeeper': ['Aer Cmd Com Han Kic Ref Cnt Pos Agi', '1v1 Thr Ant Dec'],
  'Sweeper Keeper': ['Cmd Kic 1v1 Ref Ant Cmp Cnt Pos Agi', 'Aer Fir Han Pas TRO Dec Vis Acc'],
  'Central Defender': ['Hea Mar Tck Pos Jum Str', 'Agg Ant Bra Cmp Cnt Dec Pac'],
  'Ball Playing Defender': ['Hea Mar Pas Tck Cmp Pos Jum Str', 'Fir Tec Agg Ant Bra Cnt Dec Vis Pac'],
  'Full Back': ['Mar Tck Ant Cnt Pos Tea', 'Cro Pas Dec Wor Pac Sta'],
  'Wing Back': ['Cro Dri Mar Tck OtB Tea Wor Acc Sta', 'Fir Pas Tec Ant Cnt Dec Pos Agi Bal Pac'],
  'Inverted Wing Back': ['Pas Tck Cmp Dec Tea', 'Fir Mar Tec Ant Cnt OtB Pos Vis Wor Acc Agi Sta'],
  'Defensive Midfielder': ['Tck Ant Cnt Pos Tea', 'Mar Pas Agg Cmp Dec Wor Sta Str'],
  'Deep Lying Playmaker': ['Fir Pas Tec Cmp Dec Tea Vis', 'Ant OtB Pos Bal'],
  'Ball Winning Midfielder': ['Tck Agg Ant Tea Wor Sta', 'Mar Bra Cnt Pos Agi Pac Str'],
  'Box to Box Midfielder': ['Pas Tck OtB Tea Wor Sta', 'Dri Fin Fir Lon Tec Agg Ant Cmp Dec Pos Acc Bal Pac Str'],
  'Central Midfielder': ['Fir Pas Tck Dec Tea', 'Tec Ant Cmp Cnt OtB Vis Wor Sta'],
  'Advanced Playmaker': ['Fir Pas Tec Cmp Dec OtB Tea Vis', 'Dri Ant Fla Agi'],
  'Attacking Midfielder': ['Fir Lon Pas Tec Ant Dec Fla OtB', 'Dri Cmp Vis Agi'],
  'Winger': ['Cro Dri Tec Acc Agi', 'Fir Pas OtB Wor Bal Pac Sta'],
  'Inside Forward': ['Dri Fin Fir Tec OtB Acc Agi', 'Lon Pas Ant Cmp Fla Vis Wor Bal Pac'],
  'Inverted Winger': ['Cro Dri Pas Tec Acc Agi', 'Fir Lon Ant Cmp Dec Fla OtB Vis Wor Bal Pac Sta'],
  'Advanced Forward': ['Dri Fin Fir Tec Cmp OtB Acc', 'Pas Ant Dec Wor Agi Bal Pac Sta'],
  'Poacher': ['Fin Ant Cmp OtB', 'Fir Hea Tec Dec Acc'],
  'Target Forward': ['Hea Bra Tea Bal Jum Str', 'Fin Fir Agg Ant Cmp Dec OtB'],
  'Deep Lying Forward': ['Fir Pas Tec Cmp Dec OtB Tea', 'Fin Ant Fla Vis Bal Str'],
  'Complete Forward': ['Dri Fin Fir Hea Lon Pas Tec Ant Cmp Dec OtB Vis Acc Agi Str', 'Tea Wor Bal Jum Pac Sta'],
  'Pressing Forward': ['Agg Ant Bra OtB Tea Wor Acc Pac Sta', 'Fin Fir Cmp Cnt Dec Agi Bal Str'],
};
const ROLE_DEFS = Object.entries(ROLES).map(([n, [k, p]]) => [n, k.split(' '), p.split(' ')]);

// positions each role is played from (best role is picked among roles matching a player's positions)
const ROLE_POS = {
  'Goalkeeper': 'GK', 'Sweeper Keeper': 'GK',
  'Central Defender': 'DC', 'Ball Playing Defender': 'DC',
  'Full Back': 'DL DR WBL WBR', 'Wing Back': 'DL DR WBL WBR', 'Inverted Wing Back': 'DL DR WBL WBR',
  'Defensive Midfielder': 'DM', 'Deep Lying Playmaker': 'DM MC', 'Ball Winning Midfielder': 'DM MC',
  'Box to Box Midfielder': 'MC', 'Central Midfielder': 'MC', 'Advanced Playmaker': 'MC AMC AML AMR',
  'Attacking Midfielder': 'AMC', 'Winger': 'ML MR AML AMR', 'Inverted Winger': 'ML MR AML AMR', 'Inside Forward': 'AML AMR',
  'Advanced Forward': 'ST', 'Poacher': 'ST', 'Target Forward': 'ST', 'Deep Lying Forward': 'ST', 'Complete Forward': 'ST', 'Pressing Forward': 'ST',
};

// weighted average of key (x1) + preferred (x0.5) attributes, scaled to 0-100
function roleScore(a, keys, prefs) {
  let sum = 0, w = 0;
  for (const k of keys) { sum += a[k]; w += 1; }
  for (const k of prefs) { sum += a[k] * 0.5; w += 0.5; }
  return Math.round(sum / w * 5);
}

// p.positions (optional): natural/accomplished positions; best role is chosen among roles they can play
function scorePlayer(p) {
  p.roles = {};
  p.best = 0; p.bestRole = '';
  const pos = p.positions || [];
  const fits = name => ROLE_POS[name].split(' ').some(x => pos.includes(x));
  const anyFit = ROLE_DEFS.some(([name]) => fits(name));
  for (const [name, keys, prefs] of ROLE_DEFS) {
    const s = roleScore(p.attrs, keys, prefs);
    p.roles[name] = s;
    if ((!anyFit || fits(name)) && s > p.best) { p.best = s; p.bestRole = name; }
  }
  return p;
}

if (typeof module !== 'undefined') {
  module.exports = { ATTRS, ROLES, roleScore, scorePlayer };
  if (require.main === module) { // node scout.js — self-check
    const assert = require('assert');
    const a = Object.fromEntries(Object.values(ATTRS).flat().map(k => [k, 10]));
    assert.strictEqual(scorePlayer({ attrs: a }).best, 50);
    Object.assign(a, { Fin: 20, Ant: 20, Cmp: 20, OtB: 20 });
    assert.strictEqual(scorePlayer({ attrs: a }).bestRole, 'Poacher');
    assert.strictEqual(scorePlayer({ attrs: a, positions: ['DC'] }).bestRole.includes('Defender'), true);
    assert.deepStrictEqual(Object.keys(ROLE_POS).sort(), Object.keys(ROLES).sort());
    console.log('ok');
  }
}
