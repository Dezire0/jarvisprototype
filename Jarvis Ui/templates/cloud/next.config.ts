import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
  outputFileTracingIncludes: {
    "/pdf-assets/*": [
      "./node_modules/pdfjs-dist/package.json",
      "./node_modules/pdfjs-dist/LICENSE",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      "./node_modules/pdfjs-dist/cmaps/*",
      "./node_modules/pdfjs-dist/standard_fonts/*",
    ],
  },
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
