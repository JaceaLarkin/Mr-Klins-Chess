import assert from "node:assert/strict";
import test from "node:test";
import { createChess } from "../js/chess.js";
import { createMultiplayer } from "../js/multiplayer.js";

function createEmptyGame(pieces = []) {
  const state = {};
  const chess = createChess(state);
  chess.init();
  state.board = Array.from({ length: 8 }, () => Array(8).fill(null));
  state.ep = null;
  state.castle = { wK: false, wQ: false, bK: false, bQ: false };

  for (const { r, c, piece } of pieces) {
    state.board[r][c] = piece;
  }

  return { state, chess };
}

test("a Mimic blast removes nearby non-kings but leaves both kings alive", () => {
  const { state, chess } = createEmptyGame([
    { r: 3, c: 4, piece: { c: "K", s: "w" } },
    { r: 5, c: 4, piece: { c: "K", s: "b" } },
    { r: 4, c: 3, piece: { c: "M", s: "w" } },
    { r: 4, c: 4, piece: { c: "R", s: "b" } },
    { r: 3, c: 3, piece: { c: "N", s: "w" } }
  ]);

  const result = chess.resolveMove(
    [4, 3],
    [4, 4],
    "Q",
    "M:d4xe4",
    true,
    null,
    false
  );

  assert.equal(result.exploded, true);
  assert.equal(result.deadW, false);
  assert.equal(result.deadB, false);
  assert.equal(state.board[3][4]?.c, "K");
  assert.equal(state.board[5][4]?.c, "K");
  assert.equal(state.board[4][4], null);
  assert.equal(state.board[3][3], null);
});

test("only a Mimic can explode, and the rare ending only follows a blast", () => {
  const regularMove = createEmptyGame([
    { r: 7, c: 4, piece: { c: "K", s: "w" } },
    { r: 0, c: 4, piece: { c: "K", s: "b" } },
    { r: 6, c: 0, piece: { c: "R", s: "w" } },
    { r: 6, c: 1, piece: { c: "P", s: "b" } }
  ]);
  const regularResult = regularMove.chess.resolveMove(
    [6, 0], [6, 1], "Q", "R:a2xb2", true, null, true
  );

  assert.equal(regularResult.exploded, false);
  assert.equal(regularResult.gameEndingExplosion, false);

  const mimicMove = createEmptyGame([
    { r: 7, c: 4, piece: { c: "K", s: "w" } },
    { r: 0, c: 4, piece: { c: "K", s: "b" } },
    { r: 6, c: 0, piece: { c: "M", s: "w" } },
    { r: 6, c: 1, piece: { c: "P", s: "b" } }
  ]);
  const safeResult = mimicMove.chess.resolveMove(
    [6, 0], [6, 1], "Q", "M:a2xb2", false, null, true
  );

  assert.equal(safeResult.exploded, false);
  assert.equal(safeResult.gameEndingExplosion, false);

  const blastMove = createEmptyGame([
    { r: 7, c: 4, piece: { c: "K", s: "w" } },
    { r: 0, c: 4, piece: { c: "K", s: "b" } },
    { r: 6, c: 0, piece: { c: "M", s: "w" } },
    { r: 6, c: 1, piece: { c: "P", s: "b" } }
  ]);
  const rareResult = blastMove.chess.resolveMove(
    [6, 0], [6, 1], "Q", "M:a2xb2", true, null, true
  );

  assert.equal(rareResult.exploded, true);
  assert.equal(rareResult.gameEndingExplosion, true);
});

test("a pawn promotes to the selected piece", () => {
  const { state, chess } = createEmptyGame([
    { r: 7, c: 4, piece: { c: "K", s: "w" } },
    { r: 0, c: 7, piece: { c: "K", s: "b" } },
    { r: 1, c: 0, piece: { c: "P", s: "w" } }
  ]);

  chess.resolveMove([1, 0], [0, 0], "N", "a7-a8", false, null, false);

  assert.deepEqual(state.board[0][0], { c: "N", s: "w" });
});

test("kingside castling moves the king and rook and clears castling rights", () => {
  const { state, chess } = createEmptyGame([
    { r: 7, c: 4, piece: { c: "K", s: "w" } },
    { r: 7, c: 7, piece: { c: "R", s: "w" } },
    { r: 0, c: 4, piece: { c: "K", s: "b" } }
  ]);
  state.castle.wK = true;

  assert.ok(chess.getLegal(7, 4).some(([r, c]) => r === 7 && c === 6));
  chess.apply(state.board, [7, 4], [7, 6]);

  assert.deepEqual(state.board[7][6], { c: "K", s: "w" });
  assert.deepEqual(state.board[7][5], { c: "R", s: "w" });
  assert.equal(state.board[7][7], null);
  assert.equal(state.castle.wK, false);
});

test("en passant is legal and removes the captured pawn", () => {
  const { state, chess } = createEmptyGame([
    { r: 7, c: 4, piece: { c: "K", s: "w" } },
    { r: 0, c: 4, piece: { c: "K", s: "b" } },
    { r: 3, c: 4, piece: { c: "P", s: "w" } },
    { r: 3, c: 3, piece: { c: "P", s: "b" } }
  ]);
  state.ep = { r: 2, c: 3 };

  assert.ok(chess.getLegal(3, 4).some(([r, c]) => r === 2 && c === 3));
  chess.apply(state.board, [3, 4], [2, 3]);

  assert.deepEqual(state.board[2][3], { c: "P", s: "w" });
  assert.equal(state.board[3][3], null);
  assert.equal(state.ep, null);
});

test("online rematch waits for the other player, then resets both clients", async () => {
  const originalWindow = globalThis.window;
  const peers = [];

  class FakeConnection {
    constructor() {
      this.open = true;
      this.handlers = {};
      this.peer = null;
    }

    on(event, handler) {
      this.handlers[event] = handler;
    }

    send(data) {
      this.peer?.handlers.data?.(data);
    }

    emit(event, data) {
      this.handlers[event]?.(data);
    }
  }

  class FakePeer {
    constructor() {
      this.handlers = {};
      this.connectionToUse = null;
      peers.push(this);
    }

    on(event, handler) {
      this.handlers[event] = handler;
    }

    connect() {
      return this.connectionToUse;
    }

    emit(event, data) {
      this.handlers[event]?.(data);
    }

    destroy() {}
  }

  function makeClient() {
    const state = {
      gameMode: "local",
      gameOver: false,
      onlineConn: null,
      onlinePeer: null,
      mySide: "w"
    };
    let timeControl = "5";
    let resetCount = 0;
    const ui = {
      rematchStatus: "idle",
      setRoomStatus() {},
      setRoomCode() {},
      setJoinCode() {},
      getJoinCode: () => "room-code",
      getTimeControl: () => timeControl,
      setTimeControl: value => { timeControl = value; },
      setRematchState(status) { this.rematchStatus = status; }
    };
    const multiplayer = createMultiplayer(state, {
      init() {
        resetCount++;
        state.gameOver = false;
      },
      applyRemoteMove() {},
      applyRemoteTimeout() {},
      ui
    });

    return {
      state,
      ui,
      multiplayer,
      resetCount: () => resetCount
    };
  }

  try {
    globalThis.window = { Peer: FakePeer };

    const white = makeClient();
    const black = makeClient();
    await white.multiplayer.hostOnline();

    const hostPeer = peers[0];
    hostPeer.emit("open", "room-code");
    const hostConnection = new FakeConnection();
    hostPeer.emit("connection", hostConnection);

    await black.multiplayer.joinOnline();
    const guestPeer = peers[1];
    const guestConnection = new FakeConnection();
    guestPeer.connectionToUse = guestConnection;
    hostConnection.peer = guestConnection;
    guestConnection.peer = hostConnection;
    guestPeer.emit("open", "guest-id");

    hostConnection.emit("open");
    guestConnection.emit("open");
    white.state.gameOver = true;
    black.state.gameOver = true;

    const whiteResetCount = white.resetCount();
    const blackResetCount = black.resetCount();
    assert.equal(white.multiplayer.requestOrAcceptRematch(), true);
    assert.equal(black.ui.rematchStatus, "incoming");
    assert.equal(black.state.gameOver, true);

    assert.equal(black.multiplayer.requestOrAcceptRematch(), true);
    assert.equal(white.resetCount(), whiteResetCount + 1);
    assert.equal(black.resetCount(), blackResetCount + 1);
    assert.equal(white.state.gameOver, false);
    assert.equal(black.state.gameOver, false);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
