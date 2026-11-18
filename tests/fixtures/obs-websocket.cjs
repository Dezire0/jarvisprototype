const { once } = require("node:events");
const { createHash } = require("node:crypto");
const { WebSocketServer } = require("ws");
const { encode, decode } = require("@msgpack/msgpack");

async function startObsFixture() {
  const password = "synthetic-obs-fixture";
  const challenge = { salt: "fixture-salt", challenge: "fixture-challenge" };
  const hash = (text) => createHash("sha256").update(text).digest("base64");
  const authentication = hash(hash(password + challenge.salt) + challenge.challenge);
  const state = { scene: "Opening", active: false, reconnecting: false };
  const scenes = ["Opening", "Slides"];
  const calls = [];
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  server.on("connection", (socket) => {
    const send = (op, d) => socket.send(encode({ op, d }));
    let identified = false;
    send(0, { obsWebSocketVersion: "5.6.0", rpcVersion: 1, authentication: challenge });
    socket.on("message", (raw) => {
      const { op, d } = decode(raw);
      if (!identified) {
        if (op !== 1 || d.authentication !== authentication) {
          socket.close(4009, "Authentication failed");
          return;
        }
        identified = true;
        send(2, { negotiatedRpcVersion: 1 });
        return;
      }
      if (op !== 6) return;
      const { requestType, requestId, requestData } = d;
      calls.push(requestType);
      let responseData;
      const requestStatus = { result: true, code: 100 };
      switch (requestType) {
        case "GetVersion": responseData = { obsWebSocketVersion: "5.6.0" }; break;
        case "GetCurrentProgramScene": responseData = { currentProgramSceneName: state.scene }; break;
        case "GetStreamStatus": responseData = { outputActive: state.active, outputReconnecting: state.reconnecting }; break;
        case "GetSceneList": responseData = { scenes: scenes.map((sceneName) => ({ sceneName })) }; break;
        case "GetInputList": responseData = { inputs: [] }; break;
        case "SetCurrentProgramScene":
          if (scenes.includes(requestData.sceneName)) state.scene = requestData.sceneName;
          else Object.assign(requestStatus, { result: false, code: 600 });
          break;
        case "StartStream": state.active = true; break;
        case "StopStream": state.active = false; break;
        default: Object.assign(requestStatus, { result: false, code: 204 });
      }
      send(7, { requestType, requestId, requestStatus, ...(responseData ? { responseData } : {}) });
    });
  });
  await once(server, "listening");
  function disconnect() {
    for (const socket of server.clients) socket.terminate();
  }
  return {
    address: "ws://127.0.0.1:" + server.address().port, password, state, calls, disconnect,
    close() {
      disconnect();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { startObsFixture };
