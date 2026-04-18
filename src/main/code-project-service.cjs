const fs = require("node:fs/promises");
const path = require("node:path");

const { chat, getTierProviderLabel } = require("./ollama-service.cjs");

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

function pathExists(targetPath) {
  return fs.access(targetPath).then(
    () => true,
    () => false
  );
}

function sanitizeRelativePath(filePath = "") {
  const normalized = String(filePath)
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");

  if (!normalized || normalized.includes("..")) {
    throw new Error(`Unsafe project file path: ${filePath}`);
  }

  return normalized;
}

function extractExplicitProjectName(input = "") {
  const quoted = String(input).match(/["“'`](.+?)["”'`]/)?.[1];

  if (quoted) {
    return quoted.trim();
  }

  const namedMatch =
    String(input).match(/(?:called|named|name it)\s+([A-Za-z0-9 _-]+)/i) ||
    String(input).match(/(?:이름은|이름을)\s+([A-Za-z0-9가-힣 _-]+)/i);

  return String(namedMatch?.[1] || "").trim();
}

function looksLikeSnakeRequest(input = "") {
  return /(snake|스네이크)/i.test(String(input));
}

function looksLikeTodoRequest(input = "") {
  return /(todo|to-do|할 일|task list)/i.test(String(input));
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

function buildFallbackProject(input = "", explicitProjectName = "") {
  const projectName = slugifyProjectName(explicitProjectName || extractExplicitProjectName(input));

  if (looksLikeSnakeRequest(input)) {
    return buildSnakeProject(projectName || "snake-game");
  }

  if (looksLikeTodoRequest(input)) {
    return buildTodoProject(projectName || "todo-app");
  }

  return buildGenericProject(projectName, String(input).trim());
}

function sanitizeProjectFiles(files = []) {
  return files
    .filter((file) => file && typeof file === "object")
    .map((file) => ({
      path: sanitizeRelativePath(file.path),
      content: String(file.content || "")
    }))
    .filter((file) => file.path && file.content);
}

function parseProjectScaffold(raw = "", input = "") {
  const parsed = safeJsonParse(raw);

  if (!parsed || typeof parsed !== "object") {
    return buildFallbackProject(input);
  }

  const explicitProjectName = String(parsed.projectName || parsed.name || extractExplicitProjectName(input) || "").trim();
  const projectName = slugifyProjectName(explicitProjectName);
  const files = sanitizeProjectFiles(Array.isArray(parsed.files) ? parsed.files : []);

  if (!files.length) {
    return buildFallbackProject(input, explicitProjectName);
  }

  return {
    projectName,
    summary: String(parsed.summary || parsed.description || "").trim(),
    files
  };
}

function buildVsCodeFolderUrl(targetPath) {
  return `vscode://file${encodeURI(targetPath)}`;
}

class CodeProjectService {
  constructor({ files, automation } = {}) {
    this.files = files || null;
    this.automation = automation || null;
  }

  async resolveUniqueProjectDir(baseFolder = "generated-projects", projectName = "jarvis-project") {
    const rootPath = this.files.resolvePath(baseFolder);
    let candidate = path.join(baseFolder, projectName);
    let index = 2;

    while (await pathExists(this.files.resolvePath(candidate))) {
      candidate = path.join(baseFolder, `${projectName}-${index}`);
      index += 1;
    }

    await fs.mkdir(rootPath, {
      recursive: true
    });

    return candidate;
  }

  async openProjectInVsCode(projectPath) {
    if (!this.automation || typeof this.automation.execute !== "function") {
      return {
        opened: false
      };
    }

    try {
      await this.automation.execute({
        type: "open_app",
        target: "Visual Studio Code"
      });
    } catch (_error) {
      return {
        opened: false
      };
    }

    try {
      await this.automation.execute({
        type: "open_url",
        target: buildVsCodeFolderUrl(projectPath)
      });
      return {
        opened: true
      };
    } catch (_error) {
      return {
        opened: false
      };
    }
  }

  async createProject(input = "") {
    if (!this.files) {
      throw new Error("File service is not available.");
    }

    const explicitProjectName = extractExplicitProjectName(input);
    let scaffold;
    let provider = getTierProviderLabel("complex");

    try {
      const raw = await chat({
        systemPrompt: [
          "You generate small runnable starter coding projects for a desktop assistant.",
          "Respond with valid JSON only.",
          'Schema: {"projectName":"snake-game","summary":"one sentence","files":[{"path":"index.html","content":"..."}]}',
          "Return 2 to 6 text files.",
          "Keep the project compact and practical.",
          "Prefer HTML/CSS/JS for browser toys and demos unless the user explicitly asks for another stack.",
          "Do not include markdown fences.",
          "Do not use binary files.",
          "Every file must be directly runnable or immediately editable."
        ].join(" "),
        tier: "complex",
        history: [],
        userPrompt: [
          "Create a starter project from this request.",
          explicitProjectName ? `Preferred project name: ${explicitProjectName}` : "",
          `User request: ${String(input).trim()}`
        ].filter(Boolean).join("\n")
      });

      scaffold = parseProjectScaffold(raw, input);
    } catch (_error) {
      scaffold = buildFallbackProject(input, explicitProjectName);
      provider = "fallback-template";
    }

    const baseProjectName = slugifyProjectName(scaffold.projectName || explicitProjectName || "jarvis-project");
    const relativeProjectDir = await this.resolveUniqueProjectDir("generated-projects", baseProjectName);
    const absoluteProjectDir = this.files.resolvePath(relativeProjectDir);
    const writtenFiles = [];

    for (const file of scaffold.files) {
      const relativePath = path.join(relativeProjectDir, sanitizeRelativePath(file.path));
      const result = await this.files.writeFile(relativePath, file.content);
      writtenFiles.push({
        path: result.path,
        bytes: result.bytes
      });
    }

    const vsCode = await this.openProjectInVsCode(absoluteProjectDir);

    return {
      projectName: path.basename(relativeProjectDir),
      projectPath: absoluteProjectDir,
      summary: scaffold.summary || `Created ${path.basename(relativeProjectDir)}.`,
      files: writtenFiles,
      fileCount: writtenFiles.length,
      openedInVsCode: vsCode.opened,
      provider
    };
  }
}

module.exports = {
  CodeProjectService,
  buildFallbackProject,
  buildSnakeProject,
  parseProjectScaffold,
  slugifyProjectName
};
