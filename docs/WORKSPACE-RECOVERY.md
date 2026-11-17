# Jarvis workspace recovery

The desktop workspace opens with the conversation composer, voice controls, and shortcuts to Timer, Tasks, and Notes. Each shortcut opens Local tools over the conversation and focuses its first control. Close Local tools to return to the same conversation. Open the sidebar to see threads, projects, and account settings. The interface uses the system typeface, system light/dark preference until a user chooses an appearance, and a visible focus treatment. Local tools also opens from the account and computer-control consent screens.

## Local tools

Open `/tools` in a running desktop UI or select **Local tools**. The command field responds to Ctrl+K or Command+K.

The conversation composer also recognizes structured timer, task, note and calculator commands. The label **Runs on this device** identifies the route before submission. Press Enter or use the arrow to run the command and view the result under the input. Select **Send to chat** to send the same text to the Assistant instead. A message with an attachment or quote follows the chat route. Voice input uses the same command routing. Try `10분 타이머 맞춰줘`, `note: Read the agenda`, `add task Review the draft`, or `calculate 16 * 3`.

| Task | Examples |
| --- | --- |
| Start a timer or focus session | `10분 타이머 맞춰줘`, `timer 10 minutes`, `focus 25` |
| Pause, resume, reset | `pause timer`, `resume timer`, `reset timer` |
| Add and complete tasks | `할 일 추가 초안 검토`, `list tasks`, `complete task 1` |
| Save and read notes | `메모 다음 회의 준비`, `show notes` |
| Calculate or check the time | `calculate (12 + 4) * 3`, `time`, `date` |
| Prepare an external link | `open github`, `search for art & science` |
| Look up weather | `weather`, then choose **Use current location** |
| Read command results | `speak on`, `speak off`, or use the speaker button |
| Inspect support or clear the current result | `help`, `diagnostics`, `clear result` |

**Diagnostics** samples host CPU and memory on demand in Electron. A standalone browser explains that host measurements require the desktop app. **Recent activity** shows up to 35 local workspace changes, including timer, task, and note operations. It stores the operation and time on the device. Clearing the list preserves timers, tasks, and notes.

Timer deadlines, tasks, notes, and spoken-result preferences use the desktop app data directory in Electron and browser storage for the current UI origin when opened in a browser. Timer display uses the stored deadline when the page is reopened. Notifications while Jarvis is closed require a background service. Tasks and notes can be added directly and deleted entries can be restored using **Undo** after deletion. Local commands run in the browser. The weather lookup explicitly asks the user to send a rounded location to Open-Meteo.

## Desktop and API

The account and computer-control flows continue to gate the conversation workspace and native integrations. Existing thread, project, attachment, voice, app-launcher, and model-settings entry points remain in the UI. Action receipts render the reported outcome and show the hostname for opened pages.

### Running the desktop UI

Use Node 24. Run `npm run dev` to compile the workspace dependencies and launch Electron. For distribution, `npm run build:desktop-ui` produces the bundled Next UI. In both modes Electron starts the local Assistant, launches the UI on loopback, and verifies that it belongs to the current app session before loading the window. Development prefers port 3310. Set `JARVIS_UI_PORT` to choose a preferred port. An occupied port causes the app to use another local port.

The local chat path is the Electron workspace through Next's same-origin `/api/chat` to the local Assistant transport. Electron attaches a session credential only to chat requests made by its current workspace main frame. The proxy authenticates the request and passes it to the current transport. The credential is process-scoped. A separate browser or an earlier desktop session cannot invoke this chat endpoint. Accounts and OAuth use their existing flow.

The proxy preserves streaming and reports HTTP 503 if the local Assistant is unavailable. Cancelling during context loading prevents dispatch on a closed connection. For actions that have already begun, closing the stream does not undo side effects.

For a standalone browser preview, run Next on loopback and open `/tools`. Timer, notes, tasks, and calculations remain available in that browser. Live model chat and native operations require the Electron app and configured providers.

Run `npm run check` and `npm run test:node` for syntax and regression checks.

## Capability inventory

| Existing capability | Owning source | Status |
| --- | --- | --- |
| Protocol timer, focus, tasks, notes, local date/time, calculator and links | Local tools workspace and command engine | Implemented for the desktop web UI |
| Protocol weather, spoken responses and appearance | Local tools and theme controls | Wired. Permission-based weather and real speech output require manual verification |
| Protocol telemetry, diagnostics and event stream | Local tools and Electron host diagnostics | On-demand host CPU and memory and recent local tool changes are available |
| Chat, projects, local/cloud history, attachments and model settings | Next workspace and Assistant transport | Existing entry points retained. Chat stream, receipt and unavailable-transport flows checked against a local test assistant |
| macOS/Windows/Linux app operations and browser actions | Electron services and browser runtime | Existing routes retained. Native permissions and real apps/sites require manual verification |
| Voice recognition, continuous mode and TTS | Voice provider, Electron STT/TTS, Friday | Existing controls retained. Real microphone and provider verification remains open, including [#4](https://github.com/Dezire0/jarvisprototype/issues/4) |
| Files, OCR, screen briefing, OBS, music, game and project-generation actions | Electron tool services and Friday MCP | Existing implementation retained. Per-capability runtime verification remains open |
| Registration, Google sign-in and saved model state | Worker, D1, and existing onboarding | Account API work tracked in [#19](https://github.com/Dezire0/jarvisprototype/issues/19) |
| OpenClaw planner, memory and direct tool dispatch | Desktop Assistant and memory services | Follow-up tracked in [#7–#11](https://github.com/Dezire0/jarvisprototype/issues) |
