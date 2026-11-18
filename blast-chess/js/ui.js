import { FILES } from "./chess.js";

const ICON = {
  K: '♚',
  Q: '♛',
  R: '♜',
  B: '♝',
  N: '♞',
  P: '♟',
  M: '✦'
};

const $ = selector => document.querySelector(selector);

export function createUI(state, chess, onMove, onBoardActivity = () => {}) {
  // ===== Board and move-history rendering =====
  function render() {
    const el = $('#board');
    const ov = $('#blastOverlay');

    el.innerHTML = '';

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        let b = document.createElement('button');
        let p = state.board[r][c];

        b.className = 'sq ' + ((r + c) % 2 ? 'dark' : 'light');

        if (
          state.lastMove &&
          ((state.lastMove.from[0] === r && state.lastMove.from[1] === c) ||
            (state.lastMove.to[0] === r && state.lastMove.to[1] === c))
        ) {
          b.classList.add('last');
        }

        if (state.selected && state.selected[0] === r && state.selected[1] === c) {
          b.classList.add('selected');
        }

        if (state.legal.some(([rr, cc]) => rr === r && cc === c)) {
          b.classList.add(p ? 'capture' : 'legal');
        }

        b.setAttribute('role', 'gridcell');
        b.setAttribute(
          'aria-label',
          (p ? (p.s === 'w' ? 'White ' : 'Black ') + pieceName(p.c) : 'Empty') +
            ' ' +
            chess.sqName(r, c)
        );

        if (p) {
          let span = document.createElement('span');
          span.className = 'piece ' + (p.s === 'w' ? 'white' : 'black');
          span.textContent = ICON[p.c];
          b.appendChild(span);
        }

        if (c === 0 || r === 7) {
          let co = document.createElement('span');
          co.className = 'coord';
          co.textContent = c === 0 ? 8 - r : FILES[c];
          b.appendChild(co);
        }

        b.onclick = () => click(r, c);
        el.appendChild(b);
      }
    }

    el.appendChild(ov);

    $('#turnText').textContent = state.gameOver ? 'Game over' : state.turn === 'w' ? 'White' : 'Black';
    $('#turnDot').className = 'dot ' + (state.turn === 'w' ? 'white' : '');
    $('#turncount').textContent = 'Move ' + state.moveNum;

    const moveLog = $('#moves');
    moveLog.innerHTML = '';

    if (!state.history.length) {
      moveLog.innerHTML = '<span class="sub">Moves will appear here.</span>';
    } else {
      // Each completed turn is stored as two plies; pair them into one row.
      for (let ply = 0; ply < state.history.length; ply += 2) {
        const whiteMove = state.history[ply]?.white || '';
        const blackMove = state.history[ply + 1]?.black || '';
        const moveNumber = document.createElement('span');
        const whiteCell = document.createElement('span');
        const blackCell = document.createElement('span');

        moveNumber.textContent = (Math.floor(ply / 2) + 1) + '.';
        whiteCell.textContent = whiteMove;
        blackCell.textContent = blackMove;
        moveLog.append(moveNumber, whiteCell, blackCell);
      }

      // Keep the most recent move visible while retaining scrollback for review.
      moveLog.scrollTop = moveLog.scrollHeight;
    }
  }

  function pieceName(c) {
    return ({
      K: 'king',
      Q: 'queen',
      R: 'rook',
      B: 'bishop',
      N: 'knight',
      P: 'pawn',
      M: 'mimic'
    })[c];
  }

  function renderClocks(remaining, activeSide) {
    const clocks = [
      { side: 'w', container: $('#whiteClock'), display: $('#whiteTime') },
      { side: 'b', container: $('#blackClock'), display: $('#blackTime') }
    ];

    for (const clock of clocks) {
      const seconds = Math.ceil(Math.max(0, remaining[clock.side]) / 1000);
      const minutes = Math.floor(seconds / 60);
      const remainder = seconds % 60;

      clock.display.textContent =
        String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0');
      clock.container.classList.toggle('active', activeSide === clock.side);
      clock.container.classList.toggle('low', remaining[clock.side] <= 10000);
    }
  }

  // ===== Selection, legal moves, and promotions =====
  function click(r, c) {
    if (state.gameOver || state.botThinking) return;
    if (state.gameMode === 'online' && state.turn !== state.mySide) return;
    if (['easy', 'intermediate', 'hard', 'grandmaster'].includes(state.gameMode) && state.turn === state.botSide) return;

    onBoardActivity();

    let p = state.board[r][c];

    if (state.selected && state.legal.some(([rr, cc]) => rr === r && cc === c)) {
      makeMove(state.selected, [r, c]);
      return;
    }

    if (p && p.s === state.turn) {
      state.selected = [r, c];
      state.legal = chess.getLegal(r, c);
    } else {
      state.selected = null;
      state.legal = [];
    }

    render();
  }

  function makeMove(from, to) {
    let p = state.board[from[0]][from[1]];
    let capt = state.board[to[0]][to[1]];
    let note =
      (p.c === 'P' ? '' : p.c) +
      chess.sqName(...from) +
      (capt ? 'x' : '–') +
      chess.sqName(...to);

    state.selected = null;
    state.legal = [];

    if (p.c === 'P' && (to[0] === 0 || to[0] === 7)) {
      let opts = ['Q', 'R', 'B', 'N'];
      let prom = $('#promotion');
      let container = $('#promopts');

      container.innerHTML = '';

      opts.forEach(code => {
        let btn = document.createElement('button');
        btn.textContent = ICON[code];
        btn.style.color = p.s === 'w' ? '#faf7ed' : '#26342d';
        btn.onclick = () => {
          prom.classList.remove('show');
          onMove(from, to, code, note);
        };
        container.append(btn);
      });

      prom.classList.add('show');
      return;
    }

    onMove(from, to, 'Q', note);
  }

  // ===== Status, explosion animation, and room labels =====
  function say(t, boom = false) {
    let e = $('#status');
    e.textContent = t;
    e.className = 'status' + (boom ? ' boom' : '');
  }

  function showExplosion() {
    const overlay = $('#blastOverlay');
    overlay.classList.add('show');
    setTimeout(() => overlay.classList.remove('show'), 450);
  }

  function showWinner(winner, reason) {
    $('#winTitle').textContent = winner + ' Wins!';
    $('#winReason').textContent = reason;
    setRematchState('idle');
    $('#winScreen').classList.add('show');
    $('#winScreen').setAttribute('aria-hidden', 'false');
  }

  function setRematchState(status) {
    const button = $('#playAgain');
    const reason = $('#winReason');

    button.disabled = status === 'requested';

    if (status === 'requested') {
      button.textContent = 'Waiting for opponent…';
      reason.textContent = 'Waiting for the other player to respond';
    } else if (status === 'incoming') {
      button.textContent = 'Accept rematch';
      reason.textContent = 'Your opponent wants to play again';
    } else {
      button.textContent = state.gameMode === 'online' ? 'Request rematch' : 'Play again';
    }
  }

  function hideWinner() {
    $('#winScreen').classList.remove('show');
    $('#winScreen').setAttribute('aria-hidden', 'true');
  }

  function setRoomStatus(text) {
    $('#roomStatus').textContent = text;
  }

  function setRoomCode(text) {
    $('#roomCode').textContent = text;
  }

  function setJoinCode(text) {
    $('#joinCode').value = text;
  }

  function getJoinCode() {
    return $('#joinCode').value;
  }

  function getTimeControl() {
    return $('#timeControl').value;
  }

  function setTimeControl(value) {
    if (['1', '3', '5', '10'].includes(String(value))) {
      $('#timeControl').value = String(value);
    }
  }

  return {
    render,
    renderClocks,
    say,
    showExplosion,
    showWinner,
    hideWinner,
    setRematchState,
    setRoomStatus,
    setRoomCode,
    setJoinCode,
    getJoinCode,
    getTimeControl,
    setTimeControl
  };
}
