(function () {
  const rawConfig = window.JARVIS_INSTALL_CONFIG || {};
  const knownPlatforms = ["macOS", "Windows", "Linux"];
  const themeStorageKey = "jarvis-install-theme-v1";
  const languageStorageKey = "jarvis-install-language-v1";
  const mediaQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;

  const translations = {
    ko: {
      common: {
        overview: "Overview",
        capabilities: "Capabilities",
        platforms: "Platforms",
        downloads: "Downloads",
        install: "Install",
        freeInstall: "무료 설치하기",
        freeDownload: "무료 다운로드하기",
        exploreFeatures: "기능 둘러보기",
        releaseNotes: "변경 사항",
        goHome: "홈으로 돌아가기",
        backToInstall: "설치 페이지로 돌아가기",
        ready: "Download Ready",
        soon: "Coming Soon",
        light: "밝게",
        dark: "어둡게",
        languageToggle: "언어 변경",
        themeToggle: "테마 전환",
        directInstall: "바로 설치",
        continueInstall: "설치 계속하기"
      },
      overview: {
        heroKicker: "DESKTOP AI FOR VOICE, BROWSER, AND COMPUTER CONTROL",
        heroTitleHtml:
          "Jarvis Desktop,<br />the AI layer<br />for your computer.",
        heroBody:
          "Jarvis Desktop은 단순한 채팅 앱이 아니라, 말하거나 입력한 요청을 브라우저·앱·파일·데스크톱 작업으로 자연스럽게 이어 주는 실행형 AI 인터페이스입니다.",
        statsSupportedLabel: "Supported",
        statsSupportedDesc: "현재 실제 설치 가능한 플랫폼 수를 표시합니다.",
        statsConversationLabel: "Conversation",
        statsConversationTitle: "Voice + Browser",
        statsConversationDesc:
          "음성 대화, 브라우저 작업, 앱 제어를 같은 흐름으로 이어갑니다.",
        statsReleaseLabel: "Release",
        statsReleaseDesc:
          "설치전 웹사이트와 실제 설치 흐름이 맞춰진 현재 공개 버전입니다.",
        heroPills: ["Voice First", "Browser Control"],
        heroPlatformsReady: "{count} Platforms Ready",
        chatKicker: "Live Preview",
        chatTitleHtml: "실제로 대화하고,<br />바로 실행합니다.",
        chatIntro:
          "설명용 문구 대신, 사용자가 요청하고 Jarvis가 바로 실행하는 흐름을 카드 안에서 보여줍니다.",
        chatUser: "유튜브에서 lofi 틀고 오늘 회의 링크 찾아줘.",
        chatAssistant:
          "브라우저를 열고 음악을 재생한 뒤, 최근 대화와 캘린더 기준으로 회의 링크를 찾고 있어요.",
        chatActionVoice: "Voice captured",
        chatActionBrowser: "Browser opened",
        chatActionTask: "Meeting link detected",
        installCardLabel: "Install",
        installCardTitle: "무료 설치하기",
        installCardBody:
          "운영체제를 고른 뒤 설치 페이지에서 바로 다운로드를 시작할 수 있습니다.",
        showcase1Label: "Natural Intent",
        showcase1Title: "말한 목적을 먼저 이해하고 실행 흐름으로 잇습니다.",
        showcase1Body:
          "사이트 이름, 앱 이름, 작업 의도를 우선 파악해 답변보다 실행이 앞서는 데스크톱 경험을 목표로 합니다.",
        showcase2Label: "Local Control",
        showcase2Title: "브라우저와 컴퓨터를 직접 다루는 데스크톱 AI.",
        showcase2Body:
          "음성 입력, 앱 실행, 브라우저 제어, 파일 작업까지 하나의 흐름 안에서 연결되는 구조를 지향합니다.",
        showcase3Label: "Install Flow",
        showcase3Title: "설치 전 소개와 실제 설치 흐름을 분리해 더 명확하게.",
        showcase3Body:
          "랜딩 페이지에서는 제품을 보여주고, 별도 설치 페이지에서는 플랫폼 선택과 다운로드만 빠르게 진행합니다.",
        platformsLabel: "Platforms",
        platformsTitle: "운영체제를 고른 뒤, 별도 설치 페이지에서 바로 시작합니다.",
        platformsCopy:
          "메인 페이지에서는 제품을 소개하고, 설치 페이지에서는 macOS·Windows·Linux 가운데 원하는 환경을 골라 실제 다운로드를 진행합니다.",
        footerCopy:
          "Jarvis Desktop은 음성, 브라우저, 데스크톱 제어를 하나의 실행 흐름으로 연결하는 데스크톱 AI 제품입니다."
      },
      downloads: {
        heroKicker: "FREE INSTALL",
        heroTitleHtml:
          "운영체제를 고르고,<br />바로 설치를 시작하세요.",
        heroBody:
          "이 페이지는 실제 설치에만 집중합니다. 원하는 플랫폼을 고르면 즉시 다운로드를 시작합니다.",
        selectorLabel: "Install",
        selectorTitle: "원하는 플랫폼을 골라 설치하세요.",
        selectorCopy:
          "버튼을 누르면 설치 파일 다운로드를 시작합니다.",
        pagePills: ["macOS", "Windows", "Linux", "Direct Install"],
        fallbackMessage:
          "최신 {platform} 빌드는 아직 준비 중이지만 v{version} 설치 파일을 바로 받을 수 있습니다.",
        helperNote:
          "다운로드 버튼을 누르면 파일을 받기 시작합니다.",
        macSecurityTitle: "macOS 사용자 필독: 보안 경고 해결 방법",
        macSecurityBody: "앱 실행 시 '손상되었기 때문에 열 수 없습니다'라는 메시지가 뜨나요? 이는 Apple의 미인증 앱 차단 정책 때문이며, 아래 명령어를 터미널에 입력하면 즉시 해결됩니다.",
        macSecurityCommandLabel: "터미널에 붙여넣을 명령어",
        macSecurityCopy: "명령어 복사",
        macSecurityCopied: "복사 완료!"
      },
      thanks: {
        heroKicker: "INSTALL GUIDE",
        heroTitleHtml: "설치 후<br />확인할 항목",
        heroBody:
          "다운로드가 시작되었습니다. 첫 실행 전에 아래 단계와 권한 안내를 확인하면 더 빠르게 사용할 수 있습니다.",
        nextLabel: "Next Steps",
        nextTitle: "설치 후 바로 확인할 항목",
        step1Title: "앱 실행",
        step1Body:
          "다운로드한 설치 파일은 설치 프로그램입니다. 특히 Windows에서는 설치가 끝난 뒤 다운로드한 .exe를 다시 여는 대신 시작 메뉴나 바탕화면의 Jarvis Desktop 바로가기로 앱을 실행하세요.",
        step2Title: "권한 확인",
        step2Body:
          "마이크, 접근성, 자동화 권한은 사용자가 직접 허용해야 하며 일부 기능은 권한 상태에 따라 달라집니다.",
        step3Title: "업데이트 확인",
        step3Body:
          "설치된 앱은 새 GitHub Release가 게시되면 내부에서 새 버전을 감지하고 업데이트를 안내합니다.",
        currentPlatformLabel: "Selected Platform",
        currentPlatformFallback: "선택한 플랫폼 기준으로 다운로드를 진행했습니다."
      },
      platformCopy: {
        macOS: {
          cardTitle: "macOS 다운로드",
          readyMessage: "Apple Silicon 기준 기본 설치 파일로 바로 이어집니다.",
          pendingMessage: "macOS 빌드는 준비 중입니다.",
          hint: "기본 형식 .dmg"
        },
        Windows: {
          cardTitle: "Windows 다운로드",
          readyMessage: "Windows 설치 파일로 바로 이어집니다.",
          pendingMessage: "Windows 빌드는 준비 중입니다.",
          hint: "기본 형식 .exe"
        },
        Linux: {
          cardTitle: "Linux 다운로드",
          readyMessage: "Linux AppImage 설치 파일로 바로 이어집니다.",
          pendingMessage: "Linux 빌드는 준비 중입니다.",
          hint: "기본 형식 .AppImage"
        }
      }
    },
    en: {
      common: {
        overview: "Overview",
        capabilities: "Capabilities",
        platforms: "Platforms",
        downloads: "Downloads",
        install: "Install",
        freeInstall: "Free Install",
        freeDownload: "Free Download",
        exploreFeatures: "Explore Features",
        releaseNotes: "Release Notes",
        goHome: "Back to Home",
        backToInstall: "Back to Install",
        ready: "Download Ready",
        soon: "Coming Soon",
        light: "Light",
        dark: "Dark",
        languageToggle: "Switch language",
        themeToggle: "Toggle theme",
        directInstall: "Direct Install",
        continueInstall: "Continue Install"
      },
      overview: {
        heroKicker: "DESKTOP AI FOR VOICE, BROWSER, AND COMPUTER CONTROL",
        heroTitleHtml:
          "Jarvis Desktop,<br />the AI layer<br />for your computer.",
        heroBody:
          "Jarvis Desktop is not just a chat app. It turns what you say or type into browser actions, app launches, file work, and desktop automation in one continuous flow.",
        statsSupportedLabel: "Supported",
        statsSupportedDesc: "Shows how many platforms are currently install-ready.",
        statsConversationLabel: "Conversation",
        statsConversationTitle: "Voice + Browser",
        statsConversationDesc:
          "Voice conversations, browser tasks, and app control stay in one flow.",
        statsReleaseLabel: "Release",
        statsReleaseDesc:
          "The current public version aligned with the install website and real download flow.",
        heroPills: ["Voice First", "Browser Control"],
        heroPlatformsReady: "{count} Platforms Ready",
        chatKicker: "Live Preview",
        chatTitleHtml: "Chat naturally,<br />then watch it move.",
        chatIntro:
          "Instead of marketing copy, this panel shows a realistic preview of a user talking to Jarvis and Jarvis taking action.",
        chatUser: "Play lofi on YouTube and find today’s meeting link.",
        chatAssistant:
          "Opening the browser, starting playback, and checking recent conversations plus calendar context for the meeting link.",
        chatActionVoice: "Voice captured",
        chatActionBrowser: "Browser opened",
        chatActionTask: "Meeting link detected",
        installCardLabel: "Install",
        installCardTitle: "Free Install",
        installCardBody:
          "Choose your platform and start downloading right away from the install page.",
        showcase1Label: "Natural Intent",
        showcase1Title: "Understand the goal first, then move into execution.",
        showcase1Body:
          "The experience is designed to understand app names, websites, and intent before turning replies into actual actions.",
        showcase2Label: "Local Control",
        showcase2Title:
          "A desktop AI that can directly handle browser and computer tasks.",
        showcase2Body:
          "Voice input, app launching, browser control, and file operations are designed to stay inside one task flow.",
        showcase3Label: "Install Flow",
        showcase3Title: "Separate product storytelling from the actual install flow.",
        showcase3Body:
          "The landing page introduces the product, while the install page focuses only on platform choice and direct downloads.",
        platformsLabel: "Platforms",
        platformsTitle: "Choose your OS, then continue on a dedicated install page.",
        platformsCopy:
          "The main page introduces the product. The install page is where users choose macOS, Windows, or Linux and start the real download flow.",
        footerCopy:
          "Jarvis Desktop is a desktop AI product that connects voice, browser, and computer control into one execution flow."
      },
      downloads: {
        heroKicker: "FREE INSTALL",
        heroTitleHtml: "Choose your platform,<br />then start installing.",
        heroBody:
          "This page focuses only on installation. Pick a platform to start the download immediately.",
        selectorLabel: "Install",
        selectorTitle: "Pick the platform you want to install.",
        selectorCopy:
          "Click a button to start downloading the installer.",
        pagePills: ["macOS", "Windows", "Linux", "Direct Install"],
        fallbackMessage:
          "The latest {platform} build is not ready yet, but you can install v{version} right now.",
        helperNote:
          "When you click a download button, the file starts downloading.",
        macSecurityTitle: "For macOS Users: Solving 'Damaged' App Error",
        macSecurityBody: "If you see a 'is damaged and can't be opened' message, it's due to Apple's security policy for unnotarized apps. Run the following command in your Terminal to fix it instantly.",
        macSecurityCommandLabel: "Command to paste in Terminal",
        macSecurityCopy: "Copy Command",
        macSecurityCopied: "Copied!"
      },
      thanks: {
        heroKicker: "INSTALL GUIDE",
        heroTitleHtml: "What to check<br />after install",
        heroBody:
          "Your download has started. Review the steps below before first launch to get set up faster.",
        nextLabel: "Next Steps",
        nextTitle: "What to check right after installation",
        step1Title: "Run the installer",
        step1Body:
          "The downloaded file is the installer, not the app itself. On Windows, finish setup first, then launch Jarvis Desktop from the Start menu or desktop shortcut instead of reopening the downloaded .exe.",
        step2Title: "Review permissions",
        step2Body:
          "Microphone, accessibility, and automation permissions must be granted by the user, and some features depend on them.",
        step3Title: "Check updates",
        step3Body:
          "Installed apps detect new versions when a new GitHub Release is published and can then guide the update flow.",
        currentPlatformLabel: "Selected Platform",
        currentPlatformFallback: "The download was started for your selected platform."
      },
      platformCopy: {
        macOS: {
          cardTitle: "macOS Download",
          readyMessage: "Continue directly to the default Apple Silicon installer.",
          pendingMessage: "The macOS build is coming soon.",
          hint: "Default format .dmg"
        },
        Windows: {
          cardTitle: "Windows Download",
          readyMessage: "Continue directly to the Windows installer.",
          pendingMessage: "The Windows build is coming soon.",
          hint: "Default format .exe"
        },
        Linux: {
          cardTitle: "Linux Download",
          readyMessage: "Continue directly to the Linux AppImage build.",
          pendingMessage: "The Linux build is coming soon.",
          hint: "Default format .AppImage"
        }
      }
    }
  };

  const elements = {
    themeToggle: document.getElementById("theme-toggle"),
    languageToggle: document.getElementById("language-toggle"),
    languageToggleLabel: document.getElementById("language-toggle-label"),
    themeColorMeta: document.getElementById("theme-color-meta"),
    heroMeta: document.getElementById("hero-meta"),
    heroVersion: document.getElementById("hero-version"),
    supportedPlatformCount: document.getElementById("supported-platform-count"),
    releaseNotesLink: document.getElementById("release-notes-link"),
    downloadPageMeta: document.getElementById("download-page-meta"),
    downloadPlatformGrid: document.getElementById("download-platform-grid"),
    thanksPlatformName: document.getElementById("thanks-platform-name"),
    thanksPlatformCopy: document.getElementById("thanks-platform-copy"),
    thanksReleaseNotesLink: document.getElementById("thanks-release-notes-link")
  };

  const state = {
    theme: "light",
    hasStoredTheme: false,
    language: "ko"
  };

  function escapeHtml(value) {
    const span = document.createElement("span");
    span.textContent = String(value ?? "");
    return span.innerHTML;
  }

  function getMessage(path) {
    const source = translations[state.language];
    return String(path || "")
      .split(".")
      .reduce(
        (accumulator, key) =>
          accumulator && key in accumulator ? accumulator[key] : undefined,
        source
      );
  }

  function t(path, fallback = "") {
    const value = getMessage(path);
    return value ?? fallback;
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
        architecture: "ARM64",
        recommended: true
      },
      {
        platform: "macOS",
        href: String(config.macDownloadUrl || "").trim(),
        format: ".dmg",
        architecture: "Apple Silicon",
        recommended: true
      },
      {
        platform: "Linux",
        href: String(config.linuxDownloadUrl || "").trim(),
        format: ".AppImage",
        architecture: "ARM64",
        recommended: true
      }
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
          version: String(item?.version || "").trim(),
          hint: String(item?.hint || "").trim(),
          isFallback: Boolean(item?.isFallback)
        };
      })
      .filter(Boolean);
  }

  const config = {
    brandName: String(rawConfig.brandName || "DexProject").trim() || "DexProject",
    productName:
      String(rawConfig.productName || "Jarvis Desktop").trim() || "Jarvis Desktop",
    version: String(rawConfig.version || "0.1.0").trim() || "0.1.0",
    releaseNotesUrl: String(rawConfig.releaseNotesUrl || "").trim(),
    downloads: normalizeDownloads(rawConfig)
  };

  function getPrimaryDownload(platform, downloads = config.downloads) {
    const platformDownloads = downloads.filter((item) => item.platform === platform);
    return (
      platformDownloads.find((item) => item.recommended) ||
      platformDownloads[0] ||
      null
    );
  }

  function buildPlatforms(downloads) {
    return knownPlatforms.map((platform) => {
      const primary = getPrimaryDownload(platform, downloads);
      return {
        platform,
        available: Boolean(primary?.href),
        downloadVersion: String(primary?.version || "").trim(),
        isFallback: Boolean(primary?.isFallback)
      };
    });
  }

  config.platforms = buildPlatforms(config.downloads);

  function getStoredTheme() {
    try {
      const stored = window.localStorage.getItem(themeStorageKey);
      if (stored === "light" || stored === "dark") {
        return stored;
      }
    } catch (_error) {
      // ignore
    }
    return "";
  }

  function getStoredLanguage() {
    try {
      const stored = window.localStorage.getItem(languageStorageKey);
      if (stored === "ko" || stored === "en") {
        return stored;
      }
    } catch (_error) {
      // ignore
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
        state.theme === "dark" ? "#050507" : "#f5f5f7"
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
      // ignore
    }
  }

  function initializeLanguage() {
    state.language = getStoredLanguage() || "ko";
    document.documentElement.lang = state.language;
  }

  function updateLanguageButton() {
    if (!elements.languageToggle || !elements.languageToggleLabel) {
      return;
    }

    elements.languageToggleLabel.textContent = state.language === "ko" ? "KO" : "EN";
    elements.languageToggle.setAttribute("aria-label", t("common.languageToggle"));
    elements.languageToggle.setAttribute("title", t("common.languageToggle"));
  }

  function applyTranslations() {
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.getAttribute("data-i18n");
      const value = t(key, "");
      if (value) {
        element.textContent = value;
      }
    });

    document.querySelectorAll("[data-i18n-html]").forEach((element) => {
      const key = element.getAttribute("data-i18n-html");
      const value = t(key, "");
      if (value) {
        element.innerHTML = value;
      }
    });

    document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
      const key = element.getAttribute("data-i18n-aria");
      const value = t(key, "");
      if (value) {
        element.setAttribute("aria-label", value);
      }
    });

    if (elements.themeToggle) {
      elements.themeToggle.setAttribute("aria-label", t("common.themeToggle"));
      elements.themeToggle.setAttribute("title", t("common.themeToggle"));
    }
  }

  function toggleLanguage() {
    state.language = state.language === "ko" ? "en" : "ko";
    document.documentElement.lang = state.language;

    try {
      window.localStorage.setItem(languageStorageKey, state.language);
    } catch (_error) {
      // ignore
    }

    applyTranslations();
    renderReleaseNotesLink();
    renderOverviewPage();
    renderDownloadPageMeta();
    renderDownloadPlatformGrid();
    renderThanksPage();
    updateLanguageButton();
  }

  function renderReleaseNotesLink() {
    if (elements.releaseNotesLink) {
      if (!config.releaseNotesUrl) {
        elements.releaseNotesLink.hidden = true;
      } else {
        elements.releaseNotesLink.hidden = false;
        elements.releaseNotesLink.href = config.releaseNotesUrl;
      }
    }

    if (elements.thanksReleaseNotesLink) {
      if (!config.releaseNotesUrl) {
        elements.thanksReleaseNotesLink.hidden = true;
      } else {
        elements.thanksReleaseNotesLink.hidden = false;
        elements.thanksReleaseNotesLink.href = config.releaseNotesUrl;
      }
    }
  }

  function renderOverviewPage() {
    if (document.body.dataset.page !== "overview") {
      return;
    }

    const availablePlatforms = config.platforms.filter((item) => item.available);

    if (elements.supportedPlatformCount) {
      elements.supportedPlatformCount.textContent = String(availablePlatforms.length);
    }

    if (elements.heroVersion) {
      elements.heroVersion.textContent = `v${config.version}`;
    }

    if (elements.heroMeta) {
      const heroPills = Array.isArray(t("overview.heroPills", []))
        ? t("overview.heroPills", [])
        : [];
      const pills = [
        ...heroPills,
        t("overview.heroPlatformsReady", "").replace(
          "{count}",
          String(availablePlatforms.length)
        )
      ];

      elements.heroMeta.innerHTML = pills
        .map((pill) => `<span class="meta-pill">${escapeHtml(pill)}</span>`)
        .join("");
    }
  }

  function renderDownloadPageMeta() {
    if (document.body.dataset.page !== "downloads" || !elements.downloadPageMeta) {
      return;
    }

    const pills = Array.isArray(t("downloads.pagePills", []))
      ? t("downloads.pagePills", [])
      : [];

    elements.downloadPageMeta.innerHTML = pills
      .map((pill) => `<span class="meta-pill">${escapeHtml(pill)}</span>`)
      .join("");
  }

  function getPlatformCopy(platform) {
    return t(`platformCopy.${platform}`, {});
  }

  function renderDownloadPlatformGrid() {
    if (document.body.dataset.page !== "downloads" || !elements.downloadPlatformGrid) {
      return;
    }

    elements.downloadPlatformGrid.innerHTML = config.platforms
      .map((summary) => {
        const download = getPrimaryDownload(summary.platform);
        const copy = getPlatformCopy(summary.platform);
        const statusLabel = summary.available ? t("common.ready") : t("common.soon");
        const message = summary.available
          ? summary.isFallback && summary.downloadVersion
            ? t("downloads.fallbackMessage", "")
                .replace("{platform}", summary.platform)
                .replace("{version}", summary.downloadVersion)
            : copy.readyMessage
          : copy.pendingMessage;
        const hintParts = [
          download?.hint || copy.hint,
          download?.architecture || "",
          download?.format || "",
          download?.version ? `v${download.version}` : ""
        ]
          .filter(Boolean)
          .join(" · ");

        return `
          <article class="download-platform-card ${summary.available ? "is-available" : "is-pending"}">
            <div class="download-platform-card-top">
              <p class="surface-label">${escapeHtml(summary.platform)}</p>
              <span class="status-pill ${summary.available ? "available" : "pending"}">
                ${escapeHtml(statusLabel)}
              </span>
            </div>
            <h3 class="download-platform-title">${escapeHtml(copy.cardTitle || summary.platform)}</h3>
            <p class="download-platform-copy">${escapeHtml(message || "")}</p>
            <div class="download-platform-meta">${escapeHtml(hintParts)}</div>
            ${
              summary.available && download?.href
                ? `<button type="button" class="cta cta-primary download-launch-button" data-download-href="${escapeHtml(
                    download.href
                  )}" data-platform="${escapeHtml(summary.platform)}">${escapeHtml(
                    t("common.freeInstall")
                  )}</button>`
                : `<button type="button" class="cta cta-secondary" disabled>${escapeHtml(
                    t("common.soon")
                  )}</button>`
            }
          </article>
        `;
      })
      .join("");
  }

  function getRequestedPlatform() {
    const url = new URL(window.location.href);
    const rawPlatform = url.searchParams.get("platform") || "";
    return knownPlatforms.find((item) => item === rawPlatform) || "";
  }

  function renderThanksPage() {
    if (document.body.dataset.page !== "thanks") {
      return;
    }

    const selectedPlatform = getRequestedPlatform();
    const copy = selectedPlatform ? getPlatformCopy(selectedPlatform) : null;

    if (elements.thanksPlatformName) {
      elements.thanksPlatformName.textContent = selectedPlatform || "Jarvis Desktop";
    }

    if (elements.thanksPlatformCopy) {
      elements.thanksPlatformCopy.textContent =
        copy?.readyMessage || t("thanks.currentPlatformFallback");
    }
  }

  function isLocalDownload(href) {
    return !/^https?:\/\//i.test(String(href || ""));
  }

  function buildThanksUrl(platform) {
    const url = new URL("./thanks.html", window.location.href);

    if (platform) {
      url.searchParams.set("platform", platform);
    }

    return url.toString();
  }

  function launchDownload(href) {
    if (isLocalDownload(href)) {
      const link = document.createElement("a");
      link.href = href;
      link.download = "";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }

    window.open(href, "_blank", "noopener,noreferrer");
  }

  function handleDownloadClick(event) {
    const button = event.target.closest("[data-download-href]");
    if (!button) {
      return;
    }

    const href = button.getAttribute("data-download-href") || "";
    const platform = button.getAttribute("data-platform") || "";

    if (!href) {
      return;
    }

    launchDownload(href);
    window.location.assign(buildThanksUrl(platform));
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
      { root: null, rootMargin: "0px 0px -10% 0px", threshold: 0.08 }
    );

    blocks.forEach((block) => observer.observe(block));
  }

  initializeTheme();
  initializeLanguage();
  applyTranslations();
  updateLanguageButton();
  renderReleaseNotesLink();
  renderOverviewPage();
  renderDownloadPageMeta();
  renderDownloadPlatformGrid();
  renderThanksPage();

  if (elements.themeToggle) {
    elements.themeToggle.addEventListener("click", toggleTheme);
  }

  if (elements.languageToggle) {
    elements.languageToggle.addEventListener("click", toggleLanguage);
  }

  if (elements.downloadPlatformGrid) {
    elements.downloadPlatformGrid.addEventListener("click", handleDownloadClick);
  }

  const copyBtn = document.getElementById("copy-command-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const commandText = document.getElementById("mac-command").innerText;
      navigator.clipboard.writeText(commandText).then(() => {
        const btnText = copyBtn.querySelector(".copy-btn-text");
        const originalText = btnText.textContent;
        
        copyBtn.classList.add("success");
        btnText.textContent = t("downloads.macSecurityCopied", "Copied!");

        setTimeout(() => {
          copyBtn.classList.remove("success");
          btnText.textContent = originalText;
        }, 2000);
      });
    });
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

  initScrollReveal();
})();
