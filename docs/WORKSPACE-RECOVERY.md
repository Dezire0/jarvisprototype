# Jarvis workspace recovery

The desktop workspace opens with the conversation composer, voice controls, and shortcuts to Timer, Tasks, and Notes. Each shortcut opens Local tools over the conversation and focuses its first control. Close Local tools to return to the same conversation. Open the sidebar to see threads, projects, and account settings. The interface uses the system typeface, system light/dark preference until a user chooses an appearance, and a visible focus treatment. Local tools also opens from the account screen.

## Local tools

Open `/tools` in a running desktop UI or select **Local tools**. The command field responds to Ctrl+K or Command+K.

The conversation composer also recognizes structured timer, task, note and calculator commands. The label **Runs on this device** identifies the route before submission. Press Enter or use the arrow to run the command and view the result under the input. Select **Send to chat** to send the same text to the Assistant instead. A message with an attachment or quote follows the chat route. Voice input in an empty conversation draft uses the same command routing. Try `10분 타이머 맞춰줘`, `note: Read the agenda`, `add task Review the draft`, or `calculate 16 * 3`.

When the conversation already has text, attachments or a quote, the final voice transcript joins the draft for review. The microphone control stops recording or discards a pending transcript. Changing conversations or leaving the workspace ends that listening session, including continuous listening. A result already handed to a transcription provider can finish there. Jarvis discards it if the session has ended. In the legacy renderer, Call Mode starts when you choose it in the current conversation.

| Task | Examples |
| --- | --- |
| Start a timer or focus session | `10분 타이머 맞춰줘`, `timer 10 minutes`, `focus 25` |
| Pause, resume, reset | `pause timer`, `resume timer`, `reset timer` |
| Add and complete tasks | `할 일 추가 초안 검토`, `list tasks`, `complete task 1` |
| Save and read notes | `메모 다음 회의 준비`, `show notes` |
| Calculate or check the time | `calculate (12 + 4) * 3`, `time`, `date` |
| Prepare an external link | `open github`, `search for art & science` |
| Look up weather | `weather` or `날씨`, then search for a city and choose a match |
| Read command results | `speak on`, `speak off`, or use the speaker button |
| Inspect support or clear the current result | `help`, `diagnostics`, `clear result` |

**Diagnostics** samples host CPU and memory on demand in Electron. A standalone browser explains that host measurements require the desktop app. **Recent activity** shows up to 35 local workspace changes, including timer, task, and note operations. It stores the operation and time on the device. Clearing the list preserves timers, tasks, and notes.

Timer deadlines, tasks, notes, and spoken-result preferences use the desktop app data directory in Electron and browser storage for the current UI origin when opened in a browser. The stored deadline determines when the timer ends, including on return to Jarvis. In a conversation, **Timer finished** appears below the toolbar and opens that timer. Local tools shows the same status. Each run records one completion, and the spoken-result preference can read it aloud when the workspace is open. Start a new timer or reset the current one to clear its completion. Notifications while Jarvis is closed require a background service. Tasks and notes can be added directly and deleted entries can be restored using **Undo** after deletion. Local commands run in the browser.

An exact weather command in the conversation composer opens **Weather** in Local tools. You can also open it from the Local tools page without an account. Opening Weather sends no request. Submitting a city name sends only the search term to [Open-Meteo's Geocoding API](https://open-meteo.com/en/docs/geocoding-api). Selecting a match sends coordinates rounded to two decimal places to the [Weather Forecast API](https://open-meteo.com/en/docs). Browser users can also choose **Use current location** and grant permission. The desktop app uses the city flow without changing Electron location permissions. Weather requests bypass the chat API, and Jarvis does not save searches or results.

## Desktop and API

The first screen offers Local tools immediately. After signing in, use **Computer control** in the workspace toolbar to review, enable, or revoke computer control. Control starts off when a profile first uses this native setting, including profiles that accepted the earlier consent screen. The last saved choice applies to accounts using that desktop profile and survives changes to the app's local address. The Mac Accessibility settings are in the Help menu.

With control off, the conversation uses a directly connected API model or Ollama and can review files you attach. The planner, direct desktop actions, live previews, and app launcher require computer control. Enabling it preserves existing action confirmations and OS permissions. Turning it off blocks new requests for computer actions and clears pending continuations. Work already underway can finish. Action receipts render the reported outcome and show the hostname for opened pages.

### Model settings

In a new conversation, select the local command example to put it in the composer. Review it and send it to run on the device. Use the local tool buttons to open the timer, tasks or notes directly. An example appears when the draft is empty.

The first conversation screen offers **Model settings** when the desktop requires model setup. This checks saved settings without sending a test request. Model errors also link to the same dialog.

Open **Model settings** in the sidebar to choose the provider and model. Save before testing. **Test connection** sends a short prompt to the saved direct API or Ollama model and reports whether it replied. A hosted provider may count the test toward its usage. Jarvis performs no test when you open settings. The result applies to that request and model.

Ollama accepts a server address such as `http://127.0.0.1:11434` and lists installed models on request. OpenAI-compatible servers that accept unauthenticated requests can use a custom address without a key. Leave a password field blank to retain its key. When you change the OpenAI-compatible server origin, supply its own key or leave the field blank to clear the old key. **Groq voice input** is configured separately when another provider handles chat. CLI-backed models depend on the user's CLI login and computer-control setting.

### Optional Jarvis Cloud fallback

Desktop conversation uses the configured model first. Set `JARVIS_ENABLE_CLOUD_AI_FALLBACK=1` in the desktop environment to allow ordinary signed-in conversations to use the managed Worker when the configured model fails. If no model has been selected, open **Model settings** to connect one. Use `JARVIS_CLOUD_API_BASE` to point a test or private installation at its Worker base URL. Use HTTPS or an HTTP loopback address for local testing.

Fallback sends the current request and up to ten recent text turns in that account's conversation. The fallback returns text and labels a successful reply with **Jarvis Cloud** and its model. Temporary chats and attachment review use the configured model path. Free and Pro use the same account endpoint, and both draw on their respective Jarvis Cloud allowance. See the [Worker setup](../backend/README.md#managed-cloud-chat).

### Conversation history

Sign in to the same account after reopening Jarvis to see saved conversations in the sidebar. Select a conversation to continue it, or find it through local search. Jarvis saves completed turns, thread titles and project grouping in the Electron app data directory under the signed-in account's namespace. The browser preview uses that account's storage at the current origin.

The saved transcript includes file names and replies. File contents, open prompts, live previews and raw action payloads are excluded from the history file.

Open your profile in the sidebar to edit your display name, choose the workspace language, and manage cloud conversation sync. Save applies all three choices to the current account on this device, and they survive signing in again. The sidebar language buttons also save immediately. **System** follows the system language. The setting applies to workspace controls and new voice recognition sessions. The account entry screen and standalone Local tools follow the system language.

Cloud sync starts off for new profiles. When enabled, cloud search can open a selected conversation and save a local copy. Background sync excludes file review conversations and temporary turns. If saving fails, the dialog retains your draft for retry and the workspace keeps the last saved profile.

### Memory and temporary chat

The desktop Assistant stores conversation recall, project context, indexed documents and saved personal context in a separate on-device store for each workspace account. Relevant excerpts can be included in requests to the configured model. The chat transcript and Assistant recall are separate stores. Legacy unscoped memory stays with the legacy desktop entry point because its account owner is unknown.

When Jarvis sends saved memory in a regular model request, **Saved memory sent** lists the categories under the corresponding reply. It reflects the prompt sent to the model. The line contains category labels and stays with the local transcript. Cloud transcript sync carries no memory-category field. Temporary chats, attachment reviews and managed fallback responses omit the line. Recent turns already in the open conversation are separate from saved memory added to the prompt.

Choose **Temporary Chat** from the sidebar. The conversation keeps its own context while open and does not read saved Assistant recall. It does not appear in recent conversations, search or cloud sync. Choose **New Chat** or an existing conversation in the sidebar to return to regular chat. Temporary requests still use the configured model, and actions you explicitly run, including local tasks and notes, still apply.

### Running the desktop UI

Use Node 24. Run `npm run dev` to compile the workspace dependencies and launch Electron. For distribution, `npm run build:desktop-ui` produces the bundled Next UI. In both modes Electron starts the local Assistant, launches the UI on loopback, and verifies that it belongs to the current app session before loading the window. Development prefers port 3310. Set `JARVIS_UI_PORT` to choose a preferred port. An occupied port causes the app to use another local port.

The local chat path is the Electron workspace through Next's same-origin `/api/chat` to the local Assistant transport. Electron attaches a session credential only to chat requests made by its current workspace main frame. The proxy authenticates the request and passes it to the current transport. The credential is process-scoped. A separate browser or an earlier desktop session cannot invoke this chat endpoint.

**Sign in with Google** opens the system browser and leaves the original Jarvis window in place. Return to that window to continue after Google finishes. You can cancel from Jarvis and retry. Email sign-in and Local tools are available from the same account screen.

The cloud plan screen follows sign-in and keeps **Local tools** in the toolbar. Choose Free or Pro and continue to the workspace. A failed plan save keeps the selected option available for retry. Timer, tasks and notes are available locally while plan setup is pending. Desktop users with a temporary sign-in see when it ends.

The proxy preserves streaming and reports HTTP 503 if the local Assistant is unavailable. Cancelling during context loading prevents dispatch on a closed connection. For actions that have already begun, closing the stream does not undo side effects.

The desktop transport shows one message timeline. Chat supports copying assistant replies and exporting Markdown. If a send fails or a response stops before finishing, select **Restore draft** to put the submitted text back in the composer for review. If you're already editing a draft, clear it first. Select attachments again before submitting a recovered request. Restoration does not send the text, and interrupted turns are excluded from the saved transcript.

### Previewing a local file

With desktop computer control enabled, an exact command such as `read file "/path/to/meeting notes.txt"` or `파일 "/경로/회의 메모.txt" 읽어줘` opens a local file preview under the reply. Expand it to read up to the first 16 KiB of a regular UTF-8 file. This preview does not use a model or add a document to memory. Its contents stay in the live workspace and are excluded from the saved transcript and later model requests. Like attachment review, conversations containing a path preview stay out of cloud conversation sync. The local transcript can retain the command and the receipt. For AI analysis, attach the file explicitly.

### Saving a local text file

Open **Local tools → Save file** in the desktop workspace, or enter `save file "/path/to/meeting notes.txt" ::: text` without an attachment or quote. The path and multiline text appear in an editor. With Computer control on, **Save** writes up to 64 KiB of UTF-8 text on this device. The editor and saved text stay outside the model request and conversation history.

New files are created exclusively. For an existing regular file, the system confirmation shows its resolved path and defaults to **Cancel**. If the file changes while confirmation is open, Jarvis retains the draft and asks you to review again. The legacy editor uses the same confirmation. Automated file creation and project scaffolds use new paths. Use an absolute path to select a destination regardless of how Jarvis launched.

### Reading or summarizing the screen

In the desktop workspace, open **Local tools → Read screen** or enter `read screen`, `summarize my screen`, `explain my screen`, or the corresponding Korean command. **Read text** captures one display using the existing Computer control and system screen-capture permissions and reads its text locally. It requires [Tesseract and language data](https://tesseract-ocr.github.io/tessdoc/Installation.html). The app streams the captured image to OCR and returns up to 16,000 bytes of recognized text. Automatic task previews are scoped to the app-managed browser.

Review and edit the recognized text, then use **Attach to draft**. Summary or study commands fill an empty message draft with the corresponding request. An existing draft stays intact. Send explicitly to let your configured model review the attached text. The attachment path handles history and cloud sync as it does for other file reviews. The legacy screen OCR control shows text for the current session, and its study control directs users to the workspace review flow.

### Controlling OBS

With Computer control enabled, open **Local tools → OBS** or enter `OBS status`, `start stream`, or `방송 시작`. The panel shows the scene and broadcast state reported by the OBS WebSocket API. Connect explicitly to a WebSocket address. The default is the local OBS server at `ws://127.0.0.1:4455`. Enter any required WebSocket password in the local form. Use **Refresh** to read current state and **Switch scene** to apply your scene selection. [OBS WebSocket protocol](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md#stream-requests)

**Start broadcast** and **Stop broadcast** open a system confirmation with the server and current scene. If OBS or the desktop permission changes during confirmation, review the current state before trying again. The panel displays the reported state after the request and can refresh if OBS is still starting or stopping. Direct OBS controls keep credentials and requests in the desktop app. The legacy controls use the same approval.

### Reviewing attached files

Use **Add Attachment** or drop files into the conversation composer. The composer shows a filename for each selected file. You can preview an image or remove a file before pressing send. Voice input places the transcription in the draft when attachments are present so you can review the submission.

Supported files are selectable-text PDF, UTF-8 TXT, Markdown, CSV, JSON, HTML, XML and CSS, plus PNG, JPEG and WebP. The limits are four files and 4 MiB total, with up to 64 KiB for each text file and 2 MiB for each image. HTML, XML and CSS are read as text.

Jarvis reads PDFs on the device with a bundled PDF.js worker. A PDF can contain up to 40 pages and 64 KiB of extracted text. The attachment shows how many pages have text. On send, the model receives the filename, original page numbers, and extracted text. Image-only pages and page layout are excluded. If the entire file is image-only or requires a password, Jarvis asks for a selectable-text or unlocked copy.

Sending provides the files to the configured direct model. Jarvis supports the Ollama, Gemini, Groq and OpenAI-compatible API paths for file review. The model must support images to review an image. A file review returns text and has no access to computer actions. The live conversation keeps filenames and the answer. File bytes stay out of subsequent chat requests and background chat synchronization. Reattach a file when a later request needs its contents.

Provider references include [Ollama vision](https://docs.ollama.com/capabilities/vision), [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding), [Groq vision](https://console.groq.com/docs/vision) and [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision).

For a standalone browser preview, run Next on loopback and open `/tools`. Timer, notes, tasks, and calculations remain available in that browser. Live model chat and native operations require the Electron app and configured providers.

Run `npm run check` and `npm run test:node` for syntax and regression checks. For browser checks, install Playwright Chromium and start the bundled UI with `HOSTNAME=127.0.0.1 PORT=3310 node build/desktop-ui/templates/cloud/server.js`. Run `JARVIS_UI_TEST_URL=http://127.0.0.1:3310 node --test tests/ui/*.test.cjs`. These checks use local account and conversation fixtures, intercepted weather requests, and synthetic recognition, location, and speech output.

## Capability inventory

| Existing capability | Owning source | Status |
| --- | --- | --- |
| Protocol timer, focus, tasks, notes, local date/time, calculator and links | Local tools workspace and command engine | Implemented for the desktop web UI |
| Protocol weather, spoken responses and appearance | Local tools and theme controls | Weather supports city selection in Electron and a browser current-location option. Physical location permissions and real speech output require manual verification |
| Protocol telemetry, diagnostics and event stream | Local tools and Electron host diagnostics | On-demand host CPU and memory and recent local tool changes are available |
| Chat, projects, local/cloud history and model settings | Next workspace and Assistant transport | Existing entry points retained. Chat stream, receipt and unavailable-transport flows checked against a local test assistant |
| File attachments | Composer, local transport, direct model APIs | Selectable PDF text, other text documents and raster images use a bounded model-only review turn |
| macOS/Windows/Linux app operations and browser actions | Electron services and browser runtime | Existing routes retained. Native permissions and real apps/sites require manual verification |
| Voice recognition, continuous mode and TTS | Voice provider, Electron STT/TTS, Friday | Existing controls retained. Real microphone and provider verification remains open, including [#4](https://github.com/Dezire0/jarvisprototype/issues/4) |
| OBS connection, status, scenes and broadcast transitions | Desktop OBS panel and Electron OBS WebSocket service | Verified against a loopback protocol fixture. Live OBS and physical confirmation remain to be verified |
| Files, OCR, screen briefing, music, game and project-generation actions | Electron tool services and Friday MCP | Existing implementation retained. Per-capability runtime verification remains open |
| Registration, Google sign-in and saved model state | Worker, D1, and existing onboarding | Account API work tracked in [#19](https://github.com/Dezire0/jarvisprototype/issues/19) |
| OpenClaw planner, memory and direct tool dispatch | Desktop Assistant and memory services | Follow-up tracked in [#7–#11](https://github.com/Dezire0/jarvisprototype/issues) |
