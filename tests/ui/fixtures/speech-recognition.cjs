function installSpeechFixture() {
  const sessions = [];
  window.jarvisVoiceFixture = {
    started: 0,
    aborted: 0,
    stopped: 0,
    deliver(index, text, repeats = 1) {
      const recognition = sessions[index];
      const result = Object.assign([{ transcript: text }], { isFinal: true });
      for (let repeat = 0; repeat < repeats; repeat++) {
        recognition.onresult?.({ resultIndex: 0, results: [result] });
      }
    },
  };

  class FixtureRecognition {
    start() {
      sessions.push(this);
      window.jarvisVoiceFixture.started++;
      queueMicrotask(() => this.onstart?.());
    }

    stop() {
      window.jarvisVoiceFixture.stopped++;
      queueMicrotask(() => this.onend?.());
    }

    abort() {
      window.jarvisVoiceFixture.aborted++;
      queueMicrotask(() => this.onend?.());
    }
  }

  window.SpeechRecognition = FixtureRecognition;
  window.speechSynthesis.speak = () => {};
}

function installWakeFixture({ availability = "downloadable", supportsDevice = true } = {}) {
  const sessions = [];
  const fixture = {
    downloads: [],
    starts: [],
    aborts: 0,
    deliver(index, transcript, isFinal = true) {
      const result = Object.assign([{ transcript }], { isFinal });
      sessions[index].onresult?.({ resultIndex: 0, results: [result] });
    },
    fail(index, error) { sessions[index].onerror?.({ error }); },
    end(index) { sessions[index].onend?.(); },
  };
  window.jarvisWakeFixture = fixture;
  class FixtureRecognition {
    constructor() {
      if (supportsDevice) this.processLocally = false;
    }
    start() {
      sessions.push(this);
      fixture.starts.push({ locale: this.lang, local: this.processLocally === true, continuous: this.continuous });
      queueMicrotask(() => this.onstart?.());
    }
    stop() { queueMicrotask(() => this.onend?.()); }
    abort() {
      fixture.aborts++;
      queueMicrotask(() => this.onend?.());
    }
  }
  if (supportsDevice) {
    FixtureRecognition.available = async () => availability;
    FixtureRecognition.install = async (options) => {
      fixture.downloads.push(options);
      availability = "available";
      return true;
    };
  }
  window.SpeechRecognition = FixtureRecognition;
}

module.exports = { installSpeechFixture, installWakeFixture };
