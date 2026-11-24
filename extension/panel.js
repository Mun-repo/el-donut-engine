// El Donut Engine — menu + Stockfish engine (runs inside the extension iframe)
const PARENT = 'https://www.chess.com';
const $ = id => document.getElementById(id);
const $$ = s => document.querySelectorAll(s);
const MODES = ['off', 'highlight', 'coach', 'check', 'auto'];
const DEF = { mode: 'off', delay: 1500, jitter: true, elo: 2000, depth: 14, lines: 1, arrows: true, evalbar: true, theme: 'dark', lang: 'en' };
let S = { ...DEF }, engineOk = false, current = null, mine = true, info = {}, busy = false, skip = 0;
const t = k => (I18N[S.lang] || I18N.en)[k] ?? I18N.en[k] ?? k;

// ---------- Engine ----------
const engine = new Worker('engine/stockfish.js');
const uci = c => engine.postMessage(c);
engine.onmessage = ({ data: l }) => {
  if (typeof l !== 'string') return;
  if (l === 'uciok') { applyEngine(); uci('isready'); }
  else if (l === 'readyok' && !engineOk) {
    engineOk = true; status(); parent.postMessage({ type: 'ready' }, PARENT); push();
  }
  else if (l.startsWith('info') && l.includes(' pv ') && !skip) {
    const cp = l.match(/score cp (-?\d+)/), mate = l.match(/score mate (-?\d+)/);
    const n = +(l.match(/multipv (\d+)/) || [0, 1])[1];
    const ev = mate ? `M${mate[1]}` : cp ? (cp[1] / 100).toFixed(2) : null;
    const mv = l.split(' pv ')[1].split(' ')[0];
    if (ev) { info.pvs = info.pvs || []; info.pvs[n - 1] = { move: mv, eval: fmtEval(ev, current) }; if (n === 1) info.eval = ev; }
    const d = l.match(/ depth (\d+)/); if (d && n === 1 && mine) $('dep').textContent = d[1];
  }
  else if (l.startsWith('bestmove')) {
    if (skip) { skip--; return; }           // result of a search we cancelled — ignore
    busy = false;
    if (!current) return;
    const best = l.split(' ')[1], ev = fmtEval(info.eval, current);
    const pvs = (info.pvs || []).filter(Boolean).slice(0, S.lines);
    if (mine) showResult(best, ev, pvs);
    parent.postMessage({ type: 'best', fen: current, best, pvs, eval: ev, mine }, PARENT);
  }
};
// Evaluation from White's point of view (cp and mate)
function fmtEval(e, fen) {
  if (!e) return '—';
  const sign = fen.split(' ')[1] === 'b' ? -1 : 1;
  if (e[0] === 'M') { const n = parseInt(e.slice(1)) * sign; return n < 0 ? 'M-' + -n : 'M' + n; }
  const v = parseFloat(e) * sign;
  return (v > 0 ? '+' : '') + v.toFixed(2);
}
function applyEngine() {
  uci('setoption name UCI_LimitStrength value ' + (S.elo < 3190));
  uci('setoption name UCI_Elo value ' + S.elo);
  uci('setoption name MultiPV value ' + S.lines);
}
uci('uci');

window.addEventListener('message', e => {
  if (e.origin !== PARENT) return;
  const m = e.data || {};
  if (m.type === 'analyse' && engineOk) {
    current = m.fen; mine = m.mine !== false; info = {};
    if (busy) { skip++; uci('stop'); }
    if (mine) { $('best').textContent = t('thinking'); $('best').classList.add('wait'); }
    busy = true;
    uci('position fen ' + current); uci('go depth ' + S.depth);
  }
  else if (m.type === 'hotkey') set({ mode: S.mode === m.mode ? 'off' : m.mode });
  else if (m.type === 'review') renderReview(m.entries || []);
  else if (m.type === 'restored') minState = false;
});

// ---------- Result display ----------
const pretty = m => m && m.length >= 4 ? m.slice(0, 2) + ' → ' + m.slice(2, 4) + (m[4] ? '=' + m[4].toUpperCase() : '') : (m || '—');
const num = e => !e || e === '—' ? null : e[0] === 'M' ? (e.includes('-') ? -20 : 20) : parseFloat(e);
const tone = e => { const v = num(e); return v == null ? '' : v > 0.3 ? 'pos' : v < -0.3 ? 'neg' : ''; };
function said(e) {
  const v = num(e); if (v == null) return t('eval');
  if (e[0] === 'M') return t('mate');
  if (Math.abs(v) < 0.3) return t('equal');
  return t(v > 0 ? (v < 1.5 ? 'wBetter' : 'wWin') : (v > -1.5 ? 'bBetter' : 'bWin'));
}
function meter(e) {
  const v = num(e); const p = v == null ? 50 : 50 + 50 * Math.tanh(v / 4);
  $('meter').style.width = p + '%';
}
let last = null;
function showResult(best, ev, pvs) {
  last = { best, ev, pvs };
  $('heroLbl').textContent = t(S.mode === 'coach' ? 'pieceToMove' : 'bestMove');
  const b = $('best'); b.classList.remove('wait');
  // Check mode hides the answer (you play alone); Coach shows only the piece's square
  b.textContent = S.mode === 'check' ? t('hidden') : S.mode === 'coach' ? best.slice(0, 2) : pretty(best);
  const hideEval = S.mode === 'check';
  $('eval').textContent = hideEval ? '—' : ev; meter(hideEval ? null : ev); $('evalTxt').textContent = hideEval ? t('eval') : said(ev);
  $('lines').innerHTML = pvs.length
    ? pvs.map((v, i) => `<li><span>${i + 1}</span><b>${pretty(v.move)}</b><em class="${tone(v.eval)}">${v.eval}</em></li>`).join('')
    : `<li class="empty">${t('noMoves')}</li>`;
}

// ---------- Review ----------
const wp = x => 50 + 50 * (2 / (1 + Math.exp(-0.368 * x)) - 1);
function grade(r) {
  if (r.move && r.move === r.best.slice(0, 4)) return 'best';
  return r.drop >= 20 ? 'blunder' : r.drop >= 10 ? 'mistake' : r.drop >= 5 ? 'inacc' : 'good';
}
let reviewData = [];
function renderReview(entries) {
  reviewData = entries;
  const n = { blunder: 0, mistake: 0, inacc: 0, best: 0, good: 0 };
  const acc = entries.map(r => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * r.drop) - 3.1669)));
  const rows = entries.map((r, i) => {
    const g = grade(r); n[g]++;
    const label = { best: 'gBest', good: 'gGood', inacc: 'gInacc', mistake: 'gMistake', blunder: 'gBlunder' }[g];
    const alt = g === 'best' || g === 'good' ? '' : `<small>${t('insteadOf')} ${pretty(r.best)}</small>`;
    return `<li class="g-${g}"><span>${i + 1}</span><div><b>${pretty(r.move)}</b>${alt}</div><em>${t(label)}</em></li>`;
  });
  $('review').innerHTML = rows.length ? rows.reverse().join('') : `<li class="empty">${t('noReview')}</li>`;
  const a = acc.length ? acc.reduce((x, y) => x + y, 0) / acc.length : null;
  $('accV').textContent = a == null ? '—' : a.toFixed(1);
  $('ring').style.setProperty('--a', (a ?? 0) + '%');
  $('nBlunder').textContent = n.blunder; $('nMistake').textContent = n.mistake;
  $('nInacc').textContent = n.inacc; $('nBest').textContent = n.best;
}

// ---------- UI ----------
function translate() {
  document.documentElement.lang = S.lang;
  $$('[data-t]').forEach(el => el.textContent = t(el.dataset.t));
  $$('[data-tt]').forEach(el => el.title = t(el.dataset.tt));
  $$('#mode button').forEach((b, i) => b.title = `${t('d' + b.dataset.v[0].toUpperCase() + b.dataset.v.slice(1))} (${i + 1})`);
}
const status = () => {
  const key = { off: 'sOff', highlight: 'sHighlight', coach: 'sCoach', check: 'sCheck', auto: 'sAuto' }[S.mode];
  $('status').textContent = engineOk ? t(key) : t('sLoading');
  $('dot').className = 'dot' + (engineOk ? (S.mode === 'off' ? ' ok' : ' live') : '');
};
let lang = null;
function render() {
  document.body.dataset.theme = S.theme;
  document.body.dataset.mode = S.mode; document.body.dataset.lines = S.lines;
  if (lang !== S.lang) { lang = S.lang; translate(); renderReview(reviewData); }
  $$('#mode button').forEach(b => b.classList.toggle('on', b.dataset.v === S.mode));
  const md = S.mode[0].toUpperCase() + S.mode.slice(1);
  $('modeDesc').textContent = t('d' + md);
  for (const k of ['elo', 'delay', 'depth', 'linesR']) {
    const el = $(k), v = S[k === 'linesR' ? 'lines' : k]; el.value = v;
    el.style.setProperty('--p', ((v - el.min) / (el.max - el.min) * 100) + '%');
  }
  $('eloV').textContent = S.elo >= 3190 ? 'Max' : S.elo;
  $('delayV').textContent = (S.delay / 1000).toFixed(1) + ' s';
  $('depthV').textContent = S.depth;
  $('linesV').textContent = S.lines;
  $('arrows').checked = S.arrows; $('evalbar').checked = S.evalbar; $('jitter').checked = S.jitter;
  $$('.presets button').forEach(b => b.classList.toggle('on', +b.dataset.elo === S.elo));
  $$('#theme button').forEach(b => b.classList.toggle('on', b.dataset.v === S.theme));
  $$('#lang button').forEach(b => b.classList.toggle('on', b.dataset.v === S.lang));
  if (last) showResult(last.best, last.ev, last.pvs); else $('heroLbl').textContent = t(S.mode === 'coach' ? 'pieceToMove' : 'bestMove');
  status();
}
function push() { parent.postMessage({ type: 'settings', settings: S }, PARENT); }
function set(patch) {
  S = { ...S, ...patch }; render(); chrome.storage.local.set({ ede: S });
  if (('elo' in patch || 'lines' in patch) && engineOk) applyEngine();
  push();
}
$$('#mode button').forEach(b => b.onclick = () => set({ mode: b.dataset.v }));
for (const k of ['elo', 'delay', 'depth', 'linesR']) $(k).oninput = e => set({ [k === 'linesR' ? 'lines' : k]: +e.target.value });
for (const k of ['jitter', 'arrows', 'evalbar']) $(k).onchange = e => set({ [k]: e.target.checked });
$$('.presets button').forEach(b => b.onclick = () => set({ elo: +b.dataset.elo }));
$$('#theme button').forEach(b => b.onclick = () => set({ theme: b.dataset.v }));
$$('#lang button').forEach(b => b.onclick = () => set({ lang: b.dataset.v }));
$$('.tabs button').forEach(tb => tb.onclick = () => {
  $$('.tabs button').forEach(x => x.classList.toggle('on', x === tb));
  $$('.view').forEach(v => v.classList.toggle('on', v.dataset.view === tb.dataset.tab));
});
document.addEventListener('keydown', e => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const m = MODES[+e.key - 1]; if (m) set({ mode: m });
});
$('reset').onclick = () => set({ ...DEF, theme: S.theme, lang: S.lang });
$('ver').textContent = chrome.runtime.getManifest().version;

let minState = false;
$('min').onclick = () => { minState = !minState; parent.postMessage({ type: 'minimize', min: minState }, PARENT); };
let drag = null;
$('drag').onpointerdown = e => { if (e.target.closest('#min')) return; drag = { x: e.screenX, y: e.screenY }; $('drag').setPointerCapture(e.pointerId); };
$('drag').onpointermove = e => {
  if (!drag) return;
  parent.postMessage({ type: 'drag', dx: e.screenX - drag.x, dy: e.screenY - drag.y }, PARENT);
  drag = { x: e.screenX, y: e.screenY };
};
$('drag').onpointerup = () => drag = null;

chrome.storage.local.get('ede', r => {
  S = { ...DEF, ...(r.ede || {}) };
  if (!r.ede?.lang && navigator.language.startsWith('fr')) S.lang = 'fr';
  if (!MODES.includes(S.mode)) S.mode = 'off';
  render(); push();
});
