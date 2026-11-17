import type { PDFPageProxy } from "pdfjs-dist";
import contract from "../../../../src/main/assistant/attachment-contract.json";

export type PdfText = {
  pageCount: number;
  pages: { page: number; text: string }[];
};

export type PdfReadProblem = "pdf-password" | "pdf-no-text" | "pdf-limit" | "pdf-timeout";

export class PdfReadError extends Error {
  constructor(readonly problem: PdfReadProblem) {
    super(problem);
  }
}

const READ_TIMEOUT_MS = 8_000;
const encoder = new TextEncoder();
type TextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

async function readPageText(page: PDFPageProxy, remainingBytes: number) {
  const reader = page.streamTextContent().getReader();
  const pieces: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const item of (value as TextContent).items) {
        if (!("str" in item)) continue;
        const text = item.str.replaceAll("\0", "");
        const piece = text + (item.hasEOL ? "\n" : text ? " " : "");
        bytes += encoder.encode(piece).byteLength;
        if (bytes > remainingBytes) throw new PdfReadError("pdf-limit");
        if (piece) pieces.push(piece);
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return { text: pieces.join("").trim(), bytes };
}

export async function extractPdfText(file: File, signal: AbortSignal): Promise<PdfText> {
  const pdf = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  if (!new TextDecoder().decode(data.subarray(0, 1024)).includes("%PDF-")) {
    throw new Error("Invalid PDF header.");
  }

  const assetUrl = new URL("/pdf-assets/", window.location.origin);
  const browserWorker = new Worker(new URL("pdf.worker.mjs", assetUrl), { type: "module" });
  const worker = pdf.PDFWorker.create({ port: browserWorker });
  const task = pdf.getDocument({
    data,
    worker,
    cMapUrl: assetUrl.href,
    standardFontDataUrl: assetUrl.href,
    useWorkerFetch: true,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    useWasm: false,
    stopAtErrors: true,
    verbosity: pdf.VerbosityLevel.ERRORS,
  });

  const aborted = AbortSignal.any([signal, AbortSignal.timeout(READ_TIMEOUT_MS)]);
  const stop = new Promise<never>((_, reject) => {
    if (aborted.aborted) reject(new PdfReadError("pdf-timeout"));
    else aborted.addEventListener("abort", () => reject(new PdfReadError("pdf-timeout")), { once: true });
    browserWorker.addEventListener("error", () => reject(new Error("PDF worker unavailable.")), { once: true });
  });
  async function readDocument() {
    const doc = await task.promise;
    if (!doc.numPages || doc.numPages > contract.maxPdfPages) throw new PdfReadError("pdf-limit");
    const pages: PdfText["pages"] = [];
    let remainingBytes = contract.maxTextBytes;
    for (let page = 1; page <= doc.numPages; page++) {
      const sourcePage = await doc.getPage(page);
      const { text, bytes } = await readPageText(sourcePage, remainingBytes);
      sourcePage.cleanup();
      remainingBytes -= bytes;
      if (text) pages.push({ page, text });
    }
    if (!pages.length) throw new PdfReadError("pdf-no-text");
    return { pageCount: doc.numPages, pages };
  }

  try {
    return await Promise.race([readDocument(), stop]);
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new PdfReadError("pdf-password");
    }
    throw error;
  } finally {
    void task.destroy().catch(() => {});
    worker.destroy();
    browserWorker.terminate();
  }
}
