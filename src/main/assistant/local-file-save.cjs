const { maxTextBytes } = require("./attachment-contract.json");

function validPath(value) {
  return typeof value === "string" && Boolean(value.trim()) && value.length <= 4096 &&
    !/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/u.test(value);
}

function createLocalFileSaver({ confirmReplacement }) {
  let saving = false;
  return async function saveLocalFile(files, payload, assertAllowed) {
    const { path, content, language } = payload || {};
    const failure = (reason) => ({ ok: false, reason });
    if (saving) return failure("busy");
    if (!validPath(path) || typeof content !== "string" || content.includes("\0") ||
        Buffer.byteLength(content, "utf8") > maxTextBytes) return failure("invalid");

    saving = true;
    try {
      assertAllowed();
      const existing = await files.existingFileForWrite(path);
      if (!existing) {
        return { ok: true, data: await files.writeFile(path, content, { assertAllowed }) };
      }
      if (!validPath(existing.path)) return failure("unsupported");
      assertAllowed();
      if (!(await confirmReplacement(existing.path, language === "ko"))) return failure("cancelled");
      assertAllowed();
      return { ok: true, data: await files.replaceFile(existing, content, assertAllowed) };
    } catch (error) {
      if (error.code === "EEXIST" || error.code === "FILE_CHANGED") return failure("conflict");
      if (error.code === "FILE_UNSUPPORTED" || error.code === "ENOTDIR") return failure("unsupported");
      if (error.code === "FILE_PERMISSION_CHANGED") return failure("permission");
      return failure("failed");
    } finally {
      saving = false;
    }
  };
}

module.exports = { createLocalFileSaver };
