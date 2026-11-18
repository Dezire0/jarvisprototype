# Jarvis workspace recovery

The desktop workspace opens with the conversation composer, voice controls, and shortcuts to Timer, Tasks, and Notes. Each shortcut opens the corresponding tool over the conversation and focuses its first control. Close Local tools to return to the same conversation. Open the sidebar to see threads, projects, and account settings. The interface uses the system typeface, system light/dark preference until a user chooses an appearance, and a visible focus treatment. Local tools also opens from the account screen.

Use **Command+Shift+Space** on macOS or **Ctrl+Shift+Space** on Windows and Linux to bring Jarvis forward and focus the current command input. **Window → Focus Message Input** is also available from the desktop menu. An open dialog, sign-in, or plan selection keeps its own focus. Bringing an existing window forward preserves its draft and current conversation. On macOS, closing the last window keeps Jarvis available in the menu and by shortcut. Use **Quit Jarvis Desktop** or **Command+Q** to close the app. If you enable the optional floating Quick Panel, the global shortcut opens that panel and the Window menu can still focus the main input.

## Local tools

Select **Local tools** in the workspace toolbar to see tools grouped by purpose. Type a name or keyword into **Find a tool**. Use the arrow keys to move to results. Press Enter to open a focused row or the only matching result. The back button restores the filter and focuses the row you opened. Closing the dialog returns focus to the original workspace control. Desktop-only tools indicate when computer control is required.

Choose **Local command** to run the existing local command syntax. The command field responds to Ctrl+K or Command+K while this tool is open. The standalone `/tools` page still has the command field, timer, tasks, notes, weather and diagnostics available before sign-in.

The conversation composer also recognizes structured timer, task, note and calculator commands. The label **Runs on this device** identifies the route before submission. Press Enter or use the arrow to run the command and view the result under the input. Select **Send to chat** to send the same text to the Assistant instead. A message with an attachment or quote follows the chat route. Voice input in an empty conversation draft uses the same command routing. Try `10분 타이머 맞춰줘`, `note: Read the agenda`, `add task Review the draft`, or `calculate 16 * 3`.

When the conversation already has text, attachments or a quote, the final voice transcript joins the draft for review. The microphone control stops recording or discards a pending transcript. Changing conversations or leaving the workspace ends that listening session, including continuous listening. A result already handed to a transcription provider can finish there. Jarvis discards it if the session has ended. In the legacy renderer, Call Mode starts when you choose it in the current conversation.

Choose **Wake word** next to the microphone to start a session for the current conversation. On macOS, **Start listening on this Mac** uses Apple Speech when it reports on-device recognition for the workspace language. On the first start, grant Speech Recognition and Microphone access when macOS prompts. The helper processes microphone audio on the Mac. After a wake command, the selected chat provider can receive the command text. [Apple Speech permissions](https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition)

**Start on-device listening** uses the browser's local recognition when a language pack is available. Downloading a pack leaves the microphone off. **Start with browser recognition** can send microphone audio to the browser's speech service while listening. Jarvis keeps the selected recognition path for the session. [Web Speech API recognition options](https://w3c.github.io/speech-api/)

Say `Jarvis, set a 10-minute timer` or `자비스, 10분 타이머 맞춰줘`. Saying the phrase alone opens an eight-second window for a follow-up. Jarvis ignores other speech outside that window. A command uses the same local command and chat routing as voice input. With a draft present, the command joins it for review and listening stops. Otherwise wake listening can resume after the command and any reply audio finish. Use **Stop wake word**, start another voice mode, or leave the conversation to stop. Hiding or minimizing the window also stops the macOS helper. The setting is off each time the workspace loads.

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

### Voice output

Open **Voice output** in the desktop sidebar to choose a Korean or English voice engine and preview it. **Device voice** uses an installed on-device voice in the selected language. **Off** hides the read action for that language. A legacy Automatic preference uses a device voice in the workspace. For a named service, expand **Provider settings** to configure its voice and credentials. Save before previewing. Preview reads a fixed sample sentence. Opening settings and saving perform no synthesis.

Open the assistant reply's **More** menu to choose **Read aloud on device** or **Read aloud with** the named service. Reply text is read up to 500 characters. Selecting a service sends that text to it. The workspace reports failure if that service cannot produce sound. Use **Stop reading**, switch conversations, or start the microphone to stop playback. An already submitted provider request may finish. Use **Mute Jarvis** to stop current output and mute new playback.

**Read new replies automatically** starts off for each language. Choose **On this device** or explicitly choose the named service for that language. Changing the manual engine clears any previous named-service opt-in. New completed text replies in the visible regular chat are read once. Temporary conversations, file reviews, action receipts and approval prompts stay available through manual playback. With continuous voice active, Jarvis resumes listening after the reply audio ends, fails or is stopped. The app releases the microphone hold if audio preparation exceeds 20 seconds.

Voice engine, voice and credential settings are shared by accounts using the same desktop profile. Automatic reading preferences are saved for the current account on that profile. New keys use the OS secure store. The saved settings view never returns keys. The workspace `assistant:speak-workspace` IPC accepts the visible engine, language and bounded text. It verifies that the engine matches the saved route and returns audio or a status. Automatic requests add `automatic: true` and require the active account's saved automatic destination. Legacy automatic playback uses its existing entry point.

### Conversation history

Sign in to the same account after reopening Jarvis to see saved conversations in the sidebar. Select a conversation to continue it, or find it through local search. Jarvis saves completed turns, thread titles and project grouping in the Electron app data directory under the signed-in account's namespace. The browser preview uses that account's storage at the current origin.

The saved transcript includes file names and replies. File contents, open prompts, live previews and raw action payloads are excluded from the history file.

Open your profile in the sidebar to edit your display name, choose the workspace language, and manage cloud conversation sync. Save applies all three choices to the current account on this device, and they survive signing in again. The sidebar language buttons also save immediately. **System** follows the system language. The setting applies to workspace controls and new voice recognition sessions. The account entry screen and standalone Local tools follow the system language.

Cloud sync starts off for new profiles. When enabled, cloud search can open a selected conversation and save a local copy. Background sync excludes file review conversations and temporary turns. If saving fails, the dialog retains your draft for retry and the workspace keeps the last saved profile.

### Memory and temporary chat

The desktop Assistant stores conversation recall, project context, indexed documents and saved personal context in a separate on-device store for each workspace account. Relevant excerpts can be included in requests to the configured model. The chat transcript and Assistant recall are separate stores. Legacy unscoped memory stays with the legacy desktop entry point because its account owner is unknown.

In your profile, turn off **Use saved memory** and save to stop reading and updating that memory for new desktop requests. Work already underway follows the previous setting. The open conversation still provides its recent turns, and completed conversations are still saved in the sidebar. Cloud conversation sync has its own preference. Turning saved memory on again makes earlier saved memory available. The default is on. If the workspace cannot load its preferences, it keeps saved memory off for that session.

The desktop workspace sends the preference as `memoryContext.savedMemory` on regular chat requests. The local transport and desktop transcript storage check the account against the current desktop session. Temporary chats retain their separate `memoryMode`.

When Jarvis sends saved memory in a regular model request, **Saved memory sent** lists the categories under the corresponding reply. It reflects the prompt sent to the model. The line contains category labels and stays with the local transcript. Cloud transcript sync carries no memory-category field. Temporary chats, attachment reviews and managed fallback responses omit the line. Recent turns already in the open conversation are separate from saved memory added to the prompt.

Choose **Temporary Chat** from the sidebar. The conversation keeps its own context while open and does not read saved Assistant recall. It does not appear in recent conversations, search or cloud sync. Choose **New Chat** or an existing conversation in the sidebar to return to regular chat. Temporary requests still use the configured model, and actions you explicitly run, including local tasks and notes, still apply.

### Running the desktop UI

Use Node 24. Run `npm run dev` to compile the workspace dependencies and launch Electron. For distribution, `npm run build:desktop-ui` produces the bundled Next UI. In both modes Electron starts the local Assistant, launches the UI on loopback, and verifies that it belongs to the current app session before loading the window. Development prefers port 3310. Set `JARVIS_UI_PORT` to choose a preferred port. An occupied port causes the app to use another local port.

The local chat path is the Electron workspace through Next's same-origin `/api/chat` to the local Assistant transport. Electron attaches a session credential only to chat requests made by its current workspace main frame. The proxy authenticates the request and passes it to the current transport. The credential is process-scoped. A separate browser or an earlier desktop session cannot invoke this chat endpoint.

**Sign in with Google** opens the system browser and leaves the original Jarvis window in place. Return to that window to continue after Google finishes. You can cancel from Jarvis and retry. Email sign-in and Local tools are available from the same account screen.

The cloud plan screen follows sign-in and keeps **Local tools** in the toolbar. Choose Free or Pro and continue to the workspace. A failed plan save keeps the selected option available for retry. Timer, tasks and notes are available locally while plan setup is pending. Desktop users with a temporary sign-in see when it ends.

The proxy preserves streaming and reports HTTP 503 if the local Assistant is unavailable. Cancelling during context loading prevents dispatch on a closed connection. For actions that have already begun, closing the stream does not undo side effects.

The desktop transport shows one message timeline. Chat supports copying assistant replies and exporting Markdown. If a send fails or a response stops before finishing, select **Restore draft** to put the submitted text back in the composer for review. If you're already editing a draft, clear it first. Select attachments again before submitting a recovered request. Restoration does not send the text, and interrupted turns are excluded from the saved transcript.

### Browsing a local folder

Open **Local tools → Browse files**, or enter `browse files` or `폴더 찾아보기`. With Computer control on, select a folder using the system picker. Open listed folders and files within that root. **Parent folder** goes up within the selection. **Choose folder** can select a different root. The listing shows up to 200 regular files and folders and skips symbolic links. Refresh after moving or changing files.

**Preview** shows up to 16 KiB of UTF-8 text in the panel. The file list and preview stay outside chat history and model requests. To send a file to the model, attach it explicitly. Model-classified file listings and reads guide to Browse files. Exact file preview commands still use the local preview.

The desktop `folder:choose` tool opens the system picker. `folder:act` handles refresh, parent navigation, entry selection and preview using the current listing revision.

### Previewing a local file

With desktop computer control enabled, an exact command such as `read file "/path/to/meeting notes.txt"` or `파일 "/경로/회의 메모.txt" 읽어줘` opens a local file preview under the reply. Expand it to read up to the first 16 KiB of a regular UTF-8 file. This preview does not use a model or add a document to memory. Its contents stay in the live workspace and are excluded from the saved transcript and later model requests. Like attachment review, conversations containing a path preview stay out of cloud conversation sync. The local transcript can retain the command and the receipt. For AI analysis, attach the file explicitly.

### Saving a local text file

Open **Local tools → Save file** in the desktop workspace, or enter `save file "/path/to/meeting notes.txt" ::: text` without an attachment or quote. The path and multiline text appear in an editor. With Computer control on, **Save** writes up to 64 KiB of UTF-8 text on this device. The editor and saved text stay outside the model request and conversation history.

New files are created exclusively. For an existing regular file, the system confirmation shows its resolved path and defaults to **Cancel**. If the file changes while confirmation is open, Jarvis retains the draft and asks you to review again. The legacy editor uses the same confirmation. Automated file creation uses new paths. Use an absolute path to select a destination regardless of how Jarvis launched.

### Reading or summarizing the screen

In the desktop workspace, open **Local tools → Read screen** or enter `read screen`, `summarize my screen`, `explain my screen`, or the corresponding Korean command. **Read text** captures one display using the existing Computer control and system screen-capture permissions and reads its text locally. It requires [Tesseract and language data](https://tesseract-ocr.github.io/tessdoc/Installation.html). The app streams the captured image to OCR and returns up to 16,000 bytes of recognized text. Automatic task previews are scoped to the app-managed browser.

Review and edit the recognized text, then use **Attach to draft**. Summary or study commands fill an empty message draft with the corresponding request. An existing draft stays intact. Send explicitly to let your configured model review the attached text. The attachment path handles history and cloud sync as it does for other file reviews. The legacy screen OCR control shows text for the current session, and its study control directs users to the workspace review flow.

### Opening and searching the web

With Computer control enabled, open **Local tools → Open browser** while signed in. Choose **Web address** to open an HTTP or HTTPS address without credentials in your default browser. Choose **Google search** to send a one-line query of up to 200 characters to Google. The request starts when you submit. Keep working in the browser while the conversation draft stays in Jarvis.

The desktop `browser:handoff` tool accepts an `address` or `search` mode and an `input` string. It validates the request and reports whether the OS accepted the handoff. It does not navigate the managed Jarvis browser or read the result. Use **Read web page** for a reviewable text preview.

### Reviewing the current web page

With Computer control enabled, open **Local tools → Read web page**. **Current page** reads a page already open in the Jarvis browser. Enter `read the current page`, `summarize the current page`, or the corresponding Korean command to open that view.

Choose **Web address** and enter an HTTP or HTTPS address without credentials. Commands such as `review url https://example.com/` and `웹 주소 검토 https://example.com/` put the address in the form. **Open and read** visits the address in a fresh browser session with standard TLS validation, reads the page and closes the browser. It requires Playwright Chromium or Chrome and uses a separate session without saved browser logins. The website receives a normal page request after you choose **Open and read**.

Both views show the reported title, final origin and up to 12,000 characters of editable visible text. A page change during the read asks you to try again. Closing the panel discards the preview. A page request already started can finish in its browser session. Review the text and choose **Attach to draft**. The original page, title and address stay in the review panel. The attachment flow sends the edited text when you choose **Send**. The summary command fills an empty composer with a summary request. The legacy Read page button shows its result in the current session.

The desktop `browser:read` tool reads the current managed page. `browser:read-address` accepts an `address` from the signed-in workspace with Computer control enabled.

### Controlling OBS

With Computer control enabled, open **Local tools → OBS** or enter `OBS status`, `start stream`, or `방송 시작`. The panel shows the scene and broadcast state reported by the OBS WebSocket API. Connect explicitly to a WebSocket address. The default is the local OBS server at `ws://127.0.0.1:4455`. Enter any required WebSocket password in the local form. Use **Refresh** to read current state and **Switch scene** to apply your scene selection. [OBS WebSocket protocol](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md#stream-requests)

**Start broadcast** and **Stop broadcast** open a system confirmation with the server and current scene. If OBS or the desktop permission changes during confirmation, review the current state before trying again. The panel displays the reported state after the request and can refresh if OBS is still starting or stopping. Direct OBS controls keep credentials and requests in the desktop app. The legacy controls use the same approval.

### Finding installed apps

In Jarvis Desktop, open **Local tools → Apps** or enter `installed apps` or `설치된 앱 목록`. Use `find app TextEdit` or `앱 찾기 TextEdit` to search by name. With Computer control enabled, the macOS catalog reads known application folders and Spotlight. Each result shows the installed bundle's location so you can distinguish copies of the same app. **Refresh catalog** scans again after apps are added, removed, or moved.

Choose **Open** on a result to send its precise path to macOS. Search again if the app was moved, replaced, or its bundle metadata changed. Direct app requests that encounter same-name results can guide you to this picker. The status reports the OS request. On Windows and Linux the picker shows that their catalog is unavailable.

The desktop `apps:catalog` tool returns an opaque result ID and a catalog revision. `apps:open-selected` uses those values and rechecks the chosen bundle. The local picker never attaches the catalog to a conversation.

### Searching and controlling Spotify

With Computer control enabled, open **Local tools → Spotify** or enter `Spotify controls` or `스포티파이`. A command such as `Spotify search jazz piano` or `스포티파이 검색 재즈 피아노` fills the input locally. **Search on Spotify** opens the search in the browser. You can also paste a supported Spotify share link or URI and choose **Open link**. [Spotify search](https://support.spotify.com/dm/article/search/) · [Share links and URIs](https://support.spotify.com/pg/article/share-from-spotify/)

With Spotify for macOS installed, **Check playback** queries the running app through Apple Events. Playback controls can resume, pause, skip, or go back. Use **Play linked track** to explicitly request playback of a Spotify track link in the running app. Jarvis shows the reported playback state and track details as a snapshot. The app opens only when you request it. On other platforms or when Spotify is unavailable, use the web player. If access is denied, allow Spotify for Jarvis Desktop in macOS System Settings → Privacy & Security → Automation.

Desktop tools expose `spotify:availability`, `spotify:status`, `spotify:control`, `spotify:play-track`, `spotify:open` and `spotify:search`. They require Computer control in the trusted desktop window. The panel shows search and open requests separately from the playback state.

### Finding and managing games

Open **Local tools → Games** or enter `installed games` or `설치된 게임`. With Computer control enabled, Jarvis checks Steam and Epic launcher records on the device. The list includes records whose installation directory exists. It shows whether a library is missing, partly readable, or unsupported. Use **Refresh** after changes to the launcher library.

In **Find a game**, choose Steam or Epic. Commands such as `find game Portal` and `에픽에서 찾기 게임 이름` fill the search field without making a request. **Search Steam** sends the entered name to Steam's US English store index. Select a result before choosing **Send install request to Steam**. The store buttons open a search in the default browser. **Steam Downloads** opens the client download manager. **Open Epic Launcher** hands off to the launcher, where its Library manages installs and updates. Jarvis reports the handoff and leaves install and update progress to the launcher. [Steam downloads and updates](https://help.steampowered.com/en/faqs/view/71ab-698d-57eb-178c) · [Epic launcher Library](https://www.epicgames.com/help/c-32735058/c-Trending_0/managing-the-library-in-the-epic-games-launcher-a14280729)

The desktop `games:list` tool returns the scan, `games:search` returns Steam choices with a revision, and `games:install` accepts an ID from that search. `games:update` hands off to the chosen launcher and `games:store` opens the selected store's search. All require Computer control in the trusted desktop window.

### Creating a coding project

In Jarvis Desktop, enable Computer control and open **Local tools → Create coding project**, or enter `create a coding project` or `코딩 프로젝트 만들기`. Choose a built-in web page, task list or grid-game template. You can also choose **Describe to model** and explicitly send the project description and optional name to the configured API model or Ollama. The model prepares a text draft and the review shows which model responded. Template previews are generated on the device.

Expand the file names to review their plain-text content, then choose **Choose folder and create…**. The system folder picker lets you select the parent folder. Jarvis writes a new child folder named in the review. Choose another location or name if a folder already exists. After saving, use **Open folder** or **Open in VS Code**. The preceding steps leave the files unopened.

The desktop `project:create` tool prepares the draft and returns its review ID. `project:save` accepts that ID and opens the native picker. `project:open` acts on the saved result for the current review ID. All three require the trusted desktop window and computer control.

### Checking for app updates

In Jarvis Desktop, open the sidebar and choose **Updates**. The row shows when a new version is available. The dialog reports the installed version, available version and download status. Choose **Check for updates** to query the configured release feed. The **Check for Updates** application menu also starts a check.

On macOS, choose **Open GitHub releases** to open the configured repository in the default browser. Finish the update using the installer offered there. Native updates on supported Windows and Linux builds download through the app. Choose **Restart to install** when the download is ready. Other package types can open a platform installer. Keep any in-progress work before restarting.

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
| Desktop app updates | Updates panel, native menu and Electron updater | Manual GitHub release handoff on macOS and explicit installer or restart on supported platforms |
| File attachments | Composer, local transport, direct model APIs | Selectable PDF text, other text documents and raster images use a bounded model-only review turn |
| App discovery and explicit bundle launch | macOS app catalog, desktop picker and Electron IPC | Local catalog and selected bundle validation on macOS |
| Direct browser opening and search | Open browser panel and Electron handoff | Opens HTTP(S) addresses and Google queries in the default browser with Computer control enabled |
| macOS/Windows/Linux app operations and managed browser actions | Electron services and browser runtime | Existing routes retained. Native permissions and real apps/sites require manual verification |
| Voice recognition, wake phrase, continuous mode and TTS | Apple Speech helper, browser speech, Voice provider, Electron STT/TTS, Friday | Wake phrase has explicit current-conversation activation. Automatic workspace playback coordinates with continuous and wake listening. Speech engine and microphone availability depend on the runtime |
| OBS connection, status, scenes and broadcast transitions | Desktop OBS panel and Electron OBS WebSocket service | Verified against a loopback protocol fixture. Live OBS and physical confirmation remain to be verified |
| Coding project templates, model drafts and save review | Desktop project creation and Electron project service | Uses built-in templates or a configured direct model and a native destination picker |
| Steam and Epic installed games and store handoffs | Desktop Games panel and Electron game service | Local manifest scan and explicit store or launcher handoff |
| Spotify search, share links and macOS transport | Desktop Spotify panel and Electron Spotify service | Web handoff and macOS Apple Events with explicit status reads |
| Files, OCR and screen briefing | Electron tool services and Friday MCP | Existing implementation retained. Per-capability runtime verification remains open |
| Registration, Google sign-in and saved model state | Worker, D1, and existing onboarding | Account API work tracked in [#19](https://github.com/Dezire0/jarvisprototype/issues/19) |
| OpenClaw planner, memory and direct tool dispatch | Desktop Assistant and memory services | Follow-up tracked in [#7–#11](https://github.com/Dezire0/jarvisprototype/issues) |
