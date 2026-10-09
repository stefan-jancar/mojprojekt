import { icon, PICKABLE } from './icons.js';

/* =========================================================
   Stav a pomocné funkcie
   ========================================================= */
const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $layer = document.getElementById('layer');

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bez úložiska */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* bez úložiska */ } },
};

const state = {
  token: store.get('token', null),
  status: null,
  sections: store.get('cache:sections', null),
  overview: store.get('cache:overview', null),
  items: {},
  chat: store.get('chat', []),
  settings: store.get('cache:settings', { horoscope: true, zodiac: 'ryby', horo_source: 'auto' }),
  horoscope: null,
  filter: {},
  query: '',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (strings, ...vals) => strings.reduce((a, s, i) => a + s + (i < vals.length ? vals[i] : ''), '');

function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  return Math.round((d - today()) / 86400000);
}
function fmtDate(iso) {
  if (!iso) return '';
  const n = daysUntil(iso);
  if (n === 0) return 'Dnes';
  if (n === 1) return 'Zajtra';
  if (n === -1) return 'Včera';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}
const money = (n, cur = 'EUR') => (Number(n) || 0).toLocaleString('sk-SK', { style: 'currency', currency: cur || 'EUR' });
const fileSize = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' kB';

/* =========================================================
   API
   ========================================================= */
async function api(path, { method = 'GET', json, form, raw } = {}) {
  const headers = {};
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const r = await fetch('/api' + path, { method, headers, body });
  if (r.status === 401 && path !== '/login') { logout(); throw new Error('Prihlás sa znova'); }
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(typeof e.detail === 'string' ? e.detail : `Chyba ${r.status}`);
  }
  return raw ? r.blob() : r.json();
}

function logout() {
  state.token = null;
  store.del('token');
  location.hash = '#/';
  render();
}

/* =========================================================
   Typy sekcií – aké polia majú položky
   ========================================================= */
const FIELDS = {
  title: { label: 'Názov', type: 'text' },
  status: { label: 'Stav', type: 'select', options: ['Nápad', 'Rozpracované', 'Pozastavené', 'Hotové'] },
  progress: { label: 'Hotovo', type: 'range' },
  tags: { label: 'Štítky (oddeľ čiarkou)', type: 'tags' },
  links: { label: 'Odkazy (každý na nový riadok)', type: 'lines' },
  date: { label: 'Dátum', type: 'date' },
  due: { label: 'Termín', type: 'date' },
  person: { label: 'Pre koho', type: 'text' },
  priority: { label: 'Priorita', type: 'select', options: ['Nízka', 'Stredná', 'Vysoká'] },
  amount: { label: 'Suma', type: 'number' },
  currency: { label: 'Mena', type: 'select', options: ['EUR', 'CZK', 'USD'] },
  recurring: { label: 'Opakovanie', type: 'select', options: ['Jednorazovo', 'Mesačne', 'Štvrťročne', 'Ročne'] },
  note: { label: 'Poznámka', type: 'textarea' },
  done: { label: 'Hotové', type: 'switch' },
  kind: { label: 'Typ', type: 'kind' },
  category: { label: 'Kategória', type: 'category' },
};

const CATEGORIES = {
  expense: ['Bývanie', 'Energie', 'Telefón a internet', 'Jedlo a nákupy', 'Doprava', 'Deti a škola', 'Zdravie', 'Poistenie', 'Zábava', 'Iné'],
  income: ['Výplata', 'Brigáda', 'Predaj', 'Prídavky a dávky', 'Dary', 'Úroky', 'Iné'],
};
const isIncome = (it) => it.kind === 'income';

const TYPES = {
  projects: {
    fields: ['title', 'status', 'progress', 'tags', 'links', 'note'], add: 'Nový projekt',
    filters: [['all', 'Všetko'], ['Nápad', 'Nápady'], ['Rozpracované', 'Rozpracované'], ['Pozastavené', 'Pozastavené'], ['Hotové', 'Hotové']],
    match: (it, f) => (it.status || 'Nápad') === f, defaults: { status: 'Nápad', progress: 0 },
  },
  documents: { fields: ['title', 'date', 'tags', 'note'], add: 'Nový dokument', filesFirst: true },
  checklist: {
    fields: ['title', 'date', 'person', 'note', 'done'], add: 'Pridať', checkable: true,
    filters: [['open', 'Treba pripraviť'], ['done', 'Pripravené'], ['all', 'Všetko']], defaultFilter: 'open',
    labels: { title: 'Čo treba', date: 'Na kedy', done: 'Pripravené' },
  },
  tasks: {
    fields: ['title', 'priority', 'due', 'note', 'done'], add: 'Nová úloha', checkable: true,
    filters: [['open', 'Otvorené'], ['done', 'Hotové'], ['all', 'Všetko']], defaultFilter: 'open',
    defaults: { priority: 'Stredná' },
  },
  bills: {
    fields: ['kind', 'title', 'amount', 'currency', 'category', 'due', 'recurring', 'note', 'done'], add: 'Nový záznam', checkable: true,
    filters: [['open', 'Na zaplatenie'], ['expense', 'Výdavky'], ['income', 'Príjmy'], ['all', 'Všetko']], defaultFilter: 'open',
    match: (it, f) => (f === 'income' ? isIncome(it) : f === 'expense' ? !isIncome(it) : !isIncome(it) && !it.done),
    labels: { done: 'Zaplatené', due: 'Splatnosť' }, defaults: { kind: 'expense', currency: 'EUR', recurring: 'Jednorazovo' },
  },
  progress: { fields: ['title', 'date', 'progress', 'tags', 'note'], add: 'Nový pokrok', labels: { title: 'Čo sa mi podarilo', progress: 'Hodnotenie / posun' } },
  notes: { fields: ['title', 'tags', 'note'], add: 'Nová poznámka' },
};
const typeOf = (sec) => TYPES[sec.type] || TYPES.notes;

function sortItems(sec, items) {
  const t = sec.type;
  const arr = [...items];
  if (t === 'checklist' || t === 'tasks' || t === 'bills') {
    const key = t === 'checklist' ? 'date' : 'due';
    arr.sort((a, b) => (a.done - b.done) || ((a[key] || '9999') < (b[key] || '9999') ? -1 : (a[key] || '9999') > (b[key] || '9999') ? 1 : 0));
  } else if (t === 'progress') {
    arr.sort((a, b) => (b.date || b.created || '').localeCompare(a.date || a.created || ''));
  } else {
    arr.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updated || '').localeCompare(a.updated || ''));
  }
  return arr;
}

/* =========================================================
   Router
   ========================================================= */
window.addEventListener('hashchange', render);

function route() {
  const p = location.hash.replace(/^#\/?/, '').split('/');
  if (p[0] === 's' && p[1]) return { view: 'section', id: decodeURIComponent(p[1]) };
  if (p[0] === 'asistent') return { view: 'assistant' };
  if (p[0] === 'nastavenia') return { view: 'settings' };
  return { view: 'home' };
}

function renderNav(active) {
  const links = [['#/', 'home', 'Domov', 'home'], ['#/asistent', 'sparkles', 'Asistent', 'assistant'], ['#/nastavenia', 'settings', 'Nastavenia', 'settings']];
  $nav.hidden = false;
  $nav.innerHTML = links.map(([href, ic, label, v]) => `<a href="${href}" class="${active === v || (active === 'section' && v === 'home') ? 'on' : ''}">${icon(ic)}<span>${label}</span></a>`).join('');
}

async function render() {
  closeSheet();
  if (!state.status) {
    try { state.status = await api('/status'); } catch { state.status = { auth_required: false, offline: true }; }
  }
  if (state.status.auth_required && !state.token) return renderLogin();
  const r = route();
  renderNav(r.view);
  window.scrollTo(0, 0);
  if (r.view === 'section') return renderSection(r.id);
  if (r.view === 'assistant') return renderAssistant();
  if (r.view === 'settings') return renderSettings();
  return renderHome();
}

/* =========================================================
   Prihlásenie
   ========================================================= */
function renderLogin() {
  $nav.hidden = true;
  $app.innerHTML = h`
    <div class="login"><form class="box glass" id="lf">
      <div class="orb">${icon('lock')}</div>
      <h1>Môj priestor</h1>
      <p>Zadaj heslo na odomknutie</p>
      <div class="field"><input type="password" name="pw" placeholder="Heslo" autocomplete="current-password" required></div>
      <button class="btn block">Odomknúť</button>
    </form></div>`;
  const f = document.getElementById('lf');
  f.pw.focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    f.querySelector('button').disabled = true;
    try {
      const { token } = await api('/login', { method: 'POST', json: { password: f.pw.value } });
      state.token = token;
      store.set('token', token);
      render();
    } catch (err) {
      toast(err.message, true);
      f.querySelector('button').disabled = false;
    }
  };
}

/* =========================================================
   Domov
   ========================================================= */
async function loadSections() {
  state.sections = await api('/sections');
  store.set('cache:sections', state.sections);
  return state.sections;
}

function secIcon(sec, cls = '') {
  return `<div class="sec-ic ${cls}" style="--c:${esc(sec.color)}">${icon(sec.icon)}</div>`;
}

function countLabel(sec, items) {
  if (!items) return '…';
  const t = sec.type;
  if (t === 'checklist' || t === 'tasks') { const o = items.filter((i) => !i.done).length; return o ? `${o} otvorených` : 'Všetko hotové'; }
  if (t === 'bills') { const o = items.filter((i) => !i.done && !isIncome(i)); return o.length ? `${o.length} nezaplatených` : 'Všetko zaplatené'; }
  const n = items.length;
  return n === 1 ? '1 položka' : n >= 2 && n <= 4 ? `${n} položky` : `${n} položiek`;
}

function buildStats() {
  const ov = state.overview || {};
  const secs = state.sections || [];
  const stats = [];
  const of = (type) => secs.filter((s) => s.type === type);

  of('checklist').forEach((s) => {
    const open = (ov[s.id] || []).filter((i) => !i.done && (i.date == null || i.date === '' || daysUntil(i.date) <= 1));
    stats.push({ sec: s, label: s.name, val: open.length ? `${open.length}` : '✓', sub: open.length ? open.slice(0, 3).map((i) => i.title).join(', ') : 'Na zajtra nič netreba' });
  });
  of('bills').forEach((s) => {
    const open = (ov[s.id] || []).filter((i) => !i.done && !isIncome(i));
    const sum = open.reduce((a, i) => a + (Number(i.amount) || 0), 0);
    const next = open.filter((i) => i.due).sort((a, b) => a.due.localeCompare(b.due))[0];
    stats.push({ sec: s, label: s.name, val: money(sum), sub: next ? `Najbližšie: ${next.title} · ${fmtDate(next.due)}` : open.length ? 'Bez termínu splatnosti' : 'Všetko zaplatené' });
  });
  of('tasks').forEach((s) => {
    const open = (ov[s.id] || []).filter((i) => !i.done);
    const urgent = open.filter((i) => i.due && daysUntil(i.due) <= 2).length;
    stats.push({ sec: s, label: s.name, val: open.length, sub: urgent ? `${urgent} s blížiacim sa termínom` : 'otvorených úloh' });
  });
  const proj = of('projects');
  if (proj.length) {
    const active = proj.flatMap((s) => (ov[s.id] || []).filter((i) => i.status === 'Rozpracované'));
    stats.push({ sec: proj[0], label: 'Rozpracované projekty', val: active.length, sub: active.slice(0, 2).map((i) => i.title).join(', ') || 'Žiadne', icon: 'bolt' });
  }
  return stats.slice(0, 6);
}

function homeHTML() {
  const hr = new Date().getHours();
  const greet = hr < 10 ? 'Dobré ráno' : hr < 18 ? 'Pekný deň' : 'Dobrý večer';
  const dateStr = new Date().toLocaleDateString('sk-SK', { weekday: 'long', day: 'numeric', month: 'long' });
  const stats = buildStats();
  const ov = state.overview || {};
  return h`
    <div class="hello"><small>${esc(dateStr)}</small><h1>${greet}<span class="grad-text">.</span></h1></div>
    <div id="horo">${horoHTML()}</div>
    ${state.status?.storage === 'missing' ? `<div class="summary-bar glass" style="border-color:var(--danger);color:var(--danger);display:block;font-size:14px">⚠️ Ukladanie nie je nastavené. Na Verceli pridaj premenné <b>GITHUB_TOKEN</b> a <b>GITHUB_DATA_REPO</b> a sprav Redeploy.</div>` : ''}
    ${stats.length ? `<div class="stats">${stats.map((s) => `
      <div class="stat glass" data-go="${esc(s.sec.id)}">
        <div class="lbl" style="color:${esc(s.sec.color)}">${icon(s.icon || s.sec.icon)}<span style="color:var(--muted)">${esc(s.label)}</span></div>
        <div class="val">${esc(s.val)}</div>
        <div class="sub">${esc(s.sub)}</div>
      </div>`).join('')}</div>` : ''}
    <div class="section-title">Sekcie</div>
    <div class="tiles">
      ${(state.sections || []).map((s) => `
        <a class="tile glass" href="#/s/${encodeURIComponent(s.id)}" style="--c:${esc(s.color)}">
          ${secIcon(s)}
          <div><div class="name">${esc(s.name)}</div><div class="count">${countLabel(s, ov[s.id])}</div></div>
        </a>`).join('')}
      <a class="tile glass add" href="#/nastavenia">${icon('plus')}<span>Pridať sekciu</span></a>
    </div>`;
}

async function renderHome() {
  if (state.sections) $app.innerHTML = homeHTML();
  else $app.innerHTML = '<div class="spinner"></div>';
  bindHome();
  loadHoroscope();
  try {
    const [secs, ov] = await Promise.all([loadSections(), api('/overview')]);
    state.overview = ov;
    Object.assign(state.items, ov);
    store.set('cache:overview', ov);
    if (route().view === 'home') { $app.innerHTML = homeHTML(); bindHome(); }
    return secs;
  } catch (e) {
    toast(e.message, true);
  }
}
/* ---------- horoskop ---------- */
const todayKey = () => new Date().toLocaleDateString('sv-SE');

async function loadHoroscope() {
  try {
    state.settings = await api('/settings');
    store.set('cache:settings', state.settings);
  } catch { /* použijú sa uložené nastavenia */ }
  const { horoscope: on, zodiac, horo_source: source = 'auto' } = state.settings;
  if (!on) { state.horoscope = null; paintHoroscope(); return; }
  const key = `horo4:${todayKey()}:${zodiac}:${source}`;
  const cached = store.get(key, null);
  if (cached) { state.horoscope = cached; paintHoroscope(); return; }
  state.horoscope = { loading: true };
  paintHoroscope();
  try {
    state.horoscope = await api(`/horoscope?sign=${encodeURIComponent(zodiac)}&source=${encodeURIComponent(source)}`);
    store.set(key, state.horoscope);
  } catch (e) {
    state.horoscope = { error: e.message };
  }
  paintHoroscope();
}

function horoHTML() {
  const hs = state.horoscope;
  if (!state.settings?.horoscope || !hs) return '';
  if (hs.loading) return '<div class="skeleton" style="height:120px;margin-bottom:22px"></div>';
  if (hs.error) {
    return `<div class="horo glass"><div class="horo-head"><div class="horo-sym">✦</div><div><b>Horoskop</b><small>${esc(hs.error)}</small></div></div>
      <div class="horo-foot"><button class="chip" data-horo-diag>Diagnostika</button><button class="chip" data-horo-retry>Skúsiť znova</button></div></div>`;
  }
  const date = new Date(hs.date + 'T00:00:00').toLocaleDateString('sk-SK', { day: 'numeric', month: 'long' });
  return h`
    <div class="horo glass" id="horo-card">
      <div class="horo-head">
        <div class="horo-sym">${esc(hs.symbol)}\uFE0E</div>
        <div><b>${esc(hs.name)}</b><small>Horoskop na ${esc(date)}</small></div>
      </div>
      <div class="horo-body">
        ${hs.sections.map((p) => `<p>${p.title ? `<b>${esc(p.title)}:</b> ` : ''}${esc(p.text)}</p>`).join('')}
      </div>
      <div class="horo-foot">
        <button class="chip" id="horo-more">Čítať celý</button>
        <a href="${esc(hs.source)}" target="_blank" rel="noopener">zdroj: ${esc(hs.source_name || 'web')}</a>
      </div>
    </div>`;
}

async function showHoroDiag() {
  const sheet = openSheet(`<div class="sheet-head"><h2>Diagnostika horoskopu</h2><button class="icon-btn" data-close>${icon('x')}</button></div>
    <p style="color:var(--muted);font-size:13.5px;margin-top:0">Urob screenshot (alebo skopíruj text) a pošli ho na opravu.</p>
    <pre id="diag" style="white-space:pre-wrap;word-break:break-word;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px;max-height:60vh;overflow:auto">Načítavam…</pre>
    <button class="btn block" id="diag-copy">Kopírovať</button>`);
  sheet.querySelector('[data-close]').onclick = closeSheet;
  const pre = sheet.querySelector('#diag');
  try {
    const d = await api('/horoscope?debug=1&source=auto&sign=' + encodeURIComponent(state.settings.zodiac || 'ryby'));
    pre.textContent = JSON.stringify(d, null, 2);
  } catch (e) { pre.textContent = 'Chyba: ' + e.message; }
  sheet.querySelector('#diag-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(pre.textContent); toast('Skopírované'); } catch { toast('Kopírovanie nie je dostupné', true); }
  };
}

function paintHoroscope() {
  const el = document.getElementById('horo');
  if (!el) return;
  el.innerHTML = horoHTML();
  el.querySelector('[data-horo-diag]')?.addEventListener('click', showHoroDiag);
  el.querySelector('[data-horo-retry]')?.addEventListener('click', () => loadHoroscope());
  const card = document.getElementById('horo-card');
  const more = document.getElementById('horo-more');
  if (!card || !more) return;
  const body = card.querySelector('.horo-body');
  if (body.scrollHeight <= body.clientHeight + 4) more.hidden = true;
  more.onclick = () => {
    card.classList.toggle('open');
    more.textContent = card.classList.contains('open') ? 'Skryť' : 'Čítať celý';
  };
}

function bindHome() {
  paintHoroscope();
  $app.querySelectorAll('[data-go]').forEach((el) => { el.onclick = () => { location.hash = '#/s/' + encodeURIComponent(el.dataset.go); }; });
}

/* =========================================================
   Sekcia
   ========================================================= */
function cardHTML(sec, it) {
  const T = typeOf(sec);
  const t = sec.type;
  const files = (it.files || []).length;
  const tags = (it.tags || []).map((x) => `<span class="badge">#${esc(x)}</span>`).join('');
  const fileBadge = files ? `<span class="badge">${icon('clip')}${files}</span>` : '';
  const check = T.checkable ? `<button class="check ${it.done ? 'on' : ''}" data-toggle="${it.id}" aria-label="Označiť">${icon('check')}</button>` : '';
  const dueBadge = (iso, label = '') => {
    if (!iso) return '';
    const n = daysUntil(iso);
    const cls = it.done ? '' : n < 0 ? 'danger' : n <= 2 ? 'warn' : '';
    return `<span class="badge ${cls}">${icon('calendar')}${label}${esc(fmtDate(iso))}</span>`;
  };
  const note = it.note ? `<div class="note">${esc(it.note)}</div>` : '';
  let meta = '';
  let right = '';
  let lead = check;

  if (t === 'projects') {
    const st = it.status || 'Nápad';
    const cls = st === 'Hotové' ? 'ok' : st === 'Rozpracované' ? 'accent' : st === 'Pozastavené' ? 'warn' : '';
    meta = `<span class="badge ${cls}">${esc(st)}</span>${(it.links || []).length ? `<span class="badge">${icon('link')}${it.links.length}</span>` : ''}${fileBadge}${tags}`;
    const p = Math.max(0, Math.min(100, Number(it.progress) || 0));
    meta += '</div>' + (p ? `<div class="progress"><i style="width:${p}%"></i></div>` : '') + '<div>';
    lead = secIcon(sec);
  } else if (t === 'documents') {
    lead = `<div class="sec-ic" style="--c:${esc(sec.color)}">${icon('file')}</div>`;
    meta = `${it.date ? dueBadge(it.date) : ''}${fileBadge}${tags}`;
  } else if (t === 'checklist') {
    meta = `${dueBadge(it.date)}${it.person ? `<span class="badge">${esc(it.person)}</span>` : ''}${fileBadge}`;
  } else if (t === 'tasks') {
    const pc = it.priority === 'Vysoká' ? 'danger' : it.priority === 'Nízka' ? '' : 'accent';
    meta = `${it.priority ? `<span class="badge ${pc}">${esc(it.priority)}</span>` : ''}${dueBadge(it.due)}${fileBadge}`;
  } else if (t === 'bills') {
    const inc = isIncome(it);
    const kindBadge = `<span class="badge"><i class="fin-dot ${inc ? 'inc' : 'exp'}"></i>${inc ? (it.done ? 'Prijaté' : 'Príjem') : 'Výdavok'}</span>`;
    const dateBadge = inc ? (it.due ? `<span class="badge">${icon('calendar')}${esc(fmtDate(it.due))}</span>` : '') : dueBadge(it.due, 'do ');
    meta = `${kindBadge}${it.category ? `<span class="badge">${esc(it.category)}</span>` : ''}${dateBadge}${it.recurring && it.recurring !== 'Jednorazovo' ? `<span class="badge">↻ ${esc(it.recurring)}</span>` : ''}${fileBadge}`;
    right = `<div class="amount">${inc ? '+' : ''}${money(it.amount, it.currency)}</div>`;
  } else if (t === 'progress') {
    const d = it.date ? new Date(it.date + 'T00:00:00') : new Date(it.created);
    lead = `<div class="date-col"><b>${d.getDate()}</b><span>${d.toLocaleDateString('sk-SK', { month: 'short' })}</span></div>`;
    const p = Number(it.progress) || 0;
    meta = `${tags}${fileBadge}</div>${p ? `<div class="progress"><i style="width:${Math.min(100, p)}%"></i></div>` : ''}<div>`;
  } else {
    meta = `${tags}${fileBadge}`;
  }

  return h`
    <div class="card glass ${it.done && !isIncome(it) ? 'done' : ''}" data-open="${it.id}">
      ${lead}
      <div class="body">
        <div class="title">${esc(it.title)}</div>
        ${note}
        <div class="meta">${meta}</div>
        ${thumbStrip(it)}
      </div>
      ${right}
    </div>`;
}

/* ---------- prehľad príjmov a výdavkov ---------- */
const ymOf = (d) => d.toLocaleDateString('sv-SE').slice(0, 7);
const monthName = (ym, opts = { month: 'long', year: 'numeric' }) => new Date(ym + '-01T00:00:00').toLocaleDateString('sk-SK', opts);
function shiftYm(ym, n) {
  const d = new Date(ym + '-01T00:00:00');
  d.setMonth(d.getMonth() + n);
  return ymOf(d);
}
const itemYm = (it) => (it.due || it.created || '').slice(0, 7);
const compact = (n) => (n >= 1000 ? (n / 1000).toLocaleString('sk-SK', { maximumFractionDigits: 1 }) + ' tis.' : Math.round(n).toLocaleString('sk-SK'));

function barPath(x, base, w, h, r = 4) {
  // stĺpec ukotvený na základnej čiare, zaoblený len na vrchu
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  const y = base - h;
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

function financeData(all, ym) {
  const eur = all.filter((i) => (i.currency || 'EUR') === 'EUR' && Number(i.amount));
  const months = Array.from({ length: 6 }, (_, k) => shiftYm(ym, k - 5));
  const sums = Object.fromEntries(months.map((m) => [m, { inc: 0, exp: 0 }]));
  const cats = {};
  for (const it of eur) {
    const m = itemYm(it);
    if (!sums[m]) continue;
    const v = Number(it.amount);
    if (isIncome(it)) sums[m].inc += v;
    else {
      sums[m].exp += v;
      if (m === ym) { const c = it.category || 'Bez kategórie'; cats[c] = (cats[c] || 0) + v; }
    }
  }
  return { months, sums, cats, otherCurrency: all.some((i) => (i.currency || 'EUR') !== 'EUR') };
}

function financeHTML(sec, all) {
  const ym = (state.finMonth ||= {})[sec.id] || ymOf(new Date());
  const { months, sums, cats, otherCurrency } = financeData(all, ym);
  const cur = sums[ym];
  const bal = cur.inc - cur.exp;
  const toPay = all.filter((i) => !i.done && !isIncome(i)).reduce((a, i) => a + ((i.currency || 'EUR') === 'EUR' ? Number(i.amount) || 0 : 0), 0);

  // stĺpcový graf – 6 mesiacov, príjmy vedľa výdavkov
  const W = 320, L = 38, base = 118, top = 12, gw = (W - L) / months.length, bw = 14, gap = 2;
  const max = Math.max(1, ...months.flatMap((m) => [sums[m].inc, sums[m].exp]));
  const sc = (v) => (v / max) * (base - top);
  const bars = months.map((m, i) => {
    const x = L + i * gw + (gw - (bw * 2 + gap)) / 2;
    const sel = m === ym;
    return `<g class="fin-g${sel ? ' sel' : ''}" data-ym="${m}">
      <rect class="fin-hit" x="${L + i * gw + 2}" y="0" width="${gw - 4}" height="${base + 24}" rx="8"></rect>
      <path class="fin-bar inc" d="${barPath(x, base, bw, sc(sums[m].inc))}"></path>
      <path class="fin-bar exp" d="${barPath(x + bw + gap, base, bw, sc(sums[m].exp))}"></path>
      <text x="${L + i * gw + gw / 2}" y="${base + 17}" text-anchor="middle" class="fin-x">${monthName(m, { month: 'short' })}</text>
    </g>`;
  }).join('');
  const grid = [0.5, 1].map((f) => `<line x1="${L}" x2="${W}" y1="${base - (base - top) * f}" y2="${base - (base - top) * f}" class="fin-grid"></line>
    <text x="${L - 6}" y="${base - (base - top) * f + 3}" text-anchor="end" class="fin-ytick">${compact(max * f)}</text>`).join('');

  const catList = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const shown = catList.slice(0, 6);
  if (catList.length > 6) shown.push(['Ostatné', catList.slice(6).reduce((a, [, v]) => a + v, 0)]);
  const cmax = Math.max(1, ...shown.map(([, v]) => v));

  return h`
    <div class="fin glass">
      <div class="fin-head">
        <button class="icon-btn" data-fin-move="-1" aria-label="Predchádzajúci mesiac">${icon('back')}</button>
        <b>${esc(monthName(ym))}</b>
        <button class="icon-btn" data-fin-move="1" aria-label="Ďalší mesiac">${icon('chevron')}</button>
      </div>
      <div class="fin-kpi">
        <div><span><i class="fin-dot inc"></i>Príjmy</span><b>${money(cur.inc)}</b></div>
        <div><span><i class="fin-dot exp"></i>Výdavky</span><b>${money(cur.exp)}</b></div>
        <div><span>Bilancia</span><b>${bal > 0 ? '+' : ''}${money(bal)}</b></div>
      </div>
      <div class="fin-chart">
        <svg viewBox="0 -4 ${W} ${base + 26}" role="img" aria-label="Príjmy a výdavky za posledných 6 mesiacov">${grid}<text x="${L - 6}" y="${base + 3}" text-anchor="end" class="fin-ytick">0 €</text><line x1="${L}" x2="${W}" y1="${base}" y2="${base}" class="fin-axis"></line>${bars}</svg>
        <div class="fin-tip" hidden></div>
      </div>
      ${shown.length ? `<div class="fin-cats"><div class="fin-sub">Výdavky podľa kategórií</div>
        ${shown.map(([c, v]) => `<div class="fin-cat"><div class="fin-cat-row"><span>${esc(c)}</span><b>${money(v)}</b></div>
          <div class="fin-track"><i style="width:${Math.max(2, (v / cmax) * 100)}%"></i></div></div>`).join('')}</div>` : ''}
      <details class="fin-table"><summary>Zobraziť ako tabuľku</summary>
        <table><thead><tr><th>Mesiac</th><th>Príjmy</th><th>Výdavky</th><th>Bilancia</th></tr></thead><tbody>
        ${months.map((m) => `<tr><td>${esc(monthName(m, { month: 'short', year: 'numeric' }))}</td><td>${money(sums[m].inc)}</td><td>${money(sums[m].exp)}</td><td>${money(sums[m].inc - sums[m].exp)}</td></tr>`).join('')}
        </tbody></table></details>
      <div class="fin-foot"><span>Na zaplatenie</span><b>${money(toPay)}</b></div>
      ${otherCurrency ? '<div class="fin-note">Grafy rátajú len sumy v eurách.</div>' : ''}
    </div>`;
}

function bindFinance(sec) {
  const box = $app.querySelector('.fin');
  if (!box) return;
  const cur = state.finMonth[sec.id] || ymOf(new Date());
  box.querySelectorAll('[data-fin-move]').forEach((b) => {
    b.onclick = () => { state.finMonth[sec.id] = shiftYm(cur, Number(b.dataset.finMove)); sec._paint(); };
  });
  const tip = box.querySelector('.fin-tip');
  const { sums } = financeData(state.items[sec.id] || [], cur);
  box.querySelectorAll('.fin-g').forEach((g) => {
    g.onclick = () => { state.finMonth[sec.id] = g.dataset.ym; sec._paint(); };
    g.onpointerenter = () => {
      const s = sums[g.dataset.ym];
      tip.innerHTML = `<b>${esc(monthName(g.dataset.ym))}</b><span><i class="fin-dot inc"></i>Príjmy ${money(s.inc)}</span><span><i class="fin-dot exp"></i>Výdavky ${money(s.exp)}</span>`;
      const r = g.getBoundingClientRect(), pr = box.querySelector('.fin-chart').getBoundingClientRect();
      tip.style.left = Math.min(Math.max(0, r.left - pr.left + r.width / 2 - 80), pr.width - 160) + 'px';
      tip.hidden = false;
    };
    g.onpointerleave = () => { tip.hidden = true; };
  });
}

function sectionHTML(sec) {
  const T = typeOf(sec);
  const all = state.items[sec.id];
  const f = state.filter[sec.id] || T.defaultFilter || 'all';
  let list = all ? sortItems(sec, all) : null;
  if (list && f !== 'all') {
    list = list.filter((it) => (T.match ? T.match(it, f) : f === 'open' ? !it.done : f === 'done' ? it.done : true));
  }
  const q = state.query.trim().toLowerCase();
  if (list && q) list = list.filter((it) => [it.title, it.note, ...(it.tags || []), it.person].join(' ').toLowerCase().includes(q));

  let summary = '';
  if (sec.type === 'bills' && all) summary = financeHTML(sec, all);

  return h`
    <div class="topbar">
      <a class="icon-btn" href="#/">${icon('back')}</a>
      ${secIcon(sec)}
      <h1>${esc(sec.name)}</h1>
    </div>
    <div class="toolbar"><label class="search glass">${icon('search')}<input id="q" placeholder="Hľadať…" value="${esc(state.query)}"></label></div>
    ${T.filters ? `<div class="chips">${T.filters.map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>` : ''}
    ${summary}
    <div class="list ${sec.type === 'progress' ? 'timeline' : ''}">
      ${!list ? '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>'
        : list.length ? list.map((it) => cardHTML(sec, it)).join('')
        : `<div class="empty">${secIcon(sec)}<div>${q ? 'Nič sa nenašlo' : 'Zatiaľ tu nič nie je'}</div></div>`}
    </div>
    <button class="fab" id="fab" aria-label="${esc(T.add)}">${icon('plus')}</button>`;
}

async function renderSection(id) {
  if (!state.sections) { try { await loadSections(); } catch (e) { toast(e.message, true); return; } }
  const sec = state.sections.find((s) => s.id === id);
  if (!sec) { $app.innerHTML = '<div class="empty">Sekcia neexistuje</div>'; return; }
  state.query = '';
  const paint = () => {
    const old = document.getElementById('q');
    const hadFocus = old && document.activeElement === old;
    const pos = old?.selectionStart;
    $app.innerHTML = sectionHTML(sec);
    bindSection(sec);
    if (hadFocus) { const q = document.getElementById('q'); q.focus(); q.setSelectionRange(pos, pos); }
  };
  sec._paint = paint;
  paint();
  try {
    state.items[sec.id] = await api(`/sections/${sec.id}/items`);
    if (route().id === id) paint();
  } catch (e) { toast(e.message, true); }
}

function bindSection(sec) {
  const q = document.getElementById('q');
  q.oninput = () => { state.query = q.value; sec._paint(); };
  $app.querySelectorAll('[data-filter]').forEach((b) => { b.onclick = () => { state.filter[sec.id] = b.dataset.filter; sec._paint(); }; });
  $app.querySelectorAll('[data-toggle]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); toggleDone(sec, b.dataset.toggle); };
  });
  $app.querySelectorAll('[data-cgal]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const it = (state.items[sec.id] || []).find((i) => i.id === b.dataset.item);
      if (it) openGallery((it.files || []).filter(isImg), Number(b.dataset.cgal));
    };
  });
  hydrateThumbs($app, true);
  $app.querySelectorAll('[data-open]').forEach((c) => {
    c.onclick = () => openEditor(sec, (state.items[sec.id] || []).find((i) => i.id === c.dataset.open));
  });
  document.getElementById('fab').onclick = () => openEditor(sec, null);
  if (sec.type === 'bills') bindFinance(sec);
}

function nextDue(iso, rec) {
  const d = new Date((iso || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
  const m = { Mesačne: 1, Štvrťročne: 3, Ročne: 12 }[rec];
  if (!m) return null;
  d.setMonth(d.getMonth() + m);
  return d.toLocaleDateString('sv-SE');
}

async function toggleDone(sec, id) {
  const list = state.items[sec.id] || [];
  const it = list.find((i) => i.id === id);
  if (!it) return;
  it.done = !it.done; // optimisticky
  sec._paint();
  try {
    Object.assign(it, await api(`/sections/${sec.id}/items/${id}`, { method: 'PATCH', json: { done: it.done } }));
    if (it.done && sec.type === 'bills' && nextDue(it.due, it.recurring)) {
      const copy = { title: it.title, amount: it.amount, currency: it.currency, recurring: it.recurring, note: it.note,
        kind: it.kind, category: it.category, due: nextDue(it.due, it.recurring) };
      const created = await api(`/sections/${sec.id}/items`, { method: 'POST', json: copy });
      list.unshift(created);
      toast(`${isIncome(it) ? 'Ďalší príjem' : 'Ďalšia platba'} pridaná na ${fmtDate(created.due)}`);
    }
    sec._paint();
  } catch (e) {
    it.done = !it.done; sec._paint(); toast(e.message, true);
  }
}

/* =========================================================
   Editor položky (spodný panel)
   ========================================================= */
function openSheet(html) {
  $layer.innerHTML = `<div class="sheet-wrap"><div class="sheet"><div class="grab"></div>${html}</div></div>`;
  const wrap = $layer.firstElementChild;
  wrap.onclick = (e) => { if (e.target === wrap) closeSheet(); };
  return wrap.querySelector('.sheet');
}
function closeSheet() { $layer.innerHTML = ''; }

function fieldHTML(key, sec, val) {
  const T = typeOf(sec);
  const F = FIELDS[key];
  const label = (T.labels && T.labels[key]) || F.label;
  const v = val ?? '';
  switch (F.type) {
    case 'kind': return `<div class="seg" role="radiogroup" aria-label="Typ">
        <label><input type="radio" name="kind" value="expense" ${v !== 'income' ? 'checked' : ''}><span><i class="fin-dot exp"></i>Výdavok</span></label>
        <label><input type="radio" name="kind" value="income" ${v === 'income' ? 'checked' : ''}><span><i class="fin-dot inc"></i>Príjem</span></label></div>`;
    case 'category': return `<div class="field"><label>${label}</label><input name="${key}" value="${esc(v)}" list="cat-list" autocomplete="off" placeholder="napr. Energie, Výplata"><datalist id="cat-list"></datalist></div>`;
    case 'textarea': return `<div class="field"><label>${label}</label><textarea name="${key}">${esc(v)}</textarea></div>`;
    case 'select': return `<div class="field"><label>${label}</label><select name="${key}">${F.options.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
    case 'range': return `<div class="field"><label>${label}: <b id="rv-${key}">${Number(v) || 0} %</b></label><input type="range" name="${key}" min="0" max="100" step="5" value="${Number(v) || 0}" oninput="document.getElementById('rv-${key}').textContent=this.value+' %'"></div>`;
    case 'tags': return `<div class="field"><label>${label}</label><input name="${key}" value="${esc((val || []).join(', '))}"></div>`;
    case 'lines': return `<div class="field"><label>${label}</label><textarea name="${key}" style="min-height:70px">${esc((val || []).join('\n'))}</textarea></div>`;
    case 'switch': return `<label class="switch"><span id="lbl-${key}">${label}</span><input type="checkbox" name="${key}" ${val ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--accent)"></label>`;
    case 'number': return `<div class="field"><label>${label}</label><input type="number" inputmode="decimal" step="0.01" name="${key}" value="${esc(v)}"></div>`;
    case 'date': return `<div class="field"><label id="lbl-${key}">${label}</label><input type="date" name="${key}" value="${esc(v)}"></div>`;
    default: return `<div class="field"><label>${label}</label><input name="${key}" value="${esc(v)}" ${key === 'title' ? 'required autocomplete="off"' : ''}></div>`;
  }
}

function bindKind(sheet, form, sec) {
  const update = () => {
    const inc = form.elements.kind.value === 'income';
    const due = document.getElementById('lbl-due');
    if (due) due.textContent = inc ? 'Dátum' : 'Splatnosť';
    const done = document.getElementById('lbl-done');
    if (done) done.textContent = inc ? 'Prijaté' : 'Zaplatené';
    const used = (state.items[sec.id] || []).filter((i) => isIncome(i) === inc).map((i) => i.category).filter(Boolean);
    const cats = [...new Set([...used, ...CATEGORIES[inc ? 'income' : 'expense']])];
    sheet.querySelector('#cat-list').innerHTML = cats.map((c) => `<option value="${esc(c)}"></option>`).join('');
    if (inc && !form.elements.due.value) form.elements.due.value = new Date().toLocaleDateString('sv-SE');
  };
  form.querySelectorAll('input[name=kind]').forEach((r) => { r.onchange = update; });
  update();
}

function readForm(form, sec) {
  const out = {};
  for (const key of typeOf(sec).fields) {
    const el = form.elements[key];
    if (!el) continue;
    const F = FIELDS[key];
    if (F.type === 'switch') out[key] = el.checked;
    else if (F.type === 'tags') out[key] = el.value.split(',').map((s) => s.trim()).filter(Boolean);
    else if (F.type === 'lines') out[key] = el.value.split('\n').map((s) => s.trim()).filter(Boolean);
    else if (F.type === 'number' || F.type === 'range') out[key] = el.value === '' ? null : Number(el.value);
    else out[key] = el.value;
  }
  return out;
}

/* ---------- zmenšovanie fotiek pred nahraním ---------- */
const SHRINK = { maxSide: 1920, quality: 0.8 };
const shrinkOn = () => store.get('shrinkImages', true);

async function shrinkImage(file) {
  // GIF (animácie) a SVG nechávame tak; HEIC prehliadač väčšinou nevie otvoriť → ostane originál
  if (!shrinkOn() || !/^image\/(jpeg|png|webp|heic|heif|bmp)$/i.test(file.type) || file.size < 300 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, SHRINK.maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // priehľadné PNG → biele pozadie (JPEG nemá priehľadnosť)
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', SHRINK.quality));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    toast(`${file.name}: ${fileSize(file.size)} → ${fileSize(blob.size)}`);
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file; // formát, ktorý prehliadač nevie spracovať – nahrá sa originál
  }
}

function filesHTML(item) {
  const files = item?.files || [];
  const imgs = files.filter(isImg);
  const thumbs = imgs.length ? `<div class="thumbs">${imgs.map((f, i) => `
    <div class="thumb">
      <button type="button" class="thumb-img" data-gal="${i}" aria-label="Zobraziť ${esc(f.name)}"><img data-src="${esc(f.path)}" alt=""></button>
      <button type="button" class="thumb-x" data-rmfile="${esc(f.path)}" aria-label="Odstrániť ${esc(f.name)}">${icon('x')}</button>
    </div>`).join('')}</div>` : '';
  return thumbs + files.filter((f) => !isImg(f)).map((f) => `
    <div class="file-row">
      ${icon('file')}
      <div class="nm" data-view="${esc(f.path)}">${esc(f.name)}<br><small>${fileSize(f.size)}</small></div>
      <button type="button" class="icon-btn danger" data-rmfile="${esc(f.path)}" aria-label="Odstrániť">${icon('trash')}</button>
    </div>`).join('');
}

function openEditor(sec, item) {
  const T = typeOf(sec);
  const isNew = !item;
  const data = item || { ...(T.defaults || {}), date: ['checklist', 'progress'].includes(sec.type) ? new Date().toLocaleDateString('sv-SE') : undefined };
  let pending = [];

  const sheet = openSheet(h`
    <div class="sheet-head">
      ${secIcon(sec)}
      <h2>${isNew ? esc(T.add) : 'Upraviť'}</h2>
      <button class="icon-btn" data-close>${icon('x')}</button>
    </div>
    <form id="ef">
      ${T.fields.filter((k) => !(isNew && k === 'done')).map((k) => fieldHTML(k, sec, data[k])).join('')}
      ${(item?.links || []).length ? `<div class="files">${item.links.map((l) => `<a class="file-row" href="${esc(l)}" target="_blank" rel="noopener">${icon('link')}<span class="nm">${esc(l)}</span></a>`).join('')}</div>` : ''}
      <div class="field"><label>Prílohy (PDF, obrázky… max 4 MB${shrinkOn() ? ', fotky sa zmenšia' : ''})</label></div>
      <div class="files" id="files">${filesHTML(item)}</div>
      <label class="drop">${icon('upload')}<span id="droplbl">Pridať súbor</span>
        <input type="file" id="fi" multiple hidden accept="application/pdf,image/*,.stl,.step,.3mf,.gcode,.zip,.txt,.kicad_pcb,.sch,.ino">
      </label>
      <div class="actions" style="margin-top:20px">
        ${isNew ? '' : `<button type="button" class="btn danger" id="del">${icon('trash')}</button>`}
        <button class="btn" id="save">${icon('check')}Uložiť</button>
      </div>
    </form>`);

  sheet.querySelector('[data-close]').onclick = closeSheet;
  const form = sheet.querySelector('#ef');
  if (sec.type === 'bills') bindKind(sheet, form, sec);
  if (isNew) setTimeout(() => form.elements.title?.focus(), 250);

  const bindFiles = () => {
    sheet.querySelectorAll('[data-view]').forEach((el) => {
      el.onclick = () => openFile((item.files || []).find((f) => f.path === el.dataset.view));
    });
    sheet.querySelectorAll('[data-gal]').forEach((el) => {
      el.onclick = () => openGallery((item.files || []).filter(isImg), Number(el.dataset.gal));
    });
    hydrateThumbs(sheet);
    sheet.querySelectorAll('[data-rmfile]').forEach((el) => {
      el.onclick = async () => {
        if (!confirm('Odstrániť súbor?')) return;
        try {
          const upd = await api(`/sections/${sec.id}/items/${item.id}/files?path=${encodeURIComponent(el.dataset.rmfile)}`, { method: 'DELETE' });
          Object.assign(item, upd);
          sheet.querySelector('#files').innerHTML = filesHTML(item);
          bindFiles();
          sec._paint?.();
        } catch (e) { toast(e.message, true); }
      };
    });
  };
  bindFiles();

  const upload = async (it, file) => {
    file = await shrinkImage(file);
    if (file.size > 4 * 1024 * 1024) { toast(`${file.name} je väčší ako 4 MB`, true); return it; }
    const fd = new FormData();
    fd.append('file', file);
    return api(`/sections/${sec.id}/items/${it.id}/files`, { method: 'POST', form: fd });
  };

  sheet.querySelector('#fi').onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (isNew) {
      pending.push(...files);
      sheet.querySelector('#droplbl').textContent = `Pripravené: ${pending.map((f) => f.name).join(', ')}`;
      return;
    }
    const lbl = sheet.querySelector('#droplbl');
    for (const f of files) {
      lbl.textContent = `Nahrávam ${f.name}…`;
      try { Object.assign(item, await upload(item, f)); } catch (err) { toast(err.message, true); }
    }
    lbl.textContent = 'Pridať súbor';
    sheet.querySelector('#files').innerHTML = filesHTML(item);
    bindFiles();
    sec._paint?.();
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = sheet.querySelector('#save');
    btn.disabled = true;
    try {
      const body = readForm(form, sec);
      let saved;
      if (isNew) {
        saved = await api(`/sections/${sec.id}/items`, { method: 'POST', json: body });
        for (const f of pending) {
          try { saved = await upload(saved, f); } catch (err) { toast(err.message, true); }
        }
        (state.items[sec.id] ||= []).unshift(saved);
      } else {
        saved = await api(`/sections/${sec.id}/items/${item.id}`, { method: 'PATCH', json: body });
        Object.assign(item, saved);
      }
      closeSheet();
      sec._paint?.();
      toast('Uložené');
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  };

  const del = sheet.querySelector('#del');
  if (del) del.onclick = async () => {
    if (!confirm(`Naozaj zmazať „${item.title}“?`)) return;
    try {
      await api(`/sections/${sec.id}/items/${item.id}`, { method: 'DELETE' });
      state.items[sec.id] = state.items[sec.id].filter((i) => i.id !== item.id);
      closeSheet();
      sec._paint?.();
      toast('Zmazané');
    } catch (err) { toast(err.message, true); }
  };
}

/* =========================================================
   Prehliadač súborov (PDF cez pdf.js, obrázky)
   ========================================================= */
let pdfjsPromise;
function loadPdfJs() {
  pdfjsPromise ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      res(window.pdfjsLib);
    };
    s.onerror = rej;
    document.head.appendChild(s);
  });
  return pdfjsPromise;
}

/* ---------- miniatúry a galéria fotiek ---------- */
const isImg = (f) => (f.type || '').startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name || f.path || '');
const imgUrls = new Map(); // cesta → Promise<objectURL>, aby sa každá fotka sťahovala len raz

function imageUrl(path) {
  if (!imgUrls.has(path)) {
    const p = api('/file?path=' + encodeURIComponent(path), { raw: true }).then((b) => URL.createObjectURL(b));
    p.catch(() => imgUrls.delete(path));
    imgUrls.set(path, p);
  }
  return imgUrls.get(path);
}

function thumbStrip(it) {
  const imgs = (it.files || []).filter(isImg);
  if (!imgs.length) return '';
  const shown = imgs.slice(0, 4);
  return `<div class="card-thumbs">${shown.map((f, i) => `
    <button type="button" class="card-thumb" data-cgal="${i}" data-item="${it.id}" aria-label="Zobraziť fotku ${i + 1}">
      <img data-src="${esc(f.path)}" alt="">${i === shown.length - 1 && imgs.length > shown.length ? `<span>+${imgs.length - shown.length}</span>` : ''}
    </button>`).join('')}</div>`;
}

let thumbObserver;
function hydrateThumbs(root, lazy = false) {
  const load = (img) => {
    if (img.dataset.loaded) return;
    img.dataset.loaded = '1';
    imageUrl(img.dataset.src).then((u) => { img.src = u; img.classList.add('ok'); }).catch(() => img.classList.add('err'));
  };
  const imgs = root.querySelectorAll('img[data-src]');
  if (!lazy || !('IntersectionObserver' in window)) { imgs.forEach(load); return; }
  thumbObserver ||= new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { thumbObserver.unobserve(e.target); load(e.target); }
  }), { rootMargin: '200px' });
  imgs.forEach((img) => thumbObserver.observe(img));
}

function openGallery(files, start = 0) {
  if (!files.length) return;
  let i = Math.max(0, Math.min(start, files.length - 1));
  const multi = files.length > 1;
  const v = document.createElement('div');
  v.className = 'viewer gallery';
  v.innerHTML = `
    <div class="vh"><button class="icon-btn" data-x aria-label="Zavrieť">${icon('x')}</button>
      <b class="g-name"></b><span class="g-count"></span>
      <a class="icon-btn" data-dl aria-label="Stiahnuť">${icon('download')}</a></div>
    <div class="g-stage">
      <img class="g-img" alt=""><div class="spinner g-spin"></div>
      ${multi ? `<button class="g-nav prev" aria-label="Predchádzajúca">${icon('back')}</button>
      <button class="g-nav next" aria-label="Ďalšia">${icon('chevron')}</button>` : ''}
    </div>
    ${multi ? `<div class="g-strip">${files.map((f, k) => `<button data-k="${k}" aria-label="Fotka ${k + 1}"><img data-src="${esc(f.path)}" alt=""></button>`).join('')}</div>` : ''}`;
  document.body.appendChild(v);
  const img = v.querySelector('.g-img'), spin = v.querySelector('.g-spin');

  const show = async (k) => {
    i = (k + files.length) % files.length;
    const f = files[i];
    v.querySelector('.g-name').textContent = f.name;
    v.querySelector('.g-count').textContent = multi ? `${i + 1} / ${files.length}` : '';
    v.querySelectorAll('.g-strip button').forEach((b) => b.classList.toggle('on', Number(b.dataset.k) === i));
    v.querySelector(`.g-strip button[data-k="${i}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    img.classList.remove('ok');
    spin.hidden = false;
    try {
      const u = await imageUrl(f.path);
      if (files[i] !== f) return; // medzitým prepnuté na inú
      img.src = u;
      img.classList.add('ok');
      const dl = v.querySelector('[data-dl]');
      dl.href = u; dl.download = f.name;
    } catch (e) { toast(e.message, true); }
    spin.hidden = true;
    // prednačítaj susedné
    if (multi) { imageUrl(files[(i + 1) % files.length].path); imageUrl(files[(i - 1 + files.length) % files.length].path); }
  };

  const close = () => { v.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') show(i + 1);
    else if (e.key === 'ArrowLeft') show(i - 1);
  };
  document.addEventListener('keydown', onKey);
  v.querySelector('[data-x]').onclick = close;
  v.querySelector('.g-nav.prev')?.addEventListener('click', () => show(i - 1));
  v.querySelector('.g-nav.next')?.addEventListener('click', () => show(i + 1));
  v.querySelectorAll('.g-strip button').forEach((b) => { b.onclick = () => show(Number(b.dataset.k)); });

  // potiahnutie prstom doľava/doprava
  let x0 = null;
  const stage = v.querySelector('.g-stage');
  stage.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  stage.addEventListener('pointerup', (e) => {
    if (x0 == null || !multi) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1));
  });
  hydrateThumbs(v);
  show(i);
}

async function openFile(f) {
  if (f && isImg(f)) return openGallery([f]);
  if (!f) return;
  const v = document.createElement('div');
  v.className = 'viewer';
  v.innerHTML = `<div class="vh"><button class="icon-btn" data-x>${icon('back')}</button><b>${esc(f.name)}</b><a class="icon-btn" data-dl>${icon('download')}</a></div><div class="vb"><div class="spinner"></div></div>`;
  document.body.appendChild(v);
  v.querySelector('[data-x]').onclick = () => { v.remove(); if (url) URL.revokeObjectURL(url); };
  const body = v.querySelector('.vb');
  let url;
  try {
    const blob = await api('/file?path=' + encodeURIComponent(f.path), { raw: true });
    url = URL.createObjectURL(blob);
    const dl = v.querySelector('[data-dl]');
    dl.href = url;
    dl.download = f.name;
    if (blob.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
      const pdfjs = await loadPdfJs();
      const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
      body.innerHTML = '';
      const width = Math.min(body.clientWidth - 20, 900);
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const vp0 = page.getViewport({ scale: 1 });
        const scale = (width / vp0.width) * (window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        c.style.width = width + 'px';
        body.appendChild(c);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      }
    } else if (blob.type.startsWith('image/')) {
      body.innerHTML = `<img src="${url}" alt="">`;
    } else {
      body.innerHTML = `<div class="empty" style="color:#fff">Tento typ súboru sa nedá zobraziť.<br><br><a class="btn" href="${url}" download="${esc(f.name)}">${icon('download')}Stiahnuť</a></div>`;
    }
  } catch (e) {
    body.innerHTML = `<div class="empty" style="color:#fff">${esc(e.message)}</div>`;
  }
}

/* =========================================================
   Asistent
   ========================================================= */
const HORO_SOURCES = [
  ['auto', 'Automaticky'], ['sita', 'SITA.sk'], ['sibyla', 'Sibyla – Zoznam.sk'], ['moneo', 'Moneo.sk'], ['vsevedko', 'Vševedko.sk'],
];

const ZODIAC = [
  ['baran', 'Baran', '♈'], ['byk', 'Býk', '♉'], ['blizenci', 'Blíženci', '♊'], ['rak', 'Rak', '♋'],
  ['lev', 'Lev', '♌'], ['panna', 'Panna', '♍'], ['vahy', 'Váhy', '♎'], ['skorpion', 'Škorpión', '♏'],
  ['strelec', 'Strelec', '♐'], ['kozorozec', 'Kozorožec', '♑'], ['vodnar', 'Vodnár', '♒'], ['ryby', 'Ryby', '♓'],
];

const SUGGESTIONS = [
  'Čo treba zajtra do školy?',
  'Ktoré účty ešte nie sú zaplatené?',
  'Zapíš do školy: v piatok výkres a farbičky',
  'Zhrň moje rozpracované projekty',
];

function mdLite(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderAssistant() {
  const enabled = state.status?.assistant;
  $app.innerHTML = h`
    <div class="topbar">
      <h1>Asistent</h1>
      ${state.chat.length ? `<button class="icon-btn" id="clr" aria-label="Nový rozhovor">${icon('trash')}</button>` : ''}
    </div>
    <div class="chat" id="chat">
      ${state.chat.length ? '' : h`
        <div class="hero">
          <div class="orb">${icon('sparkles')}</div>
          <h2>Ahoj, s čím pomôžem?</h2>
          <p>${enabled ? 'Viem čítať a zapisovať do tvojich sekcií.' : 'Asistent zatiaľ nie je zapnutý – na Verceli nastav ANTHROPIC_API_KEY.'}</p>
        </div>
        <div class="suggest">${SUGGESTIONS.map((s) => `<button class="chip" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>`}
      ${state.chat.map((m) => `<div class="msg ${m.role}">${mdLite(m.content)}</div>`).join('')}
    </div>
    <form class="composer glass" id="cf">
      <textarea rows="1" name="m" placeholder="Napíš správu…" ${enabled ? '' : 'disabled'}></textarea>
      <button class="btn" ${enabled ? '' : 'disabled'} aria-label="Odoslať">${icon('send')}</button>
    </form>`;

  const form = document.getElementById('cf');
  const ta = form.m;
  ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; };
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } };
  document.getElementById('clr')?.addEventListener('click', () => { state.chat = []; store.set('chat', []); renderAssistant(); });
  $app.querySelectorAll('[data-sug]').forEach((b) => { b.onclick = () => { ta.value = b.dataset.sug; form.requestSubmit(); }; });
  window.scrollTo(0, document.body.scrollHeight);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text) return;
    state.chat.push({ role: 'user', content: text });
    store.set('chat', state.chat.slice(-40));
    renderAssistant();
    const chat = document.getElementById('chat');
    chat.insertAdjacentHTML('beforeend', '<div class="msg assistant typing" id="typing"><i></i><i></i><i></i></div>');
    window.scrollTo(0, document.body.scrollHeight);
    try {
      const res = await api('/assistant', { method: 'POST', json: { messages: state.chat } });
      state.chat.push({ role: 'assistant', content: res.reply });
      if (res.changed) { state.items = {}; state.overview = null; }
    } catch (err) {
      state.chat.push({ role: 'assistant', content: '⚠️ ' + err.message });
    }
    store.set('chat', state.chat.slice(-40));
    if (route().view === 'assistant') renderAssistant();
  };
}

/* =========================================================
   Nastavenia
   ========================================================= */
function renderSettings() {
  const st = state.status || {};
  const secs = state.sections || [];
  const theme = document.documentElement.dataset.theme;
  $app.innerHTML = h`
    <div class="topbar"><h1>Nastavenia</h1></div>
    <div class="section-title">Sekcie</div>
    <div class="set-list">
      ${secs.map((s, i) => `
        <div class="set-row glass">
          ${secIcon(s)}
          <div class="nm">${esc(s.name)}<small>${esc(st.section_types?.[s.type] || s.type)}</small></div>
          <button class="icon-btn" data-mv="${i}:-1" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
          <button class="icon-btn" data-mv="${i}:1" ${i === secs.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
          <button class="icon-btn" data-ed="${i}">${icon('edit')}</button>
        </div>`).join('')}
      <button class="btn ghost block" id="addsec">${icon('plus')}Pridať sekciu</button>
    </div>
    <div class="section-title">Vzhľad</div>
    <div class="set-list">
      <button class="set-row glass" id="theme" style="cursor:pointer;text-align:left;border:1px solid var(--border)">
        <div class="sec-ic">${icon(theme === 'light' ? 'sun' : 'moon')}</div>
        <div class="nm">${theme === 'light' ? 'Svetlý režim' : 'Tmavý režim'}<small>Ťukni pre zmenu</small></div>
      </button>
    </div>
    <div class="section-title">Súbory</div>
    <div class="set-list">
      <label class="switch glass" style="margin:0"><span>Zmenšovať fotky pri nahrávaní<br><small style="color:var(--muted)">max. ${SHRINK.maxSide} px, typicky 200–500 kB</small></span>
        <input type="checkbox" id="shrink-on" ${shrinkOn() ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--accent)"></label>
    </div>
    <div class="section-title">Horoskop</div>
    <div class="set-list">
      <label class="switch glass" style="margin:0"><span>Zobrazovať denný horoskop</span>
        <input type="checkbox" id="horo-on" ${state.settings.horoscope ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--accent)"></label>
      <div class="field" style="margin:0"><select id="horo-sign" class="input">
        ${ZODIAC.map(([k, n, sym]) => `<option value="${k}" ${k === state.settings.zodiac ? 'selected' : ''}>${sym}\uFE0E ${n}</option>`).join('')}
      </select></div>
      <div class="field" style="margin:0"><select id="horo-src" class="input">
        ${HORO_SOURCES.map(([k, n]) => `<option value="${k}" ${k === (state.settings.horo_source || 'auto') ? 'selected' : ''}>Zdroj: ${n}</option>`).join('')}
      </select></div>
      <button class="btn ghost block" id="horo-diag">Diagnostika horoskopu</button>
    </div>
    <div class="section-title">Systém</div>
    <div class="info-card glass">
      <div class="r"><span>Ukladanie</span><span>${st.storage === 'github' ? 'GitHub repozitár' : st.storage === 'missing' ? '⚠️ Nenastavené' : st.offline ? 'Offline' : 'Lokálne (.data/)'}</span></div>
      <div class="r"><span>AI asistent</span><span>${st.assistant ? 'Zapnutý' : 'Vypnutý'}</span></div>
      <div class="r"><span>Verzia</span><span>1.6</span></div>
    </div>
    ${st.auth_required ? `<button class="btn danger block" id="lo">${icon('logout')}Odhlásiť</button>` : ''}`;

  $app.querySelectorAll('[data-mv]').forEach((b) => {
    b.onclick = () => {
      const [i, d] = b.dataset.mv.split(':').map(Number);
      const arr = [...secs];
      [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
      saveSections(arr);
    };
  });
  $app.querySelectorAll('[data-ed]').forEach((b) => { b.onclick = () => editSection(Number(b.dataset.ed)); });
  document.getElementById('addsec').onclick = () => editSection(-1);
  const saveHoro = async (changes) => {
    try {
      state.settings = await api('/settings', { method: 'PATCH', json: changes });
      store.set('cache:settings', state.settings);
      toast('Uložené');
    } catch (e) { toast(e.message, true); }
  };
  document.getElementById('horo-on').onchange = (e) => saveHoro({ horoscope: e.target.checked });
  document.getElementById('horo-diag').onclick = showHoroDiag;
  document.getElementById('horo-src').onchange = (e) => saveHoro({ horo_source: e.target.value });
  document.getElementById('horo-sign').onchange = (e) => saveHoro({ zodiac: e.target.value });
  document.getElementById('shrink-on').onchange = (e) => { store.set('shrinkImages', e.target.checked); toast('Uložené'); };
  document.getElementById('theme').onclick = () => {
    const t = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch { /* bez úložiska */ }
    renderSettings();
  };
  document.getElementById('lo')?.addEventListener('click', logout);
  if (!state.sections) loadSections().then(() => route().view === 'settings' && renderSettings()).catch((e) => toast(e.message, true));
}

async function saveSections(arr) {
  try {
    state.sections = await api('/sections', { method: 'PUT', json: arr });
    store.set('cache:sections', state.sections);
    closeSheet();
    renderSettings();
    toast('Uložené');
  } catch (e) { toast(e.message, true); }
}

function editSection(idx) {
  const isNew = idx < 0;
  const sec = isNew ? { name: '', type: 'notes', icon: 'folder', color: '#8b5cf6' } : { ...state.sections[idx] };
  const types = state.status?.section_types || {};
  const sheet = openSheet(h`
    <div class="sheet-head">
      <div class="sec-ic" id="pv" style="--c:${esc(sec.color)}">${icon(sec.icon)}</div>
      <h2>${isNew ? 'Nová sekcia' : 'Upraviť sekciu'}</h2>
      <button class="icon-btn" data-close>${icon('x')}</button>
    </div>
    <form id="sf">
      <div class="field"><label>Názov</label><input name="name" value="${esc(sec.name)}" required></div>
      <div class="field"><label>Typ sekcie</label><select name="type" ${isNew ? '' : 'disabled'}>
        ${Object.entries(types).map(([k, v]) => `<option value="${k}" ${k === sec.type ? 'selected' : ''}>${esc(v)}</option>`).join('')}
      </select></div>
      <div class="field"><label>Farba</label><input type="color" name="color" value="${esc(sec.color)}"></div>
      <div class="field"><label>Ikona</label>
        <div class="icon-grid">${PICKABLE.map((k) => `<button type="button" data-ic="${k}" class="${k === sec.icon ? 'on' : ''}">${icon(k)}</button>`).join('')}</div>
      </div>
      <div class="field"><label>…alebo vlastná: emoji, alebo cesta k obrázku (napr. /assets/custom/moja.png)</label>
        <input name="icon" value="${esc(sec.icon)}"></div>
      <div class="actions">
        ${isNew ? '' : `<button type="button" class="btn danger" id="dels">${icon('trash')}</button>`}
        <button class="btn">${icon('check')}Uložiť</button>
      </div>
      ${isNew ? '' : '<p style="color:var(--muted);font-size:13px">Zmazaním sekcie sa dáta v GitHube nevymažú – ostanú v súbore data/items/.</p>'}
    </form>`);
  const form = sheet.querySelector('#sf');
  const pv = sheet.querySelector('#pv');
  const update = () => { pv.style.setProperty('--c', form.color.value); pv.innerHTML = icon(form.icon.value.trim()); };
  sheet.querySelector('[data-close]').onclick = closeSheet;
  form.color.oninput = update;
  form.icon.oninput = () => { sheet.querySelectorAll('[data-ic]').forEach((b) => b.classList.toggle('on', b.dataset.ic === form.icon.value)); update(); };
  sheet.querySelectorAll('[data-ic]').forEach((b) => {
    b.onclick = () => { form.icon.value = b.dataset.ic; form.icon.oninput(); };
  });
  form.onsubmit = (e) => {
    e.preventDefault();
    const s = { ...sec, name: form.name.value.trim(), color: form.color.value, icon: form.icon.value.trim() || 'folder' };
    if (isNew) s.type = form.type.value;
    const arr = [...state.sections];
    if (isNew) arr.push(s); else arr[idx] = s;
    saveSections(arr);
  };
  sheet.querySelector('#dels')?.addEventListener('click', () => {
    if (!confirm(`Zmazať sekciu „${sec.name}“?`)) return;
    saveSections(state.sections.filter((_, i) => i !== idx));
  });
}

/* =========================================================
   Kontrola novej verzie – aplikácia beží v pamäti, preto sa sama
   pozrie, či na serveri nie je novšia, a ponúkne aktualizáciu.
   ========================================================= */
const MY_VERSION = new URL(import.meta.url).searchParams.get('v');

async function checkForUpdate() {
  if (!MY_VERSION || document.getElementById('update-bar')) return;
  try {
    const html = await (await fetch('/index.html', { cache: 'no-store' })).text();
    const latest = html.match(/app\.js\?v=(\w+)/)?.[1];
    if (latest && latest !== MY_VERSION) showUpdateBar();
  } catch { /* offline – skúsime nabudúce */ }
}

function showUpdateBar() {
  const bar = document.createElement('div');
  bar.id = 'update-bar';
  bar.className = 'update-bar';
  bar.innerHTML = `<span>${icon('sparkles')}Je dostupná nová verzia</span><button class="btn">Aktualizovať</button>`;
  bar.querySelector('button').onclick = () => location.reload();
  document.body.appendChild(bar);
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
setInterval(checkForUpdate, 15 * 60 * 1000);
setTimeout(checkForUpdate, 5000);

/* =========================================================
   Štart
   ========================================================= */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
render();
