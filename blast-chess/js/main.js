import { createChess } from "./chess.js";
import { createAI } from "./ai.js";
import { createMultiplayer } from "./multiplayer.js";
import { createUI } from "./ui.js";

const $ = selector => document.querySelector(selector);

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

const chess = createChess(state);
const ui = createUI(state, chess, finishMove);
const ai = createAI(state, chess);
const multiplayer = createMultiplayer(state, {
  init,
  applyRemoteMove,
  ui
});

// ===== Initialization and move coordination =====
function init() {
  chess.init();
  ui.render();
  ui.say("Choose a piece to see its legal moves.");
}

function finishMove(from, to, promo, note, forcedExplosion = null) {
  const result = chess.resolveMove(
    from,
    to,
    promo,
    note,
    forcedExplosion,
    ui.showExplosion
  );

  multiplayer.sendMove(from, to, promo, result.exploded);

  if (result.deadW || result.deadB) state.gameOver = true;

  if (result.deadW || result.deadB) {
    ui.say(
      (result.deadW ? "White" : "Black") +
        " king caught in the blast. " +
        (result.deadW ? "Black" : "White") +
        " wins!",
      true
    );
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
    ["easy", "intermediate", "hard", "grandmaster"].includes(state.gameMode) &&
    state.turn === state.botSide
  ) {
    setTimeout(() => ai.playBot(finishMove), 180);
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

  finishMove(data.from, data.to, data.promo || "Q", note, !!data.exploded);
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
}

$("#reset").onclick = () => {
  if (state.gameMode === "online" && state.onlineConn && state.onlineConn.open) {
    multiplayer.sendReset();
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

$("#hostRoom").onclick = multiplayer.hostOnline;
$("#joinRoom").onclick = multiplayer.joinOnline;

// ===== Start the initial game =====
init();
