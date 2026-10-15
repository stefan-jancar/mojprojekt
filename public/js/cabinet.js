/* =========================================================
   Elektro – Rozvádzač: skriňa s Beckhoff kartami a snímačmi.
   Vodiče sa ťahajú prstom na svorky, zapojenie sa kontroluje
   a správne zapojený snímač sa dá simulovať.
   ========================================================= */
let C;
let CAT = null;            // katalóg kariet z /data/beckhoff.json
let CABS = null;           // uložené rozvádzače
let saveTimer = null;

const $ = (s, r = document) => r.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = (s) => C.esc(s);
const card = (id) => CAT.find((c) => c.id === id);

/* ---------- pravidlá zapojenia ---------- */
const isNeg = (c) => /negat/i.test(c.name);
const sysBlocked = (c) => c.family === 'system' && !['EL9186', 'EL9187'].includes(c.id);
const ROLES = {
  'di+': { name: 'vstup digitálnej karty (PNP, pozitívne spínanie)', ok: (c, p) => p.kind === 'in' && c.family === 'di' && !isNeg(c) && /^Input \d+$/i.test(p.label) },
  'di-': { name: 'vstup karty s negatívnym spínaním (napr. EL1088)', ok: (c, p) => p.kind === 'in' && c.family === 'di' && isNeg(c) && /^Input \d+$/i.test(p.label) },
  24: { name: '+24 V', ok: (c, p) => p.kind === '+24V' && !sysBlocked(c) && !/Us|E-bus/.test(p.label) },
  0: { name: '0 V', ok: (c, p) => p.kind === '0V' && /^0 ?V$/i.test(p.label.trim()) && !sysBlocked(c) },
  gnd: { name: '0 V / GND analógovej karty', ok: (c, p) => p.kind === '0V' && !sysBlocked(c) && !/motor|Us|E-bus/.test(p.label) },
  ai_v: { name: 'napäťový vstup analógovej karty (0…10 V)', ok: (c, p) => p.kind === 'ain' && /10 ?V/.test(c.name) && !/diferenc/i.test(c.name) && /^Input \d+$/.test(p.label) },
  ai_i: { name: 'prúdový vstup analógovej karty (4…20 mA)', ok: (c, p) => p.kind === 'ain' && /mA/.test(c.name) && !/diferenc/i.test(c.name) && /^Input \d+$/.test(p.label) },
  'r+': { name: '+R svorka PT100 karty', ok: (c, p) => /^\+R\d+$/.test(p.label), ch: true },
  rl: { name: '+RL svorka PT100 karty (3-vodičové zapojenie)', ok: (c, p) => /^\+RL\d+$/.test(p.label), ch: true },
  'r-': { name: '−R svorka PT100 karty', ok: (c, p) => /^[−-]R\d+$/.test(p.label), ch: true },
  'tc+': { name: '+TC svorka karty pre termočlánky', ok: (c, p) => /^\+TC\d+$/.test(p.label), ch: true },
  'tc-': { name: '−TC svorka karty pre termočlánky', ok: (c, p) => /^[−-]TC\d+$/.test(p.label), ch: true },
  'do+': { name: 'výstup digitálnej karty (Output)', ok: (c, p) => p.kind === 'out' && (c.family === 'do' || c.id === 'EL1859') && !isNeg(c) && /^Output \d+$/.test(p.label) },
};
const SUPPLY = new Set(['24', '0', 'gnd']);
const chOf = (p) => { const m = String(p.label).match(/(\d+)\s*$/); return m ? Number(m[1]) : null; };

const BN = '#8b5a2b', BU = '#2f6fe0', BK = '#1c1c1c', RD = '#d42a2a', WH = '#eeeeee', GN = '#1f9d48';
const SENSORS = {
  ind_pnp: { name: 'Indukčný snímač PNP', icon: 'ind', kind: 'di', act: 'Priblížiť kov', suggest: ['EL1002'],
    wires: [['bn', 'BN hnedý', '+24 V', BN, '24'], ['bu', 'BU modrý', '0 V', BU, '0'], ['bk', 'BK čierny', 'signál', BK, 'di+']] },
  opt_slot: { name: 'Štrbinová optická závora PNP', icon: 'slot', kind: 'di', act: 'Prerušiť lúč', suggest: ['EL1002'],
    wires: [['bn', 'BN hnedý', '+24 V', BN, '24'], ['bu', 'BU modrý', '0 V', BU, '0'], ['bk', 'BK čierny', 'signál', BK, 'di+']] },
  cap_pnp: { name: 'Kapacitný snímač PNP', icon: 'cap', kind: 'di', act: 'Priblížiť materiál', suggest: ['EL1002'],
    wires: [['bn', 'BN hnedý', '+24 V', BN, '24'], ['bu', 'BU modrý', '0 V', BU, '0'], ['bk', 'BK čierny', 'signál', BK, 'di+']] },
  ind_npn: { name: 'Indukčný snímač NPN', icon: 'ind', kind: 'di', act: 'Priblížiť kov', suggest: ['EL1088', 'EL9186', 'EL9187'],
    wires: [['bn', 'BN hnedý', '+24 V', BN, '24'], ['bu', 'BU modrý', '0 V', BU, '0'], ['bk', 'BK čierny', 'signál (spína na 0 V)', BK, 'di-']] },
  limit: { name: 'Koncový spínač (NO)', icon: 'limit', kind: 'di', act: 'Zopnúť spínač', suggest: ['EL1004'],
    wires: [['com', 'COM', '+24 V', BN, '24'], ['no', 'NO', 'signál', BK, 'di+']] },
  button: { name: 'Tlačidlo (NO)', icon: 'button', kind: 'di', act: 'Stlačiť', suggest: ['EL1004'],
    wires: [['com', '13', '+24 V', BN, '24'], ['no', '14', 'signál', BK, 'di+']] },
  pt100_2: { name: 'PT100 2-vodičový', icon: 'rtd', kind: 'temp', suggest: ['EL3204'],
    wires: [['r', 'červený', '+R', RD, 'r+'], ['w', 'biely', '−R', WH, 'r-']] },
  pt100_3: { name: 'PT100 3-vodičový', icon: 'rtd', kind: 'temp', suggest: ['EL3202'],
    wires: [['r', 'červený', '+R', RD, 'r+'], ['r2', 'červený', '+RL', RD, 'rl'], ['w', 'biely', '−R', WH, 'r-']] },
  tc_k: { name: 'Termočlánok typ K', icon: 'tc', kind: 'temp', suggest: ['EL3314'],
    wires: [['p', 'zelený', '+TC', GN, 'tc+'], ['m', 'biely', '−TC', WH, 'tc-']] },
  s010: { name: 'Snímač 0–10 V (3-vodičový)', icon: 'box', kind: 'volt', suggest: ['EL3062'],
    wires: [['bn', 'BN hnedý', '+24 V', BN, '24'], ['bu', 'BU modrý', '0 V / GND', BU, 'gnd'], ['bk', 'BK čierny', 'signál 0–10 V', BK, 'ai_v']] },
  t420: { name: 'Prevodník 4–20 mA (2-vodičový)', icon: 'box', kind: 'ma', suggest: ['EL3052'],
    wires: [['p', '+', 'napájanie 24 V', BN, '24'], ['m', '−', 'signál 4–20 mA', BU, 'ai_i']] },
  coil: { name: 'Relé / stýkač 24 V', icon: 'coil', kind: 'do', act: 'Zapnúť výstup', suggest: ['EL2002'],
    wires: [['a1', 'A1', 'výstup karty', BK, 'do+'], ['a2', 'A2', '0 V', BU, '0']] },
  valve: { name: 'Elektroventil 24 V', icon: 'valve', kind: 'do', act: 'Zapnúť výstup', suggest: ['EL2002'],
    wires: [['p', '1', 'výstup karty', BK, 'do+'], ['m', '2', '0 V', BU, '0']] },
  lamp: { name: 'Kontrolka 24 V', icon: 'lamp', kind: 'do', act: 'Zapnúť výstup', suggest: ['EL2002'],
    wires: [['x1', 'X1', 'výstup karty', BK, 'do+'], ['x2', 'X2', '0 V', BU, '0']] },
};
const wiresOf = (s) => SENSORS[s.type].wires.map(([k, name, func, color, role]) => ({ k, name, func, color, role }));

/* ---------- úložisko ---------- */
async function loadAll() {
  if (!CAT) {
    const r = await fetch('/data/beckhoff.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('Nepodarilo sa načítať katalóg kariet');
    CAT = await r.json();
  }
  if (!CABS) {
    CABS = C.store.get('cache:cabinets', null);
    try { CABS = await C.api('/elektro/cabinets'); C.store.set('cache:cabinets', CABS); } catch (e) { if (!CABS) throw e; C.toast('Offline – zobrazujem uloženú kópiu', true); }
  }
}
function save() {
  C.store.set('cache:cabinets', CABS);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // stav simulácie sa neukladá
    const clean = CABS.map((cb) => ({ ...cb, sensors: cb.sensors.map(({ sim, ...s }) => s), outs: undefined }));
    C.api('/elektro/cabinets', { method: 'PUT', json: clean }).catch((e) => C.toast('Neuložené: ' + e.message, true));
  }, 900);
}

export async function renderCabinet(ctx, id) {
  C = ctx;
  C.$app.innerHTML = '<div class="spinner"></div>';
  try { await loadAll(); } catch (e) { C.toast(e.message, true); return; }
  const cb = id && CABS.find((x) => x.id === id);
  if (cb) return editor(cb);
  list();
}

/* ---------- zoznam skríň ---------- */
function list() {
  const { icon } = C;
  C.$app.innerHTML = `
    <div class="topbar"><a class="icon-btn" href="#/elektro" aria-label="Späť">${icon('back')}</a>
      <div class="sec-ic" style="--c:#14b8a6">${icon('briefcase')}</div><h1>Rozvádzač</h1></div>
    <div class="cbn-intro glass"><b>Postav si rozvádzač</b><span>Pridaj karty Beckhoff, pripoj snímače a potiahni vodiče na svorky. Správne zapojený snímač sa rozsvieti a môžeš si vyskúšať signál.</span></div>
    <div class="cbn-list">${CABS.map((cb) => `
      <a class="cbn-item glass" href="#/elektro/rozvadzac/${encodeURIComponent(cb.id)}">
        <div class="sec-ic" style="--c:#14b8a6">${icon('briefcase')}</div>
        <div><b>${esc(cb.name)}</b><span>${C.plural(cb.cards.length, 'karta', 'karty', 'kariet')} · ${C.plural(cb.sensors.length, 'snímač', 'snímače', 'snímačov')}</span></div>${icon('chevron')}</a>`).join('')}
      <button class="btn block" id="cbn-new">${icon('plus')}Nová skriňa</button>
      ${CABS.length ? '' : '<button class="btn ghost block" id="cbn-demo">Vyskúšať ukážkový rozvádzač</button>'}
    </div>`;
  $('#cbn-new').onclick = () => {
    const name = prompt('Názov rozvádzača', `Rozvádzač ${CABS.length + 1}`);
    if (name == null) return;
    const cb = { id: uid(), name: name.trim() || 'Rozvádzač', cards: [{ uid: uid(), type: 'EK1100' }], sensors: [] };
    CABS.push(cb); save();
    location.hash = '#/elektro/rozvadzac/' + cb.id;
  };
  $('#cbn-demo')?.addEventListener('click', () => {
    const cb = { id: uid(), name: 'Ukážka – dopravník', cards: ['EK1100', 'EL1002', 'EL1004', 'EL2002', 'EL3202'].map((t) => ({ uid: uid(), type: t })),
      sensors: [{ uid: uid(), type: 'ind_pnp', name: 'B1', wires: {} }, { uid: uid(), type: 'limit', name: 'S1', wires: {} }, { uid: uid(), type: 'pt100_3', name: 'B2', wires: {} }, { uid: uid(), type: 'coil', name: 'K1', wires: {} }] };
    CABS.push(cb); save();
    location.hash = '#/elektro/rozvadzac/' + cb.id;
  });
}

/* ---------- geometria ---------- */
const TOP = 70, CH = 380, PIN_TOP = 145, PIN_H = 222;
const cardW = (c) => (c.width_mm >= 40 ? 96 : c.width_mm >= 24 ? 92 : 46);
function pinPos(c, p) {
  const cols = c.layout?.cols || 2, rows = c.layout?.rows || 4;
  const prime = String(p.n).endsWith("'");
  const k = parseInt(p.n, 10);
  const col = Math.floor((k - 1) / rows) + (prime ? 2 : 0), row = (k - 1) % rows;
  return [col, row, cols, rows];
}
function layout(cb) {
  let x = 40;
  const cards = cb.cards.map((cc) => {
    const c = card(cc.type);
    const w = cardW(c);
    const g = { ...cc, c, x, w, pins: {} };
    for (const p of c.pins) {
      const [col, row, cols, rows] = pinPos(c, p);
      const rh = PIN_H / rows;
      g.pins[p.n] = { p, x: x + (w / cols) * (col + 0.5), y: TOP + PIN_TOP + rh * (row + 0.5), r: rows > 4 ? 6 : 8 };
    }
    x += w + 2;
    return g;
  });
  const endX = x;
  const cabW = Math.max(endX + 40, 360);
  const SY = TOP + CH + 150;
  const sensors = cb.sensors.map((s, i) => {
    const ws = wiresOf(s);
    const sw = Math.max(100, ws.length * 30 + 30);
    return { s, ws, sw, i };
  });
  let sx = 30;
  sensors.forEach((g) => { g.x = sx; g.y = SY; sx += g.sw + 22; });
  const W = Math.max(cabW + 20, sx + 10);
  const H = SY + 170;
  return { cards, sensors, endX, cabW, W, H, SY };
}

/* ---------- vyhodnotenie zapojenia ---------- */
function findPin(L, ref) {
  if (!ref) return null;
  const g = L.cards.find((x) => x.uid === ref.card);
  return g && g.pins[ref.pin] ? { g, pp: g.pins[ref.pin] } : null;
}
function evaluate(cb, L) {
  const used = {};
  cb.sensors.forEach((s) => Object.entries(s.wires || {}).forEach(([k, ref]) => {
    const key = ref.card + ':' + ref.pin;
    (used[key] ||= []).push(s.uid + ':' + k);
  }));
  const res = {};
  for (const s of cb.sensors) {
    const ws = wiresOf(s);
    const st = { wires: {}, complete: true, ok: true, short: false, channel: null, card: null };
    let chRef = null;
    for (const w of ws) {
      const ref = s.wires?.[w.k];
      const hit = findPin(L, ref);
      if (!hit) { st.wires[w.k] = { state: 'open' }; st.complete = false; st.ok = false; continue; }
      const { g, pp } = hit;
      let ok = ROLES[w.role].ok(g.c, pp.p);
      let msg = ok ? '' : `Tento vodič patrí na ${ROLES[w.role].name}.`;
      if (ok && ROLES[w.role].ch) {
        const ch = chOf(pp.p);
        if (chRef && (chRef.card !== g.uid || chRef.ch !== ch)) { ok = false; msg = `Všetky vodiče snímača musia ísť na ten istý kanál (kanál ${chRef.ch}).`; }
        chRef ||= { card: g.uid, ch };
      }
      if ((w.role === '24' && pp.p.kind === '0V') || ((w.role === '0' || w.role === 'gnd') && pp.p.kind === '+24V')) { st.short = true; msg = 'SKRAT! +24 V a 0 V by sa spojili.'; }
      if ((used[ref.card + ':' + ref.pin] || []).length > 1) { ok = false; msg = 'Na tejto svorke je už iný vodič.'; }
      if (!ok) st.ok = false;
      st.wires[w.k] = { state: ok ? 'ok' : 'bad', msg, g, pp };
    }
    // kanál, ktorý snímač „ovláda“ – podľa signálového vodiča
    const sig = ws.find((w) => !SUPPLY.has(w.role) && w.role !== 'r-' && w.role !== 'rl' && w.role !== 'tc-');
    const sw = sig && st.wires[sig.k];
    if (sw?.g) { st.card = sw.g.uid; st.channel = chOf(sw.pp.p); }
    st.ok = st.ok && st.complete && !st.short;
    res[s.uid] = st;
  }
  return res;
}

/* ---------- návrh zapojenia ---------- */
function suggest(cb, s) {
  const L = layout(cb);
  const busy = new Set();
  cb.sensors.forEach((o) => { if (o !== s) Object.values(o.wires || {}).forEach((r) => busy.add(r.card + ':' + r.pin)); });
  const ws = wiresOf(s);
  const order = [...ws].sort((a, b) => Number(SUPPLY.has(a.role)) - Number(SUPPLY.has(b.role)));
  const free = (g, p) => !busy.has(g.uid + ':' + p.n);
  const sigRole = order[0].role;
  for (const g of L.cards) {
    for (const p of g.c.pins) {
      if (!free(g, p) || !ROLES[sigRole].ok(g.c, p)) continue;
      const map = { [order[0].k]: { card: g.uid, pin: p.n } };
      const taken = new Set([g.uid + ':' + p.n]);
      const ch = chOf(p);
      let fail = false;
      for (const w of order.slice(1)) {
        const role = ROLES[w.role];
        const cand = [];
        // najprv tá istá karta (a pri kanálových vodičoch ten istý kanál), potom ostatné
        for (const h of [g, ...L.cards.filter((x) => x !== g)]) {
          for (const q of h.c.pins) {
            if (!free(h, q) || taken.has(h.uid + ':' + q.n) || !role.ok(h.c, q)) continue;
            if (role.ch && (h !== g || chOf(q) !== ch)) continue;
            cand.push({ h, q });
          }
        }
        if (!cand.length) { fail = true; break; }
        // pri napájaní uprednostni bod najbližšie k signálu
        const sp = g.pins[p.n];
        cand.sort((a, b) => (a.h === g ? 0 : 1) - (b.h === g ? 0 : 1) || Math.hypot(a.h.pins[a.q.n].x - sp.x, a.h.pins[a.q.n].y - sp.y) - Math.hypot(b.h.pins[b.q.n].x - sp.x, b.h.pins[b.q.n].y - sp.y));
        const best = cand[0];
        map[w.k] = { card: best.h.uid, pin: best.q.n };
        taken.add(best.h.uid + ':' + best.q.n);
      }
      if (!fail) return map;
    }
  }
  return null;
}

/* ---------- kreslenie ---------- */
const FAMC = { system: '#8d96a3', di: '#f5c518', do: '#f07c12', ai: '#2f80ed', ao: '#27ae60', special: '#9b51e0' };
const KC = { in: '#f5c518', out: '#f07c12', ain: '#2f80ed', aout: '#27ae60', '+24V': '#e5484d', '0V': '#3e7bfa', PE: '#2fae5b', shield: '#8d96a3', sensor: '#14b8a6', contact: '#d9822b', comm: '#9b51e0' };

function sensorIcon(s, x, y, st, on) {
  const glow = st?.ok ? 'on' : '';
  const led = `<circle cx="${x + 70}" cy="${y + 22}" r="5" class="sn-led ${st?.ok ? (on ? 'sig' : 'pwr') : ''}"/>`;
  const t = SENSORS[s.type].icon;
  let body;
  if (t === 'ind' || t === 'cap') {
    body = `<rect x="${x + 28}" y="${y + 14}" width="26" height="62" rx="4" class="sn-metal"/>
      ${[0, 1, 2, 3, 4, 5].map((i) => `<line x1="${x + 28}" y1="${y + 26 + i * 8}" x2="${x + 54}" y2="${y + 26 + i * 8}" class="sn-thread"/>`).join('')}
      <rect x="${x + 30}" y="${y + 76}" width="22" height="8" rx="2" fill="${t === 'cap' ? '#2f80ed' : '#f07c12'}"/>
      ${on ? `<rect x="${x + 22}" y="${y + 92}" width="38" height="10" rx="2" class="sn-target"/>` : ''}`;
  } else if (t === 'slot') {
    body = `<path d="M${x + 18} ${y + 14} h48 v62 h-16 v-40 h-16 v40 h-16 z" class="sn-dark"/>
      <line x1="${x + 34}" y1="${y + 56}" x2="${x + 50}" y2="${y + 56}" class="sn-beam ${on ? 'cut' : ''}"/>
      ${on ? `<rect x="${x + 38}" y="${y + 40}" width="8" height="30" class="sn-target"/>` : ''}`;
  } else if (t === 'limit') {
    body = `<rect x="${x + 20}" y="${y + 34}" width="44" height="46" rx="5" class="sn-dark"/>
      <line x1="${x + 42}" y1="${y + 34}" x2="${on ? x + 52 : x + 60}" y2="${on ? y + 12 : y + 16}" class="sn-lever"/><circle cx="${on ? x + 52 : x + 60}" cy="${on ? y + 12 : y + 16}" r="6" class="sn-roll"/>`;
  } else if (t === 'button') {
    body = `<rect x="${x + 20}" y="${y + 40}" width="44" height="40" rx="5" class="sn-dark"/>
      <rect x="${x + 28}" y="${on ? y + 30 : y + 24}" width="28" height="${on ? 12 : 18}" rx="6" fill="#2fae5b"/>`;
  } else if (t === 'rtd' || t === 'tc') {
    body = `<rect x="${x + 38}" y="${y + 10}" width="8" height="58" rx="4" class="sn-metal"/>
      <rect x="${x + 28}" y="${y + 64}" width="28" height="20" rx="4" class="sn-dark"/>
      <text x="${x + 42}" y="${y + 78}" class="sn-txt">${t === 'rtd' ? 'Pt' : 'K'}</text>`;
  } else if (t === 'coil') {
    body = `<rect x="${x + 16}" y="${y + 16}" width="52" height="66" rx="5" class="sn-dark"/>
      <rect x="${x + 24}" y="${y + 30}" width="36" height="22" rx="3" fill="${on ? '#3ddc84' : '#555b63'}"/>
      <text x="${x + 42}" y="${y + 72}" class="sn-txt">${on ? 'I' : '0'}</text>`;
  } else if (t === 'valve') {
    body = `<rect x="${x + 22}" y="${y + 14}" width="40" height="36" rx="4" class="sn-dark"/>
      <path d="M${x + 14} ${y + 60} h56 v18 h-56 z" class="sn-metal"/><path d="M${x + 30} ${y + 60} l12 18 l12 -18" fill="none" stroke="${on ? '#2f80ed' : '#666'}" stroke-width="3"/>`;
  } else if (t === 'lamp') {
    body = `<circle cx="${x + 42}" cy="${y + 42}" r="24" class="sn-lamp ${on ? 'on' : ''}"/><rect x="${x + 30}" y="${y + 66}" width="24" height="16" rx="3" class="sn-dark"/>`;
  } else {
    body = `<rect x="${x + 18}" y="${y + 18}" width="48" height="60" rx="6" class="sn-dark"/><text x="${x + 42}" y="${y + 54}" class="sn-txt">${s.type === 't420' ? 'mA' : 'V'}</text>`;
  }
  return `<g class="sn-icon ${glow}">${body}${led}</g>`;
}

function draw(cb, L, ev, sel) {
  const active = {};   // "cardUid:ch" -> true / hodnota
  cb.sensors.forEach((s) => {
    const st = ev[s.uid];
    if (st?.ok && st.card && SENSORS[s.type].kind !== 'do') active[st.card + ':' + st.channel] = { sim: s.sim, kind: SENSORS[s.type].kind };
  });
  const outs = cb.outs || {};
  const parts = [];
  // skriňa
  parts.push(`<rect x="10" y="10" width="${L.cabW}" height="${TOP + CH + 60}" rx="14" class="cb-cab"/>
    <rect x="22" y="22" width="${L.cabW - 24}" height="${TOP + CH + 36}" rx="8" class="cb-plate"/>
    <rect x="22" y="${TOP - 34}" width="${L.cabW - 24}" height="22" rx="3" class="cb-duct"/>
    <rect x="22" y="${TOP + CH + 18}" width="${L.cabW - 24}" height="22" rx="3" class="cb-duct"/>
    <rect x="24" y="${TOP + CH / 2 - 17}" width="${L.cabW - 28}" height="34" class="cb-rail"/>
    ${Array.from({ length: Math.floor((L.cabW - 30) / 18) }, (_, i) => `<line x1="${30 + i * 18}" y1="${TOP - 34}" x2="${30 + i * 18}" y2="${TOP - 12}" class="cb-slot"/><line x1="${30 + i * 18}" y1="${TOP + CH + 18}" x2="${30 + i * 18}" y2="${TOP + CH + 40}" class="cb-slot"/>`).join('')}`);
  // karty
  for (const g of L.cards) {
    const f = FAMC[g.c.family] || '#888';
    const chans = [...new Set(g.c.pins.filter((p) => ['in', 'out', 'ain', 'aout', 'sensor'].includes(p.kind)).map(chOf).filter(Boolean))].sort((a, b) => a - b);
    const lw = Math.min(14, (g.w - 14) / 2);
    const leds = chans.map((ch, i) => {
      const key = g.uid + ':' + ch;
      const isOut = g.c.pins.some((p) => p.kind === 'out' && chOf(p) === ch);
      const on = isOut ? !!outs[key] : (active[key]?.sim === true || typeof active[key]?.sim === 'number');
      return `<rect x="${g.x + 7 + (i % 2) * (lw + 2)}" y="${TOP + 40 + Math.floor(i / 2) * 9}" width="${lw}" height="6" rx="1.5" class="cb-chled ${on ? 'on' : ''}"/>`;
    }).join('');
    const vals = Object.entries(active).filter(([k, v]) => k.startsWith(g.uid + ':') && typeof v.sim === 'number');
    parts.push(`<g class="cb-card ${sel?.card === g.uid ? 'sel' : ''}" data-card="${g.uid}">
      <rect x="${g.x}" y="${TOP}" width="${g.w}" height="${CH}" rx="5" class="cb-body"/>
      <rect x="${g.x}" y="${TOP}" width="${g.w}" height="10" rx="5" fill="${f}"/><rect x="${g.x}" y="${TOP + 5}" width="${g.w}" height="5" fill="${f}"/>
      <text x="${g.x + g.w / 2}" y="${TOP + 27}" class="cb-id">${esc(g.c.id)}</text>
      <rect x="${g.x + 4}" y="${TOP + 35}" width="${g.w - 8}" height="${Math.max(16, Math.ceil(chans.length / 2) * 9 + 8)}" rx="3" class="cb-ledwin"/>${leds}
      ${vals.map(([k, v], i) => `<text x="${g.x + g.w / 2}" y="${TOP + 120 - i * 10}" class="cb-val">${fmtSim(v)}</text>`).join('')}
    </g>`);
    for (const [n, pp] of Object.entries(g.pins)) {
      const hint = sel?.hint?.has(g.uid + ':' + n);
      parts.push(`<g class="cb-pin ${hint ? 'hint' : ''}" data-card="${g.uid}" data-pin="${esc(n)}">
        <circle cx="${pp.x}" cy="${pp.y}" r="${pp.r + 8}" class="hit"/>
        <circle cx="${pp.x}" cy="${pp.y}" r="${pp.r}" class="hole"/><circle cx="${pp.x}" cy="${pp.y}" r="${pp.r * 0.42}" fill="${KC[pp.p.kind] || '#999'}"/>
        <text x="${pp.x}" y="${pp.y + pp.r + 9}" class="cb-pn">${esc(n)}</text></g>`);
    }
  }
  parts.push(`<rect x="${L.endX}" y="${TOP + 6}" width="8" height="${CH - 12}" rx="2" class="cb-end"/>`);
  // snímače a vodiče
  const wiresSvg = [], handles = [];
  for (const sg of L.sensors) {
    const s = sg.s, st = ev[s.uid];
    const on = SENSORS[s.type].kind === 'do' ? !!outs[st?.card + ':' + st?.channel] && st?.ok : !!s.sim;
    parts.push(`<g class="sn ${sel?.sensor === s.uid ? 'sel' : ''} ${st?.short ? 'short' : ''}" data-sensor="${s.uid}">
      <rect x="${sg.x}" y="${sg.y}" width="${sg.sw}" height="128" rx="12" class="sn-bg"/>
      ${sensorIcon(s, sg.x + (sg.sw - 84) / 2, sg.y + 12, st, on)}
      <text x="${sg.x + sg.sw / 2}" y="${sg.y + 112}" class="sn-name">${esc(s.name)}</text>
      <text x="${sg.x + sg.sw / 2}" y="${sg.y + 123}" class="sn-type">${esc(SENSORS[s.type].name)}</text></g>`);
    sg.ws.forEach((w, i) => {
      const hx = sg.x + 15 + (sg.sw - 30) * ((i + 0.5) / sg.ws.length), hy = sg.y - 10;
      const wst = st?.wires[w.k];
      if (wst?.g) {
        const pp = wst.pp;
        const d = `M${hx} ${hy} C${hx} ${hy - 90}, ${pp.x} ${pp.y + 140}, ${pp.x} ${pp.y}`;
        wiresSvg.push(`<path d="${d}" class="cb-wire-sh"/><path d="${d}" stroke="${w.color}" class="cb-wire ${wst.state}"/>
          ${wst.state === 'bad' ? `<circle cx="${pp.x}" cy="${pp.y}" r="${pp.r + 4}" class="cb-badring"/>` : ''}`);
      } else {
        wiresSvg.push(`<path d="M${hx} ${sg.y} L${hx} ${hy}" stroke="${w.color}" class="cb-wire open"/>`);
      }
      handles.push(`<g class="cb-hd ${sel?.wire === s.uid + ':' + w.k ? 'sel' : ''}" data-sensor="${s.uid}" data-wire="${w.k}">
        <circle cx="${hx}" cy="${hy}" r="15" class="hit"/><circle cx="${hx}" cy="${hy}" r="7" fill="${w.color}" stroke="#fff" stroke-width="2"/>
        <text x="${hx}" y="${hy - 13}" class="cb-hdt">${esc(w.func.length > 8 ? w.name.split(' ')[0] : w.func)}</text></g>`);
    });
  }
  if (!L.sensors.length) parts.push(`<text x="${L.W / 2}" y="${L.SY + 60}" class="cb-empty">Pridaj snímač tlačidlom „+ Snímač“</text>`);
  return `<svg class="cb-svg" viewBox="0 0 ${L.W} ${L.H}" width="${L.W}" height="${L.H}">${parts.join('')}${wiresSvg.join('')}${handles.join('')}<path id="cb-drag" class="cb-wire drag" d=""/></svg>`;
}

function fmtSim({ sim, kind }) {
  const u = { temp: '°C', volt: 'V', ma: 'mA' }[kind] || '';
  return `${sim.toFixed(1).replace('.', ',')} ${u}`;
}

/* ---------- editor ---------- */
function editor(cb) {
  const { icon } = C;
  let sel = null;
  C.$app.innerHTML = `
    <div class="topbar"><a class="icon-btn" href="#/elektro/rozvadzac" aria-label="Späť">${icon('back')}</a>
      <div class="sec-ic" style="--c:#14b8a6">${icon('briefcase')}</div><h1 id="cb-title">${esc(cb.name)}</h1>
      <button class="icon-btn" id="cb-menu" aria-label="Možnosti">${icon('edit')}</button></div>
    <div class="cb-tools">
      <button class="btn ghost" id="cb-add-card">${icon('plus')}Karta</button>
      <button class="btn ghost" id="cb-add-sensor">${icon('plus')}Snímač</button>
      <button class="btn ghost" id="cb-zoom" aria-label="Priblížiť">${icon('search')}</button>
    </div>
    <div class="cb-canvas glass" id="cb-canvas"></div>
    <div class="cb-hint" id="cb-hint">Potiahni farebný koniec vodiča na svorku karty – alebo ťukni na vodič a potom na svorku.</div>
    <div class="cb-panel glass" id="cb-panel"></div>
    <div id="cb-sheet"></div>`;
  let zoom = C.store.get('cb:zoom', 1);
  const canvas = $('#cb-canvas');

  const render = () => {
    const L = layout(cb);
    const ev = evaluate(cb, L);
    const scroll = [canvas.scrollLeft, canvas.scrollTop];
    canvas.innerHTML = draw(cb, L, ev, sel);
    const svg = canvas.querySelector('svg');
    svg.style.width = L.W * zoom + 'px';
    svg.style.height = L.H * zoom + 'px';
    [canvas.scrollLeft, canvas.scrollTop] = scroll;
    bind(svg, L, ev);
    panel(L, ev);
  };

  const hintsFor = (L, s, w) => {
    const set = new Set();
    for (const g of L.cards) for (const p of g.c.pins) if (ROLES[w.role].ok(g.c, p)) set.add(g.uid + ':' + p.n);
    return set;
  };

  function connect(sUid, wk, cardUid, pin) {
    const s = cb.sensors.find((x) => x.uid === sUid);
    s.wires ||= {};
    // ak už na svorke visí iný vodič tohto snímača, uvoľni ho
    for (const [k, r] of Object.entries(s.wires)) if (k !== wk && r.card === cardUid && String(r.pin) === String(pin)) delete s.wires[k];
    s.wires[wk] = { card: cardUid, pin: isNaN(pin) ? pin : Number(pin) };
    save();
    const L = layout(cb), ev = evaluate(cb, L), st = ev[s.uid], wst = st.wires[wk];
    if (st.short) { C.toast('⚡ SKRAT! Takto by si spojil +24 V a 0 V.', true); try { navigator.vibrate?.([80, 40, 80]); } catch { /* */ } }
    else if (wst.state === 'bad') C.toast(wst.msg, true);
    else if (st.ok) { C.toast(`✓ ${s.name} je zapojený správne`); try { navigator.vibrate?.(30); } catch { /* */ } }
    sel = { sensor: s.uid };
    render();
  }

  function bind(svg, L, ev) {
    const toSvg = (e) => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); };
    const pinAt = (x, y) => {
      let best = null, bd = 22;
      for (const g of L.cards) for (const [n, pp] of Object.entries(g.pins)) {
        const d = Math.hypot(pp.x - x, pp.y - y);
        if (d < bd) { bd = d; best = { card: g.uid, pin: n }; }
      }
      return best;
    };
    svg.querySelectorAll('.cb-hd').forEach((h) => {
      h.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const sUid = h.dataset.sensor, wk = h.dataset.wire;
        const s = cb.sensors.find((x) => x.uid === sUid);
        const w = wiresOf(s).find((x) => x.k === wk);
        const hint = hintsFor(L, s, w);
        svg.querySelectorAll('.cb-pin').forEach((p) => p.classList.toggle('hint', hint.has(p.dataset.card + ':' + p.dataset.pin)));
        const start = toSvg(e), drag = $('#cb-drag', svg);
        drag.setAttribute('stroke', w.color);
        let moved = false;
        h.setPointerCapture(e.pointerId);
        const move = (ev2) => {
          const p = toSvg(ev2);
          if (Math.hypot(p.x - start.x, p.y - start.y) > 6) moved = true;
          if (!moved) return;
          drag.setAttribute('d', `M${start.x} ${start.y} C${start.x} ${start.y - 80}, ${p.x} ${p.y + 80}, ${p.x} ${p.y}`);
          const t = pinAt(p.x, p.y);
          svg.querySelectorAll('.cb-pin.over').forEach((x) => x.classList.remove('over'));
          if (t) svg.querySelector(`.cb-pin[data-card="${t.card}"][data-pin="${CSS.escape(String(t.pin))}"]`)?.classList.add('over');
        };
        const up = (ev2) => {
          h.removeEventListener('pointermove', move);
          h.removeEventListener('pointerup', up);
          h.removeEventListener('pointercancel', up);
          drag.setAttribute('d', '');
          if (moved) {
            const p = toSvg(ev2), t = pinAt(p.x, p.y);
            if (t) return connect(sUid, wk, t.card, t.pin);
            if (s.wires?.[wk]) { delete s.wires[wk]; save(); }
            sel = { sensor: sUid };
            return render();
          }
          // ťuknutie: vyber vodič a ukáž kam patrí
          sel = { sensor: sUid, wire: sUid + ':' + wk, hint };
          render();
          $('#cb-hint').textContent = `Ťukni na svorku pre vodič ${w.name} (${w.func}). Zelené body sú správne miesta.`;
        };
        h.addEventListener('pointermove', move);
        h.addEventListener('pointerup', up);
        h.addEventListener('pointercancel', up);
      });
    });
    svg.querySelectorAll('.cb-pin').forEach((p) => {
      p.addEventListener('click', () => {
        if (sel?.wire) { const [sUid, wk] = sel.wire.split(':'); return connect(sUid, wk, p.dataset.card, p.dataset.pin); }
        sel = { card: p.dataset.card, pin: p.dataset.pin };
        render();
      });
    });
    svg.querySelectorAll('.cb-card').forEach((g) => g.addEventListener('click', () => { if (sel?.wire) return; sel = { card: g.dataset.card }; render(); }));
    svg.querySelectorAll('.sn').forEach((g) => g.addEventListener('click', () => { sel = { sensor: g.dataset.sensor }; render(); }));
  }

  function panel(L, ev) {
    const P = $('#cb-panel');
    if (sel?.sensor) {
      const s = cb.sensors.find((x) => x.uid === sel.sensor);
      if (!s) { sel = null; return panel(L, ev); }
      const def = SENSORS[s.type], st = ev[s.uid];
      const ws = wiresOf(s);
      const status = st.short ? '<span class="cbp-st bad">⚡ Skrat</span>' : st.ok ? '<span class="cbp-st ok">✓ Zapojený správne</span>' : st.complete ? '<span class="cbp-st bad">✕ Chyba v zapojení</span>' : '<span class="cbp-st">Nezapojený</span>';
      const sim = !st.ok ? '' : def.kind === 'di' ? `<button class="btn block cbp-sim ${s.sim ? 'on' : ''}" id="cbp-sim">${s.sim ? '✋ Uvoľniť' : '👉 ' + def.act}</button>`
        : def.kind === 'temp' ? simSlider(s, -50, 400, 0.5, '°C', 21)
          : def.kind === 'volt' ? simSlider(s, 0, 10, 0.1, 'V', 5)
            : def.kind === 'ma' ? simSlider(s, 4, 20, 0.1, 'mA', 12)
              : `<button class="btn block cbp-sim ${cb.outs?.[st.card + ':' + st.channel] ? 'on' : ''}" id="cbp-out">${cb.outs?.[st.card + ':' + st.channel] ? 'Vypnúť výstup' : '⚡ ' + def.act}</button>`;
      const g = st.card && L.cards.find((x) => x.uid === st.card);
      P.innerHTML = `
        <div class="cbp-head"><div><b>${esc(s.name)}</b><span>${esc(def.name)}</span></div>${status}</div>
        ${st.ok && g ? `<div class="cbp-ok">Signál ide na <b>${esc(g.c.id)}</b>, kanál <b>${st.channel}</b>.</div>` : ''}
        <div class="cbp-wires">${ws.map((w) => {
          const x = st.wires[w.k];
          const where = x?.g ? `${esc(x.g.c.id)} · bod ${esc(String(x.pp.p.n))} (${esc(x.pp.p.label)})` : 'nezapojený';
          return `<div class="cbp-w ${x?.state || 'open'}"><i style="background:${w.color}"></i><div><b>${esc(w.name)}</b> – ${esc(w.func)}<small>${where}${x?.msg ? `<em>${esc(x.msg)}</em>` : ''}</small></div>
            <span>${x?.state === 'ok' ? '✓' : x?.state === 'bad' ? '✕' : '○'}</span></div>`;
        }).join('')}</div>
        ${sim}
        <div class="cbp-actions">
          <button class="btn ghost" id="cbp-show">💡 Kam pripojiť?</button>
          <button class="btn ghost" id="cbp-auto">🔌 Zapojiť za mňa</button>
          <button class="btn ghost" id="cbp-clear">Odpojiť</button>
          <button class="btn ghost" id="cbp-ren">Premenovať</button>
          <button class="btn danger" id="cbp-del">Odstrániť</button>
        </div>`;
      $('#cbp-sim')?.addEventListener('click', () => { s.sim = !s.sim; render(); });
      $('#cbp-out')?.addEventListener('click', () => { cb.outs ||= {}; const k = st.card + ':' + st.channel; cb.outs[k] = !cb.outs[k]; render(); });
      P.querySelector('input[type=range]')?.addEventListener('input', (e) => { s.sim = Number(e.target.value); render(); });
      $('#cbp-show').onclick = () => {
        const map = suggest(cb, s);
        if (!map) return offerCards(s);
        sel = { sensor: s.uid, hint: new Set(Object.values(map).map((r) => r.card + ':' + r.pin)) };
        render();
        const txt = ws.map((w) => { const r = map[w.k]; const h = layout(cb).cards.find((x) => x.uid === r.card); return `${w.name} → ${h.c.id} bod ${r.pin}`; }).join(' · ');
        $('#cb-hint').innerHTML = `<b>Návrh:</b> ${esc(txt)}`;
        $('#cb-canvas').scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      $('#cbp-auto').onclick = () => {
        const map = suggest(cb, s);
        if (!map) return offerCards(s);
        s.wires = map; save(); C.toast(`✓ ${s.name} zapojený`); render();
      };
      $('#cbp-clear').onclick = () => { s.wires = {}; s.sim = null; save(); render(); };
      $('#cbp-ren').onclick = () => { const n = prompt('Označenie snímača', s.name); if (n) { s.name = n.trim().slice(0, 12); save(); render(); } };
      $('#cbp-del').onclick = () => { cb.sensors = cb.sensors.filter((x) => x !== s); sel = null; save(); render(); };
      return;
    }
    if (sel?.card) {
      const g = L.cards.find((x) => x.uid === sel.card);
      if (!g) { sel = null; return panel(L, ev); }
      const idx = cb.cards.findIndex((x) => x.uid === g.uid);
      const pin = sel.pin && g.pins[sel.pin]?.p;
      const users = cb.sensors.filter((s) => Object.values(s.wires || {}).some((r) => r.card === g.uid));
      P.innerHTML = `
        <div class="cbp-head"><div><b>${esc(g.c.id)}</b><span>${esc(g.c.name)}</span></div><a class="btn ghost" href="#/elektro/beckhoff/${encodeURIComponent(g.c.id)}">Detail</a></div>
        ${pin ? `<div class="cbp-pin"><b>Bod ${esc(String(pin.n))} · ${esc(pin.label)}</b><span>${esc(pin.desc || '')}</span></div>` : ''}
        ${users.length ? `<div class="tl-muted">Pripojené: ${users.map((s) => esc(s.name)).join(', ')}</div>` : ''}
        <div class="cbp-actions">
          <button class="btn ghost" id="cbp-left" ${idx <= 1 ? 'disabled' : ''}>${icon('back')}Posunúť</button>
          <button class="btn ghost" id="cbp-right" ${idx === cb.cards.length - 1 || idx === 0 ? 'disabled' : ''}>Posunúť${icon('chevron')}</button>
          ${idx === 0 ? '' : '<button class="btn danger" id="cbp-rm">Vybrať kartu</button>'}
        </div>`;
      const mv = (d) => { const a = cb.cards; [a[idx], a[idx + d]] = [a[idx + d], a[idx]]; save(); render(); };
      $('#cbp-left')?.addEventListener('click', () => mv(-1));
      $('#cbp-right')?.addEventListener('click', () => mv(1));
      $('#cbp-rm')?.addEventListener('click', () => {
        if (users.length && !confirm(`Na karte sú pripojené vodiče (${users.map((s) => s.name).join(', ')}). Vybrať ju aj tak?`)) return;
        cb.cards.splice(idx, 1);
        cb.sensors.forEach((s) => { for (const [k, r] of Object.entries(s.wires || {})) if (r.card === g.uid) delete s.wires[k]; });
        sel = null; save(); render();
      });
      return;
    }
    const okN = cb.sensors.filter((s) => ev[s.uid]?.ok).length;
    P.innerHTML = `<div class="cbp-head"><div><b>${esc(cb.name)}</b><span>${C.plural(cb.cards.length, 'karta', 'karty', 'kariet')} · ${okN}/${cb.sensors.length} snímačov zapojených správne</span></div></div>
      <div class="tl-muted">Ťukni na kartu, svorku alebo snímač. Karty pridáš tlačidlom „+ Karta“, snímače „+ Snímač“.</div>`;
  }

  const simSlider = (s, min, max, step, unit, def) => {
    if (typeof s.sim !== 'number') s.sim = def;
    return `<label class="cbp-slider"><span>Simulovaná hodnota: <b>${s.sim.toFixed(1)} ${unit}</b></span><input type="range" min="${min}" max="${max}" step="${step}" value="${s.sim}"></label>`;
  };

  function offerCards(s) {
    const def = SENSORS[s.type];
    sheet(`<h2>Chýba vhodná karta</h2>
      <p class="tl-muted">Pre <b>${esc(def.name)}</b> v rozvádzači nie je voľná vhodná karta. Odporúčam pridať:</p>
      <div class="cbs-list">${def.suggest.map((id) => `<div class="cbs-item"><b>${id}</b><span>${esc(card(id).name)}</span></div>`).join('')}</div>
      <button class="btn block" id="cbs-add">Pridať a zapojiť</button>`, (el) => {
      $('#cbs-add', el).onclick = () => {
        def.suggest.forEach((id) => cb.cards.push({ uid: uid(), type: id }));
        const map = suggest(cb, s);
        if (map) s.wires = map;
        save(); closeSheet(); sel = { sensor: s.uid }; render();
        C.toast(map ? `✓ Pridané ${def.suggest.join(', ')} a ${s.name} zapojený` : 'Karty pridané');
      };
    });
  }

  function sheet(html, bindFn) {
    const el = $('#cb-sheet');
    el.innerHTML = `<div class="cbs-bg"></div><div class="cbs glass"><button class="icon-btn cbs-x" aria-label="Zavrieť">${icon('x')}</button>${html}</div>`;
    $('.cbs-bg', el).onclick = closeSheet;
    $('.cbs-x', el).onclick = closeSheet;
    bindFn?.(el);
  }
  const closeSheet = () => { $('#cb-sheet').innerHTML = ''; };

  $('#cb-add-card').onclick = () => {
    const fams = [['di', 'Digitálne vstupy'], ['do', 'Digitálne výstupy'], ['ai', 'Analógové vstupy'], ['ao', 'Analógové výstupy'], ['system', 'Napájanie a potenciál'], ['special', 'Špeciálne']];
    sheet(`<h2>Pridať kartu</h2><div class="search glass bk-search">${icon('search')}<input id="cbs-q" placeholder="EL1008, PT100, 4…20 mA…" autocomplete="off"></div><div id="cbs-cards"></div>`, (el) => {
      const paint = () => {
        const q = $('#cbs-q', el).value.trim().toLowerCase();
        $('#cbs-cards', el).innerHTML = fams.map(([f, n]) => {
          const arr = CAT.filter((c) => c.family === f && c.pins.length && !/^(EK|BK)/.test(c.id) && (!q || (c.id + ' ' + c.name + ' ' + (c.kl || []).join(' ')).toLowerCase().includes(q)));
          return arr.length ? `<div class="section-title">${n}</div><div class="cbs-list">${arr.map((c) => `<button class="cbs-item" data-id="${c.id}"><b>${c.id}</b><span>${esc(c.name)}</span></button>`).join('')}</div>` : '';
        }).join('') || '<p class="tl-muted">Nič sa nenašlo.</p>';
        el.querySelectorAll('[data-id]').forEach((b) => { b.onclick = () => { cb.cards.push({ uid: uid(), type: b.dataset.id }); save(); closeSheet(); sel = { card: cb.cards[cb.cards.length - 1].uid }; render(); C.toast(`${b.dataset.id} pridaná`); }; });
      };
      $('#cbs-q', el).oninput = paint;
      paint();
    });
  };

  $('#cb-add-sensor').onclick = () => {
    const groups = [['di', 'Snímače a spínače (digitálne)'], ['temp', 'Teplota'], ['volt', 'Analógové 0–10 V'], ['ma', 'Analógové 4–20 mA'], ['do', 'Akčné členy (výstupy)']];
    sheet(`<h2>Pridať snímač</h2>${groups.map(([k, n]) => `<div class="section-title">${n}</div><div class="cbs-list">${Object.entries(SENSORS).filter(([, d]) => d.kind === k).map(([id, d]) => `<button class="cbs-item" data-s="${id}"><b>${esc(d.name)}</b><span>${d.wires.map((w) => `<i style="background:${w[3]}"></i>${esc(w[1])}`).join(' ')}</span></button>`).join('')}</div>`).join('')}`, (el) => {
      el.querySelectorAll('[data-s]').forEach((b) => {
        b.onclick = () => {
          const type = b.dataset.s, def = SENSORS[type];
          const prefix = def.kind === 'do' ? (type === 'lamp' ? 'H' : type === 'valve' ? 'Y' : 'K') : def.kind === 'di' && /limit|button/.test(type) ? 'S' : 'B';
          const n = cb.sensors.filter((s) => s.name.startsWith(prefix)).length + 1;
          const s = { uid: uid(), type, name: prefix + n, wires: {} };
          cb.sensors.push(s); save(); closeSheet(); sel = { sensor: s.uid }; render();
          setTimeout(() => $('#cb-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
        };
      });
    });
  };

  $('#cb-zoom').onclick = () => { zoom = zoom >= 1.4 ? 0.7 : zoom >= 1 ? 1.4 : 1; C.store.set('cb:zoom', zoom); render(); C.toast(`Mierka ${Math.round(zoom * 100)} %`); };
  $('#cb-menu').onclick = () => {
    sheet(`<h2>Rozvádzač</h2><div class="cbs-list">
      <button class="cbs-item" id="cbm-ren"><b>Premenovať</b></button>
      <button class="cbs-item" id="cbm-reset"><b>Vypnúť simuláciu</b><span>Všetky snímače a výstupy do kľudového stavu</span></button>
      <button class="cbs-item danger" id="cbm-del"><b>Zmazať rozvádzač</b></button></div>`, (el) => {
      $('#cbm-ren', el).onclick = () => { const n = prompt('Názov', cb.name); if (n) { cb.name = n.trim(); $('#cb-title').textContent = cb.name; save(); } closeSheet(); render(); };
      $('#cbm-reset', el).onclick = () => { cb.sensors.forEach((s) => { s.sim = null; }); cb.outs = {}; closeSheet(); render(); };
      $('#cbm-del', el).onclick = () => { if (!confirm(`Zmazať „${cb.name}“?`)) return; CABS = CABS.filter((x) => x !== cb); save(); closeSheet(); location.hash = '#/elektro/rozvadzac'; };
    });
  };
  render();
}
