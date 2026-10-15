/* =========================================================
   Elektro – príprava na skúšku (kvízová hra a kartičky)
   ========================================================= */
let C; // kontext z app.js: { $app, $nav, api, icon, esc, toast, store, plural }
const S = { catalog: null, quiz: {}, cards: {}, stats: null };
const POINTS = 100;
const QUICK = 10;
const PASS = 0.75;

export function renderElektro(ctx, sub) {
  C = ctx;
  if (sub === 'karticky') return renderCards();
  return renderHub();
}

const $ = (sel, root = document) => root.querySelector(sel);
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const vibrate = (p) => { try { navigator.vibrate?.(p); } catch { /* bez vibrácie */ } };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

async function loadAll() {
  if (!S.catalog) S.catalog = await C.api('/elektro');
  const q = S.catalog.find((x) => x.kind === 'quiz');
  if (q && !S.quiz[q.id]) S.quiz[q.id] = await C.api('/elektro/quiz/' + q.id);
  try { S.stats = await C.api('/elektro/stats'); } catch (e) { S.stats ||= { attempts: [], questions: {}, cards: {} }; C.toast(e.message, true); }
  C.store.set('cache:elektro-stats', S.stats);
}

/* ---------- rozcestník ---------- */
async function renderHub() {
  S.stats ||= C.store.get('cache:elektro-stats', null);
  if (S.catalog && S.stats) paintHub(); else C.$app.innerHTML = '<div class="spinner"></div>';
  try { await loadAll(); } catch (e) { C.toast(e.message, true); if (!S.catalog) return; }
  if (location.hash.startsWith('#/elektro') && !document.querySelector('.qz')) paintHub();
}

function quizStats(id) {
  const atts = (S.stats?.attempts || []).filter((a) => a.quiz === id && a.total);
  const qs = S.stats?.questions?.[id] || {};
  const pct = (a) => Math.round((a.score / a.total) * 100);
  return {
    atts,
    best: atts.length ? Math.max(...atts.map(pct)) : null,
    avg: atts.length ? Math.round(atts.reduce((s, a) => s + pct(a), 0) / atts.length) : null,
    mastered: Object.values(qs).filter((s) => s.last).length,
    wrong: Object.entries(qs).filter(([, s]) => s.last === false).map(([k]) => Number(k)),
  };
}

function paintHub() {
  const { icon, esc } = C;
  const qMeta = S.catalog.find((x) => x.kind === 'quiz');
  const cMeta = S.catalog.find((x) => x.kind === 'cards');
  const st = quizStats(qMeta.id);
  const known = Object.values(S.stats?.cards?.[cMeta?.id] || {}).filter((c) => c.known).length;
  const ring = (v, max) => {
    const p = max ? Math.min(1, v / max) : 0;
    return `<svg viewBox="0 0 36 36" class="ez-ring"><circle cx="18" cy="18" r="15.5" class="bg"/><circle cx="18" cy="18" r="15.5" class="fg" style="stroke-dasharray:${(p * 97.4).toFixed(1)} 97.4"/></svg>`;
  };
  const recent = st.atts.slice(-8).reverse();
  C.$app.innerHTML = `
    <div class="ez-hero glass">
      <div class="ez-bolt">${icon('bolt')}</div>
      <div><small>Príprava na skúšku</small><h1>Elektro</h1><p>${esc(qMeta.title)}</p></div>
    </div>
    <div class="stats ez-stats">
      <div class="stat glass"><div class="lbl">${icon('target')}<span>Najlepší výsledok</span></div><div class="val">${st.best == null ? '–' : st.best + ' %'}</div><div class="sub">${st.atts.length ? `priemer ${st.avg} %` : 'zatiaľ žiadny pokus'}</div></div>
      <div class="stat glass ez-mastery"><div class="lbl">${icon('check')}<span>Zvládnuté otázky</span></div>
        <div class="val">${st.mastered}<small> / ${qMeta.count}</small></div>${ring(st.mastered, qMeta.count)}
        <div class="sub">${st.wrong.length ? `${C.plural(st.wrong.length, 'chyba', 'chyby', 'chýb')} na opravu` : 'bez chýb'}</div></div>
    </div>
    <div class="section-title">Hrať</div>
    <div class="ez-modes">
      <button class="ez-mode glass" data-mode="quick" style="--c:#8b5cf6">
        <div class="sec-ic">${icon('bolt')}</div><div><b>Rýchly kvíz</b><span>${QUICK} náhodných otázok · hneď vidíš, či máš pravdu</span></div>${icon('chevron')}</button>
      <button class="ez-mode glass" data-mode="exam" style="--c:#f59e0b">
        <div class="sec-ic">${icon('star')}</div><div><b>Ostrý test</b><span>Všetkých ${qMeta.count} otázok na čas · vyhodnotenie až na konci</span></div>${icon('chevron')}</button>
      <button class="ez-mode glass" data-mode="wrong" style="--c:#f43f5e" ${st.wrong.length ? '' : 'disabled'}>
        <div class="sec-ic">${icon('wrench')}</div><div><b>Oprav si chyby</b><span>${st.wrong.length ? `${C.plural(st.wrong.length, 'otázka', 'otázky', 'otázok')}, ktoré ti naposledy nevyšli` : 'Zatiaľ nemáš žiadne chyby 🎉'}</span></div>${icon('chevron')}</button>
      ${cMeta ? `<a class="ez-mode glass" href="#/elektro/karticky" style="--c:#22d3ee">
        <div class="sec-ic">${icon('book')}</div><div><b>Kartičky – otvorené otázky</b><span>${known} / ${cMeta.count} vieš · odpovede so schémami</span></div>${icon('chevron')}</a>` : ''}
    </div>
    <div class="section-title">Precvičiť okruh</div>
    <div class="ez-topics">${qMeta.topics.map((t) => {
      const ids = S.quiz[qMeta.id]?.questions.filter((q) => q.topic === t).map((q) => q.id) || [];
      const ok = ids.filter((id) => S.stats?.questions?.[qMeta.id]?.[id]?.last).length;
      return `<button class="ez-topic glass" data-topic="${esc(t)}"><b>${esc(t)}</b><span>${ok} / ${ids.length}</span><i style="width:${ids.length ? (ok / ids.length) * 100 : 0}%"></i></button>`;
    }).join('')}</div>
    ${recent.length ? `<div class="section-title">Posledné pokusy</div>
    <div class="ez-history glass">${recent.map((a) => {
      const p = Math.round((a.score / a.total) * 100);
      return `<div class="r"><span>${new Date(a.t * 1000).toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric' })} · ${esc(modeName(a.mode))}</span>
        <div class="bar"><i class="${p >= PASS * 100 ? 'ok' : 'bad'}" style="width:${p}%"></i></div><b>${p} %</b></div>`;
    }).join('')}</div>
    <button class="btn ghost block ez-reset" id="ez-reset">Vynulovať štatistiky</button>` : ''}`;

  C.$app.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => start(qMeta.id, b.dataset.mode); });
  C.$app.querySelectorAll('[data-topic]').forEach((b) => { b.onclick = () => start(qMeta.id, 'topic', b.dataset.topic); });
  $('#ez-reset')?.addEventListener('click', async () => {
    if (!confirm('Naozaj vymazať všetky výsledky a štatistiky?')) return;
    try { S.stats = await C.api('/elektro/stats', { method: 'DELETE' }); C.store.set('cache:elektro-stats', S.stats); paintHub(); C.toast('Štatistiky vynulované'); } catch (e) { C.toast(e.message, true); }
  });
}

function modeName(m) {
  if (m === 'quick') return 'Rýchly kvíz';
  if (m === 'exam') return 'Ostrý test';
  if (m === 'wrong') return 'Oprava chýb';
  if (m?.startsWith('topic:')) return m.slice(6);
  return m || 'Kvíz';
}

/* ---------- kvíz ---------- */
async function start(id, mode, topic) {
  if (!S.quiz[id]) { try { S.quiz[id] = await C.api('/elektro/quiz/' + id); } catch (e) { return C.toast(e.message, true); } }
  const all = S.quiz[id].questions;
  let list;
  if (mode === 'quick') list = shuffle(all).slice(0, QUICK);
  else if (mode === 'exam') list = shuffle(all);
  else if (mode === 'wrong') { const w = new Set(quizStats(id).wrong); list = shuffle(all.filter((q) => w.has(q.id))); }
  else list = shuffle(all.filter((q) => q.topic === topic));
  if (!list.length) return C.toast('Žiadne otázky');
  runQuiz({ id, mode: mode === 'topic' ? 'topic:' + topic : mode, exam: mode === 'exam', list });
}

function runQuiz(cfg) {
  const { icon, esc } = C;
  const g = { i: 0, score: 0, points: 0, combo: 0, best: 0, results: {}, picks: {}, t0: Date.now(), locked: false };
  const qs = cfg.list.map((q) => ({ ...q, opts: q.options ? shuffle(q.options) : null }));
  C.$nav.hidden = true;
  C.$app.innerHTML = `<div class="qz">
    <div class="qz-top">
      <button class="icon-btn" id="qz-x" aria-label="Ukončiť">${icon('x')}</button>
      <div class="qz-prog"><i id="qz-bar"></i></div>
      <div class="qz-meta"><span id="qz-combo" class="qz-combo"></span><span id="qz-time">0:00</span></div>
    </div>
    <div class="qz-hud"><span id="qz-count"></span><b id="qz-points">0 b</b></div>
    <div id="qz-card" class="qz-card glass"></div>
    <div class="qz-foot" id="qz-foot"></div>
  </div>`;
  const timer = setInterval(() => {
    if (!document.body.contains($('#qz-time'))) return clearInterval(timer);
    $('#qz-time').textContent = fmtTime(Math.round((Date.now() - g.t0) / 1000));
  }, 1000);
  $('#qz-x').onclick = () => {
    if (g.i > 0 && !confirm('Ukončiť kvíz? Výsledok sa neuloží.')) return;
    clearInterval(timer); C.$nav.hidden = false; renderHub();
  };

  const letters = 'ABCD';
  const show = () => {
    const q = qs[g.i];
    g.locked = false;
    $('#qz-bar').style.width = `${(g.i / qs.length) * 100}%`;
    $('#qz-count').textContent = `Otázka ${g.i + 1} / ${qs.length}`;
    const card = $('#qz-card');
    card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
    let body;
    if (q.type === 'number') {
      body = `<div class="qz-num"><input id="qz-in" inputmode="decimal" autocomplete="off" placeholder="napr. 1,25"><span>${esc(q.unit || '')}</span></div>
        ${q.formula ? `<div class="qz-hint">${icon('note')}Vzorec: <b>${esc(q.formula)}</b></div>` : ''}`;
    } else {
      body = `${q.type === 'multi' ? `<div class="qz-hint multi">${icon('check')}Viac správnych odpovedí – označ všetky</div>` : ''}
        <div class="qz-opts">${q.opts.map((o, k) => `<button class="qz-opt" data-k="${o.k}"><i>${letters[k]}</i><span>${esc(o.t)}</span></button>`).join('')}</div>`;
    }
    card.innerHTML = `<div class="qz-topic">${esc(q.topic)} · č. ${q.id}</div>
      ${q.intro ? `<p class="qz-intro">${esc(q.intro)}</p>` : ''}
      <h2 class="qz-q">${esc(q.q)}</h2>${body}<div id="qz-fb"></div>`;
    const needsConfirm = q.type === 'number' || q.type === 'multi' || cfg.exam;
    $('#qz-foot').innerHTML = needsConfirm ? `<button class="btn block" id="qz-ok" ${q.type === 'number' ? '' : 'disabled'}>${cfg.exam ? (g.i + 1 === qs.length ? 'Vyhodnotiť' : 'Ďalej') : 'Potvrdiť'}</button>` : '';
    const sel = new Set();
    card.querySelectorAll('.qz-opt').forEach((b) => {
      b.onclick = () => {
        if (g.locked) return;
        const k = b.dataset.k;
        if (q.type === 'multi') { sel.has(k) ? sel.delete(k) : sel.add(k); b.classList.toggle('sel', sel.has(k)); }
        else { sel.clear(); sel.add(k); card.querySelectorAll('.qz-opt').forEach((x) => x.classList.toggle('sel', x === b)); }
        if (!needsConfirm) return answer([...sel], b);
        $('#qz-ok').disabled = !sel.size;
      };
    });
    const inp = $('#qz-in');
    if (inp) { inp.focus(); inp.onkeydown = (e) => { if (e.key === 'Enter') $('#qz-ok').click(); }; }
    $('#qz-ok')?.addEventListener('click', () => {
      if (g.locked) return;
      if (q.type === 'number') {
        const v = parseFloat(String(inp.value).replace(',', '.').replace(/[^\d.-]/g, ''));
        if (Number.isNaN(v)) { inp.classList.add('shake'); setTimeout(() => inp.classList.remove('shake'), 500); return; }
        answer(v, inp);
      } else answer([...sel], $('#qz-ok'));
    });
  };

  const isRight = (q, a) => (q.type === 'number' ? Math.abs(a - q.answer) <= (q.tol ?? 0.01) : a.length === q.answer.length && a.every((k) => q.answer.includes(k)));

  const answer = (a, fromEl) => {
    g.locked = true;
    const q = qs[g.i];
    const ok = isRight(q, a);
    g.results[q.id] = ok;
    g.picks[q.id] = a;
    if (ok) { g.score++; g.combo++; g.best = Math.max(g.best, g.combo); g.points += POINTS + Math.min(g.combo - 1, 5) * 20; } else g.combo = 0;
    $('#qz-points').textContent = `${g.points} b`;
    const combo = $('#qz-combo');
    combo.textContent = g.combo >= 2 ? `🔥 ×${g.combo}` : '';
    combo.classList.toggle('on', g.combo >= 2);
    if (cfg.exam) return next();
    const card = $('#qz-card');
    card.querySelectorAll('.qz-opt').forEach((b) => {
      const k = b.dataset.k;
      if (q.answer.includes?.(k)) b.classList.add('right');
      else if (a.includes?.(k)) b.classList.add('wrong');
      b.disabled = true;
    });
    const inp = $('#qz-in');
    if (inp) { inp.disabled = true; inp.classList.add(ok ? 'right' : 'wrong'); }
    if (ok) {
      card.classList.add('flash-ok');
      burst(fromEl, g.combo);
      floatText(fromEl, `+${POINTS + Math.min(g.combo - 1, 5) * 20}`);
    } else {
      card.classList.add('flash-bad');
      vibrate([60, 40, 60]);
    }
    const right = q.type === 'number' ? `${String(q.answer).replace('.', ',')} ${q.unit || ''}` : '';
    $('#qz-fb').innerHTML = `<div class="qz-fb ${ok ? 'ok' : 'bad'}"><b>${ok ? pick(['Správne!', 'Výborne!', 'Presne tak!', 'Paráda!']) : 'Nesprávne'}</b>
      ${!ok && right ? `<span>Správne: <b>${esc(right)}</b></span>` : ''}
      ${q.explain ? `<span>${esc(q.explain)}</span>` : ''}</div>`;
    setTimeout(() => card.classList.remove('flash-ok', 'flash-bad'), 700);
    $('#qz-foot').innerHTML = `<button class="btn block" id="qz-next">${g.i + 1 === qs.length ? 'Zobraziť výsledok' : 'Ďalšia otázka'}${icon('chevron')}</button>`;
    $('#qz-next').onclick = next;
    $('#qz-next').focus({ preventScroll: true });
  };

  const next = () => {
    g.i++;
    if (g.i < qs.length) return show();
    clearInterval(timer);
    finish(cfg, qs, g);
  };
  show();
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];

function finish(cfg, qs, g) {
  const { icon, esc } = C;
  const total = qs.length;
  const pct = Math.round((g.score / total) * 100);
  const secs = Math.round((Date.now() - g.t0) / 1000);
  const passed = g.score / total >= PASS;
  const grade = pct === 100 ? ['Perfektné! 🏆', 'Všetko správne – na skúšku si pripravený.']
    : pct >= 90 ? ['Výborne! ⚡', 'Skoro bez chyby, len tak ďalej.']
      : passed ? ['Dobrá práca 👍', 'Prešiel by si. Doladiť chyby a bude to top.']
        : pct >= 50 ? ['Ešte potrénuj 🔧', 'Polovica je za tebou – zopakuj si chyby.']
          : ['Nevzdávaj to 💪', 'Prejdi si kartičky s odpoveďami a skús znova.'];
  // štatistika po okruhoch
  const topics = {};
  qs.forEach((q) => { const t = (topics[q.topic] ||= { ok: 0, n: 0 }); t.n++; if (g.results[q.id]) t.ok++; });
  const wrong = qs.filter((q) => !g.results[q.id]);
  const fmtAns = (q, a) => {
    if (q.type === 'number') return `${String(a).replace('.', ',')} ${q.unit || ''}`;
    const byK = Object.fromEntries((q.options || []).map((o) => [o.k, o.t]));
    return (a || []).map((k) => byK[k]).join(' + ') || '—';
  };

  C.$app.innerHTML = `<div class="qz qz-end">
    <div class="qz-result glass">
      <div class="qz-score-ring ${passed ? 'ok' : 'bad'}">
        <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="bg"/><circle cx="60" cy="60" r="52" class="fg" id="qz-arc"/></svg>
        <div><b id="qz-pct">0</b><span>%</span></div>
      </div>
      <h1>${grade[0]}</h1><p>${grade[1]}</p>
      <div class="qz-kpis">
        <div><b>${g.score}/${total}</b><span>správne</span></div>
        <div><b>${fmtTime(secs)}</b><span>čas</span></div>
        <div><b>${g.best}×</b><span>najlepšia séria</span></div>
        <div><b>${g.points}</b><span>bodov</span></div>
      </div>
    </div>
    ${Object.keys(topics).length > 1 ? `<div class="section-title">Podľa okruhov</div>
    <div class="ez-history glass">${Object.entries(topics).map(([t, v]) => {
      const p = Math.round((v.ok / v.n) * 100);
      return `<div class="r"><span>${esc(t)}</span><div class="bar"><i class="${p >= PASS * 100 ? 'ok' : 'bad'}" style="width:${p}%"></i></div><b>${v.ok}/${v.n}</b></div>`;
    }).join('')}</div>` : ''}
    ${wrong.length ? `<div class="section-title">Chyby (${wrong.length})</div>
    <div class="qz-review">${wrong.map((q) => `<div class="glass">
      <small>${esc(q.topic)} · č. ${q.id}</small><p>${esc(q.q)}</p>
      <div class="bad">${icon('x')}<span>${esc(fmtAns(q, g.picks[q.id]))}</span></div>
      <div class="ok">${icon('check')}<span>${esc(fmtAns(q, q.answer))}</span></div>
      ${q.explain ? `<div class="ex">${esc(q.explain)}</div>` : ''}</div>`).join('')}</div>` : ''}
    <div class="qz-actions">
      ${wrong.length ? '<button class="btn block" id="qz-fix">Precvičiť tieto chyby</button>' : ''}
      <button class="btn ${wrong.length ? 'ghost' : ''} block" id="qz-again">Hrať znova</button>
      <button class="btn ghost block" id="qz-back">Späť na Elektro</button>
    </div></div>`;
  window.scrollTo(0, 0);

  // animácia skóre
  const arc = $('#qz-arc'), num = $('#qz-pct'), L = 2 * Math.PI * 52;
  arc.style.strokeDasharray = `0 ${L}`;
  const t0 = performance.now(), dur = reduced() ? 1 : 1200;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    arc.style.strokeDasharray = `${(L * pct / 100) * e} ${L}`;
    num.textContent = Math.round(pct * e);
    if (k < 1) requestAnimationFrame(step); else if (passed) confetti(pct === 100 ? 260 : 160);
  };
  requestAnimationFrame(step);

  $('#qz-fix')?.addEventListener('click', () => runQuiz({ ...cfg, mode: 'wrong', exam: false, list: shuffle(wrong) }));
  $('#qz-again').onclick = () => (cfg.mode === 'quick' || cfg.exam ? start(cfg.id, cfg.exam ? 'exam' : 'quick') : runQuiz({ ...cfg, list: shuffle(cfg.list) }));
  $('#qz-back').onclick = () => { C.$nav.hidden = false; renderHub(); };

  // uloženie na GitHub
  C.api('/elektro/stats/attempt', { method: 'POST', json: { quiz: cfg.id, mode: cfg.mode, score: g.score, total, seconds: secs, results: g.results } })
    .then((s) => { S.stats = s; C.store.set('cache:elektro-stats', s); })
    .catch((e) => C.toast('Výsledok sa neuložil: ' + e.message, true));
}

/* ---------- efekty ---------- */
function burst(el, combo) {
  if (!el || reduced()) return;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const n = 14 + Math.min(combo, 6) * 4;
  const colors = ['#10b981', '#22d3ee', '#8b5cf6', '#facc15'];
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.className = 'qz-spark';
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.4, d = 50 + Math.random() * 70;
    p.style.cssText = `left:${x}px;top:${y}px;background:${colors[i % colors.length]};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 700);
  }
}

function floatText(el, text) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const t = document.createElement('div');
  t.className = 'qz-float';
  t.textContent = text;
  t.style.left = `${r.left + r.width / 2}px`;
  t.style.top = `${r.top}px`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 900);
}

function confetti(n = 160) {
  if (reduced()) return;
  const cv = document.createElement('canvas');
  cv.className = 'qz-confetti';
  document.body.appendChild(cv);
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = (cv.width = innerWidth * dpr), H = (cv.height = innerHeight * dpr);
  const ctx = cv.getContext('2d');
  const colors = ['#8b5cf6', '#22d3ee', '#10b981', '#f59e0b', '#f43f5e', '#facc15'];
  const ps = Array.from({ length: n }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35,
    vx: (Math.random() - 0.5) * 18 * dpr, vy: (-Math.random() * 16 - 6) * dpr,
    s: (5 + Math.random() * 6) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  const frame = (t) => {
    ctx.clearRect(0, 0, W, H);
    ps.forEach((p) => {
      p.vy += 0.45 * dpr; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    });
    if (t - t0 < 3200) requestAnimationFrame(frame); else cv.remove();
  };
  requestAnimationFrame(frame);
}

/* ---------- kartičky ---------- */
const imgCache = {};
async function cardImg(name) {
  imgCache[name] ||= C.api('/elektro/img/' + name, { raw: true }).then((b) => URL.createObjectURL(b));
  return imgCache[name];
}

async function renderCards() {
  const { icon, esc } = C;
  C.$app.innerHTML = '<div class="spinner"></div>';
  try {
    if (!S.catalog) S.catalog = await C.api('/elektro');
    const meta = S.catalog.find((x) => x.kind === 'cards');
    S.cards[meta.id] ||= await C.api('/elektro/cards/' + meta.id);
    S.stats ||= C.store.get('cache:elektro-stats', null) || await C.api('/elektro/stats');
  } catch (e) { C.toast(e.message, true); return; }
  const set = S.cards[S.catalog.find((x) => x.kind === 'cards').id];
  const rated = () => S.stats?.cards?.[set.id] || {};
  // najprv tie, ktoré ešte nevieš
  let order = [...set.cards].sort((a, b) => Number(!!rated()[a.id]?.known) - Number(!!rated()[b.id]?.known));
  let i = 0;

  const paint = () => {
    const c = order[i];
    const knownN = set.cards.filter((x) => rated()[x.id]?.known).length;
    const st = rated()[c.id];
    C.$app.innerHTML = `
      <div class="topbar"><a class="icon-btn" href="#/elektro">${icon('back')}</a><h1>Kartičky</h1></div>
      <div class="fc-prog"><span>${i + 1} / ${order.length}</span><div class="bar"><i style="width:${(knownN / set.cards.length) * 100}%"></i></div><span>${knownN} vieš</span></div>
      <div class="fc-wrap"><div class="fc" id="fc">
        <div class="fc-face fc-front glass">
          <div class="fc-no">${esc(c.label)}</div>
          ${st ? `<div class="fc-badge ${st.known ? 'ok' : 'bad'}">${st.known ? 'Viem' : 'Ešte neviem'}</div>` : ''}
          <h2>${esc(c.q)}</h2>
          <p class="fc-tip">Skús si odpoveď povedať nahlas, potom ťukni na kartičku.</p>
          <button class="btn block" id="fc-flip">Ukázať odpoveď</button>
        </div>
        <div class="fc-face fc-back glass">
          <div class="fc-no">${esc(c.label)} · odpoveď</div>
          <div class="fc-img"><div class="spinner"></div></div>
        </div>
      </div></div>
      <div class="fc-actions" id="fc-actions" hidden>
        <button class="btn ghost" data-known="0">${icon('x')}Ešte neviem</button>
        <button class="btn" data-known="1">${icon('check')}Viem</button>
      </div>
      <div class="fc-nav"><button class="icon-btn" id="fc-prev" ${i === 0 ? 'disabled' : ''}>${icon('back')}</button>
        <button class="icon-btn" id="fc-next" ${i === order.length - 1 ? 'disabled' : ''}>${icon('chevron')}</button></div>`;
    const fc = $('#fc');
    const flip = async () => {
      fc.classList.add('flipped');
      $('#fc-actions').hidden = false;
      const box = fc.querySelector('.fc-img');
      if (box.querySelector('img')) return;
      try {
        const u = await cardImg(c.img);
        box.innerHTML = `<img src="${u}" alt="Odpoveď ${esc(c.label)}">`;
        box.querySelector('img').onclick = (e) => { e.stopPropagation(); zoom(u); };
      } catch (e) { box.textContent = e.message; }
    };
    $('#fc-flip').onclick = (e) => { e.stopPropagation(); flip(); };
    fc.querySelector('.fc-front').onclick = flip;
    fc.querySelector('.fc-back').onclick = (e) => { if (e.target.tagName !== 'IMG') { fc.classList.remove('flipped'); } };
    $('#fc-prev').onclick = () => { i--; paint(); };
    $('#fc-next').onclick = () => { i++; paint(); };
    C.$app.querySelectorAll('[data-known]').forEach((b) => {
      b.onclick = () => {
        const known = b.dataset.known === '1';
        S.stats.cards ||= {};
        (S.stats.cards[set.id] ||= {})[c.id] = { known, t: Date.now() / 1000 };
        C.store.set('cache:elektro-stats', S.stats);
        C.api('/elektro/stats/card', { method: 'POST', json: { set: set.id, card: c.id, known } })
          .then((s) => { S.stats = s; C.store.set('cache:elektro-stats', s); })
          .catch((e) => C.toast(e.message, true));
        if (known) burst(b, 2); else vibrate(40);
        const all = set.cards.every((x) => rated()[x.id]?.known);
        if (all && known) { confetti(200); C.toast('Všetky kartičky zvládnuté! 🎉'); }
        if (i < order.length - 1) { i++; setTimeout(paint, known ? 350 : 150); } else setTimeout(() => { C.toast('Koniec balíčka – ideme odznova s tými, ktoré ešte nevieš'); order = [...set.cards].sort((a, z) => Number(!!rated()[a.id]?.known) - Number(!!rated()[z.id]?.known)); i = 0; paint(); }, 400);
      };
    });
    // potiahnutie doľava/doprava
    let x0 = null;
    fc.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
    fc.addEventListener('pointerup', (e) => {
      if (x0 == null) return;
      const dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 60) { if (dx < 0 && i < order.length - 1) { i++; paint(); } else if (dx > 0 && i > 0) { i--; paint(); } }
    });
    // prednačítaj obrázok
    cardImg(c.img).catch(() => {});
  };
  paint();
}

function zoom(src) {
  const v = document.createElement('div');
  v.className = 'viewer fc-zoom';
  v.innerHTML = `<div class="vh"><button class="icon-btn" data-x aria-label="Zavrieť">${C.icon('x')}</button><b>Odpoveď</b><span class="fc-zhint">roztiahni prstami</span></div>
    <div class="vb"><img src="${src}" alt=""></div>`;
  document.body.appendChild(v);
  const close = () => { v.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  v.querySelector('[data-x]').onclick = close;
  const img = v.querySelector('img');
  img.onclick = () => img.classList.toggle('big');
}
