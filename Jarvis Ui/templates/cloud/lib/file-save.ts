import { parseLocalFileWrite } from "../../../../src/main/assistant/local-file-command.cjs";
import attachmentContract from "../../../../src/main/assistant/attachment-contract.json";

export type FileSaveDraft = { path: string; content: string };
export const MAX_FILE_SAVE_BYTES = attachmentContract.maxTextBytes;

export function resolveFileSaveCommand(input: string, hasAttachmentsOrQuote: boolean): FileSaveDraft | null {
  if (hasAttachmentsOrQuote) return null;
  return parseLocalFileWrite(input);
}
