'use strict';
// Discover: curated outlier lists ("cards"). Loaded before app.js; only touches app.js globals at call time.
// Card: id, title, why(v), params {key: [label, default, step]}, test(p, v), score(p, v), note(p).
// v(key) returns the user's tuned value for that card (stored in localStorage), else the default.

// ---- value model: what FM usually values a player like this at -------------------------------
// Median value of look-alikes (same gender, similar CA / PA / age). Fine buckets first, coarser if a
// bucket has fewer than 8 players. Can't extrapolate past real data (a log-linear fit did, e.g. £2bn Mbappé).
let valueFit = null;
const VBUCKETS = [p => `${+p.female}|${p.ca / 5 | 0}|${p.pa / 10 | 0}|${p.age / 2 | 0}`, p => `${+p.female}|${p.ca / 10 | 0}|${p.pa / 20 | 0}|${p.age / 4 | 0}`];
function fitValueModel() {
  const groups = VBUCKETS.map(() => ({}));
  for (const p of all) {
    if (!(p.value > 10000) || !p.club) continue;
    VBUCKETS.forEach((key, i) => (groups[i][key(p)] ||= []).push(p.value));
  }
  const med = groups.map(g => Object.fromEntries(Object.entries(g).filter(([, v]) => v.length >= 8)
    .map(([k, v]) => [k, v.sort((a, b) => a - b)[v.length >> 1]])));
  valueFit = { expected: p => { for (let i = 0; i < VBUCKETS.length; i++) { const m = med[i][VBUCKETS[i](p)]; if (m) return m; } return null; } };
  // per club: squad rank by CA (1 = best) and squad strength (median CA of top 18)
  const byClub = {};
  for (const p of all) if (p.clubId && !p.onLoan) (byClub[p.clubId] ||= []).push(p);
  for (const list of Object.values(byClub)) {
    list.sort((a, b) => b.ca - a.ca).forEach((p, i) => { p.clubRank = i + 1; });
    const top = list.slice(0, 18), strength = top[top.length >> 1]?.ca ?? 0;
    for (const p of list) p.clubStrength = strength;
  }
}
const cheapness = p => p.value > 0 && valueFit ? (valueFit.expected(p) ?? 0) / p.value : 0; // 3 = valued at a third of similar players
const feeStr = p => { const f = estFee(p); return f === 0 ? 'free' : f ? money(f) : 'fee unknown'; };
const A = (p, k) => p.attrs[k];
// ponytail: name-based. FM stores big clubs' B/C/U-teams as separate small clubs (e.g. "R. Madrid C").
const RESERVE_SIDE = /\s(B|C|II|III|U\d\d|Reserves?|Youth|Juvenil A)$/i;

const DISC = [
  { id: 'undervalued', title: 'Undervalued', params: { age: ['Max age', 28, 1], ratio: ['Valued at least … × below peers', 2, 0.5] },
    why: v => `${v('age')} or under and valued at 1/${v('ratio')} or less of what similar players (ability, potential, age) go for`,
    test: (p, v) => p.value >= 1e5 && p.age <= v('age') && p.club && (p.ca >= 110 || p.pa >= 150) && cheapness(p) >= v('ratio'), score: cheapness,
    note: p => `${money(p.value)} vs ~${money(valueFit.expected(p))}` },
  { id: 'cheapwk', title: 'Cheap wonderkids', params: { age: ['Max age', 20, 1], pa: ['Min PA', 150, 5] },
    why: v => `${v('age')} or under with ${v('pa')}+ potential, cheapest first`,
    test: (p, v) => p.age <= v('age') && p.pa >= v('pa') && estFee(p) != null, score: p => p.pa - 18 * Math.log10(Math.max(estFee(p), 1e5)),
    note: p => `PA ${p.pa}, ${feeStr(p)}` },
  { id: 'readynow', title: 'Ready now, cheap', params: { ca: ['Min CA', 150, 5], fee: ['Max fee £M', 20, 5] },
    why: v => `Established quality (CA ${v('ca')}+) for £${v('fee')}M or less`,
    test: (p, v) => p.ca >= v('ca') && estFee(p) != null && estFee(p) <= v('fee') * 1e6, score: p => p.ca - Math.log10(Math.max(estFee(p), 1e5)),
    note: p => `CA ${p.ca}, ${feeStr(p)}` },
  { id: 'expiring', title: 'Running down their contract', params: { ca: ['Min CA', 130, 5] },
    why: v => `CA ${v('ca')}+ with a contract ending this season: cheap now, free next summer`,
    test: (p, v) => p.club && p.ca >= v('ca') && p.expires && p.expires <= gameYear + 1, score: p => p.ca,
    note: p => `ends ${fmtDate(p.expiresDate)}` },
  { id: 'free', title: 'Best free agents', params: { ca: ['Min CA', 90, 5], age: ['Max age', 40, 1] },
    why: v => `No club, no fee, just wages. CA ${v('ca')}+, ${v('age')} or under`,
    test: (p, v) => !p.club && p.ca >= v('ca') && p.age <= v('age'), score: p => p.ca + p.pa / 4,
    note: p => `CA ${p.ca}, PA ${p.pa}` },
  { id: 'loan', title: 'Loan targets', params: { age: ['Max age', 21, 1], pa: ['Min PA', 145, 5], rank: ['Outside club top', 20, 1] },
    why: v => `${v('age')} or under, PA ${v('pa')}+, outside their club’s top ${v('rank')}: clubs often loan these out`,
    test: (p, v) => p.club && !p.onLoan && p.age <= v('age') && p.pa >= v('pa') && p.clubRank > v('rank'), score: p => p.pa + p.ca / 4,
    note: p => `#${p.clubRank} at ${p.clubShort || p.club}` },
  { id: 'stuck', title: 'Stuck behind others', params: { ca: ['Min CA', 140, 5], age: ['Max age', 26, 1], rank: ['Outside club top', 18, 1] },
    why: v => `CA ${v('ca')}+, ${v('age')} or under, outside their club’s top ${v('rank')}: often available or loanable`,
    test: (p, v) => p.ca >= v('ca') && p.age <= v('age') && p.clubRank > v('rank'), score: p => p.ca + p.pa / 4,
    note: p => `#${p.clubRank} at ${p.clubShort || p.club}` },
  { id: 'smallclub', title: 'Big potential, small club', params: { pa: ['Min PA', 150, 5], age: ['Max age', 22, 1], club: ['Club squad CA below', 100, 5] },
    why: v => `${v('age')} or under with PA ${v('pa')}+ at clubs whose squad averages under CA ${v('club')}: likely cheap`,
    test: (p, v) => p.club && !RESERVE_SIDE.test(p.club) && p.age <= v('age') && p.pa >= v('pa') && p.clubStrength < v('club'), score: p => p.pa - p.clubStrength / 4,
    note: p => `${p.clubShort || p.club} (squad ~${p.clubStrength})` },
  { id: 'homegrown', title: 'Homegrown prospects', params: { age: ['Max age', 21, 1], pa: ['Min PA', 140, 5] },
    why: v => `${v('age')} or under, PA ${v('pa')}+, same nationality as your club’s country (useful for squad quotas)`,
    test: (p, v) => { const c = myClub(); const nat = c && all.find(x => x.clubId === c.id)?.clubNation; return !!nat && p.nation === nat && p.age <= v('age') && p.pa >= v('pa'); },
    score: p => p.pa + p.ca / 4, note: p => `${p.nation}, PA ${p.pa}` },
  { id: 'clause', title: 'Release clause steals', params: { ca: ['Min CA', 130, 5], ratio: ['Clause at most … × value', 1.3, 0.1] },
    why: v => `CA ${v('ca')}+ with a clause at most ${v('ratio')}× value: bid it and the club must accept`,
    test: (p, v) => p.releaseClause && p.value && p.releaseClause <= v('ratio') * p.value && p.ca >= v('ca'), score: p => p.ca - 4 * p.releaseClause / p.value,
    note: p => `clause ${money(p.releaseClause)}` },
  { id: 'wages', title: 'Bargain wages', params: { ca: ['Min CA', 140, 5] },
    why: v => `CA ${v('ca')}+ on the lowest wages`,
    test: (p, v) => p.ca >= v('ca') && p.wage > 0, score: p => p.ca / Math.log10(p.wage),
    note: p => `${money(p.wage)}/w` },
  { id: 'risers', title: 'Fastest risers', params: { min: ['Min CA gain', 1, 1] },
    why: v => `CA up ${v('min')}+ since your previous scan at an earlier game date`,
    test: (p, v) => p.dCA >= v('min'), score: p => p.dCA * 10 + p.pa / 20,
    note: p => `+${p.dCA} CA` },
  { id: 'pace', title: 'Pace merchants', params: { sum: ['Acc + Pac at least', 34, 1], age: ['Max age', 25, 1] },
    why: v => `${v('age')} or under with acceleration + pace of ${v('sum')}+`,
    test: (p, v) => p.age <= v('age') && A(p, 'Acc') + A(p, 'Pac') >= v('sum') && !p.isGK, score: p => A(p, 'Acc') + A(p, 'Pac') + p.ca / 25,
    note: p => `Acc ${Math.round(A(p, 'Acc'))}, Pac ${Math.round(A(p, 'Pac'))}` },
  { id: 'aerial', title: 'Aerial threats', params: { h: ['Min height cm', 190, 1], sum: ['Hea + Jum at least', 32, 1] },
    why: v => `${v('h')}cm+ with heading + jumping reach of ${v('sum')}+`,
    test: (p, v) => p.height >= v('h') && A(p, 'Hea') + A(p, 'Jum') >= v('sum') && !p.isGK, score: p => A(p, 'Hea') + A(p, 'Jum') + p.ca / 25,
    note: p => `${p.height}cm, Hea ${Math.round(A(p, 'Hea'))}` },
  { id: 'setpiece', title: 'Set-piece specialists', params: { sum: ['Cor + Fre at least', 32, 1], ca: ['Min CA', 120, 5] },
    why: v => `Corners + free kicks of ${v('sum')}+, CA ${v('ca')}+`,
    test: (p, v) => A(p, 'Cor') + A(p, 'Fre') >= v('sum') && p.ca >= v('ca'), score: p => A(p, 'Cor') + A(p, 'Fre') + A(p, 'Pen') / 2 + p.ca / 25,
    note: p => `Cor ${Math.round(A(p, 'Cor'))}, FK ${Math.round(A(p, 'Fre'))}, Pen ${Math.round(A(p, 'Pen'))}` },
  { id: 'twofooted', title: 'Two-footed', params: { ca: ['Min CA', 120, 5] },
    why: v => `Strong on both feet, CA ${v('ca')}+`,
    test: (p, v) => Math.min(...p.foot) >= 80 && p.ca >= v('ca'), score: p => Math.min(...p.foot) / 5 + p.ca / 10,
    note: p => `${footWord(p.foot[0])} / ${footWord(p.foot[1])}` },
  { id: 'bigmatch', title: 'Big-game players', params: { min: ['Cons and Imp at least', 15, 1], ca: ['Min CA', 130, 5] },
    why: v => `Hidden consistency and important matches both ${v('min')}+, CA ${v('ca')}+`,
    test: (p, v) => A(p, 'Cons') >= v('min') && A(p, 'ImpM') >= v('min') && p.ca >= v('ca'), score: p => A(p, 'Cons') + A(p, 'ImpM') + p.ca / 20,
    note: p => `Cons ${Math.round(A(p, 'Cons'))}, Imp ${Math.round(A(p, 'ImpM'))}` },
  { id: 'robust', title: 'Never injured', params: { inj: ['Max injury proneness', 5, 1], ca: ['Min CA', 130, 5] },
    why: v => `Injury proneness ${v('inj')} or lower, natural fitness 15+, CA ${v('ca')}+`,
    test: (p, v) => A(p, 'Inj') <= v('inj') && A(p, 'Nat') >= 15 && p.ca >= v('ca'), score: p => p.ca - A(p, 'Inj') * 2,
    note: p => `Inj ${Math.round(A(p, 'Inj'))}, Nat ${Math.round(A(p, 'Nat'))}` },
];
const DISC_BY = Object.fromEntries(DISC.map(d => [d.id, d]));
let discParams = null, discHidden = null, discOpen = new Set();
const pv = d => key => discParams?.[d.id]?.[key] ?? d.params[key][1];
// bound helpers used by app.js (Scout "see all" filter + sort)
const discTest = id => { const d = DISC_BY[id], v = pv(d); return p => d.test(p, v); };
const discScore = id => { const d = DISC_BY[id], v = pv(d); return p => d.score(p, v); };

function discBase() { // shared filters from the Discover bar
  const pos = UI.discPos, maxFee = UI.discMaxFee;
  return p => (!UI.gender || p.female === (UI.gender === 'f')) && (!pos || p.posR[pos] >= 15) &&
    (!UI.discNotMine || !isMine(p)) && (maxFee == null || (estFee(p) != null && estFee(p) <= maxFee * 1e6));
}

function renderDisc() {
  const el = $('discPage');
  if (!D) { el.innerHTML = '<div class="empty"><h3>Scan your save first</h3><p>Discover lists appear once the game has been read.</p></div>'; return; }
  if (!valueFit) fitValueModel();
  discParams ??= store.get('discParams', {});
  discHidden ??= new Set(store.get('discHidden', []));
  const base = all.filter(discBase());
  const card = d => {
    const v = pv(d), list = base.filter(p => d.test(p, v)).sort((a, b) => d.score(b, v) - d.score(a, v));
    const tuned = discParams[d.id] && Object.keys(discParams[d.id]).length;
    return `<section class="dcard"><h3>${esc(d.title)} <span class="dtools"><small>${list.length.toLocaleString()}</small>
        <button class="ib ${discOpen.has(d.id) || tuned ? 'on' : ''}" data-dtune="${d.id}" title="Adjust thresholds" aria-label="Adjust ${esc(d.title)}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg></button>
        <button class="ib" data-dhide="${d.id}" title="Hide this card" aria-label="Hide ${esc(d.title)}">✕</button></span></h3>
      <p class="note">${esc(d.why(v))}</p>
      ${discOpen.has(d.id) ? `<div class="dtune">${Object.entries(d.params).map(([k, [label, def, step]]) =>
        `<label>${esc(label)}<input type="number" data-dparam="${d.id}|${k}" step="${step}" value="${v(k)}" placeholder="${def}"></label>`).join('')}
        <button class="link" data-dreset="${d.id}">Reset</button></div>` : ''}
      ${list.slice(0, 8).map(p => `<button class="drow ${p === sel ? 'sel' : ''}" data-goto="${esc(p.key)}">
        <span class="dn">${esc(p.name)}${tags(p)}<small>${p.age} · ${esc(p.positions.join(' '))} · ${esc(p.club || 'Free agent')}</small></span>
        <span class="num ${v200(p.ca)}">${p.ca}</span><span class="num ${v200(p.pa)}">${p.pa}</span><span class="dnote">${esc(d.note(p))}</span></button>`).join('') || '<p class="note">Nobody right now.</p>'}
      ${list.length > 8 ? `<button class="link" data-discall="${d.id}">See all ${list.length.toLocaleString()} in Scout</button>` : ''}</section>`;
  };
  const hidden = DISC.filter(d => discHidden.has(d.id));
  el.innerHTML = `
    <div class="club-head"><h1 class="club-name">Discover</h1><span class="note">Outliers across all ${all.length.toLocaleString()} players. Click a name for the full profile.</span></div>
    <div class="dbar">
      <div class="seg" role="group" aria-label="Gender">${[['m', 'Men'], ['f', 'Women'], ['', 'All']].map(([v, l]) => `<button data-dgender="${v}" class="${UI.gender === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <select id="discPos" aria-label="Position"><option value="">Any position</option>${POS_ORDER.map(k => `<option ${UI.discPos === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
      <label class="pill">Max fee £M <input id="discFee" type="number" min="0" step="1" value="${UI.discMaxFee ?? ''}" placeholder="any"></label>
      <label class="check"><input id="discMine" type="checkbox" ${UI.discNotMine ? 'checked' : ''}> Hide ${esc(myClub()?.name || 'my club')}</label>
    </div>
    <div class="dgrid">${DISC.filter(d => !discHidden.has(d.id)).map(card).join('')}</div>
    ${hidden.length ? `<p class="note" style="margin-top:16px">Hidden: ${hidden.map(d => `<button class="link" data-dshow="${d.id}">${esc(d.title)}</button>`).join(' · ')}</p>` : ''}`;
}

function wireDisc() {
  const el = $('discPage');
  el.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    const ds = t.dataset;
    if (ds.dgender !== undefined) { UI.gender = ds.dgender; store.set('gender', UI.gender); renderRail(); update(); return renderDisc(); }
    if (ds.dtune) { discOpen.has(ds.dtune) ? discOpen.delete(ds.dtune) : discOpen.add(ds.dtune); return renderDisc(); }
    if (ds.dreset) { delete discParams[ds.dreset]; store.set('discParams', discParams); return renderDisc(); }
    if (ds.dhide || ds.dshow) {
      const id = ds.dhide || ds.dshow;
      ds.dhide ? discHidden.add(id) : discHidden.delete(id);
      store.set('discHidden', [...discHidden]);
      return renderDisc();
    }
    if (ds.discall) {
      F = { ...F0(), discover: ds.discall, pos: UI.discPos ? [UI.discPos] : [], notMine: !!UI.discNotMine, estMax: UI.discMaxFee ?? null };
      UI.preset = 'all'; UI.sort = ['disc', -1];
      setMode('scout'); renderRail(); update();
      return;
    }
    if (ds.goto) { showDossier(byKey(ds.goto)); renderDisc(); }
  });
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.dparam) {
      const [id, k] = t.dataset.dparam.split('|');
      const val = num(t.value);
      discParams[id] ||= {};
      if (val == null || val === DISC_BY[id].params[k][1]) delete discParams[id][k]; else discParams[id][k] = val;
      store.set('discParams', discParams);
      return renderDisc();
    }
    if (t.id === 'discPos') UI.discPos = t.value;
    else if (t.id === 'discMine') UI.discNotMine = t.checked;
    else if (t.id === 'discFee') UI.discMaxFee = num(t.value);
    else return;
    store.set('disc', { pos: UI.discPos, notMine: UI.discNotMine, maxFee: UI.discMaxFee });
    renderDisc();
  });
}
