export const FILES = 'abcdefgh';

export function createChess(state) {
  // ===== Starting board and square utilities =====
  function init() {
    state.board = Array.from({
      length: 8
    }, () => Array(8).fill(null));
    const back = 'RNBQKBNR';
    for (let c = 0; c < 8; c++) {
      state.board[0][c] = { c: back[c], s: 'b' };
      state.board[1][c] = { c: (c === 3 || c === 4) ? 'M' : 'P', s: 'b' };
      state.board[6][c] = { c: (c === 3 || c === 4) ? 'M' : 'P', s: 'w' };
      state.board[7][c] = { c: back[c], s: 'w' };
    }
    state.turn = 'w';
    state.selected = null;
    state.legal = [];
    state.lastMove = null;
    state.moveNum = 1;
    state.history = [];
    state.gameOver = false;
    state.ep = null;
    state.castle = { wK: true, wQ: true, bK: true, bQ: true };
  }
  function inside(r, c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
  }

  function sqName(r, c) {
    return FILES[c] + (8 - r);
  }

  function clone(b) {
    return b.map(row => row.map(p => p ? { ...p } : null));
  }

  // ===== Piece movement generation =====
  function pseudo(b, r, c, includeKing = true) {
    const p = b[r][c];
    if (!p) return [];
    let out = [];
    const push = (rr, cc) => {
      if (!inside(rr, cc)) return false;
      let q = b[rr][cc];
      if (!q) {
        out.push([rr, cc]);
        return true;
      }
      if (q.s !== p.s && (includeKing || q.c !== 'K')) out.push([rr, cc]);
      return false;
    };
    if (p.c === 'M') {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr || dc) push(r + dr, c + dc);
        }
      }
      return out;
    }
    if (p.c === 'P') {
      let d = p.s === 'w' ? -1 : 1;
      let start = p.s === 'w' ? 6 : 1;
      if (inside(r + d, c) && !b[r + d][c]) {
        out.push([r + d, c]);
        if (r === start && !b[r + 2 * d][c]) out.push([r + 2 * d, c]);
      }
      for (let dc of [-1, 1]) {
        let rr = r + d, cc = c + dc;
        if (
          inside(rr, cc) &&
          b[rr][cc] &&
          b[rr][cc].s !== p.s &&
          (includeKing || b[rr][cc].c !== 'K')
        ) {
          out.push([rr, cc]);
        }
        if (state.ep && state.ep.r === rr && state.ep.c === cc) out.push([rr, cc]);
      }
      return out;
    }
    if (p.c === 'N') {
      for (let [dr, dc] of [
        [-2, -1], [-2, 1], [-1, -2], [-1, 2],
        [1, -2], [1, 2], [2, -1], [2, 1]
      ]) {
        push(r + dr, c + dc);
      }
      return out;
    }
    if (p.c === 'K') {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr || dc) push(r + dr, c + dc);
        }
      }
      let row = p.s === 'w' ? 7 : 0;
      if (r === row) {
        if (
          state.castle[p.s + 'K'] &&
          !b[row][5] &&
          !b[row][6] &&
          b[row][7]?.c === 'R' &&
          b[row][7].s === p.s
        ) {
          out.push([row, 6]);
        }
        if (
          state.castle[p.s + 'Q'] &&
          !b[row][1] &&
          !b[row][2] &&
          !b[row][3] &&
          b[row][0]?.c === 'R' &&
          b[row][0].s === p.s
        ) {
          out.push([row, 2]);
        }
      }
      return out;
    }
    let dirs = [];
    if ('BQ'.includes(p.c)) dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
    if ('RQ'.includes(p.c)) dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);
    for (let [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (inside(rr, cc)) {
        if (!b[rr][cc]) out.push([rr, cc]);
        else {
          if (b[rr][cc].s !== p.s && (includeKing || b[rr][cc].c !== 'K')) out.push([rr, cc]);
          break;
        }
        rr += dr;
        cc += dc;
      }
    }
    return out;
  }

  // ===== Attack and check detection =====
  function attacked(b, r, c, by) {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (b[y][x]?.s === by) {
          let p = b[y][x];
          if (p.c === 'P') {
            let d = by === 'w' ? -1 : 1;
            if (y + d === r && Math.abs(x - c) === 1) return true;
          } else if (pseudo(b, y, x).some(([a, z]) => a === r && z === c)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function kingPos(b, s) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (b[r][c]?.c === 'K' && b[r][c].s === s) return [r, c];
      }
    }
    return null;
  }

  function inCheck(b, s) {
    let k = kingPos(b, s);
    return k ? attacked(b, ...k, s === 'w' ? 'b' : 'w') : false;
  }

  // ===== Board updates: captures, special moves, and rights =====
  function apply(b, from, to, promo = 'Q') {
    let [r, c] = from;
    let [rr, cc] = to;
    let p = b[r][c];
    let taken = b[rr][cc];
    b[rr][cc] = p;
    b[r][c] = null;
    if (
      p.c === 'P' &&
      state.ep &&
      rr === state.ep.r &&
      cc === state.ep.c &&
      !taken
    ) {
      b[r][cc] = null;
    }
    if (p.c === 'P' && Math.abs(rr - r) === 2) {
      state.ep = { r: (r + rr) / 2, c };
    } else {
      state.ep = null;
    }
    if (p.c === 'K' && Math.abs(cc - c) === 2) {
      let rook = b[rr][cc > c ? 7 : 0];
      b[rr][cc > c ? 5 : 3] = rook;
      b[rr][cc > c ? 7 : 0] = null;
    }
    if (p.c === 'P' && (rr === 0 || rr === 7)) {
      b[rr][cc] = { c: promo, s: p.s };
    }
    if (p.c === 'K') {
      state.castle[p.s + 'K'] = false;
      state.castle[p.s + 'Q'] = false;
    }
    if (p.c === 'R') {
      if (r === 7 && c === 0) state.castle.wQ = false;
      if (r === 7 && c === 7) state.castle.wK = false;
      if (r === 0 && c === 0) state.castle.bQ = false;
      if (r === 0 && c === 7) state.castle.bK = false;
    }
    if (taken?.c === 'R') {
      if (rr === 7 && cc === 0) state.castle.wQ = false;
      if (rr === 7 && cc === 7) state.castle.wK = false;
      if (rr === 0 && cc === 0) state.castle.bQ = false;
      if (rr === 0 && cc === 7) state.castle.bK = false;
    }
  }

  function getLegal(r, c) {
    let p = state.board[r][c];
    if (!p) return [];
    return pseudo(state.board, r, c, false).filter(([rr, cc]) => {
      if (p.c === 'K' && Math.abs(cc - c) === 2) {
        let step = cc > c ? 1 : -1;
        if (
          attacked(state.board, r, c, p.s === 'w' ? 'b' : 'w') ||
          attacked(state.board, r, c + step, p.s === 'w' ? 'b' : 'w') ||
          attacked(state.board, r, c + 2 * step, p.s === 'w' ? 'b' : 'w')
        ) {
          return false;
        }
      }
      // Legality checks temporarily apply a move, then restore special-move state.
      let b = clone(state.board);
      let save = state.ep && { ...state.ep };
      let saveCastle = { ...state.castle };

      apply(b, [r, c], [rr, cc]);
      state.ep = save;
      state.castle = saveCastle;
      return !inCheck(b, p.s);
    });
  }

  // ===== Move resolution and explosion handling =====
  function resolveMove(from, to, promo, note, forcedExplosion = null, onExplosion = null) {
    const moving = { ...state.board[from[0]][from[1]] };
    const wasEp =
      moving.c === "P" &&
      state.ep &&
      to[0] === state.ep.r &&
      to[1] === state.ep.c &&
      !state.board[to[0]][to[1]];
    let captured = state.board[to[0]][to[1]] ? 1 : 0;
    if (wasEp) captured = 1;
    const kingCaptured = state.board[to[0]][to[1]]?.c === "K";
    const oldEp = state.ep && { ...state.ep };
    apply(state.board, from, to, promo);

    state.lastMove = { from, to };
    // Synchronized remote moves reuse their recorded roll; local moves keep the 20% roll.
    const exploded = typeof forcedExplosion === "boolean" ? forcedExplosion : Math.random() < .2;
    let removed = 0;
    let deadW = kingCaptured && state.board[to[0]][to[1]]?.s === "w";
    let deadB = kingCaptured && state.board[to[0]][to[1]]?.s === "b";
    if (exploded) {
      const [r, c] = to;
      // The blast includes the moved piece and all eight neighboring squares.
      for (let y = Math.max(0, r - 1); y <= Math.min(7, r + 1); y++) {
        for (let x = Math.max(0, c - 1); x <= Math.min(7, c + 1); x++) {
          if (state.board[y][x]) {
            if (state.board[y][x].s === "w" && state.board[y][x].c === "K") {
              deadW = true;
            }
            if (state.board[y][x].s === "b" && state.board[y][x].c === "K") {
              deadB = true;
            }
            state.board[y][x] = null;
            removed++;
          }
        }
      }
      if (onExplosion) onExplosion();
      note += " 💥";
    }
    state.history.push(
      state.turn === "w"
        ? { white: note, black: "" }
        : { white: state.history[state.history.length - 1]?.white || "", black: note }
    );
    if (state.turn === "b" && state.history.length > 0) {
      state.history[state.history.length - 1].black = note;
    }
    state.turn = state.turn === "w" ? "b" : "w";
    state.moveNum = state.turn === "w" ? state.moveNum + 1 : state.moveNum;
    state.selected = null;
    state.legal = [];
    return { deadW, deadB, exploded, removed };
  }

  return {
    init,
    inside,
    sqName,
    clone,
    pseudo,
    attacked,
    kingPos,
    inCheck,
    apply,
    getLegal,
    resolveMove
  };
}
