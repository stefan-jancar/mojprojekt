/* =========================================================
   Elektro – Beckhoff svorky (EL / KL): prehliadač zapojenia
   ========================================================= */
let C;
let DATA = null;

const FAM = {
  system: { name: 'Spojky a systém', short: 'Systém', color: '#8d96a3' },
  di: { name: 'Digitálne vstupy', short: 'DI', color: '#f5c518' },
  do: { name: 'Digitálne výstupy', short: 'DO', color: '#f07c12' },
  ai: { name: 'Analógové vstupy', short: 'AI', color: '#2f80ed' },
  ao: { name: 'Analógové výstupy', short: 'AO', color: '#27ae60' },
  special: { name: 'Špeciálne', short: 'Špec.', color: '#9b51e0' },
};
const KIND = {
  in: ['Vstup', '#f5c518'], out: ['Výstup', '#f07c12'], ain: ['Analóg. vstup', '#2f80ed'], aout: ['Analóg. výstup', '#27ae60'],
  '+24V': ['+24 V', '#e5484d'], '0V': ['0 V', '#3e7bfa'], PE: ['PE', '#2fae5b'], shield: ['Tienenie', '#8d96a3'],
  nc: ['Nezapojené', '#6b7280'], contact: ['Kontakt', '#d9822b'], sensor: ['Snímač', '#14b8a6'], comm: ['Komunikácia', '#9b51e0'], other: ['Iné', '#a0a0b0'],
};
const kindOf = (k) => KIND[k] || KIND.other;

const $ = (s, r = document) => r.querySelector(s);

async function load() {
  if (DATA) return DATA;
  const r = await fetch('/data/beckhoff.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('Nepodarilo sa načítať katalóg svoriek');
  DATA = await r.json();
  return DATA;
}

export async function renderBeckhoff(ctx, id) {
  C = ctx;
  C.$app.innerHTML = '<div class="spinner"></div>';
  try { await load(); } catch (e) { C.toast(e.message, true); return; }
  if (id) {
    const t = DATA.find((x) => x.id.toUpperCase() === id.toUpperCase() || (x.kl || []).some((k) => k.toUpperCase() === id.toUpperCase()));
    if (t) return detail(t, id.toUpperCase());
  }
  list();
}

/* ---------- zoznam ---------- */
function list() {
  const { icon, esc } = C;
  const st = C.store.get('bk:filter', { fam: 'all', q: '' });
  C.$app.innerHTML = `
    <div class="topbar"><a class="icon-btn" href="#/elektro" aria-label="Späť">${icon('back')}</a>
      <div class="sec-ic" style="--c:#e5484d">${icon('chip')}</div><h1>Beckhoff svorky</h1></div>
    <div class="search glass bk-search">${icon('search')}<input id="bk-q" placeholder="Hľadaj: EL1008, KL2408, PT100, relé…" value="${esc(st.q)}" autocomplete="off"></div>
    <div class="chips" id="bk-fam">
      <button class="chip" data-f="all">Všetko</button>
      ${Object.entries(FAM).map(([k, f]) => `<button class="chip" data-f="${k}"><i class="bk-dot" style="background:${f.color}"></i>${f.short}</button>`).join('')}
    </div>
    <div id="bk-list"></div>
    <p class="tl-disc">Zapojenie podľa dokumentácie Beckhoff (infosys.beckhoff.com). Pred zapojením vždy over potlač na boku svorky a návod ku konkrétnej verzii.</p>`;
  const paint = () => {
    C.store.set('bk:filter', st);
    C.$app.querySelectorAll('#bk-fam .chip').forEach((b) => b.classList.toggle('on', b.dataset.f === st.fam));
    const q = st.q.trim().toLowerCase();
    const items = DATA.filter((t) => (st.fam === 'all' || t.family === st.fam)
      && (!q || [t.id, ...(t.kl || []), t.name, t.desc, ...(t.specs || [])].join(' ').toLowerCase().includes(q)));
    const groups = Object.keys(FAM).map((f) => [f, items.filter((t) => t.family === f)]).filter(([, a]) => a.length);
    $('#bk-list').innerHTML = groups.length ? groups.map(([f, arr]) => `
      <div class="section-title">${FAM[f].name} <span class="bk-n">${arr.length}</span></div>
      <div class="bk-grid">${arr.map((t) => `<a class="bk-item glass" href="#/elektro/beckhoff/${encodeURIComponent(t.id)}">
        ${mini(t)}<div><b>${esc(t.id)}</b>${(t.kl || []).length ? `<small>${esc(t.kl.join(', '))}</small>` : ''}<span>${esc(t.name)}</span></div></a>`).join('')}</div>`).join('')
      : '<div class="empty glass" style="padding:24px;text-align:center;color:var(--muted)">Nič sa nenašlo.</div>';
  };
  C.$app.querySelectorAll('#bk-fam .chip').forEach((b) => { b.onclick = () => { st.fam = b.dataset.f; paint(); }; });
  $('#bk-q').oninput = (e) => { st.q = e.target.value; paint(); };
  paint();
}

// malý náhľad svorky do zoznamu
function mini(t) {
  const f = FAM[t.family] || FAM.system;
  const cols = t.layout?.cols || 2;
  const w = cols * 10 + 6;
  return `<svg class="bk-mini" viewBox="0 0 ${w} 64" aria-hidden="true">
    <rect x="1" y="1" width="${w - 2}" height="62" rx="3" class="hs"/>
    <rect x="1" y="1" width="${w - 2}" height="9" rx="3" fill="${f.color}"/>
    ${Array.from({ length: cols }, (_, c) => Array.from({ length: 4 }, (_, r) => `<circle cx="${8 + c * 10}" cy="${22 + r * 11}" r="3" class="ho"/>`).join('')).join('')}
  </svg>`;
}

/* ---------- detail svorky ---------- */
function geometry(t) {
  const cols = t.layout?.cols || 2;
  const rows = t.layout?.rows || Math.ceil((t.pins?.length || 8) / cols);
  return { cols, rows };
}

// poloha bodu n: stĺpce zhora nadol (1–4 vľavo, 5–8 vpravo …), ak bod nemá vlastné col/row
function pos(t, p) {
  const { rows } = geometry(t);
  if (p.col != null && p.row != null) return [p.col, p.row];
  return [Math.floor((p.n - 1) / rows), (p.n - 1) % rows];
}

function drawTerminal(t) {
  const f = FAM[t.family] || FAM.system;
  const { cols, rows } = geometry(t);
  const CW = 46, top = 118, RH = 64;
  const W = Math.max(cols * CW + 24, 116), H = top + rows * RH + 26;
  const x0 = (W - cols * CW) / 2;
  const leds = t.leds || [];
  const ledCols = Math.min(leds.length, cols * 2 > 4 ? cols * 2 : 4) || 1;
  const pcs = /24|0 ?V|PE/i.test(t.power_contacts || '') && !/nie |žiadne|no power/i.test(t.power_contacts || '');
  const P = (t.pins || []).map((p) => {
    const [c, r] = pos(t, p);
    return { ...p, x: x0 + c * CW + CW / 2, y: top + r * RH + RH / 2 };
  });
  return `<svg class="bk-svg" viewBox="-4 -4 ${W + 30} ${H + 8}" role="img" aria-label="Svorka ${C.esc(t.id)}">
    <defs>
      <linearGradient id="bkh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#cfd3d8"/><stop offset=".5" stop-color="#e9ecef"/><stop offset="1" stop-color="#c3c8ce"/></linearGradient>
    </defs>
    ${pcs ? `<g class="bk-pc" data-pc="1"><rect x="${W - 2}" y="${top + 6}" width="24" height="${rows * RH - 12}" rx="4" class="pcbg"/>
      ${['+24V', '0V', 'PE'].map((k, i) => `<rect x="${W + 4 + i * 6}" y="${top + 16}" width="3" height="${rows * RH - 32}" rx="1.5" fill="${kindOf(k)[1]}"/>`).join('')}</g>` : ''}
    <rect x="0" y="0" width="${W}" height="${H}" rx="10" fill="url(#bkh)" stroke="#9aa1a9"/>
    <rect x="0" y="0" width="${W}" height="18" rx="10" fill="${f.color}"/><rect x="0" y="9" width="${W}" height="9" fill="${f.color}"/>
    <rect x="10" y="26" width="${W - 20}" height="58" rx="6" fill="#1d2127"/>
    ${leds.map((l, i) => {
      const lc = i % ledCols, lr = Math.floor(i / ledCols);
      const lw = (W - 30) / ledCols;
      const col = /červ|red/i.test(l.color) ? '#ff4d4f' : /oranž|orange|žlt|yellow/i.test(l.color) ? '#ffb020' : '#3ddc84';
      return `<g class="bk-led" data-led="${i}"><rect x="${15 + lc * lw}" y="${31 + lr * 13}" width="${lw - 4}" height="10" rx="2" fill="${col}" opacity=".85"/></g>`;
    }).join('')}
    <text x="${W / 2}" y="${100}" class="bk-id">${C.esc(t.id)}</text>
    ${P.map((p) => {
      const kc = kindOf(p.kind)[1];
      return `<g class="bk-pin" data-n="${p.n}" data-kind="${C.esc(p.kind)}">
        <rect x="${p.x - 21}" y="${p.y - 29}" width="42" height="58" rx="7" class="hit"/>
        <rect x="${p.x - 9}" y="${p.y - 25}" width="18" height="14" rx="3" class="lever"/>
        <circle cx="${p.x}" cy="${p.y + 7}" r="9.5" class="hole"/>
        <circle cx="${p.x}" cy="${p.y + 7}" r="4" fill="${kc}"/>
        <text x="${p.x}" y="${p.y + 27}" class="num">${p.n}</text></g>`;
    }).join('')}
  </svg>`;
}

function detail(t, asked) {
  const { icon, esc } = C;
  const f = FAM[t.family] || FAM.system;
  const sameFam = DATA.filter((x) => x.family === t.family);
  const i = sameFam.indexOf(t);
  const prev = sameFam[i - 1], next = sameFam[i + 1];
  const kinds = [...new Set((t.pins || []).map((p) => p.kind))];
  C.$app.innerHTML = `
    <div class="topbar"><a class="icon-btn" href="#/elektro/beckhoff" aria-label="Späť">${icon('back')}</a>
      <div class="sec-ic" style="--c:${f.color}">${icon('chip')}</div><h1>${esc(t.id)}</h1></div>
    <div class="bk-head glass">
      <span class="bk-fam" style="--c:${f.color}">${f.name}</span>
      <h2>${esc(t.name)}</h2>
      ${asked && asked !== t.id.toUpperCase() ? `<div class="bk-kl">Ekvivalent ${esc(asked)} má rovnaké zapojenie.</div>` : (t.kl || []).length ? `<div class="bk-kl">Rovnaké zapojenie: <b>${esc(t.kl.join(', '))}</b></div>` : ''}
      <p>${esc(t.desc || '')}</p>
      ${(t.specs || []).length ? `<div class="bk-specs">${t.specs.map((s) => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
      ${t.confidence && t.confidence !== 'high' ? `<div class="bk-warn">⚠️ Zapojenie nie je úplne overené – skontroluj potlač na svorke a dokumentáciu.</div>` : ''}
    </div>
    <div class="bk-stage">
      <div class="bk-draw">${drawTerminal(t)}</div>
      <div class="bk-legend">${kinds.map((k) => `<button class="bk-lg" data-k="${esc(k)}"><i style="background:${kindOf(k)[1]}"></i>${kindOf(k)[0]}</button>`).join('')}</div>
    </div>
    <div class="bk-info glass" id="bk-info"><span class="tl-muted">👆 Ťukni na svorkovnicový bod, LED alebo napájacie kontakty na boku.</span></div>
    <div class="section-title">Všetky body</div>
    <div class="bk-table glass">${(t.pins || []).map((p) => `<button class="bk-row" data-n="${p.n}">
      <b>${p.n}</b><i style="background:${kindOf(p.kind)[1]}"></i><span><strong>${esc(p.label)}</strong><small>${esc(p.desc || '')}</small></span></button>`).join('')}</div>
    ${(t.leds || []).length ? `<div class="section-title">LED kontrolky</div>
    <div class="bk-table glass">${t.leds.map((l, k) => `<button class="bk-row" data-led="${k}"><i class="led" style="background:${/červ|red/i.test(l.color) ? '#ff4d4f' : /oranž|orange|žlt|yellow/i.test(l.color) ? '#ffb020' : '#3ddc84'}"></i><span><strong>${esc(l.name)}</strong><small>${esc(l.desc || '')}</small></span></button>`).join('')}</div>` : ''}
    ${t.power_contacts ? `<div class="section-title">Napájacie kontakty</div><div class="bk-head glass"><p>${esc(t.power_contacts)}</p></div>` : ''}
    <div class="bk-nav">
      ${prev ? `<a class="btn ghost" href="#/elektro/beckhoff/${encodeURIComponent(prev.id)}">${icon('back')}${esc(prev.id)}</a>` : '<span></span>'}
      ${t.source ? `<a class="btn ghost" href="${esc(t.source)}" target="_blank" rel="noopener">Dokumentácia</a>` : ''}
      ${next ? `<a class="btn ghost" href="#/elektro/beckhoff/${encodeURIComponent(next.id)}">${esc(next.id)}${icon('chevron')}</a>` : '<span></span>'}
    </div>`;

  const svg = $('.bk-svg');
  const info = $('#bk-info');
  const clear = () => svg.querySelectorAll('.on,.same').forEach((e) => e.classList.remove('on', 'same'));
  const showPin = (n, scroll) => {
    const p = t.pins.find((x) => x.n === n);
    if (!p) return;
    clear();
    svg.querySelectorAll('.bk-pin').forEach((g) => {
      if (Number(g.dataset.n) === n) g.classList.add('on');
      else if (g.dataset.kind === p.kind && ['+24V', '0V', 'PE', 'shield'].includes(p.kind)) g.classList.add('same');
    });
    const [kn, kc] = kindOf(p.kind);
    const same = t.pins.filter((x) => x.kind === p.kind && x.n !== n && ['+24V', '0V', 'PE', 'shield'].includes(p.kind)).map((x) => x.n);
    info.innerHTML = `<div class="bk-sel"><div class="bk-num" style="--c:${kc}">${n}</div>
      <div><span class="bk-kind" style="--c:${kc}">${kn}</span><b>${esc(p.label)}</b></div></div>
      <p>${esc(p.desc || '')}</p>
      ${same.length ? `<div class="tl-muted">Prepojené vnútri svorky s bodmi ${same.join(', ')}.</div>` : ''}`;
    info.classList.remove('pop'); void info.offsetWidth; info.classList.add('pop');
    if (scroll) info.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const showLed = (k, scroll) => {
    const l = t.leds[k];
    clear();
    svg.querySelector(`.bk-led[data-led="${k}"]`)?.classList.add('on');
    info.innerHTML = `<div class="bk-sel"><div class="bk-num led" style="--c:${/červ|red/i.test(l.color) ? '#ff4d4f' : '#3ddc84'}">LED</div>
      <div><span class="bk-kind" style="--c:#8d96a3">${esc(l.color || '')}</span><b>${esc(l.name)}</b></div></div><p>${esc(l.desc || '')}</p>`;
    info.classList.remove('pop'); void info.offsetWidth; info.classList.add('pop');
    if (scroll) info.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  svg.querySelectorAll('.bk-pin').forEach((g) => { g.onclick = () => showPin(Number(g.dataset.n)); });
  svg.querySelectorAll('.bk-led').forEach((g) => { g.onclick = () => showLed(Number(g.dataset.led)); });
  svg.querySelector('.bk-pc')?.addEventListener('click', () => {
    clear();
    svg.querySelector('.bk-pc').classList.add('on');
    info.innerHTML = `<div class="bk-sel"><div class="bk-num" style="--c:#e5484d">⚡</div><div><span class="bk-kind" style="--c:#e5484d">Napájacie kontakty</span><b>+24 V · 0 V · PE</b></div></div><p>${esc(t.power_contacts)}</p>`;
  });
  C.$app.querySelectorAll('.bk-row[data-n]').forEach((b) => { b.onclick = () => { showPin(Number(b.dataset.n)); $('.bk-stage').scrollIntoView({ behavior: 'smooth' }); }; });
  C.$app.querySelectorAll('.bk-row[data-led]').forEach((b) => { b.onclick = () => { showLed(Number(b.dataset.led)); $('.bk-stage').scrollIntoView({ behavior: 'smooth' }); }; });
  C.$app.querySelectorAll('.bk-lg').forEach((b) => {
    b.onclick = () => {
      clear();
      svg.querySelectorAll(`.bk-pin[data-kind="${CSS.escape(b.dataset.k)}"]`).forEach((g) => g.classList.add('same'));
      info.innerHTML = `<b>${kindOf(b.dataset.k)[0]}</b>: body ${t.pins.filter((p) => p.kind === b.dataset.k).map((p) => p.n).join(', ')}`;
    };
  });
}
