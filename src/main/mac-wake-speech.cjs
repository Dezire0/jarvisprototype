const { execFile, spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { promisify } = require("node:util");

const run = promisify(execFile);
const locales = new Set(["ko-KR", "en-US"]);
const validId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const errors = new Set(["speech-permission", "microphone-permission", "audio-capture", "language-not-supported", "unavailable"]);

class MacWakeSpeech {
  constructor(binary, launch = spawn) {
    this.binary = binary;
    this.launch = launch;
    this.active = null;
  }

  async probe(locale) {
    if (!this.binary || !locales.has(locale)) return { status: "unavailable" };
    try {
      const { stdout } = await run(this.binary, ["--probe", locale], { timeout: 5000, maxBuffer: 1024 });
      return { status: JSON.parse(stdout).status === "available" ? "available" : "unavailable" };
    } catch {
      return { status: "unavailable" };
    }
  }

  start({ id, locale }, allowed, send) {
    if (!this.binary || typeof id !== "string" || !validId.test(id) || !locales.has(locale) || !allowed()) {
      return { ok: false, reason: "unavailable" };
    }
    if (this.active) return { ok: false, reason: "busy" };

    const child = this.launch(this.binary, ["--listen", locale], { stdio: ["pipe", "pipe", "ignore"] });
    const { promise, resolve } = Promise.withResolvers();
    const current = { id, child, promise, ready: false, stopping: false, deadline: null };
    this.active = current;
    // Some macOS window transitions do not emit BrowserWindow visibility events.
    current.visibilityCheck = setInterval(() => {
      if (!allowed()) void this.stop(id);
    }, 250);
    current.visibilityCheck.unref();
    const lines = createInterface({ input: child.stdout });
    function emit(payload) {
      if (allowed()) send({ id, ...payload });
    }
    const fail = (reason) => {
      if (current.stopping) return;
      emit({ type: "error", reason });
      void this.stop(id);
    };
    lines.on("line", (line) => {
      if (current.stopping) return;
      if (!allowed()) {
        void this.stop(id);
        return;
      }
      let message;
      try {
        message = line.length <= 12000 ? JSON.parse(line) : null;
      } catch {
        fail("unavailable");
        return;
      }
      if (message?.type === "ready" && !current.ready) {
        current.ready = true;
        emit({ type: "ready" });
      } else if (message?.type === "transcript" && current.ready && typeof message.text === "string" && message.text.trim()) {
        emit({ type: "transcript", text: message.text.slice(0, 2400) });
      } else if (message?.type === "error") {
        fail(errors.has(message.reason) ? message.reason : "unavailable");
      } else {
        fail("unavailable");
      }
    });
    child.stdin.on("error", () => {});
    child.once("error", () => fail("unavailable"));
    child.once("close", () => {
      clearInterval(current.visibilityCheck);
      clearTimeout(current.deadline);
      lines.close();
      if (this.active === current) this.active = null;
      if (!current.stopping) emit({ type: "error", reason: "unavailable" });
      send({ id, type: "end" });
      resolve();
    });
    return { ok: true };
  }

  async stop(id) {
    const current = this.active;
    if (!current || (id !== undefined && current.id !== id)) return;
    if (!current.stopping) {
      current.stopping = true;
      clearInterval(current.visibilityCheck);
      current.child.stdin.end();
      current.deadline = setTimeout(() => current.child.kill("SIGKILL"), 1200);
      current.deadline.unref();
    }
    await current.promise;
  }
}

module.exports = { MacWakeSpeech };
