import type { AttachmentAdapter, PendingAttachment } from "@assistant-ui/react";
import contract from "../../../../src/main/assistant/attachment-contract.json";

type FileContent = { name: string } & (
  | { kind: "text"; text: string }
  | { kind: "image"; mimeType: string; data: string }
);

export const attachmentPrefix = contract.prefix;
export const attachmentFileTypes = [
  ...contract.textExtensions, ...Object.keys(contract.imageExtensions),
].map((extension) => "." + extension).join(",");
export type AttachmentError = "format" | "limit" | "read";

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reader.onabort = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export function createChatAttachmentAdapter(onError: (error: AttachmentError) => void): AttachmentAdapter {
  const pending = new Map<string, { size: number; content?: FileContent }>();
  const images: Readonly<Record<string, string>> = contract.imageExtensions;

  function reject(reason: AttachmentError): never {
    onError(reason);
    throw new Error("The file could not be attached.");
  }

  return {
    accept: "*",
    async *add({ file }): AsyncGenerator<PendingAttachment, void> {
      const extension = file.name.includes(".") ? file.name.split(".").at(-1)!.toLowerCase() : "";
      const mimeType = Object.hasOwn(images, extension) ? images[extension] : undefined;
      if (!mimeType && !contract.textExtensions.includes(extension)) reject("format");
      const max = mimeType ? contract.maxImageBytes : contract.maxTextBytes;
      const total = Array.from(pending.values()).reduce((sum, attachment) => sum + attachment.size, file.size);
      if (!file.size || file.size > max || total > contract.maxTotalBytes ||
          pending.size >= contract.maxFiles || file.name.length > contract.maxNameLength) reject("limit");

      const id = crypto.randomUUID();
      const entry: { size: number; content?: FileContent } = { size: file.size };
      pending.set(id, entry);
      const base = { id, name: file.name, type: mimeType ? "image" : "document", file };
      yield { ...base, status: { type: "running", reason: "uploading", progress: 0 } };

      try {
        if (mimeType) {
          const data = (await readDataUrl(file)).split(",")[1];
          if (!data) throw new Error("Image was empty");
          entry.content = { kind: "image", name: file.name, mimeType, data };
        } else {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
          if (!text.trim() || text.includes("\0")) throw new Error("File is not UTF-8 text");
          entry.content = { kind: "text", name: file.name, text };
        }
      } catch {
        if (!pending.delete(id)) return;
        reject("read");
      }

      if (pending.has(id)) yield { ...base, status: { type: "requires-action", reason: "composer-send" } };
    },
    async remove(attachment) {
      pending.delete(attachment.id);
    },
    async send(attachment) {
      const entry = pending.get(attachment.id);
      pending.delete(attachment.id);
      return {
        ...attachment,
        status: { type: "complete" },
        content: [{ type: "text", text: attachmentPrefix + JSON.stringify(entry?.content ?? null) }],
      };
    },
  };
}

export function readAttachmentLabel(text: string) {
  if (!text.startsWith(attachmentPrefix)) return null;
  try {
    const data = JSON.parse(text.slice(attachmentPrefix.length));
    return typeof data?.name === "string" ? data.name.slice(0, contract.maxNameLength) : null;
  } catch {
    return null;
  }
}
