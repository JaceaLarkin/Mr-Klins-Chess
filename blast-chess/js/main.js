import { createChess } from "./chess.js";
import { createAI } from "./ai.js";
import { createMultiplayer } from "./multiplayer.js";
import { createUI } from "./ui.js";

const $ = selector => document.querySelector(selector);
const BOT_MODES = ["easy", "intermediate", "hard", "grandmaster"];
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
  gameGeneration++;
  state.botThinking = false;
  chess.init();
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
  forcedGameEndingExplosion = null
) {
  const movingSide = state.turn;
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

  multiplayer.sendMove(
    from,
    to,
    promo,
    result.exploded,
    result.gameEndingExplosion
  );

  state.gameOver = Boolean(
    result.gameEndingExplosion || result.deadW || result.deadB || checkmatedSide
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
    !!data.gameEndingExplosion
  );
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
$("#playAgain").onclick = () => $("#reset").click();

// ===== Start the initial game =====
init();
