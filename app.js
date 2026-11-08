'use strict';
// FM Supa Scout 27 front end. Data comes from server.py (/api/players), roles from scout.js.

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FOLD = { 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i' };
const fold = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[øæœßłđðþı]/g, c => FOLD[c]);
const store = {
  get(k, d) { try { const v = localStorage.getItem('ss.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ss.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const ROW = 34;
const PITCH = { GK: [7, 50], DL: [22, 13], DC: [22, 50], DR: [22, 87], WBL: [36, 10], WBR: [36, 90], DM: [37, 50], ML: [52, 13], MC: [52, 50], MR: [52, 87], AML: [68, 13], AMC: [68, 50], AMR: [68, 87], ST: [86, 50] };
const POS_ORDER = ['GK', 'DL', 'DC', 'DR', 'WBL', 'WBR', 'DM', 'ML', 'MC', 'MR', 'AML', 'AMC', 'AMR', 'ST'];
const HIDDEN = ['Cons', 'ImpM', 'Vers', 'Dir', 'Inj']; // FM's hidden attributes
const HIDDEN_NAME = { Cons: 'Consistency', ImpM: 'Important matches', Vers: 'Versatility', Dir: 'Dirtiness', Inj: 'Injury proneness' };
const LOW_GOOD = new Set(['Dir', 'Inj', 'Controversy']); // lower is better: colour inverted
const SERIES = ['var(--flood)', 'var(--s2)', 'var(--s3)', 'var(--s4)']; // themed
const RADAR_OUT = [
  ['Defending', 'Mar Tck Pos Cnt'], ['Physical', 'Str Sta Nat Bal'], ['Speed', 'Acc Pac Agi'], ['Vision', 'Vis Pas Fla Tec'],
  ['Attacking', 'Fin OtB Cmp Lon'], ['Technique', 'Fir Tec Dri Cro'], ['Aerial', 'Hea Jum Bra'], ['Mental', 'Det Dec Ant Wor Tea'],
];
const RADAR_GK = [
  ['Shot stopping', 'Ref 1v1 Han'], ['Aerial', 'Aer Cmd Jum'], ['Distribution', 'Kic Thr Pas'], ['Communication', 'Com Cmd Ldr'],
  ['Composure', 'Cmp Cnt Dec'], ['Speed', 'Acc Pac Agi'], ['Mental', 'Det Ant Pos'], ['Physical', 'Str Sta Bal'],
].map(([n, k]) => [n, k]);

// ---------------------------------------------------------------- state
let D = null;              // last scan response
let all = [];              // players
let rows = [];             // filtered + sorted
let sel = null;            // selected player
let gameYear = 2043;
const F0 = () => ({ q: '', pos: [], ageMin: null, ageMax: null, caMin: null, caMax: null, paMin: null, heightMin: null,
  valueMax: null, estMax: null, releaseMax: null, hasRelease: false, wageMax: null, expMax: null, free: false, nation: '', club: '', foot: '', attrs: [], loan: '', notMine: false, discover: '' });
let F = F0();
const UI = {
  gender: store.get('gender', 'm'), view: store.get('view', 'overview'), role: store.get('role', ''),
  sort: store.get('sort', ['rating', -1]), preset: 'all', auto: store.get('auto', true), copyAs: store.get('copyAs', 'full'),
};
const shortlist = new Set(store.get('shortlist', []));
{ const d = store.get('disc', {}); UI.discPos = d.pos || ''; UI.discNotMine = !!d.notMine; UI.discMaxFee = d.maxFee ?? null; }
let compare = [];
let lastStatusDate = null;

// ---------------------------------------------------------------- formatting
const money = v => v == null ? '' : v >= 1e6 ? `£${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e3 ? `£${Math.round(v / 1e3)}K` : `£${v}`;
const v20 = v => v >= 16 ? 'v-elite' : v >= 13 ? 'v-good' : v >= 8 ? 'v-ok' : 'v-low';
const v100 = v => v20(v / 5);
const v200 = v => v20(v / 10);
const footWord = v => v >= 95 ? 'Very strong' : v >= 80 ? 'Strong' : v >= 60 ? 'Fairly strong' : v >= 40 ? 'Reasonable' : v >= 20 ? 'Weak' : 'Very weak';
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const stars = v => { // ability out of 200 -> 5 stars in halves
  const s = Math.round(v / 20) / 2;
  return `<span class="stars" aria-label="${s} stars">${'★'.repeat(Math.floor(s))}${s % 1 ? '⯪' : ''}<span class="e">${'★'.repeat(5 - Math.ceil(s))}</span></span>`;
};
const delta = d => d == null || d === 0 ? '' : d > 0 ? `<span class="up">▲${d}</span>` : `<span class="down">▼${-d}</span>`;
// cheapest certain way to buy: release clause (club must accept) or asking price (listed players)

// ---- estimated fee: learned from agent quotes the user records (quote / FM value) ----
// ponytail: median ratio until 3 quotes, then log-ratio ~ contract years left (1 feature, least squares).
// Upgrade path: add squad importance / club rivalry as features once there are enough quotes.
let quotes = store.get('quotes', []);  // [{key, name, low, high, value, yl, date}]
const yearsLeft = p => p.expires ? Math.max(0, p.expires - gameYear) : 0;
let feeModelMemo = null;
// Prior: FM AI asks more the longer the contract. ponytail: hand-set curve (our judgement, not read from
// the game); agent quotes scale it via a shrunk correction factor (2 pseudo-quotes at 1.0), so one odd
// quote (e.g. a rivalry premium) can't swing every estimate. Upgrade: more features once quotes pile up.
const PRIOR = [1.0, 1.0, 1.3, 1.6, 1.9, 2.1];
const prior = yl => PRIOR[Math.min(Math.max(0, yl), PRIOR.length - 1)];
function feeModel() {
  if (feeModelMemo) return feeModelMemo;
  const qs = quotes.filter(q => q.value > 0);
  const logc = qs.reduce((t, q) => t + Math.log((q.low + q.high) / 2 / q.value / prior(q.yl)), 0) / (qs.length + 2);
  const c = Math.exp(logc);
  return (feeModelMemo = { n: qs.length, c, f: yl => prior(yl) * c });
}
// what it should cost: recorded quote > asking price (listed) > value x learned markup, capped by release clause
function estFee(p) {
  if (!p.club) return 0;
  const q = quotes.find(x => x.key === p.key);
  if (q) return Math.round((q.low + q.high) / 2);
  if (p.askingPrice != null) return p.releaseClause != null ? Math.min(p.askingPrice, p.releaseClause) : p.askingPrice;
  const m = feeModel();
  if (!p.value) return p.releaseClause ?? null;
  const e = Math.round(p.value * m.f(yearsLeft(p)) / 1e5) * 1e5;
  return p.releaseClause != null ? Math.min(e, p.releaseClause) : e;
}
function feeWhy(p) {
  if (!p.club) return 'Free agent: no transfer fee';
  if (quotes.some(x => x.key === p.key)) return 'From the agent quote you recorded';
  if (p.askingPrice != null && (p.releaseClause == null || p.askingPrice <= p.releaseClause)) return 'Club’s asking price (transfer listed)';
  const m = feeModel(), e = estFee(p);
  if (p.releaseClause != null && e === p.releaseClause) return 'Release clause: the club must accept this';
  return `Value × ${(e / p.value).toFixed(2)} for ${yearsLeft(p)} year${yearsLeft(p) === 1 ? '' : 's'} left on contract` +
    (m.n ? `, adjusted ×${m.c.toFixed(2)} by ${m.n} agent quote${m.n > 1 ? 's' : ''}` : ' (record agent quotes to calibrate)');
}
function saveQuote(p, lowM, highM) {
  quotes = quotes.filter(q => q.key !== p.key);
  if (lowM > 0) quotes.push({ key: p.key, name: p.name, low: lowM * 1e6, high: (highM || lowM) * 1e6, value: p.value, yl: yearsLeft(p), date: D?.date });
  store.set('quotes', quotes);
  feeModelMemo = null;
}
const knownPrice = p => p.releaseClause != null && (p.askingPrice == null || p.releaseClause < p.askingPrice) ? p.releaseClause : p.askingPrice;
const rating = p => UI.role ? p.roles[UI.role] : p.best;
const roleName = p => UI.role || p.bestRole;

// ---------------------------------------------------------------- data prep
function prep(res) {
  const K = res.attrKeys, PK = res.personalityKeys, POS = res.positions;
  gameYear = +res.date.slice(0, 4);
  for (const p of res.players) {
    p.key = `${p.name}|${p.dob}`;
    p.attrs = {};
    K.forEach((k, i) => { p.attrs[k] = Math.max(1, p.a[i] / 5); }); // FM shows 1-20
    p.foot = [p.a[K.indexOf('LeftFoot')], p.a[K.indexOf('RightFoot')]];
    p.posR = {};
    POS.forEach((k, i) => { p.posR[k] = p.pr[i]; });
    p.positions = POS_ORDER.filter(k => p.posR[k] >= 15);
    p.isGK = p.posR.GK >= 15;
    p.pers = {};
    PK.forEach((k, i) => { p.pers[k] = p.per[i]; });
    p.growth = p.pa - p.ca;
    p.dCA = p.prev ? p.ca - p.prev[0] : null;
    p.dPA = p.prev ? p.pa - p.prev[1] : null;
    p.hay = fold(`${p.name} ${p.club} ${p.clubShort} ${p.nation} ${p.nationCode}`);
    scorePlayer(p);
  }
  feeModelMemo = null;
  return res.players;
}

// ---------------------------------------------------------------- columns
const ATTR_GROUPS = { technical: ATTRS.Technical, mental: ATTRS.Mental, physical: ATTRS.Physical, goalkeeping: ATTRS.Goalkeeping };
const COL = {
  star: { label: '', w: 30, c: true, get: p => shortlist.has(p.key) ? 1 : 0, html: p => iconBtn('star', p, shortlist.has(p.key)) },
  copy: { label: '', w: 30, c: true, nosort: true, html: p => iconBtn('copy', p) },
  name: { label: 'Name', w: 200, get: p => p.last.toLowerCase(), html: p => `<span class="name">${esc(p.name)}</span>${tags(p)}`, cls: 'name' },
  age: { label: 'Age', w: 46, n: true, get: p => p.age },
  pos: { label: 'Position', w: 110, get: p => POS_ORDER.indexOf(p.positions[0]), html: p => esc(p.positions.join(' ')) },
  club: { label: 'Club', w: 165, get: p => p.club || '~', html: p => (p.club ? esc(p.club) : '<span class="tag fa">Free agent</span>') + (p.onLoan ? `<span class="tag loan" title="On loan from ${esc(p.parentClub)} until ${fmtDate(p.loanEnds)}">loan</span>` : '') },
  nation: { label: 'Nation', w: 105, get: p => p.nation, html: p => esc(p.nation) },
  ca: { label: 'CA', w: 50, n: true, get: p => p.ca, html: p => `<span class="num ${v200(p.ca)}">${p.ca}</span>` },
  pa: { label: 'PA', w: 50, n: true, get: p => p.pa, html: p => `<span class="num ${v200(p.pa)}">${p.pa}</span>` },
  growth: { label: 'Room', w: 56, n: true, get: p => p.growth, title: 'Potential minus current ability', html: p => p.growth > 0 ? `<span class="num">+${p.growth}</span>` : '' },
  dca: { label: 'Since', w: 58, n: true, get: p => p.dCA ?? -999, title: 'CA change since the previous scan at an earlier game date', html: p => delta(p.dCA) },
  value: { label: 'Value', title: 'FM transfer value', w: 70, n: true, get: p => p.value ?? -1, html: p => money(p.value) },
  asking: { label: 'Asking', title: 'Asking price (transfer-listed players)', w: 70, n: true, get: p => p.askingPrice ?? -1, html: p => money(p.askingPrice) },
  lastFee: { label: 'Last fee', title: 'Fee paid at his last transfer', w: 70, n: true, get: p => p.lastFee ?? -1, html: p => money(p.lastFee) },
  release: { label: 'Release', title: 'Minimum fee release clause: the club must accept this bid', w: 70, n: true, get: p => p.releaseClause ?? -1, html: p => p.releaseClause ? `<b class="v-elite">${money(p.releaseClause)}</b>` : '' },
  est: { label: 'Est. fee', title: 'What it should take: your agent quote, asking price, release clause, or value × the markup learned from your agent quotes', w: 80, n: true, get: p => estFee(p) ?? 1e13, html: p => { const v = estFee(p); return v == null ? '' : `<span title="${esc(feeWhy(p))}">${v === 0 ? 'Free' : money(v)}${quotes.some(x => x.key === p.key) ? ' <span class="tag">quote</span>' : ''}</span>`; } },
  price: { label: 'Known price', title: 'Cheapest known way in: release clause or asking price', w: 86, n: true, get: p => knownPrice(p) ?? 1e12, html: p => money(knownPrice(p)) },
  wage: { label: 'Wage', w: 76, n: true, get: p => p.wage ?? -1, html: p => p.wage ? money(p.wage) + '<span class="sub">/w</span>' : '' },
  exp: { label: 'Contract', w: 74, n: true, get: p => p.expires ?? 9999, html: p => p.expires ? (p.expires <= gameYear + 1 ? `<b class="v-elite">${p.expires}</b>` : p.expires) : '' },
  expd: { label: 'Contract ends', w: 110, n: true, get: p => p.expiresDate || '9', html: p => fmtDate(p.expiresDate) },
  height: { label: 'Height', w: 60, n: true, get: p => p.height, html: p => p.height + '<span class="sub">cm</span>' },
  feet: { label: 'Feet L/R', w: 150, get: p => Math.min(...p.foot), html: p => `${footWord(p.foot[0])} / ${footWord(p.foot[1])}` },
  dob: { label: 'Born', w: 100, n: true, get: p => p.dob, html: p => fmtDate(p.dob) },
  role: { label: 'Role', w: 150, get: p => roleName(p), html: p => esc(roleName(p)) },
  rating: { label: 'Rating', w: 64, n: true, get: rating, html: p => `<span class="num ${v100(rating(p))}">${rating(p)}</span>` },
};
for (const k of Object.values(ATTRS).flat()) COL['a:' + k] = { label: k, w: 42, c: true, get: p => p.attrs[k], html: p => `<span class="a20 ${v20(p.attrs[k])}">${Math.round(p.attrs[k])}</span>`, title: k };
for (const k of HIDDEN) COL['a:' + k] = { label: k, title: HIDDEN_NAME[k], w: 50, c: true, get: p => p.attrs[k], html: p => `<span class="a20 ${v20(LOW_GOOD.has(k) ? 21 - p.attrs[k] : p.attrs[k])}">${Math.round(p.attrs[k])}</span>` };
const PERS = ['Adaptability', 'Ambition', 'Loyalty', 'Pressure', 'Professionalism', 'Sportsmanship', 'Temperament', 'Controversy'];
for (const k of PERS) COL['p:' + k] = { label: k.slice(0, 4), title: k, w: 50, c: true, get: p => p.pers[k], html: p => `<span class="a20 ${k === 'Controversy' ? v20(21 - p.pers[k]) : v20(p.pers[k])}">${p.pers[k]}</span>` };

const LEAD = ['star', 'copy', 'name', 'age', 'pos'];
const VIEWS = {
  overview: { label: 'Overview', cols: [...LEAD, 'club', 'nation', 'ca', 'pa', 'growth', 'dca', 'value', 'est', 'wage', 'exp', 'role', 'rating'] },
  technical: { label: 'Technical', cols: [...LEAD, ...ATTRS.Technical.map(k => 'a:' + k), 'rating'] },
  mental: { label: 'Mental', cols: [...LEAD, ...ATTRS.Mental.map(k => 'a:' + k), 'rating'] },
  physical: { label: 'Physical', cols: [...LEAD, ...ATTRS.Physical.map(k => 'a:' + k), 'height', 'rating'] },
  goalkeeping: { label: 'Goalkeeping', cols: [...LEAD, ...ATTRS.Goalkeeping.map(k => 'a:' + k), 'rating'] },
  personality: { label: 'Personality', cols: [...LEAD, 'club', ...PERS.map(k => 'p:' + k)] },
  hidden: { label: 'Hidden', cols: [...LEAD, 'club', 'ca', 'pa', ...HIDDEN.map(k => 'a:' + k)] },
  contract: { label: 'Contract', cols: [...LEAD, 'club', 'nation', 'dob', 'height', 'feet', 'value', 'asking', 'release', 'lastFee', 'wage', 'expd'] },
};

function iconBtn(kind, p, on) {
  const svg = kind === 'star'
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>`;
  const title = kind === 'star' ? (on ? 'Remove from shortlist (S)' : 'Add to shortlist (S)') : 'Copy name to paste into FM (C)';
  return `<button class="ib ${on ? 'on' : ''}" data-act="${kind}" data-key="${esc(p.key)}" title="${title}" aria-label="${title}">${svg}</button>`;
}
function tags(p) {
  let t = '';
  if (p.age <= 21 && p.pa >= 150) t += '<span class="tag wk" title="21 or under with 150+ potential">WK</span>';
  if (p.dCA >= 5) t += `<span class="tag" title="CA up ${p.dCA} since last scan">▲${p.dCA}</span>`;
  return t;
}

// ---------------------------------------------------------------- presets
const PRESETS = [
  { id: 'all', label: 'Everyone', sort: ['rating', -1] },
  { id: 'wonder', label: 'Wonderkids', hint: '19 or under, PA 150+', f: { ageMax: 19, paMin: 150 }, sort: ['pa', -1] },
  { id: 'future', label: 'Future stars', hint: '23 or under, 30+ to grow', f: { ageMax: 23, paMin: 140 }, test: p => p.growth >= 30, sort: ['growth', -1] },
  { id: 'gems', label: 'Hidden gems', hint: 'CA under 110, PA 150+', f: { caMax: 109, paMin: 150 }, sort: ['pa', -1] },
  { id: 'free', label: 'Free agents', hint: 'no club, sign now', f: { free: true }, sort: ['ca', -1] },
  { id: 'expiring', label: 'Contracts ending', hint: () => `by summer ${gameYear + 1}`, f: () => ({ expMax: gameYear + 1, caMin: 100 }), sort: ['ca', -1] },
  { id: 'clause', label: 'Release clause bargains', hint: 'clause up to £30M, CA 140+', f: { releaseMax: 30, caMin: 140 }, sort: ['ca', -1] },
  { id: 'cheap', label: 'Low wage, real ability', hint: 'up to £15K/w, CA 130+', f: { wageMax: 15, caMin: 130 }, sort: ['ca', -1] },
  { id: 'vets', label: 'Ready-made veterans', hint: '31+, CA 150+', f: { ageMin: 31, caMin: 150 }, sort: ['ca', -1] },
  { id: 'risers', label: 'Biggest risers', hint: 'CA up since last scan', test: p => p.dCA > 0, sort: ['dca', -1] },
  { id: 'shortlist', label: 'Shortlist', hint: 'your starred players', test: p => shortlist.has(p.key), sort: ['rating', -1] },
];
const presetById = id => PRESETS.find(p => p.id === id);

function applyPreset(id) {
  const pr = presetById(id);
  UI.preset = id;
  F = { ...F0(), q: F.q, ...(typeof pr.f === 'function' ? pr.f() : pr.f || {}) };
  UI.sort = pr.sort;
  renderRail();
  update();
}

// ---------------------------------------------------------------- filtering
const num = v => v === '' || v == null || Number.isNaN(+v) ? null : +v;
function filterFn() {
  const q = fold(F.q).trim().split(/\s+/).filter(Boolean);
  const nat = fold(F.nation).trim(), club = fold(F.club).trim();
  const pos = F.pos, g = UI.gender, pr = presetById(UI.preset), dtest = F.discover ? discTest(F.discover) : null;
  const af = F.attrs.filter(a => a.k && a.min != null);
  return p =>
    (!g || p.female === (g === 'f')) &&
    (!q.length || q.every(w => p.hay.includes(w))) &&
    (!pos.length || pos.some(k => p.posR[k] >= 15)) &&
    (F.ageMin == null || p.age >= F.ageMin) && (F.ageMax == null || p.age <= F.ageMax) &&
    (F.caMin == null || p.ca >= F.caMin) && (F.caMax == null || p.ca <= F.caMax) &&
    (F.paMin == null || p.pa >= F.paMin) && (F.heightMin == null || p.height >= F.heightMin) &&
    (F.valueMax == null || (p.value != null && p.value <= F.valueMax * 1e6)) &&
    (F.estMax == null || (estFee(p) != null && estFee(p) <= F.estMax * 1e6)) &&
    (F.releaseMax == null || (p.releaseClause != null && p.releaseClause <= F.releaseMax * 1e6)) &&
    (!F.hasRelease || p.releaseClause != null) &&
    (F.wageMax == null || (p.wage != null && p.wage <= F.wageMax * 1e3)) &&
    (F.expMax == null || (p.expires && p.expires <= F.expMax)) &&
    (!F.free || !p.club) &&
    (!F.loan || (F.loan === 'loan' ? p.onLoan : F.loan === 'parent' ? !!p.parentClub : !p.onLoan)) &&
    (!F.notMine || !isMine(p)) &&
    (!dtest || dtest(p)) &&
    (!nat || fold(p.nation).includes(nat) || fold(p.nationCode) === nat) &&
    (!club || fold(p.club).includes(club)) &&
    (!F.foot || (F.foot === 'L' ? p.foot[0] >= 80 : F.foot === 'R' ? p.foot[1] >= 80 : Math.min(...p.foot) >= 70)) &&
    af.every(a => (a.k.startsWith('p:') ? p.pers[a.k.slice(2)] : p.attrs[a.k]) >= a.min) &&
    (!pr.test || pr.test(p));
}

function update(keepScroll) {
  if (!all.length) return;
  const fn = filterFn();
  rows = all.filter(fn);
  const [k, dir] = UI.sort, col = k === 'disc' && F.discover ? { get: discScore(F.discover) } : COL[k] || COL.rating, get = col.get;
  rows.sort((a, b) => {
    const x = get(a), y = get(b);
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return c * dir || b.ca - a.ca;
  });
  const n = rows.length;
  const avg = n ? (rows.reduce((s, p) => s + p.age, 0) / n).toFixed(1) : 0;
  $('count').innerHTML = `${n.toLocaleString()} ${n === 1 ? "player" : "players"}<small>${n ? `average age ${avg}` : ''}</small>` +
    (F.discover ? ` <span class="tag wk">${esc(DISC_BY[F.discover].title)} <button class="ib" data-cleardisc aria-label="Clear" style="padding:0 2px;color:inherit">✕</button></span>` : '');
  store.set('sort', UI.sort);
  renderGrid(keepScroll);
}

// ---------------------------------------------------------------- grid (virtualised)
let cols = [], colW = '';
function renderGrid(keepScroll) {
  const grid = $('grid');
  cols = VIEWS[UI.view].cols.map(k => ({ k, ...COL[k] }));
  colW = cols.map(c => c.w + 'px').join(' ');
  const total = cols.reduce((s, c) => s + c.w, 0);
  const [sk, sd] = UI.sort;
  const head = cols.map(c => `<div class="th ${c.n ? 'n' : ''} ${c.c ? 'c' : ''} ${c.k === sk ? 'on' : ''}" data-sort="${c.nosort ? '' : c.k}" title="${esc(c.title || c.label)}">${esc(c.label)}${c.k === sk ? (sd < 0 ? ' ▾' : ' ▴') : ''}</div>`).join('');
  grid.innerHTML = `<div class="thead" style="grid-template-columns:${colW}">${head}</div>` +
    (rows.length ? `<div id="tbody" style="position:relative;height:${rows.length * ROW}px;width:${total}px"></div>`
      : `<div class="empty"><h3>No one matches</h3><p>Loosen a filter on the left, or pick <b>Everyone</b> to start over.</p></div>`);
  if (!keepScroll) grid.scrollTop = 0;
  draw();
}
function draw() {
  const body = $('tbody');
  if (!body) return;
  const grid = $('grid'), top = Math.max(0, grid.scrollTop - 36);
  const first = Math.max(0, Math.floor(top / ROW) - 8), last = Math.min(rows.length, first + Math.ceil(grid.clientHeight / ROW) + 16);
  let h = '';
  for (let i = first; i < last; i++) {
    const p = rows[i];
    h += `<div class="tr ${p === sel ? 'sel' : ''}" style="top:${i * ROW}px;grid-template-columns:${colW};width:100%" data-i="${i}">` +
      cols.map(c => `<div class="td ${c.n ? 'n' : ''} ${c.c ? 'c' : ''} ${c.cls || ''}">${c.html ? c.html(p) : esc(c.get(p))}</div>`).join('') + '</div>';
  }
  body.innerHTML = h;
}

// ---------------------------------------------------------------- rail
function renderRail() {
  const counts = presetCounts();
  const nf = (key, ph, step) => `<input type="number" data-f="${key}" value="${F[key] ?? ''}" placeholder="${ph}" ${step ? `step="${step}"` : ''}>`;
  const attrOpts = sel0 => '<option value="">Attribute…</option>' + Object.entries(ATTRS).map(([g, ks]) =>
    `<optgroup label="${g}">${ks.map(k => `<option ${sel0 === 'a' + k ? 'selected' : ''} value="${k}">${k}</option>`).join('')}</optgroup>`).join('') +
    `<optgroup label="Personality">${PERS.map(k => `<option ${sel0 === 'ap:' + k ? 'selected' : ''} value="p:${k}">${k}</option>`).join('')}</optgroup>`;
  const saved = store.get('saved', []);
  const closed = new Set(store.get('railClosed', []));
  const sec = (id, title) => `<details class="rs" data-sec="${id}" ${closed.has(id) ? '' : 'open'}><summary>${title}</summary>`;
  $('rail').innerHTML = `
    ${sec('short', 'Shortcuts')}
    <div class="presets">${PRESETS.map(p => `<button class="preset ${UI.preset === p.id ? 'on' : ''}" data-preset="${p.id}" title="${esc(typeof p.hint === 'function' ? p.hint() : p.hint || '')}">${p.label}<span>${counts[p.id] ?? ''}</span></button>`).join('')}</div>
    </details>${sec('players', 'Players')}
    <div class="seg" role="group" aria-label="Gender">${[['m', 'Men'], ['f', 'Women'], ['', 'All']].map(([v, l]) => `<button data-gender="${v}" class="${UI.gender === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    </details>${sec('pos', 'Positions')}
    <div class="chips">${POS_ORDER.map(k => `<button class="chip ${F.pos.includes(k) ? 'on' : ''}" data-pos="${k}">${k}</button>`).join('')}</div>
    </details>${sec('filters', 'Filters')}
    <div class="field">Age<span class="pair">${nf('ageMin', 'min')}${nf('ageMax', 'max')}</span></div>
    <div class="field">Current ability<span class="pair">${nf('caMin', 'min')}${nf('caMax', 'max')}</span></div>
    <div class="field">Potential at least ${nf('paMin', '0-200')}</div>
    <div class="field">Value up to (£M) ${nf('valueMax', 'any', '0.5')}</div>
    <div class="field">Est. fee up to (£M) ${nf('estMax', 'any', '0.5')}</div>
    <div class="field">Release clause up to (£M) ${nf('releaseMax', 'any', '0.5')}</div>
    <label class="check"><input type="checkbox" data-f="hasRelease" ${F.hasRelease ? 'checked' : ''}> Has a release clause</label>
    <div class="field">Wage up to (£K/w) ${nf('wageMax', 'any')}</div>
    <div class="field">Contract ends by ${nf('expMax', 'year')}</div>
    <div class="field">Height at least (cm) ${nf('heightMin', 'cm')}</div>
    <div class="field wide"><input type="text" data-f="nation" list="nations" value="${esc(F.nation)}" placeholder="Nationality"></div>
    <div class="field wide"><input type="text" data-f="club" list="clubs" value="${esc(F.club)}" placeholder="Club"></div>
    <div class="field wide"><select data-f="foot">${[['', 'Any preferred foot'], ['L', 'Strong left foot'], ['R', 'Strong right foot'], ['B', 'Two-footed']].map(([v, l]) => `<option value="${v}" ${F.foot === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <label class="check"><input type="checkbox" data-f="free" ${F.free ? 'checked' : ''}> Free agents only</label>
    <div class="field wide"><select data-f="loan">${[['', 'Any loan status'], ['loan', 'On loan elsewhere'], ['parent', 'Owned by another club (loan or B team)'], ['no', 'Not on loan']].map(([v, l]) => `<option value="${v}" ${F.loan === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <label class="check"><input type="checkbox" data-f="notMine" ${F.notMine ? 'checked' : ''}> Hide ${esc(myClub()?.name || 'my club')}'s players</label>
    </details>${sec('attrs', 'Attribute minimums')}
    ${F.attrs.map((a, i) => `<div class="af"><select data-af="${i}" data-afk="k">${attrOpts(a.k?.startsWith('p:') ? 'ap:' + a.k.slice(2) : 'a' + a.k)}</select><input type="number" min="1" max="20" data-af="${i}" data-afk="min" value="${a.min ?? ''}" placeholder="min"><button class="ib" data-afdel="${i}" aria-label="Remove">✕</button></div>`).join('')}
    <button class="link" id="addAttr">Add attribute minimum</button>
    </details>${sec('saved', 'Saved searches')}
    ${saved.map((s, i) => `<div class="saved"><button class="preset" data-load="${i}">${esc(s.name)}</button><button class="x" data-delsaved="${i}" aria-label="Delete">✕</button></div>`).join('') || '<div class="note">Save the filters you use often.</div>'}
    <div class="af" style="grid-template-columns:1fr auto"><input type="text" id="saveName" placeholder="Name this search"><button class="btn" id="saveSearch">Save</button></div>
    </details>
    <button class="link" id="resetAll">Clear all filters</button>
    <datalist id="nations">${[...new Set(all.map(p => p.nation))].sort().map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <datalist id="clubs">${[...new Set(all.map(p => p.club).filter(Boolean))].sort().map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
}
function presetCounts() {
  if (!all.length) return {};
  const g = UI.gender, out = {};
  const pool = all.filter(p => !g || p.female === (g === 'f'));
  for (const pr of PRESETS) {
    const f = { ...F0(), ...(typeof pr.f === 'function' ? pr.f() : pr.f || {}) };
    const saveF = F, saveP = UI.preset;
    F = f; UI.preset = pr.id;
    const fn = filterFn();
    out[pr.id] = pool.filter(fn).length.toLocaleString();
    F = saveF; UI.preset = saveP;
  }
  return out;
}

// ---------------------------------------------------------------- charts
function radar(series, axes, size = 230) {
  const c = size / 2, R = size / 2 - 34, n = axes.length;
  const pt = (i, f) => [c + Math.sin(2 * Math.PI * i / n) * R * f, c - Math.cos(2 * Math.PI * i / n) * R * f];
  const ring = f => axes.map((_, i) => pt(i, f).join(',')).join(' ');
  let s = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Attribute profile">`;
  for (const f of [0.25, 0.5, 0.75, 1]) s += `<polygon points="${ring(f)}" fill="none" style="stroke:color-mix(in srgb, var(--chalk) 12%, transparent)"/>`;
  axes.forEach(([name], i) => {
    const [x, y] = pt(i, 1), [lx, ly] = pt(i, 1.2);
    s += `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" style="stroke:color-mix(in srgb, var(--chalk) 8%, transparent)"/>`;
    s += `<text x="${lx}" y="${ly}" style="fill:var(--dim)" font-size="10.5" text-anchor="middle" dominant-baseline="middle" font-family="Barlow">${name}</text>`;
  });
  series.forEach(({ p, color }) => {
    const vals = axes.map(([, ks]) => { const k = ks.split(' '); return k.reduce((t, a) => t + p.attrs[a], 0) / k.length; });
    const pts = vals.map((v, i) => pt(i, v / 20).join(',')).join(' ');
    s += `<polygon points="${pts}" style="fill:${color};stroke:${color}" fill-opacity="${series.length > 1 ? 0.12 : 0.22}" stroke-width="2" stroke-linejoin="round"/>`;
    if (series.length === 1) vals.forEach((v, i) => { const [x, y] = pt(i, v / 20); s += `<circle cx="${x}" cy="${y}" r="2.5" style="fill:${color}"><title>${axes[i][0]} ${v.toFixed(1)}</title></circle>`; });
  });
  return s + '</svg>';
}
function pitch(p) {
  const W = 200, H = 136, X = x => 4 + x / 100 * (W - 8), Y = y => 4 + y / 100 * (H - 8);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Position ratings"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="4" style="fill:var(--pitch-a)"/>`;
  for (let i = 0; i < 8; i++) if (i % 2) s += `<rect x="${4 + i * (W - 8) / 8}" y="4" width="${(W - 8) / 8}" height="${H - 8}" style="fill:var(--pitch-b)"/>`;
  s += `<g fill="none" style="stroke:color-mix(in srgb, var(--chalk) 45%, transparent)" stroke-width="1"><rect x="4" y="4" width="${W - 8}" height="${H - 8}"/><line x1="${W / 2}" y1="4" x2="${W / 2}" y2="${H - 4}"/><circle cx="${W / 2}" cy="${H / 2}" r="15"/>` +
    `<rect x="4" y="${H / 2 - 30}" width="26" height="60"/><rect x="${W - 30}" y="${H / 2 - 30}" width="26" height="60"/><rect x="4" y="${H / 2 - 13}" width="9" height="26"/><rect x="${W - 13}" y="${H / 2 - 13}" width="9" height="26"/></g>`;
  for (const [k, [x, y]] of Object.entries(PITCH)) {
    const r = p.posR[k];
    const fill = r >= 20 ? 'var(--flood)' : r >= 15 ? 'var(--good)' : r >= 10 ? 'color-mix(in srgb, var(--ok) 55%, transparent)' : 'color-mix(in srgb, var(--turf) 60%, transparent)';
    const rad = r >= 15 ? 8 : r >= 10 ? 6 : 4;
    s += `<circle cx="${X(x)}" cy="${Y(y)}" r="${rad}" style="fill:${fill};stroke:${r >= 10 ? 'none' : 'color-mix(in srgb, var(--chalk) 30%, transparent)'}"><title>${k}: ${r}/20</title></circle>`;
    if (r >= 15) s += `<text x="${X(x)}" y="${Y(y) + 17}" font-size="9" style="fill:var(--chalk)" text-anchor="middle" font-family="Barlow Condensed" font-weight="600">${k}</text>`;
  }
  return s + '</svg>';
}
const bar = (label, v, max, cls, title) => `<div class="b" title="${esc(title || '')}"><span>${esc(label)}</span><span class="track"><i style="width:${Math.max(2, v / max * 100)}%;background:${cls}"></i></span><span class="num">${v}</span></div>`;
const color20 = v => v >= 16 ? 'var(--flood)' : v >= 13 ? 'var(--good)' : v >= 8 ? 'var(--ok)' : 'var(--red)';

// ---------------------------------------------------------------- dossier
function similar(p, n = 6) {
  const keys = p.isGK ? ATTRS.Goalkeeping.concat(['Ref', 'Cmp', 'Dec', 'Pos', 'Agi']) : [...ATTRS.Technical, ...ATTRS.Mental, ...ATTRS.Physical];
  const out = [];
  for (const o of all) {
    if (o === p || o.female !== p.female || o.isGK !== p.isGK) continue;
    let d = 0;
    for (const k of keys) { const x = o.attrs[k] - p.attrs[k]; d += x * x; }
    out.push([d, o]);
  }
  return out.sort((a, b) => a[0] - b[0]).slice(0, n).map(x => x[1]);
}
function showDossier(p) {
  sel = p;
  $('main').classList.remove('no-dossier');
  const keys = new Set(UI.role ? ROLE_DEFS.find(r => r[0] === UI.role)[1] : ROLE_DEFS.find(r => r[0] === p.bestRole)[1]);
  const al = k => `<div class="al ${keys.has(k) ? 'key' : ''}"><span class="lbl">${esc(k)}</span><span class="a20 ${v20(p.attrs[k])}">${Math.round(p.attrs[k])}</span></div>`;
  const groups = p.isGK ? ['Goalkeeping', 'Mental', 'Physical'] : ['Technical', 'Mental', 'Physical'];
  const topRoles = Object.entries(p.roles).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const sims = similar(p);
  const inCmp = compare.includes(p);
  $('dossier').innerHTML = `
    <button class="ib close-d" data-act="close" aria-label="Close player" title="Close (Esc)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="d-head">
      <h1 class="d-name">${esc(p.name)}</h1>
      <div class="d-row">
        ${p.positions.map(k => `<span class="tag">${k}</span>`).join('')}
        ${p.age <= 21 && p.pa >= 150 ? '<span class="tag wk">Wonderkid</span>' : ''}
        ${p.club ? '' : '<span class="tag fa">Free agent</span>'}
      </div>
      <div class="d-facts">
        <div class="fact"><small>${p.onLoan ? 'On loan at' : 'Club'}</small><b>${esc(p.club || 'None')}</b>${p.onLoan ? `<span class="note">from ${esc(p.parentClub)} until ${fmtDate(p.loanEnds)}</span>` : p.parentClub ? `<span class="note">registered by ${esc(p.parentClub)}</span>` : ''}</div>
        <div class="fact"><small>Nationality</small><b>${esc(p.nation)}</b></div>
        <div class="fact"><small>Age</small><b>${p.age}</b> <span class="note">${fmtDate(p.dob)}</span></div>
        <div class="fact"><small>Release clause</small><b class="${p.releaseClause ? 'v-elite' : ''}">${money(p.releaseClause) || 'None'}</b></div>
        <div class="fact"><small>Value</small><b>${money(p.value) || '—'}</b></div>
        <div class="fact"><small>Asking price</small><b>${money(p.askingPrice) || 'Not listed'}</b></div>
        <div class="fact"><small>Last transfer fee</small><b>${money(p.lastFee) || '—'}</b></div>
        <div class="fact"><small>Wage</small><b>${p.wage ? money(p.wage) + '/w' : '—'}</b></div>
        <div class="fact"><small>Contract ends</small><b>${p.expiresDate ? fmtDate(p.expiresDate) : '—'}</b></div>
        <div class="fact"><small>Height</small><b>${p.height} cm</b></div>
        <div class="fact"><small>Left foot</small><b>${footWord(p.foot[0])}</b></div>
        <div class="fact"><small>Right foot</small><b>${footWord(p.foot[1])}</b></div>
      </div>
      <div class="d-actions">
        <button class="btn primary" data-act="copy" data-key="${esc(p.key)}">Copy name for FM</button>
        <button class="btn" data-act="star" data-key="${esc(p.key)}">${shortlist.has(p.key) ? 'On shortlist ★' : 'Add to shortlist'}</button>
        <button class="btn" data-act="cmp" data-key="${esc(p.key)}">${inCmp ? 'Remove from compare' : 'Compare'}</button>
      </div>
    </div>
    <div class="ability">
      <div class="ab"><span class="big ${v200(p.ca)}">${p.ca}</span><div><small>Current ability</small>${stars(p.ca)} ${delta(p.dCA)}</div></div>
      <div class="ab"><span class="big ${v200(p.pa)}">${p.pa}</span><div><small>Potential ability</small>${stars(p.pa)} ${delta(p.dPA)}</div></div>
    </div>
    <div class="sec viz">${radar([{ p, color: 'var(--flood)' }], p.isGK ? RADAR_GK : RADAR_OUT)}${pitch(p)}</div>
    <div class="sec"><h3>Attributes <small>dots mark key attributes for ${esc(UI.role || p.bestRole)}</small></h3>
      <div class="cols3">${groups.map(g => `<div>${ATTRS[g].map(al).join('')}</div>`).join('')}</div>
      ${p.isGK ? `<div class="cols3" style="margin-top:8px">${ATTRS.Technical.filter(k => ['Fir', 'Pas', 'Tec', 'Fre', 'Pen'].includes(k)).map(al).join('')}</div>` : ''}
    </div>
    <div class="sec"><h3>Transfer fee <small>${esc(feeWhy(p))}</small></h3>
      <div class="ab" style="margin-bottom:10px"><span class="big" style="font-size:40px">${estFee(p) === 0 ? 'Free' : money(estFee(p)) || '—'}</span><div><small>Estimated fee</small>${p.value ? `<span class="note">FM value ${money(p.value)}</span>` : ''}</div></div>
      <div class="note" style="margin-bottom:6px">Asked their agent? Record the fee they quoted (in £M) to sharpen every estimate.</div>
      <div class="quote"><input type="number" id="qLow" step="0.5" min="0" placeholder="from £M" value="${(quotes.find(x => x.key === p.key)?.low ?? '') && quotes.find(x => x.key === p.key).low / 1e6}">
        <input type="number" id="qHigh" step="0.5" min="0" placeholder="to £M" value="${(quotes.find(x => x.key === p.key)?.high ?? '') && quotes.find(x => x.key === p.key).high / 1e6}">
        <button class="btn" data-act="quote">Save quote</button>${quotes.some(x => x.key === p.key) ? '<button class="btn" data-act="unquote">Remove</button>' : ''}</div>
    </div>
    <div class="sec bars"><h3>Best roles</h3>${topRoles.map(([r, s]) => bar(r, s, 100, color20(s / 5))).join('')}</div>
    <div class="sec bars"><h3>Personality <small>hidden from the game</small></h3>
      ${PERS.map(k => bar(k, p.pers[k], 20, k === 'Controversy' ? color20(21 - p.pers[k]) : color20(p.pers[k]))).join('')}
      <div class="note">Values are read exactly; which name goes with which value is our best inference, so treat the labels with care.</div></div>
    <div class="sec bars"><h3>Hidden attributes <small>not shown in the game</small></h3>
      ${HIDDEN.map(k => bar(HIDDEN_NAME[k], Math.round(p.attrs[k]), 20, color20(LOW_GOOD.has(k) ? 21 - p.attrs[k] : p.attrs[k]))).join('')}
      <div class="note">For dirtiness and injury proneness, lower is better.</div></div>
    <div class="sec"><h3>Plays like</h3>
      ${sims.map(o => `<div class="al" style="cursor:pointer" data-goto="${esc(o.key)}"><span class="lbl">${esc(o.name)} <span class="note">${o.age} · ${esc(o.club || 'Free agent')}</span></span><span class="num ${v200(o.ca)}">${o.ca}</span><span class="num" style="margin-left:8px;color:var(--dim)">${o.pa}</span></div>`).join('')}
    </div>`;
  draw();
}
function closeDossier() { sel = null; $('main').classList.add('no-dossier'); draw(); }

// ---------------------------------------------------------------- compare
function renderCompare() {
  const el = $('compare');
  if (!compare.length) { el.classList.remove('show'); return; }
  el.classList.add('show');
  const gk = compare.every(p => p.isGK);
  const groups = gk ? ['Goalkeeping', 'Mental', 'Physical'] : ['Technical', 'Mental', 'Physical'];
  const rowsCmp = [['Age', p => p.age, -1], ['Current ability', p => p.ca, 1], ['Potential', p => p.pa, 1], ['Rating', rating, 1],
    ['Est. fee', p => estFee(p), -1, money], ['Release clause', p => p.releaseClause, -1, money], ['Value', p => p.value, -1, money], ['Asking price', p => p.askingPrice, -1, money], ['Wage', p => p.wage, -1, money], ['Height', p => p.height, 1]];
  const line = ([label, get, better, fmt]) => {
    const vals = compare.map(get);
    const ok = vals.filter(v => v != null);
    const best = ok.length > 1 ? (better > 0 ? Math.max(...ok) : Math.min(...ok)) : null;
    return `<tr><td>${esc(label)}</td>${vals.map(v => `<td class="${v === best ? 'best' : ''}">${v == null ? '—' : fmt ? fmt(v) : Math.round(v)}</td>`).join('')}</tr>`;
  };
  const attrRows = groups.flatMap(g => ATTRS[g].map(k => [k, p => p.attrs[k], 1]));
  el.innerHTML = `
    <div class="cmp-head"><b class="count">Compare</b>
      ${compare.map((p, i) => `<span class="pill"><span class="sw" style="background:${SERIES[i]}"></span>${esc(p.name)} <button class="ib" data-cmpdel="${i}" aria-label="Remove">✕</button></span>`).join('')}
      <span class="spacer"></span><button class="btn" data-act="cmpmin">${el.classList.contains('mini') ? 'Expand' : 'Minimise'}</button><button class="btn" data-act="cmpclear">Clear</button></div>
    <div class="cmp-body"><div>${radar(compare.map((p, i) => ({ p, color: SERIES[i] })), gk ? RADAR_GK : RADAR_OUT, 280)}</div>
      <table class="cmp-table"><thead><tr><th></th>${compare.map((p, i) => `<th style="color:${SERIES[i]}">${esc(p.last)}</th>`).join('')}</tr></thead>
      <tbody>${rowsCmp.map(line).join('')}${attrRows.map(line).join('')}</tbody></table></div>`;
}
function toggleCompare(p) {
  const i = compare.indexOf(p);
  if (i >= 0) compare.splice(i, 1);
  else { if (compare.length >= 4) compare.shift(); compare.push(p); }
  $('compare').classList.remove('mini');
  renderCompare();
  if (sel) showDossier(sel);
}

// ---------------------------------------------------------------- actions
let toastT;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 1800);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
}
function copyName(p) {
  const text = UI.copyAs === 'last' ? p.last : p.name;
  copyText(text);
  toast(`Copied “${text}” — paste it into FM's search`);
}
function toggleStar(p) {
  if (shortlist.has(p.key)) { shortlist.delete(p.key); toast(`Removed ${p.name} from your shortlist`); }
  else { shortlist.add(p.key); toast(`Added ${p.name} to your shortlist`); }
  store.set('shortlist', [...shortlist]);
  if (UI.preset === 'shortlist') update(true); else draw();
  if (UI.mode === 'club') renderClub();
  if (UI.mode === 'disc') renderDisc();
  if (sel === p) showDossier(p);
  renderRail();
}
function exportCsv() {
  const cs = cols.filter(c => c.label);
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const val = (c, p) => c.k === 'name' ? p.name : c.k === 'pos' ? p.positions.join(' ') : c.k === 'role' ? roleName(p) : c.k === 'feet' ? `${footWord(p.foot[0])}/${footWord(p.foot[1])}` : c.k.startsWith('a:') ? Math.round(c.get(p)) : c.get(p);
  const csv = [cs.map(c => cell(c.title || c.label)).join(','), ...rows.map(p => cs.map(c => cell(val(c, p))).join(','))].join('\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `supa-scout-${UI.preset}-${D?.date || 'export'}.csv` });
  a.click();
  toast(`Exported ${rows.length.toLocaleString()} players`);
}
const byKey = k => all.find(p => p.key === k);

// ---------------------------------------------------------------- scanning + status
async function scan(rescan) {
  const btn = $('scanBtn');
  btn.disabled = true;
  btn.textContent = 'Scanning…';
  $('count').textContent = 'Reading every player from FM27…';
  try {
    const r = await fetch('/api/players' + (rescan ? '?rescan=1' : ''));
    const res = await r.json();
    if (res.loading) {
      showBanner('FM27 is still loading this save. Trying again in a few seconds…', '', null);
      $('count').textContent = 'Waiting for FM27 to finish loading…';
      setTimeout(() => scan(true), 6000);
      return;
    }
    if (res.error) throw new Error(res.error);
    D = res;
    all = prep(res);
    valueFit = null;
    lastStatusDate = res.date;
    const selKey = sel?.key;
    sel = selKey ? byKey(selKey) : null;
    compare = compare.map(p => byKey(p.key)).filter(Boolean);
    $('gameDate').innerHTML = `<b>${fmtDate(res.date)}</b>`;
    hideBanner();
    if (res.issues?.length) showBanner(`Some data looks wrong: ${res.issues.join('; ')}. If FM27 was just updated, try Recalibrate in settings.`, 'bad', 'Open settings', openSettings);
    if (res.recalibrated) toast('FM27 was updated: memory layout re-learned automatically');
    renderRail();
    update();
    if (sel) showDossier(sel);
    renderCompare();
    if (UI.mode === 'club') renderClub();
    if (UI.mode === 'disc') renderDisc();
    if (res.warnings?.length && !res.issues?.length) showBanner(res.warnings.join('. '), '', null);
  } catch (e) {
    $('count').textContent = 'Scan failed';
    showBanner(e.message.includes('not running') ? 'FM27 isn’t running. Start the game and load your save, then scan again.' : `Scan failed: ${e.message}`, 'bad', 'Try again', () => scan(true));
  } finally {
    btn.disabled = false;
    btn.textContent = all.length ? 'Rescan' : 'Scan game';
  }
}
async function poll() {
  let s;
  try { s = await (await fetch('/api/status')).json(); } catch { s = { running: false, error: 'Supa Scout server is not running' }; }
  const live = $('live');
  live.className = 'pill ' + (s.running ? 'on' : 'off');
  live.querySelector('span').textContent = s.running ? 'FM27 running' : 'FM27 not running';
  live.title = s.error || '';
  if (!s.running) return;
  if (!all.length && !$('scanBtn').disabled) return scan(false);
  if (all.length && s.saveChanged && !$('scanBtn').disabled) { toast('A different save is loaded: rescanning'); return scan(true); }
  if (s.dllChanged) return showBanner('FM27 has been updated. The next scan re-learns where the game keeps player data (about a minute).', '', 'Scan now', () => scan(true));
  if (all.length && s.date && s.date !== lastStatusDate && !$('scanBtn').disabled) {
    if (UI.auto) { toast(`Game moved on to ${fmtDate(s.date)}: rescanning`); scan(true); }
    else showBanner(`The game has moved on to ${fmtDate(s.date)}. Rescan to see updated abilities and contracts.`, '', 'Rescan', () => scan(true));
  }
}
function showBanner(msg, kind, action, fn) {
  const b = $('banner');
  b.className = `banner show ${kind || ''}`;
  b.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="btn" id="bannerBtn">${esc(action)}</button>` : ''}<span class="spacer"></span><button class="ib" id="bannerX" aria-label="Dismiss">✕</button>`;
  if (action) $('bannerBtn').onclick = () => { hideBanner(); fn(); };
  $('bannerX').onclick = hideBanner;
}
function hideBanner() { $('banner').className = 'banner'; }

// all dark, on purpose: [id, name, swatches(background, accent, good)]
const THEMES = [
  ['', 'Floodlit', ['#0e2418', '#ffc24b', '#8fb98a']],
  ['midnight', 'Midnight', ['#0b1322', '#5cc8ff', '#7fd1a8']],
  ['claret', 'Claret and blue', ['#1b0c13', '#8fd3ff', '#e7c27d']],
  ['awaykit', 'Away kit', ['#150f22', '#6ee7c8', '#b6a4ff']],
  ['ultras', 'Ultras', ['#141210', '#ff7a2f', '#e8c468']],
  ['teletext', 'Teletext', ['#000000', '#ffff00', '#00e5ff']],
];
function setTheme(id) {
  document.documentElement.dataset.theme = id;
  store.set('theme', id);
  document.querySelectorAll('[data-theme-id]').forEach(b => b.classList.toggle('on', b.dataset.themeId === id));
}

function openSettings() {
  const el = $('settings');
  el.classList.toggle('show');
  if (!el.classList.contains('show')) return;
  el.innerHTML = `
    <h3>Theme</h3>
    <div class="themes">${THEMES.map(([id, name, sw]) => `<button class="theme ${(document.documentElement.dataset.theme || '') === id ? 'on' : ''}" data-theme-id="${id}" style="background:${sw[0]}"><span class="sw3">${sw.map(c => `<i style="background:${c}"></i>`).join('')}</span><span style="color:#fff">${name}</span></button>`).join('')}</div>
    <h3>Settings</h3>
    <label class="check"><input type="checkbox" id="setAuto" ${UI.auto ? 'checked' : ''}> Rescan automatically when the game date changes</label>
    <label class="field">Copy button copies
      <select id="setCopy"><option value="full" ${UI.copyAs === 'full' ? 'selected' : ''}>Full name</option><option value="last" ${UI.copyAs === 'last' ? 'selected' : ''}>Surname only</option></select></label>
    <h3 style="margin-top:14px">Game updates</h3>
    <p class="note" style="font-size:13px">After an FM27 patch, Supa Scout re-learns where the game keeps player data on the next scan. If numbers ever look wrong, force it here (takes up to a minute, the game must be running with a save loaded).</p>
    <button class="btn" id="recalBtn">Recalibrate now</button>
    <p class="note">Game build ${esc(D?.build || 'unknown')} · ${D ? `${D.players.length.toLocaleString()} players read in ${D.secs}s` : 'not scanned yet'}</p>
    <h3 style="margin-top:14px">Keyboard</h3>
    <div class="help"><kbd>/</kbd><span>Search</span><kbd>↑ ↓</kbd><span>Move through players</span><kbd>C</kbd><span>Copy name</span><kbd>S</kbd><span>Shortlist</span><kbd>X</kbd><span>Add to compare</span><kbd>Esc</kbd><span>Close panel</span></div>
    <h3 style="margin-top:14px">Activity</h3><pre id="logPre">${esc((D?.log || []).join('\n') || 'Nothing yet.')}</pre>`;
  el.querySelectorAll('[data-theme-id]').forEach(b => { b.onclick = () => setTheme(b.dataset.themeId); });
  $('setAuto').onchange = e => { UI.auto = e.target.checked; store.set('auto', UI.auto); };
  $('setCopy').onchange = e => { UI.copyAs = e.target.value; store.set('copyAs', UI.copyAs); };
  $('recalBtn').onclick = async e => {
    e.target.disabled = true; e.target.textContent = 'Recalibrating…';
    try {
      const r = await (await fetch('/api/recalibrate', { method: 'POST' })).json();
      if (r.error) throw new Error(r.error);
      $('logPre').textContent = r.log.join('\n');
      toast(r.changes.length ? `Layout updated (${r.changes.length} changes)` : 'Layout confirmed: nothing changed');
      scan(true);
    } catch (err) { $('logPre').textContent = String(err.message); }
    e.target.disabled = false; e.target.textContent = 'Recalibrate now';
  };
}

// ---------------------------------------------------------------- events
function wire() {
  $('tabs').innerHTML = Object.entries(VIEWS).map(([k, v]) => `<button data-view="${k}" class="${UI.view === k ? 'on' : ''}">${v.label}</button>`).join('');
  $('role').innerHTML = '<option value="">Best role</option>' + ROLE_DEFS.map(([n]) => `<option ${UI.role === n ? 'selected' : ''}>${esc(n)}</option>`).join('');
  $('main').classList.add('no-dossier');

  $('scanBtn').onclick = () => scan(all.length > 0);
  wireDisc();
  $('count').addEventListener('click', e => { if (e.target.closest('[data-cleardisc]')) { F.discover = ''; UI.sort = ['rating', -1]; update(); } });
  $('mode').onclick = e => { const m = e.target.closest('[data-mode]')?.dataset.mode; if (m) setMode(m); };
  $('clubPage').addEventListener('click', e => {
    const tabBtn = e.target.closest('[data-ctab]');
    if (tabBtn) { UI.clubTab = tabBtn.dataset.ctab; store.set('clubTab', UI.clubTab); return renderClub(); }
    const th = e.target.closest('[data-csort]');
    if (th) {
      const [id, k] = th.dataset.csort.split('|');
      const cur = UI.clubSort[id];
      UI.clubSort[id] = [k, cur && cur[0] === k ? -cur[1] : (['name', 'pos', 'nation', 'exp', 'extra'].includes(k) ? 1 : -1)];
      store.set('clubSort', UI.clubSort);
      return renderClub();
    }
    const act = e.target.closest('[data-act]');
    const go = e.target.closest('[data-goto]');
    const p = act ? byKey(act.dataset.key) : go ? byKey(go.dataset.goto) : null;
    if (!p) return;
    if (act?.dataset.act === 'copy') return copyName(p);
    if (act?.dataset.act === 'star') return toggleStar(p);
    showDossier(p);
    renderClub();
  });
  $('clubPage').addEventListener('change', e => {
    if (e.target.id !== 'clubPick') return;
    store.set('myClub', e.target.value ? JSON.parse(e.target.value) : null);
    renderClub();
  });
  $('rail').addEventListener('toggle', e => {
    const d = e.target.closest?.('details[data-sec]');
    if (!d) return;
    const closed = new Set(store.get('railClosed', []));
    if (d.open) closed.delete(d.dataset.sec); else closed.add(d.dataset.sec);
    store.set('railClosed', [...closed]);
  }, true);
  $('settingsBtn').onclick = openSettings;
  $('exportBtn').onclick = exportCsv;
  $('q').addEventListener('input', e => { F.q = e.target.value; update(); if (UI.mode === 'club') renderClub(); });
  $('role').onchange = e => { UI.role = e.target.value; store.set('role', UI.role); UI.sort = ['rating', -1]; update(); if (sel) showDossier(sel); };
  $('tabs').onclick = e => {
    const v = e.target.dataset.view;
    if (!v) return;
    UI.view = v; store.set('view', v);
    $('tabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    renderGrid(true);
  };

  let raf = 0;
  $('grid').addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); });
  $('grid').addEventListener('click', e => {
    const th = e.target.closest('[data-sort]');
    if (th && th.dataset.sort) {
      const k = th.dataset.sort;
      UI.sort = [k, UI.sort[0] === k ? -UI.sort[1] : (['name', 'club', 'nation', 'pos', 'exp', 'expd'].includes(k) ? 1 : -1)];
      return update(true);
    }
    const act = e.target.closest('[data-act]');
    const tr = e.target.closest('.tr');
    if (!tr) return;
    const p = rows[+tr.dataset.i];
    if (act?.dataset.act === 'copy') return copyName(p);
    if (act?.dataset.act === 'star') return toggleStar(p);
    showDossier(p);
  });
  $('grid').addEventListener('dblclick', e => { const tr = e.target.closest('.tr'); if (tr) copyName(rows[+tr.dataset.i]); });

  $('dossier').addEventListener('click', e => {
    const go = e.target.closest('[data-goto]');
    if (go) return showDossier(byKey(go.dataset.goto));
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'close') closeDossier();
    if (a === 'copy') copyName(sel);
    if (a === 'star') toggleStar(sel);
    if (a === 'cmp') toggleCompare(sel);
    if (a === 'quote' || a === 'unquote') {
      saveQuote(sel, a === 'quote' ? num($('qLow').value) : 0, num($('qHigh').value));
      toast(a === 'quote' ? `Saved quote for ${sel.name}: estimates now use ${feeModel().n} quote${feeModel().n > 1 ? 's' : ''}` : 'Quote removed');
      showDossier(sel); update(true); renderRail();
    }
  });
  $('compare').addEventListener('click', e => {
    const d = e.target.closest('[data-cmpdel]');
    if (d) { compare.splice(+d.dataset.cmpdel, 1); renderCompare(); return; }
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'cmpclear') { compare = []; renderCompare(); if (sel) showDossier(sel); }
    if (a === 'cmpmin') { $('compare').classList.toggle('mini'); renderCompare(); }
  });

  const rail = $('rail');
  rail.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.preset) return applyPreset(t.dataset.preset);
    if (t.dataset.gender !== undefined) { UI.gender = t.dataset.gender; store.set('gender', UI.gender); renderRail(); return update(); }
    if (t.dataset.pos) { F.pos = F.pos.includes(t.dataset.pos) ? F.pos.filter(x => x !== t.dataset.pos) : [...F.pos, t.dataset.pos]; t.classList.toggle('on'); return update(); }
    if (t.id === 'addAttr') { F.attrs.push({ k: '', min: 15 }); return renderRail(); }
    if (t.dataset.afdel) { F.attrs.splice(+t.dataset.afdel, 1); renderRail(); return update(); }
    if (t.id === 'resetAll') { F = { ...F0(), q: F.q }; UI.preset = 'all'; renderRail(); return update(); }
    if (t.id === 'saveSearch') {
      const name = $('saveName').value.trim() || `Search ${store.get('saved', []).length + 1}`;
      store.set('saved', [...store.get('saved', []), { name, F, sort: UI.sort, preset: UI.preset, role: UI.role, view: UI.view }]);
      toast(`Saved “${name}”`);
      return renderRail();
    }
    if (t.dataset.load) {
      const s = store.get('saved', [])[+t.dataset.load];
      F = { ...F0(), ...s.F }; UI.sort = s.sort; UI.preset = s.preset || 'all'; UI.role = s.role || ''; $('role').value = UI.role;
      renderRail(); return update();
    }
    if (t.dataset.delsaved) { const s = store.get('saved', []); s.splice(+t.dataset.delsaved, 1); store.set('saved', s); renderRail(); }
  });
  rail.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.f) F[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? num(t.value) : t.value;
    else if (t.dataset.af) { const a = F.attrs[+t.dataset.af]; a[t.dataset.afk] = t.dataset.afk === 'min' ? num(t.value) : t.value; }
    else return;
    update();
  });

  document.addEventListener('keydown', e => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); $('q').focus(); $('q').select(); return; }
    if (e.key === 'Escape') {
      if (typing) return document.activeElement.blur();
      if ($('settings').classList.contains('show')) return $('settings').classList.remove('show');
      return closeDossier();
    }
    if (typing && !(e.key === 'Enter' && document.activeElement === $('q'))) return;
    if (e.key === 'Enter') { $('grid').focus(); if (rows.length && !sel) showDossier(rows[0]); return; }
    if (!rows.length) return;
    const i = sel ? rows.indexOf(sel) : -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const j = Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      showDossier(rows[j]);
      const grid = $('grid'), y = j * ROW + 36;
      if (y < grid.scrollTop + 36) grid.scrollTop = y - 36; else if (y + ROW > grid.scrollTop + grid.clientHeight) grid.scrollTop = y + ROW - grid.clientHeight;
      return;
    }
    if (!sel) return;
    const k = e.key.toLowerCase();
    if (k === 'c' && !e.ctrlKey && !e.metaKey) copyName(sel);
    if (k === 's') toggleStar(sel);
    if (k === 'x') toggleCompare(sel);
  });
  document.addEventListener('click', e => {
    const s = $('settings');
    if (s.classList.contains('show') && !s.contains(e.target) && !e.target.closest('#settingsBtn')) s.classList.remove('show');
  });
}


// ---------------------------------------------------------------- my club
let clubMemo = null;
function myClub() {
  if (!D) return null;
  const want = store.get('myClub', null); // {name, female} chosen by hand; null = detected from the save
  const key = JSON.stringify(want) + D.at;
  if (clubMemo?.key === key) return clubMemo.v;
  let v = D.myClubs[0] ? { ...D.myClubs[0], detected: true } : null;
  if (want) {
    const p = all.find(x => x.club === want.name && x.female === want.female && !x.onLoan);
    if (p) v = { id: p.clubId, name: want.name, teamId: D.myClubs.find(m => m.id === p.clubId)?.teamId, detected: D.myClubs.some(m => m.id === p.clubId) };
  }
  clubMemo = { key, v };
  return v;
}
const isMine = p => { const c = myClub(); return !!c && (p.clubId === c.id || p.parentClubId === c.id); };
function posBest(p, pos) {
  let b = 0, role = '';
  for (const [n] of ROLE_DEFS) if (ROLE_POS[n].split(' ').includes(pos) && p.roles[n] > b) { b = p.roles[n]; role = n; }
  return [b, role];
}
const DEPTH = ['GK', 'DL', 'DC', 'DR', 'DM', 'ML', 'MC', 'MR', 'AML', 'AMC', 'AMR', 'ST'];
const TWO = new Set(['DC', 'MC']); // positions that usually need two starters
UI.clubTab = store.get('clubTab', 'overview');
UI.clubSort = store.get('clubSort', {});

// sortable columns for club tables: [key, label, sort getter, cell html, numeric?]
const CCOLS = [
  ['name', 'Name', p => p.last.toLowerCase(), p => `${esc(p.name)}${tags(p)}`],
  ['age', 'Age', p => p.age, p => p.age, true],
  ['pos', 'Position', p => POS_ORDER.indexOf(p.positions[0]), p => esc(p.positions.join(' '))],
  ['nation', 'Nation', p => p.nation, p => esc(p.nationCode || p.nation)],
  ['ca', 'CA', p => p.ca, p => `<span class="num ${v200(p.ca)}">${p.ca}</span>`, true],
  ['pa', 'PA', p => p.pa, p => `<span class="num ${v200(p.pa)}">${p.pa}</span>`, true],
  ['dca', 'Since', p => p.dCA ?? -999, p => delta(p.dCA), true],
  ['role', 'Best role', p => p.best, p => `${esc(p.bestRole)} <span class="num ${v100(p.best)}">${p.best}</span>`],
  ['value', 'Value', p => p.value ?? -1, p => money(p.value), true],
  ['asking', 'Asking', p => p.askingPrice ?? -1, p => money(p.askingPrice), true],
  ['est', 'Est. fee', p => estFee(p) ?? -1, p => `<span title="${esc(feeWhy(p))}">${money(estFee(p))}</span>`, true],
  ['release', 'Release', p => p.releaseClause ?? -1, p => p.releaseClause ? `<b class="v-elite">${money(p.releaseClause)}</b>` : '', true],
  ['wage', 'Wage', p => p.wage ?? -1, p => p.wage ? money(p.wage) + '<span class="sub">/w</span>' : '', true],
  ['exp', 'Contract ends', p => p.expiresDate || '9', p => p.expiresDate ? (p.expires <= gameYear + 1 ? `<b class="v-elite">${fmtDate(p.expiresDate)}</b>` : fmtDate(p.expiresDate)) : '', true],
];

// id: remembers this table's sort; extra: [label, html(p), sortGetter(p)]
function miniTable(id, list, { extra, empty = 'Nobody here.', sort = ['ca', -1] } = {}) {
  const q = fold(F.q).trim().split(/\s+/).filter(Boolean);
  if (q.length) list = list.filter(p => q.every(w => p.hay.includes(w)));
  if (!list.length) return `<p class="note">${q.length ? 'Nobody matches your search.' : empty}</p>`;
  const cols = extra ? [...CCOLS, ['extra', extra[0], extra[2] || (() => 0), extra[1]]] : CCOLS;
  const [sk, sd] = UI.clubSort[id] || sort;
  const get = (cols.find(c => c[0] === sk) || cols[4])[2];
  list = [...list].sort((a, b) => { const x = get(a), y = get(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sd || b.ca - a.ca; });
  return `<table class="mini"><thead><tr><th></th>${cols.map(([k, label, , , n]) =>
    `<th class="${n ? 'n' : ''} ${k === sk ? 'on' : ''}" data-csort="${id}|${k}">${esc(label)}${k === sk ? (sd < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr></thead><tbody>` +
    list.map(p => `<tr data-goto="${esc(p.key)}" class="${p === sel ? 'sel' : ''}"><td class="acts">${iconBtn('star', p, shortlist.has(p.key))}${iconBtn('copy', p)}</td>` +
      cols.map(([k, , , html, n]) => `<td class="${n ? 'n' : ''} ${k === 'name' ? 'name' : ''}">${html(p)}</td>`).join('') + '</tr>').join('') +
    `</tbody></table><p class="note">${list.length} players</p>`;
}

function clubData(c) {
  const owned = all.filter(p => (p.clubId === c.id && !p.onLoan) || p.parentClubId === c.id);
  const first = owned.filter(p => p.clubId === c.id && (!c.teamId || p.teamId === c.teamId));
  const loanedIn = all.filter(p => p.clubId === c.id && p.onLoan);
  const squad = [...first, ...loanedIn];
  return {
    owned, first, loanedIn, squad,
    reserves: owned.filter(p => p.clubId === c.id && c.teamId && p.teamId !== c.teamId),
    loanedOut: owned.filter(p => p.parentClubId === c.id && p.onLoan),
    affiliates: owned.filter(p => p.parentClubId === c.id && !p.onLoan),
    youth: owned.filter(p => p.age <= 21),
    ending: owned.filter(p => p.expires && p.expires <= gameYear + 1),
    female: squad.filter(p => p.female).length * 2 > squad.length,
  };
}

function overviewTab(c, d) {
  const depth = {};
  for (const pos of DEPTH) {
    depth[pos] = d.squad.filter(p => p.posR[pos] >= 15).map(p => ({ p, r: posBest(p, pos) }))
      .sort((a, b) => b.r[0] - a.r[0]).slice(0, TWO.has(pos) ? 4 : 3);
  }
  const strength = pos => depth[pos][TWO.has(pos) ? 1 : 0]?.r[0] ?? 0;
  const weak = [...DEPTH].sort((a, b) => strength(a) - strength(b)).slice(0, 3);
  const pool = all.filter(p => p.female === d.female && !isMine(p) && p.age <= 30);
  const targets = pos => {
    const bar = strength(pos);
    return pool.filter(p => p.posR[pos] >= 15).map(p => ({ p, r: posBest(p, pos)[0] })).filter(x => x.r >= bar + 3)
      .sort((a, b) => b.r - a.r || a.p.age - b.p.age).slice(0, 6);
  };
  const card = pos => `<div class="slot" style="grid-area:${pos}">
      <b>${pos}</b>${depth[pos].map(({ p, r }, i) => `<button class="dp ${i >= (TWO.has(pos) ? 2 : 1) ? 'alt' : ''}" data-goto="${esc(p.key)}" title="${esc(p.name)}: ${esc(r[1])}"><span>${esc(p.last)}</span><span class="num ${v100(r[0])}">${r[0]}</span></button>`).join('') || '<span class="none">Nobody</span>'}</div>`;
  return `<div class="club-grid">
      <section class="panel"><h2>Depth chart <small>best role rating at each position</small></h2>
        <div class="depth">${DEPTH.map(card).join('')}</div></section>
      <section class="panel"><h2>Where to strengthen <small>weakest positions, with better players aged 30 or under</small></h2>
        ${weak.map(pos => {
          const t = targets(pos), cur = depth[pos][TWO.has(pos) ? 1 : 0];
          return `<div class="weak"><h3><span class="tag">${pos}</span> ${cur ? `${esc(cur.p.name)} rates ${cur.r[0]}` : 'No natural player'}</h3>
            ${t.length ? t.map(({ p, r }) => `<div class="al tgt" data-goto="${esc(p.key)}"><span class="lbl">${esc(p.name)} <span class="note">${p.age}, ${esc(p.club || 'free agent')}${p.onLoan ? ' (on loan)' : ''}</span></span>
              <span class="note" title="${esc(feeWhy(p))}">${estFee(p) ? 'about ' + money(estFee(p)) : ''} ${p.expires ? 'to ' + p.expires : ''}</span><span class="num ${v100(r)}" style="margin-left:10px">${r}</span><span class="up" style="margin-left:6px">+${r - strength(pos)}</span></div>`).join('')
              : '<p class="note">No clear upgrade aged 30 or under.</p>'}</div>`;
        }).join('')}
      </section></div>`;
}

function renderClub() {
  const el = $('clubPage');
  if (!D) { el.innerHTML = '<div class="empty"><h3>Scan your save first</h3><p>Your club appears here once the game has been read.</p></div>'; return; }
  const c = myClub();
  const clubs = [...new Map(all.filter(p => p.club && !p.onLoan).map(p => [`${p.club}|${p.female}`, { name: p.club, female: p.female }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  const picker = `<select id="clubPick" aria-label="Club to show">
      ${D.myClubs.map(m => `<option value="">${esc(m.name)} (your club)</option>`).join('') || '<option value="">Choose your club</option>'}
      ${clubs.map(x => `<option value="${esc(JSON.stringify(x))}" ${c && !c.detected && c.name === x.name ? 'selected' : ''}>${esc(x.name)}${x.female ? ' (women)' : ''}</option>`).join('')}</select>`;
  if (!c) { el.innerHTML = `<div class="club-head"><h1 class="club-name">My club</h1>${picker}</div><p class="note">We couldn’t tell which club you manage. Pick it above.</p>`; return; }

  const d = clubData(c);
  const avg = (xs, f) => xs.length ? xs.reduce((t, p) => t + f(p), 0) / xs.length : 0;
  const wageBill = d.owned.reduce((t, p) => t + (p.wage || 0), 0);
  const top18 = [...d.squad].sort((a, b) => b.ca - a.ca).slice(0, 18);
  const kpi = (label, val, sub) => `<div class="kpi"><b>${val}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const loanEnd = p => p.loanEnds || '9';
  const TABS = [
    ['overview', 'Overview', ''],
    ['squad', 'First team', d.squad.length],
    ['loans', 'Loans', d.loanedOut.length + d.loanedIn.length],
    ['contracts', 'Contracts', d.owned.length],
    ['youth', 'Youth and reserves', d.youth.length + d.reserves.length],
    ...(d.affiliates.length ? [['affiliates', 'B teams', d.affiliates.length]] : []),
  ];
  const tab = TABS.some(t => t[0] === UI.clubTab) ? UI.clubTab : 'overview';
  const body = {
    overview: () => overviewTab(c, d),
    squad: () => `<section class="panel">${miniTable('first', d.first, { sort: ['pos', 1], empty: 'No players found.' })}</section>
      ${d.loanedIn.length ? `<section class="panel"><h2>On loan here</h2>${miniTable('in1', d.loanedIn, { extra: ['From', p => `${esc(p.parentClub)} <span class="note">until ${fmtDate(p.loanEnds)}</span>`, loanEnd] })}</section>` : ''}`,
    loans: () => `<section class="panel"><h2>Out on loan <small>${d.loanedOut.length}</small></h2>${miniTable('out', d.loanedOut, { extra: ['Playing for', p => `${esc(p.club)} <span class="note">until ${fmtDate(p.loanEnds)}</span>`, p => p.club], empty: 'Nobody is out on loan.' })}</section>
      <section class="panel"><h2>Loaned in <small>${d.loanedIn.length}</small></h2>${miniTable('in', d.loanedIn, { extra: ['From', p => `${esc(p.parentClub)} <span class="note">until ${fmtDate(p.loanEnds)}</span>`, loanEnd], empty: 'Nobody is on loan at the club.' })}</section>`,
    contracts: () => `<section class="panel"><h2>Every contracted player <small>${d.ending.length} end by summer ${gameYear + 1}, highlighted</small></h2>${miniTable('contracts', d.owned, { sort: ['exp', 1], extra: ['Where', p => esc(p.onLoan && p.clubId !== c.id ? `On loan at ${p.club}` : p.clubId === c.id ? (p.teamId === c.teamId ? 'First team' : 'Reserves or youth') : p.club), p => p.club] })}</section>`,
    youth: () => `<section class="panel"><h2>21 and under <small>everyone on the books, wherever they play</small></h2>${miniTable('youth', d.youth, { sort: ['pa', -1], extra: ['Where', p => esc(p.onLoan && p.clubId !== c.id ? `On loan at ${p.club}` : p.clubId === c.id ? (p.teamId === c.teamId ? 'First team' : 'Reserves or youth') : p.club), p => p.club], empty: 'No young players on the books.' })}</section>
      <section class="panel"><h2>Reserves and youth teams <small>${d.reserves.length}</small></h2>${miniTable('reserves', d.reserves, { empty: 'No reserve players.' })}</section>`,
    affiliates: () => `<section class="panel"><h2>Registered at B teams and affiliates</h2>${miniTable('aff', d.affiliates, { extra: ['Registered at', p => esc(p.club), p => p.club] })}</section>`,
  }[tab]();

  el.innerHTML = `
    <div class="club-head">
      <h1 class="club-name">${esc(c.name)}${d.female ? ' <span class="tag">Women</span>' : ''}</h1>
      ${picker}
      <span class="note">${c.detected ? 'Detected from your save' : 'Chosen by you'}, ${fmtDate(D.date)}</span>
    </div>
    <div class="kpis">
      ${kpi('First team', d.squad.length, d.loanedIn.length ? `including ${d.loanedIn.length} on loan` : '')}
      ${kpi('Average age', avg(d.squad, p => p.age).toFixed(1))}
      ${kpi('Best 18 average CA', Math.round(avg(top18, p => p.ca)))}
      ${kpi('Wage bill', money(wageBill) + '/w', `${money(wageBill * 52)} a year, all contracted players`)}
      ${kpi('Out on loan', d.loanedOut.length)}
      ${kpi('Contracts ending', d.ending.length, `by summer ${gameYear + 1}`)}
    </div>
    <div class="tabs club-tabs" role="tablist">${TABS.map(([k, label, n]) => `<button role="tab" data-ctab="${k}" class="${k === tab ? 'on' : ''}" aria-selected="${k === tab}">${label}${n !== '' ? ` <span class="cnt">${n}</span>` : ''}</button>`).join('')}</div>
    ${body}`;
}

function setMode(m) {
  UI.mode = m;
  store.set('mode', m);
  $('main').classList.toggle('club-mode', m === 'club');
  $('main').classList.toggle('disc-mode', m === 'disc');
  document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  if (m === 'club') renderClub(); else if (m === 'disc') renderDisc(); else draw();
}

wire();
renderRail();
setMode(store.get('mode', 'scout'));
poll();
setInterval(poll, 15000);
