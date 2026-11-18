import { createChess } from "./chess.js";
import { createAI } from "./ai.js";
import { createMultiplayer } from "./multiplayer.js";
import { createUI } from "./ui.js";

const $ = selector => document.querySelector(selector);
const BOT_MODES = ["easy", "intermediate", "hard", "grandmaster"];
const TIME_CONTROL_MS = {
  "1": 60_000,
  "3": 3 * 60_000,
  "5": 5 * 60_000,
  "10": 10 * 60_000
};
let gameGeneration = 0;

// ===== Shared game state =====
const state = {
  board: null,
  turn: "w",
  selected: null,
  legal: [],
  lastMove: null,
  moveNum: 1,
  history: [],
  gameOver: false,
  ep: null,
  castle: null,
  gameMode: "local",
  botSide: "b",
  mySide: "w",
  onlinePeer: null,
  onlineConn: null,
  remoteApplying: false,
  botThinking: false
};

const clock = {
  remaining: { w: 5 * 60_000, b: 5 * 60_000 },
  activeSide: null,
  startedAt: null,
  running: false,
  intervalId: null
};

const chess = createChess(state);
const ui = createUI(state, chess, finishMove, startClockForCurrentTurn);
const ai = createAI(state, chess, ui);
const multiplayer = createMultiplayer(state, {
  init,
  applyRemoteMove,
  applyRemoteTimeout,
  ui
});

// ===== Initialization and move coordination =====
function clockDuration() {
  return TIME_CONTROL_MS[ui.getTimeControl()] || TIME_CONTROL_MS["5"];
}

function clockRemainingAt(side, now = Date.now()) {
  const elapsed =
    clock.running && clock.activeSide === side && clock.startedAt !== null
      ? now - clock.startedAt
      : 0;

  return Math.max(0, clock.remaining[side] - elapsed);
}

function showClocks(now = Date.now()) {
  ui.renderClocks(
    {
      w: clockRemainingAt("w", now),
      b: clockRemainingAt("b", now)
    },
    clock.running ? clock.activeSide : null
  );
}

function clearClockInterval() {
  if (clock.intervalId !== null) {
    clearInterval(clock.intervalId);
    clock.intervalId = null;
  }
}

function stopClock() {
  if (clock.running && clock.activeSide) {
    clock.remaining[clock.activeSide] = clockRemainingAt(clock.activeSide);
  }

  clock.running = false;
  clock.activeSide = null;
  clock.startedAt = null;
  clearClockInterval();
  showClocks();
}

function finishByTimeout(losingSide, notifyOpponent = true) {
  if (state.gameOver) return;

  clock.remaining[losingSide] = 0;
  stopClock();
  state.gameOver = true;

  const loser = losingSide === "w" ? "White" : "Black";
  const winner = losingSide === "w" ? "Black" : "White";

  ui.say(loser + " ran out of time. " + winner + " wins!", true);
  ui.showWinner(winner, "Time");
  ui.render();

  if (notifyOpponent) multiplayer.sendTimeout(losingSide);
}

function tickClock() {
  if (!clock.running || !clock.activeSide) return;

  const activeSide = clock.activeSide;
  const now = Date.now();
  showClocks(now);

  if (clockRemainingAt(activeSide, now) <= 0) {
    finishByTimeout(activeSide);
  }
}

function startClockForCurrentTurn() {
  if (state.gameOver || clock.running) return;

  clock.activeSide = state.turn;
  clock.startedAt = Date.now();
  clock.running = true;

  if (clock.intervalId === null) {
    clock.intervalId = setInterval(tickClock, 200);
  }

  showClocks();
}

function resetClocks() {
  clearClockInterval();

  const duration = clockDuration();
  clock.remaining = { w: duration, b: duration };
  clock.activeSide = null;
  clock.startedAt = null;
  clock.running = false;
  showClocks();
}

function chargeClock(side) {
  if (!clock.running) startClockForCurrentTurn();
  if (clock.activeSide !== side) return true;

  const now = Date.now();
  clock.remaining[side] = clockRemainingAt(side, now);
  clock.startedAt = now;

  if (clock.remaining[side] <= 0) {
    finishByTimeout(side);
    return false;
  }

  showClocks(now);
  return true;
}

function switchClockTo(side) {
  if (clock.running && clock.activeSide) {
    clock.remaining[clock.activeSide] = clockRemainingAt(clock.activeSide);
  }

  clock.activeSide = side;
  clock.startedAt = Date.now();
  clock.running = true;

  if (clock.intervalId === null) {
    clock.intervalId = setInterval(tickClock, 200);
  }

  showClocks();
}

function clockSnapshot() {
  return {
    remaining: {
      w: clockRemainingAt("w"),
      b: clockRemainingAt("b")
    },
    activeSide: clock.activeSide,
    running: clock.running
  };
}

function applyClockSnapshot(snapshot, allowRunning) {
  if (!snapshot || !snapshot.remaining) return false;

  const duration = clockDuration();
  for (const side of ["w", "b"]) {
    const remaining = Number(snapshot.remaining[side]);
    if (Number.isFinite(remaining)) {
      clock.remaining[side] = Math.min(duration, Math.max(0, remaining));
    }
  }

  clearClockInterval();
  clock.running =
    allowRunning &&
    Boolean(snapshot.running) &&
    (snapshot.activeSide === "w" || snapshot.activeSide === "b");
  clock.activeSide = clock.running ? snapshot.activeSide : null;
  clock.startedAt = clock.running ? Date.now() : null;

  if (clock.running) {
    clock.intervalId = setInterval(tickClock, 200);
  }

  showClocks();
  return true;
}

function init() {
  gameGeneration++;
  state.botThinking = false;
  chess.init();
  resetClocks();
  $("#timeControl").disabled = state.gameMode === "online";
  ui.hideWinner();
  ui.render();
  ui.say("Choose a piece to see its legal moves.");
}

function isBotTurn(generation) {
  return (
    generation === gameGeneration &&
    !state.gameOver &&
    BOT_MODES.includes(state.gameMode) &&
    state.turn === state.botSide
  );
}

function finishMove(
  from,
  to,
  promo,
  note,
  forcedExplosion = null,
  forcedGameEndingExplosion = null,
  remoteClock = null
) {
  const movingSide = state.turn;
  if (!remoteClock && !chargeClock(movingSide)) return;

  const result = chess.resolveMove(
    from,
    to,
    promo,
    note,
    forcedExplosion,
    ui.showExplosion,
    forcedGameEndingExplosion
  );
  const checkmatedSide =
    !result.deadW &&
    !result.deadB &&
    chess.inCheck(state.board, state.turn) &&
    !chess.hasLegalMove(state.turn)
      ? state.turn
      : null;

  state.gameOver = Boolean(
    result.gameEndingExplosion || result.deadW || result.deadB || checkmatedSide
  );

  if (remoteClock) {
    applyClockSnapshot(remoteClock, !state.gameOver);
  } else if (state.gameOver) {
    stopClock();
  } else {
    switchClockTo(state.turn);
  }

  $("#timeControl").disabled = state.gameMode === "online" || state.history.length > 0;

  multiplayer.sendMove(
    from,
    to,
    promo,
    result.exploded,
    result.gameEndingExplosion,
    clockSnapshot()
  );

  if (result.gameEndingExplosion) {
    const winner = movingSide === "w" ? "White" : "Black";
    ui.say("☢️ Rare Mimic explosion! " + winner + " wins!", true);
    ui.showWinner(winner, "Rare explosion");
  } else if (result.deadW || result.deadB) {
    const winner = result.deadW ? "Black" : "White";
    ui.say(
      (result.deadW ? "White" : "Black") + " king captured. " + winner + " wins!",
      true
    );
    ui.showWinner(winner, "King captured");
  } else if (checkmatedSide) {
    const winner = checkmatedSide === "w" ? "Black" : "White";
    ui.say(winner + " wins by checkmate!", true);
    ui.showWinner(winner, "Checkmate");
  } else if (result.exploded) {
    ui.say(
      "💥 BOOM! " +
        result.removed +
        " piece" +
        (result.removed === 1 ? "" : "s") +
        " caught in the blast. " +
        (state.turn === "w" ? "White" : "Black") +
        " to move.",
      true
    );
  } else if (chess.inCheck(state.board, state.turn)) {
    ui.say((state.turn === "w" ? "White" : "Black") + " is in check.", false);
  } else {
    ui.say((state.turn === "w" ? "White" : "Black") + " to move.", false);
  }

  ui.render();

  if (
    !state.gameOver &&
    BOT_MODES.includes(state.gameMode) &&
    state.turn === state.botSide
  ) {
    const generation = gameGeneration;

    setTimeout(() => {
      if (!isBotTurn(generation)) return;

      ai.playBot(
        (botFrom, botTo, promo, botNote) => {
          if (!isBotTurn(generation)) return;
          finishMove(botFrom, botTo, promo, botNote);
        },
        () => isBotTurn(generation)
      );
    }, 180);
  }
}

function applyRemoteMove(data) {
  const piece = state.board[data.from[0]][data.from[1]];
  const captured = state.board[data.to[0]][data.to[1]];
  const note =
    (piece.c === "P" ? "" : piece.c) +
    chess.sqName(...data.from) +
    (captured ? "x" : "–") +
    chess.sqName(...data.to);

  finishMove(
    data.from,
    data.to,
    data.promo || "Q",
    note,
    !!data.exploded,
    !!data.gameEndingExplosion,
    data.clock || null
  );
}

function applyRemoteTimeout(losingSide) {
  if (losingSide === "w" || losingSide === "b") {
    finishByTimeout(losingSide, false);
  }
}

// ===== Game selection and controls =====
function startSelectedGame() {
  if (state.gameMode === "online" && state.onlineConn) {
    ui.say("Online match active. Use New game to restart both boards.");
    return;
  }

  state.gameMode = $("#opponent").value;
  state.botSide = "b";
  init();

  if (state.gameMode === "grandmaster") {
    ui.say("Loading Stockfish 19 for the Grandmaster bot…", false);
    ai.preloadStockfish().catch(error => {
      console.warn("Stockfish could not load; the built-in search will be used.", error);
      if (state.gameMode === "grandmaster") {
        ui.say("Stockfish unavailable; the built-in Blast Chess search will be used.", false);
      }
    });
  }
}

$("#reset").onclick = () => {
  if (state.gameMode === "online" && state.onlineConn && state.onlineConn.open) {
    multiplayer.sendReset(ui.getTimeControl());
    init();
  } else {
    startSelectedGame();
  }
};

$("#opponent").onchange = () => {
  if (state.gameMode === "online" && state.onlineConn) {
    $("#roomStatus").textContent = "Finish or leave the online room before switching modes.";
  }
};

$("#timeControl").onchange = () => {
  if (state.gameMode !== "online" && state.history.length === 0) {
    resetClocks();
  }
};

$("#hostRoom").onclick = multiplayer.hostOnline;
$("#joinRoom").onclick = multiplayer.joinOnline;
$("#playAgain").onclick = () => $("#reset").click();

// ===== Start the initial game =====
init();
