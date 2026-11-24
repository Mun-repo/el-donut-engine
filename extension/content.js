// El Donut Engine — content script
// Reads the chess.com board, sends the position to the engine (menu iframe),
// highlights the best move or plays it automatically.
// Deliberately limited to games vs the computer (/play/computer).
(() => {
  'use strict';
  const EXT_ORIGIN = new URL(chrome.runtime.getURL('')).origin;
  // Page guard lives in guard.js (loaded first). Fails closed if missing.
  const ALLOWED = typeof self.EDE_ALLOWED === 'function' ? self.EDE_ALLOWED : () => false;

  let frame = null;
  let ready = false;
  let settings = { mode: 'off', delay: 1500, jitter: true, elo: 2000, depth: 14, lines: 1, arrows: true, evalbar: true };
  let bar = null;
  let lastFen = '';
  let pending = null;   // { fen, best }
  let playTimer = null;
  let hl = [];
  // UI state (mini-bar, review, toasts)
  let mini = null, toastEl = null, lastBest = '', lastEv = '';
  let mineInfo = null;   // { fen, ev, best, me } — last analysed position where it was my turn
  let oppFen = '';       // position right after my move, awaiting evaluation
  let playedMove = '';
  let review = [], pieceCount = 0, posTimer = null;

  // ---------- UI ----------
  function mount() {
    if (frame) return;
    frame = document.createElement('iframe');
    frame.id = 'ede-frame';
    frame.src = chrome.runtime.getURL('panel.html');
    frame.allow = '';
    document.documentElement.appendChild(frame);
    chrome.storage.local.get('edePos', r => {
      const p = r.edePos; if (!p || !frame) return;
      frame.style.left = Math.max(0, Math.min(innerWidth - 360, p.left)) + 'px';
      frame.style.top = Math.max(0, Math.min(innerHeight - 60, p.top)) + 'px';
      frame.style.right = 'auto';
    });
  }
  function unmount() {
    clearHL(); clearTimeout(playTimer); bar?.remove(); bar = null;
    frame?.remove(); frame = null; ready = false; lastFen = '';
    mini?.remove(); mini = null; toastEl?.remove(); toastEl = null; mineInfo = null; oppFen = ''; review = [];
  }
  const send = msg => frame?.contentWindow?.postMessage(msg, EXT_ORIGIN);

  window.addEventListener('message', e => {
    if (e.origin !== EXT_ORIGIN || !frame || e.source !== frame.contentWindow) return;
    const m = e.data || {};
    if (m.type === 'ready') { ready = true; lastFen = ''; }
    else if (m.type === 'settings') {
      settings = { ...settings, ...m.settings };
      lastFen = ''; clearHL(); clearTimeout(playTimer); updMini();
      if (settings.mode === 'check' || settings.mode === 'off') { bar?.remove(); bar = null; }
    }
    else if (m.type === 'best') onBest(m);
    else if (m.type === 'drag') {
      const r = frame.getBoundingClientRect();
      frame.style.left = Math.max(0, Math.min(innerWidth - r.width, r.left + m.dx)) + 'px';
      frame.style.top = Math.max(0, Math.min(innerHeight - 40, r.top + m.dy)) + 'px';
      frame.style.right = 'auto';
      clearTimeout(posTimer);
      posTimer = setTimeout(() => chrome.storage.local.set({ edePos: { left: parseFloat(frame.style.left), top: parseFloat(frame.style.top) } }), 300);
    }
    else if (m.type === 'minimize') setMin(m.min);
  });

  chrome.runtime.onMessage.addListener(m => {
    if (m.type === 'ede:toggle' && frame) frame.classList.toggle('ede-hidden');
  });

  // ---------- Board reading ----------
  const board = () => document.querySelector('wc-chess-board, chess-board');
  const sqClass = el => (el.className.match(/square-(\d)(\d)/) || []).slice(1).map(Number);

  function readPosition() {
    const b = board();
    if (!b) return null;
    const grid = Array.from({ length: 8 }, () => Array(8).fill(null)); // grid[rank-1][file-1]
    b.querySelectorAll('.piece').forEach(p => {
      const code = (p.className.match(/\b([wb][pnbrqk])\b/) || [])[1];
      const [f, r] = sqClass(p);
      if (code && f && r) grid[r - 1][f - 1] = code;
    });

    // Side to move: the piece on a "highlight" square just moved
    let turn = 'w', ep = '-';
    const hls = [...b.querySelectorAll('.highlight')].map(sqClass).filter(a => a.length);
    for (const [f, r] of hls) {
      const pc = grid[r - 1][f - 1];
      if (!pc) continue;
      turn = pc[0] === 'w' ? 'b' : 'w';
      // en passant possible after a 2-square pawn push
      const other = hls.find(([f2, r2]) => f2 === f && Math.abs(r2 - r) === 2);
      if (pc[1] === 'p' && other) ep = 'abcdefgh'[f - 1] + ((r + other[1]) / 2);
      break;
    }

    // Castling: approximated from king/rook positions
    const at = (f, r) => grid[r - 1][f - 1];
    let c = '';
    if (at(5, 1) === 'wk') { if (at(8, 1) === 'wr') c += 'K'; if (at(1, 1) === 'wr') c += 'Q'; }
    if (at(5, 8) === 'bk') { if (at(8, 8) === 'br') c += 'k'; if (at(1, 8) === 'br') c += 'q'; }

    const rows = [];
    for (let r = 8; r >= 1; r--) {
      let row = '', empty = 0;
      for (let f = 1; f <= 8; f++) {
        const pc = at(f, r);
        if (!pc) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += pc[0] === 'w' ? pc[1].toUpperCase() : pc[1];
      }
      rows.push(row + (empty || ''));
    }
    const me = b.classList.contains('flipped') ? 'b' : 'w';
    return { fen: `${rows.join('/')} ${turn} ${c || '-'} ${ep} 0 1`, turn, me, b };
  }

  // ---------- Moves ----------
  function sqRect(b, f, r) {
    const R = b.getBoundingClientRect(), s = R.width / 8;
    const flipped = b.classList.contains('flipped');
    const x = flipped ? (8 - f) * s : (f - 1) * s;
    const y = flipped ? (r - 1) * s : (8 - r) * s;
    return { x, y, s, cx: R.left + x + s / 2, cy: R.top + y + s / 2 };
  }
  const parseUci = u => ({
    from: [u.charCodeAt(0) - 96, +u[1]], to: [u.charCodeAt(2) - 96, +u[3]], promo: u[4] || null
  });

  function clearHL() { hl.forEach(e => e.remove()); hl = []; }
  function highlight(b, uci) {
    clearHL();
    const { from, to } = parseUci(uci);
    [[from, 'ede-from'], [to, 'ede-to']].forEach(([[f, r], cls]) => {
      const { x, y, s } = sqRect(b, f, r);
      const d = document.createElement('div');
      d.className = `ede-hl ${cls}`;
      Object.assign(d.style, { left: x + 'px', top: y + 'px', width: s + 'px', height: s + 'px' });
      b.appendChild(d); hl.push(d);
    });
  }

  const COLORS = ['#d9a3b8', '#b8a3d9', '#a3c4d9'];
  function arrows(b, pvs) {
    const R = b.getBoundingClientRect(), s = R.width / 8;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ede-hl ede-arrows');
    svg.setAttribute('viewBox', `0 0 ${R.width} ${R.width}`);
    Object.assign(svg.style, { left: 0, top: 0, width: R.width + 'px', height: R.width + 'px' });
    pvs.slice().reverse().forEach((v, ri) => {
      const i = pvs.length - 1 - ri, { from, to } = parseUci(v.move);
      const a = sqRect(b, ...from), z = sqRect(b, ...to);
      const x1 = a.x + s / 2, y1 = a.y + s / 2, x2 = z.x + s / 2, y2 = z.y + s / 2;
      const ang = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1) - s * 0.3;
      const w = s * (i ? 0.13 : 0.18), hw = w * 2.2, hl = w * 2.4;
      const g = document.createElementNS(svg.namespaceURI, 'path');
      g.setAttribute('d', `M0 ${-w / 2} L${len - hl} ${-w / 2} L${len - hl} ${-hw / 2} L${len} 0 L${len - hl} ${hw / 2} L${len - hl} ${w / 2} L0 ${w / 2} Z`);
      g.setAttribute('transform', `translate(${x1} ${y1}) rotate(${ang * 180 / Math.PI})`);
      g.setAttribute('fill', COLORS[i]); g.setAttribute('opacity', i ? '.55' : '.85');
      
      svg.appendChild(g);
    });
    b.appendChild(svg); hl.push(svg);
  }
  function evalBar(b, ev) {
    if (!settings.evalbar) { bar?.remove(); bar = null; return; }
    if (!bar || !bar.isConnected) {
      bar = document.createElement('div'); bar.className = 'ede-bar';
      bar.innerHTML = '<div class="ede-fill"></div><span></span>';
      b.parentElement.appendChild(bar);
    }
    const R = b.getBoundingClientRect(), P = b.parentElement.getBoundingClientRect();
    Object.assign(bar.style, { left: (R.left - P.left - 18) + 'px', top: (R.top - P.top) + 'px', height: R.height + 'px' });
    let pct = 50;
    if (ev?.startsWith('M')) pct = ev.includes('-') ? 0 : 100;
    else if (ev && ev !== '—') pct = 50 + 50 * (2 / (1 + Math.exp(-0.4 * parseFloat(ev))) - 1);
    if (b.classList.contains('flipped')) pct = 100 - pct;
    bar.firstChild.style.height = pct + '%';
    bar.classList.toggle('ede-flip', b.classList.contains('flipped'));
    bar.lastChild.textContent = ev || '';
  }

  function tap(b, x, y) {
    const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    const t = document.elementFromPoint(x, y) || b;
    t.dispatchEvent(new PointerEvent('pointerdown', { ...o, buttons: 1 }));
    t.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons: 1 }));
    t.dispatchEvent(new PointerEvent('pointerup', o));
    t.dispatchEvent(new MouseEvent('mouseup', o));
    t.dispatchEvent(new MouseEvent('click', o));
  }
  function playMove(b, uci) {
    const { from, to, promo } = parseUci(uci);
    clearHL();
    const a = sqRect(b, ...from), z = sqRect(b, ...to);
    tap(b, a.cx, a.cy);
    setTimeout(() => {
      tap(b, z.cx, z.cy);
      if (promo) setTimeout(() => {
        const color = b.classList.contains('flipped') ? 'b' : 'w';
        document.querySelector(`.promotion-piece.${color}${promo}`)?.click();
      }, 180);
    }, 60);
  }

  function coach(b, uci) {
    clearHL();
    const { from: [f, r] } = parseUci(uci), { x, y, s } = sqRect(b, f, r);
    const d = document.createElement('div');
    d.className = 'ede-hl ede-coach';
    Object.assign(d.style, { left: x + 'px', top: y + 'px', width: s + 'px', height: s + 'px' });
    b.appendChild(d); hl.push(d);
  }

  // ---------- Mini-bar (shown in chess.com's sidebar when the menu is minimised) ----------
  const T = {
    en: { off: 'Off', highlight: 'Hint', coach: 'Coach', check: 'Check', auto: 'Auto', open: 'Open menu', blunder: 'Blunder', mistake: 'Mistake', better: 'better was' },
    fr: { off: 'Off', highlight: 'Indice', coach: 'Coach', check: 'Vérif', auto: 'Auto', open: 'Ouvrir le menu', blunder: 'Gaffe', mistake: 'Erreur', better: 'mieux :' }
  };
  const t = k => (T[settings.lang] || T.en)[k] || k;
  const pretty = u => u && u.length >= 4 ? u.slice(0, 2) + ' → ' + u.slice(2, 4) : '—';
  function setMin(on) {
    if (!frame) return;
    frame.classList.toggle('ede-min', on);
    if (on) mountMini(); else { mini?.remove(); mini = null; }
  }
  function mountMini() {
    if (mini?.isConnected) return updMini();
    mini = document.createElement('div'); mini.id = 'ede-mini';
    for (const c of ['ede-m-logo', 'ede-m-mode', 'ede-m-best', 'ede-m-eval']) {
      const e = document.createElement('span'); e.className = c; mini.appendChild(e);
    }
    mini.firstChild.textContent = '🍩';
    const btn = document.createElement('button'); btn.className = 'ede-m-open'; btn.textContent = '⤢';
    btn.onclick = () => { setMin(false); send({ type: 'restored' }); };
    mini.appendChild(btn);
    const host = document.querySelector('#board-layout-sidebar, .board-layout-sidebar');
    if (host) host.prepend(mini); else { mini.classList.add('ede-float'); document.body.appendChild(mini); }
    updMini();
  }
  function updMini() {
    if (!mini) return;
    mini.dataset.mode = settings.mode;
    mini.querySelector('.ede-m-mode').textContent = t(settings.mode);
    const hide = settings.mode === 'off' || settings.mode === 'check';
    mini.querySelector('.ede-m-best').textContent = hide ? '' : (settings.mode === 'coach' ? (lastBest ? lastBest.slice(0, 2) : '—') : pretty(lastBest));
    mini.querySelector('.ede-m-eval').textContent = hide ? '' : (lastEv || '');
    mini.querySelector('.ede-m-open').title = t('open');
  }

  // ---------- Review / blunder check ----------
  const num = e => !e || e === '—' ? null : e[0] === 'M' ? (e.includes('-') ? -20 : 20) : parseFloat(e);
  const wp = x => 50 + 50 * (2 / (1 + Math.exp(-0.368 * x)) - 1);
  function toast(b, title, sub, kind) {
    toastEl?.remove();
    toastEl = document.createElement('div'); toastEl.className = 'ede-toast ede-' + kind;
    const h = document.createElement('b'); h.textContent = title;
    const p = document.createElement('span'); p.textContent = sub;
    toastEl.append(h, p);
    const R = b.getBoundingClientRect(), P = b.parentElement.getBoundingClientRect();
    Object.assign(toastEl.style, { left: (R.left - P.left + R.width / 2) + 'px', top: (R.top - P.top + 14) + 'px' });
    b.parentElement.appendChild(toastEl);
    const el = toastEl;
    setTimeout(() => el.classList.add('ede-out'), 3800);
    setTimeout(() => el.remove(), 4300);
  }
  function onReply({ fen, eval: ev }) {
    if (fen !== oppFen || !mineInfo) return;
    const before = num(mineInfo.ev), after = num(ev);
    if (before == null || after == null) return;
    const sign = mineInfo.me === 'w' ? 1 : -1;
    const drop = Math.max(0, wp(before * sign) - wp(after * sign));
    review.push({ move: playedMove, best: mineInfo.best, before: mineInfo.ev, after: ev, drop: +drop.toFixed(1) });
    send({ type: 'review', entries: review });
    if (settings.mode === 'check' && drop >= 10) {
      const b = board();
      if (b) toast(b, (drop >= 20 ? t('blunder') : t('mistake')) + '  ' + ev, t('better') + ' ' + pretty(mineInfo.best), drop >= 20 ? 'bad' : 'warn');
    }
    mineInfo = null;
  }

  function show(b, best, pvs) {
    highlight(b, best);
    if (settings.arrows && pvs?.length) arrows(b, pvs);
  }
  function onBest(m) {
    if (m.mine === false) return onReply(m);
    const { fen, best, pvs, eval: ev } = m;
    if (fen !== lastFen || !best || best === '(none)') return;
    const b = board(); if (!b) return;
    const me = b.classList.contains('flipped') ? 'b' : 'w';
    mineInfo = { fen, ev, best, me };
    lastBest = best; lastEv = ev; updMini();
    if (settings.mode !== 'check') evalBar(b, ev);
    if (settings.mode === 'highlight') show(b, best, pvs);
    else if (settings.mode === 'coach') coach(b, best);
    else if (settings.mode === 'auto') {
      show(b, best, pvs);
      const jitter = settings.jitter ? (Math.random() * 0.6 - 0.3) * settings.delay : 0;
      clearTimeout(playTimer);
      playTimer = setTimeout(() => {
        const now = readPosition();
        if (now && now.fen === fen) playMove(b, best);
      }, Math.max(0, settings.delay + jitter));
    }
  }

  const readPiece = (b, f, r) => b.querySelector(`.piece.square-${f}${r}`);

  // ---------- Loop ----------
  function tick() {
    if (!ALLOWED(location.pathname)) { if (frame) unmount(); return; }
    mount();
    if (!ready || settings.mode === 'off') { clearHL(); return; }
    const pos = readPosition();
    if (!pos) return;
    const count = (pos.fen.split(' ')[0].match(/[a-z]/gi) || []).length;
    if (count > pieceCount) { review = []; mineInfo = null; send({ type: 'review', entries: review }); }  // new game
    pieceCount = count;
    if (pos.turn !== pos.me) {
      if (pos.fen !== lastFen) {
        clearHL(); clearTimeout(playTimer); lastFen = pos.fen;
        // Evaluate the position after my move (for review / blunder check)
        if (mineInfo && settings.mode !== 'auto') {
          const sq = [...pos.b.querySelectorAll('.highlight')].map(sqClass).filter(a => a.length);
          const to = sq.find(([f, r]) => pos.fen && readPiece(pos.b, f, r)), from = sq.find(x => x !== to);
          playedMove = from && to ? 'abcdefgh'[from[0] - 1] + from[1] + 'abcdefgh'[to[0] - 1] + to[1] : '';
          oppFen = pos.fen;
          send({ type: 'analyse', fen: pos.fen, mine: false });
        }
      }
      return;
    }
    if (pos.fen === lastFen) return;
    lastFen = pos.fen;
    clearHL(); clearTimeout(playTimer);
    send({ type: 'analyse', fen: pos.fen, mine: true });
  }
  setInterval(tick, 250);

  // Hotkeys: Alt+H highlight, Alt+A auto, Alt+D show/hide
  document.addEventListener('keydown', e => {
    if (!frame || !e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'd') frame.classList.toggle('ede-hidden');
    else if (k === 'h' || k === 'a' || k === 'c' || k === 'v') send({ type: 'hotkey', mode: { h: 'highlight', a: 'auto', c: 'coach', v: 'check' }[k] });
    else return;
    e.preventDefault();
  }, true);
})();
