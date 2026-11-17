const contract = require("./attachment-contract.json");

function normalizeFileName(name) {
  if (typeof name !== "string") return "";
  return name.replace(/[\u0000-\u001f\u007f]/g, "").split(/[\\/]/).at(-1).trim().slice(0, contract.maxNameLength);
}

function readImage(mimeType, data) {
  if (!Object.values(contract.imageExtensions).includes(mimeType) ||
      typeof data !== "string" || !data || data.length > 4 * Math.ceil(contract.maxImageBytes / 3)) {
    return null;
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > contract.maxImageBytes || bytes.toString("base64") !== data) return null;

  const matches = {
    "image/png": bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
    "image/jpeg": bytes.subarray(0, 3).toString("hex") === "ffd8ff",
    "image/webp": bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  };
  return matches[mimeType] ? { data, mimeType, size: bytes.length } : null;
}

function readPdfPages(value) {
  const { pageCount, pages } = value;
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > contract.maxPdfPages ||
      !Array.isArray(pages) || !pages.length || pages.length > pageCount) return null;

  let size = 0;
  let previousPage = 0;
  const readablePages = [];
  for (const entry of pages) {
    const { page, text } = entry ?? {};
    if (!Number.isSafeInteger(page) || page <= previousPage || page > pageCount ||
        typeof text !== "string" || !text.trim() || text.includes("\0")) return null;
    size += Buffer.byteLength(text, "utf8");
    if (size > contract.maxTextBytes) return null;
    readablePages.push({ page, text });
    previousPage = page;
  }

  return { pageCount, pages: readablePages, size };
}

function readFilePart(value) {
  const name = normalizeFileName(value?.name);
  if (!name) return null;
  const extension = name.split(".").at(-1).toLowerCase();

  if (value.kind === "text" && contract.textExtensions.includes(extension) &&
      typeof value.text === "string" && value.text.trim() && !value.text.includes("\0")) {
    const size = Buffer.byteLength(value.text, "utf8");
    return size <= contract.maxTextBytes ? { kind: "text", name, text: value.text, size } : null;
  }

  if (value.kind === "image" && Object.hasOwn(contract.imageExtensions, extension) &&
      contract.imageExtensions[extension] === value.mimeType) {
    const image = readImage(value.mimeType, value.data);
    return image ? { kind: "image", name, ...image } : null;
  }

  if (value.kind === "pdf" && extension === "pdf") {
    const document = readPdfPages(value);
    return document ? { kind: "pdf", name, ...document } : null;
  }
  return null;
}

function parseAssistantInput(commands) {
  for (const command of commands) {
    if (command?.type !== "add-message" || command?.message?.role !== "user") continue;
    const parts = Array.isArray(command.message.parts) ? command.message.parts : [];
    const text = [];
    const attachments = [];
    let bytes = 0;
    for (const part of parts) {
      let file;
      if (part?.type === "text" && typeof part.text === "string") {
        if (!part.text.startsWith(contract.prefix)) {
          text.push(part.text);
          continue;
        }
        try {
          file = readFilePart(JSON.parse(part.text.slice(contract.prefix.length)));
        } catch {
          file = null;
        }
      } else if (part?.type === "image") {
        const url = typeof part.image === "string" ? part.image : "";
        const match = /^data:(image\/(?:png|jpeg|webp));base64,([^,]+)$/.exec(url);
        const image = match ? readImage(match[1], match[2]) : null;
        file = image ? { kind: "image", name: "Clipboard image", ...image } : null;
      } else {
        continue;
      }
      if (!file) throw new Error("An attachment is invalid or exceeds the file limit.");
      bytes += file.size;
      attachments.push(file);
      if (bytes > contract.maxTotalBytes || attachments.length > contract.maxFiles) {
        throw new Error("The attachments exceed the message limit.");
      }
    }
    const request = text.join("\n").trim();
    if (request || attachments.length) return { text: request, attachments };
  }
  return { text: "", attachments: [] };
}

module.exports = { normalizeFileName, parseAssistantInput };
