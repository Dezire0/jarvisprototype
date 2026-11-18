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

module.exports = { installSpeechFixture };
