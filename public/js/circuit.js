/* =========================================================
   Projekt – schéma zapojenia a návrh plošného spoja (DPS).
   Schému (súčiastky + spoje) navrhne asistent, aplikácia ju
   nakreslí, rozmiestni súčiastky na dosku, natrasuje spoje
   a vyexportuje PDF (schéma, predloha 1:1) a Gerber pre výrobu.
   ========================================================= */
let C;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => C.esc(s);

/* ---------- vývody súčiastok ---------- */
const TWO = ['1', '2'];
const FIXED = {
  resistor: TWO, ldr: TWO, thermistor: TWO, capacitor: TWO, inductor: TWO, switch: TWO, button: TWO,
  speaker: TWO, motor: TWO, fuse: TWO, crystal: TWO,
  electrolytic: ['+', '-'], battery: ['+', '-'], buzzer: ['+', '-'],
  diode: ['A', 'K'], zener: ['A', 'K'], led: ['A', 'K'], pot: ['A', 'W', 'B'],
};
const TRANS = { npn: ['E', 'B', 'C'], pnp: ['E', 'B', 'C'], nmos: ['G', 'D', 'S'], pmos: ['G', 'D', 'S'] };
const ALIAS = {
  '+': ['POS', 'PLUS', 'A', 'ANODE', 'VCC', 'V+', 'RED'], '-': ['NEG', 'MINUS', 'K', 'C', 'CATHODE', 'GND', 'V-', 'BLACK'],
  A: ['+', 'ANODE', 'P', 'CW'], K: ['-', 'C', 'CATHODE', 'N'], W: ['WIPER', 'S', 'SLIDER'], B: ['CCW', 'BASE'],
  C: ['COLLECTOR'], E: ['EMITTER'], G: ['GATE'], D: ['DRAIN'], S: ['SOURCE'],
};
const KIND_NAMES = {
  resistor: 'Rezistor', pot: 'Potenciometer', ldr: 'Fotorezistor', thermistor: 'Termistor', capacitor: 'Kondenzátor',
  electrolytic: 'Elektrolytický kondenzátor', inductor: 'Cievka', diode: 'Dióda', zener: 'Zenerova dióda', led: 'LED',
  npn: 'Tranzistor NPN', pnp: 'Tranzistor PNP', nmos: 'MOSFET N', pmos: 'MOSFET P', switch: 'Spínač', button: 'Tlačidlo',
  battery: 'Batéria', buzzer: 'Bzučiak', speaker: 'Reproduktor', motor: 'Motor', fuse: 'Poistka', crystal: 'Kryštál',
  ic: 'Integrovaný obvod', module: 'Modul', connector: 'Konektor',
};
const up = (s) => String(s ?? '').trim().toUpperCase().replace(/[−–]/g, '-');

function pinNames(p) {
  if (FIXED[p.kind]) return FIXED[p.kind];
  if (TRANS[p.kind]) {
    const def = TRANS[p.kind];
    const got = (p.pins || []).map(up);
    return got.length === 3 && def.every((x) => got.includes(x)) ? got : def;
  }
  return (p.pins || []).map(String);
}

function resolvePin(names, token) {
  const t = up(token);
  if (/^\d+$/.test(t) && +t >= 1 && +t <= names.length) return +t - 1;
  const U = names.map(up);
  let i = U.indexOf(t);
  if (i >= 0) return i;
  i = U.findIndex((n) => n.split('/').includes(t));
  if (i >= 0) return i;
  for (const [canon, list] of Object.entries(ALIAS)) {
    if (list.includes(t) && U.includes(canon)) return U.indexOf(canon);
  }
  i = U.findIndex((n) => n.replace(/\d+$/, '') === t);
  return i;
}

const PALETTE = ['#2f7de1', '#e0832f', '#16a34a', '#a855f7', '#0891b2', '#d97706', '#db2777', '#4f46e5', '#65a30d', '#0d9488', '#c2410c', '#7c3aed'];
const isGnd = (n) => /^(GND|0V|VSS|ZEM|AGND|DGND)\d*$/i.test(n) || /^-$/.test(n);
const isSupply = (n) => /^(\+|VCC|VDD|VIN|V\+|VBAT|VBUS|VSYS|\d+V\d*$)/i.test(n);

// spracovaná schéma: súčiastky s vývodmi, spoje s vyriešenými vývodmi, upozornenia
function model(circ) {
  const warn = [];
  const parts = (circ.parts || []).map((p) => ({ ...p, names: pinNames(p) }));
  const byRef = Object.fromEntries(parts.map((p) => [p.ref, p]));
  // IO bez zoznamu vývodov: doplň z odkazov v spojoch
  for (const p of parts) {
    if (p.names.length) continue;
    const toks = [];
    for (const n of circ.nets || []) for (const nd of n.nodes) { const [r, ...pin] = nd.split('.'); if (r === p.ref) toks.push(pin.join('.')); }
    const nums = toks.filter((t) => /^\d+$/.test(t)).map(Number);
    const max = Math.max(0, ...nums);
    p.names = Array.from({ length: max }, (_, i) => String(i + 1));
    toks.filter((t) => !/^\d+$/.test(t)).forEach((t) => { if (!p.names.map(up).includes(up(t))) p.names.push(t); });
  }
  const pinNet = new Map();
  const nets = [];
  let pal = 0;
  for (const n of circ.nets || []) {
    const net = { name: n.name, i: nets.length, nodes: [] };
    net.color = isGnd(n.name) ? '#6b7280' : isSupply(n.name) ? '#dc2626' : PALETTE[pal++ % PALETTE.length];
    for (const nd of n.nodes) {
      const dot = nd.indexOf('.');
      const ref = nd.slice(0, dot), pin = nd.slice(dot + 1);
      const p = byRef[ref];
      if (!p) { warn.push(`Spoj ${n.name}: neznáma súčiastka ${ref}`); continue; }
      const idx = resolvePin(p.names, pin);
      if (idx < 0) { warn.push(`Spoj ${n.name}: ${ref} nemá vývod „${pin}“`); continue; }
      const key = `${ref}#${idx}`;
      if (pinNet.has(key)) {
        if (pinNet.get(key) !== net.i) warn.push(`Vývod ${ref}.${p.names[idx]} je vo viacerých spojoch (${nets[pinNet.get(key)]?.name} a ${n.name})`);
        continue;
      }
      pinNet.set(key, net.i);
      net.nodes.push({ ref, pin: idx });
    }
    if (net.nodes.length >= 2) nets.push(net);
    else if (net.nodes.length) { pinNet.delete(`${net.nodes[0].ref}#${net.nodes[0].pin}`); warn.push(`Spoj ${n.name} má len jeden vývod`); }
  }
  return { parts, byRef, nets, pinNet, warn };
}

/* =========================================================
   Schéma – značky a rozloženie
   ========================================================= */
const textW = (s, fs = 11) => String(s).length * fs * 0.6 + 6;

// značka v lokálnych súradniciach: {w, h, pins: {idx: [x, y, smer]}, body}
function symbol(p, fg) {
  const k = p.kind, N = p.names;
  const at = (name) => N.map(up).indexOf(name);
  const two = (body, extra = {}) => ({ w: 60, h: 24, pins: { 0: [0, 12, 'l'], 1: [60, 12, 'r'] }, body, ...extra });
  const fill = `fill="${fg}"`;
  switch (k) {
    case 'resistor': return two('<path d="M0 12H14M46 12H60"/><rect x="14" y="6" width="32" height="12"/>');
    case 'fuse': return two('<path d="M0 12H60"/><rect x="14" y="7" width="32" height="10"/>');
    case 'ldr': return two(`<path d="M0 12H14M46 12H60"/><rect x="14" y="6" width="32" height="12"/><path d="M16 -10L24 -1M20 -2.5L24 -1L23.5 -5M26 -12L34 -3M30 -4.5L34 -3L33.5 -7"/>`);
    case 'thermistor': return two(`<path d="M0 12H14M46 12H60"/><rect x="14" y="6" width="32" height="12"/><path d="M10 24L20 18H44L52 0"/><text x="50" y="30" font-size="9" stroke="none" ${fill}>t°</text>`);
    case 'capacitor': return two('<path d="M0 12H27M33 12H60M27 1V23M33 1V23"/>');
    case 'electrolytic': return two(`<path d="M0 12H26M34 12H60M26 1V23"/><rect x="32" y="1" width="4" height="22" ${fill}/><text x="16" y="5" font-size="11" stroke="none" ${fill}>+</text>`);
    case 'inductor': return two('<path d="M0 12H12M48 12H60M12 12a4.5 4.5 0 0 1 9 0a4.5 4.5 0 0 1 9 0a4.5 4.5 0 0 1 9 0a4.5 4.5 0 0 1 9 0"/>');
    case 'diode': return two(`<path d="M0 12H22M38 12H60M38 3V21"/><path d="M22 3L38 12L22 21Z" ${fill}/>`);
    case 'zener': return two(`<path d="M0 12H22M38 12H60M34 0L38 3V21L42 24"/><path d="M22 3L38 12L22 21Z" ${fill}/>`);
    case 'led': return two(`<path d="M0 12H22M38 12H60M38 3V21"/><path d="M22 3L38 12L22 21Z" ${fill}/><path d="M30 0L37 -7M33 -7H37V-3M37 2L44 -5M40 -5H44V-1"/>`);
    case 'crystal': return two('<path d="M0 12H22M38 12H60M22 4V20M38 4V20"/><rect x="26" y="2" width="8" height="20"/>');
    case 'switch': return two(`<path d="M0 12H17.5M42.5 12H60M22 10.5L40 1"/><circle cx="20" cy="12" r="2.5"/><circle cx="40" cy="12" r="2.5"/>`);
    case 'button': return two(`<path d="M0 12H17.5M42.5 12H60M16 4H44M30 4V-4"/><circle cx="20" cy="12" r="2.5"/><circle cx="40" cy="12" r="2.5"/>`);
    case 'battery': return two(`<path d="M0 12H26M34 12H60M26 0V24"/><path d="M34 6V18" stroke-width="4"/><text x="16" y="5" font-size="11" stroke="none" ${fill}>+</text>`);
    case 'buzzer': return two(`<path d="M0 12H20M40 12H60M20 12V2H40V12M20 2A10 10 0 0 1 40 2"/><text x="12" y="5" font-size="11" stroke="none" ${fill}>+</text>`);
    case 'speaker': return two('<path d="M0 12H22M38 12H60"/><rect x="22" y="6" width="8" height="12"/><path d="M30 6L38 0V24L30 18"/>');
    case 'motor': return two(`<path d="M0 12H20M40 12H60"/><circle cx="30" cy="12" r="10"/><text x="30" y="16" font-size="11" text-anchor="middle" stroke="none" ${fill}>M</text>`);
    case 'pot': return { w: 60, h: 40, pins: { [at('A')]: [0, 12, 'l'], [at('B')]: [60, 12, 'r'], [at('W')]: [30, 40, 'd'] },
      body: `<path d="M0 12H14M46 12H60M30 40V24"/><rect x="14" y="6" width="32" height="12"/><path d="M30 18L26 25H34Z" ${fill}/>` };
    case 'npn': case 'pnp': {
      const npn = k === 'npn';
      const arrow = npn ? '<path d="M37 46.2L30.3 45.7L33.4 40.5Z"/>' : '<path d="M24.3 38.6L27.9 44.2L31 39.1Z"/>';
      return { w: 50, h: 60, pins: { [at('B')]: [0, 30, 'l'], [at('C')]: [40, 0, 'u'], [at('E')]: [40, 60, 'd'] },
        body: `<circle cx="30" cy="30" r="19"/><path d="M0 30H20M20 24L40 12V0M20 36L40 48V60"/><path d="M20 17V43" stroke-width="3.5"/><g ${fill} stroke="none">${arrow}</g>` };
    }
    case 'nmos': case 'pmos': {
      const arrow = k === 'nmos' ? '<path d="M21 30L28 26.5V33.5Z"/>' : '<path d="M30 30L23 26.5V33.5Z"/>';
      return { w: 50, h: 60, pins: { [at('G')]: [0, 40, 'l'], [at('D')]: [40, 0, 'u'], [at('S')]: [40, 60, 'd'] },
        body: `<circle cx="28" cy="30" r="20"/><path d="M0 40H14M14 20V40M20 15V24M20 26V34M20 36V45M20 20H40V0M20 40H40V60M20 30H40V40"/><g ${fill} stroke="none">${arrow}</g>` };
    }
    default: return boxSymbol(p, fg);
  }
}

function boxSymbol(p, fg) {
  const N = p.names, n = N.length;
  const single = n <= 6;
  const L = single ? n : Math.ceil(n / 2);
  const left = [], right = [];
  N.forEach((nm, i) => {
    if (single || i < L) left.push([i, left.length]);
    else right.push([i, n - 1 - i]);
  });
  const rows = Math.max(1, single ? n : Math.max(L, n - L));
  const lw = Math.max(0, ...left.map(([i]) => textW(N[i], 10))), rw = Math.max(0, ...right.map(([i]) => textW(N[i], 10)));
  const bw = Math.max(64, lw + rw + 16);
  const bh = rows * 20 + 10;
  const pins = {};
  let body = `<rect x="24" y="0" width="${bw}" height="${bh}" fill="none"/>`;
  for (const [i, r] of left) {
    const y = 15 + r * 20;
    pins[i] = [0, y, 'l'];
    body += `<path d="M0 ${y}H24"/><text x="28" y="${y + 3.5}" font-size="10" stroke="none" fill="${fg}">${esc(N[i])}</text><text x="12" y="${y - 3}" font-size="8" text-anchor="middle" stroke="none" fill="${fg}" opacity=".6">${i + 1}</text>`;
  }
  for (const [i, r] of right) {
    const y = 15 + r * 20, x = 24 + bw;
    pins[i] = [x + 24, y, 'r'];
    body += `<path d="M${x} ${y}H${x + 24}"/><text x="${x - 4}" y="${y + 3.5}" font-size="10" text-anchor="end" stroke="none" fill="${fg}">${esc(N[i])}</text><text x="${x + 12}" y="${y - 3}" font-size="8" text-anchor="middle" stroke="none" fill="${fg}" opacity=".6">${i + 1}</text>`;
  }
  return { w: bw + 48, h: bh, pins, body, box: true };
}

function labelFor(net) {
  if (isGnd(net.name)) return { w: 22, gnd: true };
  return { w: textW(net.name, 11) + 8 };
}

function layoutSchematic(M, fg) {
  const items = M.parts.map((p) => {
    const s = symbol(p, fg);
    const m = { l: 10, r: 10, t: s.box ? 26 : 20, b: s.box ? 10 : 18 };
    for (const [idx, [, , d]] of Object.entries(s.pins)) {
      const ni = M.pinNet.get(`${p.ref}#${idx}`);
      const lw = ni === undefined ? 12 : labelFor(M.nets[ni]).w + 14;
      if (d === 'l') m.l = Math.max(m.l, lw); else if (d === 'r') m.r = Math.max(m.r, lw);
      else if (d === 'u') m.t = Math.max(m.t, 34); else m.b = Math.max(m.b, ni !== undefined && isGnd(M.nets[ni].name) ? 40 : 34);
    }
    if (!s.box) m.r = Math.max(m.r, ['npn', 'pnp', 'nmos', 'pmos'].includes(p.kind) ? textW(p.value || p.name, 10) + 8 : m.r);
    return { p, s, m, W: s.w + m.l + m.r, H: s.h + m.t + m.b };
  });
  const order = { box: 0, tr: 1, two: 2 };
  const grp = (it) => (it.s.box ? 'box' : ['npn', 'pnp', 'nmos', 'pmos'].includes(it.p.kind) ? 'tr' : 'two');
  items.sort((a, b) => order[grp(a)] - order[grp(b)] || a.p.ref.localeCompare(b.p.ref, 'en', { numeric: true }));
  const SW = Math.max(560, ...items.map((i) => i.W));
  let x = 0, y = 0, rowH = 0, W = 0;
  for (const it of items) {
    if (x > 0 && x + it.W > SW) { x = 0; y += rowH + 14; rowH = 0; }
    it.x = x + it.m.l; it.y = y + it.m.t;
    x += it.W + 14; rowH = Math.max(rowH, it.H); W = Math.max(W, x);
  }
  return { items, W: Math.max(W, 200), H: y + rowH + 10 };
}

function drawSchematic(M, theme) {
  const { fg, muted } = theme;
  const Lo = layoutSchematic(M, fg);
  let out = '';
  for (const it of Lo.items) {
    const { p, s } = it;
    out += `<g transform="translate(${it.x} ${it.y})"><g stroke="${fg}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round">${s.body}</g>`;
    const val = [p.value, s.box ? p.name : ''].filter(Boolean).join(' · ') || p.name || '';
    if (s.box) out += `<text x="24" y="-8" font-size="12" font-weight="700" fill="${fg}">${esc(p.ref)} <tspan font-weight="400" fill="${muted}">${esc(p.name || '')}</tspan></text>`;
    else if (['npn', 'pnp', 'nmos', 'pmos'].includes(p.kind)) out += `<text x="${s.w + 4}" y="26" font-size="12" font-weight="700" fill="${fg}">${esc(p.ref)}</text><text x="${s.w + 4}" y="40" font-size="10" fill="${muted}">${esc(p.value || p.name || '')}</text>`;
    else out += `<text x="30" y="${p.kind === 'led' || p.kind === 'ldr' ? -14 : -6}" font-size="12" font-weight="700" text-anchor="middle" fill="${fg}">${esc(p.ref)}</text><text x="30" y="${s.h + 14}" font-size="10" text-anchor="middle" fill="${muted}">${esc(val)}</text>`;
    // vývody → spoje
    for (const [idx, [px, py, d]] of Object.entries(s.pins)) {
      const ni = M.pinNet.get(`${p.ref}#${idx}`);
      if (ni === undefined) {
        out += `<path d="M${px - 3} ${py - 3}l6 6m0 -6l-6 6" stroke="${muted}" stroke-width="1.2"/>`;
        continue;
      }
      const net = M.nets[ni];
      const [dx, dy] = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] }[d];
      const ex = px + dx * 10, ey = py + dy * 10;
      out += `<g data-net="${ni}" class="sch-net"><path d="M${px} ${py}L${ex} ${ey}" stroke="${net.color}" stroke-width="2"/><circle cx="${ex}" cy="${ey}" r="2.2" fill="${net.color}"/>`;
      if (isGnd(net.name)) {
        const gx = d === 'l' ? ex - 8 : d === 'r' ? ex + 8 : ex;
        const gy = d === 'u' ? ey - 16 : ey;
        out += `<path d="M${ex} ${ey}L${gx} ${ey}L${gx} ${gy + 8}M${gx - 8} ${gy + 8}H${gx + 8}M${gx - 5} ${gy + 11.5}H${gx + 5}M${gx - 2} ${gy + 15}H${gx + 2}" stroke="${net.color}" stroke-width="1.8" fill="none"/>`;
      } else {
        const anchor = d === 'l' ? 'end' : d === 'r' ? 'start' : 'middle';
        const tx = ex + dx * 4, ty = d === 'u' ? ey - 6 : d === 'd' ? ey + 14 : ey + 4;
        out += `<text x="${tx}" y="${ty}" font-size="11" font-weight="700" text-anchor="${anchor}" fill="${net.color}">${isSupply(net.name) ? '▲ ' : ''}${esc(net.name)}</text>`;
      }
      out += '</g>';
    }
    out += '</g>';
  }
  return { svg: out, W: Lo.W, H: Lo.H };
}

function schematicSVG(M, theme, attrs = '') {
  const { svg, W, H } = drawSchematic(M, theme);
  return { W, H, html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -8 ${W + 24} ${H + 16}" width="${W + 24}" height="${H + 16}" font-family="Arial, Helvetica, sans-serif" ${attrs}>${theme.bg ? `<rect x="-12" y="-8" width="${W + 24}" height="${H + 16}" fill="${theme.bg}"/>` : ''}${svg}</svg>` };
}

/* =========================================================
   Plošný spoj – puzdrá (mm, stred súčiastky = 0,0)
   ========================================================= */
const G = 0.635;          // mriežka trasovania (súčiastky sa prichytávajú na 1,27 mm)
const TW = 0.8;           // šírka spoja
const CLR = 0.35;         // izolačná medzera
const EDGE = 0.9;         // odstup od okraja dosky

function defaultPkg(p) {
  const k = p.kind, n = p.names.length;
  if (['resistor', 'diode', 'zener', 'fuse', 'inductor'].includes(k)) return 'AXIAL';
  if (['capacitor', 'ldr', 'thermistor', 'electrolytic'].includes(k)) return 'RAD2';
  if (k === 'crystal' || k === 'buzzer') return 'RAD5';
  if (k === 'led') return 'LED';
  if (k === 'pot') return 'POT';
  if (TRANS[k]) return 'TO92';
  if (k === 'button') return 'BTN';
  if (['battery', 'motor', 'speaker'].includes(k)) return 'TERM2';
  if (k === 'switch') return 'HDR';
  if (k === 'ic' && n >= 4 && n <= 40 && n % 2 === 0) return 'DIP';
  if (k === 'ic' && n === 3) return 'TO92';
  return 'HDR';
}
const PKGS = ['AXIAL', 'RAD2', 'RAD5', 'LED', 'POT', 'TO92', 'TO126', 'TO220', 'DIP', 'HDR', 'TERM2', 'BTN', 'RELAY'];

function pkgOf(p) {
  let pk = up(p.pkg).replace(/[^A-Z0-9]/g, '');
  if (pk.startsWith('DIP')) pk = 'DIP';
  if (pk.startsWith('HDR') || pk.startsWith('HEADER') || pk === 'PINHEADER') pk = 'HDR';
  if (!PKGS.includes(pk)) pk = defaultPkg(p);
  const n = p.names.length;
  // nezmyselné kombinácie (napr. 2-vývodový DIP) nahraď predvoleným puzdrom
  if (['TO92', 'TO126', 'TO220', 'POT'].includes(pk) && n !== 3) pk = n === 2 ? 'RAD2' : 'HDR';
  if (['AXIAL', 'RAD2', 'RAD5', 'LED', 'TERM2', 'BTN'].includes(pk) && n !== 2) pk = n === 3 ? 'TO92' : 'HDR';
  if (pk === 'RELAY' && n !== 5) pk = 'HDR';
  return pk;
}

// {pads:[{pin,x,y,d,drill,sq}], silk:[...], bb:[x0,y0,x1,y1]}
const FP = new WeakMap();
function footprint(p) {
  if (FP.has(p)) return FP.get(p);
  const fp = footprintRaw(p);
  FP.set(p, fp);
  return fp;
}
function footprintRaw(p) {
  const pk = pkgOf(p), N = p.names, n = N.length;
  const pads = [], silk = [];
  const pad = (pin, x, y, d = 1.7, drill = 0.8, sq = false) => pads.push({ pin, x, y, d, drill, sq });
  const rect = (x, y, w, h) => silk.push({ t: 'rect', x, y, w, h });
  const circ = (cx, cy, r) => silk.push({ t: 'circle', cx, cy, r });
  const line = (x1, y1, x2, y2) => silk.push({ t: 'line', x1, y1, x2, y2 });
  const plus = (x, y) => { line(x - 0.6, y, x + 0.6, y); line(x, y - 0.6, x, y + 0.6); };
  const ia = (name) => N.map(up).indexOf(name);
  switch (pk) {
    case 'AXIAL':
      pad(0, -5.08, 0, 1.8, 0.8, true); pad(1, 5.08, 0, 1.8, 0.8);
      rect(-3.3, -1.3, 6.6, 2.6); line(-3.3, 0, -4, 0); line(3.3, 0, 4, 0);
      if (['diode', 'zener'].includes(p.kind)) { line(2.3, -1.3, 2.3, 1.3); line(2.7, -1.3, 2.7, 1.3); }
      if (p.kind === 'fuse') line(-3.3, 0, 3.3, 0);
      break;
    case 'RAD2': case 'LED':
      pad(0, -1.27, 0, 1.6, 0.8, true); pad(1, 1.27, 0, 1.6, 0.8);
      if (pk === 'LED' || p.kind === 'electrolytic') circ(0, 0, 2.7); else rect(-2.5, -1.4, 5, 2.8);
      if (pk === 'LED') { const a = ia('A'); plus(a === 1 ? 2.4 : -2.4, -2.6); line(2.2, -1.6, 2.2, 1.6); }
      if (p.kind === 'electrolytic') plus(-2.4, -2.6);
      break;
    case 'RAD5':
      pad(0, -2.54, 0, 1.9, 0.9, true); pad(1, 2.54, 0, 1.9, 0.9);
      if (p.kind === 'crystal') rect(-5.2, -2.3, 10.4, 4.6); else circ(0, 0, 4.4);
      if (['buzzer', 'electrolytic'].includes(p.kind)) plus(-2.54, -3.2);
      break;
    case 'POT':
      N.forEach((_, i) => pad(i, (i - 1) * 5.08, 0, 2, 1.0, i === 0));
      rect(-6.5, -8.5, 13, 10); circ(0, -4, 2.5);
      break;
    case 'TO92':
      N.forEach((_, i) => pad(i, (i - 1) * 2.54, 0, 1.5, 0.75, i === 0));
      silk.push({ t: 'arc', cx: 0, cy: 0, r: 2.9 }); line(-2.6, 1.6, 2.6, 1.6);
      break;
    case 'TO126': case 'TO220':
      N.forEach((_, i) => pad(i, (i - 1) * 2.54, 0, pk === 'TO220' ? 2 : 1.8, 1.0, i === 0));
      rect(-5.2, -3.6, 10.4, 4.8); line(-5.2, -2.4, 5.2, -2.4);
      break;
    case 'TERM2':
      pad(0, -2.54, 0, 2.4, 1.2, true); pad(1, 2.54, 0, 2.4, 1.2);
      rect(-5, -3.8, 10, 7.6); if (['battery'].includes(p.kind) || up(N[0]) === '+') plus(-2.54, -2.6);
      break;
    case 'BTN':
      pad(0, -3.25, -2.25, 1.8, 1.0, true); pad(0, 3.25, -2.25, 1.8, 1.0); pad(1, -3.25, 2.25, 1.8, 1.0); pad(1, 3.25, 2.25, 1.8, 1.0);
      rect(-3, -3, 6, 6); circ(0, 0, 1.7);
      break;
    case 'RELAY': {
      const pos = { COIL1: [-6, -6], COIL2: [-6, 6], COM: [-8, 0], NC: [6, -6], NO: [6, 6] };
      N.forEach((nm, i) => { const [x, y] = pos[up(nm)] || [(i - 2) * 2.54, 8]; pad(i, x, y, 2, 1.2, i === 0); });
      rect(-10, -8, 20, 16);
      break;
    }
    case 'DIP': {
      const m = Math.max(4, n + (n % 2)), h = m / 2;
      for (let i = 0; i < m; i++) {
        const left = i < h, r = left ? i : m - 1 - i;
        if (i < n) pad(i, left ? -3.81 : 3.81, (r - (h - 1) / 2) * 2.54, 1.6, 0.8, i === 0);
      }
      const hh = h * 2.54 + 0.4;
      rect(-2.6, -hh / 2, 5.2, hh); silk.push({ t: 'notch', cx: 0, cy: -hh / 2, r: 0.8 });
      break;
    }
    default: { // HDR – kolíková lišta, dlhé moduly ako dve rady (číslovanie ako DIP)
      if (n > 12) {
        const h = Math.ceil(n / 2);
        const nm = up(p.name + ' ' + p.value);
        const sp = /ESP32/.test(nm) ? 25.4 : /PICO|RP2040/.test(nm) ? 17.78 : /UNO/.test(nm) ? 48.26 : 15.24;
        for (let i = 0; i < n; i++) {
          const left = i < h, r = left ? i : n - 1 - i;
          pad(i, left ? -sp / 2 : sp / 2, (r - (h - 1) / 2) * 2.54, 1.7, 1.0, i === 0);
        }
        const hh = h * 2.54 + 3;
        rect(-sp / 2 - 2, -hh / 2, sp + 4, hh);
      } else {
        N.forEach((_, i) => pad(i, (i - (n - 1) / 2) * 2.54, 0, 1.7, 1.0, i === 0));
        rect(-n * 1.27, -1.27, n * 2.54, 2.54);
      }
    }
  }
  let bb = [Infinity, Infinity, -Infinity, -Infinity];
  const ext = (x, y) => { bb = [Math.min(bb[0], x), Math.min(bb[1], y), Math.max(bb[2], x), Math.max(bb[3], y)]; };
  pads.forEach((q) => { ext(q.x - q.d / 2, q.y - q.d / 2); ext(q.x + q.d / 2, q.y + q.d / 2); });
  silk.forEach((s) => {
    if (s.t === 'rect') { ext(s.x, s.y); ext(s.x + s.w, s.y + s.h); }
    else if (s.t === 'circle' || s.t === 'arc') { ext(s.cx - s.r, s.cy - s.r); ext(s.cx + s.r, s.cy + (s.t === 'arc' ? 1.6 : s.r)); }
    else if (s.t === 'line') { ext(s.x1, s.y1); ext(s.x2, s.y2); }
  });
  return { pk, pads, silk, bb };
}

const rotPt = (x, y, r) => (r === 90 ? [-y, x] : r === 180 ? [-x, -y] : r === 270 ? [y, -x] : [x, y]);
const snap = (v) => r2(Math.round(v / 1.27) * 1.27);
const r2 = (v) => Math.round(v * 1000) / 1000;

// absolútna geometria dosky
function boardGeo(M, pcb) {
  const parts = M.parts.map((p) => {
    const fp = footprint(p);
    const pl = pcb.place[p.ref] || { x: 0, y: 0, r: 0 };
    const pads = fp.pads.map((q, k) => {
      const [dx, dy] = rotPt(q.x, q.y, pl.r);
      return { ...q, k, ref: p.ref, key: `${p.ref}:${k}`, ax: r2(pl.x + dx), ay: r2(pl.y + dy), net: M.pinNet.get(`${p.ref}#${q.pin}`) };
    });
    const c = [[fp.bb[0], fp.bb[1]], [fp.bb[2], fp.bb[1]], [fp.bb[2], fp.bb[3]], [fp.bb[0], fp.bb[3]]].map(([x, y]) => rotPt(x, y, pl.r));
    const bb = [pl.x + Math.min(...c.map((q) => q[0])), pl.y + Math.min(...c.map((q) => q[1])), pl.x + Math.max(...c.map((q) => q[0])), pl.y + Math.max(...c.map((q) => q[1]))];
    return { p, fp, pl, pads, bb };
  });
  const pads = parts.flatMap((x) => x.pads);
  return { parts, pads, byKey: Object.fromEntries(pads.map((q) => [q.key, q])) };
}

// automatické rozmiestnenie: pásy súčiastok, poradie a otočenie hľadá optimalizácia
// (čo najkratšie spoje a čo najmenej krížení – na jednostrannej doske je to dôležité)
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const PLACE_GAP = 3.81;

function packParts(items, order, rots) {
  const place = {};
  const total = items.reduce((a, i) => a + (i.w + PLACE_GAP) * (i.h + PLACE_GAP), 0);
  const rowW = Math.max(Math.max(...items.map((i) => Math.max(i.w, i.h))) + 6, Math.sqrt(total) * 1.35);
  let x = 3, y = 3, rowH = 0, W = 0;
  for (const idx of order) {
    const it = items[idx], r = rots[idx];
    const [x0, y0, x1, y1] = it.bbr[r / 90];
    const w = x1 - x0, hh = y1 - y0;
    if (x > 3 && x + w > rowW) { x = 3; y += rowH + PLACE_GAP; rowH = 0; }
    place[it.p.ref] = { x: snap(x - x0 + 0.65), y: snap(y - y0 + 0.65), r };
    x += w + PLACE_GAP; rowH = Math.max(rowH, hh); W = Math.max(W, x);
  }
  return { place, w: Math.ceil(W + 1.5), h: Math.ceil(y + rowH + 4) };
}

function segCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function placeScore(M, pcb) {
  const geo = boardGeo(M, pcb);
  const edges = missingConnections(M, geo, []).map((c) => ({ net: c.net, d: c.d, A: [geo.byKey[c.a].ax, geo.byKey[c.a].ay], B: [geo.byKey[c.b].ax, geo.byKey[c.b].ay] }));
  let len = 0, cross = 0;
  for (let i = 0; i < edges.length; i++) {
    len += edges[i].d;
    for (let j = i + 1; j < edges.length; j++) if (edges[i].net !== edges[j].net && segCross(edges[i].A, edges[i].B, edges[j].A, edges[j].B)) cross++;
  }
  return len + 9 * cross + 0.03 * pcb.w * pcb.h;
}

function autoPlace(M) {
  const items = M.parts.map((p) => {
    const fp = footprint(p);
    const bbr = [0, 90, 180, 270].map((r) => {
      const c = [[fp.bb[0], fp.bb[1]], [fp.bb[2], fp.bb[3]], [fp.bb[0], fp.bb[3]], [fp.bb[2], fp.bb[1]]].map(([x, y]) => rotPt(x, y, r));
      return [Math.min(...c.map((q) => q[0])), Math.min(...c.map((q) => q[1])), Math.max(...c.map((q) => q[0])), Math.max(...c.map((q) => q[1]))];
    });
    return { p, bbr, w: fp.bb[2] - fp.bb[0], h: fp.bb[3] - fp.bb[1] };
  });
  // štart: najväčšia súčiastka a potom jej susedia (prehľadávanie do šírky podľa spojov)
  const idxOf = Object.fromEntries(items.map((it, i) => [it.p.ref, i]));
  const adj = items.map(() => new Set());
  M.nets.forEach((n) => { if (isGnd(n.name) || isSupply(n.name)) return; n.nodes.forEach((a) => n.nodes.forEach((b) => { if (a.ref !== b.ref) adj[idxOf[a.ref]].add(idxOf[b.ref]); })); });
  const bySize = items.map((_, i) => i).sort((a, b) => items[b].w * items[b].h - items[a].w * items[a].h);
  const order = [], seen = new Set();
  for (const s of bySize) {
    if (seen.has(s)) continue;
    const q = [s]; seen.add(s);
    while (q.length) { const i = q.shift(); order.push(i); [...adj[i]].sort((a, b) => items[b].w * items[b].h - items[a].w * items[a].h).forEach((j) => { if (!seen.has(j)) { seen.add(j); q.push(j); } }); }
  }
  let rots = items.map((it) => (it.h > it.w * 1.6 && !['DIP', 'HDR'].includes(footprint(it.p).pk) ? 90 : 0));
  let cur = packParts(items, order, rots);
  let curS = placeScore(M, { ...cur, traces: [] });
  let best = { ...cur, s: curS };
  const rand = rng(12345), n = items.length;
  const iters = Math.min(2500, 150 + n * 120), t0 = performance.now();
  for (let k = 0; k < iters && n > 1 && performance.now() - t0 < 1500; k++) {
    const T = 25 * Math.pow(0.002, k / iters);
    const o2 = order.slice(), r2s = rots.slice();
    if (rand() < 0.55) { const a = (rand() * n) | 0, b = (rand() * n) | 0; [o2[a], o2[b]] = [o2[b], o2[a]]; }
    else { const a = (rand() * n) | 0; r2s[a] = (r2s[a] + (rand() < 0.5 ? 90 : 180)) % 360; }
    const cand = packParts(items, o2, r2s);
    const s = placeScore(M, { ...cand, traces: [] });
    if (s < curS || rand() < Math.exp((curS - s) / T)) {
      order.splice(0, n, ...o2); rots = r2s; cur = cand; curS = s;
      if (s < best.s) best = { ...cand, s };
    }
  }
  return { place: best.place, w: best.w, h: best.h };
}

/* ---------- spojenia: ktoré vývody treba prepojiť ---------- */
function unionFind() {
  const p = new Map();
  const f = (a) => { if (!p.has(a)) p.set(a, a); while (p.get(a) !== a) { p.set(a, p.get(p.get(a))); a = p.get(a); } return a; };
  return { find: f, join: (a, b) => p.set(f(a), f(b)) };
}

// chýbajúce spojenia (ratsnest): MST medzi ešte neprepojenými skupinami pádov každého spoja
function missingConnections(M, geo, traces) {
  const uf = unionFind();
  geo.parts.forEach((pt) => { const byPin = {}; pt.pads.forEach((q) => { if (byPin[q.pin]) uf.join(q.key, byPin[q.pin]); else byPin[q.pin] = q.key; }); });
  traces.forEach((t) => uf.join(t.a, t.b));
  const out = [];
  M.nets.forEach((net) => {
    const pads = geo.pads.filter((q) => q.net === net.i);
    if (pads.length < 2) return;
    const inTree = new Set([uf.find(pads[0].key)]);
    let guard = 0;
    while (guard++ < 400) {
      let best = null;
      for (const a of pads) {
        if (!inTree.has(uf.find(a.key))) continue;
        for (const b of pads) {
          if (inTree.has(uf.find(b.key))) continue;
          const d = Math.hypot(a.ax - b.ax, a.ay - b.ay);
          if (!best || d < best.d) best = { a, b, d };
        }
      }
      if (!best) break;
      out.push({ net: net.i, a: best.a.key, b: best.b.key, d: best.d });
      inTree.add(uf.find(best.b.key));
      // všetky skupiny už prepojené s b patria do stromu
      pads.forEach((q) => { if (uf.find(q.key) === uf.find(best.b.key)) inTree.add(uf.find(q.key)); });
    }
  });
  return out;
}

/* ---------- automatické trasovanie (jedna vrstva) ----------
   Spoje sa trasujú opakovane na mriežke (A*). Kde sa dva spoje bijú o miesto,
   to miesto sa zdražuje, kým si každý nenájde vlastnú cestu (princíp PathFinder). */
function makeGrid(pcb) {
  const nx = Math.floor(pcb.w / G) + 1, ny = Math.floor(pcb.h / G) + 1;
  return { nx, ny, own: new Int32Array(nx * ny).fill(-1) };
}
function mark(g, net, test, x0, y0, x1, y1) {
  const i0 = Math.max(0, Math.floor(x0 / G)), i1 = Math.min(g.nx - 1, Math.ceil(x1 / G));
  const j0 = Math.max(0, Math.floor(y0 / G)), j1 = Math.min(g.ny - 1, Math.ceil(y1 / G));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (!test(i * G, j * G)) continue;
    const k = j * g.nx + i, o = g.own[k];
    g.own[k] = o === -1 ? net : o === net ? net : -2;
  }
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function markPad(g, q) {
  const r = q.d / 2 + CLR + TW / 2;
  mark(g, q.net ?? -2, (x, y) => Math.hypot(x - q.ax, y - q.ay) < r, q.ax - r, q.ay - r, q.ax + r, q.ay + r);
}
function markTrace(g, t) {
  const r = TW + CLR - 0.01;
  for (let s = 1; s < t.pts.length; s++) {
    const [ax, ay] = t.pts[s - 1], [bx, by] = t.pts[s];
    mark(g, t.net, (x, y) => segDist(x, y, ax, ay, bx, by) < r, Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r);
  }
}
// pevné prekážky: okraj dosky, pády (cudzie spoje sa k nim nesmú priblížiť) a ponechané spoje
function obstacleGrid(pcb, geo, traces) {
  const g = makeGrid(pcb);
  const e = EDGE + TW / 2;
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const x = i * G, y = j * G;
    if (x < e || y < e || x > pcb.w - e || y > pcb.h - e) g.own[j * g.nx + i] = -2;
  }
  geo.pads.forEach((q) => markPad(g, q));
  traces.forEach((t) => markTrace(g, t));
  return g;
}

// binárna halda pre A*
function heap() {
  const a = [];
  return {
    get size() { return a.length; },
    push(k, v) { a.push([k, v]); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } },
    pop() {
      const top = a[0], last = a.pop();
      if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
      return top[1];
    },
  };
}
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const cellOf = (g, q) => Math.max(0, Math.min(g.ny - 1, Math.round(q.ay / G))) * g.nx + Math.max(0, Math.min(g.nx - 1, Math.round(q.ax / G)));

// A* z pádu A do pádu B; pen(k) = príplatok za uzol (pri vyjednávaní), inak len pevné prekážky
function astar(g, net, A, B, pen) {
  const { nx, ny, own } = g;
  const S = cellOf(g, A), T = cellOf(g, B);
  const okK = (k) => own[k] === -1 || own[k] === net;
  if (!okK(S) || !okK(T)) return null;
  const N = nx * ny;
  const gs = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), dirOf = new Int8Array(N).fill(-1);
  const ti = T % nx, tj = (T / nx) | 0;
  const h = (i, j) => { const dx = Math.abs(i - ti), dy = Math.abs(j - tj); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  const H = heap();
  gs[S] = 0; H.push(h(S % nx, (S / nx) | 0), S);
  while (H.size) {
    const k = H.pop();
    if (k === T) break;
    const i = k % nx, j = (k / nx) | 0;
    for (let d = 0; d < 8; d++) {
      const ii = i + DIRS[d][0], jj = j + DIRS[d][1];
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const kk = jj * nx + ii;
      if (!okK(kk)) continue;
      const diag = DIRS[d][0] && DIRS[d][1];
      if (diag && !(okK(j * nx + ii) && okK(jj * nx + i))) continue;
      const c = gs[k] + (diag ? 1.414 : 1) + (dirOf[k] >= 0 && dirOf[k] !== d ? 0.3 : 0) + (pen ? pen(kk) : 0);
      if (c < gs[kk]) { gs[kk] = c; from[kk] = k; dirOf[kk] = d; H.push(c + h(ii, jj), kk); }
    }
  }
  if (gs[T] === Infinity) return null;
  const path = [];
  for (let k = T; k !== -1; k = from[k]) path.push(k);
  return path.reverse();
}

// uzly mriežky → body spoja (bez bodov na priamke), konce presne v stredoch pádov
function pathPts(g, path, A, B) {
  const cells = path.map((k) => [r2((k % g.nx) * G), r2(((k / g.nx) | 0) * G)]);
  const pts = [[A.ax, A.ay]];
  for (let s = 0; s < cells.length; s++) {
    const p = cells[s], prev = pts[pts.length - 1], next = cells[s + 1] || [B.ax, B.ay];
    const cross = (p[0] - prev[0]) * (next[1] - p[1]) - (p[1] - prev[1]) * (next[0] - p[0]);
    if (Math.abs(cross) > 1e-6 && Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-6) pts.push(p);
  }
  pts.push([B.ax, B.ay]);
  return pts;
}

function autoRoute(M, pcb, geo, budget = 3000) {
  const conns = missingConnections(M, geo, pcb.traces).sort((a, b) => a.d - b.d);
  if (!conns.length) return { traces: pcb.traces, failed: 0 };
  const t0 = performance.now();
  const g = obstacleGrid(pcb, geo, pcb.traces);
  const { nx, ny } = g, N = nx * ny;
  // okolie spoja, do ktorého nesmie cudzí spoj (v uzloch mriežky)
  const R = TW + CLR + 0.09, rc = Math.ceil(R / G);
  const offs = [];
  for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) if (Math.hypot(di, dj) * G < R) offs.push([di, dj]);
  const use = new Int16Array(N), hist = new Float32Array(N);
  const netZone = new Map();
  const zoneOf = (net) => { if (!netZone.has(net)) netZone.set(net, new Uint16Array(N)); return netZone.get(net); };
  const claim = (net, path, d) => {
    const z = zoneOf(net);
    for (const k of path) {
      const i = k % nx, j = (k / nx) | 0;
      for (const [di, dj] of offs) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const kk = jj * nx + ii;
        if (d > 0) { if (z[kk]++ === 0) use[kk]++; } else if (--z[kk] === 0) use[kk]--;
      }
    }
  };
  const other = (net, k) => use[k] - (zoneOf(net)[k] ? 1 : 0);
  const paths = new Array(conns.length).fill(null);
  let pres = 0.6;
  for (let it = 0; it < 40; it++) {
    let dirty = 0;
    for (let c = 0; c < conns.length; c++) {
      const cn = conns[c];
      if (paths[c] && !paths[c].some((k) => other(cn.net, k) > 0)) continue;
      if (paths[c]) claim(cn.net, paths[c], -1);
      paths[c] = astar(g, cn.net, geo.byKey[cn.a], geo.byKey[cn.b], (k) => { const o = other(cn.net, k); return (o > 0 ? pres * o : 0) + hist[k]; });
      if (paths[c]) claim(cn.net, paths[c], 1);
      dirty++;
    }
    let conflicts = 0;
    conns.forEach((cn, c) => { if (paths[c]) for (const k of paths[c]) if (other(cn.net, k) > 0) { hist[k] += 0.5; conflicts++; } });
    if (!conflicts || (it > 0 && !dirty) || performance.now() - t0 > budget) break;
    pres *= 1.7;
  }
  // legalizácia: prijmi cesty bez kolízie, ostatné skús natrasovať znova okolo prijatých
  const traces = pcb.traces.slice();
  const legal = obstacleGrid(pcb, geo, pcb.traces);
  const order = conns.map((cn, c) => ({ cn, c, bad: paths[c] ? paths[c].filter((k) => other(cn.net, k) > 0).length : 1e9 })).sort((a, b) => a.bad - b.bad);
  let failed = 0;
  for (const { cn, c } of order) {
    const A = geo.byKey[cn.a], B = geo.byKey[cn.b];
    let path = paths[c];
    if (path && !path.every((k) => legal.own[k] === -1 || legal.own[k] === cn.net)) path = astar(legal, cn.net, A, B);
    if (!path) { failed++; continue; }
    const t = { net: cn.net, a: cn.a, b: cn.b, pts: pathPts(legal, path, A, B) };
    traces.push(t); markTrace(legal, t);
  }
  return { traces, failed };
}

// po presune súčiastky odstráň spoje, ktoré k nej vedú alebo sa jej teraz dotýkajú
function pruneTraces(pcb, geo, refs) {
  return pcb.traces.filter((t) => {
    if (refs && (refs.has(t.a.split(':')[0]) || refs.has(t.b.split(':')[0]))) return false;
    if (t.pts.some(([x, y]) => x < EDGE || y < EDGE || x > pcb.w - EDGE || y > pcb.h - EDGE)) return false;
    for (const q of geo.pads) {
      if (q.net === t.net) continue;
      const r = q.d / 2 + CLR + TW / 2 - 0.05;
      for (let s = 1; s < t.pts.length; s++) if (segDist(q.ax, q.ay, ...t.pts[s - 1], ...t.pts[s]) < r) return false;
    }
    return true;
  });
}

/* ---------- vykreslenie DPS ---------- */
const PCB_SCREEN = { board: '#0f5132', edge: '#d4b84a', cu: '#d9a441', pad: '#e8c06a', hole: '#0b0f0c', silk: '#f4f4f4', rat: '#ffd84d', sel: '#22d3ee', text: '#f4f4f4' };
const PCB_PRINT = { board: '#ffffff', edge: '#000000', cu: '#000000', pad: '#000000', hole: '#ffffff', silk: null, rat: null, sel: null, text: null };
const PCB_PLACE = { board: '#ffffff', edge: '#000000', cu: '#f0c9a0', pad: '#c9c9c9', hole: '#ffffff', silk: '#000000', rat: '#d62828', sel: null, text: '#000000' };

function silkSVG(s, col) {
  const a = `stroke="${col}" stroke-width="0.18" fill="none"`;
  if (s.t === 'rect') return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" ${a}/>`;
  if (s.t === 'circle') return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" ${a}/>`;
  if (s.t === 'line') return `<path d="M${s.x1} ${s.y1}L${s.x2} ${s.y2}" ${a}/>`;
  if (s.t === 'arc') return `<path d="M${-2.6} 1.6A${s.r} ${s.r} 0 1 1 2.6 1.6" ${a}/>`;
  if (s.t === 'notch') return `<path d="M${s.cx - s.r} ${s.cy}A${s.r} ${s.r} 0 0 0 ${s.cx + s.r} ${s.cy}" ${a}/>`;
  return '';
}

function pcbSVG(M, pcb, geo, colors, opt = {}) {
  const { board, edge, cu, pad, hole, silk, rat, sel, text } = colors;
  let out = `<rect x="0" y="0" width="${pcb.w}" height="${pcb.h}" fill="${board}" stroke="${edge}" stroke-width="0.2"/>`;
  // meď (spodná vrstva – pohľad zo strany súčiastok)
  out += pcb.traces.map((t) => `<polyline points="${t.pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${cu}" stroke-width="${TW}" stroke-linecap="round" stroke-linejoin="round" ${opt.interactive ? `data-trace="${pcb.traces.indexOf(t)}"` : ''} ${opt.hlNet !== undefined && opt.hlNet !== t.net ? 'opacity=".35"' : ''}/>`).join('');
  for (const pt of geo.parts) {
    const { pl } = pt;
    let g = '';
    if (silk) g += pt.fp.silk.map((s) => silkSVG(s, silk)).join('');
    if (opt.interactive) g += `<rect x="${pt.fp.bb[0] - 0.4}" y="${pt.fp.bb[1] - 0.4}" width="${pt.fp.bb[2] - pt.fp.bb[0] + 0.8}" height="${pt.fp.bb[3] - pt.fp.bb[1] + 0.8}" fill="transparent" ${opt.selected === pt.p.ref ? `stroke="${sel}" stroke-width="0.3" stroke-dasharray="0.8 0.5"` : ''}/>`;
    out += `<g data-ref="${esc(pt.p.ref)}" transform="translate(${pl.x} ${pl.y}) rotate(${pl.r})">${g}</g>`;
  }
  for (const q of geo.pads) {
    const r = q.d / 2;
    out += q.sq ? `<rect x="${q.ax - r}" y="${q.ay - r}" width="${q.d}" height="${q.d}" fill="${pad}"/>` : `<circle cx="${q.ax}" cy="${q.ay}" r="${r}" fill="${pad}"/>`;
    out += `<circle cx="${q.ax}" cy="${q.ay}" r="${opt.print ? 0.35 : q.drill / 2}" fill="${hole}"/>`;
  }
  if (text) for (const pt of geo.parts) {
    const cx = (pt.bb[0] + pt.bb[2]) / 2, cy = (pt.bb[1] + pt.bb[3]) / 2;
    out += `<text x="${cx}" y="${cy + 0.5}" font-size="${opt.print ? 1.6 : 1.4}" font-weight="700" text-anchor="middle" fill="${text}" stroke="${opt.print ? '#fff' : board}" stroke-width="0.35" paint-order="stroke" pointer-events="none">${esc(pt.p.ref)}</text>`;
  }
  if (rat && opt.missing) out += opt.missing.map((c) => { const A = geo.byKey[c.a], B = geo.byKey[c.b]; return `<path d="M${A.ax} ${A.ay}L${B.ax} ${B.ay}" stroke="${rat}" stroke-width="${opt.print ? 0.35 : 0.2}" stroke-dasharray="0.7 0.5" pointer-events="none"/>`; }).join('');
  return out;
}

/* =========================================================
   Export – PDF (obrázkové strany) a Gerber
   ========================================================= */
const MM = 72 / 25.4;

async function svgImage(svg) {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  return img;
}

// strany: {w, h (pt), items: [{cv, x, y, w, h} (pt, ľavý horný roh)]}
async function writePdf(pages) {
  const enc = new TextEncoder();
  const chunks = [], offsets = [];
  let len = 0;
  const push = (b) => { const u = typeof b === 'string' ? enc.encode(b) : b; chunks.push(u); len += u.length; };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  let next = 3;
  const plan = pages.map((pg) => ({ pg, pn: next++, cn: next++, ims: pg.items.map(() => next++) }));
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${plan.map((x) => `${x.pn} 0 R`).join(' ')}] /Count ${plan.length} >>`));
  for (const { pg, pn, cn, ims } of plan) {
    const xo = ims.map((n, i) => `/Im${i} ${n} 0 R`).join(' ');
    obj(pn, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pg.w.toFixed(2)} ${pg.h.toFixed(2)}] /Resources << /XObject << ${xo} >> >> /Contents ${cn} 0 R >>`));
    const content = pg.items.map((it, i) => `q ${it.w.toFixed(3)} 0 0 ${it.h.toFixed(3)} ${it.x.toFixed(3)} ${(pg.h - it.y - it.h).toFixed(3)} cm /Im${i} Do Q`).join('\n');
    obj(cn, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    for (let i = 0; i < pg.items.length; i++) {
      const cv = pg.items[i].cv;
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
      const data = new Uint8Array(await blob.arrayBuffer());
      obj(ims[i], () => {
        push(`<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${data.length} >>\nstream\n`);
        push(data); push('\nendstream');
      });
    }
  }
  const total = next, xref = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}

const DPI = 150, PX = DPI / 25.4;   // px na mm pri 150 dpi
function pageCanvas(wmm, hmm, title, sub) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(wmm * PX); cv.height = Math.round(hmm * PX);
  const x = cv.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height);
  x.fillStyle = '#14b8a6'; x.fillRect(0, 0, cv.width, 12);
  x.fillStyle = '#1b1f24'; x.font = 'bold 32px Arial, sans-serif'; x.fillText(title, 15 * PX, 15 * PX);
  x.fillStyle = '#6b7280'; x.font = '19px Arial, sans-serif'; x.fillText(sub, 15 * PX, 21 * PX);
  return { cv, x, page: { w: wmm * MM, h: hmm * MM, items: [{ cv, x: 0, y: 0, w: wmm * MM, h: hmm * MM }] } };
}
function wrap(x, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (x.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

async function buildPdf(item, M, pcb) {
  const date = new Date().toLocaleDateString('sk-SK');
  const pages = [];
  const foot = (x, cv, n) => { x.fillStyle = '#9aa1a9'; x.font = '15px Arial, sans-serif'; x.fillText(`Môj priestor · ${item.title} · ${date}`, 15 * PX, cv.height - 8 * PX); x.textAlign = 'right'; x.fillText(String(n), cv.width - 15 * PX, cv.height - 8 * PX); x.textAlign = 'left'; };
  // 1. schéma (A4 na šírku)
  {
    const { cv, x, page } = pageCanvas(297, 210, 'Schéma zapojenia', `${item.title} · ${date}`);
    const sch = schematicSVG(M, { fg: '#111111', muted: '#555555', bg: '#ffffff' });
    const img = await svgImage(sch.html);
    const mw = (297 - 30) * PX, mh = (210 - 42) * PX;
    const sc = Math.min(mw / sch.W, mh / sch.H, 2.2);
    x.drawImage(img, 15 * PX, 27 * PX, (sch.W + 24) * sc, (sch.H + 16) * sc);
    foot(x, cv, 1); pages.push(page);
  }
  // 2. súčiastky a spoje
  {
    let pg = pageCanvas(210, 297, 'Zoznam súčiastok a spojov', item.title);
    let { cv, x } = pg;
    let y = 32 * PX;
    const L = 15 * PX, maxY = cv.height - 18 * PX;
    const newPage = (t) => { foot(x, cv, pages.length + 1); pages.push(pg.page); pg = pageCanvas(210, 297, t, item.title); ({ cv, x } = pg); y = 32 * PX; };
    const head = (t) => { if (y > maxY - 80) newPage('Zoznam súčiastok a spojov'); x.fillStyle = '#1b1f24'; x.font = 'bold 22px Arial, sans-serif'; x.fillText(t, L, y); y += 34; };
    head('Súčiastky');
    M.parts.forEach((p, i) => {
      if (y > maxY) newPage('Súčiastky (pokračovanie)');
      x.fillStyle = i % 2 ? '#fff' : '#f4f6f8'; x.fillRect(L, y - 21, cv.width - 2 * L, 30);
      x.fillStyle = '#1b1f24'; x.font = 'bold 17px Arial, sans-serif'; x.fillText(p.ref, L + 8, y);
      x.font = '17px Arial, sans-serif'; x.fillText(`${p.name || KIND_NAMES[p.kind] || p.kind}${p.value ? ' – ' + p.value : ''}`, L + 90, y);
      x.fillStyle = '#6b7280'; x.fillText(pkgOf(p), cv.width - L - 110, y);
      y += 30;
    });
    y += 24; head('Spoje');
    M.nets.forEach((n) => {
      x.font = '16px Arial, sans-serif';
      const lines = wrap(x, n.nodes.map((nd) => `${nd.ref}.${M.byRef[nd.ref].names[nd.pin]}`).join(', '), cv.width - 2 * L - 150);
      if (y + lines.length * 24 > maxY) newPage('Spoje (pokračovanie)');
      x.fillStyle = n.color; x.font = 'bold 16px Arial, sans-serif'; x.fillText(n.name, L + 8, y);
      x.fillStyle = '#1b1f24'; x.font = '16px Arial, sans-serif';
      lines.forEach((ln) => { x.fillText(ln, L + 150, y); y += 24; });
      y += 6;
    });
    const notes = [item.circuit?.notes, ...M.warn.map((w) => '⚠ ' + w)].filter(Boolean).join('\n');
    if (notes) {
      y += 20; head('Poznámky');
      x.font = '16px Arial, sans-serif'; x.fillStyle = '#374151';
      wrap(x, notes, cv.width - 2 * L).forEach((ln) => { if (y > maxY) newPage('Poznámky'); x.fillText(ln, L, y); y += 24; });
    }
    x.fillStyle = '#9aa1a9'; x.font = 'italic 15px Arial, sans-serif';
    if (y < maxY - 30) x.fillText('Schému navrhol asistent – pred zapojením over vývody podľa katalógového listu.', L, maxY - 4);
    foot(x, cv, pages.length + 1); pages.push(pg.page);
  }
  if (pcb) {
    const geo = boardGeo(M, pcb);
    const missing = missingConnections(M, geo, pcb.traces);
    // 3. predloha 1:1
    {
      const { cv, x, page } = pageCanvas(210, 297, 'Predloha plošného spoja 1:1', `${item.title} · doska ${pcb.w} × ${pcb.h} mm · spodná strana (meď)`);
      const fit = Math.min(1, 180 / pcb.w, 210 / pcb.h);
      const ox = 15, oy = 34;
      const hi = 600 / 25.4;
      const cu = document.createElement('canvas');
      cu.width = Math.round(pcb.w * hi); cu.height = Math.round(pcb.h * hi);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pcb.w} ${pcb.h}" width="${cu.width}" height="${cu.height}">${pcbSVG(M, pcb, geo, PCB_PRINT, { print: true })}</svg>`;
      cu.getContext('2d').drawImage(await svgImage(svg), 0, 0, cu.width, cu.height);
      page.items.push({ cv: cu, x: ox * MM, y: oy * MM, w: pcb.w * fit * MM, h: pcb.h * fit * MM });
      // mierka na kontrolu tlače
      const ry = (oy + pcb.h * fit + 10) * PX;
      x.strokeStyle = '#000'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(ox * PX, ry); x.lineTo((ox + 50) * PX, ry);
      for (let i = 0; i <= 50; i += 10) { x.moveTo((ox + i) * PX, ry - 8); x.lineTo((ox + i) * PX, ry + 8); }
      x.stroke();
      x.fillStyle = '#1b1f24'; x.font = '17px Arial, sans-serif'; x.fillText('50 mm – po vytlačení over pravítkom', (ox + 54) * PX, ry + 6);
      const notes = [
        fit < 1 ? `⚠ Doska je väčšia ako strana – zmenšené na ${Math.round(fit * 100)} %, nie je v mierke 1:1!` : 'Tlač v skutočnej veľkosti (100 %, bez „prispôsobiť strane“).',
        'Pohľad zo strany súčiastok – pri nažehlení (toner transfer) netreba zrkadliť.',
        `Šírka spojov ${TW} mm, izolačná medzera ${CLR} mm, stredy otvorov sú vyznačené pre vŕtanie.`,
        missing.length ? `⚠ Neprepojené spoje: ${missing.length} – prepoj ich drôtovou prepojkou (viď osadzovací výkres).` : 'Všetky spoje sú natrasované.',
      ];
      let y = ry + 50;
      notes.forEach((t) => { wrap(x, t, cv.width - 30 * PX).forEach((ln) => { x.fillStyle = t.startsWith('⚠') ? '#b45309' : '#374151'; x.fillText(ln, ox * PX, y); y += 26; }); });
      foot(x, cv, pages.length + 1); pages.push(page);
    }
    // 4. osadzovací výkres
    {
      const { cv, x, page } = pageCanvas(210, 297, 'Osadzovací výkres', `${item.title} · pohľad zo strany súčiastok`);
      const sc = Math.min(2.5, 180 / pcb.w, 200 / pcb.h);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${pcb.w + 2} ${pcb.h + 2}" width="${(pcb.w + 2) * sc * PX}" height="${(pcb.h + 2) * sc * PX}" font-family="Arial, Helvetica, sans-serif">${pcbSVG(M, pcb, geo, PCB_PLACE, { print: true, missing })}</svg>`;
      x.drawImage(await svgImage(svg), 15 * PX, 30 * PX, (pcb.w + 2) * sc * PX, (pcb.h + 2) * sc * PX);
      let y = (34 + (pcb.h + 2) * sc) * PX + 20;
      x.font = '16px Arial, sans-serif';
      const rows = M.parts.map((p) => `${p.ref}: ${p.name || KIND_NAMES[p.kind]}${p.value ? ' ' + p.value : ''}`);
      const colW = (cv.width - 30 * PX) / 2;
      rows.forEach((t, i) => {
        const col = i % 2, yy = y + Math.floor(i / 2) * 24;
        if (yy < cv.height - 22 * PX) { x.fillStyle = '#1b1f24'; x.fillText(t.length > 44 ? t.slice(0, 43) + '…' : t, 15 * PX + col * colW, yy); }
      });
      if (missing.length) { x.fillStyle = '#d62828'; x.fillText('Červené prerušované čiary = drôtové prepojky (spoje, ktoré sa nedali natrasovať).', 15 * PX, cv.height - 22 * PX); }
      foot(x, cv, pages.length + 1); pages.push(page);
    }
  }
  return writePdf(pages);
}

/* ---------- Gerber + vŕtanie (ZIP) ---------- */
function gerberFiles(M, pcb) {
  const geo = boardGeo(M, pcb);
  const fy = (y) => pcb.h - y;
  const c = (v) => Math.round(v * 1e6);
  const XY = (x, y) => `X${c(x)}Y${c(fy(y))}`;
  const head = (name, fn) => [`G04 Moj priestor - ${name}*`, `%TF.FileFunction,${fn}*%`, '%FSLAX46Y46*%', '%MOMM*%', '%LPD*%'];
  const ap = (list) => { const m = new Map(); list.forEach((k) => { if (!m.has(k)) m.set(k, 10 + m.size); }); return m; };
  const padAp = (q, extra = 0) => (q.sq ? `R,${(q.d + extra).toFixed(3)}X${(q.d + extra).toFixed(3)}` : `C,${(q.d + extra).toFixed(3)}`);
  const pads = geo.pads;

  // spodná meď
  const cuAps = ap([`C,${TW.toFixed(3)}`, ...pads.map((q) => padAp(q))]);
  const cu = head('spodna med', 'Copper,L1,Bot');
  cuAps.forEach((d, k) => cu.push(`%ADD${d}${k}*%`));
  cu.push('G01*', `D${cuAps.get(`C,${TW.toFixed(3)}`)}*`);
  for (const t of pcb.traces) { t.pts.forEach(([x, y], i) => cu.push(`${XY(x, y)}D0${i ? 1 : 2}*`)); }
  for (const q of pads) cu.push(`D${cuAps.get(padAp(q))}*`, `${XY(q.ax, q.ay)}D03*`);
  cu.push('M02*');

  // spájkovacia maska (obe strany, otvorené pády)
  const mask = (side, fn) => {
    const aps = ap(pads.map((q) => padAp(q, 0.1)));
    const out = head(`maska ${side}`, fn);
    aps.forEach((d, k) => out.push(`%ADD${d}${k}*%`));
    for (const q of pads) out.push(`D${aps.get(padAp(q, 0.1))}*`, `${XY(q.ax, q.ay)}D03*`);
    out.push('M02*');
    return out;
  };

  // potlač: obrysy súčiastok
  const silk = head('potlac', 'Legend,Top');
  silk.push('%ADD10C,0.150*%', 'G01*', 'D10*');
  const stroke = (pts) => pts.forEach(([x, y], i) => silk.push(`${XY(x, y)}D0${i ? 1 : 2}*`));
  for (const pt of geo.parts) {
    const T = (x, y) => { const [dx, dy] = rotPt(x, y, pt.pl.r); return [pt.pl.x + dx, pt.pl.y + dy]; };
    const arc = (cx, cy, r, a0, a1) => Array.from({ length: 25 }, (_, i) => { const a = a0 + (a1 - a0) * i / 24; return T(cx + r * Math.cos(a), cy + r * Math.sin(a)); });
    for (const s of pt.fp.silk) {
      if (s.t === 'rect') stroke([[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h], [s.x, s.y]].map(([x, y]) => T(x, y)));
      else if (s.t === 'line') stroke([T(s.x1, s.y1), T(s.x2, s.y2)]);
      else if (s.t === 'circle') stroke(arc(s.cx, s.cy, s.r, 0, Math.PI * 2));
      else if (s.t === 'arc') stroke(arc(0, 0, s.r, Math.PI - 0.6, Math.PI * 2 + 0.6));
      else if (s.t === 'notch') stroke(arc(s.cx, s.cy, s.r, 0, Math.PI));
    }
  }
  silk.push('M02*');

  // obrys dosky
  const edge = head('obrys', 'Profile,NP');
  edge.push('%ADD10C,0.100*%', 'G01*', 'D10*', `${XY(0, 0)}D02*`, `${XY(pcb.w, 0)}D01*`, `${XY(pcb.w, pcb.h)}D01*`, `${XY(0, pcb.h)}D01*`, `${XY(0, 0)}D01*`, 'M02*');

  // vŕtanie (Excellon)
  const tools = [...new Set(pads.map((q) => q.drill.toFixed(2)))].sort();
  const drl = ['M48', '; Moj priestor - vrtanie', 'METRIC,TZ', ...tools.map((t, i) => `T${i + 1}C${t}`), '%', 'G90', 'G05'];
  tools.forEach((t, i) => { drl.push(`T${i + 1}`); pads.filter((q) => q.drill.toFixed(2) === t).forEach((q) => drl.push(`X${q.ax.toFixed(3)}Y${fy(q.ay).toFixed(3)}`)); });
  drl.push('T0', 'M30');

  return [['doska-B_Cu.gbl', cu], ['doska-B_Mask.gbs', mask('spodna', 'Soldermask,Bot')], ['doska-F_Mask.gts', mask('horna', 'Soldermask,Top')],
    ['doska-F_SilkS.gto', silk], ['doska-Edge_Cuts.gm1', edge], ['doska.drl', drl]].map(([n, l]) => [n, l.join('\n') + '\n']);
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u) => { let c = 0xffffffff; for (const b of u) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let off = 0;
  const d = new Date();
  const dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  for (const [name, text] of files) {
    const nm = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0, 2], [8, 0, 2], [10, tm, 2], [12, dt, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, nm.length, 2], [28, 0, 2]]
      .forEach(([o, v, s]) => (s === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true)));
    parts.push(new Uint8Array(h.buffer), nm, data);
    const c = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0, 2], [10, 0, 2], [12, tm, 2], [14, dt, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, nm.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]]
      .forEach(([o, v, s]) => (s === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true)));
    central.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const cs = central.reduce((a, u) => a + u.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, cs, 4], [16, off, 4], [20, 0, 2]]
    .forEach(([o, v, s]) => (s === 4 ? e.setUint32(o, v, true) : e.setUint16(o, v, true)));
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}

/* =========================================================
   Obrazovka projektu
   ========================================================= */
let S = null; // stav obrazovky
const alive = (st) => st === S && decodeURIComponent(location.hash).startsWith(`#/obvod/${st.sec}/${st.item.id}`);

const fname = (s) => String(s || 'projekt').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'projekt';

async function loadItem(secId, id) {
  let list = C.items[secId];
  if (!list) list = C.items[secId] = await C.api(`/sections/${secId}/items`);
  const it = list.find((i) => i.id === id);
  if (!it) throw new Error('Projekt sa nenašiel');
  return it;
}

async function saveCircuit(immediate = false, st = S) {
  clearTimeout(st.timer);
  const run = async () => {
    try {
      const upd = await C.api(`/sections/${st.sec}/items/${st.item.id}`, { method: 'PATCH', json: { circuit: st.item.circuit } });
      st.item.updated = upd.updated;
    } catch (e) { C.toast('Neuložené: ' + e.message, true); }
  };
  if (immediate) return run();
  st.timer = setTimeout(run, 1200);
}

export async function renderCircuit(ctx, secId, id) {
  C = ctx;
  C.$app.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  let item;
  try { item = await loadItem(secId, id); } catch (e) { C.$app.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  S = { sec: secId, item, tab: C.store.get('circ:tab', 'sch'), sel: null, hl: undefined, zoom: false };
  paint();
}

function shell(inner) {
  const it = S.item;
  return `<div class="topbar">
      <a class="icon-btn" href="#/s/${esc(S.sec)}" aria-label="Späť">${C.icon('back')}</a>
      <h1 class="circ-title">${esc(it.title)}</h1>
    </div>
    ${it.circuit ? `<div class="seg circ-tabs" role="tablist">
      <label><input type="radio" name="ctab" value="sch" ${S.tab === 'sch' ? 'checked' : ''}><span>${C.icon('note')}Schéma</span></label>
      <label><input type="radio" name="ctab" value="pcb" ${S.tab === 'pcb' ? 'checked' : ''}><span>${C.icon('chip')}Plošný spoj</span></label></div>` : ''}
    <div id="circ-main">${inner}</div>`;
}

function paint() {
  if (!S.item.circuit) return paintEmpty();
  S.M = model(S.item.circuit);
  if (S.tab === 'pcb') paintPcb(); else paintSch();
}
function bindTabs() {
  C.$app.querySelectorAll('input[name=ctab]').forEach((r) => { r.onchange = () => { S.tab = r.value; C.store.set('circ:tab', S.tab); S.sel = null; paint(); }; });
}

function paintEmpty(busy = false) {
  C.$app.innerHTML = shell(`<div class="circ-empty glass">
      <div class="orb">${C.icon('chip')}</div>
      <h2>Schéma zapojenia</h2>
      <p>Asistent navrhne zapojenie projektu – súčiastky a spoje medzi nimi. Aplikácia z neho nakreslí schému, rozmiestni súčiastky na plošný spoj a natrasuje ho. Všetko si stiahneš v PDF (aj predlohu 1:1 na leptanie) alebo ako Gerber na objednanie dosky.</p>
      ${busy ? `<div class="msg assistant typing"><i></i><i></i><i></i></div><p class="muted">Asistent kreslí schému…</p>`
        : `<button class="btn block" id="gen">${C.icon('sparkles')}Navrhnúť schému</button>`}
    </div>`);
  $('#gen')?.addEventListener('click', generate);
}

async function generate() {
  const it = S.item, idea = it.idea || {};
  let known = idea.known || [];
  try {
    const cat = await C.catalog();
    // súčiastky z katalógu, ktoré projekt spomína (aj tie na dokúpenie)
    const names = [...(idea.uses || []), ...(idea.missing || [])].map((x) => up(x.name));
    const more = cat.filter((c) => c.kind && c.kind !== 'tool' && c.pins && c.value && names.some((n) => n.includes(up(c.value))))
      .map((c) => ({ name: c.name, kind: c.kind, pkg: c.pkg, pins: c.pins }));
    known = [...known, ...more.filter((m) => !known.some((k) => k.name === m.name))];
  } catch { /* katalóg je len pomôcka */ }
  const project = { name: it.title, summary: idea.summary, uses: idea.uses, missing: idea.missing, steps: idea.steps, note: idea.summary ? '' : it.note };
  const hadPcb = !!it.circuit, st = S;
  if (!hadPcb) paintEmpty(true);
  else { const b = $('#regen'); if (b) { b.disabled = true; b.innerHTML = `${C.icon('sparkles')}Asistent kreslí…`; } }
  try {
    const circ = await C.api('/circuit', { method: 'POST', json: { project, known } });
    it.circuit = { ...circ, generated: new Date().toISOString() };
    await saveCircuit(true, st);
    if (!alive(st)) return;
    S.tab = 'sch';
    paint();
  } catch (e) {
    C.toast(e.message, true);
    if (!alive(st)) return;
    if (!hadPcb) paintEmpty(); else paint();
  }
}

/* ---------- záložka Schéma ---------- */
function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  return { fg: cs.getPropertyValue('--text').trim() || '#e5e7eb', muted: cs.getPropertyValue('--muted').trim() || '#9ca3af' };
}

function paintSch() {
  const { M } = S, circ = S.item.circuit;
  const sch = schematicSVG(M, themeColors(), 'class="sch-svg"');
  C.$app.innerHTML = shell(h`
    <div class="circ-box glass ${S.zoom ? 'zoom' : ''}" id="sch-box">${sch.html}</div>
    <div class="circ-bar">
      <button class="chip" id="zoom">${S.zoom ? 'Prispôsobiť' : 'Zväčšiť'}</button>
      <span class="muted">Ťukni na spoj – zvýraznia sa všetky jeho vývody.</span>
    </div>
    <div class="circ-actions">
      <button class="btn" id="pdf">${C.icon('file')}PDF</button>
      <button class="btn ghost" id="to-pcb">${C.icon('chip')}Plošný spoj</button>
    </div>
    ${M.warn.length ? `<div class="circ-warn">${M.warn.map((w) => `<div>⚠ ${esc(w)}</div>`).join('')}</div>` : ''}
    ${circ.notes ? `<div class="idea-tip">💡 ${esc(circ.notes)}</div>` : ''}
    <div class="fin-sub">Súčiastky (${M.parts.length})</div>
    <div class="circ-list">${M.parts.map((p) => `<div class="circ-row"><b>${esc(p.ref)}</b><span>${esc(p.name || KIND_NAMES[p.kind] || p.kind)}${p.value ? ` <small>${esc(p.value)}</small>` : ''}</span><em>${esc(pkgOf(p))}</em></div>`).join('')}</div>
    <div class="fin-sub">Spoje (${M.nets.length})</div>
    <div class="circ-list">${M.nets.map((n) => `<div class="circ-row net" data-net="${n.i}"><b style="color:${n.color}">${esc(n.name)}</b><span>${n.nodes.map((nd) => `${esc(nd.ref)}.${esc(M.byRef[nd.ref].names[nd.pin])}`).join(', ')}</span></div>`).join('')}</div>
    <p class="circ-note">Schému navrhol asistent – pred zapojením over vývody súčiastok podľa katalógového listu.</p>
    <button class="btn ghost block" id="regen">${C.icon('sparkles')}Navrhnúť schému znova</button>`);
  bindTabs();
  const box = $('#sch-box');
  const hl = () => {
    box.querySelectorAll('[data-net]').forEach((g) => { g.style.opacity = S.hl === undefined || +g.dataset.net === S.hl ? '' : '.18'; });
    C.$app.querySelectorAll('.circ-row.net').forEach((r) => r.classList.toggle('on', +r.dataset.net === S.hl));
  };
  C.$app.querySelectorAll('[data-net]').forEach((g) => {
    g.addEventListener('click', (e) => { e.stopPropagation(); const n = +g.dataset.net; S.hl = S.hl === n ? undefined : n; hl(); });
  });
  box.addEventListener('click', () => { S.hl = undefined; hl(); });
  hl();
  $('#zoom').onclick = () => { S.zoom = !S.zoom; paintSch(); };
  $('#pdf').onclick = exportPdf;
  $('#to-pcb').onclick = () => { S.tab = 'pcb'; C.store.set('circ:tab', 'pcb'); paint(); };
  $('#regen').onclick = () => { if (confirm('Navrhnúť schému znova? Aktuálna schéma aj rozloženie plošného spoja sa nahradia.')) generate(); };
}

const h = (strings, ...vals) => strings.reduce((a, s, i) => a + s + (i < vals.length ? vals[i] : ''), '');

/* ---------- záložka Plošný spoj ---------- */
const needsPcb = () => { const pcb = S.item.circuit.pcb; return !pcb || S.M.parts.some((p) => !pcb.place[p.ref]); };
function createPcb() {
  const a = autoPlace(S.M);
  const pcb = { w: a.w, h: a.h, place: a.place, traces: [] };
  pcb.traces = autoRoute(S.M, pcb, boardGeo(S.M, pcb)).traces;
  S.item.circuit.pcb = pcb;
  saveCircuit();
  return pcb;
}

function paintPcb() {
  if (needsPcb()) {
    C.$app.innerHTML = shell(`<div class="circ-empty glass"><div class="orb">${C.icon('chip')}</div><h2>Navrhujem plošný spoj</h2>
      <p>Rozmiestňujem súčiastky a trasujem spoje…</p><div class="msg assistant typing"><i></i><i></i><i></i></div></div>`);
    bindTabs();
    const st = S;
    setTimeout(() => { if (!alive(st)) return; if (needsPcb()) createPcb(); if (S.tab === 'pcb') paintPcb(); }, 40);
    return;
  }
  const pcb = S.item.circuit.pcb;
  const geo = boardGeo(S.M, pcb);
  const missing = missingConnections(S.M, geo, pcb.traces);
  const total = missing.length + pcb.traces.length;
  const sel = S.sel && S.M.byRef[S.sel];
  C.$app.innerHTML = shell(h`
    <div class="pcb-status ${missing.length ? 'warn' : 'ok'}">${missing.length ? `${C.icon('link')}Natrasované ${pcb.traces.length} z ${total} spojení · chýba ${missing.length}` : `${C.icon('check')}Všetky spoje natrasované (${pcb.traces.length})`}</div>
    <div class="pcb-box" id="pcb-box">
      <svg id="pcb-svg" viewBox="-1.5 -1.5 ${pcb.w + 3} ${pcb.h + 3}" font-family="Arial, Helvetica, sans-serif">${pcbSVG(S.M, pcb, geo, PCB_SCREEN, { interactive: true, selected: S.sel, missing })}</svg>
    </div>
    <div class="pcb-sel">${sel ? `<b>${esc(sel.ref)}</b><span>${esc(sel.name || KIND_NAMES[sel.kind])}${sel.value ? ' ' + esc(sel.value) : ''} · ${esc(pkgOf(sel))}</span><button class="chip" id="rot">↻ Otočiť</button>`
      : '<span class="muted">Súčiastky posúvaj prstom, ťuknutím vyberieš a môžeš otočiť.</span>'}</div>
    <div class="pcb-tools">
      <button class="btn" id="route">${C.icon('sparkles')}Trasovať</button>
      <button class="btn ghost" id="place">Rozmiestniť</button>
      <button class="btn ghost" id="clear">${C.icon('trash')}Spoje</button>
    </div>
    <div class="pcb-size">
      <label>Doska <input class="input" type="number" id="bw" min="10" max="300" step="1" value="${pcb.w}"> × <input class="input" type="number" id="bh" min="10" max="300" step="1" value="${pcb.h}"> mm</label>
      <button class="chip" id="fit">Prispôsobiť</button>
    </div>
    <div class="circ-actions">
      <button class="btn" id="pdf">${C.icon('file')}PDF</button>
      <button class="btn ghost" id="gerber">${C.icon('download')}Gerber ZIP</button>
    </div>
    <p class="circ-note">Jednostranná doska pre súčiastky s vývodmi (THT): meď je na spodnej strane, súčiastky hore. Pred výrobou over rozmery puzdier (hlavne modulov a relé) podľa skutočných súčiastok. Gerber ZIP sa dá nahrať napr. na JLCPCB alebo PCBWay (1 vrstva).</p>`);
  bindPcb(pcb, geo);
}

function bindPcb(pcb, geo) {
  bindTabs();
  const svg = $('#pcb-svg');
  const toBoard = (e) => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const p = pt.matrixTransform(svg.getScreenCTM().inverse()); return [p.x, p.y]; };
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('[data-ref]');
    if (!g) return;
    const ref = g.dataset.ref, pl = pcb.place[ref];
    const [x, y] = toBoard(e);
    drag = { ref, g, sx: x, sy: y, ox: pl.x, oy: pl.y, moved: false };
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [x, y] = toBoard(e);
    const dx = x - drag.sx, dy = y - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 0.8) return;
    drag.moved = true;
    const pl = pcb.place[drag.ref];
    pl.x = snap(drag.ox + dx); pl.y = snap(drag.oy + dy);
    drag.g.setAttribute('transform', `translate(${pl.x} ${pl.y}) rotate(${pl.r})`);
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) { S.sel = S.sel === d.ref ? null : d.ref; paintPcb(); return; }
    S.sel = d.ref;
    moved(pcb, new Set([d.ref]));
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  $('#rot')?.addEventListener('click', () => { const pl = pcb.place[S.sel]; pl.r = (pl.r + 90) % 360; moved(pcb, new Set([S.sel])); });
  $('#route').onclick = () => {
    const btn = $('#route'); btn.disabled = true; btn.textContent = 'Trasujem…';
    setTimeout(() => {
      const res = autoRoute(S.M, pcb, boardGeo(S.M, pcb));
      pcb.traces = res.traces;
      saveCircuit(); paintPcb();
      C.toast(res.failed ? `Nepodarilo sa natrasovať ${res.failed} ${res.failed === 1 ? 'spojenie' : 'spojení'} – posuň súčiastky, zväčši dosku alebo použi drôtovú prepojku` : 'Všetky spoje natrasované');
    }, 30);
  };
  $('#place').onclick = () => {
    if (!confirm('Rozmiestniť súčiastky automaticky? Aktuálne rozloženie a spoje sa nahradia.')) return;
    const a = autoPlace(S.M);
    Object.assign(pcb, { w: a.w, h: a.h, place: a.place, traces: [] });
    pcb.traces = autoRoute(S.M, pcb, boardGeo(S.M, pcb)).traces;
    S.sel = null; saveCircuit(); paintPcb();
  };
  $('#clear').onclick = () => { if (!pcb.traces.length || confirm('Vymazať všetky spoje?')) { pcb.traces = []; saveCircuit(); paintPcb(); } };
  const resize = () => {
    const w = Math.max(10, Math.min(300, Math.round(+$('#bw').value || pcb.w))), hh = Math.max(10, Math.min(300, Math.round(+$('#bh').value || pcb.h)));
    if (w === pcb.w && hh === pcb.h) return;
    pcb.w = w; pcb.h = hh;
    moved(pcb, null);
  };
  $('#bw').onchange = resize; $('#bh').onchange = resize;
  $('#fit').onclick = () => {
    // posuň všetko k ľavému hornému rohu a orež dosku
    const g = boardGeo(S.M, pcb);
    const x0 = Math.min(...g.parts.map((p) => p.bb[0])), y0 = Math.min(...g.parts.map((p) => p.bb[1]));
    const dx = snap(2.54 - x0), dy = snap(2.54 - y0);
    Object.values(pcb.place).forEach((pl) => { pl.x = r2(pl.x + dx); pl.y = r2(pl.y + dy); });
    pcb.traces.forEach((t) => { t.pts = t.pts.map(([x, y]) => [r2(x + dx), r2(y + dy)]); });
    const g2 = boardGeo(S.M, pcb);
    pcb.w = Math.ceil(Math.max(...g2.parts.map((p) => p.bb[2])) + 2.5);
    pcb.h = Math.ceil(Math.max(...g2.parts.map((p) => p.bb[3])) + 2.5);
    moved(pcb, null);
  };
  $('#pdf').onclick = exportPdf;
  $('#gerber').onclick = exportGerber;
}

function moved(pcb, refs) {
  // súčiastka nesmie ísť mimo dosky
  const geo = boardGeo(S.M, pcb);
  for (const pt of geo.parts) {
    const pl = pcb.place[pt.p.ref];
    if (pt.bb[0] < 0.5) pl.x = snap(pl.x + (0.5 - pt.bb[0]) + G / 2);
    if (pt.bb[1] < 0.5) pl.y = snap(pl.y + (0.5 - pt.bb[1]) + G / 2);
    if (pt.bb[2] > pcb.w - 0.5) pl.x = snap(pl.x - (pt.bb[2] - pcb.w + 0.5) - G / 2);
    if (pt.bb[3] > pcb.h - 0.5) pl.y = snap(pl.y - (pt.bb[3] - pcb.h + 0.5) - G / 2);
  }
  pcb.traces = pruneTraces(pcb, boardGeo(S.M, pcb), refs);
  saveCircuit();
  paintPcb();
}

/* ---------- exporty ---------- */
async function exportPdf(e) {
  const btn = e.currentTarget;
  const old = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Vytváram PDF…';
  const name = `${fname(S.item.title)}-schema.pdf`;
  try {
    const pcb = S.item.circuit.pcb && !needsPcb() ? S.item.circuit.pcb : null;
    const blob = await buildPdf(S.item, S.M, pcb);
    C.openViewer(name, async () => blob);
  } catch (err) { C.toast('PDF sa nepodarilo vytvoriť: ' + err.message, true); }
  btn.disabled = false; btn.innerHTML = old;
}

async function exportGerber() {
  try {
    const blob = zip(gerberFiles(S.M, S.item.circuit.pcb));
    await C.saveBlob(blob, `${fname(S.item.title)}-gerber.zip`);
  } catch (err) { C.toast('Gerber sa nepodarilo vytvoriť: ' + err.message, true); }
}

// na testy
export const _test = { setC: (c) => { C = c; }, pcbSVG, PCB_SCREEN, schematicSVG, model, footprint, autoPlace, autoRoute, boardGeo, missingConnections, gerberFiles, zip, resolvePin, pinNames };
