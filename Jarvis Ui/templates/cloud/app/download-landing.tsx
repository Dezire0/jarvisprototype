type DownloadLink = {
  platform: string;
  format: string;
  href: string;
  tagline: string;
  hint: string;
};

function readEnv(name: string) {
  return String(process.env[name] || "").trim();
}

function buildDownloads(): DownloadLink[] {
  return [
    {
      platform: "Windows",
      format: ".exe",
      href: readEnv("NEXT_PUBLIC_JARVIS_WINDOWS_DOWNLOAD_URL"),
      tagline: "One-click installer",
      hint: "Best for most users. Built from the Electron desktop shell."
    },
    {
      platform: "macOS",
      format: ".dmg",
      href: readEnv("NEXT_PUBLIC_JARVIS_MAC_DOWNLOAD_URL"),
      tagline: "Desktop app for Mac",
      hint: "If the build is unsigned, macOS may ask you to confirm opening it manually."
    },
    {
      platform: "Linux",
      format: ".AppImage",
      href: readEnv("NEXT_PUBLIC_JARVIS_LINUX_DOWNLOAD_URL"),
      tagline: "Portable desktop build",
      hint: "Good for direct downloads without an installer store."
    }
  ];
}

export function DownloadLanding() {
  const downloads = buildDownloads();
  const hasDownload = downloads.some((item) => Boolean(item.href));
  const releaseNotesUrl = readEnv("NEXT_PUBLIC_JARVIS_RELEASE_NOTES_URL");

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(68,211,195,0.2),transparent_35%),linear-gradient(160deg,#03131a_0%,#071d24_38%,#0b0f14_100%)] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-10 sm:px-10 lg:px-12">
        <div className="rounded-full border border-white/15 bg-white/6 px-4 py-1 text-xs tracking-[0.3em] text-cyan-200 uppercase backdrop-blur">
          Jarvis Desktop Distribution
        </div>

        <section className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-7">
            <div className="space-y-4">
              <p className="text-sm font-medium text-cyan-200/90">
                Website - Download - Install - Launch
              </p>
              <h1 className="max-w-4xl font-sans text-5xl leading-none font-semibold tracking-[-0.05em] text-white sm:text-6xl lg:text-7xl">
                Download Jarvis like a real desktop product.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                Open the website, click Download, install the app, and run it.
                The desktop runtime stays on Electron so we keep Windows and Mac
                packaging simple while reusing the web stack you already have.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              {downloads.map((item) => {
                if (!item.href) {
                  return (
                    <span
                      key={item.platform}
                      className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm text-slate-300"
                    >
                      {item.platform} coming soon
                    </span>
                  );
                }

                return (
                  <a
                    key={item.platform}
                    href={item.href}
                    className="inline-flex items-center gap-3 rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
                  >
                    <span>Download for {item.platform}</span>
                    <span className="rounded-full bg-slate-950/10 px-2 py-0.5 text-xs">
                      {item.format}
                    </span>
                  </a>
                );
              })}

              {releaseNotesUrl ? (
                <a
                  href={releaseNotesUrl}
                  className="inline-flex items-center rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-white/90 transition hover:border-white/35 hover:bg-white/6"
                >
                  Release Notes
                </a>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur">
                <p className="text-xs uppercase tracking-[0.22em] text-cyan-200">
                  Platform
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                  Electron
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  One codebase for desktop packaging, auto-update hooks, and
                  your current UI.
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur">
                <p className="text-xs uppercase tracking-[0.22em] text-cyan-200">
                  Packaging
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                  .exe / .dmg
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Windows and macOS installers can be linked directly from your
                  website.
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur">
                <p className="text-xs uppercase tracking-[0.22em] text-cyan-200">
                  Update Path
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                  Direct download
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Host releases on GitHub or any HTTPS file host. No Supabase
                  requirement.
                </p>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -left-10 top-8 h-40 w-40 rounded-full bg-cyan-300/15 blur-3xl" />
            <div className="absolute bottom-0 right-0 h-52 w-52 rounded-full bg-emerald-300/10 blur-3xl" />

            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/65 p-6 shadow-[0_30px_120px_rgba(0,0,0,0.45)] backdrop-blur">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <p className="text-sm font-medium text-white">Download Flow</p>
                  <p className="text-xs text-slate-400">
                    Website-first desktop distribution
                  </p>
                </div>
                <div className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-200">
                  Live
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <div className="rounded-2xl bg-white/[0.04] p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    Step 1
                  </p>
                  <p className="mt-2 text-lg font-medium text-white">
                    User lands on your website
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Give them one clear call to action instead of asking them to
                    run commands locally.
                  </p>
                </div>
                <div className="rounded-2xl bg-white/[0.04] p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    Step 2
                  </p>
                  <p className="mt-2 text-lg font-medium text-white">
                    Click Download
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Platform-specific buttons send users straight to the latest
                    `.exe`, `.dmg`, or `.AppImage`.
                  </p>
                </div>
                <div className="rounded-2xl bg-white/[0.04] p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    Step 3
                  </p>
                  <p className="mt-2 text-lg font-medium text-white">
                    Install and run Jarvis Desktop
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    The installed app opens the packaged Electron shell with the
                    bundled Jarvis UI already inside.
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-3">
                {downloads.map((item) => (
                  <div
                    key={item.platform}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {item.platform}
                        </p>
                        <p className="mt-1 text-xs text-cyan-200">
                          {item.tagline}
                        </p>
                      </div>
                      <div className="rounded-full border border-white/12 px-3 py-1 text-xs text-slate-300">
                        {item.format}
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      {item.hint}
                    </p>
                    <div className="mt-4">
                      {item.href ? (
                        <a
                          href={item.href}
                          className="inline-flex items-center rounded-full border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-200/45 hover:bg-cyan-300/15"
                        >
                          Open download
                        </a>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-white/10 px-4 py-2 text-sm text-slate-400">
                          Link not configured yet
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <footer className="border-t border-white/10 pt-6 text-sm text-slate-400">
          {hasDownload
            ? "Wire these buttons to your hosted release files and the site is ready to act like a real download page."
            : "Set NEXT_PUBLIC_JARVIS_*_DOWNLOAD_URL values at build time to activate the download buttons."}
        </footer>
      </div>
    </main>
  );
}
