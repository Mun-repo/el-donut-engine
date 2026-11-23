// El Donut Engine — menu + moteur Stockfish (tourne dans l'iframe de l'extension)
const PARENT = 'https://www.chess.com';
const $ = id => document.getElementById(id);
const DEF = { mode: 'off', delay: 1500, jitter: true, elo: 2000, depth: 14 };
let S = { ...DEF }, engineOk = false, current = null, info = {};

const engine = new Worker('engine/stockfish.js');
const uci = c => engine.postMessage(c);
engine.onmessage = ({ data: l }) => {
  if (typeof l !== 'string') return;
  if (l === 'uciok') { applyEngine(); uci('isready'); }
  else if (l === 'readyok' && !engineOk) {
    engineOk = true; status(); parent.postMessage({ type: 'ready' }, PARENT); push();
  }
  else if (l.startsWith('info') && l.includes(' pv ')) {
    const cp = l.match(/score cp (-?\d+)/), mate = l.match(/score mate (-?\d+)/);
    info.eval = mate ? `M${mate[1]}` : cp ? (cp[1] / 100).toFixed(2) : info.eval;
  }
  else if (l.startsWith('bestmove') && current) {
    const best = l.split(' ')[1];
    $('best').textContent = best; $('eval').textContent = fmtEval(info.eval, current);
    parent.postMessage({ type: 'best', fen: current, best }, PARENT);
  }
};
function fmtEval(e, fen) {
  if (!e) return '—';
  if (e[0] === 'M') return e;
  const v = parseFloat(e) * (fen.split(' ')[1] === 'b' ? -1 : 1); // point de vue des blancs
  return (v > 0 ? '+' : '') + v.toFixed(2);
}
function applyEngine() {
  uci('setoption name UCI_LimitStrength value ' + (S.elo < 3190));
  uci('setoption name UCI_Elo value ' + S.elo);
}
uci('uci');

window.addEventListener('message', e => {
  if (e.origin !== PARENT) return;
  if (e.data?.type === 'analyse' && engineOk) {
    current = e.data.fen; info = {};
    $('best').textContent = '…';
    uci('stop'); uci('position fen ' + current); uci('go depth ' + S.depth);
  }
});

// ---------- UI ----------
const status = () => $('status').textContent = engineOk
  ? ({ off: 'En pause', highlight: 'Surlignage actif', auto: 'Jeu automatique' })[S.mode]
  : 'Chargement du moteur…';
function render() {
  document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', b.dataset.v === S.mode));
  for (const k of ['elo', 'delay', 'depth']) {
    const el = $(k); el.value = S[k];
    el.style.setProperty('--p', ((S[k] - el.min) / (el.max - el.min) * 100) + '%');
  }
  $('eloV').textContent = S.elo >= 3190 ? 'Max' : S.elo;
  $('delayV').textContent = (S.delay / 1000).toFixed(1) + ' s';
  $('depthV').textContent = S.depth;
  $('jitter').checked = S.jitter;
  status();
}
function push() { parent.postMessage({ type: 'settings', settings: S }, PARENT); }
function set(patch) {
  S = { ...S, ...patch }; render(); chrome.storage.local.set({ ede: S });
  if ('elo' in patch && engineOk) applyEngine();
  push();
}
document.querySelectorAll('#mode button').forEach(b => b.onclick = () => set({ mode: b.dataset.v }));
for (const k of ['elo', 'delay', 'depth']) $(k).oninput = e => set({ [k]: +e.target.value });
$('jitter').onchange = e => set({ jitter: e.target.checked });

let min = false;
$('min').onclick = () => { min = !min; $('min').textContent = min ? '+' : '–'; parent.postMessage({ type: 'minimize', min }, PARENT); };
let drag = null;
$('drag').onpointerdown = e => { if (e.target.id === 'min') return; drag = { x: e.screenX, y: e.screenY }; $('drag').setPointerCapture(e.pointerId); };
$('drag').onpointermove = e => {
  if (!drag) return;
  parent.postMessage({ type: 'drag', dx: e.screenX - drag.x, dy: e.screenY - drag.y }, PARENT);
  drag = { x: e.screenX, y: e.screenY };
};
$('drag').onpointerup = () => drag = null;

chrome.storage.local.get('ede', r => { S = { ...DEF, ...(r.ede || {}) }; render(); push(); });
