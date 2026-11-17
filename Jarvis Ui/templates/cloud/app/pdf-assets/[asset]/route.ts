import { readFile } from "node:fs/promises";
import path from "node:path";

function assetPath(name: string) {
  if (name === "pdf.worker.mjs") {
    return { file: "legacy/build/pdf.worker.min.mjs", type: "text/javascript; charset=utf-8" };
  }
  if (/^[A-Za-z0-9_-]+\.bcmap$/.test(name)) {
    return { file: "cmaps/" + name, type: "application/octet-stream" };
  }
  if (/^(?:Foxit|LiberationSans)[A-Za-z-]+\.(?:pfb|ttf)$/.test(name)) {
    return { file: "standard_fonts/" + name, type: "application/octet-stream" };
  }
  return null;
}

export async function GET(_request: Request, context: { params: Promise<{ asset: string }> }) {
  const { asset } = await context.params;
  const match = assetPath(asset);
  if (!match) return new Response(null, { status: 404 });

  try {
    const root = path.join(process.cwd(), "node_modules", "pdfjs-dist");
    const bytes = await readFile(path.join(root, match.file));
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": match.type,
      "Cache-Control": "public, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; connect-src 'self'",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
