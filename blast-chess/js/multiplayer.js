export function createMultiplayer(
  state,
  { init, applyRemoteMove, applyRemoteTimeout, ui }
) {
  // ===== PeerJS loading and room connection setup =====
  function addScript(src) {
    return new Promise((resolve, reject) => {
      if (window.Peer) {
        resolve();
        return;
      }

      const tag = document.createElement("script");
      tag.src = src;
      tag.onload = resolve;
      tag.onerror = () => reject(new Error("PeerJS could not load. Check your internet connection."));
      document.head.append(tag);
    });
  }

  function statusRoom(text) {
    ui.setRoomStatus(text);
  }

  function attachConnection(conn, isHost) {
    state.onlineConn = conn;
    state.gameMode = "online";
    state.mySide = isHost ? "w" : "b";

    init();

    conn.on("open", () => {
      statusRoom(isHost ? "Room ready. Share your room code with the other player." : "Connected! You are Black.");

      if (isHost) {
        init();
        conn.send({ type: "start", timeControl: ui.getTimeControl() });
      } else {
        conn.send({ type: "ready" });
      }
    });

    conn.on("data", data => {
      if (!data || typeof data !== "object") return;

      if (
        data.type === "move" &&
        state.gameMode === "online" &&
        !state.gameOver &&
        state.turn !== state.mySide &&
        state.board[data.from?.[0]]?.[data.from?.[1]]?.s === state.turn
      ) {
        state.remoteApplying = true;
        applyRemoteMove(data);
        state.remoteApplying = false;
      } else if (data.type === "start") {
        ui.setTimeControl(data.timeControl);
        init();
      } else if (data.type === "reset") {
        ui.setTimeControl(data.timeControl);
        init();
      } else if (data.type === "timeout") {
        applyRemoteTimeout(data.losingSide);
      } else if (data.type === "ready") {
        statusRoom("Opponent joined. You are White.");
      }
    });

    conn.on("close", () => {
      statusRoom("Opponent disconnected.");
      state.onlineConn = null;
    });

    conn.on("error", error => statusRoom("Connection issue: " + error.message));
  }

  // ===== Hosting and joining rooms =====
  async function hostOnline() {
    try {
      statusRoom("Connecting to the room service…");

      await addScript("https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js");

      if (state.onlinePeer) state.onlinePeer.destroy();

      state.onlinePeer = new window.Peer();

      state.onlinePeer.on("open", id => {
        ui.setRoomCode("Room code: " + id);
        ui.setJoinCode(id);
        state.gameMode = "online";
        state.mySide = "w";
        init();
        statusRoom("Waiting for your opponent…");
      });

      state.onlinePeer.on("connection", conn => attachConnection(conn, true));
      state.onlinePeer.on("error", error => statusRoom("Room error: " + error.message));
    } catch (error) {
      statusRoom(error.message);
    }
  }

  async function joinOnline() {
    const id = ui.getJoinCode().trim();

    if (!id) {
      statusRoom("Enter the other player’s room code first.");
      return;
    }

    try {
      statusRoom("Connecting…");

      await addScript("https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js");

      if (state.onlinePeer) state.onlinePeer.destroy();

      state.onlinePeer = new window.Peer();

      state.onlinePeer.on("open", () => {
        const conn = state.onlinePeer.connect(id, {
          reliable: true
        });

        attachConnection(conn, false);
      });

      state.onlinePeer.on("error", error => statusRoom("Room error: " + error.message));
    } catch (error) {
      statusRoom(error.message);
    }
  }

  // ===== Move and reset synchronization =====
  function sendMove(from, to, promo, exploded, gameEndingExplosion, clock) {
    if (state.gameMode === "online" && state.onlineConn && state.onlineConn.open && !state.remoteApplying) {
      state.onlineConn.send({
        type: "move",
        from,
        to,
        promo,
        exploded,
        gameEndingExplosion,
        clock
      });
    }
  }

  function sendReset(timeControl) {
    if (state.onlineConn && state.onlineConn.open) {
      state.onlineConn.send({ type: "reset", timeControl });
    }
  }

  function sendTimeout(losingSide) {
    if (state.onlineConn && state.onlineConn.open) {
      state.onlineConn.send({ type: "timeout", losingSide });
    }
  }

  return {
    hostOnline,
    joinOnline,
    sendMove,
    sendReset,
    sendTimeout
  };
}
