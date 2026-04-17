import { Assistant } from "./assistant";
import { DownloadLanding } from "./download-landing";

export default function Home() {
  if (
    String(process.env.NEXT_PUBLIC_JARVIS_SITE_MODE || "").trim().toLowerCase() ===
    "download"
  ) {
    return <DownloadLanding />;
  }

  return <Assistant />;
}
