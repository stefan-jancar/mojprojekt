/* =========================================================
   Elektro – nástroje: Ohmov zákon, výkon, farebný kód, prierez
   ========================================================= */
let C;

export const TOOLS = [
  { id: 'ohm', name: 'Ohmov zákon', sub: 'U = R · I – zadaj dve, tretiu dopočíta', icon: 'bolt', color: '#8b5cf6' },
  { id: 'vykon', name: 'Výkon a Ohmov zákon', sub: 'P, U, I, R – stačia ľubovoľné dve', icon: 'target', color: '#f59e0b' },
  { id: 'rezistor', name: 'Farebný kód rezistorov', sub: '4, 5 aj 6 prúžkov · aj naopak z hodnoty', icon: 'chip', color: '#10b981' },
  { id: 'prierez', name: 'Prierez vodiča', sub: 'Podľa prúdu, uloženia, ističa a úbytku napätia', icon: 'wrench', color: '#22d3ee' },
];

export function renderTool(ctx, id) {
  C = ctx;
  const t = TOOLS.find((x) => x.id === id);
  if (!t) { location.hash = '#/elektro'; return; }
  C.$app.innerHTML = `
    <div class="topbar"><a class="icon-btn" href="#/elektro" aria-label="Späť">${C.icon('back')}</a>
      <div class="sec-ic" style="--c:${t.color}">${C.icon(t.icon)}</div><h1>${C.esc(t.name)}</h1></div>
    <div id="tool"></div>`;
  ({ ohm: ohmTool, vykon: powerTool, rezistor: resistorTool, prierez: cableTool })[id]($('#tool'));
}

const $ = (s, r = document) => r.querySelector(s);
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const dec = (n, d) => n.toLocaleString('sk-SK', { maximumFractionDigits: d });

// 3 platné číslice, slovenská desatinná čiarka
function sig(n, s = 3) {
  if (n === 0) return '0';
  const d = Math.max(0, s - 1 - Math.floor(Math.log10(Math.abs(n))));
  return dec(Number(n.toFixed(Math.min(d, 9))), Math.min(d, 9));
}
const PREFIX = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']];
function si(n, unit) {
  if (n == null || !Number.isFinite(n)) return '–';
  if (n === 0) return `0 ${unit}`;
  const [f, p] = PREFIX.find(([f]) => Math.abs(n) >= f * 0.9995) || PREFIX[PREFIX.length - 1];
  return `${sig(n / f)} ${p}${unit}`;
}

/* ---------- spoločné pole s jednotkou ---------- */
const UNITS = {
  U: [['mV', 1e-3], ['V', 1], ['kV', 1e3]],
  I: [['µA', 1e-6], ['mA', 1e-3], ['A', 1]],
  R: [['mΩ', 1e-3], ['Ω', 1], ['kΩ', 1e3], ['MΩ', 1e6]],
  P: [['mW', 1e-3], ['W', 1], ['kW', 1e3]],
};
const LABEL = { U: 'Napätie', I: 'Prúd', R: 'Odpor', P: 'Výkon' };
const DEF_UNIT = { U: 'V', I: 'A', R: 'Ω', P: 'W' };

function fieldHTML(k) {
  return `<div class="tl-f" data-f="${k}">
    <label for="tl-${k}"><b>${k}</b>${LABEL[k]}</label>
    <div class="tl-in"><input id="tl-${k}" inputmode="decimal" autocomplete="off" placeholder="–">
      <select aria-label="Jednotka ${LABEL[k]}">${UNITS[k].map(([u]) => `<option ${u === DEF_UNIT[k] ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
  </div>`;
}

// Kalkulačka, kde používateľ zadá `need` hodnôt a zvyšok sa dopočíta
function solver(root, keys, need, calc, explain) {
  const order = []; // naposledy upravené polia
  const els = Object.fromEntries(keys.map((k) => [k, root.querySelector(`[data-f="${k}"]`)]));
  const factor = (k) => UNITS[k].find(([u]) => u === els[k].querySelector('select').value)[1];
  const read = (k) => { const v = num(els[k].querySelector('input').value); return v == null ? null : v * factor(k); };
  const write = (k, v) => {
    // vyber jednotku, v ktorej je číslo najčitateľnejšie
    const opts = UNITS[k];
    let best = opts.find(([, f]) => Math.abs(v) / f >= 1 && Math.abs(v) / f < 1000) || (Math.abs(v) < opts[0][1] ? opts[0] : opts[opts.length - 1]);
    els[k].querySelector('select').value = best[0];
    els[k].querySelector('input').value = sig(v / best[1], 4).replace(/\s/g, '');
  };
  const run = () => {
    const given = order.filter((k) => read(k) != null).slice(-need);
    keys.forEach((k) => els[k].classList.toggle('calc', false));
    const out = $('.tl-out', root);
    if (given.length < need) {
      keys.filter((k) => !order.includes(k)).forEach((k) => { els[k].querySelector('input').value = ''; });
      out.innerHTML = `<span class="tl-muted">Zadaj ľubovoľné ${need === 2 ? 'dve hodnoty' : 'hodnoty'} – zvyšok sa dopočíta.</span>`;
      root.dispatchEvent(new CustomEvent('solved', { detail: null }));
      return;
    }
    const vals = Object.fromEntries(given.map((k) => [k, read(k)]));
    if (given.some((k) => vals[k] <= 0)) { out.innerHTML = '<span class="tl-err">Hodnoty musia byť väčšie ako 0.</span>'; return; }
    const res = calc(vals);
    for (let i = order.length - 1; i >= 0; i--) if (!given.includes(order[i])) order.splice(i, 1);
    keys.filter((k) => !given.includes(k)).forEach((k) => { write(k, res[k]); els[k].classList.add('calc'); });
    out.innerHTML = explain({ ...vals, ...res }, given);
    root.dispatchEvent(new CustomEvent('solved', { detail: { given, all: { ...vals, ...res } } }));
  };
  keys.forEach((k) => {
    const inp = els[k].querySelector('input'), sel = els[k].querySelector('select');
    inp.addEventListener('input', () => {
      const i = order.indexOf(k); if (i >= 0) order.splice(i, 1);
      if (inp.value.trim() !== '') order.push(k);
      run();
    });
    sel.addEventListener('change', () => { if (order.includes(k)) run(); });
  });
  $('.tl-clear', root)?.addEventListener('click', () => { order.length = 0; keys.forEach((k) => { els[k].querySelector('input').value = ''; els[k].querySelector('select').value = DEF_UNIT[k]; }); run(); });
  run();
}

/* ---------- Ohmov zákon (U, I, R) ---------- */
function ohmTool(root) {
  root.innerHTML = `
    <div class="tl-card glass">
      <svg class="tl-tri" viewBox="0 0 200 170" aria-hidden="true">
        <path d="M100 8 L192 162 L8 162 Z" class="tri"/>
        <line x1="44" y1="100" x2="156" y2="100" class="tri"/><line x1="100" y1="100" x2="100" y2="162" class="tri"/>
        <text x="100" y="78" data-t="U">U</text><text x="62" y="146" data-t="R">R</text><text x="138" y="146" data-t="I">I</text>
        <text x="100" y="146" class="dot">·</text>
      </svg>
      <div class="tl-fields">${['U', 'I', 'R'].map(fieldHTML).join('')}</div>
      <div class="tl-out"></div>
      <button class="btn ghost block tl-clear">Vymazať</button>
    </div>
    <div class="tl-note glass"><b>Trojuholník:</b> zakry hľadanú veličinu a zvyšok ti povie vzorec –
      <span>U = R · I</span><span>I = U / R</span><span>R = U / I</span></div>`;
  const tri = $('.tl-tri', root);
  root.addEventListener('solved', (e) => {
    tri.querySelectorAll('[data-t]').forEach((t) => t.classList.toggle('on', !!e.detail && !e.detail.given.includes(t.dataset.t)));
  });
  solver(root, ['U', 'I', 'R'], 2, (v) => {
    if (v.U != null && v.I != null) return { R: v.U / v.I };
    if (v.U != null && v.R != null) return { I: v.U / v.R };
    return { U: v.R * v.I };
  }, (a, given) => {
    const s = given.join('');
    const line = s.includes('U') && s.includes('I') ? `R = U / I = ${si(a.U, 'V')} / ${si(a.I, 'A')} = <b>${si(a.R, 'Ω')}</b>`
      : s.includes('U') ? `I = U / R = ${si(a.U, 'V')} / ${si(a.R, 'Ω')} = <b>${si(a.I, 'A')}</b>`
        : `U = R · I = ${si(a.R, 'Ω')} · ${si(a.I, 'A')} = <b>${si(a.U, 'V')}</b>`;
    return `<div class="tl-formula">${line}</div>`;
  });
}

/* ---------- výkon (P, U, I, R) ---------- */
function powerTool(root) {
  root.innerHTML = `
    <div class="tl-card glass">
      <div class="tl-fields">${['U', 'I', 'R', 'P'].map(fieldHTML).join('')}</div>
      <div class="tl-out"></div>
      <button class="btn ghost block tl-clear">Vymazať</button>
    </div>
    <div class="tl-note glass"><b>Vzorce</b>
      <div class="tl-grid">
        <span>P = U · I</span><span>P = R · I²</span><span>P = U² / R</span>
        <span>U = R · I</span><span>U = √(P · R)</span><span>U = P / I</span>
        <span>I = U / R</span><span>I = √(P / R)</span><span>I = P / U</span>
        <span>R = U / I</span><span>R = U² / P</span><span>R = P / I²</span>
      </div></div>`;
  solver(root, ['U', 'I', 'R', 'P'], 2, (v) => {
    const { U, I, R, P } = v;
    if (U != null && I != null) return { R: U / I, P: U * I };
    if (U != null && R != null) return { I: U / R, P: (U * U) / R };
    if (U != null && P != null) return { I: P / U, R: (U * U) / P };
    if (I != null && R != null) return { U: I * R, P: I * I * R };
    if (I != null && P != null) return { U: P / I, R: P / (I * I) };
    return { U: Math.sqrt(P * R), I: Math.sqrt(P / R) };
  }, (a, given) => {
    const F = {
      UI: ['R = U / I', 'P = U · I'], UR: ['I = U / R', 'P = U² / R'], UP: ['I = P / U', 'R = U² / P'],
      IR: ['U = R · I', 'P = R · I²'], IP: ['U = P / I', 'R = P / I²'], RP: ['U = √(P · R)', 'I = √(P / R)'],
    }[['U', 'I', 'R', 'P'].filter((k) => given.includes(k)).join('')];
    const unit = { U: 'V', I: 'A', R: 'Ω', P: 'W' };
    return `<div class="tl-formula">${F.map((f) => `${f} = <b>${si(a[f[0]], unit[f[0]])}</b>`).join('<br>')}</div>`;
  });
}

/* ---------- farebný kód rezistorov ---------- */
const COLORS = [
  { id: 'black', name: 'čierna', hex: '#1b1b1b', d: 0, m: 1, tc: 250 },
  { id: 'brown', name: 'hnedá', hex: '#7a4a24', d: 1, m: 10, tol: 1, tc: 100 },
  { id: 'red', name: 'červená', hex: '#d42a2a', d: 2, m: 100, tol: 2, tc: 50 },
  { id: 'orange', name: 'oranžová', hex: '#f07c12', d: 3, m: 1e3, tc: 15 },
  { id: 'yellow', name: 'žltá', hex: '#f5d10c', d: 4, m: 1e4, tc: 25 },
  { id: 'green', name: 'zelená', hex: '#1f9d48', d: 5, m: 1e5, tol: 0.5, tc: 20 },
  { id: 'blue', name: 'modrá', hex: '#2463d6', d: 6, m: 1e6, tol: 0.25, tc: 10 },
  { id: 'violet', name: 'fialová', hex: '#8a3fd1', d: 7, m: 1e7, tol: 0.1, tc: 5 },
  { id: 'grey', name: 'sivá', hex: '#8d8d8d', d: 8, m: 1e8, tol: 0.05, tc: 1 },
  { id: 'white', name: 'biela', hex: '#f4f4f4', d: 9, m: 1e9 },
  { id: 'gold', name: 'zlatá', hex: '#c9a227', m: 0.1, tol: 5 },
  { id: 'silver', name: 'strieborná', hex: '#b8bec6', m: 0.01, tol: 10 },
  { id: 'none', name: 'žiadna', hex: 'transparent', tol: 20 },
];
const CBY = Object.fromEntries(COLORS.map((c) => [c.id, c]));
const BANDS = {
  4: ['d', 'd', 'm', 'tol'],
  5: ['d', 'd', 'd', 'm', 'tol'],
  6: ['d', 'd', 'd', 'm', 'tol', 'tc'],
};
const BAND_NAME = { d: 'číslica', m: 'násobiteľ', tol: 'tolerancia', tc: 'teplotný koeficient' };
const valid = (kind, i) => COLORS.filter((c) => (kind === 'd' ? c.d != null && !(i === 0 && c.d === 0) : kind === 'm' ? c.m != null : kind === 'tol' ? c.tol != null : c.tc != null));
const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];

function resistorTool(root) {
  const st = { n: 4, bands: ['yellow', 'violet', 'red', 'gold', 'brown', 'brown'], active: 0 };
  const saved = C.store.get('tool:resistor', null);
  if (saved?.n && saved?.bands) Object.assign(st, saved);
  root.innerHTML = `
    <div class="tl-card glass">
      <div class="seg tl-seg" style="grid-template-columns:repeat(3,1fr)">${[4, 5, 6].map((n) => `<label><input type="radio" name="bn" value="${n}"><span>${n} ${n === 4 ? 'prúžky' : 'prúžkov'}</span></label>`).join('')}</div>
      <svg class="rz" viewBox="0 0 320 110" role="img" aria-label="Rezistor"></svg>
      <div class="rz-value"><b id="rz-val"></b><span id="rz-sub"></span></div>
      <div class="rz-band-name" id="rz-bn"></div>
      <div class="rz-pal" id="rz-pal"></div>
    </div>
    <div class="section-title">Z hodnoty na farby</div>
    <div class="tl-card glass">
      <div class="tl-in rz-rev"><input id="rz-in" placeholder="napr. 4k7, 220, 1M, 0,47" autocomplete="off" autocapitalize="off"><span>Ω</span></div>
      <div id="rz-rev-out" class="tl-muted">Napíš hodnotu a ukážem farby prúžkov.</div>
    </div>`;
  root.querySelectorAll('input[name=bn]').forEach((r) => {
    r.checked = Number(r.value) === st.n;
    r.onchange = () => { st.n = Number(r.value); st.active = 0; fixBands(); paint(); };
  });

  const fixBands = () => {
    BANDS[st.n].forEach((kind, i) => { if (!valid(kind, i).some((c) => c.id === st.bands[i])) st.bands[i] = valid(kind, i)[kind === 'tol' ? 0 : 1].id; });
  };
  const value = () => {
    const kinds = BANDS[st.n];
    const digits = kinds.map((k, i) => (k === 'd' ? CBY[st.bands[i]].d : null)).filter((x) => x != null);
    const mi = kinds.indexOf('m');
    const base = Number(digits.join(''));
    return { ohm: base * CBY[st.bands[mi]].m, tol: CBY[st.bands[kinds.indexOf('tol')]].tol, tc: kinds.includes('tc') ? CBY[st.bands[5]].tc : null };
  };
  const paint = () => {
    C.store.set('tool:resistor', { n: st.n, bands: st.bands });
    const kinds = BANDS[st.n];
    const xs = st.n === 4 ? [98, 128, 158, 222] : st.n === 5 ? [92, 116, 140, 164, 222] : [88, 110, 132, 154, 200, 230];
    $('.rz', root).innerHTML = `
      <defs><linearGradient id="rzb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0d9b0"/><stop offset=".5" stop-color="#d8b582"/><stop offset="1" stop-color="#b8925c"/></linearGradient>
        <linearGradient id="rzs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient></defs>
      <line x1="0" y1="55" x2="320" y2="55" stroke="#9aa0a8" stroke-width="5" stroke-linecap="round"/>
      <path d="M62 30 Q62 20 78 20 L242 20 Q258 20 258 30 L258 80 Q258 90 242 90 L78 90 Q62 90 62 80 Z" fill="url(#rzb)"/>
      ${kinds.map((k, i) => {
        const c = CBY[st.bands[i]];
        return `<g class="rz-b ${i === st.active ? 'on' : ''}" data-i="${i}">
          <rect x="${xs[i] - 14}" y="12" width="28" height="86" fill="transparent"/>
          <rect x="${xs[i] - 7}" y="20" width="14" height="70" fill="${c.id === 'none' ? 'url(#rzb)' : c.hex}" ${c.id === 'none' ? 'stroke="#0003" stroke-dasharray="3 3"' : ''}/>
          ${i === st.active ? `<path d="M${xs[i] - 7} 104 L${xs[i] + 7} 104 L${xs[i]} 97 Z" class="rz-arrow"/>` : ''}</g>`;
      }).join('')}
      <path d="M62 30 Q62 20 78 20 L242 20 Q258 20 258 30 L258 80 Q258 90 242 90 L78 90 Q62 90 62 80 Z" fill="url(#rzs)" pointer-events="none"/>`;
    root.querySelectorAll('.rz-b').forEach((g) => { g.onclick = () => { st.active = Number(g.dataset.i); paint(); }; });
    const v = value();
    $('#rz-val', root).textContent = `${si(v.ohm, 'Ω')} ±${dec(v.tol, 2)} %`;
    $('#rz-sub', root).textContent = `rozsah ${si(v.ohm * (1 - v.tol / 100), 'Ω')} – ${si(v.ohm * (1 + v.tol / 100), 'Ω')}${v.tc ? ` · ${v.tc} ppm/K` : ''}`;
    const kind = kinds[st.active];
    $('#rz-bn', root).innerHTML = `${st.active + 1}. prúžok – <b>${BAND_NAME[kind]}</b>`;
    $('#rz-pal', root).innerHTML = valid(kind, st.active).map((c) => {
      const lbl = kind === 'd' ? c.d : kind === 'm' ? '×' + si(c.m, '').trim() : kind === 'tol' ? `±${dec(c.tol, 2)}%` : `${c.tc}`;
      return `<button class="rz-sw ${st.bands[st.active] === c.id ? 'on' : ''}" data-c="${c.id}" style="--sw:${c.hex}" title="${c.name}"><i></i><span>${lbl}</span><small>${c.name}</small></button>`;
    }).join('');
    root.querySelectorAll('.rz-sw').forEach((b) => {
      b.onclick = () => { st.bands[st.active] = b.dataset.c; if (st.active < kinds.length - 1) st.active++; paint(); };
    });
  };
  fixBands();
  paint();

  // naopak: hodnota → farby
  const parseR = (s) => {
    s = String(s).trim().replace(/\s|Ω|ohm/gi, '').replace(',', '.');
    const m = s.match(/^(\d*\.?\d*)([rRkKmMgG]?)(\d*)$/);
    if (!m || (!m[1] && !m[3])) return null;
    const mult = { '': 1, r: 1, k: 1e3, m: 1e6, g: 1e9 }[m[2].toLowerCase()];
    const n = parseFloat((m[1] || '0') + (m[3] ? (m[1].includes('.') ? '' : '.') + m[3] : ''));
    return Number.isFinite(n) && n > 0 ? n * mult : null;
  };
  $('#rz-in', root).oninput = (e) => {
    const out = $('#rz-rev-out', root);
    const r = parseR(e.target.value);
    if (r == null) { out.innerHTML = '<span class="tl-muted">Napíš hodnotu a ukážem farby prúžkov.</span>'; return; }
    const exp = Math.floor(Math.log10(r));
    const m = r / 10 ** exp; // 1 ≤ m < 10
    const two = Math.round(m * 10) / 10;
    const three = Math.round(m * 100) / 100;
    const n = Math.abs(two - m) < 1e-9 ? 4 : 5;
    const digits = n === 4 ? String(Math.round(two * 10)).padStart(2, '0').split('').map(Number) : String(Math.round(three * 100)).padStart(3, '0').split('').map(Number);
    const mulExp = exp - (digits.length - 1);
    const mc = COLORS.find((c) => c.m != null && Math.abs(Math.log10(c.m) - mulExp) < 1e-9);
    if (!mc || digits[0] === 0) { out.innerHTML = '<span class="tl-err">Túto hodnotu nejde zapísať farebným kódom.</span>'; return; }
    const cols = [...digits.map((d) => COLORS.find((c) => c.d === d)), mc];
    const inE = (E) => E.some((x) => Math.abs(x - Math.round(m * 100) / 100) < 1e-6);
    const near = E24.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a)) * 10 ** exp;
    out.innerHTML = `<div class="rz-rev-cols">${cols.map((c) => `<span style="--sw:${c.hex}"><i></i>${c.name}</span>`).join('')}<span class="plus">+ tolerancia</span></div>
      <div class="tl-muted">${n === 4 ? '4 prúžky (2 číslice)' : '5 prúžkov (3 číslice)'} · ${inE(E12) ? 'rada E12' : inE(E24) ? 'rada E24' : `nie je v rade E24 – najbližšie ${si(near, 'Ω')}`}</div>
      <button class="btn ghost block" id="rz-use">Nastaviť na rezistor hore</button>`;
    $('#rz-use', root).onclick = () => {
      st.n = n === 4 ? 4 : Math.max(st.n, 5);
      const tol = st.bands[BANDS[st.n].indexOf('tol')];
      BANDS[st.n].forEach((k, i) => { if (k === 'd' || k === 'm') st.bands[i] = cols[i].id; });
      if (n === 4) st.bands[3] = CBY[tol]?.tol ? tol : 'gold';
      root.querySelectorAll('input[name=bn]').forEach((x) => { x.checked = Number(x.value) === st.n; });
      fixBands(); paint(); window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  };
}

/* ---------- prierez vodiča ---------- */
// Dovolené prúdové zaťaženie Iz [A], Cu, izolácia PVC 70 °C, okolie 30 °C (STN 33 2000-5-52, tab. B.52.2 a B.52.4)
const SECT = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120];
const IZ = {
  A1: { 2: [14.5, 19.5, 26, 34, 46, 61, 80, 99, 119, 151, 182, 210], 3: [13.5, 18, 24, 31, 42, 56, 73, 89, 108, 136, 164, 188] },
  B1: { 2: [17.5, 24, 32, 41, 57, 76, 101, 125, 151, 192, 232, 269], 3: [15.5, 21, 28, 36, 50, 68, 89, 110, 134, 171, 207, 239] },
  B2: { 2: [16.5, 23, 30, 38, 52, 69, 90, 111, 133, 168, 201, 232], 3: [15, 20, 27, 34, 46, 62, 80, 99, 118, 149, 179, 206] },
  C: { 2: [19.5, 27, 36, 46, 63, 85, 112, 138, 168, 213, 258, 299], 3: [17.5, 24, 32, 41, 57, 76, 96, 119, 144, 184, 223, 259] },
  E: { 2: [22, 30, 40, 51, 70, 94, 119, 148, 180, 232, 282, 328], 3: [18.5, 25, 34, 43, 60, 80, 101, 126, 153, 196, 238, 276] },
};
const METHODS = [
  ['C', 'C – kábel priamo na stene / pod omietkou'],
  ['B2', 'B2 – kábel v trubke alebo lište na stene'],
  ['B1', 'B1 – jednožilové vodiče v trubke na stene'],
  ['A1', 'A1 – v trubke v tepelne izolovanej stene'],
  ['E', 'E – kábel vo voľnom vzduchu / na rošte'],
];
const TEMP = [[25, 1.03], [30, 1], [35, 0.94], [40, 0.87], [45, 0.79], [50, 0.71]];
const GROUP = [1, 0.8, 0.7, 0.65, 0.6, 0.57, 0.54, 0.52, 0.5];
const BREAKERS = [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250];
const RHO = 0.0225; // Cu pri prevádzkovej teplote [Ω·mm²/m]

function cableTool(root) {
  const def = { net: '1', by: 'I', I: '16', P: '3,5', cos: '1', L: '25', method: 'C', temp: '30', group: '1', drop: '5' };
  const v = { ...def, ...C.store.get('tool:cable', {}) };
  const seg = (name, opts) => `<div class="seg tl-seg" data-seg="${name}" style="grid-template-columns:repeat(${opts.length},1fr)">${opts.map(([val, lbl]) => `<label><input type="radio" name="${name}" value="${val}" ${v[name] === val ? 'checked' : ''}><span>${lbl}</span></label>`).join('')}</div>`;
  root.innerHTML = `
    <div class="tl-card glass">
      ${seg('net', [['1', '1f · 230 V'], ['3', '3f · 400 V']])}
      ${seg('by', [['I', 'Zadám prúd'], ['P', 'Zadám výkon']])}
      <div class="row">
        <div class="field" data-show="I"><label>Prúd I<sub>b</sub> [A]</label><input name="I" inputmode="decimal" value="${v.I}"></div>
        <div class="field" data-show="P"><label>Výkon P [kW]</label><input name="P" inputmode="decimal" value="${v.P}"></div>
        <div class="field"><label>cos φ</label><input name="cos" inputmode="decimal" value="${v.cos}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Dĺžka vedenia [m]</label><input name="L" inputmode="decimal" value="${v.L}"></div>
        <div class="field"><label>Max. úbytok napätia</label><select name="drop"><option value="3" ${v.drop === '3' ? 'selected' : ''}>3 % – osvetlenie</option><option value="5" ${v.drop === '5' ? 'selected' : ''}>5 % – ostatné</option></select></div>
      </div>
      <div class="field"><label>Spôsob uloženia</label><select name="method">${METHODS.map(([k, n]) => `<option value="${k}" ${v.method === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="row">
        <div class="field"><label>Teplota okolia</label><select name="temp">${TEMP.map(([t]) => `<option value="${t}" ${String(t) === v.temp ? 'selected' : ''}>${t} °C</option>`).join('')}</select></div>
        <div class="field"><label>Obvodov vedľa seba</label><select name="group">${GROUP.map((_, i) => `<option value="${i + 1}" ${String(i + 1) === v.group ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div>
      </div>
    </div>
    <div id="cb-out"></div>
    <p class="tl-disc">Orientačný výpočet pre medené vodiče s izoláciou PVC podľa STN 33 2000-5-52. Nenahrádza projekt ani revíziu – skontroluj aj podmienky samočinného odpojenia (impedanciu slučky).</p>`;

  const form = root.querySelector('.tl-card');
  const read = () => {
    form.querySelectorAll('input[type=radio]:checked').forEach((r) => { v[r.name] = r.value; });
    form.querySelectorAll('input:not([type=radio]), select').forEach((e) => { v[e.name] = e.value; });
    C.store.set('tool:cable', v);
  };
  const calc = () => {
    read();
    form.querySelectorAll('[data-show]').forEach((e) => { e.hidden = e.dataset.show !== v.by; });
    const out = $('#cb-out', root);
    const three = v.net === '3';
    const U = three ? 400 : 230;
    const cos = Math.min(1, Math.max(0.1, num(v.cos) ?? 1));
    const L = num(v.L);
    const Ib = v.by === 'I' ? num(v.I) : (num(v.P) ?? NaN) * 1000 / ((three ? Math.sqrt(3) : 1) * U * cos);
    if (!(Ib > 0) || !(L > 0)) { out.innerHTML = '<div class="tl-card glass tl-muted">Doplň prúd (alebo výkon) a dĺžku vedenia.</div>'; return; }
    const In = BREAKERS.find((b) => b >= Ib);
    const kT = TEMP.find(([t]) => String(t) === v.temp)[1];
    const kG = GROUP[Number(v.group) - 1];
    const iz = IZ[v.method][three ? 3 : 2].map((x) => x * kT * kG);
    const dropPct = (S) => {
      const dU = (three ? Math.sqrt(3) : 2) * L * Ib * RHO * cos / S;
      return (dU / U) * 100;
    };
    const maxDrop = Number(v.drop);
    const rows = SECT.map((S, i) => ({ S, Iz: iz[i], d: dropPct(S), okI: In != null && iz[i] >= In, okD: dropPct(S) <= maxDrop }));
    const pick = rows.find((r) => r.okI && r.okD);
    const byI = rows.find((r) => r.okI);
    const cores = three ? 5 : 3;
    if (!pick) {
      out.innerHTML = `<div class="tl-card glass"><span class="tl-err">Na takýto prúd/dĺžku nestačí ani 120 mm² – treba projekt (paralelné káble, iné uloženie).</span></div>`;
      return;
    }
    const why = byI && byI.S !== pick.S ? `Pre prúd by stačilo ${dec(byI.S, 1)} mm², ale kvôli úbytku napätia na ${dec(L, 0)} m treba väčší prierez.` : 'Rozhoduje dovolené prúdové zaťaženie.';
    out.innerHTML = `
      <div class="cb-res glass">
        <div class="cb-main"><span>Odporúčaný prierez</span><b>${dec(pick.S, 1)} <small>mm² Cu</small></b><em>napr. CYKY-J ${cores}×${dec(pick.S, 1)}</em></div>
        <div class="cb-kpis">
          <div><span>Prúd I<sub>b</sub></span><b>${sig(Ib)} A</b></div>
          <div><span>Istič I<sub>n</sub></span><b>${In} A</b></div>
          <div><span>Zaťaž. I<sub>z</sub></span><b>${sig(pick.Iz)} A</b></div>
          <div><span>Úbytok</span><b class="${pick.d > maxDrop ? 'bad' : ''}">${dec(pick.d, 2)} %</b></div>
        </div>
        <div class="cb-why">${why}</div>
        ${pick.S < 2.5 && !three ? '<div class="cb-cond">💡 V praxi: zásuvkové obvody min. 2,5 mm² (istič 16 A), osvetlenie 1,5 mm² (istič 10 A).</div>' : ''}
        <div class="cb-cond">I<sub>b</sub> ${sig(Ib)} A ≤ I<sub>n</sub> ${In} A ≤ I<sub>z</sub> ${sig(pick.Iz)} A ✓ · korekcia teplota ×${dec(kT, 2)}, zoskupenie ×${dec(kG, 2)}</div>
      </div>
      <div class="section-title">Porovnanie prierezov</div>
      <div class="cb-table glass">
        <div class="h"><span>mm²</span><span>I<sub>z</sub></span><span>úbytok</span><span></span></div>
        ${rows.slice(0, Math.min(rows.length, rows.indexOf(pick) + 3)).map((r) => `<div class="${r === pick ? 'pick' : ''}">
          <span>${dec(r.S, 1)}</span><span class="${r.okI ? '' : 'bad'}">${sig(r.Iz)} A</span>
          <span class="${r.okD ? '' : 'bad'}">${dec(r.d, 2)} %</span><span>${r === pick ? '✔' : r.okI && r.okD ? '' : '✕'}</span></div>`).join('')}
      </div>`;
  };
  form.addEventListener('input', calc);
  form.addEventListener('change', calc);
  calc();
}
