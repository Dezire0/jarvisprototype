export function speakLocalResult(text: string, language: string, interrupt = true) {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language;
  if (interrupt) window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}
