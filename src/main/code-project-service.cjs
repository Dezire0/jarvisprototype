const fs = require("node:fs/promises");
const path = require("node:path");

const { chat, resolveConfig, isDirectConversationConfigured } = require("./ollama-service.cjs");

const MAX_PROJECT_FILES = 12;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_PROJECT_BYTES = 128 * 1024;
const RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;

function projectError(code, message, details) {
  return Object.assign(new Error(message), { code, details });
}

function safeJsonParse(raw = "") {
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const match = String(raw).match(/\{[\s\S]*\}/);

    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch (__error) {
      return null;
    }
  }
}

function slugifyProjectName(value = "") {
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");

  return normalized || "jarvis-project";
}

function sanitizeRelativePath(filePath) {
  if (typeof filePath !== "string" || !filePath || filePath.length > 240) {
    throw projectError("PROJECT_INVALID_FILES", "The draft contains an invalid file path.");
  }
  const parts = filePath.normalize("NFC").split("/");
  if (parts.some((part) => !part || part.length > 100 || part === "." || part === ".." ||
      /[. ]$/.test(part) || /[\x00-\x1f\x7f<>:"\\|?*\u202a-\u202e\u2066-\u2069]/.test(part) ||
      RESERVED_NAME.test(part) || part.toLowerCase() === ".git")) {
    throw projectError("PROJECT_INVALID_FILES", "The draft contains an invalid file path.");
  }
  return parts.join("/");
}

function buildSnakeProject(projectName = "snake-game") {
  return {
    projectName,
    summary: "A small browser snake game with score tracking and restart support.",
    files: [
      {
        path: "index.html",
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Snake Game</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main class="shell">
      <section class="panel">
        <div class="hud">
          <h1>Snake</h1>
          <div class="stats">
            <span>Score: <strong id="score">0</strong></span>
            <span>Best: <strong id="bestScore">0</strong></span>
          </div>
        </div>
        <canvas id="game" width="480" height="480" aria-label="Snake game board"></canvas>
        <div class="controls">
          <p>Use the arrow keys to move. Press space to restart after a game over.</p>
        </div>
      </section>
    </main>
    <script src="./app.js"></script>
  </body>
</html>
`
      },
      {
        path: "styles.css",
        content: `:root {
  color-scheme: dark;
  --bg: #09111f;
  --panel: rgba(13, 25, 44, 0.86);
  --grid: #13243d;
  --snake: #7fffd4;
  --snake-head: #d7fff1;
  --food: #ff7a59;
  --text: #eef6ff;
  --muted: #8ba3c7;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at top, rgba(127, 255, 212, 0.18), transparent 30%),
    linear-gradient(180deg, #07101d 0%, #050b15 100%);
  color: var(--text);
  font-family: "Avenir Next", "Pretendard", sans-serif;
}

.shell {
  width: min(92vw, 560px);
}

.panel {
  padding: 24px;
  border-radius: 28px;
  background: var(--panel);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
}

.hud {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

h1 {
  margin: 0;
  font-size: 2rem;
}

.stats {
  display: flex;
  gap: 14px;
  color: var(--muted);
  font-size: 0.95rem;
}

canvas {
  width: 100%;
  height: auto;
  display: block;
  background: #081220;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.controls {
  margin-top: 14px;
  color: var(--muted);
  font-size: 0.95rem;
}
`
      },
      {
        path: "app.js",
        content: `const canvas = document.getElementById("game");
const context = canvas.getContext("2d");
const scoreLabel = document.getElementById("score");
const bestScoreLabel = document.getElementById("bestScore");

const gridSize = 24;
const tileCount = canvas.width / gridSize;
const initialBest = Number(localStorage.getItem("snake-best-score") || "0");

let snake;
let direction;
let nextDirection;
let food;
let score;
let bestScore = initialBest;
let gameOver;
let loopId;

bestScoreLabel.textContent = String(bestScore);

function randomTile() {
  return Math.floor(Math.random() * tileCount);
}

function placeFood() {
  let nextFood = { x: randomTile(), y: randomTile() };

  while (snake.some((segment) => segment.x === nextFood.x && segment.y === nextFood.y)) {
    nextFood = { x: randomTile(), y: randomTile() };
  }

  food = nextFood;
}

function resetGame() {
  snake = [
    { x: 9, y: 10 },
    { x: 8, y: 10 },
    { x: 7, y: 10 }
  ];
  direction = { x: 1, y: 0 };
  nextDirection = { ...direction };
  score = 0;
  gameOver = false;
  scoreLabel.textContent = "0";
  placeFood();
}

function drawBoard() {
  context.fillStyle = "#081220";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = "#13243d";
  context.lineWidth = 1;

  for (let line = 0; line <= tileCount; line += 1) {
    const offset = line * gridSize;
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset, canvas.height);
    context.stroke();
    context.beginPath();
    context.moveTo(0, offset);
    context.lineTo(canvas.width, offset);
    context.stroke();
  }
}

function drawSnake() {
  snake.forEach((segment, index) => {
    context.fillStyle = index === 0 ? "#d7fff1" : "#7fffd4";
    context.fillRect(segment.x * gridSize + 2, segment.y * gridSize + 2, gridSize - 4, gridSize - 4);
  });
}

function drawFood() {
  context.fillStyle = "#ff7a59";
  context.beginPath();
  context.arc(
    food.x * gridSize + gridSize / 2,
    food.y * gridSize + gridSize / 2,
    gridSize / 2.8,
    0,
    Math.PI * 2
  );
  context.fill();
}

function drawGameOver() {
  context.fillStyle = "rgba(2, 6, 12, 0.7)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#eef6ff";
  context.font = "bold 32px sans-serif";
  context.textAlign = "center";
  context.fillText("Game Over", canvas.width / 2, canvas.height / 2 - 12);
  context.font = "18px sans-serif";
  context.fillText("Press space to restart", canvas.width / 2, canvas.height / 2 + 24);
}

function tick() {
  direction = nextDirection;

  if (gameOver) {
    drawBoard();
    drawSnake();
    drawFood();
    drawGameOver();
    return;
  }

  const head = {
    x: snake[0].x + direction.x,
    y: snake[0].y + direction.y
  };

  if (
    head.x < 0 ||
    head.y < 0 ||
    head.x >= tileCount ||
    head.y >= tileCount ||
    snake.some((segment) => segment.x === head.x && segment.y === head.y)
  ) {
    gameOver = true;
    drawBoard();
    drawSnake();
    drawFood();
    drawGameOver();
    return;
  }

  snake.unshift(head);

  if (head.x === food.x && head.y === food.y) {
    score += 1;
    scoreLabel.textContent = String(score);
    if (score > bestScore) {
      bestScore = score;
      bestScoreLabel.textContent = String(bestScore);
      localStorage.setItem("snake-best-score", String(bestScore));
    }
    placeFood();
  } else {
    snake.pop();
  }

  drawBoard();
  drawFood();
  drawSnake();
}

window.addEventListener("keydown", (event) => {
  const keyMap = {
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 }
  };

  if (event.code === "Space" && gameOver) {
    resetGame();
    tick();
    return;
  }

  const requestedDirection = keyMap[event.key];

  if (!requestedDirection) {
    return;
  }

  const reversing =
    requestedDirection.x === direction.x * -1 &&
    requestedDirection.y === direction.y * -1;

  if (!reversing) {
    nextDirection = requestedDirection;
  }
});

resetGame();
tick();
loopId = setInterval(tick, 120);

window.addEventListener("beforeunload", () => {
  clearInterval(loopId);
});
`
      },
      {
        path: "README.md",
        content: `# ${projectName}

Open \`index.html\` in a browser to play the game.
Use the arrow keys to move and press space after a game over to restart.
`
      }
    ]
  };
}

function buildTodoProject(projectName = "todo-app") {
  return {
    projectName,
    summary: "A small browser to-do app with local storage persistence.",
    files: [
      {
        path: "index.html",
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Todo App</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main class="shell">
      <section class="panel">
        <h1>Todo App</h1>
        <form id="todoForm" class="composer">
          <input id="todoInput" type="text" placeholder="Add a task" />
          <button type="submit">Add</button>
        </form>
        <ul id="todoList" class="list"></ul>
      </section>
    </main>
    <script src="./app.js"></script>
  </body>
</html>
`
      },
      {
        path: "styles.css",
        content: `body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: linear-gradient(180deg, #f5f7fb 0%, #dfe7f5 100%);
  font-family: "Avenir Next", "Pretendard", sans-serif;
  color: #122033;
}

.shell {
  width: min(92vw, 560px);
}

.panel {
  padding: 28px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.84);
  box-shadow: 0 20px 60px rgba(27, 45, 78, 0.16);
}

.composer {
  display: flex;
  gap: 12px;
}

input {
  flex: 1;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid #c8d4eb;
}

button {
  border: 0;
  border-radius: 14px;
  background: #1447e6;
  color: white;
  padding: 0 18px;
  font: inherit;
}

.list {
  list-style: none;
  padding: 0;
  margin: 18px 0 0;
  display: grid;
  gap: 10px;
}

.list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: #eef4ff;
}

.list li.done span {
  text-decoration: line-through;
  opacity: 0.6;
}
`
      },
      {
        path: "app.js",
        content: `const form = document.getElementById("todoForm");
const input = document.getElementById("todoInput");
const list = document.getElementById("todoList");
const storageKey = "jarvis-todo-items";

let items = JSON.parse(localStorage.getItem(storageKey) || "[]");

function save() {
  localStorage.setItem(storageKey, JSON.stringify(items));
}

function render() {
  list.innerHTML = "";

  for (const item of items) {
    const row = document.createElement("li");
    row.className = item.done ? "done" : "";

    const label = document.createElement("span");
    label.textContent = item.text;

    const actions = document.createElement("div");

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = item.done ? "Undo" : "Done";
    toggle.addEventListener("click", () => {
      item.done = !item.done;
      save();
      render();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      items = items.filter((entry) => entry.id !== item.id);
      save();
      render();
    });

    actions.append(toggle, remove);
    row.append(label, actions);
    list.append(row);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();

  if (!text) {
    return;
  }

  items.unshift({
    id: crypto.randomUUID(),
    text,
    done: false
  });
  input.value = "";
  save();
  render();
});

render();
`
      }
    ]
  };
}

function buildGenericProject(projectName = "jarvis-project", summary = "") {
  return {
    projectName,
    summary: summary || "A lightweight starter project scaffolded by Jarvis.",
    files: [
      {
        path: "README.md",
        content: `# ${projectName}

This project was scaffolded by Jarvis.

## Goal

${summary || "Replace this section with the exact goal of the project."}
`
      },
      {
        path: "index.html",
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body>
    <main>
      <h1>${projectName}</h1>
      <p>${summary || "Project scaffold created by Jarvis."}</p>
    </main>
  </body>
</html>
`
      }
    ]
  };
}

const TEMPLATES = new Map([
  ["web", { name: "web-project", build: buildGenericProject }],
  ["tasks", { name: "task-list", build: buildTodoProject }],
  ["grid", { name: "grid-game", build: buildSnakeProject }],
]);

function validateProjectScaffold(scaffold) {
  if (!scaffold || typeof scaffold.projectName !== "string" || scaffold.projectName.length > 120 ||
      !Array.isArray(scaffold.files) || !scaffold.files.length || scaffold.files.length > MAX_PROJECT_FILES) {
    throw projectError("PROJECT_INVALID_FILES", "The draft must contain a valid folder name and file list.");
  }
  const projectName = slugifyProjectName(scaffold.projectName.normalize("NFC"));
  if (RESERVED_NAME.test(projectName) || Buffer.byteLength(projectName) > 180) {
    throw projectError("PROJECT_INVALID_NAME", "Choose a valid project folder name.");
  }

  let totalBytes = 0;
  const entries = new Map();
  const files = scaffold.files.map((file) => {
    const filePath = sanitizeRelativePath(file?.path);
    const parts = filePath.split("/");
    for (let count = 1; count <= parts.length; count++) {
      const location = parts.slice(0, count).join("/");
      const key = location.toLowerCase();
      const directory = count < parts.length;
      const previous = entries.get(key);
      if (previous && (!directory || !previous.directory || previous.location !== location)) {
        throw projectError("PROJECT_INVALID_FILES", "The draft contains conflicting paths.");
      }
      entries.set(key, { location, directory });
    }
    if (typeof file.content !== "string" || file.content.includes("\0")) {
      throw projectError("PROJECT_INVALID_FILES", "The draft must contain plain-text files.");
    }
    const bytes = Buffer.byteLength(file.content);
    totalBytes += bytes;
    if (bytes > MAX_FILE_BYTES || totalBytes > MAX_PROJECT_BYTES) {
      throw projectError("PROJECT_TOO_LARGE", "The draft exceeds the project size limit.");
    }
    return { path: filePath, content: file.content };
  });
  return {
    projectName,
    summary: typeof scaffold.summary === "string" ? scaffold.summary.trim().slice(0, 300) : "",
    files
  };
}

function parseProjectScaffold(raw = "", preferredName = "") {
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw projectError("PROJECT_INVALID_FILES", "The model did not return a project draft.");
  }
  return validateProjectScaffold({
    projectName: preferredName || parsed.projectName || parsed.name,
    summary: parsed.summary || parsed.description,
    files: parsed.files
  });
}

function projectGuidance(language) {
  const reply = language === "ko"
    ? "로컬 도구에서 코딩 프로젝트 만들기를 열어 주세요. 템플릿을 고르거나 설명으로 초안을 만든 뒤 저장할 수 있습니다."
    : "Open Create coding project from Local tools. Choose a template or draft a project from a description, then review and save it.";
  return { reply, language, actions: [], provider: "local" };
}

class CodeProjectService {
  constructor({ automation, requestModel = chat, modelConfig = resolveConfig } = {}) {
    this.automation = automation;
    this.requestModel = requestModel;
    this.modelConfig = modelConfig;
  }

  async prepareProject({ template, name = "", prompt = "" } = {}) {
    if (typeof name !== "string" || name.length > 120) {
      throw projectError("PROJECT_INVALID_NAME", "Choose a shorter project name.");
    }
    if (TEMPLATES.has(template)) {
      const starter = TEMPLATES.get(template);
      const scaffold = starter.build(slugifyProjectName(name.trim().normalize("NFC") || starter.name));
      return { ...validateProjectScaffold(scaffold), source: { type: "template" } };
    }

    if (template !== "model" || typeof prompt !== "string" || !prompt.trim() || prompt.length > 2000) {
      throw projectError("PROJECT_INVALID_REQUEST", "Enter a project description up to 2,000 characters.");
    }
    const config = this.modelConfig();
    if (!isDirectConversationConfigured(config)) {
      throw projectError("PROJECT_MODEL_REQUIRED", "Choose a direct model in Model settings.");
    }
    let raw;
    try {
      raw = await this.requestModel({
        ...config,
        exactModel: true,
        history: [],
        systemPrompt: [
          "Draft a small starter coding project for the user to review. Never use tools or run code.",
          'Return JSON only with {"projectName":"starter","summary":"one sentence","files":[{"path":"index.html","content":"text"}]}.',
          "Use 1 to 6 compact plain-text files with relative paths. Prefer simple HTML/CSS/JS for web prototypes."
        ].join(" "),
        userPrompt: JSON.stringify({ description: prompt.trim(), preferredName: name.trim() }),
        signal: AbortSignal.timeout(45000)
      });
    } catch {
      throw projectError("PROJECT_MODEL_FAILED", "The model did not respond. Check Model settings and try again.");
    }
    return { ...parseProjectScaffold(raw, name.trim()), source: { type: "model", provider: config.provider, model: config.model } };
  }

  async saveProject(scaffold, selectedFolder, assertAllowed) {
    const { projectName, files } = validateProjectScaffold(scaffold);
    const parent = await fs.realpath(selectedFolder);
    if (!(await fs.stat(parent)).isDirectory()) {
      throw projectError("PROJECT_INVALID_DESTINATION", "Choose an existing folder.");
    }
    const projectPath = path.join(parent, projectName);
    assertAllowed();
    try {
      await fs.mkdir(projectPath, { mode: 0o700 });
    } catch (error) {
      if (error.code === "EEXIST") throw projectError("PROJECT_EXISTS", "That folder name already exists.");
      throw error;
    }

    const created = [];
    const directories = new Map();

    const recordDirectory = async (location) => {
      const identity = await fs.lstat(location, { bigint: true });
      if (!identity.isDirectory()) {
        throw projectError("PROJECT_INVALID_DESTINATION", "The destination changed while saving.");
      }
      directories.set(location, identity);
      created.push({ path: location, identity, directory: true });
    };
    const matchesEntry = async (location, identity) => {
      const actual = await fs.lstat(location, { bigint: true }).catch(() => null);
      return Boolean(actual && actual.dev === identity.dev && actual.ino === identity.ino);
    };
    const sameDirectoryChain = async (directory) => {
      for (let current = directory; directories.has(current); current = path.dirname(current)) {
        if (!(await matchesEntry(current, directories.get(current)))) return false;
      }
      return true;
    };
    const checkDestination = async (directory) => {
      if (!(await sameDirectoryChain(directory))) {
        throw projectError("PROJECT_INVALID_DESTINATION", "The destination changed while saving.");
      }
      assertAllowed();
    };

    try {
      await recordDirectory(projectPath);
      for (const file of files) {
        const parts = file.path.split("/");
        let directory = projectPath;
        for (const name of parts.slice(0, -1)) {
          const next = path.join(directory, name);
          if (!directories.has(next)) {
            await checkDestination(directory);
            await fs.mkdir(next, { mode: 0o700 });
            await recordDirectory(next);
          }
          directory = next;
        }
        await checkDestination(directory);
        const absoluteFile = path.join(directory, parts.at(-1));
        const handle = await fs.open(absoluteFile, "wx", 0o600);
        try {
          created.push({ path: absoluteFile, identity: await handle.stat({ bigint: true }), directory: false });
          await handle.writeFile(file.content, "utf8");
        } finally {
          await handle.close();
        }
      }
      await checkDestination(projectPath);
    } catch (error) {
      let incomplete = !directories.has(projectPath);
      for (const entry of created.reverse()) {
        if (!(await sameDirectoryChain(path.dirname(entry.path))) || !(await matchesEntry(entry.path, entry.identity))) {
          incomplete = true;
          continue;
        }
        const remove = entry.directory ? fs.rmdir : fs.unlink;
        await remove(entry.path).catch((cleanupError) => {
          if (cleanupError.code !== "ENOENT") incomplete = true;
        });
      }
      if (incomplete) {
        throw projectError("PROJECT_PARTIAL", "Some new project files may remain.", { path: projectPath });
      }
      throw error;
    }
    return { path: projectPath, fileCount: files.length };
  }

  async openProjectInVsCode(projectPath) {
    if (!this.automation || typeof this.automation.execute !== "function") return false;
    try {
      await this.automation.execute({ type: "open_app", target: "Visual Studio Code" });
      await this.automation.execute({
        type: "open_url", target: "vscode://file" + encodeURI(projectPath).replace(/#/g, "%23").replace(/\?/g, "%3F")
      });
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = {
  CodeProjectService,
  parseProjectScaffold,
  projectGuidance,
  slugifyProjectName
};
