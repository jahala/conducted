# Conductor UI map

Scope: the user-facing UI as built in `renderApp-DeUrsznk.js` (R) and `main-BE1h_1MP.js` (M). Companion to `frontend.md` and `sessions-and-chats.md` in this folder. Read-only analysis. Nothing was executed.

Legend:
- VERIFIED @N = read in the extracted code. `@N` is a character offset in the renderApp bundle unless prefixed `M@`. Re-find with `scripts/conductor-re/ctx.py`.
- INFERRED = reasoned from names, props or surrounding code.
- UI labels are quoted exactly as they appear in the bundle.
- `Cmd` = macOS Command key. `Alt` = Option.

Corrections to `frontend.md`:
- `/remote-control` is not a top-level route. It is `/settings/user/remote-control`. VERIFIED @11784338.
- `/settings/user/ports` is a redirect to `/settings/user/connections`. VERIFIED @11783578.
- `/automations/*` routes redirect to `/routines/*`. VERIFIED @12033000.
- Extra routes: `/profile/$orgSlug/$userId`, `/dev/simulated-route-error`, `/settings/repos`, `/settings/organization/github`, `/settings/user/{appearance,key-bindings,terminal}`. VERIFIED @11783496, @12032296.

---

## 1. App shell

### 1.1 Window regions

```
+--------------------------------------------------------------------------------+
| traffic lights | [left-sidebar toggle] [back] [forward]            (drag region) |
+--------------+-----------------------------------------+-----------------------+
| LEFT SIDEBAR | CENTER PANEL  (id "main-content", 70%)  | RIGHT PANEL (35%)     |
| resizable    |  workspace header                       |  git-panel (top, 50%) |
| collapsible  |  tab strip (chat / terminal / file /    |   tabs: All files,    |
|              |   comment / PR / browser / desktop)     |   Changes, Checks,    |
|  nav         |  tab content (chat list, diff, file...) |   Artifacts, Desktop, |
|  org switch  |  [progress line] [queue] [composer]     |   Chat                |
|  sections    |                                         |  ------------------   |
|  workspaces  |                                         |  scripts-panel (bot.) |
|  footer      |                                         |   Setup | Run |       |
|              |                                         |   Terminal N | Ports  |
+--------------+-----------------------------------------+-----------------------+
```

- Shell component `NIa` wraps every route under `main-layout`. It holds the resizable left sidebar (persisted width, min and max) and the content area. VERIFIED @10559519.
- Left sidebar open state and right panel open state are two settings. They are toggled by `Cmd+B` and `Cmd+Alt+B`. Zen mode closes both. VERIFIED @11394496.
- The workspace route is a horizontal panel group `right-panel-layout`: `main-content` (default 70, min 30), a drag handle, and `right-panel` (default 35, min 30, collapsible). VERIFIED @10202175 (`r5a`), @5024274 (`Yso`).
- The right panel is a vertical group `workspace-right-panels-<localId>`: `git-panel` (default 50, min 0) over `scripts-panel` (default 50, min 20, collapsible, collapsed size constant). VERIFIED @5024274.
- Panel library: a `react-resizable-panels` style API (`defaultLayout`, `onLayoutChanged`, `collapsible`, `panelRef`). Layout ids are persisted per workspace. VERIFIED @5024274.
- Global overlays mounted once at the root: toaster, notification and update hooks, a "surface" layer that keeps browser previews and terminals alive and positioned over anchors, and custom Minimize, Maximize and Close buttons on Linux. VERIFIED @11671285, @11701611, @11702799.
- Traffic lights are inset by a CSS variable `--traffic-lights-clearance`. The toggle buttons shift right of it. VERIFIED @2049674.
- Header areas carry `data-tauri-drag-region`. VERIFIED @5518193.

### 1.2 Organization modes (changes what the shell shows)

| Mode | Evidence | Effect on UI |
|---|---|---|
| Local (personal) org | `ol(org)==="local"` | Sidebar nav: Dashboard (flag), Home, Create, Search. Repo sidebar with status or project grouping. Remote control allowed. |
| Cloud (team) org | `ol(org)==="cloud"` | Adds Routines, Pull requests (flag), team avatars on Home, "Shared" and "Following" sections, Pokes, workspace chat, cloud desktop, Share dialog, org settings. Home becomes the default landing route. |
| SSO-gated org | `u9(org)`, "Requires single sign-on" | Content replaced by a sign-in gate. |
| Enterprise data privacy | setting | Hides organizations, cloud workspaces and custom MCP. |

VERIFIED @10404800 (sidebar nav), @10377244 (org menu), @10560871 (`PIa` SSO gate), @11502876 ("Cloud disabled").

### 1.3 Status areas

- Resource usage chip and its "Resources" popover, behind the setting "Show sidebar resource usage" (VERIFIED @11109622). This is the bundle's only resource view; the earlier note here (a flat table "grouped by workspace" with a "Copy resource usage" button) read the same component in part. VERIFIED in renderApp-DeUrsznk.js at the offsets given:
  - Chip (`b9a` @10365784, `v9a` @10366425): mounted in the sidebar's top strip before Go back (@10538807). A 12px Lucide `microchip` icon and the app's own memory in 11px tabular figures, a 1px sidebar border, `rounded-md`, `px-2 py-1`, named "Resource usage: <memory>". The memory is every process except terminals' and agents' (label "Claude Code", "claude", "Codex", "codex" or "node") and anything those started (`rgo` @5569944). Hidden below 200px of sidebar width, icon only (the name as its tooltip) below 260px, and absent until the first reading. The popover opens at the chip's end, 8px below, at least 360px wide (or the sidebar less 24px), with no padding.
  - Data (`Mer` @10350785, `zka` @10352010): Tauri `get_resource_usage {terminalLabels}` every 2 s while the setting is on; rows whose command holds `<defunct>` are dropped. A row is `{pid, ppid, label, command, copyCommand, cpuPercent, memoryKb, terminalId, cwd}` (Rust strings). Terminal labels are "Terminal <n>", "Repository terminal" and "Terminal tab <n>" (`jer` @10350996). The Rust shell runs `ps -eo pid=,ppid=,ucomm=,args=` (which lists `ps` itself, under Main), reads memory with `proc_pid_rusage`, and matches `WebKit.WebContent`, `WebKit.Networking`, `WebKit.GPU`, `conductor-runtime sidecar`, "Codex" and "Claude Code" (strings in the installed binary, 0.94.1). The screenshot shows the labels Main, Renderer, Networking, Sidecar, conductor-runtime and ps.
  - Header (`qka` @10357218, @10359791): "RESOURCES" (`text-xs font-medium uppercase tracking-wide`, muted), and four 14px icon buttons at the right, `rounded-sm p-1`, foreground when on and muted when off, each named by its `title`: `square-terminal` "Include terminal processes" / "Exclude terminal processes" (off at first; off hides every row with a `terminalId`); `layers` "Group by workspace" / "Ungroup processes" (on at first); `git-fork` "Switch to tree view" / "Switch to flat view" (tree at first); `copy` "Copy resource usage", a check and "Copied" once copied (@10361128); a failed copy calls `St.error("Failed to copy resource usage", error)`, where `St` comes from another chunk and is the same call the app uses for log lines; whether it also shows a toast was not read.
  - Summary: "CPU <n>% Memory <n>" (`text-sm`; the words muted, the CPU figure medium) summed over the shown processes. CPU has one decimal; memory is whole KB, MB with one decimal, or GB with two (`TT`, `s9` @5569343).
  - Table: Name, CPU, Mem headers (`text-2xs`, muted, sticky), each a sort button with a chevron (up for ascending, down for descending) on the sorted column only (`r5t` @10353650). Sorting starts on memory, high first; a new column starts at Name A to Z, CPU and Mem high first; choosing the sorted column flips it (store `Cw` @10352212). The view (sort, toggles, folded groups, Show all) lives in a store for the app's run.
  - Groups (`Wka` @10353260, `vPi` @5568938): "App" first for processes in no workspace, then one group per workspace, named by its folder (`directoryName`) and sorted by name. A process belongs to a workspace when its terminal id starts with the workspace's id or its working folder is inside the workspace. A group row shows a chevron (pointing up while open), the name, and the group's CPU and memory; clicking it folds the group (`Gka` @10356063).
  - Tree (`G7t` @5570081): a process sits under its parent when the parent is in the same list, indented 12px a level from 24px (16px ungrouped). Siblings sort by their whole subtree's CPU or memory, the other figure breaking ties, then pid; each row shows its own figures (`Fer` @10354212). Flat view (`q7t` @5570998, `$er` @10355178) sorts each process by its own figures.
  - "Show all (<n>)", where n counts the shown processes, appears once there are more than seven; it grows the table from 220px to 60% of the window and reads "Show less" while open (@10364554).
  - The copied text (`yPi` @5571346) is "CPU <n>% Memory <n>", then one line per shown process in tree or flat order (ungrouped): "<label> <cpu> <memory> (pid=<n> ppid=<n> cmd=<command> ws=<workspace>)".
- Update notice: "Will automatically restart when all agents are idle", "Restart when idle", "See changes". VERIFIED @12095445.
- macOS version warning with dismiss button. VERIFIED @10374081.
- Dock badge, native notifications and sounds (see Settings > General). frontend.md lists the commands.
- Composer status line: queue, progress steps, context wheel (see 3.5).

---

## 2. Screens per route

Route tree: root > `/login` | `auth-guard` > (`/settings/*`, `/diagnostics`, three onboarding routes, `main-layout`). VERIFIED @11704796, @12030500.

| Route | Component | Purpose and main parts |
|---|---|---|
| `/login` | `XWt` | "Sign in to continue." Logo loader, sign-in button, "Privacy" link, error hint with support mail. VERIFIED @10583225-10584340 |
| `/` | `nEs` | Landing. Cloud org: redirects to `/all-workspaces`. Local org: logo and an add-project block (INFERRED; "Open project", "Open GitHub project", "Quick start" strings exist @1719080), restores last route and last workspace on launch (skips archived). VERIFIED @2049674, @12030500 |
| `/repository/$repositoryId/workspace/$localWorkspaceId` | `n5a` | The workspace screen (section 3). Search params carry the active tab (see 3.2). VERIFIED @10199568 |
| `/all-workspaces` ("Home") | `rCa` | Card grid of all workspaces. Search, filters (owners, projects, active or archived, routine origin), sort, "Display" card fields, pinned group, paging by 50. Empty: "No matching workspaces", "Create a workspace", "Clear filters". VERIFIED @10266416 |
| `/dashboard` | `xka` | Kanban board of workspaces by status: Backlog, In progress, In review, Done, Canceled. Drag a card to change status. Project filter chips (top 5 plus more). Empty: "New workspace". Flag-gated by setting "Dashboard". VERIFIED @10338972, @10349050 |
| `/create` | `Csl` | Full-page new-workspace flow (setting "New workspace page"). Same parts as the New workspace dialog (3.9). VERIFIED @11792731 |
| `/pull-requests` | `Dll` | Cloud org only. List of PRs, infinite scroll, "No pull requests yet", "Couldn't load pull requests". Internal flag. VERIFIED @12025990 |
| `/routines` | `Bol` | Cloud org only. Table: Name, Runs, Last run, Next run, Author, Created, Run button, actions. Empty: "Add your first routine", "New routine", "You haven't created any routines yet." Also "Suggested routines". VERIFIED @11912205-11926530 |
| `/routines/new`, `/routines/new/$suggestionId`, `/routines/$automationId`, `/routines/$automationId/fork` | `yqt`, `tar` | Routine editor (3.12). |
| `/profile/$orgSlug/$userId` | `XEa` | Team profile: activity heatmap ("Last 12 months", Less/More), "Longest streak", "Chats per day", Chats, Workspaces, Tokens, "Models", "Loadout", "Poke", "Equip". Errors for other org or not a member. VERIFIED @10296304-10318808 |
| `/settings/*` | `_rl` | Settings (section 6). |
| `/diagnostics` | `GIa` | "Diagnostics: Capture information about your environment to help diagnose issues." Shell, PATH and env capture. Buttons: copy redacted or full report, "Create a new session with the redacted report attached", "Copy logs (may include personal data)", "Restart". Env values are hashed except a safe list. VERIFIED @10574506-10581565, @10560871 |
| `/first-run-onboarding` | `Ssl` > `Ktr` > `rRa` | Three video slides plus sign-in (section 7). "Exit onboarding" button top right. VERIFIED @11792371 |
| `/new-member-onboarding` | `dor` | Joining a shared org. Not read in detail. INFERRED from route and the internal setting "New member onboarding state". |
| `/cloud-collab-onboarding` | `uor` | "Welcome to the new Conductor", "Workspaces now run in the cloud", connect GitHub, cloud computer colour picker, "Skip". VERIFIED @11548768-11561699 |
| `/dev/simulated-route-error` | `wsl` | Dev-only error boundary test. VERIFIED @12032296 |

Search params of the workspace route (validated by zod `Kae`): `activeTabType` (`session`, `terminal`, `special`), `sessionId`, `terminalTabId`, `specialTabMode` (`file`, `comment`, `browser`, `desktop`, `pr`), `specialTabPath`, `specialTabFileMode` (`diff`, `edit`), `specialTabFileContentMode`, `specialTabLineNumber`, `specialTabCommentId`, `specialTabBrowserUrl`, `specialTabPullRequest`, `gitPanelTab`, `gitDiff`. VERIFIED @2052404-2084282. When none are set, the route restores the last active search for that workspace. VERIFIED @12030500.

---

## 3. The workspace screen

### 3.1 Workspace header (top of center panel)

Left to right, for a local workspace (`ePi` and `nPi`, VERIFIED @5513500-5521500, read again 2026-11-07):
- Breadcrumb: the repo's icon and name (a menu: "Repository settings", "Open on GitHub"), a chevron, then the branch (`u0o`): a click renames it in place; right click offers "Copy" (`C`) and "Rename" (`R`).
- An ellipsis button (`Kpo`) whose popover holds "Target branch" and the branch picker.
- Follow button ("Follow workspace" or "Unfollow workspace", cloud orgs only).
- Avatars of creator and watchers.
- Cloud badge and status for cloud workspaces: "Conductor Cloud", Status, CPU, Memory, Disk, "Low disk", "Agent cost", Restart. VERIFIED @5611925-5623840.
- The directory name as small muted text, only when it differs from the branch, then the "Open in..." button (`yC` with no label: the default app's icon and a menu arrow). Its menu lists the apps and ends with "Copy path".
- When the right panel is closed, PR and git action buttons move into the header.
- Right edge: "Toggle right sidebar".

The local header has no workspace name, "Rename workspace" button or "Workspace actions" button. Those sit in the cloud workspace's hover card (`NPi`, @5625630) and, for every workspace, in the sidebar row's right-click menu below.

"Workspace actions" menu (also the sidebar row menu, VERIFIED @5558200-5563900):
- Mark as read or Mark as unread (`R`).
- Pin or Unpin (`P`).
- Set status: Backlog, In progress, In review, Done, Canceled.
- Move to section (submenu with sections, "New section...").
- Follow or Unfollow. Reassign to (teammate list).
- Rename. Copy link (`Cmd+Shift+C`).
- Internal items: Copy workspace info, Roundhouse PR state (Stored branch, Associated PRs, "Link PR...", Workspace folder HEAD, Other worktrees), Copy workspace public URL, Copy sandbox id, Open sandbox logs, Copy SSH command.
- Archive (`Cmd+Shift+A`) or Unarchive. Start (for unstarted workspaces).

Share dialog (cloud): "Share", "People with access", "General access" (Private workspace, others), permission Read or Write, "Add people", "Remove access", "Discard access changes?". VERIFIED @5497424-5512457.

### 3.2 Center tab strip and tab types

Tab strip (`xZi`, `G4a`, `W4a`; VERIFIED @10076000-10094500):
- Tab types: chat, terminal, file, comment, PR, browser, cloud desktop. Each has an icon and a close button. Middle-click closes.
- Chat tab: status icon (typing, waiting, setting-up, needs attention), title, unread dot. Width fixed (`w-44`).
- Chat tab context menu: "Mark as read" or "Mark as unread", "Rename chat", "Fork to new tab" (`Cmd+Alt+Enter`, experimental), "Copy concise transcript" (`Cmd+Alt+C`), "Copy full transcript", "Copy link", "Copy session info" (internal), "Close tab" (`Cmd+W`), "Close others".
- Terminal tab: "Terminal N" with local or cloud host icon ("Close terminal N").
- Comment tab: "Comment by <author>". PR tab: "PR #N". Browser tab: the URL host. Desktop tab: "Cloud desktop".
- "+" new tab menu: "New chat" (or "New chat, same files"), "Browser", "Local terminal", plus "Cloud terminal" on cloud workspaces. `Cmd+T`. The buttons disable at the tab limit (`isAtClosableTabLimit`); "Tab Freak Mode" raises it to 10. VERIFIED @10087381-10091398.
- "View chat history" button opens the list of all chats, including closed ones. "Loading chats", "No open chats" with "New chat". VERIFIED @2086010, @2093263.
- Split panes: with setting "Split tabs", the strip becomes a tree of groups. Tabs drag between groups or to an edge to split. A drag ghost follows the cursor. `Cmd+D` split is registered but hidden. VERIFIED @10092178, @10138921, @10208300.
- Terminals can also be dragged from the right-panel terminal into the center. Setting "Big terminal mode" creates them in the center with `Cmd+Shift+T`. VERIFIED @10208300, @11104241.
- The drag goes both ways, and only with "Split tabs" on. A right-panel terminal tab drags as `right-terminal`, labelled "Terminal" (@4993207). The center moves the terminal, places its tab at the drop (a strip index, a group, or an edge split) and opens it (@10209498). While a center terminal tab is dragged, the whole right panel is a drop zone (@4395873); a drop there moves the terminal and makes it the panel's active terminal, or is refused with "Maximum 5 terminals allowed" when the panel holds five (@4999333). The terminal keeps its id: the moves are `ngn` and `sgn` (M@2967452, M@2968393). When the panel's active terminal leaves, the one before it becomes active, or the next when it was first (M@2962576). VERIFIED.
- Error cards: "This chat tab failed to render", "Tabs failed to load" with Retry. VERIFIED @10065307, @10128649.
- Archived workspace: "Workspace archived. Unarchive this workspace to view files, terminals, and browser previews." VERIFIED @10062089.

Tab content:
- Chat: message list + composer (3.3 to 3.6).
- File (`specialTabMode=file`): viewer with `diff` or `edit` mode. Diff has "Unified view", "Split view", "Entire file". Edit uses CodeMirror (find and replace bar: Replace, Replace All, Previous, Next). "Toggle file edit mode" is `Cmd+E`. Previews exist for Markdown, SVG (View raw SVG code, View rendered SVG), images, PDF, CSV, video. "View options": "Hide whitespace changes", "Wrap lines". "File changed on disk": "Discard my edits", "Keep mine". VERIFIED @9629615-9643573, @9959555, @9856436.
- Comment: one review comment, "Loading comment...", "Comment not found".
- PR: "PR title" (editable), "Description", "Activity", Checks, Review, Merge, "Open on GitHub". VERIFIED @9982885, @10044498-10057491.
- Browser: in-app preview with "Reload", "Open in browser", "Port and path" picker, "Starting preview...", an annotation overlay (Agentation, "Add to chat"). Setting "In-app browser preview". VERIFIED @11676490-11695750, @11671285.
- Desktop ("Cloud desktop"): remote desktop stream with "Reconnect", states "You need edit access to use the cloud desktop", "Cloud desktop is available in cloud workspaces". VERIFIED @2987339-2991628.
- Empty group: three buttons "New chat", "Browser", "Local terminal". VERIFIED @10090765.
- No chats in the workspace: "No open chats" with "New chat". For local workspaces a missing chat is auto-created. VERIFIED @2092274.

### 3.3 Chat view

List (VERIFIED @9608198, frontend.md section 5): one virtualized item per turn, sticky "Scroll to bottom", per-turn error boundary ("This chat turn failed to render", "Other turns are still available.").

Message and turn items seen in the UI:

| Item | Labels and behaviour | Evidence |
|---|---|---|
| User message | Attachments, mention chips, "Sent via" or "Sent from another session" (cross-session messages). Hover actions include revert. | @9521544-9547608 |
| Not-sent state | "Message not sent" with Retry and Discard. | @8136350, @9343485 |
| Queued edit banner | "Editing queued message" with Cancel. | @8138015 |
| Assistant text | Markdown (Tufte option), Mermaid ("Rendering diagram...", "Expand diagram", "Copy Mermaid source", zoom in, zoom out, reset), callouts (Note, Tip, Important, Warning, Caution), code blocks with copy, images, video player. | @8047584-8096997 |
| Thinking | Collapsible "Thinking" card. Global search "Find in messages and thinking". | @8798797 |
| Turn footer | "Copy final message", "Copy summary", hover card with start to end time, Fast mode state, Input, Output, Cache read, Cache write tokens. More menu: "Fork to new tab", "Fork to new workspace", "Reset chat", copy options. File-change summary with "Open diff". | @9586422-9590500 |
| Reset dialog | "Reset chat?" "Later messages will be deleted." Checkbox "Also reset files" with changed-file count. Buttons Cancel and Reset (`Cmd+Enter`). | @9573311 |
| Banners in the list | "Interrupted by user", "Chat history compacted", "Compacting...", "Claude Code session limit reached", "Authentication required" (sign in to Claude in the workspace terminal), "ChatGPT login expired", "Codex authentication required", "Cursor API key required", "Image too large" (5MB limit), "This message could not be displayed." | @9511126-9562178 |
| Unread jump | "Next unread" button. | @8183776 |
| Empty chat starters | "Review recent PRs", "Improve agent instructions", "Fix a TODO", "Read the docs". | @9379800 |
| Archived or read-only composer bar | "This workspace is archived." with "Unarchive"; "This workspace is read-only." | @9383052, @9397918 |

Tool cards (registry in frontend.md section 5). Extra UI labels (VERIFIED @8749000-8845000):
- Edit and Write: "Open in editor", "Edit", diff body, "Claude Code has to retry the file edit because of a bug in its permissions logic. Just a moment!".
- Todo: "No todos", "Todo started", "Todo completed". Tasks: "Task created", "Task details" with Status, Subject, Blocked by, Blocks.
- Glob, "List files", Bash with "Clear output", "Formatted" and "Raw" JSON toggle, "Input:".
- Plan: "Enter plan mode", "Propose plan".
- Skill: "Skill activated". Slash command: "Slash command".
- Conductor MCP cards: "Workspace diff", "Review comments", "Code review comments", "Get terminal output" (shows source and line count), "User input" (AskUserQuestion).
- Other: "Node REPL", "Subagent", images ("Preview image", "Loading image"), "Search tools", "Start monitor", "Stop task".
- Unknown tools fall back to a generic card.
- Conductor MCP display names include "Workspace summary", "List computers", "Read computer configuration", "Create computer configuration", "Read computer build status", "Update repository setup script". VERIFIED @8537881.

Approval card (`XYo`, VERIFIED @8830523-8833000):
- Title by tool: "Do you want to run this command?", "...on your Mac?" (RunLocalCommand), "...make these changes?", "...run this agent?", "...do this search?", "...fetch this page?", "...run this tool?".
- Shows the tool card itself or the decision reason. Badge "Subagent".
- Buttons: "Yes" (`Enter`), a secondary label such as "Yes for this session", "Allow all edits during this session" or "Yes always" (`Cmd+Enter`), optional tertiary, "No" (`Backspace`).
- "Network access" card with Deny and Approve. VERIFIED @8173658.
- Local-command approvals can set "Always allow local commands" (Settings > Advanced).

Plan approval (`dca`, VERIFIED @9259644): bar with "Sending to <chat>" picker, "Copy", "Hand off" (tooltip "Send plan to a new chat for implementation"), "Approve" (`Cmd+Shift+Enter`, tooltip "Execute plan in current chat"). A feedback box can reject the plan. Sidebar status text: "Review plan". The bar shows only while a plan waits and plan mode is on (VERIFIED @9314918); the key acts under the same condition (@9295497). Approve and the key run one action: with text in the composer it sends the text as the plan's adjustments, otherwise it approves (@9313268). In a chat that is not Codex, the adjustments answer the plan as not approved with the text as feedback, then plan mode goes to the default permission mode, the composer clears, and the text is queued as a new message with the composer's attachments (VERIFIED @9313048). A Codex chat approves with the text as feedback instead (@9312390); ours has no Codex plan review, so a Codex chat never has a waiting plan (issue #668). The composer's plain send while a plan waits answers it as not approved with no feedback, then sends the text and files as any message, with the chat's send mode (onSubmit @9393948, the answer @9394185); plan mode stays as it is. A waiting plan does not stop files being sent without text (Dca @9279453).

Question UI (`CUi`, VERIFIED @8144303): wizard with one page per question. Header, question, option list with descriptions, multi-select, secret input, "Other..." free text (`0`), previous and next (arrow keys), number keys `1..9` pick options, `Enter` submits, buttons Submit and "Cancel agent". Sidebar status text: "Answer question". Answers return as text "question / answer / (Skipped)".

Progress tracker ("Agent pizza tracker", internal flag): the agent calls `mcp__conductor__UpdateProgress` with `{title?, blocks[]}`. Block types: `bar {label,value,max,detail}`, `steps [{label,status: pending|in_progress|done|failed}]`, `text`. The composer shows the current step with "· 2/5" and a status colour. VERIFIED @8744247, @9379800.

Context wheel: radial progress that appears above 70% or always (setting "Always show context usage"). Hover card: "Context", "Window used", token breakdown (Input, Cached input, Output, Reasoning output), model, effort, thinking, service tier, "Fast mode", Requested vs Returned metadata (internal). Notes: "Context window size not yet available.", "Context usage is unavailable for Cursor." VERIFIED @8855401-8876144.

Checkpoint controls:
- Revert: hover a user message, then "Reset chat" (dialog above). Codex uses `numTurnsToRollback`.
- Fork: "Fork to new tab" (same workspace) and "Fork to new workspace". Needs a checkpoint ("Unable to fork chat" otherwise).
- Diff scope "turn": the Changes tab can show only one turn's changes. VERIFIED @2758800 (`type:"turn"`).

Search in chat: `Cmd+F`, next `Cmd+G`, previous `Cmd+Shift+G`, "Scroll to current match" `Cmd+Alt+J`. VERIFIED M@3782527.

### 3.4 Message queue and steering

(`Zca`, `sua`, VERIFIED @9323000-9360500)
- Queue box above the composer, role listbox "Queued messages". Header shows a status label, "Resume" when paused, "Collapse queue" or "Expand queue".
- Row: attachment thumbs ("Queued attachments"), preview text, hover actions Edit or "Save edit", Steer, Delete.
- Shortcuts: `E` edit, `Backspace` delete, `Enter` steer, `Escape` cancel edit, `Cmd+Enter` "Save and steer".
- Errors: "Failed to delete queued message", "Failed to reorder queued messages", "Failed to resume queue", "Failed to retry message", "Failed to steer queued message".
- Reorder by drag (aria "Reorder"). Setting "Follow-up behavior" chooses Queue or Steer as the default.
- Send button icon and tooltip switch between "Send message", "Queue message" and "Save edit". `data-testid="composer-send-button"`. VERIFIED @8914288.
- Opposite behaviour: `Cmd+Enter` in default mode ("Submit with opposite follow-up behavior").

### 3.5 Composer

Editor: TipTap/ProseMirror. Placeholder "Write something ...". Container has `aria-label="composer"`. Draft per session is kept in a store. VERIFIED @9000620, @9316469.

Triggers (VERIFIED @9309104-9310300):
- `@` mentions: files and directories (fuzzy search), plans (`plan:` items), current terminal output ("Attach current terminal output"), linked directories ("Select working directories"), teammates and artifacts in the pre-workspace composer. Selecting "add directory" opens the linked-directories dialog.
- `#`: pull requests and issues. Selecting writes a PR context file and inserts a chip.
- `/`: built-in commands, project slash commands and skills ("Skills" group).
- A fourth trigger with character `§` exists for saved snippets. INFERRED from `Add snippet`, `Insert snippet` (`Cmd+;`).

Built-in slash commands (VERIFIED @8845900):

| Command | Description | Agents |
|---|---|---|
| `/clear` | Close this tab and start a fresh chat | claude, codex |
| `/restart` | Restart the agent process. Useful to pick up config changes. | claude, codex |
| `/add-dir` | Link a directory or workspace (not in cloud workspaces) | claude, codex |
| `/personality` | Choose Codex's personality for this session and future ones | codex |
| `/goal` | Set the objective Codex should keep working toward | codex |
| `/mcp-status` | View MCP server connection status | claude, codex |
| `/mcp`, `/agents`, `/hooks`, `/memory`, `/permissions`, `/plugins` | "Manage ... (opens terminal)" | claude (mcp also codex) |
| `/compact` | Compact the context window | claude, codex |
| `/ultracode` | Enable Ultracode | claude |
| `/plan` | Enter plan mode or Exit plan mode | per agent |
| `/fast` | Enable or Disable fast mode ("uses extra credits", "uses credits 2x faster" for Codex, Cursor's faster variant) | per agent |

Terminal-effect commands show a bar: "Run /x in the embedded terminal", "Complete /x below, then click done", "Terminal command finished. Refresh to use the updated config here". VERIFIED @9261100.

Codex goal bar: placeholder "Goal", "Save goal" (`Cmd+Enter`), "Pause goal", "Resume goal", "Edit goal", "Clear goal". VERIFIED @9369318-9372025.

Toolbar (VERIFIED @8905906-8917278, @9236012-9262000):
- "+" menu ("Add attachments, link issues, and more"): "Link issue" (`Cmd+I`, Linear), "Link workspaces", "Plan mode" or "Exit plan mode" (`Shift+Tab`, text turns link-coloured), "Add attachment" (`Cmd+U`), "Add snippet" (`Cmd+;`).
- Model picker button (`AVt`, `tca`): opens with `Cmd+/`.
  - Favourites list ("loadouts", up to 5, select with `Cmd+Ctrl+1..5`, reorder, "Add models", "Edit").
  - Submenus: "Agent" (Claude Code, Codex, Cursor, plus OpenCode, Pi, Muse as ACP agents), "Model", "Effort" (levels vary per model; "Not supported for this model"), toggle "Fast" (`Cmd+Shift+E`).
  - Search box "Search models", "No models found".
  - Switching agent or model in a started chat shows "Opens in new chat". Toasts warn that switching model or effort mid-chat slows the next reply and costs more tokens.
  - `Cmd+Shift+/` cycles effort.
- Chip "Auto-accept edits" (tooltip "Disable auto-accept edits").
- Context wheel, MCP status button (INFERRED placement).
- Speech to text button (waveform while recording, "Stop recording", "Transcribing..."). `Ctrl+Shift+D`. Setting "Voice mode". Uses Deepgram or on-device speech.
- "More composer actions" menu (narrow layouts): Add attachment, Speech to text, MCP status, Plan mode.
- Send or Queue or Save button, Stop button (tooltip "Cancel", `Cmd+Shift+Backspace`).
- Attachments: file picker, drag and drop, paste. "Paste copied files as paths" (`Cmd+Shift+V`). Pasted text over 5000 characters becomes a text attachment (setting). Images over 5MB fail.
- Composer can minimize when a content tab is open. VERIFIED @9279442 (`Lca`).

Pre-workspace composer (new workspace dialog) uses the same editor with `@` for teammates, artifacts and files, and `/` for commands. VERIFIED @10156437.

### 3.6 Right panel top: git panel

Tab strip (`Ge` ghost buttons; VERIFIED @2553200-2557500): `Artifacts` (setting "Show Artifacts tab"), `All files`, `Changes` (count badge), `Checks`, `Desktop` (cloud), `Chat` (team workspace chat). Right side: "Review" button (tooltip "Get an AI code review", `Cmd+Shift+R`) with split item "Edit before sending". Review creates a new chat.

Header status chip and action (state machine `r9i`, VERIFIED @2142000-2149500). Title text and button by state:

| State | Title text | Main action |
|---|---|---|
| Merged | "Merged" | none |
| In merge queue | queue state text | none |
| No PR, has changes | "Changes" | "Create PR" (`Cmd+Shift+P`) |
| Agent working, no PR | "Working..." | none |
| Uncommitted files | "Uncommitted changes" | "Commit and push" (`Cmd+Shift+Y`) |
| Behind remote | "Behind by N commit(s)" | Pull (`Cmd+Shift+L`, "Pull latest from main") |
| Ahead of remote | "Ahead by N commit(s)" | Push |
| Diverged | "Incompatible with remote" or "Remote branch was rebased" | Resolve |
| Conflicts | "Merge conflicts" | "Resolve" (agent resolves) |
| Changes requested | "PR changes requested" | "Add all comments to chat" |
| Draft PR | "Draft PR open" | "Ready for review" |
| Checks failing | "N / M checks failed, K pending" | "Fix errors" (`Cmd+Shift+X`) |
| Checks pending | "N checks pending..." | Automerge button (if enabled) |
| Review required | "PR review required" | "Approve" if reviewer, else waiting text |
| Blocked | "Blocked from merging" | none |
| Ready | "Ready to merge" | "Merge" (`Cmd+Shift+M`), label from repo merge method, "Merge stack" for stacks |
| Stack blocked | stack message | none |
| Unable | "Unable to merge" | none |
| Loading | "Loading PR info...", "Checking mergeability...", "No internet connection", "GitHub access required", "PR info unavailable" | Retry |

Also `Cmd+Shift+G` "Open PR". Create PR sends the agent a message (frontend.md section 7). PR title and description are editable inline ("PR title", "PR description", Save, Discard).

Tabs:
- **All files** (`tree`): file tree with Material file icons, virtualised. Row menu: "View", "Attach in chat", "Copy path", "Copy relative path", "Discard changes". Quick open `Cmd+P` ("Open file picker") and search in files `Cmd+Shift+F` (Match case, Whole word, Regular expression). Filter box "Filter files".
- **Changes**: list of changed files with status, +/- lines, "Viewed" checkbox (`Ctrl+V`), conflict badge, "Filter changed files". Toggle "Show flat list" or "Show folder hierarchy". Options menu (diff scope): "Current branch", "Target branch" picker ("Select target branch..."), "All changes", "Uncommitted changes" (`Cmd+Alt+U`, shows "N files changed"), per-commit entries (message, short hash, author, date), and per-turn scope. A back button returns to "All changes". Stack view: "Stack PRs", "Current", "(trunk)", "gt restack", "Checkout this branch", "Ready for review". Empty: "Changes appear here.", "No git status", "Finish rebasing or merging to see changes", "No files match this filter", "Some untracked files are not shown."
  - Click a file to open a file tab in diff mode. Keyboard: `ArrowUp` and `ArrowDown` move between files, `Cmd+Alt+J` and `Cmd+Alt+K` move between comments, `Cmd+Shift+D` opens the diff view.
- **Checks** (`pr-status`): PR header, Git status, "Checks" (Running, Failed, Cancelled, Pending, Waiting with logs; "Re-run failed checks", "Queue checks"), "Deployments" (Deployed, Failed, Deploying, Pending, Inactive; provider icons Vercel, Cloudflare, Netlify, Render, Railway, Fly.io, AWS Amplify, Heroku, GitHub Pages), "Comments" (per comment: Resolved, Outdated, "Add to chat", "Hide", "Resolve"; "Add all to chat"), reviewers with states (Approved, Changes requested, Commented, Dismissed, Awaiting review), "Request review", "Review required".
- **Artifacts**: team artifacts, templates, "Community artifacts", "From Conductor". Dialogs "Template" and "Artifact" ("Use in chat"). VERIFIED @11330000-11345000. Flag-gated.
- **Desktop**: cloud desktop stream. **Chat**: workspace chat between teammates ("Message workspace chat", "Online", "No messages yet"). VERIFIED @3012162, @3015224.

Diff and review comments:
- Diff renderer: `@pierre/diffs` (frontend.md). Inline comment box placeholder "Add a comment for the AI". Comment card: author "You", Edit comment, Delete comment, "Suggested change" block. "Discard comment?" dialog (Keep editing, Discard). VERIFIED @9730040-9740205.
- Comments are stored in `diff_comments` and read by the agent through the `GetDiffComments` and `DiffComment` MCP tools.
- Warnings: "Dismiss diff rendering warning", "Only whitespace changes found" with "Show whitespace changes", "Binary file changed", "Updating diff". VERIFIED @9741101, @9970155.

### 3.7 Right panel bottom: scripts and terminal panel

`Uso` (VERIFIED @4994265-5023627). Tabs:
- **Setup**: output of the setup script. States: "Running setup script...", "Setup script failed" with a "fix it?" prompt (sends a fix request to the chat; the original text uses a long dash), "Cancelled setup script", "Detecting setup script...", "Stopping setup script...", empty "No setup script output / Setup script output will appear here after running setup." If none exists: "Add setup script" with "Ask agent" or "Add manually" and the text "Run commands when a workspace is created to install dependencies or set up the environment". Logs: "Couldn't load the logs.", "No logs were recorded, or they have expired.", "Recover prompt".
- **Run**: runs an action (task) chosen in a select ("Select task"). Button text: "Run <label>", "Run <label> again", "Stop <label>", "Starting...", "Stopping...", "Start spotlight". Shortcut `Cmd+R` ("Start or stop action"). If none exist: "Run tests or a development server to test changes in this workspace", "Add action", "Add action manually", "Configure actions". Add-action dialog: "Action name", "Can run in" (Terminal, Cloud, Local), icon picker ("Search icons", "No icons found").
- **Terminal N** tabs: xterm.js, "New terminal" (`Cmd+T` when focused), "Close terminal" (`Cmd+W`), "Find in terminal" (`Cmd+F`), "Open terminal". Max count shown as "Maximum N terminals allowed". Cloud workspaces show host tabs "Cloud" and "Local" plus file-sync states ("Sync files is off", "Sync folder unavailable", "Sync files failed", "Local terminal unavailable").
- **Ports**: special tab id `ports`.
- Panel can collapse. `Cmd+J` toggles it ("Toggle terminal panel").
- Preview and open buttons: "Open" and "Choose preview URL" (the Run tab URL, ports detected from output, repo "Preview URLs" template with `$CONDUCTOR_PORT`). "Open localhost URL" `Cmd+Shift+B`. A detected app (browser, Electron) can be activated instead.

Run vs Spotlight (VERIFIED @4994265, settings text):
- Setting "Use spotlight testing" (repo scope): "Replace Run with Spotlight for this repository so workspace changes are tested in the repository root." The Run tab then shows "Start spotlight". The backend restores the pre-spotlight state on stop (frontend.md).

Port forwarding (VERIFIED @5432173-5457681, @4419387-4421898, @10434919):
- Popover "Forward ports": "Ports detected", "Ports unavailable", "Remote port" input with "Forward port", "Add port", "Cancel forwarding port", "Forward to localhost", "Auto-forwarding", "Select a port to share via a URL. Workspace read permissions required.", "Preview URL" with "Copy preview URL", move up and down.
- Button "Start forwarding" (`Cmd+Y`) and a "Waiting for ports" state.
- Sidebar row shows a "Forwarding ports" icon. Port 22 is rejected ("reserved for SSH").
- Settings > Connections: "Exclusive port forwarding", "Forwarding strategies", "Local port range" (first and last), "Manual overrides" (Remote to Local).

### 3.8 Workspace status model (sidebar dot, Home card, tab icons)

Verified in `CWt`, `wMe`, `YZi` (@10225603-10228000).

- Session aggregate status order: `needs_plan_response` > `needs_user_permission` > `needs_user_input` > `working` > `cancelling` > `waiting` > idle.
- Workspace lifecycle labels: Unstarted, Setting up, Failed.
- Git and PR derived labels, first match wins: Merged, In merge queue, Ready to merge, Draft pull request, Merge conflict, Checks failing, Checks running (git status only), Pull request open, Local workspace, Ready (has branch).
- Status words (in the workspace hover card that opens after 700ms over a sidebar row, and on Home cards; the sidebar row itself is one line with no subtitle, VERIFIED @10437578, @10452011): "Review plan", "Need permission", "Answer question" (all in the unread colour), "Planning...", "Working...", "Cancelling...", "Waiting...", "Initializing...", "Initialization failed", "Setting up...", "Archiving...". VERIFIED @10324184-10325904.
- Row icon: unread dot, typing loader, waiting loader, setting-up loader, red alert, or a branch glyph. Optional "status matrix" canvas animation for working local workspaces (setting "Workspace status matrix for local workspaces"). VERIFIED @8904800 (`vQo` canvas), @11107549.
- Kanban status (user-set, separate): Backlog, In progress, In review, Done, Canceled, each with its own colour token `--status-*`. VERIFIED @5541996.

### 3.9 New workspace flow

- Entry points: sidebar "Create" (`Cmd+N`), per-section "Create in section", repo "+" in project grouping, Home, Dashboard "New workspace", command palette "Create workspace", deep links (`path`, `branch`, `prompt`). VERIFIED @11627532.
- Dialog "New workspace" ("Draft the first message, then create and send it.") or the full page `/create`. Parts: repo picker ("Switch repo", "Repository on <host>", "Add repository"), "Create from" toggle (`Cmd+I`): PRs, Branches, Issues (Linear, GitHub), target branch picker, prompt editor ("What do you want to work on?" / "Describe what you want to build"), model picker, plan mode, attachments, section picker ("Create in section"). Buttons "Create workspace" (or "Create"), "Start" (for backlog items), "Add to backlog" (`Alt+Enter`). Toasts "Creating workspace...", "Added to backlog". "Recover prompt" restores a failed draft. VERIFIED @10142000-10200000, @11436000-11520000.
- Repo creation helpers: "Open project", "Open GitHub project" (clone dialog "Clone GitHub repo": Repository URL, Location, Browse, Recent repos), "Quick start" ("Create project": Project name, Parent folder, Template; "Create a private GitHub repo?"). VERIFIED @1719080, @1892935, @2035595, @1957504.
- Git work after submit is in frontend.md section 6.

### 3.10 Other workspace-level dialogs

- Quick open (`Cmd+P`), Search in files (`Cmd+Shift+F`), Link issue (Linear picker: "Connect Linear", "Search issues...", "No open issues found"), Link workspaces and directories ("Select working directories", "Link a directory or workspace"), MCP status ("MCP status", "No MCP servers configured.", "Refresh MCP status", logs), "Link pull request" ("PR URL or number"), "Edit PR title", "Rename workspace", "Rename chat", "Cloud desktop". VERIFIED @5533305, @5676809, @9984311, @11507939, @11542839.
- "Open in" app menu: Finder, Cursor, VS Code, Zed (+Preview, Nightly), VSCodium, Devin Desktop, Sublime Text, PyCharm, IntelliJ IDEA (several editions), Android Studio, Xcode, Rider, RubyMine, WebStorm, PhpStorm, Ghostty, Alacritty, iTerm, WezTerm, Warp, Hyper, Terminal, GitHub Desktop, Sourcetree, Fork, Kaleidoscope, GoLand, DataGrip, Trae, Antigravity. `Cmd+O` opens in the default app, `Cmd+Shift+O` opens the menu. VERIFIED @495317 (`BK`).

### 3.11 Workspace chat, pokes (cloud orgs)

Team chat panel, "Poke" and "Poke back" toasts, presence "Online", avatars of active members next to Home. VERIFIED @3015224, @11669096, @10404800. Gated by settings "Pokes" and internal "Workspace chat".

### 3.12 Routine editor (cloud orgs)

Fields: Title ("Untitled routine"), Enabled switch, Status, Repository, Agent and model, "Prompt" ("What should this routine do?"), Triggers. VERIFIED @11995698-12000604.
- Trigger types: Scheduled (Every hour, Every day at, Every weekday at, Every week on <weekday> at, or a cron field with placeholder `0 9 * * *`), GitHub (Pull request event with filters on field, operator, author, branch), Webhook ("Post JSON to this URL to run the routine.", "Copy webhook URL", "Rotate secret", "Webhook triggered", "Activates when you save").
- Tabs or sections: "Triggers", "Prompt", "Runs" ("No runs yet"), "Version history" with "Revert to this version" and "Current".
- Dialogs: "Unsaved Changes" (Discard, Keep Editing), "Rotate webhook secret?", "Delete <name>?", "Revert to version N?".
- Save shortcut `Cmd+S` ("Save routine").

---

## 4. Left sidebar

Component tree: `GAa` (sidebar) with `R8a` (nav), org switcher `CRt`, section list `Ttr`/`ETa`, pinned `J7a`, shared `eTa`, workspace row `jU`. VERIFIED @10406408, @10458500-10481601.

Top to bottom:
1. Window controls row: "Toggle left sidebar", "Go back", "Go forward" (`Cmd+[`, `Cmd+]`).
2. Organization switcher (account menu): current org name, other orgs (`Ctrl+1..9`), "Create organization", "Upgrade to Pro", "Settings", "Log out", user info copy items (internal). SSO orgs show "Requires single sign-on". VERIFIED @10377244-10386666.
3. Nav rows, each with hover shortcut hint: Dashboard (flag), Home (`Cmd+Shift+H`), Create (`Cmd+N`, shows a draft marker when the new-workspace draft is non-empty), Routines and Pull requests (cloud only), Search (`Cmd+K`). VERIFIED @10406408.
4. Section "Pinned": collapsible, count when collapsed, drop target ("Drag a workspace here"). aria "Pinned workspaces". `data-workspace-pinned-drop`. VERIFIED @10461981.
5. User sections (table `navigation_sections`): name, optional emoji, collapse, count, "Create in section", row actions menu, "New section...", rename, "Delete section". Drag workspaces between sections. Errors: "Couldn't move workspace", "Couldn't reorder section", "Couldn't delete section". VERIFIED @10458500, @10477589, @10521742.
6. "Shared" (workspaces shared with me) and "Following" (watched). VERIFIED @10465481, @10481109.
7. Main list, grouped by Status (done, in review, in progress, backlog, canceled) or by Project (one group per repo), each collapsible. Each project group header has a "+" "Create workspace" button, always shown, and a hover "⋯" actions menu; its avatar turns into the collapse chevron on hover. VERIFIED @10511900 (`ZTa`). "My workspaces" heads the list in local and team orgs (`Rtr`, 12px semibold muted), with its actions behind a hover ellipsis. VERIFIED @10225603, @10493981, @10494900. With no project, the list shows only "Add a project to get started." VERIFIED @10534600.
8. Footer: notices above (incidents, the macOS version warning, announcements), then one row with the plan badge at the left and Help ("?" menu: Keyboard shortcuts, Docs, Best practices, Changelog, Send feedback, Discord, Submit a prompt, Diagnostics, Open debug tools, version line) and Settings at the right. No add-project control. VERIFIED @10375068, @10177048. Adding a project: the "My workspaces" header's actions menu ("Group by", "Filter by project", "Sort by", "New section…", "Add project…"), the palette's "Add project" and `Cmd+Alt+A` ("Add repository", `nav.addRepository`) all open one 320px menu under the header's right end: "Open project", "Open GitHub project", "Quick start", and "Recents" (folders opened before that are not projects yet). VERIFIED @10495160, @10174083, @11385888, M@3784822. The "Resources" popover (Name, CPU, Mem in a tree grouped under App and each workspace) is not in the footer: see 1.3.

"View options" menu (the "My workspaces actions" ellipsis that shows on hovering the "My workspaces" header, `u5e` @10458105): Group by (Status or Project), Filter by project (searchable when 5 or more repos), Sort by (Updated or Created; hidden when manual order is on). VERIFIED @10489205.

Workspace row (`jU`): status icon, name (from user-set name, PR title, branch or directory name), repo avatar (emoji, uploaded icon, favicon, owner avatar or letter), line change counts (+/-, always coloured with "Colored sidebar diffs"), unread dot, a relative time only in team organisations (`showLastMessageTime`, @10416500), a hover card with the status words (3.8; the row has no second line), badges: Draft, Archive workspace, Admin workspace (can edit settings), Forwarding ports, Private workspace. Keyboard: `Cmd+1..9` switch, `Cmd+Alt+ArrowUp/Down` previous/next, hover keys `R` read, `P` pin. Context menu = Workspace actions (3.1). VERIFIED @10425000-10435354, M@3782527.

Drag and drop: workspaces drag into sections, Pinned, or reorder when "Arrange workspaces manually" is on (order stored per org in route state `manualWorkspaceOrders`). While dragging, a global style sets `cursor: grabbing` and disables link pointer events. VERIFIED @10524580, @10470539 area (`Ctr`, `lTa`).

Archived workspaces: no sidebar list. Reach them from Home with the archive filter, the palette ("View archived workspaces", "Archived" heading), or Passport. Row actions "Unarchive workspace", "Clear & unarchive", "Open in Finder", "Copy path". VERIFIED @10247681, @12097713.

Passport: dialog "Conductor Passport" with a world map ("GRID::EQUALEARTH", "CITIES VISITED", "[NOT VISITED]", "[ARCHIVED]", "[CLICK TO OPEN]"). Each workspace is named after a city, so the map plots them. A `react-simple-maps` style kit (ComposableMap, Geographies, Graticule, Sphere, Marker, ZoomableGroup) is in the display name list. VERIFIED @1855374-1861963.

---

## 5. Dialogs, palette, menus, shortcuts

### 5.1 Command palette (`Cmd+K`)

Dialog id `cmdk-dialog` (cmdk library). Tabs cycled with `Tab` and `Shift+Tab`: all, workspaces, projects, actions, settings. Placeholders: "Type a command or search...", "Search workspaces...", "Search projects...", "Search actions...", "Search settings...". `Cmd+E` edits and `Cmd+Backspace` deletes the highlighted item. Chat history search runs a SQL LIKE on `session_messages`. VERIFIED @11345300-11346400, @10586000.

Groups and items (VERIFIED @11340000-11396500):
- Recent workspaces, Workspaces, Archived, Projects, Organizations (switch), "Chats in this workspace", People, Templates, "From Conductor".
- Workspace actions: "File picker", "Search in files", "Show changes", "Show uncommitted changes", "Show all files", "Show checks", "Link issue", "Copy URL", "Move to section" (opens a section sub-page with "Search sections..." and "Remove from section"), "Create PR", "Open pull request", "Merge PR", "Ready for review", "Fix errors", "Archive workspace".
- Actions: "Create workspace", "Create section", "Add project", "Create snippet", "Edit snippets", "Team artifacts", "Community artifacts", "Toggle theme", "Toggle left sidebar", "Toggle right sidebar", "Toggle zen mode", "Send feedback", "Submit a prompt", "Show keyboard shortcuts", "Check for updates", "Open changelog", "Passport".
- Navigation: "Go to next unread", "Settings", "View archived workspaces", "Open documentation".
- Settings: every settings page and agent provider.
- "Open in": the app list (3.10), with the default marked by its shortcut.
- Empty: "No results found". Loading spinner in the heading.

### 5.2 Other dialogs and popovers (titles found)

Clone GitHub repo; Create project; Create a private GitHub repo?; Switch branch?; Reset chat?; Discard comment?; Discard file changes?; Discard changes?; Discard access changes?; Change root path?; Pause port forwarding?; Leave without building?; Rotate webhook secret?; Revert to version N?; Delete <x>?; Remove <x>?; Disconnect <x>?; Revoke access for <device>?; Sync agent configs; Providers; Custom provider; GitHub; GitHub account; GitHub organizations; Connect GitHub; Connect Datadog; Select MCP servers; Build #N (cloud computer build log); Keyboard shortcuts (search box "Search shortcuts..."); Feedback (Message, Your email, drop images, "Include recent app logs"); Submit a prompt ("Prompt a coding agent to build what you want to see in Conductor. If we like your prompt, we'll run it and merge the result."); "Scan with the Conductor iPhone app to control this Mac" (pairing QR); Create snippet and Edit snippets (Name, Keyword, Visible to, Prompt snippet); Section create or edit (name, emoji); Trigger with a webhook; Version history; Unsaved Changes; Link pull request; Edit PR title; Rename workspace; Rename chat; MCP status; Cloud desktop; Conductor Passport; "<org> requires single sign-on"; "<x> Conductor?" (app update, Rosetta and similar confirms). VERIFIED @1855556-12001968 (dialog title scan).

Popovers: model picker, "+" menu, Forward ports, Resources, View options, chat history, org menu, MCP status, context usage hover card, turn tooltip, PR status details (`aria-label="PR status details"`), emoji and icon pickers for repos and actions ("Icons", "Emoji", "Favicon", "Upload"), Open in menu.

### 5.3 Context menus (VERIFIED where cited)

- Workspace row and "Workspace actions": see 3.1.
- Chat tab: see 3.2.
- File row (tree, changes): View, Attach in chat, Copy path, Copy relative path, Discard changes. @2517401
- PR header: Copy link, Copy number. @2181874
- File editor (CodeMirror): Cut, Copy, Paste with keycap hints. @4971674
- Branch name in the workspace header: Copy (`C`), Rename (`R`). @5422629
- Composer/message: Copy message, Copy plan, Copy error, Copy details. (strings present)
- Sidebar background: "New section...". Section header: Create workspace. @10458500
- Repo icon: "Change repository icon". Org avatar: Copy organization info, Copy user info (internal).

### 5.4 Keyboard shortcuts

Source: registry `sb` in M@3782527. 176 entries. Each has `id`, key (logical or physical), `configurable`, `category`, optional `when` (global, input focus, terminal focus, dialog ids). Overrides persist under `keybinding_overrides_v1`. A conflict table (`fsn`) says which commands share a scope, so rebinding can detect real conflicts. Send key mode setting "Send messages with": `Enter` or `Cmd+Enter` swaps the four `chat.*` Enter bindings. VERIFIED M@3782527-3807000.

While a dialog is open, the root key listener runs a shortcut only when the dialog registered it or its command is marked global. A handler registered inside a dialog is bound to that dialog's id. VERIFIED @680362 (the rule), @2232794 (`Kn` adds the dialog's id). The global ones: Command palette, Toggle theme, Shortcuts help, Settings, Quit, Close diagnostics, Send feedback, Open debug tools, Open sidecar logs, Open app log viewer, Toggle Garry mode, Toggle zen mode, Zoom in, Zoom out, Reset zoom, Navigate back, Navigate forward, Go to Home, Quick open file, Search in files, Create new workspace from PR, branch, or issue, Archive workspace, Link issue, and the two onboarding keys. VERIFIED M@3778851-3796000. "A dialog is open" means the dialog store holds an active dialog id (@681094). A popover is not a dialog.

Which dialogs hold app shortcuts (VERIFIED, issue #610). Only a dialog opened through the dialog store sets an id: the 23 built on its `F0` wrapper (@1848478, the New workspace dialog among them), and the alert dialogs whose open state is the store's (`h0` @1913054 with a store selector: archive workspace, close running chat, discard file changes, change root path, restore workspace, create private GitHub repo, equip loadout, confirm quit). The store's ids are declared together (main @3725892), plus the per-file attachment preview and per-setting prompt preview ids. Neither dialog root (`S_` @1840607, `h0`) touches the store, so every other dialog lets app shortcuts through. Ours mark those with `letShortcutsThrough` (ui/dialog-shortcuts.ts); `NAV-14 which dialogs hold app shortcuts` in app/command-dispatcher.test.ts lists them:

| Ours | Conductor's evidence |
|---|---|
| Reset chat? | its own state, @9589206 |
| Expanded Mermaid diagram | its own state, @8048587 |
| Discard comment? | `h0` with its own state, @9731360 |
| Switch branch? (stack view) | `h0` @2187137, no store id |
| Add or edit action | `S_` @4985460 |
| Add or edit MCP server, Select MCP servers | `S_` @10778481, @10768061 |
| Connect <server> (client setup), Connect Datadog, Disconnect <server>? (MCP) | `S_` @10780981 for both setup dialogs, `h0` with its own state @8684032 (in `yGo`) |
| Add and edit environment variable sheets | the sheet root with its own state, @10712780, @10706717 |
| GitHub on the Account page, its token warning, Disconnect GitHub? | `S_` @11053513 (the warning is a line inside it, @11048121), `h0` @11032759 |
| Remove repository | `h0` with its own state, @11298444 |
| Pause port forwarding? | `h0` @11144368, no store id |

A handler registered inside a dialog is that dialog's own; ours register theirs at the `modal` priority, and under a dialog that holds app shortcuts only those run for a command not marked global. Settings' "Search settings" (`Cmd+F`) and "Close settings" are plain handlers on the Settings layout (VERIFIED @11760561, @11780161), so they wait while a store dialog is open over Settings and still run under the dialogs kept off the store.

The native menu (VERIFIED, native-and-sidecar-map.md A5 and renderApp @11395986 to @11396604): only Settings, Quit, Send Feedback, Debug and the system's Close Window carry a key. The sidebar toggles carry none; the page binds `Cmd+B` itself, so under a store dialog the key waits like any other. The page acts on every menu event it hears whatever dialog is open (Settings closes the dialog first), and it hears none for Close Window, so a menu pick never closes a tab in Conductor. Ours sends Close Window to the tab close, so that pick follows the key's rule.

Our dialogs with no Conductor dialog keep holding app shortcuts: the review prompt editor (Conductor's "Edit before sending" puts the prompt in a new chat's composer, @2553500), the Claude and Codex config editors (Conductor shows them on the page, @10993932), Delete section? (Conductor deletes at once, @10477336), Remove variable?, Disconnect Linear?, the Conductor import and the wrong-CPU build (a full screen in Conductor, @12041474).

**General**

| Keys | Action | Notes |
|---|---|---|
| `Cmd+k` | Command palette |  |
| `Cmd+Alt+T` | Toggle theme (dark/light) |  |
| `Cmd+Alt+/` | Shortcuts help |  |
| `Cmd+,` | Settings | not rebindable |
| `Cmd+q` | Quit | not rebindable |
| `Cmd+f` | Search settings |  |
| `Cmd+Enter` | Confirm dialog |  |
| `Cmd+Escape` | Close diagnostics |  |
| `Cmd+Alt+F` | Send feedback | not rebindable |
| `Cmd+Alt+I` | Open debug tools | not rebindable |
| `Cmd+Shift+l` | Open sidecar logs |  |
| `Ctrl+o` | Toggle Garry mode (expand tool calls) |  |
| `Cmd+s` | Save routine |  |

**View**

| Keys | Action | Notes |
|---|---|---|
| `Cmd+b | [` | Toggle left sidebar |  |
| `Cmd+Alt+B | ]` | Toggle right sidebar |  |
| `Cmd+j` | Toggle terminal panel |  |
| `Cmd+.` | Toggle zen mode |  |
| `Cmd++ | Cmd+=` | Zoom in |  |
| `Cmd+-` | Zoom out |  |
| `Cmd+0` | Reset zoom |  |

**Navigation**

| Keys | Action | Notes |
|---|---|---|
| `Cmd+[` | Navigate back |  |
| `Cmd+]` | Navigate forward |  |
| `Cmd+Shift+h` | Go to Home |  |
| `Ctrl+Shift+Tab | Cmd+Shift+[ | Cmd+Alt+ArrowLeft` | Go to previous tab |  |
| `Ctrl+Tab | Cmd+Shift+] | Cmd+Alt+ArrowRight` | Go to next tab |  |
| `Cmd+w` | Close tab |  |
| `Cmd+Shift+t` | Reopen closed tab |  |
| `Cmd+p` | Quick open file |  |
| `Cmd+Shift+f` | Search in files |  |
| `Cmd+Alt+A` | Add repository |  |

**Workspace**

| Keys | Action | Notes |
|---|---|---|
| `Cmd+n` | Create new workspace |  |
| `Alt+Enter` | Add to backlog | New workspace composer |
| `Cmd+Enter` | Start workspace | not rebindable, Backlog page |
| `Tab` | Next tab (Create workspace page) |  |
| `Shift+Tab` | Previous tab (Create workspace page) |  |
| `Cmd+i` | Toggle create-from picker |  |
| `Cmd+Shift+a` | Archive workspace |  |
| `Cmd+o` | Open in app |  |
| `Cmd+Alt+O` | Open cloud workspace remotely in app |  |
| `Cmd+Shift+o` | Open in menu |  |
| `Cmd+Shift+c` | Copy link |  |
| `Cmd+r` | Start or stop action |  |
| `Cmd+y` | Toggle port forwarding |  |
| `Cmd+e` | Toggle file edit mode |  |
| `Cmd+1` | Switch to workspace 1 |  |
| `Cmd+2` | Switch to workspace 2 |  |
| `Cmd+3` | Switch to workspace 3 |  |
| `Cmd+4` | Switch to workspace 4 |  |
| `Cmd+5` | Switch to workspace 5 |  |
| `Cmd+6` | Switch to workspace 6 |  |
| `Cmd+7` | Switch to workspace 7 |  |
| `Cmd+8` | Switch to workspace 8 |  |
| `Cmd+9` | Switch to workspace 9 |  |
| `Cmd+Alt+ArrowUp` | Previous workspace |  |
| `Cmd+Alt+ArrowDown` | Next workspace |  |
| `Cmd+Shift+p` | Create PR |  |
| `Cmd+Shift+y` | Commit and push |  |
| `Cmd+Shift+l` | Pull latest from main |  |
| `Cmd+Shift+m` | Merge PR |  |
| `Cmd+Shift+x` | Fix errors |  |
| `Cmd+Shift+g` | Open PR |  |
| `Cmd+Shift+r` | Start review |  |
| `Cmd+f` | Find in file |  |
| `Cmd+Alt+U` | Show uncommitted changes |  |

**Chat**

| Keys | Action | Notes |
|---|---|---|
| `Cmd+t` | New tab |  |
| `Shift+Enter (default mode) or Enter (Cmd+Enter mode)` | New line in chat | Chat input default |
| `Enter (default) or Cmd+Enter` | Submit message | Chat input default |
| `Cmd+Enter (default) or Alt+Enter` | Submit with opposite follow-up behavior | Chat input default |
| `Cmd+Shift+v` | Paste copied files as paths |  |
| `Cmd+l` | Focus chat input |  |
| `Shift+Tab` | Toggle plan mode while typing a message |  |
| `Cmd+Shift+Enter` | Approve plan |  |
| `Enter` | Approve tool request |  |
| `Cmd+Enter` | Use alternate tool approval action |  |
| `Backspace` | Deny tool request |  |
| `Cmd+Shift+Backspace` | Cancel agent |  |
| `Cmd+i` | Link issue |  |
| `Cmd+u` | Add attachment |  |
| `Cmd+/` | Open model picker |  |
| `Cmd+Shift+e` | Toggle Fast mode |  |
| `Cmd+Shift+/` | Cycle effort level |  |
| `Cmd+Ctrl+1` | Select loadout 1 |  |
| `Cmd+Ctrl+2` | Select loadout 2 |  |
| `Cmd+Ctrl+3` | Select loadout 3 |  |
| `Cmd+Ctrl+4` | Select loadout 4 |  |
| `Cmd+Ctrl+5` | Select loadout 5 |  |
| `Cmd+Alt+L` | Next chat needing attention |  |
| `Cmd+f` | Search chat |  |
| `Cmd+g` | Find next match |  |
| `Cmd+Shift+g` | Find previous match |  |
| `Cmd+Alt+J` | Scroll to current match |  |
| `Cmd+Alt+C` | Copy concise transcript |  |
| `Cmd+Alt+Enter` | Fork chat to new tab |  |
| `Cmd+;` | Insert snippet |  |
| `Ctrl+Shift+d` | Toggle speech to text |  |

**Code review**

| Keys | Action | Notes |
|---|---|---|
| `Cmd+Shift+d` | Open diff view |  |
| `ArrowUp` | Go to previous file in diff |  |
| `ArrowDown` | Go to next file in diff |  |
| `Cmd+Alt+K` | Go to previous comment in diff |  |
| `Cmd+Alt+J` | Go to next comment in diff |  |
| `Ctrl+v` | Toggle file as viewed |  |

**Terminal**

| Keys | Action | Notes |
|---|---|---|
| `Cmd+t` | New terminal tab (when terminal focused) |  |
| `Cmd+w` | Close terminal tab (when terminal focused) |  |
| `Cmd+Shift+b` | Open localhost URL |  |
| `Cmd+f` | Find in terminal |  |

**Video**

| Keys | Action | Notes |
|---|---|---|
| `  | k` | Play or pause | not rebindable, Video player |
| `j` | Back 10 seconds | not rebindable, Video player |
| `l` | Forward 10 seconds | not rebindable, Video player |
| `ArrowLeft | ,` | Previous frame | not rebindable, Video player |
| `ArrowRight | .` | Next frame | not rebindable, Video player |
| `<` | Decrease playback speed | not rebindable, Video player |
| `>` | Increase playback speed | not rebindable, Video player |
| `m` | Mute or unmute | not rebindable, Video player |
| `f` | Toggle fullscreen | not rebindable, Video player |

**Hidden contextual shortcuts** (registered, not listed in the help dialog):

- General: `Tab` Next tab (Command palette); `Shift+Tab` Previous tab (Command palette); `Cmd+e` Edit highlighted item (Command palette); `Cmd+Backspace` Delete highlighted item (Command palette); `Escape` Close settings; `Cmd+Shift+i` Open app log viewer; `Cmd+a` Protect page from select all; `ArrowDown` Next onboarding slide; `Enter` Continue onboarding; `Enter` Continue cloud onboarding
- Navigation: `Cmd+d` Split tab
- Workspace: `Cmd+Shift+n` Create new workspace from PR, branch, or issue; `r` Toggle read state; `p` Toggle pin
- Chat: `Enter` Save queued message edit; `Cmd+Enter` Save queued message and steer; `e` Edit queued message; `Backspace` Delete queued message; `Enter` Steer with queued message; `Cmd+Shift+Enter` Submit plan response; `Escape` Cancel queued message edit; `Cmd+Enter` Save goal; `ArrowLeft` Previous question; `ArrowRight` Next question; `0` Focus other answer; `Enter` (default mode) or `Cmd+Enter` Submit answer
- Code review: `Cmd+s` Save edited file; `Cmd+f` Open code editor search
- Terminal: `Cmd+Shift+t` New terminal tab; `Shift+Enter` Insert terminal newline; `Cmd+k` Clear terminal scrollback; `Cmd+Backspace` Delete terminal line; `Cmd+ArrowLeft` Move to terminal line start; `Cmd+ArrowRight` Move to terminal line end; `Alt+ArrowLeft` Move back one terminal word; `Alt+ArrowRight` Move forward one terminal word
- Digit keys: `Ctrl+1..9` switch organization, `1..9` select a question option, `0` focus "Other", `1..9` select a menu item.

---

## 6. Settings

Layout `Jil` (VERIFIED @11760356): left nav with search box "Search settings" (`Cmd+F`, fuzzy over all setting labels, descriptions and keywords, top 30 results, arrow keys and Enter), "Back" and `Esc` to leave, repo picker in the Repositories group, "Admin" badge for org pages. Every setting is declared with `Ii({tab, settingKey, scopes, title, description, searchTerms, render})`, so search, deep links (`enableViaDeepLink`) and per-scope overrides come from one registry. Scopes: `user`, `workspace` (per repository, with "Reset to your repo's settings.toml" style reset actions), `organizationSettings`. VERIFIED @11105250 and 144 definitions.

Navigation (VERIFIED @2959529, `KFt`):
- **Personal**: General, Account, Appearance, Keyboard shortcuts, Default models, Git, Connections.
- **Agents & environment**: Agents, Environment.
- **Repositories**: Scripts, Actions, Misc (these open per-repo pages `/settings/repos/$repoId/...`).
- **More**: Experimental, Advanced.
- Conditional: Big terminal, Remote control (local orgs only), Internal (internal builds).
- **Organization** (cloud): GitHub, Members, Cloud computer, Environment, MCP, Prompts, plus per-repo `repositories/$owner/$repo/{scripts,git,actions}`.
  - GitHub page: "GitHub account" (shared by all orgs; Disconnect), "GitHub organizations" ("Manage connections to multiple GitHub installations", Add, "Installation suspended", "Waiting for a GitHub admin to approve the installation", "These GitHub App installations are missing permissions:"). VERIFIED @10832348-10841873, @11043472.
  - Cloud computer page: Install software, Settings, Logs, Build computer, "Not built yet", "Unbuilt changes" (Discard), Active or Activate, "Build #N" dialog, "Leave without building?". VERIFIED @10784516-10868457.
  - Members: member list, "No members yet.". Prompts: Personal and Shared tabs per button ("Applied to everyone's chats in this organization..."). MCP: Installed, Recommended, "Import from local", "Select MCP servers", auth types None, OAuth, Bearer token, Custom headers. VERIFIED @10900470-10913709, @10725742-10778993.

Settings by page (label as shown, description as shown, scope):

**General**

| Label | Description (as shown) | Scope |
|---|---|---|
| Send messages with | Choose which key combination sends messages | user |
| Follow-up behavior | Queue messages to send after the agent finishes, or steer the agent mid-turn. | user |
| Agent notifications | Get notified when an agent finishes working. | user |
| @ notifications | Get notified when a teammate mentions you. | user |
| Completion sound | Choose what plays when AI finishes working in a chat. | user |
| Full disk access permissions | To let agents work without repeated folder permission prompts. | user |
| Arrange workspaces manually |  | user |
| Auto-convert long text | Convert pasted text over 5000 characters into text attachments | user |
| I'm not absolutely right, thank you very much |  | user |
| Always show context usage | Always show context usage. By default, it is only shown when more than 70% is used. | user |
| Caffeinate while agents are running | Prevent your Mac from sleeping while an agent is actively working. Shuts off below 10% battery. | user |
| Workspace API access | Give new workspaces access to the Conductor API | user |
| Restart automatically on update |  | user |
| Show Artifacts tab |  | user |
| Don't collapse tool calls (Garry Mode) | Show all tool calls expanded by default instead of collapsed. | user |
| Sync agent configs | Copy skills, slash commands, and MCP servers between Claude Code and Codex. | user |

**Account**

| Label | Description (as shown) | Scope |
|---|---|---|
| Account and integrations | Your Conductor account, billing, GitHub access, and Linear connection. | user |
| Enterprise data privacy | Disable features requiring external AI providers, such as AI generated chat titles, as well as custom MCP servers. | user |
| Claude Code tool approvals | Require manual approval before agents can run tools. | user |
| Codex tool approvals |  | user |
| Sign out | Sign out of your Conductor account. | user |

**Appearance**

| Label | Description (as shown) | Scope |
|---|---|---|
| Colored sidebar diffs | Always show line change colors in the sidebar, even for unselected workspaces. | user |
| Code ligatures | Use font ligatures in file editors and diffs. | user |
| Theme | Switch between light, dark, and system appearance. | user |
| Low-contrast dark mode | Soften the app's colors when using the dark theme. | user |
| App zoom | Adjust the size of the Conductor interface. | user |
| Accessible colors | Theme optimized for color vision differences. | user |
| Code theme | Syntax highlighting theme for code and diffs. | user |
| Mono Font | Font used for code and diffs. | user |
| Markdown Style | Rendering style for markdown files. | user |
| Terminal font | Font family and size for the terminal. | user |
| Appearance settings | Theme, typography, color, and editor appearance. | user |

**Default models**

| Label | Description (as shown) | Scope |
|---|---|---|
| Default model | Model for new chats | user |
| Codex personality |  | user |
| Claude output style | Choose which output style to apply to new chats. Existing chats do not change. | user |
| Review model |  | user |
| Default to plan mode in new chats |  | user |

**Git**

| Label | Description (as shown) | Scope |
|---|---|---|
| Git identity | Name and email used for commits in cloud workspaces. | user |
| Branch new workspaces from | Each workspace is an isolated copy of your codebase. | repo |
| Remote origin | Where should we push, pull, and create PRs? | repo |
| Open pull requests in |  | user |
| Include link to workspace in PR description |  | user |
| Branch name prefix | Prefix for new workspace branch names. | user |
| Automatically rename new branches |  | user |
| Rename workspace when branch is named |  | user |
| Delete branch on archive | Delete the local branch when archiving a workspace. To delete the remote branch, configure it on GitHub. | user,repo |
| Archive on merge | Automatically archive a workspace after merging its PR in Conductor | user,repo |
| Automerge | Show an automerge button in the git panel when checks are pending. Requires automerge to be enabled in your GitHub re... | user |
| Treat optional checks as blocking | Hide the merge button when any check has failed, including checks GitHub considers optional. | user |
| Set upstream on plain git push | Configure new Conductor workspaces so plain git push sets a branch upstream. Turning this off avoids writing Git work... | user,repo |
| Use GitHub stacked PRs | Instruct agents that they can use `gh stack` for PR stacking. | user |

**Connections**

| Label | Description (as shown) | Scope |
|---|---|---|
| Exclusive port forwarding | Turning on port forwarding in one workspace turns it off everywhere else | user |
| Forwarding strategies | How new forwards choose their local port. Existing forwards keep their ports. | user |
| Local port range | Used for forwards that don't match their remote port number. | user |
| Manual overrides |  | user |

**Agents**

| Label | Description (as shown) | Scope |
|---|---|---|
| Claude Code harness | Configure Claude Code authentication and behavior. | user |
| Use Claude Code with Chrome |  | user |
| Codex harness | Configure Codex authentication and behavior. | user |
| Cursor harness | Configure Cursor authentication and behavior. | user |
| Agent settings | Configure Claude Code, Codex, Cursor, and ACP agents. | user |

**Environment**

| Label | Description (as shown) | Scope |
|---|---|---|
| Environment settings | Environment variables, files, and preview URLs. | user,repo |

**Scripts (repo)**

| Label | Description (as shown) | Scope |
|---|---|---|
| Repository scripts | Setup and archive scripts for the selected repository. | repo |

**Actions (repo)**

| Label | Description (as shown) | Scope |
|---|---|---|
| Custom actions | Shortcuts for quick actions, like running your dev server or test suite | repo |
| Use spotlight testing | Replace Run with Spotlight for this repository so workspace changes are tested in the repository root. | repo |
| General preferences | Add custom instructions sent to the agent at the start of every new chat. | repo |

**Misc (repo)**

| Label | Description (as shown) | Scope |
|---|---|---|
| Icon | Shown next to the repository name in the sidebar. | repo |
| Root path | Do not move or delete this directory. Instead, remove the repository in Conductor. | repo |
| Workspaces path | Do not move or delete the workspace subdirectories. Instead, archive workspaces in Conductor. | repo |
| Preview URLs | Set the terminal panel's Open URLs. The first URL is the default; additional URLs appear in its menu. Supports Conduc... | repo |
| Files to copy | Conductor will automatically copy these file paths in each new workspace. | repo |
| Remove repository | Remove this repository and its workspaces from Conductor. | repo |

**Experimental**

| Label | Description (as shown) | Scope |
|---|---|---|
| Use default internal and experimental settings | Internal setting. Makes Conductor behave as if internal and experimental settings are set to their defaults without c... | user |
| Auto permission mode | Turns on Claude auto mode. | user |
| Big terminal mode | Create big terminals in the center pane with ⌘⇧T | user |
| New workspace page | Full-screen workspace creation | user |
| Tab Freak Mode | Allow up to 10 chat and terminal tabs per workspace. | user |
| Split tabs | Split the center panel and move tabs between panes. | user |
| Fork chat to new tab | Fork a chat, even mid-turn, from its tab's context menu or with ⌘⌥↵. | user |
| In-app browser preview | Open the preview button in an in-app browser tab (with the annotation overlay) instead of your external browser. | user |
| Use legacy file preview and editing |  | user |
| Show agent cost | Show estimated agent costs for cloud workspaces. | user |
| Workspace status matrix for local workspaces | Use the matrix-style workspace status indicator for local workspaces in Home and the sidebar. | user |
| Add projects without GitHub | Let Conductor add existing local repositories even when they are not connected to GitHub. | user |
| Auto-run after setup | Start a repository's default action automatically after a new local workspace finishes setup. | user |
| Dashboard | Show the dashboard and workspace sidebar. | user |
| Voice mode | Enables speech-to-text in the chat composer. Press Ctrl+Shift+D to start dictating. | user |
| Show sidebar resource usage | Shows CPU and memory usage in the workspace sidebar footer. | user |
| Pokes | Poke teammates in cloud organizations, and get poked. | user |
| Sidebar transparency | Use native macOS vibrancy behind the workspace sidebar. Takes effect after you restart Conductor. | user |
| Graphite stack support | Detect Graphite stacks for the active local workspace and show stack-aware UI in the git panel. Cloud workspaces are ... | user |

**Advanced**

| Label | Description (as shown) | Scope |
|---|---|---|
| Conductor root directory | Where Conductor stores repositories and workspaces. This should be an empty directory that you don't modify directly. | user |
| Claude Code executable path | Override the bundled Claude Code executable with a custom one. Leave empty to use the bundled version (recommended). | user |
| Codex executable path | Override the bundled Codex executable with a custom one. Leave empty to use the bundled version (recommended). | user |
| OpenCode executable path | Override the bundled OpenCode executable with a custom one. Leave empty to use the bundled version (recommended). | user |
| SSH private key path | Use your own SSH key for cloud workspace access. Leave empty to auto-generate a key. | user |
| Remote execution MCP | Let remote agents request approved one-shot commands on this Mac. Each command still requires your approval. | user |
| Always allow local commands | Run local commands from remote agents without asking. Turned on when you choose Yes always on a local command approval. | user |
| Enable file sync in new cloud workspaces | Start syncing when you open a local terminal or run a local task. Sync files can still be turned on per workspace. Sy... | user |
| Set upstream on plain git push | Configure new Conductor workspaces so plain git push sets a branch upstream. Turning this off avoids writing Git work... | user |
| Scrollback limit | Approximate terminal output to keep. | user |

**Big terminal**

| Label | Description (as shown) | Scope |
|---|---|---|
| Big terminal settings | Configure the experimental center-pane terminal. | user |

**Remote control**

| Label | Description (as shown) | Scope |
|---|---|---|
| Remote control |  | user |
| Allow remote control |  | user |
| Keep this Mac awake | Prevent sleep while a device is connected and this Mac is plugged in. | user |
| Devices that can control this Mac |  | user |

**Internal (dev only, hidden in release builds)**: Developer metrics bar; Use workspace tabs; Initial Claude permission mode; Initial Codex approval policy and sandbox; Unstarted workspaces; Pull requests page; Principals; Workspace chat; Native fork to new tab; Prompt snippets; Team artifacts; Agent pizza tracker; Sidecar HTTP health; Build commit; Use default internal and experimental settings; Piccolo agent (cloud); Muse Code (cloud); Log viewer; App logger token; Onboarding; New member onboarding state; Terminal render debug log; Frame drop logging; Keep cloud workspaces independent from local repositories; Request metadata; Claude token usage tracking; Verbose logging; Tauri HTTP proxy; Save workspace session logs; Crash test; Error reporting test; Agent binaries; Feature flags.

**Org: Members**

| Label | Description (as shown) | Scope |
|---|---|---|
| Organization members | Manage organization membership. | org |

**Org: Cloud computer**

| Label | Description (as shown) | Scope |
|---|---|---|
| Cloud computer | Configure the organization's cloud computer. | org |

**Org: Environment**

| Label | Description (as shown) | Scope |
|---|---|---|
| Environment | Configure personal and shared cloud environment variables. | org |

**Org: Prompts**

| Label | Description (as shown) | Scope |
|---|---|---|
| Prompts | Custom instructions for the Review, Create PR, and Resolve conflicts buttons. | org |

**Org: MCP**

| Label | Description (as shown) | Scope |
|---|---|---|
| MCPs | Configure MCP servers for cloud workspaces. | org |


Control values worth copying (VERIFIED @11116941-11141000):
- "Send messages with": Enter, Cmd Enter, Custom.
- "Follow-up behavior": Queue, Steer.
- "Completion sound": No sound; Classic (Chime, Choo Choo); Novelty (Odysseus's Pluck, Fahhhh, Quack); SF Muni (Inbound train, Gong); NYC MTA (Chime 1, Chime 2, Stand clear); Paris Metro (Chime, "Attention aux pickpockets"); SNCF. M@2683388.
- Theme: Light, Dark, System. "Accessible colors": Default, Deuteranopia / Protanopia, Tritanopia. "Code theme", "Mono Font" (Default or Custom...), "Markdown Style" (Default, Tufte), "Terminal Font", "Terminal Font Size", "New tab preset" (command to auto-run in a new terminal tab).
- "Branch name prefix": GitHub username (preview shown), Custom ("e.g. feature/ or myname-"), None.
- "Open pull requests in": GitHub, Linear, Graphite.
- "Codex tool approvals": Default, Always approve.
- Agents page (`Wnl`): provider search ("Search providers", inside the OpenCode Providers dialog @10944937, not on the agent tab row, which holds only the tabs @11008592), cards for Claude Code (CLI sign-in, "Paste code from Claude", `claude setup-token`, Amazon Bedrock with AWS access keys or Bedrock API key, Anthropic API key, "Use the key from this Mac", Claude settings JSON, "Use Claude Code with Chrome"), Codex (CLI, API key, ChatGPT device-code flow with Personal or Business plan, "Codex config", personality), Cursor (API key), OpenCode and Pi (executable path, per-provider keys, "Filter models"), "Custom provider". States: "Loaded from env", "API key configured", "Validation failed", "Recommended". VERIFIED @10925048-11010000.
- Environment page: Variables table (Name, Value, "Locally overwritten", "Not set"), "No variables set / Add a variable to make it available in this environment.", env files list with "Cancel adding env file", "Files to copy" globs preview ("Detecting files to copy...", "Using .worktreeinclude from this repository..."). VERIFIED @10690000-10720000, @11274850.
- Actions page: custom actions list with Show or Hide, Edit, Delete, Reset, empty "No custom actions yet. Add one to get started.", prompts for Review, Create PR, Fix errors, Resolve conflicts (each "Add custom instructions sent to the agent when you click the X button"), "Review model", "Use spotlight testing", "General preferences". VERIFIED @11017379, @11266434-11267037.
- Scripts page: "Setup script" (Runs when a new workspace is created), "Archive script" (Runs before a workspace is archived), "Run script", run mode, migration banner from `conductor.json` to `.conductor/settings.toml` ("A pull request has been created to migrate your settings."). VERIFIED @11026106, @11751146-11753959.
- Connections page: see 3.7.
- Remote control page: Allow remote control, "Keep this Mac awake", "Devices that can control this Mac", "Add a device to control this Mac remotely", QR pairing dialog (Code expired, Regenerate, Pair another), "Recent connections", "Revoke access". VERIFIED @11185255-11192869.
- Account page: avatar upload ("Edit photo"), "Display name", GitHub (gh CLI auth or Personal access token `ghp_...`), Linear, Billing (opens browser), tool approvals, Sign out. VERIFIED @11052485-11097928.
- Appearance page: live code preview and a terminal preview block. VERIFIED @10670104-10674477.

---

## 7. Onboarding, empty, loading and error states

### 7.1 Onboarding

- First run (`/first-run-onboarding`): split screen. Left: three selectable steps with title and text. Right: autoplaying muted video that advances when it ends, with a progress bar. VERIFIED @10584451-10588205.
  1. "Get coding agents working in parallel" / "Each agent you spin up gets an isolated workspace." (`ConductorOnboarding1.mp4`)
  2. "See at a glance what each agent is working on" / "See who's working, what needs attention, and what's planned." (`ConductorOnboarding2.mp4`)
  3. "Review changes and create PRs" / "Review, comment, and merge from Conductor." (`ConductorOnboarding3.mp4`)
  - Bottom: sign-in button, then "Continue" (`Enter`). Down arrow cycles slides. On finish it stores the onboarding state and goes to `/`. Error toast "Couldn't finish setup. Please try again."
- Cloud collaboration onboarding: "Welcome to the new Conductor", "Workspaces now run in the cloud", cloud computer colour, "Connect GitHub", "~/ ... your repos get saved to ~/ in your cloud computer. every workspace gets a copy of all of them", "Added repositories appear here", Skip. VERIFIED @11548768-11561699.
- New member onboarding: switch callout in the org switcher (dismissals resettable under Internal). INFERRED.
- Callouts: "Reset callout dismissals" exists, so coach marks exist. Example: the send button tooltip "Send this message to set up your cloud computer". VERIFIED @8915802.

### 7.2 Designed empty states

Home "No matching workspaces" with actions; Dashboard column empties; Routines "Add your first routine"; Changes "Changes appear here."; Setup "No setup script output"; Run "Run tests or a development server..."; chat "No messages yet", "No open chats"; Todo "No todos"; Tasks "No tasks"; Env "No variables set"; MCP "No recommended MCPs match your search", "No matching MCP servers."; Providers "No providers match your search."; Models "No models found"; Repos "No repositories found", "Add a project to get started."; Sections "No matching sections"; Templates "No templates yet. Add one from Community artifacts."; Pinned "Drag a workspace here"; Sidebar new team "Create your first workspace to start building with your team."; Queue/Playback: "Empty CSV", "Preview not available", "No description", "No logs available.", "No local servers running. Start your dev server and it'll show up here.".

### 7.3 Loading states

- Skeleton blocks (`Hl`) for panels and cards. Spinner/loader `Ln` with types `working`, `typing`, `waiting`, `setting-up`. Branded sprite loader "conductor-loader". Each loading region has `role="status"` and an aria-label such as "Loading workspaces", "Loading routines", "Loading MCP servers", "Starting Conductor". VERIFIED @10276677, @12050608, @10584000.

### 7.4 Error states

- Route and render errors: "Something went wrong!" (root error component), "Not Found", "Error loading workspace" / "Workspace not found" ("It may have been deleted, belong to another device, or not have finished syncing...") / "You don't have access to this workspace" ("Ask a teammate to share it with you.") with "Try again". VERIFIED @206903, @218908, @10199869, @10202175.
- Boundaries inside the workspace: per turn, per chat tab, tab strip, diff renderer ("Failed to open editor"), file previews ("Failed to load image/PDF/video", "Failed to render page", "Preview unavailable").
- Workspace lifecycle: "Workspace initialization failed", "Setup did not start", "This workspace failed to start.", cloud "Workspace unavailable", "Reconnect", PR info states ("No internet connection", "GitHub access required").
- App-level blockers (full-screen): "Database from a newer version" with Update, "Database rollback" ("Press Enter to run the rollback command. Conductor will restart when done."), "Wrong version of Conductor for this Mac" (Intel build on Apple Silicon), "Update required", "Conductor isn't available in your region", "Failed to start agents / Conductor will not work. Please report this error." VERIFIED @12035093-12119124.
- Agent binary and auth problems are shown inline in chat (see 3.3 banners) and in Settings > Advanced ("Agent binaries": Re-download, Retry, failure injection for dev).
- Toasts: ~190 distinct messages, e.g. "Failed to create workspace", "Couldn't open browser tab", "Port 22 is reserved for SSH and cannot be forwarded here", "Xcode license is not accepted". Toaster is a custom `kt` API with `.success`, `.error`, `.warning`; workspace-scoped variant `Xi`.

---

## 8. Shared UI kit

Stack: React with the React Compiler, Tailwind (v4 style tokens in CSS variables), Base UI primitives (menus, popovers, selects, tooltips), Radix-style (shadcn pattern) wrappers for Dialog, AlertDialog, Sheet, Tabs, Collapsible, Slider, Switch, Checkbox, cmdk for command lists, TipTap for rich input, CodeMirror 6 for file editing, xterm.js for terminals, Mermaid for diagrams (KaTeX strings also present), Shiki for highlight, `@pierre/diffs` for diffs, Virtuoso for the chat list, Lucide icons, Material file icons (910 SVGs in `material-icons/`). VERIFIED by string counts and file listing.

Fonts: Geist (UI), Geist Mono (code, `font-geist-mono`), iA Writer Mono (Tufte markdown style, INFERRED), Symbols Nerd Font Mono (terminal glyphs). VERIFIED in `index-C0NH49rF.css`.

Design tokens (CSS variables, VERIFIED in CSS): `background foreground muted accent card popover border input ring primary secondary destructive` plus `sidebar-*` (background, foreground, accent, border, muted-foreground, blue, ring), `status-{backlog,in-progress,in-review,done,canceled}[-hover]`, `unread`, `link[-foreground,-elevated]`, `tip[-secondary,-border,-muted]`, `highlight[-foreground,-muted]`, `positive`, `warning[-foreground,-border]`, `special`, `internal`, `terminal-*` (16 ANSI colours), `traffic-lights-clearance`, `radius-*`. Themes: light, dark, "Low-contrast dark mode", colour-vision variants, code themes (Shiki) and diff themes `pierre-dark/light`.

Button (`Ge`, cva): variants `default`, `destructive`, `outline`, `outlineDestructive`, `secondary`, `ghost`, `link`; sizes `default (h-8)`, `xs (h-6)`, `sm (h-7)`, `lg (h-11)`, `icon`, `iconSm`, `iconXs`. Badge (`fd`): `default secondary destructive outline highlight tip tip-outline`, mono uppercase. Alert: `default destructive`. VERIFIED @1850119, @1963312, @2512898.

Components by group (from the 164 `displayName` strings):

| Group | Components |
|---|---|
| Actions | Button, Toggle, ToggleGroup, ToggleGroupItem, SimpleCopyButton, CommandHint, CommandEnterHint (keycap hints), NotAButton |
| Overlays | Dialog (+Close, Content, Description, Footer, Header, Overlay, Title, Trigger), AlertDialog (+Action, Cancel, Content, Description, Footer, Header, Overlay, Title, Trigger), Sheet (+Close, Content, Description, Footer, Header, Overlay, Title, Trigger), HoverCard (Content, Trigger), Tooltip (Content, Trigger) |
| Menus | DropdownMenu (CheckboxItem, Content, Item, Label, RadioGroup, RadioItem, Separator, SubContent, SubTrigger, Trigger), ContextMenu (CheckboxItem, Content, Item, Label, RadioItem, Separator, Shortcut, SubContent, SubTrigger, Trigger), Select (Content, Item, Label, ScrollDownButton, ScrollUpButton, Separator, Trigger) |
| Form | Input, Textarea, Label, Checkbox, Switch, Slider, Tiptap (+Content, Context) |
| Layout | Card (Content, Description, Footer, Header, Title), Separator, Panel, Collapsible (Content, Trigger), Tabs (Content, Trigger, TriggerText, CloseButton), Table (Body, Caption, Cell, Footer, Head, Header, Row) |
| Feedback | Alert (Description, Title), Toaster, RadialProgress, Presence, TruncatedText |
| Identity | Avatar (Fallback, Image) |
| Content | CodeBlockMemoized, VirtuosoMessageList, ReactNodeView (TipTap node views), Tool (+Content, Description, Footer, Header, Title: the base of tool cards) |
| Map (Passport) | ComposableMap, Geographies, Geography, Graticule, Group, Line, Marker, Sphere, ZoomableGroup, Annotation |

Notable custom components (names are minified, role inferred from use):
- `es` = Kbd/shortcut label from a command id. Reads the live keybinding so hints follow user rebinds. `oU(label, commandId)` builds tooltip text. VERIFIED @2049663.
- `Kn(commandId, handler, opts)` = hook that registers a handler for a command with priority (`ed.TERMINAL`). VERIFIED @5015164.
- `jN` = page shell with optional `topBar`. `Lle` = top bar. `$oe` = error empty state (title, description, action). `ET` = status empty state (title, description, isFailed, icon). `MQ` = initializing state. INFERRED from props.
- `Ln` = loader with `type`. `Hl` = skeleton. `fd` = Badge. `iu` = search-highlight text. `Zy` = inline kbd. `Pxe` = tab close button. `xce` = tab with icon, label, close.
- `yC` = Open-in-app button. `h8s` = breadcrumb. `Sjt` = chat history button.
- Fuzzy search util `aO({items, query, fields, threshold})` is shared by settings search and pickers.
- Virtual lists and drag libraries: a `Gwe` DnD context with `onDragStart/onDragEnd` (kanban, sidebar); center panel has its own drag store `Dw`.
- Tree layout store `wg` for the center panel (`ensureCenterPanelLayout`, `moveCenterPanelTab`, `splitCenterPanelGroup`, `setCenterPanelSplitSize`). VERIFIED @10208300.
- Surface/anchor system (`fN`, `zre`) that places long-lived DOM (terminals, browser webviews) over layout anchors so they survive tab switches. VERIFIED @11701611.

---

## 9. Build implications for the remake

- The shell is small: two nested resizable groups, one tab tree, one command registry. Build the command registry first (id, default key, category, when-clause, configurable) and derive menus, palette, tooltips and the shortcut dialog from it.
- Put every setting in one declarative registry (tab, key, scopes, title, description, keywords, render). Search, deep links, repo overrides and org scope then come for free.
- Workspace status is a pure function of (session aggregate status, workspace lifecycle, PR info, forge). Copy `CWt` and the git header machine `r9i`. They are the core of the sidebar, Home and Git panel.
- Keep long-lived DOM (terminals, browser, desktop) in a surface layer outside React tab content.
- Cloud/team features (Routines, Pull requests, Pokes, workspace chat, Share, org settings, cloud desktop) are a second product on top of the local one. A local-only remake can skip every item tagged "cloud" in section 1.2.

## 10. Not verified

- Exact tab limits (default). Settings text says "up to 10" for Tab Freak Mode. Constant `5` near the terminal tab store (M@2959906) is a candidate default. INFERRED.
- New member onboarding screen content (`dor`).
- Full list of Home card "Display" options ordering. Fields seen: Repository, Repository icon, Line changes, Cost, Owner, Last active.
- Behaviour of the `§` trigger.
- Individual `Tool*` card layouts beyond labels. Their base is the `Tool` family in the UI kit.
- Settings dialog "Sync agent configs" details and "Custom provider" fields beyond labels.
