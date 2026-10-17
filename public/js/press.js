/* =========================================================
   Elektro – vulkanizačný lis: simulácia stroja napojená na rozvádzač.
   Snímač, ktorý nie je v skrini správne zapojený, PLC „nevidí“
   a ventil bez správneho zapojenia sa nepohne – cyklus sa zastaví
   presne tam, kde by sa zastavil aj skutočný lis.
   ========================================================= */
import { pressKit } from './cabinet.js';

let C, K;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => C.esc(s);

/* ---------- signály ---------- */
const OUTS = ['y_zl_hore', 'y_zl_dnu', 'y_zl_kl', 'y_vl_hore', 'y_vl_dnu', 'y_vl_kl', 'y_lis_zat', 'y_zam', 'y_mem_bomb', 'y_mem_hore', 'y_dopr'];
const HOME_OUT = { y_zl_hore: 0, y_zl_dnu: 0, y_zl_kl: 0, y_vl_hore: 1, y_vl_dnu: 0, y_vl_kl: 0, y_lis_zat: 0, y_zam: 0, y_mem_bomb: 0, y_mem_hore: 0, y_dopr: 0 };
const HOME_IN = ['zl_dole', 'zl_von', 'zl_kl_zat', 'vl_hore', 'vl_von', 'vl_kl_zat', 'lis_otv', 'zam_hore', 'mem_dole'];
const CURE_S = 8; // vulkanizácia v simulácii (zrýchlene)

// program PLC – krokový reťazec
const STEPS = [
  { t: 'Základná poloha – čaká na ŠTART', set: HOME_OUT, wait: HOME_IN, start: true },
  { t: 'Zakladač: roztvoriť klieštinu (uchopí surový plášť)', set: { y_zl_kl: 1 }, wait: ['zl_kl_roz'] },
  { t: 'Zakladač hore', set: { y_zl_hore: 1 }, wait: ['zl_hore'] },
  { t: 'Zakladač do lisu', set: { y_zl_dnu: 1 }, wait: ['zl_dnu'], need: ['lis_otv'] },
  { t: 'Zakladač dole – plášť na membránu', set: { y_zl_hore: 0 }, wait: ['zl_dole'] },
  { t: 'Membrána – bombírovanie (tvarovanie plášťa)', set: { y_mem_bomb: 1 }, wait: ['mem_bomb'] },
  { t: 'Zakladač: zatvoriť klieštinu (pustí plášť)', set: { y_zl_kl: 0 }, wait: ['zl_kl_zat'] },
  { t: 'Zakladač hore', set: { y_zl_hore: 1 }, wait: ['zl_hore'] },
  { t: 'Zakladač von z lisu', set: { y_zl_dnu: 0 }, wait: ['zl_von'] },
  { t: 'Zakladač dole', set: { y_zl_hore: 0 }, wait: ['zl_dole'] },
  { t: 'Lis zatvoriť – na koncový spínač S2', set: { y_lis_zat: 1 }, wait: ['lis_zat'], need: ['zl_von', 'vl_von'] },
  { t: 'Zámok dole – zamknúť lis', set: { y_zam: 1 }, wait: ['zam_dole'] },
  { t: 'Membrána hore – vulkanizačný tlak', set: { y_mem_bomb: 0, y_mem_hore: 1 }, wait: ['mem_hore'] },
  { t: 'Vulkanizácia', timer: CURE_S },
  { t: 'Membrána dole – vypustenie', set: { y_mem_hore: 0 }, wait: ['mem_dole'] },
  { t: 'Zámok hore – odomknúť lis', set: { y_zam: 0 }, wait: ['zam_hore'] },
  { t: 'Lis otvoriť – na koncový spínač S1', set: { y_lis_zat: 0 }, wait: ['lis_otv'] },
  { t: 'Vykladač do lisu', set: { y_vl_dnu: 1 }, wait: ['vl_dnu'] },
  { t: 'Vykladač dole', set: { y_vl_hore: 0 }, wait: ['vl_dole'] },
  { t: 'Vykladač: roztvoriť klieštinu (uchopí hotový plášť)', set: { y_vl_kl: 1 }, wait: ['vl_kl_roz'] },
  { t: 'Vykladač hore', set: { y_vl_hore: 1 }, wait: ['vl_hore'] },
  { t: 'Vykladač von – nad dopravník', set: { y_vl_dnu: 0 }, wait: ['vl_von'] },
  { t: 'Vykladač dole', set: { y_vl_hore: 0 }, wait: ['vl_dole'] },
  { t: 'Vykladač: zatvoriť klieštinu – plášť na dopravník (B18 zopne)', set: { y_vl_kl: 0 }, wait: ['vl_kl_zat', 'dopr'] },
  { t: 'Vykladač hore', set: { y_vl_hore: 1 }, wait: ['vl_hore'] },
  { t: 'Dopravník odvezie plášť (čaká, kým B18 vypne)', set: { y_dopr: 1 }, waitOff: ['dopr'], after: { y_dopr: 0 } },
];

/* ---------- fyzika stroja ---------- */
const SPEED = { z: 1.0, x: 0.8, k: 2.8, lis: 0.45, zam: 1.4, mem: 0.8 };
function newMachine() {
  return {
    zl: { z: 0, x: 0, k: 0 }, vl: { z: 1, x: 0, k: 0 }, lis: 0, zam: 0, mem: 0,
    tires: [{ id: 1, kind: 'green', at: 'stand', cure: 0, x: 0 }], nextId: 2, done: 0, fault: '', standTimer: 0,
  };
}
function newPlc() {
  return { step: 0, out: { ...HOME_OUT }, mode: 'auto', running: false, arm: false, timer: 0, since: 0, cycleStart: 0, lastCycle: 0, paused: false };
}

const approach = (v, t, sp, dt) => (v < t ? Math.min(t, v + sp * dt) : Math.max(t, v - sp * dt));

// fyzikálny stav snímačov (bez ohľadu na zapojenie)
function physical(M) {
  const onConv = M.tires.some((t) => t.at === 'conv' && t.x < 150);
  return {
    zl_dole: M.zl.z < 0.03, zl_hore: M.zl.z > 0.97, zl_von: M.zl.x < 0.03, zl_dnu: M.zl.x > 0.97, zl_kl_roz: M.zl.k > 0.97, zl_kl_zat: M.zl.k < 0.03,
    vl_dole: M.vl.z < 0.03, vl_hore: M.vl.z > 0.97, vl_von: M.vl.x < 0.03, vl_dnu: M.vl.x > 0.97, vl_kl_roz: M.vl.k > 0.97, vl_kl_zat: M.vl.k < 0.03,
    lis_otv: M.lis < 0.02, lis_zat: M.lis > 0.98, zam_hore: M.zam < 0.03, zam_dole: M.zam > 0.97,
    mem_dole: M.mem < 0.04, mem_bomb: Math.abs(M.mem - 0.5) < 0.04, mem_hore: M.mem > 0.96, dopr: onConv,
  };
}

function stepMachine(M, valve, dt) {
  if (M.fault) return;
  const fault = (msg) => { M.fault = msg; try { navigator.vibrate?.([120, 60, 120]); } catch { /* */ } };
  // ramená: vodorovný pohyb len v hornej polohe a len pri otvorenom lise
  for (const [arm, yH, yD, yK] of [['zl', 'y_zl_hore', 'y_zl_dnu', 'y_zl_kl'], ['vl', 'y_vl_hore', 'y_vl_dnu', 'y_vl_kl']]) {
    const A = M[arm];
    const name = arm === 'zl' ? 'Zakladač' : 'Vykladač';
    A.z = approach(A.z, valve[yH] ? 1 : 0, SPEED.z, dt);
    const tx = valve[yD] ? 1 : 0;
    if (Math.abs(A.x - tx) > 1e-6) {
      if (A.z < 0.9) return fault(`${name} narazil – do lisu a von sa smie pohybovať len v hornej polohe.`);
      if (tx > A.x && M.lis > 0.02) return fault(`${name} narazil do hornej formy – lis nie je otvorený.`);
      A.x = approach(A.x, tx, SPEED.x, dt);
    }
    const k0 = A.k;
    A.k = approach(A.k, valve[yK] ? 1 : 0, SPEED.k, dt);
    // uchopenie / pustenie plášťa
    const atStand = arm === 'zl' && A.x < 0.03, atPress = A.x > 0.97, atConv = arm === 'vl' && A.x < 0.03;
    const held = M.tires.find((t) => t.at === arm);
    if (k0 < 0.97 && A.k >= 0.97 && !held && A.z < 0.03) {
      const t = M.tires.find((q) => (atStand && q.at === 'stand') || (atPress && q.at === 'press'));
      if (t) { t.at = arm; if (arm === 'vl' && t.cure < 1) M.warn = 'Vykladač vybral plášť, ktorý ešte nie je zvulkanizovaný!'; }
    }
    if (k0 > 0.03 && A.k <= 0.03 && held) {
      if (A.z < 0.03 && atPress && !M.tires.some((q) => q.at === 'press')) held.at = 'press';
      else if (A.z < 0.03 && atStand && !M.tires.some((q) => q.at === 'stand')) held.at = 'stand';
      else if (A.z < 0.03 && atConv) { held.at = 'conv'; held.x = 0; }
      else { held.at = 'floor'; held.floorX = arm === 'zl' ? 140 + A.x * 260 : 660 - A.x * 260; return fault(`${name} pustil plášť mimo miesta – plášť spadol.`); }
    }
  }
  // lis a zámok
  const tl = M.valveLis = valve.y_lis_zat ? 1 : 0;
  if (Math.abs(M.lis - tl) > 1e-6) {
    if (M.zam > 0.03 && tl < M.lis) return fault('Lis sa nemôže otvoriť – je zamknutý zámkom.');
    if (tl > M.lis && (M.zl.x > 0.03 || M.vl.x > 0.03)) return fault('KOLÍZIA – lis sa zatvára a v lise je rameno zakladača/vykladača!');
    M.lis = approach(M.lis, tl, SPEED.lis, dt);
  }
  const tz = valve.y_zam ? 1 : 0;
  if (Math.abs(M.zam - tz) > 1e-6) {
    if (tz && M.lis < 0.98) return fault('Zámok narazil – lis nie je úplne zatvorený.');
    M.zam = approach(M.zam, tz, SPEED.zam, dt);
  }
  M.mem = approach(M.mem, valve.y_mem_hore ? 1 : valve.y_mem_bomb ? 0.5 : 0, SPEED.mem, dt);
  // vulkanizácia
  const inPress = M.tires.find((t) => t.at === 'press');
  if (inPress && M.lis > 0.98 && M.zam > 0.97 && M.mem > 0.96) inPress.cure = Math.min(1, inPress.cure + dt / CURE_S);
  if (inPress && M.lis > 0.98 && M.mem > 0.96 && M.zam < 0.5) return fault('Membrána pod tlakom pri odomknutom lise – lis sa otvára tlakom! Najprv zamkni zámok.');
  // dopravník
  if (valve.y_dopr) M.tires.forEach((t) => { if (t.at === 'conv') t.x += 70 * dt; });
  M.tires = M.tires.filter((t) => { if (t.at === 'conv' && t.x >= 150) { M.done++; return false; } return true; });
  // obsluha doloží nový surový plášť, keď zakladač odíde
  if (!M.tires.some((t) => t.at === 'stand' || (t.at === 'zl' && M.zl.x < 0.5)) && M.zl.x > 0.5) {
    M.standTimer += dt;
    if (M.standTimer > 1.2) { M.tires.push({ id: M.nextId++, kind: 'green', at: 'stand', cure: 0, x: 0 }); M.standTimer = 0; }
  } else M.standTimer = 0;
}

/* ---------- PLC ---------- */
function plcInputs(phys, io) {
  const r = {};
  for (const k of Object.keys(phys)) r[k] = !!(phys[k] && io[k]?.ok);
  return r;
}
function stepCondition(st, I) {
  if (st.timer) return S.plc.timer >= st.timer;
  return (st.wait || []).every((k) => I[k]) && (st.waitOff || []).every((k) => !I[k]);
}
function runPlc(I, dt) {
  const P = S.plc;
  if (P.mode === 'manual' || P.paused) return;
  const st = STEPS[P.step];
  P.since += dt;
  if (st.timer && S.M.lis > 0.98) P.timer += dt;
  if (P.step === 0 && !P.running) return;
  if (!stepCondition(st, I)) { P.arm = false; return; }
  if (P.mode === 'step' && !P.arm) return;
  // prechod do ďalšieho kroku
  if (st.after) Object.assign(P.out, st.after);
  let n = P.step + 1;
  if (n >= STEPS.length) { n = 0; S.M.cycles = (S.M.cycles || 0) + 1; P.lastCycle = performance.now() - P.cycleStart; }
  if (P.step === 0) P.cycleStart = performance.now();
  P.step = n; P.since = 0; P.timer = 0; P.arm = false;
  Object.assign(P.out, STEPS[n].set || {});
}

/* ---------- stav obrazovky ---------- */
let S = null;

export async function renderPress(ctx, id) {
  C = ctx;
  C.$app.innerHTML = '<div class="spinner"></div>';
  try { K = await pressKit(ctx); } catch (e) { C.toast(e.message, true); return; }
  const cb = id && K.get(id);
  if (!cb) return intro();
  S = { cb, M: newMachine(), plc: newPlc(), io: K.state(cb), speed: C.store.get('lis:speed', 1), sel: null, raf: 0, last: 0, tPaint: 0 };
  S.plc.mode = C.store.get('lis:mode', 'auto');
  view();
}

function intro() {
  const { icon } = C;
  const list = K.list();
  C.$app.innerHTML = `
    <div class="topbar"><a class="icon-btn" href="#/elektro" aria-label="Späť">${icon('back')}</a>
      <div class="sec-ic" style="--c:#f97316">${icon('cube')}</div><h1>Vulkanizačný lis</h1></div>
    <div class="cbn-intro glass"><b>Lis so zakladačom a vykladačom</b>
      <span>Rozvádzač s kartami EL je pripravený – zapoj 20 snímačov a 11 ventilov (ručne ťahaním vodičov alebo „Zapojiť všetko“). Potom spusti lis a sleduj, ktorý snímač kedy zopne. Nesprávne zapojený snímač PLC nevidí a cyklus sa na ňom zastaví.</span></div>
    <div class="cbn-list">${list.map((cb) => {
      const io = K.state(cb), all = Object.values(io), ok = all.filter((x) => x.ok).length;
      return `<a class="cbn-item glass" href="#/elektro/lis/${encodeURIComponent(cb.id)}"><div class="sec-ic" style="--c:#f97316">${icon('cube')}</div>
        <div><b>${esc(cb.name)}</b><span>${ok} / ${all.length} zapojených</span></div>${icon('chevron')}</a>`;
    }).join('')}
      <button class="btn block" id="lis-new">${icon('plus')}Nový rozvádzač lisu</button></div>`;
  $('#lis-new').onclick = () => {
    const cb = K.create(`Vulkanizačný lis ${list.length + 1}`);
    location.hash = '#/elektro/rozvadzac/' + encodeURIComponent(cb.id);
    C.toast('Rozvádzač lisu je pripravený – zapoj snímače a ventily');
  };
}

/* ---------- obrazovka lisu ---------- */
function view() {
  const { icon } = C;
  const { cb } = S;
  C.$app.innerHTML = `
    <div class="topbar"><a class="icon-btn" href="#/elektro/lis" aria-label="Späť">${icon('back')}</a>
      <div class="sec-ic" style="--c:#f97316">${icon('cube')}</div><h1>${esc(cb.name)}</h1>
      <a class="icon-btn" href="#/elektro/rozvadzac/${encodeURIComponent(cb.id)}" aria-label="Rozvádzač">${icon('briefcase')}</a></div>
    <div class="ps-wire glass" id="ps-wire"></div>
    <div class="ps-modes seg3">${[['auto', 'Automat'], ['step', 'Po krokoch'], ['manual', 'Ručne']].map(([k, l]) => `<button class="chip" data-mode="${k}">${l}</button>`).join('')}
      <button class="chip" id="ps-zoom">🔍</button><button class="chip" id="ps-speed"></button></div>
    <div class="ps-stage glass ${C.store.get('lis:zoom', false) ? 'zoom' : ''}" id="ps-stage"><svg id="ps-svg" viewBox="0 0 800 470" role="img" aria-label="Vulkanizačný lis"></svg></div>
    <div class="ps-status glass" id="ps-status"></div>
    <div class="ps-ctrl" id="ps-ctrl"></div>
    <div class="section-title">Vstupy (snímače)</div><div class="ps-io" id="ps-in"></div>
    <div class="section-title">Výstupy (ventily)</div><div class="ps-io" id="ps-out"></div>
    <p class="tl-disc">Zjednodušený model lisu na precvičenie zapojenia a postupnosti krokov. Fyzicky zopnutý snímač svieti žlto; signál v PLC je zelený, len ak je snímač v rozvádzači zapojený správne.</p>`;
  C.$app.querySelectorAll('[data-mode]').forEach((b) => {
    b.onclick = () => { S.plc.mode = b.dataset.mode; S.plc.arm = false; C.store.set('lis:mode', S.plc.mode); paintCtrl(); };
  });
  $('#ps-zoom').onclick = () => {
    const z = !$('#ps-stage').classList.contains('zoom');
    $('#ps-stage').classList.toggle('zoom', z);
    C.store.set('lis:zoom', z);
    if (z) $('#ps-stage').scrollLeft = 140;
  };
  $('#ps-speed').onclick = () => { S.speed = S.speed === 1 ? 2 : S.speed === 2 ? 4 : 1; C.store.set('lis:speed', S.speed); paintCtrl(); };
  $('#ps-svg').addEventListener('click', (e) => {
    const g = e.target.closest('[data-sig]');
    if (!g) return;
    S.sel = g.dataset.sig;
    paintIo();
    $(`#ps-in [data-row="${S.sel}"], #ps-out [data-row="${S.sel}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  paintWire(); paintCtrl();
  S.last = performance.now();
  const loop = (t) => {
    if (!$('#ps-svg')) return; // obrazovka zatvorená
    const dt = Math.min(0.05, (t - S.last) / 1000) * S.speed;
    S.last = t;
    tick(dt);
    if (t - S.tPaint > 33) { S.tPaint = t; paint(); }
    S.raf = requestAnimationFrame(loop);
  };
  S.raf = requestAnimationFrame(loop);
}

function valveOut() {
  // ventil sa pohne, len ak PLC zapne výstup a ventil je správne zapojený
  const v = {};
  for (const k of OUTS) v[k] = !!(S.plc.out[k] && S.io[k]?.ok);
  return v;
}

function tick(dt) {
  if (S.plc.paused) return;
  const sub = Math.max(1, Math.ceil(dt / 0.02));
  for (let i = 0; i < sub; i++) {
    stepMachine(S.M, valveOut(), dt / sub);
    S.phys = physical(S.M);
    S.inp = plcInputs(S.phys, S.io);
    runPlc(S.inp, dt / sub);
  }
}

/* ---------- kreslenie stroja ---------- */
const lerp = (a, b, t) => a + (b - a) * t;
const ARM = { zl: { col: 60, von: 140, dnu: 400 }, vl: { col: 740, von: 660, dnu: 400 } };
const CHUCK_Y = (z) => lerp(290, 170, z);

function tireSvg(t, cx, top) {
  const cured = t.cure >= 1, k = t.kind === 'green' && !cured;
  const fill = cured ? '#1c1d20' : `rgb(${Math.round(lerp(118, 40, t.cure))},${Math.round(lerp(98, 40, t.cure))},${Math.round(lerp(84, 44, t.cure))})`;
  const tread = cured ? Array.from({ length: 7 }, (_, i) => `<line x1="${cx - 42 + i * 14}" y1="${top + 2}" x2="${cx - 36 + i * 14}" y2="${top + 9}" stroke="#3a3c42" stroke-width="2"/>`).join('') : '';
  return `<g class="ps-tire"><path d="M${cx - 48} ${top + 40} v-30 q0 -10 10 -10 h76 q10 0 10 10 v30 h-20 v-24 h-56 v24 z" fill="${fill}" stroke="${k ? '#8a7466' : '#000'}" stroke-width="1.5"/>${tread}</g>`;
}

function sensorSvg(sig, x, y, label, dir = 'r') {
  const io = S.io[sig], phys = S.phys?.[sig], plc = S.inp?.[sig];
  const bad = !io?.ok, sel = S.sel === sig;
  const lx = dir === 'r' ? x + 12 : x - 12, anchor = dir === 'r' ? 'start' : 'end';
  return `<g class="ps-sn ${sel ? 'sel' : ''}" data-sig="${sig}">
    <circle cx="${x}" cy="${y}" r="13" fill="transparent"/>
    <rect x="${x - 7}" y="${y - 5}" width="14" height="10" rx="3" class="ps-sn-body ${bad ? 'bad' : ''}"/>
    <circle cx="${x}" cy="${y}" r="3.2" fill="${phys ? '#ffd23f' : '#3b3f46'}" ${phys ? 'filter="url(#psglow)"' : ''}/>
    ${plc ? `<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="#22c55e" stroke-width="2"/>` : ''}
    ${bad && phys ? `<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="#ef4444" stroke-width="2" stroke-dasharray="3 2"/>` : ''}
    <text x="${lx}" y="${y + 3.5}" text-anchor="${anchor}" class="ps-lbl ${bad ? 'bad' : ''}">${esc(label)}</text></g>`;
}

function armSvg(arm) {
  const A = S.M[arm], D = ARM[arm];
  const cx = lerp(D.von, D.dnu, A.x), cy = CHUCK_Y(A.z);
  const sgn = arm === 'zl' ? 1 : -1;
  const colX = D.col;
  const fingers = 6 + 14 * A.k;
  const held = S.M.tires.find((t) => t.at === arm);
  return `
    <rect x="${colX - 8}" y="110" width="16" height="330" class="ps-steel"/>
    <rect x="${colX - 13}" y="${cy - 30}" width="26" height="22" rx="3" class="ps-carriage"/>
    <rect x="${Math.min(colX, cx)}" y="${cy - 26}" width="${Math.abs(cx - colX)}" height="10" class="ps-arm"/>
    <rect x="${cx - 4}" y="${cy - 26}" width="8" height="22" class="ps-arm"/>
    ${held ? tireSvg(held, cx, cy) : ''}
    <rect x="${cx - 18}" y="${cy - 8}" width="36" height="8" rx="2" class="ps-chuck"/>
    <path d="M${cx - fingers} ${cy} v14 M${cx + fingers} ${cy} v14" class="ps-finger"/>
    <path d="M${colX + sgn * 18} 96 H${arm === 'zl' ? 420 : 380}" class="ps-rail"/>
    <rect x="${cx - 6}" y="91" width="12" height="10" rx="2" class="ps-flag"/>`;
}

function paintMachine() {
  const M = S.M;
  const top = lerp(100, 235, M.lis);            // horná doska lisu
  const lockY = lerp(190, 214, M.zam);
  const memH = lerp(4, 30, M.mem);
  const inPress = M.tires.find((t) => t.at === 'press');
  const curing = inPress && M.lis > 0.98 && M.zam > 0.97 && M.mem > 0.96 && inPress.cure < 1;
  const parts = [];
  parts.push(`<defs><filter id="psglow" x="-2" y="-2" width="5" height="5"><feGaussianBlur stdDeviation="2.2"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <linearGradient id="psheat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a1a" stop-opacity=".0"/><stop offset="1" stop-color="#ff7a1a" stop-opacity=".55"/></linearGradient></defs>`);
  parts.push('<rect x="0" y="440" width="800" height="30" class="ps-floor"/>');
  // lis – rám
  parts.push(`<rect x="305" y="70" width="20" height="310" class="ps-frame"/><rect x="475" y="70" width="20" height="310" class="ps-frame"/>
    <rect x="292" y="52" width="216" height="30" rx="3" class="ps-steel"/>
    <rect x="384" y="82" width="32" height="${Math.max(6, top - 82 - 2)}" class="ps-cyl"/>
    <rect x="300" y="380" width="200" height="60" rx="3" class="ps-steel"/>
    <text x="400" y="66" class="ps-title">LIS</text>`);
  // spodná forma + membrána
  parts.push(`<rect x="330" y="355" width="140" height="25" class="ps-platen"/><rect x="345" y="330" width="110" height="25" class="ps-mold"/>`);
  if (curing) parts.push(`<rect x="330" y="${top}" width="140" height="${380 - top}" fill="url(#psheat)" class="ps-heat"/>`);
  parts.push(`<path d="M${400 - 30 - memH * 0.5} 331 Q400 ${331 - memH * 2.1} ${400 + 30 + memH * 0.5} 331 Z" class="ps-membrane"/>`);
  if (inPress) parts.push(tireSvg(inPress, 400, 290));
  // horná forma
  parts.push(`<rect x="330" y="${top}" width="140" height="30" class="ps-platen"/><rect x="345" y="${top + 30}" width="110" height="25" class="ps-mold"/>`);
  // zámok
  parts.push(`<rect x="325" y="${lockY}" width="22" height="18" rx="2" class="ps-lock"/><rect x="453" y="${lockY}" width="22" height="18" rx="2" class="ps-lock"/>`);
  // membrána – tyčka s praporkom pre snímače B15–B17
  const flagY = 430 - M.mem * 30;
  parts.push(`<rect x="440" y="${flagY - 3}" width="22" height="6" rx="2" class="ps-flag"/>`);
  // stojan pre surové plášte
  parts.push(`<rect x="95" y="330" width="90" height="10" rx="2" class="ps-steel"/><rect x="132" y="340" width="16" height="100" class="ps-steel"/>`);
  // dopravník
  parts.push(`<rect x="600" y="330" width="200" height="16" rx="8" class="ps-belt ${S.plc.out.y_dopr && S.io.y_dopr?.ok ? 'run' : ''}"/>
    ${[620, 660, 700, 740, 780].map((x) => `<circle cx="${x}" cy="338" r="6" class="ps-roller"/>`).join('')}
    <rect x="612" y="346" width="10" height="94" class="ps-steel"/><rect x="772" y="346" width="10" height="94" class="ps-steel"/>
    <rect x="606" y="300" width="10" height="30" class="ps-steel"/><rect x="786" y="300" width="8" height="30" class="ps-steel"/>
    <rect x="783" y="306" width="6" height="16" fill="#e5484d"/>`);
  const beamCut = S.phys?.dopr;
  parts.push(`<line x1="616" y1="314" x2="${beamCut ? 650 : 783}" y2="314" class="ps-beam ${beamCut ? 'cut' : ''}"/>`);
  // plášte na stojane, dopravníku, na zemi
  for (const t of M.tires) {
    if (t.at === 'stand') parts.push(tireSvg(t, 140, 290));
    if (t.at === 'conv') parts.push(tireSvg(t, 660 + t.x, 290));
    if (t.at === 'floor') parts.push(`<g transform="rotate(12 ${t.floorX} 420)">${tireSvg(t, t.floorX, 400)}</g>`);
  }
  // ramená
  parts.push(armSvg('zl'), armSvg('vl'));
  // snímače
  parts.push(
    sensorSvg('zl_hore', 40, CHUCK_Y(1) - 19, 'B2', 'l'), sensorSvg('zl_dole', 40, CHUCK_Y(0) - 19, 'B1', 'l'),
    sensorSvg('zl_von', 140, 82, 'B3'), sensorSvg('zl_dnu', 392, 82, 'B4', 'l'),
    sensorSvg('vl_hore', 760, CHUCK_Y(1) - 19, 'B8'), sensorSvg('vl_dole', 760, CHUCK_Y(0) - 19, 'B7'),
    sensorSvg('vl_von', 660, 82, 'B9', 'l'), sensorSvg('vl_dnu', 408, 82, 'B10'),
    sensorSvg('lis_otv', 512, 112, 'S1'), sensorSvg('lis_zat', 512, 246, 'S2'),
    sensorSvg('zam_hore', 288, 196, 'B13', 'l'), sensorSvg('zam_dole', 288, 222, 'B14', 'l'),
    sensorSvg('mem_hore', 478, 400, 'B17'), sensorSvg('mem_bomb', 478, 415, 'B16'), sensorSvg('mem_dole', 478, 430, 'B15'),
    sensorSvg('dopr', 611, 296, 'B18', 'l'),
  );
  // snímače klieštin pri ramenách
  for (const [arm, a, b, la, lb] of [['zl', 'zl_kl_roz', 'zl_kl_zat', 'B5', 'B6'], ['vl', 'vl_kl_roz', 'vl_kl_zat', 'B11', 'B12']]) {
    const A = S.M[arm], D = ARM[arm], cx = lerp(D.von, D.dnu, A.x), cy = CHUCK_Y(A.z);
    parts.push(sensorSvg(a, cx - 26, cy - 42, la, 'l'), sensorSvg(b, cx + 26, cy - 42, lb));
  }
  // limitné spínače: páčka
  parts.push(`<path d="M505 ${112} l${M.lis < 0.02 ? -10 : -4} -10" class="ps-lever"/><path d="M505 246 l${M.lis > 0.98 ? -10 : -4} -10" class="ps-lever"/>`);
  if (curing) parts.push(`<text x="400" y="${top - 6}" class="ps-cure">🔥 vulkanizácia ${Math.round(inPress.cure * 100)} %</text>`);
  if (M.fault) parts.push(`<rect x="150" y="190" width="500" height="54" rx="10" class="ps-fault"/><text x="400" y="213" class="ps-fault-t">⛔ PORUCHA</text><text x="400" y="232" class="ps-fault-s">${esc(M.fault.length > 70 ? M.fault.slice(0, 68) + '…' : M.fault)}</text>`);
  $('#ps-svg').innerHTML = parts.join('');
}

/* ---------- panely ---------- */
function nameOf(sig) {
  const io = S.io[sig];
  return io ? `${io.s.name} ${io.s.desc}` : sig;
}

function diagnose() {
  const P = S.plc, st = STEPS[P.step];
  if (S.M.fault) return { cls: 'bad', html: `⛔ ${esc(S.M.fault)} <br><small>Stlač „Reset stroja“.</small>` };
  if (P.mode === 'manual') return { cls: '', html: 'Ručný režim – ventily ovládaš tlačidlami nižšie. Pozor, program tu nechráni pred kolíziou.' };
  if (P.step === 0 && !P.running) {
    const missing = HOME_IN.filter((k) => !S.inp?.[k]);
    return { cls: '', html: missing.length ? `Stroj nie je v základnej polohe: ${missing.map((k) => `<b>${esc(nameOf(k))}</b>`).join(', ')}.` : 'Základná poloha ✓ – stlač <b>ŠTART</b>.' };
  }
  const ok = stepCondition(st, S.inp || {});
  let html = `<b>Krok ${P.step}/${STEPS.length - 1}:</b> ${esc(st.t)}`;
  if (st.timer) html += ` – ${Math.max(0, Math.ceil(st.timer - P.timer))} s (v skutočnosti ~12 min)`;
  if (P.mode === 'step' && ok) return { cls: 'ok', html: html + '<br>✓ Podmienka splnená – stlač <b>Ďalší krok</b>.' };
  if (ok || st.timer) return { cls: '', html };
  // na čo krok čaká a prečo
  const waitFor = [...(st.wait || []).filter((k) => !S.inp[k]), ...(st.waitOff || []).filter((k) => S.inp[k])];
  const why = [];
  for (const k of waitFor) {
    const io = S.io[k];
    if (!io?.ok && S.phys[k]) why.push(`<b>${esc(nameOf(k))}</b> je fyzicky zopnutý (svieti), ale PLC ho nevidí – <em>snímač nie je správne zapojený</em>`);
    else if (!io?.ok) why.push(`<b>${esc(nameOf(k))}</b> nie je správne zapojený`);
    else why.push(`čaká na <b>${esc(nameOf(k))}</b>`);
  }
  for (const [y, v] of Object.entries(st.set || {})) if (v && !S.io[y]?.ok) why.push(`výstup <b>${esc(nameOf(y))}</b> nie je zapojený – ventil nedostane 24 V a nepohne sa`);
  for (const k of st.need || []) if (!S.inp[k]) why.push(`chýba podmienka <b>${esc(nameOf(k))}</b>`);
  const slow = P.since > 3.5 && why.some((w) => w.includes('nie je'));
  return { cls: slow ? 'bad' : '', html: html + (why.length ? `<br>${slow ? '⚠️ ' : '⏳ '}${why.join('<br>')}` : '') };
}

function paintCtrl() {
  const P = S.plc;
  C.$app.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === P.mode));
  $('#ps-speed').textContent = `Rýchlosť ${S.speed}×`;
  const outBtns = P.mode === 'manual' ? `<div class="ps-manual">${OUTS.map((k) => `<button class="btn ${P.out[k] ? '' : 'ghost'}" data-out="${k}">${esc(nameOf(k))}</button>`).join('')}</div>` : '';
  $('#ps-ctrl').innerHTML = `
    <div class="ps-btns">
      ${P.mode !== 'manual' ? `<button class="btn" id="ps-start" ${P.running ? 'disabled' : ''}>▶ Štart</button><button class="btn ghost" id="ps-stop" ${P.running ? '' : 'disabled'}>⏹ Stop po cykle</button>` : ''}
      ${P.mode === 'step' ? '<button class="btn" id="ps-next">⏭ Ďalší krok</button>' : ''}
      <button class="btn ghost" id="ps-pause">${P.paused ? '▶ Pokračovať' : '⏸ Pauza'}</button>
      <button class="btn ghost" id="ps-reset">⟲ Reset stroja</button>
      ${P.mode === 'manual' ? '<button class="btn ghost" id="ps-add">+ Surový plášť</button>' : ''}
    </div>${outBtns}`;
  $('#ps-start')?.addEventListener('click', () => { P.running = true; P.arm = P.mode === 'step'; paintCtrl(); });
  $('#ps-stop')?.addEventListener('click', () => { P.running = false; paintCtrl(); C.toast('Lis sa zastaví na konci cyklu'); });
  $('#ps-next')?.addEventListener('click', () => { P.arm = true; if (P.step === 0) P.running = true; });
  $('#ps-pause').onclick = () => { P.paused = !P.paused; paintCtrl(); };
  $('#ps-reset').onclick = () => { S.M = newMachine(); const mode = P.mode; S.plc = newPlc(); S.plc.mode = mode; S.io = K.state(S.cb); paintWire(); paintCtrl(); };
  $('#ps-add')?.addEventListener('click', () => { if (!S.M.tires.some((t) => t.at === 'stand')) S.M.tires.push({ id: S.M.nextId++, kind: 'green', at: 'stand', cure: 0, x: 0 }); });
  C.$app.querySelectorAll('[data-out]').forEach((b) => { b.onclick = () => { P.out[b.dataset.out] = P.out[b.dataset.out] ? 0 : 1; paintCtrl(); }; });
}

function paintWire() {
  const all = Object.values(S.io), ok = all.filter((x) => x.ok).length, total = 31;
  $('#ps-wire').innerHTML = `<div><b>Zapojenie v rozvádzači: ${ok} / ${total}</b><span>${ok === total ? 'Všetko zapojené správne – lis môže bežať celý cyklus.' : 'Nezapojené snímače PLC nevidí a nezapojené ventily sa nepohnú.'}</span></div>
    <a class="btn ghost" href="#/elektro/rozvadzac/${encodeURIComponent(S.cb.id)}">🔌 Rozvádzač</a>`;
}

function ioRow(sig, isOut) {
  const io = S.io[sig];
  const phys = isOut ? !!S.plc.out[sig] && !!io?.ok : S.phys?.[sig];
  const plc = isOut ? !!S.plc.out[sig] : S.inp?.[sig];
  const state = !io ? 'chýba v skrini' : io.short ? '⚡ skrat' : io.ok ? io.where : io.complete ? '✕ chyba zapojenia' : '○ nezapojený';
  return `<div class="ps-row ${S.sel === sig ? 'sel' : ''} ${io?.ok ? '' : 'bad'}" data-row="${sig}">
    <b>${esc(io?.s.name || '?')}</b><span>${esc(io?.s.desc || sig)}<small>${esc(state)}</small></span>
    <i class="ps-dot ${phys ? (isOut ? 'out' : 'phys') : ''}" title="${isOut ? 'Ventil' : 'Fyzicky'}"></i>
    <i class="ps-dot ${plc ? 'plc' : ''}" title="${isOut ? 'Výstup PLC' : 'Vstup PLC'}"></i></div>`;
}

function paintIo() {
  const ins = Object.keys(physical(S.M));
  $('#ps-in').innerHTML = `<div class="ps-row head"><b></b><span>Snímač</span><i>fyz.</i><i>PLC</i></div>${ins.map((k) => ioRow(k, false)).join('')}`;
  $('#ps-out').innerHTML = `<div class="ps-row head"><b></b><span>Ventil / stykač</span><i>ventil</i><i>PLC</i></div>${OUTS.map((k) => ioRow(k, true)).join('')}`;
  C.$app.querySelectorAll('.ps-row[data-row]').forEach((r) => { r.onclick = () => { S.sel = S.sel === r.dataset.row ? null : r.dataset.row; paintIo(); }; });
}

let ioTick = 0;
function paint() {
  paintMachine();
  const d = diagnose();
  const P = S.plc;
  $('#ps-status').className = `ps-status glass ${d.cls}`;
  $('#ps-status').innerHTML = `${d.html}${S.M.warn ? `<br><span class="ps-warn">⚠️ ${esc(S.M.warn)}</span>` : ''}
    <div class="ps-count">Hotové plášte: <b>${S.M.done}</b>${P.lastCycle ? ` · posledný cyklus ${(P.lastCycle / 1000 * S.speed).toFixed(0)} s` : ''}</div>`;
  if (++ioTick % 3 === 0) {
    paintIo();
    const st = $('#ps-start'); if (st) st.disabled = P.running;
  }
}

export const _test = { STEPS, physical, newMachine, stepMachine };
