const { OBSWebSocket } = require("obs-websocket-js");

const DEFAULT_OBS_ADDRESS = "ws://127.0.0.1:4455";
const OBS_TOOL_NAMES = new Set(["obs:connect", "obs:status", "obs:scene", "obs:start", "obs:stop"]);
const OBS_ERRORS = new Set([
  "OBS_ADDRESS", "OBS_AUTH", "OBS_DISCONNECTED", "OBS_TIMEOUT", "OBS_BUSY",
  "OBS_CHANGED", "OBS_PERMISSION", "OBS_REQUEST",
]);

function obsError(code, message) {
  return Object.assign(new Error(message), { code });
}

function validateAddress(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 1024 || /[\x00-\x20\x7f\u202a-\u202e\u2066-\u2069]/.test(text)) return null;
  try {
    const url = new URL(text);
    return ["ws:", "wss:"].includes(url.protocol) && !url.username && !url.password &&
      !url.search && !url.hash ? text : null;
  } catch {
    return null;
  }
}

function formatObsConnectionError(error, address) {
  const message = String(error?.message || error || "").trim();

  if (/ECONNREFUSED|couldn't connect|failed to connect/i.test(message)) {
    return `Could not reach OBS WebSocket at ${address}. Make sure OBS is running and WebSocket Server is enabled on that address.`;
  }

  if (/authentication|invalid password|identify failed|4009/i.test(message)) {
    return `OBS rejected the WebSocket password for ${address}. Check the password in OBS WebSocket Server Settings.`;
  }

  return `OBS connection failed for ${address}.`;
}

class ObsService {
  constructor() {
    this.client = new OBSWebSocket();
    this.connected = false;
    this.address = DEFAULT_OBS_ADDRESS;
    this.revision = 0;
    this.connecting = false;
    this.confirming = false;

    this.client.on("ConnectionClosed", () => {
      this.connected = false;
      this.revision++;
    });
  }

  async #awaitResponse(operation) {
    let timer;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(obsError("OBS_TIMEOUT", "OBS did not respond in time.")), 8000);
      })]);
    } finally {
      clearTimeout(timer);
    }
  }

  async connect({ address = DEFAULT_OBS_ADDRESS, password = "" } = {}) {
    const endpoint = validateAddress(address);
    if (!endpoint || typeof password !== "string" || password.length > 1024) {
      throw obsError("OBS_ADDRESS", "Enter a valid OBS WebSocket address.");
    }
    if (this.connecting || this.confirming) throw obsError("OBS_BUSY", "An OBS operation is already in progress.");
    this.connecting = true;
    this.connected = false;
    this.revision++;
    try {
      const result = await this.#awaitResponse(this.client.connect(endpoint, password || undefined));
      this.connected = true;
      this.address = endpoint;

      return {
        address: endpoint,
        obsWebSocketVersion: result.obsWebSocketVersion,
        negotiatedRpcVersion: result.negotiatedRpcVersion
      };
    } catch (error) {
      void this.client.disconnect().catch(() => {});
      if (error.code === "OBS_TIMEOUT") throw error;
      const code = /authentication|invalid password|identify failed|4009/i.test(String(error?.message)) || error.code === 4009
        ? "OBS_AUTH" : "OBS_REQUEST";
      throw obsError(code, formatObsConnectionError(error, endpoint));
    } finally {
      this.connecting = false;
    }
  }

  #checkConnection(revision = this.revision) {
    if (revision !== this.revision) throw obsError("OBS_CHANGED", "The OBS connection changed.");
    if (!this.connected) throw obsError("OBS_DISCONNECTED", "Connect OBS first.");
  }

  async status() {
    this.#checkConnection();
    const revision = this.revision;

    const [version, scene, streamStatus, sceneList, inputList] = await this.#awaitResponse(Promise.all([
      this.client.call("GetVersion"),
      this.client.call("GetCurrentProgramScene"),
      this.client.call("GetStreamStatus"),
      this.client.call("GetSceneList"),
      this.client.call("GetInputList")
    ]));
    this.#checkConnection(revision);
    if (typeof streamStatus.outputActive !== "boolean" || typeof streamStatus.outputReconnecting !== "boolean" ||
        typeof scene.currentProgramSceneName !== "string" || !Array.isArray(sceneList.scenes) ||
        !Array.isArray(inputList.inputs)) {
      throw obsError("OBS_REQUEST", "OBS returned an incomplete status.");
    }

    return {
      address: this.address,
      obsWebSocketVersion: version.obsWebSocketVersion,
      currentScene: scene.currentProgramSceneName,
      outputActive: streamStatus.outputActive,
      outputReconnecting: streamStatus.outputReconnecting,
      scenes: sceneList.scenes.map((item) => item?.sceneName).filter((name) => typeof name === "string"),
      inputs: inputList.inputs.slice(0, 12).map((item) => item?.inputName).filter((name) => typeof name === "string")
    };
  }

  async setStreaming(active, { confirm, assertAllowed } = {}) {
    if (typeof confirm !== "function" || typeof assertAllowed !== "function") {
      throw obsError("OBS_PERMISSION", "Broadcast changes require desktop confirmation.");
    }
    if (this.confirming) throw obsError("OBS_BUSY", "An OBS operation is already in progress.");
    this.confirming = true;
    try {
      assertAllowed();
      const revision = this.revision;
      const before = await this.status();
      if (before.outputReconnecting) throw obsError("OBS_CHANGED", "Wait for OBS to reconnect.");
      if (before.outputActive === active) return { outcome: "unchanged", data: before };
      assertAllowed();
      if (!(await confirm(before))) return { outcome: "cancelled", data: before };

      assertAllowed();
      this.#checkConnection(revision);
      const current = await this.status();
      if (current.currentScene !== before.currentScene || current.outputActive !== before.outputActive ||
          current.outputReconnecting) {
        throw obsError("OBS_CHANGED", "The scene or broadcast changed. Review the current state.");
      }
      this.#checkConnection(revision);
      assertAllowed();
      await this.#awaitResponse(this.client.call(active ? "StartStream" : "StopStream"));
      this.#checkConnection(revision);
      return { outcome: "requested", data: await this.status() };
    } finally {
      this.confirming = false;
    }
  }

  async switchScene(sceneName) {
    if (this.confirming) throw obsError("OBS_BUSY", "An OBS operation is already in progress.");
    this.#checkConnection();
    if (typeof sceneName !== "string" || !sceneName) throw obsError("OBS_REQUEST", "Choose an OBS scene.");
    await this.#awaitResponse(this.client.call("SetCurrentProgramScene", {
      sceneName
    }));
    return this.status();
  }
}

module.exports = {
  ObsService,
  formatObsConnectionError,
  OBS_TOOL_NAMES,
  OBS_ERRORS,
  DEFAULT_OBS_ADDRESS
};
