module.exports = [
  {
    name: "media_get_og_info",
    aliases: ["media.og_info", "media.preview"],
    inputKeys: ["url", "canonicalUrl", "title", "thumbnailUrl"],
    schema: '{"action":{"tool":"media_get_og_info","input":{"url":"https://www.youtube.com/watch?v=..."}},"expectedOutcome":"...","isFinal":false}',
    description: "YouTube 중심 미디어 카드용 제목/썸네일/URL 메타데이터를 가져옵니다.",
    execute: async (action, context = {}) => {
      if (!context.companion?.mediaGetOgInfo) {
        return {
          state: null,
          error: "media_get_og_info is unavailable because the companion service is not attached."
        };
      }
      const result = await context.companion.mediaGetOgInfo(action.input || {});
      return {
        state: result.media || null,
        error: result.ok ? null : result.error || "Failed to build media card."
      };
    }
  },
  {
    name: "media_play",
    aliases: ["media.play"],
    inputKeys: ["url"],
    schema: '{"action":{"tool":"media_play","input":{"url":"https://www.youtube.com/watch?v=..."}},"expectedOutcome":"...","isFinal":false}',
    description: "숨겨진 미디어 제어 엔진으로 YouTube 재생을 시작하거나 이어갑니다.",
    execute: async (action, context = {}) => {
      if (!context.companion?.mediaPlay) {
        return {
          state: null,
          error: "media_play is unavailable because the companion service is not attached."
        };
      }
      const result = await context.companion.mediaPlay(action.input || {});
      return {
        state: result.media || null,
        error: result.ok ? null : result.error || "Failed to play media."
      };
    }
  },
  {
    name: "media_pause",
    aliases: ["media.pause"],
    inputKeys: ["url"],
    schema: '{"action":{"tool":"media_pause","input":{"url":"https://www.youtube.com/watch?v=..."}},"expectedOutcome":"...","isFinal":false}',
    description: "숨겨진 미디어 제어 엔진으로 현재 YouTube 재생을 멈춥니다.",
    execute: async (action, context = {}) => {
      if (!context.companion?.mediaPause) {
        return {
          state: null,
          error: "media_pause is unavailable because the companion service is not attached."
        };
      }
      const result = await context.companion.mediaPause(action.input || {});
      return {
        state: result.media || null,
        error: result.ok ? null : result.error || "Failed to pause media."
      };
    }
  },
  {
    name: "media_seek",
    aliases: ["media.seek"],
    inputKeys: ["deltaSeconds", "seconds", "url"],
    schema: '{"action":{"tool":"media_seek","input":{"deltaSeconds":15}},"expectedOutcome":"...","isFinal":false}',
    description: "현재 미디어 재생 위치를 앞이나 뒤로 이동합니다.",
    execute: async (action, context = {}) => {
      if (!context.companion?.mediaSeek) {
        return {
          state: null,
          error: "media_seek is unavailable because the companion service is not attached."
        };
      }
      const result = await context.companion.mediaSeek(action.input || {});
      return {
        state: result.media || null,
        error: result.ok ? null : result.error || "Failed to seek media."
      };
    }
  },
  {
    name: "media_get_lyrics",
    aliases: ["media.lyrics"],
    inputKeys: ["title"],
    schema: '{"action":{"tool":"media_get_lyrics","input":{"title":"Artist - Track"}},"expectedOutcome":"...","isFinal":false}',
    description: "현재 YouTube 트랙의 가사 힌트를 최소 형태로 가져옵니다.",
    execute: async (action, context = {}) => {
      if (!context.companion?.mediaGetLyrics) {
        return {
          state: null,
          error: "media_get_lyrics is unavailable because the companion service is not attached."
        };
      }
      const result = await context.companion.mediaGetLyrics(action.input || {});
      return {
        state: result.lyrics || null,
        error: result.ok ? null : result.error || "Failed to get lyrics."
      };
    }
  }
];
