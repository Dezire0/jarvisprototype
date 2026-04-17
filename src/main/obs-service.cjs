const { OBSWebSocket } = require("obs-websocket-js");

function formatObsConnectionError(error, address) {
  const message = String(error?.message || error || "").trim();

  if (/ECONNREFUSED|couldn't connect|failed to connect/i.test(message)) {
    return `Could not reach OBS WebSocket at ${address}. Make sure OBS is running and WebSocket Server is enabled on that address.`;
  }

  if (/authentication|invalid password|identify failed|4009/i.test(message)) {
    return `OBS rejected the WebSocket password for ${address}. Check the password in OBS WebSocket Server Settings.`;
  }

  return message || `OBS connection failed for ${address}.`;
}

class ObsService {
  constructor() {
    this.client = new OBSWebSocket();
    this.connected = false;
    this.connectionInfo = {
      address: "ws://127.0.0.1:4455"
    };

    this.client.on("ConnectionClosed", () => {
      this.connected = false;
    });
  }

  async connect({ address = "ws://127.0.0.1:4455", password = "" } = {}) {
    try {
      const result = await this.client.connect(address, password || undefined);
      this.connected = true;
      this.connectionInfo = {
        address
      };

      return {
        address,
        obsWebSocketVersion: result.obsWebSocketVersion,
        negotiatedRpcVersion: result.negotiatedRpcVersion
      };
    } catch (error) {
      this.connected = false;
      throw new Error(formatObsConnectionError(error, address));
    }
  }

  async ensureConnection() {
    if (!this.connected) {
      throw new Error("OBS is not connected yet. Use the connect action first.");
    }
  }

  async status() {
    await this.ensureConnection();

    const [version, scene, streamStatus, sceneList, inputList] = await Promise.all([
      this.client.call("GetVersion"),
      this.client.call("GetCurrentProgramScene"),
      this.client.call("GetStreamStatus"),
      this.client.call("GetSceneList"),
      this.client.call("GetInputList")
    ]);

    return {
      address: this.connectionInfo.address,
      obsWebSocketVersion: version.obsWebSocketVersion,
      currentScene: scene.currentProgramSceneName,
      outputActive: streamStatus.outputActive,
      outputReconnecting: streamStatus.outputReconnecting,
      scenes: sceneList.scenes.map((item) => item.sceneName),
      inputs: inputList.inputs.slice(0, 12).map((item) => item.inputName)
    };
  }

  async startStream() {
    await this.ensureConnection();
    await this.client.call("StartStream");
    return this.status();
  }

  async stopStream() {
    await this.ensureConnection();
    await this.client.call("StopStream");
    return this.status();
  }

  async switchScene(sceneName) {
    await this.ensureConnection();
    await this.client.call("SetCurrentProgramScene", {
      sceneName
    });
    return this.status();
  }
}

module.exports = {
  ObsService,
  formatObsConnectionError
};
