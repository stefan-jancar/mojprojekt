/* =========================================================
   Elektro – samostatná aplikácia (APK pre kolegov).
   Používa tie isté moduly ako Môj priestor, ale dáta má zabalené
   v aplikácii a výsledky ukladá len v telefóne (offline, bez prihlásenia).
   ========================================================= */
import { icon } from './icons.js';
import { renderElektro } from './elektro.js';
import { VERSION } from './version.js';


const $app = document.getElementById('app');
const $nav = document.getElementById('nav');

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bez úložiska */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* bez úložiska */ } },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

/* ---------- lokálne „API“ namiesto servera ---------- */
const MAX_ATTEMPTS = 60;
const emptyStats = () => ({ attempts: [], questions: {}, cards: {} });
const getStats = () => ({ ...emptyStats(), ...store.get('el:stats', {}) });
let catalog = null;
async function loadCatalog() {
  if (!catalog) catalog = await (await fetch('data/elektro/index.json')).json();
  return catalog;
}
async function dataFile(kind, id) {
  const c = await loadCatalog();
  const item = c.find((x) => x.kind === kind && x.id === id);
  if (!item) throw new Error('Neznámy test');
  return (await fetch('data/elektro/' + item.file)).json();
}

async function api(path, { method = 'GET', json, raw } = {}) {
  const p = path.split('?')[0];
  let m;
  if (p === '/elektro' && method === 'GET') return (await loadCatalog()).map(({ file, ...x }) => x);
  if ((m = p.match(/^\/elektro\/quiz\/(.+)$/))) return dataFile('quiz', decodeURIComponent(m[1]));
  if ((m = p.match(/^\/elektro\/cards\/(.+)$/))) return dataFile('cards', decodeURIComponent(m[1]));
  if ((m = p.match(/^\/elektro\/img\/([\w-]+\.webp)$/))) {
    const r = await fetch('data/elektro/img/' + m[1]);
    if (!r.ok) throw new Error('Obrázok neexistuje');
    return raw ? r.blob() : r.json();
  }
  if (p === '/elektro/stats' && method === 'GET') return getStats();
  if (p === '/elektro/stats' && method === 'DELETE') { store.set('el:stats', emptyStats()); return emptyStats(); }
  if (p === '/elektro/stats/attempt' && method === 'POST') {
    const d = getStats();
    const a = { t: Math.floor(Date.now() / 1000), quiz: String(json.quiz || ''), mode: String(json.mode || ''), score: Number(json.score) || 0, total: Number(json.total) || 0, seconds: Number(json.seconds) || 0 };
    d.attempts = [...d.attempts, a].slice(-MAX_ATTEMPTS);
    const qs = (d.questions[a.quiz] ||= {});
    for (const [qid, ok] of Object.entries(json.results || {})) {
      const s = (qs[qid] ||= { ok: 0, bad: 0, last: null });
      s[ok ? 'ok' : 'bad']++;
      s.last = !!ok;
    }
    store.set('el:stats', d);
    return d;
  }
  if (p === '/elektro/stats/card' && method === 'POST') {
    const d = getStats();
    (d.cards[String(json.set)] ||= {})[String(json.card)] = { known: !!json.known, t: Math.floor(Date.now() / 1000) };
    store.set('el:stats', d);
    return d;
  }
  if (p === '/elektro/cabinets' && method === 'GET') return store.get('el:cabinets', []);
  if (p === '/elektro/cabinets' && method === 'PUT') { store.set('el:cabinets', json); return json; }
  throw new Error('Táto funkcia je dostupná len v aplikácii Môj priestor.');
}

/* ---------- súbory: prehliadač PDF a uloženie / zdieľanie ---------- */
const nativeApp = () => !!window.Capacitor?.isNativePlatform?.();
const canNativeShare = () => nativeApp() && window.Capacitor.isPluginAvailable?.('Filesystem') && window.Capacitor.isPluginAvailable?.('Share');
const blobToBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

async function saveBlob(blob, name) {
  if (canNativeShare()) {
    const cap = window.Capacitor;
    const { uri } = await cap.nativePromise('Filesystem', 'writeFile', { path: name, data: await blobToBase64(blob), directory: 'CACHE' });
    await cap.nativePromise('Share', 'share', { title: name, files: [uri], dialogTitle: 'Uložiť alebo poslať' }).catch(() => {});
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

let pdfjsPromise;
function loadPdfJs() {
  pdfjsPromise ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; res(window.pdfjsLib); };
    s.onerror = rej;
    document.head.appendChild(s);
  });
  return pdfjsPromise;
}

async function openViewer(name, getBlob) {
  const v = document.createElement('div');
  v.className = 'viewer';
  v.innerHTML = `<div class="vh"><button class="icon-btn" data-x>${icon('back')}</button><b>${esc(name)}</b><button class="icon-btn" data-dl aria-label="Stiahnuť">${icon('download')}</button></div><div class="vb"><div class="spinner"></div></div>`;
  document.body.appendChild(v);
  let blob;
  v.querySelector('[data-x]').onclick = () => v.remove();
  v.querySelector('[data-dl]').onclick = () => { if (blob) saveBlob(blob, name).catch((e) => toast(e.message, true)); };
  const body = v.querySelector('.vb');
  try {
    blob = await getBlob();
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
    body.innerHTML = '';
    const width = Math.min(body.clientWidth - 20, 900);
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (width / vp0.width) * (window.devicePixelRatio || 1) });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height; c.style.width = width + 'px';
      body.appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
  } catch (e) {
    body.innerHTML = `<div class="empty" style="color:#fff">${esc(e.message)}</div>`;
  }
}

/* ---------- navigácia ---------- */
const ctx = { $app, $nav, api, icon, esc, toast, store, plural, openViewer, saveBlob, nativeApp, canNativeShare, standalone: true, version: VERSION, onHub: showUpdate };

/* ---------- nová verzia na GitHube (len keď je internet) ---------- */
let latest = store.get('el:latest', null);
async function checkUpdate() {
  if (!/^\d+$/.test(VERSION) || !navigator.onLine) return;
  const last = store.get('el:checked', 0);
  if (Date.now() - last < 6 * 3600 * 1000 && latest) return showUpdate();
  try {
    const r = await fetch('https://api.github.com/repos/stefan-jancar/mojprojekt/releases?per_page=30', { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    const rel = (await r.json()).map((x) => ({ n: Number((x.tag_name.match(/^elektro-apk-(\d+)$/) || [])[1]), url: x.html_url })).filter((x) => x.n).sort((a, b) => b.n - a.n)[0];
    if (rel) { latest = rel; store.set('el:latest', rel); }
    store.set('el:checked', Date.now());
    showUpdate();
  } catch { /* offline – nevadí */ }
}
function showUpdate() {
  if (!latest || !(latest.n > Number(VERSION)) || document.getElementById('el-update')) return;
  const hero = document.querySelector('.ez-hero');
  if (!hero) return;
  hero.insertAdjacentHTML('afterend', `<a id="el-update" class="el-update glass" href="${latest.url}" target="_blank" rel="noopener">
    ${icon('download')}<div><b>Nová verzia ${latest.n} je k dispozícii</b><span>Máš verziu ${esc(VERSION)} · ťukni, stiahni Elektro.apk a nainštaluj cez starú</span></div></a>`);
}

function renderNav(sub) {
  const links = [['#/elektro', 'bolt', 'Elektro', ''], ['#/elektro/rozvadzac', 'briefcase', 'Rozvádzač', 'rozvadzac'], ['#/elektro/beckhoff', 'chip', 'Svorky', 'beckhoff']];
  $nav.innerHTML = links.map(([href, ic, label, v]) => `<a href="${href}" class="${sub === v || (v === '' && !['rozvadzac', 'beckhoff'].includes(sub)) ? 'on' : ''}">${icon(ic)}<span>${label}</span></a>`).join('')
    + `<a href="#" id="theme-t" aria-label="Téma">${icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun')}</a>`;
  document.getElementById('theme-t').onclick = (e) => {
    e.preventDefault();
    const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch { /* */ }
    render();
  };
}

function render() {
  const p = location.hash.replace(/^#\/?/, '').split('/');
  if (p[0] !== 'elektro') { location.replace('#/elektro'); return; }
  const sub = p[1] || '', arg = p[2] ? decodeURIComponent(p[2]) : '';
  $nav.hidden = false;
  renderNav(sub);
  window.scrollTo(0, 0);
  renderElektro(ctx, sub, arg);
}
window.addEventListener('hashchange', render);
render();
checkUpdate();
