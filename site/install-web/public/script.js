(function () {
  const rawConfig = window.JARVIS_INSTALL_CONFIG || {};
  const knownPlatforms = ["macOS", "Windows", "Linux"];
  const themeStorageKey = "jarvis-install-theme-v1";
  const consentStorageKey = "jarvis-install-consent-v3";
  const mediaQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;

  const platformCopy = {
    macOS: {
      availableLabel: "지금 바로 기본 설치 파일을 받을 수 있습니다.",
      pendingLabel: "macOS 빌드는 곧 공개됩니다.",
      preview:
        "Apple Silicon 기준으로 가장 먼저 준비된 데스크톱 설치 경험입니다.",
      checklist: [
        "다운로드한 파일을 열고 Jarvis를 Applications로 옮깁니다.",
        "처음 실행 후 마이크, 접근성, 자동화 권한을 확인합니다.",
        "평소 사용하는 로그인된 브라우저 프로필을 그대로 유지하면 더 자연스럽게 동작합니다.",
      ],
    },
    Windows: {
      availableLabel: "Windows 기본 설치 파일로 바로 이어집니다.",
      pendingLabel: "Windows 빌드는 준비 중입니다.",
      preview:
        "Windows용 런처와 설치 흐름이 준비되는 대로 바로 연결됩니다.",
      checklist: [
        "설치 마법사를 실행하고 안내에 따라 설치를 마칩니다.",
        "마이크와 브라우저 관련 권한 요청이 나타나면 허용합니다.",
        "Chrome 또는 Edge 로그인 상태를 유지하면 웹 작업 품질이 올라갑니다.",
      ],
    },
    Linux: {
      availableLabel: "Linux 기본 배포 파일로 바로 이어집니다.",
      pendingLabel: "Linux 빌드는 준비 중입니다.",
      preview:
        "휴대용 배포본 또는 패키지형 배포본이 준비되면 이곳에서 시작할 수 있습니다.",
      checklist: [
        "다운로드한 파일에 실행 권한을 부여합니다.",
        "오디오 장치와 브라우저 경로를 확인합니다.",
        "배포판에 따라 필요한 추가 설정이 있다면 릴리즈 노트를 먼저 확인합니다.",
      ],
    },
  };

  const elements = {
    themeToggle: document.getElementById("theme-toggle"),
    themeColorMeta: document.getElementById("theme-color-meta"),
    heroMeta: document.getElementById("hero-meta"),
    heroVersion: document.getElementById("hero-version"),
    releaseNotesLink: document.getElementById("release-notes-link"),
    supportedPlatformCount: document.getElementById("supported-platform-count"),
    featuredPlatform: document.getElementById("featured-platform"),
    featuredPlatformHint: document.getElementById("featured-platform-hint"),
    platformPreviewGrid: document.getElementById("platform-preview-grid"),
    downloadPageMeta: document.getElementById("download-page-meta"),
    downloadPlatformGrid: document.getElementById("download-platform-grid"),
    agreementPanel: document.getElementById("agreement-panel"),
  };

  const state = {
    theme: "light",
    hasStoredTheme: false,
    selectedPlatform: "",
    panelOpen: false,
    agreements: {
      terms: false,
      privacy: false,
      permissions: false,
    },
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function inferFormatFromHref(href) {
    try {
      const url = new URL(String(href || ""), window.location.href);
      const filename = url.pathname.split("/").pop() || "";
      const dotIndex = filename.lastIndexOf(".");
      return dotIndex >= 0 ? filename.slice(dotIndex) : "";
    } catch (_error) {
      return "";
    }
  }

  function normalizeDownloads(config) {
    const legacyDownloads = [
      {
        platform: "Windows",
        href: String(config.windowsDownloadUrl || "").trim(),
        format: ".exe",
        architecture: "x64",
        recommended: true,
      },
      {
        platform: "macOS",
        href: String(config.macDownloadUrl || "").trim(),
        format: ".dmg",
        architecture: "Apple Silicon",
        recommended: true,
      },
      {
        platform: "Linux",
        href: String(config.linuxDownloadUrl || "").trim(),
        format: ".AppImage",
        architecture: "x64",
        recommended: true,
      },
    ].filter((item) => item.href);

    const source =
      Array.isArray(config.downloads) && config.downloads.length > 0
        ? config.downloads
        : legacyDownloads;

    return source
      .map((item, index) => {
        const platform = knownPlatforms.includes(item?.platform)
          ? item.platform
          : "";
        const href = String(item?.href || "").trim();
        if (!platform || !href) {
          return null;
        }

        return {
          id: `${platform}-${index}`,
          platform,
          href,
          format: String(item?.format || "").trim() || inferFormatFromHref(href),
          architecture: String(item?.architecture || "").trim(),
          recommended: Boolean(item?.recommended),
        };
      })
      .filter(Boolean);
  }

  function buildPlatforms(downloads) {
    return knownPlatforms.map((platform) => {
      const primary = getPrimaryDownload(platform, downloads);
      const copy = platformCopy[platform];
      return {
        platform,
        available: Boolean(primary?.href),
        message: primary?.href ? copy.availableLabel : copy.pendingLabel,
      };
    });
  }

  function getPrimaryDownload(platform, downloads = config.downloads) {
    const platformDownloads = downloads.filter((item) => item.platform === platform);
    return (
      platformDownloads.find((item) => item.recommended) ||
      platformDownloads[0] ||
      null
    );
  }

  function getStoredTheme() {
    try {
      const stored = window.localStorage.getItem(themeStorageKey);
      if (stored === "light" || stored === "dark") {
        return stored;
      }
    } catch (_error) {
      // Ignore storage failures and use system theme.
    }

    return "";
  }

  function getSystemTheme() {
    return mediaQuery?.matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    state.theme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = state.theme;

    if (elements.themeColorMeta) {
      elements.themeColorMeta.setAttribute(
        "content",
        state.theme === "dark" ? "#050507" : "#f5f5f7",
      );
    }

    if (elements.themeToggle) {
      elements.themeToggle.setAttribute(
        "aria-label",
        state.theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      );
    }
  }

  function initializeTheme() {
    const storedTheme = getStoredTheme();
    state.hasStoredTheme = Boolean(storedTheme);
    applyTheme(storedTheme || getSystemTheme());
  }

  function toggleTheme() {
    const nextTheme = state.theme === "dark" ? "light" : "dark";
    state.hasStoredTheme = true;
    applyTheme(nextTheme);

    try {
      window.localStorage.setItem(themeStorageKey, nextTheme);
    } catch (_error) {
      // Ignore storage failures.
    }
  }

  function detectPlatform() {
    const source = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
    if (source.includes("mac")) {
      return "macOS";
    }
    if (source.includes("win")) {
      return "Windows";
    }
    if (source.includes("linux")) {
      return "Linux";
    }
    return "";
  }

  function saveAgreements() {
    try {
      window.localStorage.setItem(
        consentStorageKey,
        JSON.stringify(state.agreements),
      );
    } catch (_error) {
      // Ignore storage failures.
    }
  }

  function restoreAgreements() {
    try {
      const raw = window.localStorage.getItem(consentStorageKey);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);
      state.agreements.terms = Boolean(parsed.terms);
      state.agreements.privacy = Boolean(parsed.privacy);
      state.agreements.permissions = Boolean(parsed.permissions);
    } catch (_error) {
      // Ignore invalid storage values.
    }
  }

  function allConsentsAccepted() {
    return (
      state.agreements.terms &&
      state.agreements.privacy &&
      state.agreements.permissions
    );
  }

  function getPlatformSummary(platform) {
    return config.platforms.find((item) => item.platform === platform) || null;
  }

  function getFirstAvailablePlatform() {
    return (
      config.platforms.find((item) => item.available)?.platform ||
      knownPlatforms[0]
    );
  }

  function getPlatformRoute(platform) {
    if (!platform) {
      return "./downloads.html";
    }

    return `./downloads.html?platform=${encodeURIComponent(platform)}#agreement-panel`;
  }

  function getRequestedPlatform() {
    const url = new URL(window.location.href);
    const rawPlatform = url.searchParams.get("platform") || "";
    return knownPlatforms.find((item) => item === rawPlatform) || "";
  }

  function renderReleaseNotesLink() {
    if (!elements.releaseNotesLink) {
      return;
    }

    if (!config.releaseNotesUrl) {
      elements.releaseNotesLink.hidden = true;
      return;
    }

    elements.releaseNotesLink.hidden = false;
    elements.releaseNotesLink.href = config.releaseNotesUrl;
  }

  function renderOverviewPage() {
    const availablePlatforms = config.platforms.filter((item) => item.available);
    const detectedPlatform = detectPlatform();
    const featuredPlatform =
      (detectedPlatform && getPrimaryDownload(detectedPlatform) && detectedPlatform) ||
      getFirstAvailablePlatform();
    const featuredSummary = getPlatformSummary(featuredPlatform);

    if (elements.supportedPlatformCount) {
      elements.supportedPlatformCount.textContent = String(availablePlatforms.length);
    }

    if (elements.heroVersion) {
      elements.heroVersion.textContent = `v${config.version}`;
    }

    if (elements.featuredPlatform) {
      elements.featuredPlatform.textContent = featuredPlatform;
    }

    if (elements.featuredPlatformHint) {
      elements.featuredPlatformHint.textContent =
        featuredSummary?.message || "가장 먼저 준비된 플랫폼이 여기에 표시됩니다.";
    }

    if (elements.heroMeta) {
      const pills = [
        "Voice First",
        "Browser Control",
        `${availablePlatforms.length} Platforms Ready`,
      ];
      elements.heroMeta.innerHTML = pills
        .map((pill) => `<span class="meta-pill">${escapeHtml(pill)}</span>`)
        .join("");
    }

    if (elements.platformPreviewGrid) {
      elements.platformPreviewGrid.innerHTML = config.platforms
        .map((summary) => {
          const copy = platformCopy[summary.platform];
          return `
            <article class="platform-preview-card ${summary.available ? "is-available" : "is-pending"}">
              <div class="platform-preview-topline">
                <p class="surface-label">${escapeHtml(summary.platform)}</p>
                <span class="status-pill ${summary.available ? "available" : "pending"}">
                  ${summary.available ? "Download Ready" : "Coming Soon"}
                </span>
              </div>
              <h3 class="platform-preview-title">${escapeHtml(summary.platform)} 다운로드</h3>
              <p class="platform-preview-copy">${escapeHtml(
                summary.available ? copy.preview : copy.pendingLabel,
              )}</p>
              <a
                class="cta ${summary.available ? "cta-primary" : "cta-secondary"}"
                href="${escapeHtml(getPlatformRoute(summary.platform))}"
              >
                ${summary.available ? "무료 다운로드하기" : "준비 상태 보기"}
              </a>
            </article>
          `;
        })
        .join("");
    }
  }

  function renderDownloadPageMeta() {
    if (!elements.downloadPageMeta) {
      return;
    }

    const pills = [
      "macOS",
      "Windows",
      "Linux",
      `Public v${config.version}`,
    ];

    elements.downloadPageMeta.innerHTML = pills
      .map((pill) => `<span class="meta-pill">${escapeHtml(pill)}</span>`)
      .join("");
  }

  function renderDownloadPlatformGrid() {
    if (!elements.downloadPlatformGrid) {
      return;
    }

    elements.downloadPlatformGrid.innerHTML = config.platforms
      .map((summary) => {
        const selectedClass =
          state.selectedPlatform === summary.platform ? "is-selected" : "";
        const availabilityClass = summary.available ? "is-available" : "is-pending";

        return `
          <button
            type="button"
            class="download-platform-card ${selectedClass} ${availabilityClass}"
            data-platform="${escapeHtml(summary.platform)}"
          >
            <div class="download-platform-card-top">
              <p class="surface-label">${escapeHtml(summary.platform)}</p>
              <span class="status-pill ${summary.available ? "available" : "pending"}">
                ${summary.available ? "Ready" : "Soon"}
              </span>
            </div>
            <h3 class="download-platform-title">${escapeHtml(summary.platform)} 다운로드하기</h3>
            <p class="download-platform-copy">${escapeHtml(summary.message)}</p>
          </button>
        `;
      })
      .join("");
  }

  function buildChecklistMarkup(platform) {
    const items = platformCopy[platform]?.checklist || [];
    return items
      .map(
        (item, index) => `
          <li class="checklist-item">
            <span class="checklist-index">${index + 1}</span>
            <span>${escapeHtml(item)}</span>
          </li>
        `,
      )
      .join("");
  }

  function buildAgreementPanelMarkup() {
    if (!state.selectedPlatform) {
      return `
        <div class="agreement-panel-shell">
          <div class="agreement-placeholder">
            <p class="surface-label">Install</p>
            <h2 class="section-title">플랫폼을 선택하면 설치 확인 패널이 열립니다.</h2>
            <p class="body-balance">
              macOS, Windows, Linux 가운데 하나를 누르면 아래로 이어지는 동의 창이
              나타납니다.
            </p>
          </div>
        </div>
      `;
    }

    const summary = getPlatformSummary(state.selectedPlatform);
    const primaryDownload = getPrimaryDownload(state.selectedPlatform);
    const available = Boolean(primaryDownload?.href);
    const downloadLabel = `${state.selectedPlatform} 다운로드하기`;
    const downloadButton = available
      ? allConsentsAccepted()
        ? `<a class="cta cta-primary" href="${escapeHtml(primaryDownload.href)}">${escapeHtml(downloadLabel)}</a>`
        : `<button class="cta cta-primary" type="button" disabled>동의 후 다운로드</button>`
      : `<button class="cta cta-primary" type="button" disabled>곧 공개됩니다</button>`;

    return `
      <div class="agreement-panel-shell ${state.panelOpen ? "is-open" : ""}">
        <div class="agreement-panel-head">
          <div>
            <p class="surface-label">Install</p>
            <h2 class="section-title headline-balance">${escapeHtml(state.selectedPlatform)} 설치 전 확인</h2>
            <p class="agreement-head-copy body-balance">
              플랫폼을 골랐습니다. 아래 동의 항목을 확인하면 기본 설치 파일로 바로 이어집니다.
            </p>
          </div>
          <span class="version-chip">v${escapeHtml(config.version)}</span>
        </div>

        <div class="agreement-layout">
          <aside class="agreement-summary-card">
            <p class="surface-label">Selected Platform</p>
            <h3 class="agreement-platform-name">${escapeHtml(state.selectedPlatform)}</h3>
            <p class="agreement-platform-copy">${escapeHtml(summary?.message || "")}</p>
            <ul class="checklist-stack">
              ${buildChecklistMarkup(state.selectedPlatform)}
            </ul>
          </aside>

          <div class="agreement-consent-stack">
            <article class="panel-card agreement-intro-card">
              <h3>설치 전에 알아둘 점</h3>
              <p>
                Jarvis Desktop은 음성, 브라우저 제어, 앱 실행, 파일 작업처럼 실제
                데스크톱 동작과 연결될 수 있습니다. 그래서 설치 전에 권한 흐름과
                데이터 처리 방식을 먼저 확인합니다.
              </p>
            </article>

            <label class="consent-card">
              <input type="checkbox" data-agreement="terms" ${
                state.agreements.terms ? "checked" : ""
              } />
              <span>
                <h3>이용 안내를 확인했습니다.</h3>
                <p>설치 후 권한 요청과 자동화 동작이 나타날 수 있음을 이해합니다.</p>
              </span>
            </label>

            <label class="consent-card">
              <input type="checkbox" data-agreement="privacy" ${
                state.agreements.privacy ? "checked" : ""
              } />
              <span>
                <h3>데이터 처리 방식을 이해했습니다.</h3>
                <p>음성, 검색, 응답은 연결한 설정에 따라 로컬 또는 외부 서비스에서 처리될 수 있습니다.</p>
              </span>
            </label>

            <label class="consent-card">
              <input type="checkbox" data-agreement="permissions" ${
                state.agreements.permissions ? "checked" : ""
              } />
              <span>
                <h3>시스템 권한 안내를 확인했습니다.</h3>
                <p>마이크, 접근성, 자동화 권한은 사용자가 직접 허용해야 하며 일부 기능은 권한 상태에 따라 달라질 수 있습니다.</p>
              </span>
            </label>

            <div class="agreement-actions">
              ${downloadButton}
              ${
                config.releaseNotesUrl
                  ? `<a class="cta cta-secondary" href="${escapeHtml(config.releaseNotesUrl)}">변경 사항</a>`
                  : ""
              }
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderAgreementPanel() {
    if (!elements.agreementPanel) {
      return;
    }

    elements.agreementPanel.innerHTML = buildAgreementPanelMarkup();
    elements.agreementPanel.classList.toggle("is-open", state.panelOpen);
  }

  function openAgreementPanel() {
    if (!elements.agreementPanel) {
      return;
    }

    state.panelOpen = true;
    renderAgreementPanel();

    window.requestAnimationFrame(() => {
      elements.agreementPanel.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function handleDownloadPlatformClick(event) {
    const button = event.target.closest("[data-platform]");
    if (!button) {
      return;
    }

    state.selectedPlatform = button.getAttribute("data-platform") || state.selectedPlatform;
    renderDownloadPlatformGrid();
    openAgreementPanel();
  }

  function handleAgreementChange(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const agreement = input.getAttribute("data-agreement");
    if (!agreement || !(agreement in state.agreements)) {
      return;
    }

    state.agreements[agreement] = input.checked;
    saveAgreements();
    renderAgreementPanel();
  }

  function initializeDownloadPageState() {
    const requestedPlatform = getRequestedPlatform();
    const detectedPlatform = detectPlatform();

    state.selectedPlatform =
      requestedPlatform ||
      (detectedPlatform && knownPlatforms.includes(detectedPlatform)
        ? detectedPlatform
        : getFirstAvailablePlatform());

    if (requestedPlatform || window.location.hash === "#agreement-panel") {
      state.panelOpen = true;
    }
  }

  function initScrollReveal() {
    const blocks = document.querySelectorAll(".reveal");
    if (!blocks.length) {
      return;
    }

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion || typeof IntersectionObserver !== "function") {
      blocks.forEach((block) => block.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { root: null, rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
    );

    blocks.forEach((block) => observer.observe(block));
  }

  const config = {
    brandName: String(rawConfig.brandName || "DexProject").trim() || "DexProject",
    productName:
      String(rawConfig.productName || "Jarvis Desktop").trim() || "Jarvis Desktop",
    version: String(rawConfig.version || "0.1.0").trim() || "0.1.0",
    releaseNotesUrl: String(rawConfig.releaseNotesUrl || "").trim(),
    downloads: normalizeDownloads(rawConfig),
  };

  config.platforms = buildPlatforms(config.downloads);

  restoreAgreements();
  initializeTheme();
  renderReleaseNotesLink();

  if (elements.themeToggle) {
    elements.themeToggle.addEventListener("click", toggleTheme);
  }

  if (mediaQuery) {
    const updateToSystemTheme = () => {
      if (!state.hasStoredTheme) {
        applyTheme(getSystemTheme());
      }
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateToSystemTheme);
    } else if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(updateToSystemTheme);
    }
  }

  if (document.body.dataset.page === "overview") {
    renderOverviewPage();
  }

  if (document.body.dataset.page === "downloads") {
    initializeDownloadPageState();
    renderDownloadPageMeta();
    renderDownloadPlatformGrid();
    renderAgreementPanel();

    if (elements.downloadPlatformGrid) {
      elements.downloadPlatformGrid.addEventListener(
        "click",
        handleDownloadPlatformClick,
      );
    }

    if (elements.agreementPanel) {
      elements.agreementPanel.addEventListener("change", handleAgreementChange);
    }

    if (state.panelOpen) {
      window.requestAnimationFrame(() => {
        openAgreementPanel();
      });
    }
  }

  initScrollReveal();
})();
