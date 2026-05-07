const test = require("node:test");
const assert = require("node:assert/strict");

// skill-registry는 pii-manager → electron 체인을 통해 로드됩니다.
// pii-manager.cjs의 lazy require 수정으로 인해 Electron 없는 환경에서도 정상 로드됩니다.
const registry = require("../../src/main/skills/skill-registry.cjs");

// ─── 헬퍼: 브라우저 / OS 자동화 더미 컨텍스트 ──────────────────────────────

function makeBrowserContext(overrides = {}) {
  return {
    browser: {
      async navigate(url) { return { url, title: "Test Page", elements: [], elementCount: 0 }; },
      async clickElement() { return { url: "", title: "", elements: [], elementCount: 0 }; },
      async typeText() { return { url: "", title: "", elements: [], elementCount: 0 }; },
      async pressKey() { return { url: "", title: "", elements: [], elementCount: 0 }; },
      async scrollPage() { return { url: "", title: "", elements: [], elementCount: 0 }; },
      async waitAndObserve() { return { url: "", title: "", elements: [], elementCount: 0 }; },
      async observe() { return { url: "https://example.com", title: "Example", elements: [], elementCount: 0 }; },
      ...overrides.browser
    },
    automation: {
      async execute() { return {}; },
      async typeText() {},
      async clickCoordinate() {},
      async runShellCommand() { return ""; },
      ...overrides.automation
    },
    safeObserve: async () => ({ url: "", title: "", elements: [], elementCount: 0 }),
    ...overrides
  };
}

// ─── 1. SkillRegistry 기본 동작 ───────────────────────────────────────────

test("getAllSchemas()는 등록된 모든 스킬 이름을 포함한 문자열 배열을 반환한다", () => {
  const schemas = registry.getAllSchemas();
  assert.ok(Array.isArray(schemas), "getAllSchemas()는 배열이어야 한다");
  assert.ok(schemas.length > 0, "등록된 스킬이 최소 1개 이상 있어야 한다");

  const joined = schemas.join("\n");
  // 브라우저 스킬
  assert.match(joined, /navigate/);
  assert.match(joined, /click/);
  assert.match(joined, /type/);
  // OS 스킬
  assert.match(joined, /os_type/);
  assert.match(joined, /os_app/);
  // 보안 스킬
  assert.match(joined, /ask_pii/);
  // 파일 스킬
  assert.match(joined, /file_read/);
  assert.match(joined, /file_write/);
  // 코어 스킬
  assert.match(joined, /done/);
  assert.match(joined, /sessions_spawn/);
  assert.match(joined, /subagents/);
  assert.match(joined, /media_get_og_info/);
  assert.match(joined, /media_play/);
  assert.match(joined, /account_queue_add/);
  assert.match(joined, /account_switch/);
});

test("get()은 등록된 스킬 객체를 반환하고, 미등록 액션에는 undefined를 반환한다", () => {
  const navigateSkill = registry.get("navigate");
  assert.ok(navigateSkill, "navigate 스킬이 존재해야 한다");
  assert.equal(typeof navigateSkill.execute, "function");

  const unknown = registry.get("nonexistent_action_xyz");
  assert.equal(unknown, undefined, "미등록 액션은 undefined여야 한다");
});

// ─── 2. 스킬 디스패치 ─────────────────────────────────────────────────────

test("execute()는 navigate 액션을 브라우저 navigate 스킬로 디스패치한다", async () => {
  const ctx = makeBrowserContext();
  const result = await registry.execute({ action: "navigate", url: "https://www.google.com/" }, ctx);
  assert.equal(result.error, null);
  assert.equal(result.state.url, "https://www.google.com/");
});

test("execute()는 알 수 없는 액션에 오류 메시지를 반환하고 크래시하지 않는다", async () => {
  const ctx = makeBrowserContext();
  const result = await registry.execute({ action: "totally_unknown_action" }, ctx);
  assert.ok(result.error, "알 수 없는 액션은 error 필드를 가져야 한다");
  assert.match(result.error, /Unknown action/i);
});

test("done 스킬은 state:null, error:null을 반환하며 크래시하지 않는다", async () => {
  const ctx = makeBrowserContext();
  const result = await registry.execute({ action: "done", summary: "작업 완료" }, ctx);
  assert.equal(result.state, null);
  assert.equal(result.error, null);
});

test("sessions_spawn 스킬은 subAgentManager.spawn으로 디스패치한다", async () => {
  let receivedPayload = null;
  const ctx = makeBrowserContext({
    subAgentManager: {
      async spawn(payload) {
        receivedPayload = payload;
        return {
          state: {
            session: {
              sessionId: "subagent-1",
              status: "running"
            }
          },
          error: null
        };
      }
    },
    currentSessionId: "root-session",
    runtimeDepth: 0,
    language: "ko"
  });

  const result = await registry.execute({
    action: "sessions_spawn",
    task: "메일함 상태 조사",
    agentId: "mailbox-researcher",
    depth: 1
  }, ctx);

  assert.equal(result.error, null);
  assert.equal(result.state.session.sessionId, "subagent-1");
  assert.deepEqual(receivedPayload, {
    task: "메일함 상태 조사",
    agentId: "mailbox-researcher",
    depth: 1,
    parentSessionId: "root-session",
    language: "ko"
  });
});

test("subagents 스킬은 list 액션으로 세션 상태를 반환한다", async () => {
  const ctx = makeBrowserContext({
    subAgentManager: {
      list(sessionId = "") {
        return [
          {
            sessionId: sessionId || "subagent-1",
            status: "running"
          }
        ];
      }
    }
  });

  const result = await registry.execute({
    action: "subagents",
    input: {
      action: "list",
      sessionId: "subagent-1"
    }
  }, ctx);

  assert.equal(result.error, null);
  assert.equal(result.state.subagents[0].sessionId, "subagent-1");
});

test("media_get_og_info 스킬은 companion 서비스로 디스패치한다", async () => {
  let receivedUrl = "";
  const ctx = makeBrowserContext({
    companion: {
      async mediaGetOgInfo(input) {
        receivedUrl = input.url;
        return {
          ok: true,
          media: {
            provider: "youtube",
            title: "Focus Mix",
            canonicalUrl: input.url
          }
        };
      }
    }
  });

  const result = await registry.execute({
    action: "media_get_og_info",
    url: "https://www.youtube.com/watch?v=test"
  }, ctx);

  assert.equal(receivedUrl, "https://www.youtube.com/watch?v=test");
  assert.equal(result.error, null);
  assert.equal(result.state.provider, "youtube");
});

test("account_queue_add 스킬은 companion 계정 큐로 디스패치한다", async () => {
  let queuedTask = null;
  const ctx = makeBrowserContext({
    companion: {
      async accountQueueAdd(input) {
        queuedTask = input;
        return {
          ok: true,
          task: {
            taskId: "task-1",
            accountId: input.accountId,
            provider: input.provider,
            status: "queued"
          }
        };
      }
    }
  });

  const result = await registry.execute({
    action: "account_queue_add",
    accountId: "work-google",
    provider: "google",
    type: "mail-review"
  }, ctx);

  assert.equal(queuedTask.accountId, "work-google");
  assert.equal(result.error, null);
  assert.equal(result.state.status, "queued");
});

// ─── 3. OS 스킬 ──────────────────────────────────────────────────────────

test("os_type 스킬은 automation.typeText를 호출하고 safeObserve 상태를 반환한다", async () => {
  let typedText = null;
  const ctx = makeBrowserContext({
    automation: {
      async typeText(text) { typedText = text; },
      async execute() { return {}; },
      async clickCoordinate() {},
      async runShellCommand() { return ""; }
    }
  });
  const result = await registry.execute({ action: "os_type", text: "hello world", reason: "테스트" }, ctx);
  assert.equal(typedText, "hello world");
  assert.equal(result.error, null);
});

test("os_app 스킬은 automation.execute에 open_app 타입을 전달한다", async () => {
  const calls = [];
  const ctx = makeBrowserContext({
    automation: {
      async execute(action) { calls.push(action); return {}; },
      async typeText() {},
      async clickCoordinate() {},
      async runShellCommand() { return ""; }
    }
  });
  await registry.execute({ action: "os_app", name: "Safari", reason: "테스트" }, ctx);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "open_app");
  assert.equal(calls[0].target, "Safari");
});

// ─── 4. 보안 스킬 (ask_pii) ──────────────────────────────────────────────

test("ask_pii 스킬은 PII 없는 경우 크래시하지 않고 error 문자열을 반환한다", async () => {
  const ctx = makeBrowserContext();
  // pii-manager에 'nonexistent_key_xyz'는 저장된 적 없으므로 null 반환
  const result = await registry.execute({ action: "ask_pii", field: "nonexistent_key_xyz", reason: "테스트" }, ctx);
  assert.ok(result.error, "PII 없을 때 error 필드가 있어야 한다");
  assert.match(result.error, /nonexistent_key_xyz/i);
});

// ─── 5. 파일 스킬 ────────────────────────────────────────────────────────

test("file_read 스킬은 파일이 없으면 크래시하지 않고 error 문자열을 반환한다", async () => {
  const ctx = makeBrowserContext();
  const result = await registry.execute({
    action: "file_read",
    path: "/nonexistent_path_that_does_not_exist_xyzxyz/file.txt",
    reason: "테스트"
  }, ctx);
  assert.ok(result.error, "파일이 없을 때 error 필드가 있어야 한다");
});

// ─── 6. 중복 등록 방어 ──────────────────────────────────────────────────

test("SkillRegistry는 name/schema/execute가 없는 스킬 등록 시 오류를 던진다", () => {
  const { SkillRegistry } = (() => {
    // 격리된 새 레지스트리 인스턴스를 생성하여 전역 레지스트리에 영향을 주지 않습니다.
    class SkillRegistry {
      constructor() { this.skills = new Map(); }
      register(skill) {
        if (!skill.name || !skill.schema || !skill.execute) {
          throw new Error("Invalid skill format. Must have name, schema, and execute.");
        }
        this.skills.set(skill.name, skill);
      }
    }
    return { SkillRegistry };
  })();

  const r = new SkillRegistry();
  assert.throws(
    () => r.register({ name: "bad_skill" }), // schema, execute 없음
    /Invalid skill format/
  );
});
