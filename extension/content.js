// El Donut Engine — content script
// Lit l'échiquier chess.com, envoie la position au moteur (iframe du menu),
// surligne le meilleur coup ou le joue automatiquement.
// Volontairement limité aux parties contre l'ordinateur (/play/computer).
(() => {
  'use strict';
  const EXT_ORIGIN = new URL(chrome.runtime.getURL('')).origin;
  const ALLOWED = p => p.startsWith('/play/computer');

  let frame = null;
  let ready = false;
  let settings = { mode: 'off', delay: 1500, jitter: true, elo: 2000, depth: 14 };
  let lastFen = '';
  let pending = null;   // { fen, best }
  let playTimer = null;
  let hl = [];

  // ---------- UI ----------
  function mount() {
    if (frame) return;
    frame = document.createElement('iframe');
    frame.id = 'ede-frame';
    frame.src = chrome.runtime.getURL('panel.html');
    frame.allow = '';
    document.documentElement.appendChild(frame);
  }
  function unmount() {
    clearHL(); clearTimeout(playTimer);
    frame?.remove(); frame = null; ready = false; lastFen = '';
  }
  const send = msg => frame?.contentWindow?.postMessage(msg, EXT_ORIGIN);

  window.addEventListener('message', e => {
    if (e.origin !== EXT_ORIGIN || !frame || e.source !== frame.contentWindow) return;
    const m = e.data || {};
    if (m.type === 'ready') { ready = true; lastFen = ''; }
    else if (m.type === 'settings') {
      settings = { ...settings, ...m.settings };
      lastFen = ''; clearHL(); clearTimeout(playTimer);
    }
    else if (m.type === 'best') onBest(m);
    else if (m.type === 'drag') {
      const r = frame.getBoundingClientRect();
      frame.style.left = Math.max(0, Math.min(innerWidth - r.width, r.left + m.dx)) + 'px';
      frame.style.top = Math.max(0, Math.min(innerHeight - 40, r.top + m.dy)) + 'px';
      frame.style.right = 'auto';
    }
    else if (m.type === 'minimize') frame.style.height = m.min ? '64px' : '470px';
  });

  chrome.runtime.onMessage.addListener(m => {
    if (m.type === 'ede:toggle' && frame) frame.classList.toggle('ede-hidden');
  });

  // ---------- Lecture du plateau ----------
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

    // Trait : la pièce posée sur une case "highlight" vient de jouer
    let turn = 'w', ep = '-';
    const hls = [...b.querySelectorAll('.highlight')].map(sqClass).filter(a => a.length);
    for (const [f, r] of hls) {
      const pc = grid[r - 1][f - 1];
      if (!pc) continue;
      turn = pc[0] === 'w' ? 'b' : 'w';
      // prise en passant possible après une avancée de 2 cases
      const other = hls.find(([f2, r2]) => f2 === f && Math.abs(r2 - r) === 2);
      if (pc[1] === 'p' && other) ep = 'abcdefgh'[f - 1] + ((r + other[1]) / 2);
      break;
    }

    // Roques : approximation par position du roi et des tours
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

  // ---------- Coups ----------
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

  function onBest({ fen, best }) {
    if (fen !== lastFen || !best || best === '(none)') return;
    const b = board(); if (!b) return;
    if (settings.mode === 'highlight') highlight(b, best);
    else if (settings.mode === 'auto') {
      highlight(b, best);
      const jitter = settings.jitter ? (Math.random() * 0.6 - 0.3) * settings.delay : 0;
      clearTimeout(playTimer);
      playTimer = setTimeout(() => {
        const now = readPosition();
        if (now && now.fen === fen) playMove(b, best);
      }, Math.max(0, settings.delay + jitter));
    }
  }

  // ---------- Boucle ----------
  function tick() {
    if (!ALLOWED(location.pathname)) { if (frame) unmount(); return; }
    mount();
    if (!ready || settings.mode === 'off') { clearHL(); return; }
    const pos = readPosition();
    if (!pos) return;
    if (pos.turn !== pos.me) { if (pos.fen !== lastFen) { clearHL(); clearTimeout(playTimer); lastFen = pos.fen; } return; }
    if (pos.fen === lastFen) return;
    lastFen = pos.fen;
    clearHL(); clearTimeout(playTimer);
    send({ type: 'analyse', fen: pos.fen });
  }
  setInterval(tick, 250);
})();
