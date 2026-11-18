const VAL = {
  P: 100,
  N: 320,
  B: 330,
  R: 500,
  Q: 900,
  K: 20000,
  M: 300
};
const MATE_SCORE = 1_000_000;
const CHECK_MOVE_BONUS = 30_000;
const BLAST_CHECK_BONUS = 20_000;

export function createAI(state, chess, ui = null) {
  // Stockfish 19.0.1 Lite, single-threaded WebAssembly build (GPL-3.0).
  let stockfishWorker = null;
  let stockfishReady = null;
  let pendingStockfishMove = null;
  let stockfishSearchQueue = Promise.resolve();

  function loadStockfish() {
    if (stockfishReady) return stockfishReady;

    stockfishReady = new Promise((resolve, reject) => {
      let ready = false;
      const worker = new Worker(
        new URL("./stockfish/stockfish-19-lite-single.js", import.meta.url)
      );
      stockfishWorker = worker;

      const readyTimeout = setTimeout(() => {
        fail(new Error("Stockfish took too long to initialize."));
      }, 180_000);

      function fail(error) {
        clearTimeout(readyTimeout);
        if (pendingStockfishMove) {
          clearTimeout(pendingStockfishMove.timeoutId);
          pendingStockfishMove.reject(error);
          pendingStockfishMove = null;
        }
        worker.terminate();
        if (stockfishWorker === worker) stockfishWorker = null;
        stockfishReady = null;
        reject(error);
      }

      worker.onmessage = event => {
        const message = String(event.data).trim();

        if (message === "uciok") {
          worker.postMessage("setoption name Threads value 1");
          worker.postMessage("isready");
        } else if (message === "readyok" && !ready) {
          ready = true;
          clearTimeout(readyTimeout);
          resolve(worker);
        } else if (message.startsWith("bestmove ") && pendingStockfishMove) {
          const request = pendingStockfishMove;
          pendingStockfishMove = null;
          clearTimeout(request.timeoutId);
          const match = message.match(/^bestmove\s+(\S+)/);
          request.resolve(match && match[1] !== "0000" ? match[1] : null);
        }
      };

      worker.onerror = event => {
        const error = new Error(event.message || "Stockfish could not start.");

        if (!ready) {
          fail(error);
          return;
        }

        if (pendingStockfishMove) {
          clearTimeout(pendingStockfishMove.timeoutId);
          pendingStockfishMove.reject(error);
          pendingStockfishMove = null;
        }

        worker.terminate();
        if (stockfishWorker === worker) stockfishWorker = null;
        stockfishReady = null;
      };

      worker.postMessage("uci");
    }).catch(error => {
      stockfishReady = null;
      throw error;
    });

    return stockfishReady;
  }

  function stockfishFen() {
    const ranks = state.board.map(row => {
      let rank = "";
      let emptySquares = 0;

      for (const piece of row) {
        if (!piece) {
          emptySquares++;
          continue;
        }

        if (emptySquares) {
          rank += emptySquares;
          emptySquares = 0;
        }

        // Stockfish has no Mimic piece; a queen proxy gives it a legal UCI shape.
        const pieceCode = piece.c === "M" ? "Q" : piece.c;
        rank += piece.s === "w" ? pieceCode : pieceCode.toLowerCase();
      }

      if (emptySquares) rank += emptySquares;
      return rank;
    });

    const castlingRights = [
      state.castle.wK ? "K" : "",
      state.castle.wQ ? "Q" : "",
      state.castle.bK ? "k" : "",
      state.castle.bQ ? "q" : ""
    ].join("") || "-";
    const enPassant = state.ep ? chess.sqName(state.ep.r, state.ep.c) : "-";

    return `${ranks.join("/")} ${state.turn} ${castlingRights} ${enPassant} 0 ${state.moveNum}`;
  }

  function toUciMove(move) {
    const piece = state.board[move.from[0]][move.from[1]];
    const promotion =
      piece.c === "P" && (move.to[0] === 0 || move.to[0] === 7) ? "q" : "";

    return chess.sqName(...move.from) + chess.sqName(...move.to) + promotion;
  }

  function searchStockfish(worker, fen, searchMoves) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingStockfishMove = null;
        worker.postMessage("stop");
        worker.terminate();
        stockfishWorker = null;
        stockfishReady = null;
        resolve(null);
      }, 15_000);

      pendingStockfishMove = { resolve, reject, timeoutId };

      try {
        worker.postMessage("ucinewgame");
        worker.postMessage(`position fen ${fen}`);
        worker.postMessage(`go movetime 2500 searchmoves ${searchMoves}`);
      } catch (error) {
        clearTimeout(timeoutId);
        pendingStockfishMove = null;
        reject(error);
      }
    });
  }

  async function getStockfishMove(isCurrent = () => true) {
    const legalMoves = allMoves(state.botSide);
    if (!legalMoves.length) return null;

    const fen = stockfishFen();
    const searchMoves = legalMoves.map(toUciMove).join(" ");
    const worker = await loadStockfish();
    if (!isCurrent()) return null;

    const search = stockfishSearchQueue.then(() =>
      searchStockfish(worker, fen, searchMoves)
    );
    stockfishSearchQueue = search.catch(() => null);
    const bestMove = await search;

    if (!isCurrent()) return null;

    return legalMoves.find(move => toUciMove(move) === bestMove) || null;
  }

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

  function terminalScore(mateAware = false, ply = 0) {
    let mine = chess.kingPos(state.board, state.botSide);
    let theirs = chess.kingPos(state.board, state.botSide === 'w' ? 'b' : 'w');

    if (!mine) return mateAware ? -MATE_SCORE + ply : -100000;
    if (!theirs) return mateAware ? MATE_SCORE - ply : 100000;

    return null;
  }

  function checkmateScore(sideToMove, ply) {
    return sideToMove === state.botSide
      ? -MATE_SCORE + ply
      : MATE_SCORE - ply;
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

  function search(depth, alpha, beta, ply = 0, mateAware = false) {
    let term = terminalScore(mateAware, ply);
    if (term !== null) return term;

    if (depth <= 0) {
      if (
        mateAware &&
        chess.inCheck(state.board, state.turn) &&
        !chess.hasLegalMove(state.turn)
      ) {
        return checkmateScore(state.turn, ply);
      }

      return evaluate(state.botSide);
    }

    let moves = allMoves(state.turn);
    if (!moves.length) {
      if (mateAware && chess.inCheck(state.board, state.turn)) {
        return checkmateScore(state.turn, ply);
      }

      return evaluate(state.botSide);
    }

    let maximizing = state.turn === state.botSide;
    let best = maximizing ? -Infinity : Infinity;

    for (const m of moves) {
      let base = snapshot();
      const movingPiece = state.board[m.from[0]][m.from[1]];

      simulate(m, false);
      let safe = search(depth - 1, alpha, beta, ply + 1, mateAware);
      restore(base);

      simulate(m, true);
      let blown = terminalScore(mateAware, ply + 1);

      if (blown === null) {
        blown =
          depth <= 1 && !mateAware
            ? evaluate(state.botSide)
            : search(depth - 1, alpha, beta, ply + 1, mateAware);
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

    let score =
      (q ? (VAL[q.c] || 0) * 10 - (VAL[p.c] || 0) : 0) +
      (7 - (Math.abs(3.5 - m.to[0]) + Math.abs(3.5 - m.to[1]))) * 2;

    // Put checking moves first so the Grandmaster search reaches mate lines sooner.
    const base = snapshot();
    simulate(m, false);
    if (chess.inCheck(state.board, state.turn)) score += CHECK_MOVE_BONUS;
    restore(base);

    if (p.c === 'M') {
      simulate(m, true);
      if (chess.inCheck(state.board, state.turn)) score += BLAST_CHECK_BONUS;
      restore(base);
    }

    return score;
  }

  function scoreRootMove(move, depth, alpha, mateAware) {
    const base = snapshot();
    const movingPiece = state.board[move.from[0]][move.from[1]];

    simulate(move, false);
    const safe = search(depth - 1, alpha, Infinity, 1, mateAware);
    restore(base);

    simulate(move, true);
    let blown = terminalScore(mateAware, 1);

    if (blown === null) {
      blown =
        depth <= 1 && !mateAware
          ? evaluate(state.botSide)
          : search(depth - 1, alpha, Infinity, 1, mateAware);
    }

    restore(base);
    return expectedMoveScore(safe, blown, movingPiece);
  }

  function sameMove(first, second) {
    return (
      first.from[0] === second.from[0] &&
      first.from[1] === second.from[1] &&
      first.to[0] === second.to[0] &&
      first.to[1] === second.to[1]
    );
  }

  // ===== Difficulty levels and bot move execution =====
  function chooseBotMove(level, stockfishMove = null) {
    let moves = allMoves(state.botSide);
    if (!moves.length) return null;
    if (level === 'easy') return moves[Math.floor(Math.random() * moves.length)];

    const legalMoves = moves.slice();
    const mateAware = level === 'grandmaster';
    let depth = level === 'intermediate' ? 1 : level === 'hard' ? 2 : mateAware ? 4 : 3;

    if (mateAware) {
      const orderedMoves = moves
        .map(move => ({ move, score: moveOrder(move) }))
        .sort((a, b) => b.score - a.score);
      const selectedMoves = orderedMoves.slice(0, 18).map(entry => entry.move);

      // Keep every checking option in the candidate set, including quiet mates.
      for (const entry of orderedMoves) {
        if (
          entry.score >= BLAST_CHECK_BONUS &&
          !selectedMoves.includes(entry.move)
        ) {
          selectedMoves.push(entry.move);
        }
      }

      moves = selectedMoves;
    }

    let best = null;
    let bestScore = -Infinity;
    let alpha = -Infinity;

    for (const m of moves) {
      let score =
        scoreRootMove(m, depth, alpha, mateAware) +
        (Math.random() - .5) * (level === 'intermediate' ? 28 : level === 'hard' ? 5 : 1);

      if (score > bestScore) {
        bestScore = score;
        best = m;
      }

      alpha = Math.max(alpha, score);
    }

    if (mateAware && stockfishMove) {
      const preferredMove = legalMoves.find(move => sameMove(move, stockfishMove));

      if (preferredMove) {
        // Stockfish is orthodox-chess only; use its move only when the Blast search agrees.
        const variantScore = scoreRootMove(preferredMove, depth, -Infinity, true);
        if (variantScore >= bestScore - 50) return preferredMove;
      }
    }

    return best;
  }

  function playBot(onMove, isCurrent = () => true) {
    if (state.gameOver || state.turn !== state.botSide || state.botThinking) return;

    state.botThinking = true;

    setTimeout(async () => {
      if (!isCurrent()) return;

      let m;

      try {
        let stockfishMove = null;

        if (state.gameMode === "grandmaster") {
          if (ui) ui.say("Grandmaster is calculating with Stockfish…", false);

          try {
            stockfishMove = await getStockfishMove(isCurrent);
          } catch (error) {
            console.warn("Stockfish could not load; using the Blast Chess search.", error);
            if (ui && isCurrent()) {
              ui.say("Stockfish unavailable; using the Blast Chess search.", false);
            }
          }
        }

        if (!isCurrent()) return;
        m = chooseBotMove(state.gameMode, stockfishMove);
      } finally {
        if (isCurrent()) state.botThinking = false;
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
    playBot,
    preloadStockfish: loadStockfish
  };
}
