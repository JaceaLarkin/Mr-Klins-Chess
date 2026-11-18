const VAL = {
  P: 100,
  N: 320,
  B: 330,
  R: 500,
  Q: 900,
  K: 20000,
  M: 300
};

export function createAI(state, chess) {
  // ===== Search-state snapshots and move generation =====
  function snapshot() {
    return {
      board: chess.clone(state.board),
      turn: state.turn,
      ep: state.ep ? { ...state.ep } : null,
      castle: { ...state.castle }
    };
  }

  function restore(s) {
    state.board = chess.clone(s.board);
    state.turn = s.turn;
    state.ep = s.ep ? { ...s.ep } : null;
    state.castle = { ...s.castle };
  }

  function allMoves(side) {
    let prev = state.turn;
    state.turn = side;

    let out = [];

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (state.board[r][c]?.s === side) {
          for (const [rr, cc] of chess.getLegal(r, c)) {
            out.push({
              from: [r, c],
              to: [rr, cc]
            });
          }
        }
      }
    }

    state.turn = prev;
    return out;
  }

  // ===== Board evaluation and terminal positions =====
  function evaluate(side) {
    let score = 0;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        let p = state.board[r][c];
        if (!p) continue;

        let v = VAL[p.c] || 0;
        let center = 7 - (Math.abs(3.5 - r) + Math.abs(3.5 - c));

        if (p.c !== 'K') v += center * 3;
        if (p.c === 'P') v += (p.s === 'w' ? (6 - r) : (r - 1)) * 2;

        score += (p.s === side ? v : -v);
      }
    }

    let own = chess.kingPos(state.board, side);
    let enemy = chess.kingPos(state.board, side === 'w' ? 'b' : 'w');

    if (own && chess.inCheck(state.board, side)) score -= 45;
    if (enemy && chess.inCheck(state.board, side === 'w' ? 'b' : 'w')) score += 45;

    return score;
  }

  function terminalScore() {
    let mine = chess.kingPos(state.board, state.botSide);
    let theirs = chess.kingPos(state.board, state.botSide === 'w' ? 'b' : 'w');

    if (!mine) return -100000;
    if (!theirs) return 100000;

    return null;
  }

  // Mimic moves can also award an instant win on 1 in 50 normal blasts.
  function expectedMoveScore(safeScore, blastScore, movingPiece) {
    if (movingPiece.c !== 'M') return safeScore;

    const rareOutcomeScore = movingPiece.s === state.botSide ? 100000 : -100000;
    return safeScore * 0.8 + blastScore * 0.2 * 0.98 + rareOutcomeScore * 0.2 * 0.02;
  }

  // ===== Minimax search with alpha-beta pruning =====
  function simulate(m, boom) {
    let [r, c] = m.from;
    let [rr, cc] = m.to;
    let movedPiece = state.board[r][c];

    chess.apply(state.board, [r, c], [rr, cc], 'Q');

    if (boom && movedPiece.c === 'M') {
      for (let y = Math.max(0, rr - 1); y <= Math.min(7, rr + 1); y++) {
        for (let x = Math.max(0, cc - 1); x <= Math.min(7, cc + 1); x++) {
          if (state.board[y][x]?.c !== 'K') {
            state.board[y][x] = null;
          }
        }
      }
    }

    state.turn = state.turn === 'w' ? 'b' : 'w';
  }

  function search(depth, alpha, beta) {
    let term = terminalScore();
    if (term !== null) return term;
    if (depth <= 0) return evaluate(state.botSide);

    let moves = allMoves(state.turn);
    if (!moves.length) return evaluate(state.botSide);

    let maximizing = state.turn === state.botSide;
    let best = maximizing ? -Infinity : Infinity;

    for (const m of moves) {
      let base = snapshot();
      const movingPiece = state.board[m.from[0]][m.from[1]];

      simulate(m, false);
      let safe = search(depth - 1, alpha, beta);
      restore(base);

      simulate(m, true);
      let blown = terminalScore();

      if (blown === null) {
        blown = depth <= 1 ? evaluate(state.botSide) : search(depth - 1, alpha, beta);
      }

      restore(base);

      let v = expectedMoveScore(safe, blown, movingPiece);

      if (maximizing) {
        best = Math.max(best, v);
        alpha = Math.max(alpha, best);
      } else {
        best = Math.min(best, v);
        beta = Math.min(beta, best);
      }

      if (beta <= alpha) break;
    }

    return best;
  }

  function moveOrder(m) {
    let p = state.board[m.from[0]][m.from[1]];
    let q = state.board[m.to[0]][m.to[1]];

    return (
      (q ? (VAL[q.c] || 0) * 10 - (VAL[p.c] || 0) : 0) +
      (7 - (Math.abs(3.5 - m.to[0]) + Math.abs(3.5 - m.to[1]))) * 2
    );
  }

  // ===== Difficulty levels and bot move execution =====
  function chooseBotMove(level) {
    let moves = allMoves(state.botSide);
    if (!moves.length) return null;
    if (level === 'easy') return moves[Math.floor(Math.random() * moves.length)];

    let depth = level === 'intermediate' ? 1 : level === 'hard' ? 2 : 3;

    if (level === 'grandmaster') {
      moves.sort((a, b) => moveOrder(b) - moveOrder(a)).splice(18);
    }

    let best = null;
    let bestScore = -Infinity;
    let alpha = -Infinity;

    for (const m of moves) {
      let base = snapshot();
      const movingPiece = state.board[m.from[0]][m.from[1]];

      simulate(m, false);
      let safe = search(depth - 1, alpha, Infinity);
      restore(base);

      simulate(m, true);
      let boom = terminalScore();

      if (boom === null) {
        boom = depth <= 1 ? evaluate(state.botSide) : search(depth - 1, alpha, Infinity);
      }

      restore(base);

      let score =
        expectedMoveScore(safe, boom, movingPiece) +
        (Math.random() - .5) * (level === 'intermediate' ? 28 : level === 'hard' ? 5 : 1);

      if (score > bestScore) {
        bestScore = score;
        best = m;
      }

      alpha = Math.max(alpha, score);
    }

    return best;
  }

  function playBot(onMove, isCurrent = () => true) {
    if (state.gameOver || state.turn !== state.botSide || state.botThinking) return;

    state.botThinking = true;

    setTimeout(() => {
      if (!isCurrent()) {
        state.botThinking = false;
        return;
      }

      let m;

      try {
        m = chooseBotMove(state.gameMode);
      } finally {
        state.botThinking = false;
      }

      if (!m || !isCurrent()) return;

      let p = state.board[m.from[0]][m.from[1]];
      let q = state.board[m.to[0]][m.to[1]];
      let note =
        (p.c === 'P' ? '' : p.c) +
        chess.sqName(...m.from) +
        (q ? 'x' : '–') +
        chess.sqName(...m.to);

      onMove(m.from, m.to, 'Q', note);
    }, 20);
  }

  return {
    chooseBotMove,
    playBot
  };
}
