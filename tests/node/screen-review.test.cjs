const assert = require("node:assert/strict");
const { test } = require("node:test");
const { AssistantService } = require("../../src/main/assistant-service.cjs");
const { requiresComputerControl } = require("../../src/main/computer-control.cjs");
const { MAX_OCR_BYTES, ScreenService } = require("../../src/main/screen-service.cjs");

test("screen OCR passes only a buffer to the recognizer and returns a bounded text result", async () => {
  const mockImage = Buffer.from("fixture pixels");
  const calls = [];
  const prefix = "x".repeat(MAX_OCR_BYTES - 1);
  const service = new ScreenService({
    capture: async (options) => {
      assert.deepEqual(options, { format: "png" });
      return mockImage;
    },
    recognize: async (image, language) => {
      assert.strictEqual(image, mockImage);
      calls.push(language);
      if (language === "eng+kor") throw new Error("Fixture language data missing");
      return "  " + prefix + "끝\r\n";
    },
  });
  assert.deepEqual(await service.captureAndOcr(), { text: prefix, truncated: true });
  assert.deepEqual(calls, ["eng+kor", "eng"]);
});

test("screen OCR distinguishes empty text, capture denial and missing Tesseract", async () => {
  const mockImage = Buffer.from("fixture pixels");
  const empty = new ScreenService({ capture: async () => mockImage, recognize: async () => "\n  " });
  assert.deepEqual(await empty.captureAndOcr(), { text: "", truncated: false });
  const failed = new ScreenService({
    capture: async () => { throw new Error("Private OS failure"); },
    recognize: () => assert.fail("Cannot recognize an unavailable image"),
  });
  await assert.rejects(failed.captureAndOcr(), { code: "SCREEN_CAPTURE_FAILED" });
  let attempts = 0;
  const missing = new ScreenService({
    capture: async () => mockImage,
    recognize: async () => {
      attempts++;
      throw Object.assign(new Error("Private install path"), { code: "ENOENT" });
    },
  });
  await assert.rejects(missing.captureAndOcr(), { code: "OCR_NOT_INSTALLED" });
  assert.equal(attempts, 1);
});

test("summary and study requests provide review guidance without capturing or calling a model", async () => {
  assert.equal(requiresComputerControl("screen:ocr"), true);
  const computerControl = { enabled: false };
  const service = new AssistantService({ computerControl, screen: {
    captureAndOcr: () => assert.fail("Screen reading must start from the review UI"),
  } });
  service.routeInput = () => assert.fail("Do not call the classifier for exact screen requests");
  service.handleModelConversation = () => assert.fail("Do not send an exact screen request to the model");
  assert.match((await service.handleInput("화면 요약해줘")).reply, /컴퓨터 제어/);
  computerControl.enabled = true;
  assert.match((await service.handleInput("explain my screen")).reply, /review the recognized text/);
  assert.match((await service.executeRoute("화면 요약", { route: "screen_summary" })).reply, /로컬 도구/);
  assert.match((await service.executeRoute("Study the screen", { route: "screen_academic" })).reply, /Local tools/);
});
