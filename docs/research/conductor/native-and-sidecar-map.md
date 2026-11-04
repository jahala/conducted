# Conductor 0.92.1: native shell, sidecar, scripts and on-disk map

Scope: structure of the Rust shell, the Bun sidecar, the bundled scripts and the files on disk. Read-only inspection of the installed app on 2026-11-04. Builds on `overview.md`, `sessions.md`, `claude-runner.md`, `other-runners.md` and `frontend.md` in this folder. Those are not repeated here, only linked by topic.

Legend: **[V]** verified, with evidence given inline (a string, a symbol, a line number in `sidecar.js`, command output). **[I]** inferred from names or neighbouring code. Line numbers `L12345` point into `.context/conductor-re/sidecar.js`.

Method notes that matter for trust:
- The Rust binary keeps its mangled Rust symbols. A pass over them (`conductor_lib::<module>::<fn>`) gives a ground-truth module-to-function map. Section A2 is built from that, not from guesses.
- Apple `strings` skips parts of a Mach-O file by default. String claims were re-checked on a full byte scan of the binary (173,187 printable runs).
- Secrets were not printed. Sentry, PostHog, Honeycomb and updater keys exist in the binary. They are referred to by role only.

---

## A. Rust shell (Tauri 2)

### A1. Build facts

| Item | Value | Evidence |
|---|---|---|
| Bundle id, version | `com.conductor.app`, 0.92.1 | [V] `Info.plist` |
| Binary | one Mach-O arm64, about 72 MB, no `Frameworks/` | [V] `ls` |
| URL scheme registered | `conductor` | [V] `Info.plist` `CFBundleURLSchemes` |
| Entitlements | `allow-jit`, `allow-unsigned-executable-memory`, `audio-input` | [V] `codesign -d --entitlements -` |
| Privacy strings | microphone (speech-to-text); Desktop, Documents, Downloads folders ("coding agents read and write files in your repositories") | [V] `Info.plist` |
| Core crates | tauri 2.11.1, wry 0.55.1, tao 0.35.2, muda 0.19.1 (menus), tokio 1.52.3, sqlx 0.8.6 (migrations) and rusqlite 0.32.1 (direct SQL), reqwest 0.12/0.13 + rustls, hyper 1.9, tokio-tungstenite 0.24 | [V] cargo paths in binary |
| Terminal crates | alacritty_terminal 0.26, portable-pty 0.9, vte | [V] |
| Search crates | `ignore` 0.4.25, `nucleo-matcher` 0.3.1 (fuzzy), `grep-searcher`/`grep-regex` (in-process ripgrep engine), `globset` | [V] |
| Image crates | `image` 0.25.10, `infer` 0.19 | [V] |
| Telemetry crates | sentry 0.46.2, posthog-rs 0.27 | [V] |
| macOS bindings | objc2 0.6 family (`app-kit`, `foundation`, `user-notifications`, `web-kit`, `osa-kit`), security-framework 3.6 | [V] |
| Other | `notify` + `notify-debouncer-full` (file watching), `notify-rust`, `rfd` (dialogs), `minisign-verify` (updater signatures), `fix-path-env` | [V] |
| Tauri plugins | app, clipboard-manager 2.3.2, deep-link 2.4.9, dialog 2.2.1, fs 2.2.1, http 2.4.3, notification 2.3.3, opener 2.2.7, os 2.3.2, shell 2.3.5, sql 2.4.0, store 2.4.3, updater 2.10.1, window-state 2.4.1, plus core event, image, menu, path, webview, window | [V] crate paths + ACL strings |
| Linked frameworks | AppKit, WebKit, Security, UserNotifications, SystemConfiguration, OSAKit, AVFoundation, Speech, CoreData, CloudKit, Accelerate, plus the Swift runtime | [V] `otool -L` |
| Swift code | one Swift file, `ConductorOnDeviceSpeech/OnDeviceSpeech.swift`, linked into the Rust binary | [V] string |
| Workspace crates | `file_sync_client`, `file_sync_core`, `tcp_tunnel_core`, `workspace_runtime_core` (grep, pty, terminal_mirror) | [V] source paths |
| Chromium variant | scripts `tauri:cef`, `tauri:cef:build`, a data path `data-tauri-cef-internal`, and URL schemes `conductor-alpha-chromium`. A Chromium build of the shell exists for dev or alpha. The shipped app uses WKWebView. | [V] package.json L35321, deep-link scheme list, string |

### A2. Module map

Command names are Tauri `#[tauri::command]` functions. Module is taken from the mangled symbol. "UI list" means the command is in the 104-name list of `frontend.md`.

| Module (`src-tauri/src/`) | Responsibility | Commands (all [V] by symbol or string) | Events emitted |
|---|---|---|---|
| `lib.rs` (`run`, `init_common`) | Builds the app: plugins, menus, window state, `fix_path_env`, raises the file-descriptor limit, panic hook that forwards stderr, Sentry/PostHog init, startup binary preparation | `execute_shell_command`, `execute_shell_command_cancellable`, `cancel_shell_command` (kills the process group), `write_file_async`, `get_db_uri`, `get_file_metadata`, `check_codex_auth`, `check_full_disk_access`, `open_settings_page`, `open_devtools`, `quit_app`, `set_quit_handler_ready`, `configure_http_proxy`, `configure_verbose_logging`, `set_dock_badge`, `update_window_vibrancy`, `update_traffic_light_position`, `crash_rust` (test crash), `get_binary_verification_errors` | `quit_requested`, `binary_verification_errors`, the menu events in A5 |
| `sidecar.rs` | Starts, talks to and kills the sidecar. Section A6. | `ensure_sidecar_started`, `rpc_to_sidecar`, `check_sidecar_http_health`, `get_sidecar_log_path`, `get_sidecar_http_connection`, `configure_sidecar_internal_user`, `configure_sidecar_inspect` | `rpc_from_sidecar` |
| `pty.rs` + crate `workspace_runtime_core::pty/terminal_mirror` | PTY terminals with an alacritty screen model. A "mirror" is a headless copy of a terminal screen. | `pty_spawn`, `pty_write`, `pty_resize`, `pty_kill`, `pty_ack_bytes` (flow control), `pty_screen_snapshot`, `pty_screen_text`, `pty_create_mirror`, `pty_write_mirror`, `pty_resize_mirror`, `pty_delete_mirror` | `pty-data`, `pty-exit`, `pty-ready` |
| `terminal_history_storage.rs` | Per-terminal scrollback records, plus the app-wide encrypted "local storage" layer (key, AES-style entry encryption, size limits, eviction) | `pty_load_terminal_history`, `pty_persist_terminal_history`, `get_or_create_local_storage_encryption_key` | none |
| `file_search.rs` | File tree, fuzzy file match, content grep. Gitignore-aware. | `list_file_tree`, `fuzzy_filter_files`, `fuzzy_match_files`, `grep_workspace`, `list_workspace_artifacts` | none |
| `attachments.rs` | Copies dropped files into `draft-attachments/`, resizes images to fit the Claude size limit, uploads files to a cloud workspace | `materialize_local_path_attachment`, `resize_image`, `upload_file_to_remote_workspace`, `write_encoded_image_to_clipboard` (module of the last one [I]) | none |
| `native_http.rs` | Rust-side HTTP client with progress, cancel, proxy and an allowlist. Used because the webview cannot do streaming downloads or custom TLS. | `native_http_fetch`, `native_http_fetch_cancel`, `native_http_download_file`, `native_http_upload_file`, `native_http_upload_cancel` | download and upload progress (Tauri channel) |
| `raw_websocket.rs` | WebSocket client that can go through an HTTP proxy. Used for cloud workspace connections. | `raw_websocket_open`, `_send_text`, `_ping`, `_close` | `raw-websocket-event` |
| `binary_manager.rs` | Downloads, verifies, installs and removes agent binaries. Section A9. | `get_agent_binary_state`, `request_agent_binary_download`, `redownload_agent_binary`, `remove_agent_binary`, `prefetch_agent_binaries_from_updater_endpoint`, `prefetch_agent_binaries_for_update`, `sync_agent_path_overrides`, `set_agent_binary_failure_injection` (test hook) | `agent_binary_progress` |
| `binary_verification.rs` | At launch: copies the app's `bin/` resources to the data dir, runs each binary to prove it works, re-copies on failure. Section A9. | none (state read through `get_binary_verification_errors`) | `binary_verification_errors` |
| `updater.rs` | Self-update and "manual update" download with retry | `get_installed_manual_update` (`check_for_updates` is defined in `lib.rs`) | `manual_update_status` |
| `notifications.rs`, `notifications/macos.rs` | Native notifications through `UNUserNotificationCenter`. A click on a notification becomes a deep link. | `send_native_notification`, `take_pending_notification_deep_links` | click handler feeds `notification-deep-link-click` [I from UI name `jZa`] |
| `on_device_speech.rs` + Swift | Dictation with Apple's on-device speech stack | `start_on_device_speech`, `stop_on_device_speech`, `cancel_on_device_speech` | speech events through a Tauri channel |
| `port_forward.rs` + `tcp_tunnel.rs` + crate `tcp_tunnel_core` | Local TCP listeners that forward to a port in a cloud workspace. Section A10. | `start_port_forward`, `stop_port_forward`, `list_port_forwards`, `find_available_local_port`, `resolve_port_forward_token`, `reject_port_forward_token` | `port-forward-event`, `port-forward-token-request` |
| `file_sync.rs` + crate `file_sync_client` / `file_sync_core` | One-way mirror from a cloud workspace to a local folder. Section A10. | `start_remote_file_sync`, `stop_remote_file_sync`, `trigger_remote_file_sync`, `cleanup_remote_file_sync`, `set_remote_file_sync_foreground`, `get_remote_file_sync_status`, `resolve_remote_file_sync_direct_info`, `reject_remote_file_sync_direct_info` | `remote-file-sync-status`, `remote-file-sync-direct-info-request` |
| `file_sync_tracing.rs` | A `tracing` layer that turns sync log lines into structured events with a forwarding budget | none | none |
| `app_actions.rs` | Client of the actions server (internal users only). Section A7. | `ensure_app_actions_started`, `get_app_actions_url`, `poll_app_action`, `submit_app_action_result` | none (long polling) |
| `app_logger.rs` | Starts and talks to the logger server. Section A7. | `ensure_app_logger_started`, `get_app_logger_connection`, `submit_app_logs`, `export_app_logs`, `configure_app_logger_persistence`, `configure_app_logger_external_logging_disabled` | none |
| `resource_usage.rs` | Process table with memory footprint per terminal and sidecar, with command lines redacted | `get_resource_usage` | none |
| `posthog.rs`, `sentry` (in lib) | Analytics and crash reports. Both honour `disable_external_logging` and `enterprise_data_privacy`. | `set_posthog_user_context`, `configure_sentry_external_logging_disabled` | none |
| `keychain_settings.rs` | Secrets in the macOS Keychain | `get_keychain_setting`, `set_keychain_setting`, `delete_keychain_setting` | none |
| `db_rollback.rs` | Refuses a schema newer than the app. Section A11. | `get_db_version_warning` (command in `lib.rs`, logic here) | none |
| `migrations.rs`, `client_cache_migrations.rs` | Embedded SQL for `conductor.db` and `cache.db` | none | none |
| `network_change.rs` (macOS) | SystemConfiguration watcher | none | `network-changed` |
| `navigation_guard.rs` | Keeps the webview on the app origin. External links open in the browser. | none | none |
| `quarantine_attr.rs` | Removes `com.apple.quarantine` from downloaded agent binaries | none | none |
| `tauri_stdio_logging.rs` | Redirects stdout and stderr into the Tauri log when enabled | none | none |

[V] for the table: every command and module name above exists as a symbol or string in the binary.

**Six UI-called commands that the binary does not contain.** The UI calls `get_user_shell`, `get_path_env`, `get_anthropic_api_key_from_env`, `get_openai_api_key_from_env`, `get_deepgram_api_key` and `on_device_speech_available`. [V] a full byte scan of the binary finds none of these names and no symbol for them, while the other commands are found as strings or symbols. [I] they are dead or stale calls. The UI wraps most in `catch` and falls back (`/bin/zsh`, "unknown", `false`, a toast "Failed to initialize speech-to-text"). Treat the 104-name list in `frontend.md` as "called by the UI", not "implemented by Rust". One puzzle: the terminal shell-integration files are rewritten at each launch, and that code first awaits `get_user_shell`. So either that call resolves some other way, or the write happens on a path I did not trace. Open item.

### A3. Tauri plugins and ACL (what the webview may do)

[V] the strings exist in the binary. [I] which plugin each list belongs to, and whether a path is allowed or denied. The binary also contains every permission identifier each plugin defines (`allow-appdata-read-recursive` and so on). That list does not prove which ones are granted.
- Explicit file paths the webview may reach: `$HOME/.claude.json`, `$HOME/.claude/*`, `$HOME/.claude/commands`, `$HOME/.claude/agents`, `$HOME/Library/Application Support/Claude/claude_desktop_config.json`. The UI reads these to import commands, agents and MCP servers from Claude Code and Claude Desktop. Glob entries for `**/*/.git`, `.conductor`, `.context`, `.github` and `$HOME/.claude/**` also exist.
- `shell` scope names: `exec-bash` (`/bin/bash`), `exec-kill`, `exec-which`, `exec-open`, `validator`, and `claude-sidecar` pointing at `$APPDATA/bin/.internal/sidecar`.
- `http` and `opener` URL scopes: `app.conductor.build`, `stage-app`, `funhouse-app`, `conductor.build`, `app.chorus.sh`, `localhost` and `127.0.0.1` on any port, `api.github.com`, `github.com/user-attachments`, `private-user-images.githubusercontent.com`, `api.linear.app/graphql`, `platform.claude.com/v1/oauth/token`, `api.conductor.build`, `stage-api`, `funhouse-api`, `conductor-roundhouse.fly.dev`, `statuspage.incident.io`, Cloudflare R2 buckets (`conductor-public-{prod,staging}`, `conductor-user-{prod,staging}`), `sb-*.vercel.run` (cloud sandbox previews, http and wss), `*.ngrok-free.dev`, `*.ngrok.dev`. The opener list adds `linear://`, `vscode://`, `slack://`, `figma://`, `notion://`, `raycast://` and the System Settings Full Disk Access pane.

### A4. Events (Rust to UI)

[V] `Uo("…")` listeners in the UI bundle, plus event strings in Rust.

| Event | Source module | Payload role |
|---|---|---|
| `rpc_from_sidecar` | sidecar | one JSON-RPC line from the sidecar |
| `pty-data`, `pty-exit`, `pty-ready` | pty | terminal bytes, exit, ready |
| `agent_binary_progress` | binary_manager | `{agent, kind, state, bytesDownloaded, bytesTotal, error, nextAttemptUnixMs, attempt}` |
| `binary_verification_errors` | binary_verification | list of failed binaries |
| `manual_update_status` | updater | status, `already_in_progress`, `no_update_available`, `downloading`, `ready`, `failed` |
| `port-forward-event`, `port-forward-token-request` | port_forward | forward state; request for a fresh token from the UI |
| `remote-file-sync-status`, `remote-file-sync-direct-info-request` | file_sync | sync state; ask UI for the direct connection info |
| `raw-websocket-event` | raw_websocket | message, binary, pong, close, error |
| `network-changed` | network_change | network came or went (UI uses it to reconnect) |
| `quit_requested` | lib | user chose Quit; UI finishes work, then calls `quit_app` |
| menu events | lib | A5 |

### A5. macOS integration

**Menus** [V] strings and ids in `lib.rs`. Built with muda from the default menu, then edited.

| Menu | Item (id) | Accelerator | Action |
|---|---|---|---|
| App | About Conductor | default | standard about panel |
| App | Check for Updates | none | `check_for_updates` |
| App | Settings... | `CmdOrCtrl+,` | emits to the UI, `open_settings_page` |
| App | Quit (`custom_quit`) | `Cmd+Q` | emits `quit_requested` so the UI can confirm and flush |
| View | Toggle Left Sidebar (`toggle_left_sidebar`) | none in Rust. The UI binds `Cmd+B` and `[` itself. | emits `toggle_left_sidebar` |
| View | Toggle Right Sidebar (`toggle_right_sidebar`) | none in Rust. UI: key `B` with another modifier set, and `]`. | emits `toggle_right_sidebar` |
| Help | Keyboard Shortcuts | none | emits `open_keyboard_shortcuts_dialog` |
| Help | Documentation | none | emits `open_documentation_url` |
| Help | Best Practices | none | emits `open_best_practices_url` |
| Help | Changelog | none | emits `open_changelog_url` |
| Help | Send Feedback (`send_feedback`) | `CmdOrCtrl+Alt+F` | emits `open_feedback_dialog` |
| Help | Submit a Prompt... | none | emits `open_submit_prompt_dialog` |
| Help | Diagnostics... | none | emits `open_diagnostics_page` |
| Help | Debug | `CmdOrCtrl+Alt+I` | [I] toggles the web inspector (`open_devtools` exists) |

Also [V]: a "Close Window" item is looked up in the Window menu and rewired, and the gear icon uses an SF Symbol. The UI-side shortcut registry (command ids like `view.toggleLeftSidebar`) lives in the main bundle near offset 3,782,000. [I] The Edit and Window menus come from Tauri's defaults.

**Other native features**

| Feature | How | Evidence |
|---|---|---|
| Dock badge | `set_dock_badge` (and `set_badge_count/label` from the window plugin) | [V] symbol |
| Vibrancy | `update_window_vibrancy(isDarkMode)` applies an `NSVisualEffectView`. `set_window_appearance` sets the NSWindow appearance. `startup_sidebar_transparency_enabled` gates it. | [V] symbols, "Failed to apply window vibrancy" |
| Traffic lights | `update_traffic_light_position(zoomLevel)` and `set_traffic_light_inset`. The UI offsets its header with a CSS variable. | [V] |
| Notifications | `ConductorNotificationCenterDelegate` implements `willPresent` and `didReceiveNotificationResponse`. Clicks queue a deep link (`PENDING_DEEP_LINKS`) that the UI drains with `take_pending_notification_deep_links`. Sound type is a user setting (`sound_type`). | [V] |
| Keychain | `keychain_settings`: generic-password items, per-key value, "create if absent", strings `com.conductor.app.` and `.settings`. The UI keeps secrets such as `gh_token`, `gh_cloud_token` (with expiry and source) behind a `platform.secrets` interface, most likely this. | [V] symbols and strings; exact service name and the UI link [I] |
| Speech | Swift `OnDeviceSpeech.swift`. Errors "No audio format is compatible with the transcriber", "microphoneDenied", level meter queue `com.conductor.on-device-speech.levels`. Looks like Apple's newer on-device SpeechAnalyzer path. | [V] strings; API name [I] |
| Network watcher | SCDynamicStore run-loop source, emits `network-changed` | [V] "Failed to create network change store" |
| Full Disk Access | `check_full_disk_access` reads the TCC database path and the opener scope lists the Privacy pane | [V] strings |
| Devtools to Chrome | The sidecar inspector can open `devtools://` in Google Chrome through AppleScript (OSAKit) when `configure_sidecar_inspect` is on | [V] "tell application "Google Chrome" to open location" |
| Quarantine | `strip_quarantine` after downloads | [V] |
| File descriptors | Raises the open-file limit at start | [V] "Failed to raise file descriptor limit" |
| Window state | `.window-state.json` through the window-state plugin | [V] file on disk |
| Zsh integration | The UI writes `terminal-shell-integration/zsh/{.zshenv,.zprofile,.zshrc,.zlogin}` and starts PTYs with `ZDOTDIR` pointing there. The files source the user's own dotfiles, then emit OSC 633 markers (`Conductor;ProgramStart;…`, `CommandDone`, `Prompt`) so the UI knows which program runs in a terminal. | [V] files and UI code (renderApp) |

### A6. How the sidecar is launched and supervised

[V] unless marked.

1. Two Bun children start at app launch. `ps` shows both with the app as parent: `…/bin/.internal/conductor-runtime logger` and `…/bin/.internal/conductor-runtime sidecar`. The logger starts first.
2. The binary is run from the data dir copy (`~/Library/Application Support/com.conductor.app/bin/.internal/`), not from inside the `.app`. `binary_verification` put it there.
3. Handshake over stdout. The sidecar prints `HTTP_PORT=<n>` and `SOCKET_PATH=<path>` (L35143, L35147). The logger prints `LOGGER_PORT=<n>`. The actions server prints `ACTIONS_PORT=<n>` (L4472). Rust reads these lines. A bad port gives "Sidecar reported an invalid HTTP port".
4. Stdin HTTP bootstrap. Rust sets `CONDUCTOR_SIDECAR_HTTP_BOOTSTRAP=stdin-v1` and writes one JSON line `{"protocol":"sidecar-http-bootstrap-v1","bearerToken":"<43 chars base64url>"}` to the sidecar's stdin (L35418, L35440). The sidecar waits at most 2 s and reads at most 1024 bytes. It then serves only `GET /v1/health` on `127.0.0.1:<random port>`. It checks `Host`, rejects any `Origin` except `tauri://localhost`, and compares the bearer token in constant time. The token is never in the environment. `check_sidecar_http_health` is the Rust caller.
5. Main channel. The sidecar listens on a Unix socket `$TMPDIR/conductor-sidecar-v2-<pid>.sock` (L313932). Rust connects. Traffic is newline-delimited JSON-RPC 2.0, both ways. `rpc_to_sidecar` writes a line. Each line from the sidecar becomes the `rpc_from_sidecar` event. See `frontend.md` section 3c for the method list.
6. Environment Rust sets for the sidecar [V] names found together in `sidecar.rs`: `CONDUCTOR_INTERNAL_BIN_DIR`, `CONDUCTOR_INTERNAL_SKILL_PLUGIN_DIR` (the bundled `conductor-skill`), `CONDUCTOR_AGENT_BINARIES_DIR`, `CONDUCTOR_ACP_PROVIDERS_DIR`, `CONDUCTOR_SESSION_EVENT_OUTBOX_ROOT`, `CONDUCTOR_SIDECAR_V2_COMPLETIONS_DIR`, `CONDUCTOR_SIDECAR_HTTP_BOOTSTRAP`, `CONDUCTOR_DB_PATH`. Also set for the children [V]: `APP_TYPE`, `APP_VERSION`, `SENTRY_DSN`, `CONDUCTOR_INTERNAL_USER`, `CONDUCTOR_EXTERNAL_LOGGING_DISABLED`, `CONDUCTOR_APP_LOGGER_{URL,DIR,AUTH_TOKEN,CLIENT_UUID,MAX_MEMORY_BYTES}`, `CONDUCTOR_HONEYCOMB_*`, and dev-only `SIDECAR_NODE_INSPECT(_BRK)`. Which child gets which is [I].
7. Two directories are passed on purpose: the outbox root and the completions cache live in the app data dir (`sidecar-v2-session-event-outbox/`, `sidecar-v2-completions/`). Without the env var the sidecar defaults to `~/.conductor/…` (L313950, L313917).
8. `CONDUCTOR_DB_PATH` lets the sidecar open `conductor.db` **read-only** for the mobile "remote control" feature (L37305 to L37325: `new Database(path, {readOnly: true, timeout: 5000})`). The sidecar never writes the database.
9. Supervision.
   - The sidecar polls `process.ppid` every 2 s. If the parent changed, it shuts down (L313960 watchdog).
   - Rust also hunts orphans: it runs `ps -axo stat=,pid=,ppid=,ucomm=,args=`, matches `conductor-runtime sidecar` (and the dev path `src/client/sidecar-v2`), and sends SIGKILL ("[RUST] Killing orphaned sidecar process"). [V] strings, matching rule [I].
   - Idle policy inside the sidecar: agent processes are disconnected after 30 min idle (`EJi = 1800000`, L314188) and at most 2 idle warm processes are kept (`maxWarmProcesses: 2`, L313919).
   - I found no automatic restart loop in Rust. Stderr and stdout are forwarded as "Sidecar stdout/stderr/error", and an exit gives "Sidecar terminated unexpectedly". The UI calls `ensure_sidecar_started` again. [I]
   - A start timeout message mentions "Failed to start Claude Code within 2 minutes" because start waits for agent-binary preparation (`binaryPreparation` argument). [V] string.
10. Logs. The sidecar writes `$TMPDIR/conductor-<sidecar pid>.log` with mode 0600 (L35078 prefix `conductor-`; `conductor-40824.log` matches the live sidecar pid). `get_sidecar_log_path` returns it and the UI offers "open sidecar logs". There is no `~/Library/Logs/com.conductor.app`. [V]
11. The app also appends `$APPDATA/bin` to `PATH` ("Appended bin directory to PATH"), so `conductor`, `gh`, `claude`, `codex` resolve in every terminal. `fix_path_env` first repairs `PATH` from the login shell. [V]

### A7. Helper servers: app-actions and app-logger

Both are modes of the same Bun binary (section B5).

| | app-actions | app-logger |
|---|---|---|
| Who may run it | Internal users only. `app_actions.rs` reads `internal_settings_enabled` from `conductor.db` `settings`. The server exits with "only available for internal users" otherwise. [V] | Always started. Honeycomb export only for internal users. [V] |
| Port handshake | `ACTIONS_PORT=<n>` on stdout, discovery file `latest-actions-server.json` | `LOGGER_PORT=<n>`, discovery file `<data dir>/logs/latest-server.json` ({pid, updatedAt, url}) |
| Role | A long-poll bridge so a script or agent can drive Conductor's own UI like a test runner. | In-memory ring buffer of UI, Rust and sidecar logs, with optional disk persistence and export. |
| Rust side | `poll_app_action` (GET `/poll`), `submit_app_action_result` (POST `/result`), `get_app_actions_url`, `ensure_app_actions_started` | `submit_app_logs` (POST `/logs`), `export_app_logs`, `get_app_logger_connection`, persistence and external-logging switches |
| Privacy | none needed | Stops external export when `disable_external_logging` or `enterprise_data_privacy` is set |

### A8. Deep links

[V] parser in the main bundle (`yit`, near the `fit` scheme list). Schemes accepted: `conductor`, `conductor-alpha`, `conductor-alpha-chromium`, `conductor-beta`, `conductor-funhouse`, `conductor-patch`, `conductor-dev`. Only `conductor` is registered by this build's `Info.plist`. The URL host selects the route.

| URL | Meaning |
|---|---|
| `conductor://auth?code=…&state=…` or `?token=…` | Sign-in callback |
| `conductor://gh-auth?token&app_client_id&state&nonce&expires_at` | GitHub App token hand-off |
| `conductor://settings-enable?key=` | Turn on an experimental setting |
| `conductor://settings/...` | Open a settings page (`open-settings`) |
| `conductor://workspace?id=<id>&session=<id>` | Open a workspace, optionally a session |
| `conductor://async?repo=<name>&plan=<base64>` | Start an async workspace from a plan |
| `conductor://automation?organizationId&id` | Open a routine |
| `conductor://browser?url&workspace-id&navigate` | Open a URL in the in-app browser |
| `conductor://loadout?d=<encoded>` | Equip a shared loadout |
| `conductor://cloud-collab-onboarding`, `join-organization-onboarding`, `github-connected?organizationId&status` | Onboarding steps |
| `conductor://dev/workspaces`, `dev/workspace?id&row` | Dev-app only |
| `conductor://session/<workspaceId>` | Recognised and reported as unsupported |
| `conductor://path=<dir>&branch=<name>&prompt=<text>` (any other host; the part after `scheme://` is split on `&` into `key=value`) | Create a workspace with a prefilled prompt |
| `conductor://linear_id=<id>&prompt=<text>` (same format) | Create from a Linear issue |
| `__onboarding_add_repository` host | Internal onboarding step |

Inline code in chat that looks like these deep links, and links to `linear://`, `vscode://`, `slack://`, `figma://`, `notion://`, `raycast://`, is turned into clickable links by the markdown pipeline. Notification clicks reuse the same router. Cold-start links arrive through `deep-link://new-url` and `plugin:deep-link|get_current`.

### A9. Updater and binary manager

**Updater** [V]
- Endpoint template: `https://cdn.crabnebula.app/update/melty/conductor/{{target}}-{{arch}}/{{current_version}}`. The host is CrabNebula Cloud. The org name is `melty`.
- Signatures are minisign. The public key is embedded.
- The Tauri updater plugin does the normal update. `updater.rs` adds a "manual update": `start_manual_update`, `download_with_retry`, persisted state, and `get_installed_manual_update` (the UI shows release notes after relaunch). Status events are `manual_update_status`.
- The update manifest also carries an agent-binary manifest (`AgentBinaryManifest`, `UpcomingAgentBinaries`). `prefetch_agent_binaries_from_updater_endpoint` reads it so the next claude and codex builds download before the app updates. [V] symbol names, flow [I].

**Binary manager** [V]
- Agents: `claude`, `codex`, plus the aux artifact `codex-code-mode-host`. ACP providers (OpenCode) are handled by the sidecar instead (section B3).
- Source: `https://assets.conductor.build/<agent>/<agent>-<version>-darwin-<arm64|x64>` with `.zst` and `.gz` variants. Pinned versions in this build (from `package.json` L35321): claude 2.1.308, codex 0.164.0, ripgrep 15.1.0, GitHub CLI 2.100.0, gh-stack 0.1.0.
- A manifest entry has per-arch `sha256`, `size`, `gzipUrl`, `zstdUrl`. Download goes to `*.download.partial`, is decompressed (system `zstd` or `gzip`), hashed with `sha256_of_file`, then renamed to `agent-binaries/<agent>/<version>/<agent>`.
- Metadata per install: `agent-binaries/.meta/<agent>-<version>.json` = `{sha256, size, downloaded_at_unix_ms, verified_mtime_unix_ms}`. Later checks compare size and mtime before trusting the file; a mismatch raises `binary_metadata_verification_failed`.
- PATH shims: `bin/claude`, `bin/codex`, `bin/codex-code-mode-host` are symlinks into `agent-binaries/…/<version>/`. A user-set executable path (setting `claude_executable_path`) is mirrored into `bin-overrides/<hash>/claude` by `sync_agent_path_overrides`. [V] on disk (the override here points to a personal router script).
- Retry state per agent: `attempt`, `nextAttemptUnixMs`, `error` in the progress event. A test hook, `set_agent_binary_failure_injection`, makes downloads fail on purpose.
- Pruning: only the current claude (262 MB) and codex (314 MB) binaries remain on disk. Their `.meta` records are never removed (39 files, 156 KB). OpenCode provider versions pile up: 9 versions, 1.8 GB. [V] `du`, `ls`. Who prunes claude and codex is [I] (`remove_agent_binary` exists).

**Launch verification** (`binary_verification.rs`) [V]
- `bin_source_markers` (`.bin-source-markers.json`) records name, size, created and modified time of each file copied from `Contents/Resources/bin`. A change triggers a re-copy.
- `prepare_binaries` copies resources, `try_run` executes each versioned binary, `verify_or_recopy` retries and re-copies, strips quarantine, and removes any "unexpected PATH-visible binary" from `bin/` so only known entries remain.

### A10. Cloud pieces: port forwarding, tunnels, file sync

All of this only matters for cloud (Linux sandbox) workspaces. [V] symbols and strings, behaviour [I].

- **Roundhouse** is Conductor's cloud server (`conductor-roundhouse.fly.dev`, `api.conductor.build`). Sandboxes run on Vercel (`sb-*.vercel.run`).
- **tcp_tunnel** opens one multiplexed stream per connection to `/direct/tcp-tunnel`, with an idle watchdog and stream gauges. `/direct/tcp-proxy` and `/direct/ssh` are sibling paths.
- **port_forward** binds a local port and pipes each accepted connection through a tunnel or a websocket (`pipe_tcp_tunnel`, `pipe_tcp_ws`). It sniffs the first bytes to tell HTTP from SSH (`read_ssh_client_banner`). When the remote port is dead it answers with an HTML error page "Port {{PORT}} isn't responding" (themed with the app's CSS). Tokens for the tunnel come from the UI: the forward emits `port-forward-token-request`, the UI answers with `resolve_port_forward_token` or `reject_port_forward_token`. Table `port_forwards` stores them (migrations 100, 128, 131).
- **file_sync** (crate `file_sync_client`): a loop that pulls changes from the remote workspace into a local mirror. Endpoints under `/files/sync/` : `bootstrap`, `snapshot`, `read`, `write`, `delete-batch`. State files in the mirror: `baseline.json`, `tracker-position.json`. Uses revision and generation cursors ("delta revision mismatch" triggers a resync). A `path_guard` rejects `..`, absolute paths, NUL, `.git`, and symlinks that leave the mirror. Git helpers run with a locked-down environment (no system config, `GIT_TERMINAL_PROMPT=0`, a credential helper that reads `GH_TOKEN`, `core.hooksPath` off, LFS smudge skipped). "Foreground" mode syncs faster for the visible workspace. Direct connection info is requested from the UI (`…direct-info-request`). The mirror lives under `~/conductor/remote-workspace-sync/` (path from the UI, not present here).

### A11. Database: migrations and rollback

[V] `select … from _sqlx_migrations` read-only, and strings.

- `conductor.db` is migrated by Rust. The SQL is embedded (`migrations::get_migrations`), executed through the sql plugin's sqlx migrator. The UI then reads and writes with `tauri-plugin-sql` (no `CREATE TABLE` in the UI).
- `cache.db` has its own list (`client_cache_migrations`, 14 entries): `create session cache`, `session pending messages mirror`, `navigation sections cache`, `favorite models cache`, `cache cloud workspaces, sessions, repos, identities, port forwards`, `reset cloud session caches`, `drop local session transcript copies`, `track loaded session feed segments`. Tables: `client_cache_session_segments`, `client_cache_session_state`, `session_pending_messages(_state)` and copies of repos, workspaces, sessions, session_messages, port_forwards, navigation tables, favorite_models, identity_associations.
- `conductor.db` has 149 rows in `_sqlx_migrations`, max version 152. **Versions 124, 125 and 126 are absent.** Every row has `success = 1`. Tables now: attachments, diff_comments, env_vars, favorite_models, identity_acceptances, identity_associations, local_workspace_deletion_tombstones, local_workspace_revision_counter, migration_rollbacks, navigation_section_memberships, navigation_sections, port_forwards, repos, session_assets_outbox, session_events, session_messages, session_messages_outbox, session_messages_outbox_state, session_state, sessions, settings, symlinks_pending_deletion, terminal_sessions, workspaces.
- **Rollback.** Migration 80 creates `migration_rollbacks(version, down_sql)`. 69 rows are filled, so newer migrations register their own down SQL. At startup `db_rollback::preflight_db_rollback` compares the DB version with the app's newest migration. If the DB is newer (an app downgrade), it produces a `MigrationWarning` instead of running. The message tells the user to run `script/rollback-db.sh` (a repo script, not shipped). `get_db_version_warning` hands the warning to the UI. [V] strings, the rest [I].
- Settings table keys now (69): onboarding steps, sidebar and panel layout, fonts, theme, default models and efforts, `claude_executable_path`, `model_catalog_cache`, `roundhouse_client_user_id`, `client_instance_id`, `enterprise_data_privacy`, one-shot migration flags such as `file_backed_settings_migration_complete`. Settings are moving to files (`~/.conductor/settings.toml`, repo `.conductor/settings.toml`); migration 111 added `deprecated_at` for that.

#### Migration timeline (grouped)

Dates are install times on this Mac. Versions 1 to 65 were applied in one batch (2026-01-27), so the real order is the version number.

| Period / versions | What changed |
|---|---|
| 1 to 7 | Main schema, `settings` table, `unread_count`, pending message (added then dropped), compaction columns, notes |
| 8 to 15 | `attachments`, queued messages (`sent_at`), `full_message` for slash commands, `is_compacting`, per-session and per-message `model`, `cancelled_at` |
| 16 to 36 | Storage version, archive script, workspace `unread`, repo `display_order`, placeholder branch names, workspace lifecycle `state` (later a 5-state system), `permission_mode`, run-script columns, `parent_branch`, `remote`, `thinking_level`, big terminal mode, setup and initialization log paths, last-user-message time |
| 37 to 49 | Checkpointing columns, multiple sessions per workspace (`workspace_id` on sessions), `is_hidden`, `agent_type`, `turn_id` backfill, session `title`, provider settings folded into `claude_env_vars`, codex model renames. Checkpoint data cleared twice for bad pre-release data |
| 50 to 65 | `pinned_at`, branch prefix = `github_username`, `linked_workspace_ids`, notes moved to workspaces, context-used percent, `diff_comments` table, custom prompt columns on repos, `conductor_config` on repos, codex thinking level, manual and derived workspace status |
| 66 to 85 (Feb to Apr 2026) | `archive_commit`, PR title and description, `enterprise_data_privacy` (renamed from strict), diff comment avatar, outdated and resolved flags, multi-line comments, repo icon and hidden, `symlinks_pending_deletion`, secondary directory name, `fast_mode`, **`migration_rollbacks`**, fix-error and resolve-conflict prompts, linked directory paths, agent personality, `is_resumable_message`, dropped the workspaces `updated_at` trigger |
| 86 to 100 (Apr to May) | **Cloud begins:** `hosting_server_url`, `sandbox_provider`, `workspace_path`. Terminal history metadata, `claude_effort_level`, `feed_offset`, **message queue** (`queue_order`, `queue_paused_at`), attachment `comment_id`, Graphite stacks off by default, `file_include_globs`, sound settings merged, **`port_forwards`** |
| 101 to 123 (May to Sep) | `sender_id`, `env_vars` table, workspace permission level, remote workspace creators, spotlight testing on repos, cloud workspaces setting removed, remote file-sync intent, client that created the workspace, organization owner, assignee and watchers, `sender_session_id` and API key name, `workspace_template_id`, queued-message and dedupe indexes, `is_computer_admin`, remote session archive events, **session message and asset outboxes** |
| 127 to 148 (Sep to Oct) | Retained uploaded attachment state, auto-forward toggles, workspace access summaries, cloud workspace numbers, per-workspace port-forward master toggle, **`navigation_sections` + memberships** (sidebar sections, emoji, kind), **`favorite_models`**, stable local vs server identities (`identity_associations`, `identity_acceptances`), workspace `description`, **ACP session config options**, suggestion code on diff comments, `sender_source`, `edited_at`, workspace `revision` |
| 149 to 152 (Oct 24) | Workspace activity separated from row updates, local workspace revision counter, **`session_events` and `session_state`** (local raw event log), `reverted_at` on events |

Model-default migrations are a running joke in the list: 13, 34, 42, 47, 48, 54, 68, 103, 109, 113, 136 each move defaults or rewrite retired model ids (opus, sonnet, gpt-5.1 to 5.6 codex). A remake should keep model ids in a catalog, not in rows. Conductor ended up doing that with `setModelCatalog` (section B).

---

## B. Sidecar (`conductor-runtime`, Bun single-file executable)

### B1. Entry point and modes

[V] L347497 to L347526.

```
conductor-runtime --version         -> "conductor-runtime 0.92.1"
conductor-runtime <mode> [args...]  mode in: actions | sidecar | internal | logger | cli | codex-mcp
```

`process.argv` is rewritten so each mode sees its own args. Wrapper scripts call it: `bin/conductor` = `cli`, `bin/.internal/{actions,internal,logger,sidecar}`. `codex-mcp` has no wrapper. Codex's config launches `conductor-runtime codex-mcp …` directly (L312237).

| Mode | Entry (lazy module) | Lines | Used by | What it does |
|---|---|---|---|---|
| `sidecar` | `wJi` | L314190 | Rust app | Local agent host. Section B3. Builds `CJi` and calls `start()`. |
| `logger` | `mhs` | L344086 | Rust app | App logger HTTP server. Section B5. |
| `actions` | `Kqt` | L4459 | Rust app, internal users | UI automation bridge. Section B5. |
| `internal` | `D0s` | L341568 | Cloud sandbox | "Workspace child": session core running inside a Linux sandbox, talking to Roundhouse. Section B6. |
| `cli` | `y1s` / `g1s` | L347476, L347403 | Users and agents | The `conductor` command. Section B7. |
| `codex-mcp` | `bhs` | L344346 | Codex | stdio MCP server that bridges to the sidecar's Conductor tools. Section B5. |

### B2. Where things sit in the 347k lines

About 70 percent is bundled third-party code. Bun emits lazy `var X = B(() => {…})` module wrappers (1,716 of them). Names are minified. Ranges are approximate to a few hundred lines unless a line is cited. [V] by anchor strings, [I] where only sampled.

| Lines | Content | Kind | Evidence |
|---|---|---|---|
| 1 to 4,240 | Node/Bun shims, **zod 4** (core, locales, ISO, JSON schema) | lib | L1 to L4000 zod messages; `nS(j0,{ZodISODate…})` L3595 |
| 4,262 to 4,706 | **Actions server** `Kqt` (schemas L4262, HTTP server L4290 to L4420, entry L4459), promise helpers `NA` L4494 (`fireAndForget`, `withTrace`) | Conductor | L4262, L4459 |
| 4,707 to 5,400 | **Wire schemas.** `PV` query message L4708 (agentType claude/codex/cursor/acp, options), method enums `Fu`/`Vn`/`Ju` L4751 | Conductor | L4708, L4751 |
| 5,401 to 5,586 | `BGt`/`ad`: legacy RPC surface. Only the `request*`/`send*` helpers are still used (see `sessions.md`) | Conductor | L5402 |
| 5,587 to 6,100 | **Model catalog.** Per-harness model lists, labels, effort levels, fast-mode flags, host rules (`HB`, `WB`, `uLe`), defaults | Conductor | L5635 (opus-5-1m default), L5671 (cursor models) |
| 6,100 to 28,800 | **Sentry 10.67.0** (core, node, OpenTelemetry, tracing, many instrumentations) | lib | L6100 `Wr="10.67.0"`; `Sentry.init` L28770 |
| 28,800 to 31,820 | **posthog-node** (gzip, flush) | lib | L31782 |
| 31,929 to 34,832 | **pino** logger | lib | L31973 |
| 34,832 to 35,330 | `exe-proxy` helper script text (L35180 to L35320, env `EXE_PROXY_*`), embedded monorepo **`package.json`** (L35321) | Conductor | L35321 |
| 35,330 to 35,700 | Harness-version observer `pVe` (claude/codex binary versions), **stdin bootstrap + health server** (`e2r` L35418, `r2r` L35513), Sentry wrapper `i2r`, PostHog wrapper `P1` | Conductor | L35348, L35418 |
| 35,700 to 36,143 | Structured errors, log console reroute, **shell env capture** (`M2r`, L36006 to L36100) | Conductor | L36011 |
| 36,914 to 37,222 | **Frontend RPC tunnel** `MVe` (NDJSON JSON-RPC server+client over the socket) and frontend-request schemas | Conductor | L36914 `[FrontendRpcTunnel]` |
| 37,222 to 37,410 | `bSr` request bridge to the UI (used by remote control), read-only DB opener `FSr` (L37305), change dispatcher `rKe` | Conductor | L37319 |
| 37,409 to 39,300 | `@noble` hashes and curves (crypto for pairing) | lib | L37627 to L39185 |
| 39,300 to 45,110 | **Remote control (mobile).** Relay socket client `KKe`, phone request tunnel `$Ke`, pairing store `YKe`, subscription and replay engine `tYe`/`Twr`, route server `IYe`, workspace and session publishers `mYe`/`xYe`/`gYe`/`_Ye`, manager `eQe` | Conductor | L40631 `Relay connection failed`, L44930 |
| 45,104 to 45,650 | **Durable session-event outbox** (`W3r` L45259), delivery coordinator `sQe` L45544, process-log shipping to Roundhouse | Conductor | L45119, L45544 |
| 45,650 to 45,910 | OpenTelemetry process-logs for cloud children | Conductor | L45700 to L45906 |
| 45,910 to 47,850 | **ACP**: protocol types (zod) and a JSON-RPC connection `l8e` (builder, dynamic handlers) | lib-like | L47080 |
| 47,850 to 48,660 | ACP provider management: curl+sha256 install script generator (L48283), `CONDUCTOR_ACP_PROVIDERS_DIR`, `CONDUCTOR_AGENT_BINARIES_DIR` | Conductor | L48283 |
| 48,657 to 50,330 | **Session-feed client state** (`y8e`, `WL`, `NT`, `VL`): fold events into turns, approvals, ephemeral sessions, command replay. Shared with the mobile client. | Conductor | L48771, L50021 |
| 50,329 to 53,680 | **Conductor MCP server** (tool defs L52306 to L52451, `z1` factory L52539, socket bridge `_X` L52116) and **AcpAgentRunner** `W8e` (L53152) | Conductor | see `claude-runner.md` section 4 |
| 53,681 to 62,500 | MCP SDK (server types, client), ajv, utilities | lib | L56001, L60001 |
| 62,500 to 98,300 | **Claude Agent SDK** bundle with inlined zod, MCP client and OTel metric names (L68001 "Count of CLI sessions started") | lib | L80001, L84001; `createSdkMcpServer` L76302 |
| 98,284 to 99,557 | Skill-plugin dir wiring (L98480), Conductor MCP for Claude `AYr` (L98471), **Claude runner `Dat`** (L98832, SDK call L99336) | Conductor | `claude-runner.md` |
| 99,557 to 103,458 | **Codex runner `aut`/`Tat`** (L99615, createSession L102884), `@openai/codex-sdk` (L100001) | Conductor + lib | `other-runners.md` |
| 103,459 to 108,244 | `@bufbuild/protobuf` and connect (L103546) | lib | L103546 |
| 108,245 to 309,158 | **@cursor/sdk** (L108248 export list) with about 200k lines of generated protobuf for Cursor's APIs | lib | L108248 `Agent`, `Cursor`, `CursorAgentError…` |
| 309,158 to 310,093 | Cursor runner `zae` and its local JSONL store (`CONDUCTOR_CURSOR_STORE_DIR` L309544) | Conductor | L309544, L309917 |
| 310,093 to 312,036 | **Session core:** runner factory `gFe` (L310119), in-memory store `OFe`, handlers `PFe`, checkpoints (`checkpointer` L310258), `kFe` send (L311586), prompt assembly `SFe`/`IFe` (L311150 to L311462), workspace host `b4t` (L311905) | Conductor | `sessions.md` |
| 312,037 to 313,740 | Workspace config key and host registry `Zqi` (L312275), notifications `Dji` (L312561), Codex MCP consent (L313074), Agentation proxy toolbar (L313625 to L313732) | Conductor | L312275 |
| 313,740 to 313,869 | **Process manager `N4t`** (leases, idle sweep, warm cap) | Conductor | L313740 |
| 313,906 to 314,187 | **`CJi` sidecar server** (socket, watchdog, outbox replay, `setupJsonRpc`) | Conductor | L313906 |
| 314,190 to 314,620 | Entry `wJi`; `session.*` method names for the cloud RPC (L314259: `session.initialize`, `sendUserMessage`, `rollback`, `updateConfig`, …) | Conductor | L314190, L314259 |
| 314,620 to 336,328 | Libs: TypeBox, `@earendil`/pi-style **model registry `HYi`** (L319821) and **agent loop `YIt`** (L325592, steering and follow-up queues), Anthropic SDK (L326636, L333721), crypto and JWT helpers, MCP OAuth client (L336000) | lib | L319821, L325592 [I: pi-mono packages] |
| 336,328 to 336,600 | Piccolo MCP client `pOt` (L336572) | Conductor | L336572 |
| 336,598 to 338,452 | Streamable-HTTP MCP client `dOt` (L336345), JSONL memory store `Tke` (L337025), QuickJS (L338439) | lib + Conductor | L337025 |
| 338,453 to 339,142 | **CodeMode** tool (L338483), **Piccolo runner `POt`** (L338795) and its system prompt (L339003) | Conductor | L339003 |
| 339,143 to 340,110 | Roundhouse callbacks, **workspace checkout reporter**, remote checkpoint save (`checkpointId` rules) | Conductor | L339507 to L340084 |
| 340,110 to 340,631 | **GitHub auth broker** (helpers `git-askpass`, `gh`, `git`; Unix socket; token refresh from Roundhouse) | Conductor | L340200 to L340560 |
| 340,631 to 341,071 | PR association (`gh pr view`, workspace link footer), **computer-admin client** | Conductor | L340640 |
| 341,071 to 341,568 | **Session-message inbox** (claims, drains), Claude and Codex **agent-credential brokers**, cloud MCP and env fetch | Conductor | L341130 to L341568 |
| 341,568 to 341,900 | **`internal` entry `D0s`** (L341568) and the log store `Dde` (L341766) | Conductor | L341568 |
| 341,894 to 342,130 | **Logger HTTP server** routes (L341973 to L342060) | Conductor | L341973 |
| 341,900 to 343,848 | OpenTelemetry logs SDK and OTLP exporter | lib | L343258 |
| 343,849 to 344,085 | Honeycomb logs sink config (`KMt` L343932 endpoint `api.honeycomb.io/v1/logs`) | Conductor | L343932 |
| 344,086 to 344,185 | `logger` entry `mhs` | Conductor | L344086 |
| 344,185 to 344,376 | `codex-mcp` entry `bhs` and arg parser `KJu` | Conductor | L344200 |
| 344,377 to 345,725 | **commander** CLI library | lib | L344377 |
| 345,726 to 347,430 | **CLI**: config and keychain (L345769 to L345860), API client (`/v0/…`, L346064), command tree (L346400 to L347100), `g1s` runner (L347403) | Conductor | L345769, L347403 |
| 347,431 to 347,526 | Entry switch | Conductor | L347497 |

### B3. Conductor's own modules by role (local `sidecar` mode)

| Role | Where | Notes |
|---|---|---|
| RPC server over the socket | `MVe` L36914 (tunnel), `CJi.setupJsonRpc` L314010 | NDJSON JSON-RPC 2.0, one tunnel per app connection. Method tables in `frontend.md` 3c. |
| Wire schemas | L4707 to L5400, `kJi` L314259 | zod on every message in both directions |
| Session manager and host | `b4t` L311905, `PFe` handlers, `OFe` store, `kFe` send logic | `sessions.md` |
| Process manager | `N4t` L313740 | leases, 30 min idle, 2 warm processes |
| Runners | Claude `Dat` L98832, Codex `aut` L99615, Cursor `zae` L309917, ACP `W8e` L53152, Piccolo `POt` L338795 (cloud) | `claude-runner.md`, `other-runners.md`. Piccolo is new here: a never-ending chat agent with a summarising tree memory (`ZoomMemory`, `MemoryDate`), a Conductor MCP client for coordination tools (L336572) and a `CodeMode` tool that runs JavaScript in QuickJS over those tools (at most 32 tool calls, 64,000 char arguments). [V] system prompt L339003, CodeMode L338483. The loop looks pi-style [I]. |
| Conductor MCP tools | L52034 to L52600 | `AskUserQuestion`, `GetWorkspaceDiff`, `GetDiffComments`, `DiffComment`, `GetTerminalOutput`, `UpdateProgress`, `SetTargetBranch`, `RunLocalCommand`, five computer-admin tools. Claude gets them in process; Codex and ACP get them through the `cmcp-` socket and `codex-mcp`. |
| Durable outbox | `W3r` L45259, `sQe` L45544, `CJi.replaySessionEventOutbox` | One file per session, name = base64url(utf16le sessionId) + `.json`, keys `{version, sessionId, nextSequence, pending}`. UI acks with `persistedSessionEvent`. Default root `~/.conductor/sidecar-v2-session-event-outbox`; Rust overrides it into the app data dir. |
| Checkpoints | calls `checkpointer.sh` from L310258; cloud variant L339507 to L340084 | Refs `refs/conductor-checkpoints/session-<id>-turn-<id>-start|end`. Section C. |
| Prompt assembly | `SFe` L311150, `IFe` L311462, `Sqi`/`Oqi`/`g4t`/`fqi` L311173 to L311505 | `claude-runner.md` section 5 |
| Shell env capture | `M2r` L36056 | Runs the user's login shell once: zsh/bash `-ilc`, fish `-i -l -c`, fallback `zsh -lc`. Timeouts 5 s and 3 s. Prints `env` between a delimiter line. Strips `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `CODEX_ACCESS_TOKEN`, `CODEX_API_KEY`, `CURSOR_API_KEY`, `OPENAI_API_KEY`, `CONDUCTOR_CWD`, and `BASH_FUNC_*`. Sets `DISABLE_AUTO_UPDATE=true`. |
| Remote control | L36914 to L45110 | Mobile pairing. The desktop connects out to a relay (Roundhouse). A phone pairs with a one-time token (`createPairingToken`, `consumePairingToken`), then tunnels HTTP and WebSocket-like streams through the relay, with compression negotiation, a heartbeat, and per-device records. Secrets are stored by asking the UI (`remoteControlGetSecret/SetSecret`), which keeps them in the Keychain. Another desktop on the same account can "take over". The sidecar reads `conductor.db` read-only to serve workspace and session lists. `@noble` curves and hashes suggest end-to-end crypto. [V] structure, crypto purpose [I] |
| GitHub auth broker | L340110 to L340631 | Cloud only. Writes `git-askpass`, `gh`, `git` wrappers (mode 0700) and a Unix socket. Each session gets env `CONDUCTOR_GIT_AUTH_{CONTEXT,SOCKET,CAPABILITY}`, `GIT_ASKPASS`, `GIT_TERMINAL_PROMPT=0` and a `PATH` that prefers the wrappers. Tokens refresh from Roundhouse ahead of expiry. A 401 reported by a wrapper forces a refresh. Locally the token is passed as `ghToken` in the query options instead (L313903). |
| Model catalog | L5587 to L6100, `setModelCatalog` notification, `model_catalog_cache` setting | Server-pushed catalog validated per harness and host |
| Harness version tracking | `pVe` L35348 | Probes `claude --version` and `codex --version` when paths change; pushes `harnessVersionsNotification` |
| Logging | console reroute `DJi`, `bvr` app-logger client, `Dde` store L341766 | Section B5 |
| Telemetry | Sentry (`i2r`, release `conductor@<version>`, `sendDefaultPii:false`, dedupe `Pxe`), PostHog (`P1` capture, user from `setPostHogDistinctId`) | Both off when `setExternalLoggingDisabled` is set |
| Agent-binary and ACP provider paths | L48288, L35389 (`Bge`) | resolve `bin/claude`, `bin/codex`, provider dirs |
| Slash command snapshots | `w3r` (store), dir `sidecar-v2-completions/slash-command-snapshots.json` | cached `fetchSlashCommands` results; also the UI cache `pre-workspace-completions-v1` |
| Agentation | L313625 to L313732 | Proxy that injects the Agentation toolbar into the in-app browser and formats annotations for the agent; the toolbar is nudged to clear Conductor's "Next unread" button |

### B4. Environment variables the sidecar reads

Names only. [V] from `process.env.*` reads.

| Group | Variables |
|---|---|
| Set by Rust (local) | `APP_TYPE`, `APP_VERSION`, `SENTRY_DSN`, `LOG_LEVEL`, `CONDUCTOR_DB_PATH`, `CONDUCTOR_INTERNAL_BIN_DIR`, `CONDUCTOR_INTERNAL_SKILL_PLUGIN_DIR`, `CONDUCTOR_AGENT_BINARIES_DIR`, `CONDUCTOR_ACP_PROVIDERS_DIR`, `CONDUCTOR_SESSION_EVENT_OUTBOX_ROOT`, `CONDUCTOR_SIDECAR_V2_COMPLETIONS_DIR`, `CONDUCTOR_SIDECAR_HTTP_BOOTSTRAP`, `CONDUCTOR_INTERNAL_USER`, `CONDUCTOR_EXTERNAL_LOGGING_DISABLED`, `CONDUCTOR_APP_LOGGER_URL/AUTH_TOKEN/CLIENT_UUID`, `CONDUCTOR_CURSOR_STORE_DIR` |
| Logger and Honeycomb | `CONDUCTOR_APP_LOGGER_DIR`, `_MAX_MEMORY_BYTES` (default 2 GiB), `_MAX_DISK_BYTES` (default 100 MiB), `_PERSIST_TO_DISK`, `CONDUCTOR_HONEYCOMB_{LOGS_ENABLED,LOGS_DISABLED,SOURCE_ENVIRONMENT,USER_ID,CLIENT_ID,LOG_*}`, `HONEYCOMB_ENDPOINT/ENVIRONMENT` |
| Given to agents | `CONDUCTOR_WORKSPACE_PATH`, `CONDUCTOR_ROOT_PATH`, `CONDUCTOR_WORKSPACE_NAME`, `CONDUCTOR_DEFAULT_BRANCH`, `CONDUCTOR_PORT`, `CONDUCTOR_IS_LOCAL`, `CONDUCTOR_SESSION_ID`, `CONDUCTOR_WORKSPACE_ID`, `CONDUCTOR_MCP_AUTH_TOKEN`, `CONDUCTOR_API_URL`, `CONDUCTOR_API_KEY`, `CONDUCTOR_API_TOKEN` |
| Cloud (`internal` mode) | `CONDUCTOR_INTERNAL_ROUNDHOUSE_URL`, `…_WORKSPACE_ID`, `…_WORKSPACE_AUTH`, `…_CHILD_ENTRYPOINT`, `…_CLOUD_ENV_JSON`, `…_MCP_SERVERS_JSON`, `…_IDLE_TIMEOUT_MS`, `…_MAX_LIFETIME_MS`, `…_CLAUDE_EXECUTABLE_PATH`, `…_CODEX_EXECUTABLE_PATH`, `…_CLAUDE_AGENT_AUTH_MODE`, `…_CODEX_AGENT_AUTH_MODE`, `…_{CLAUDE,CODEX}_PER_SPAWN_AUTH`, placeholder variables for brokered credentials, `…_IS_COMPUTER_ADMIN`, `…_PR_WORKSPACE_LINK`, `…_SET_TARGET_BRANCH_TOOL`, `…_TARGET_BRANCH`, `…_WORKSPACE_SESSIONS_DIR`, `…_WORKSPACE_LOG_FILE`, `…_OTEL_*`, `…_PROCESS_LOG*`, `…_SENTRY_*`, `…_WORKLOAD_IDENTITY_URL`, `CONDUCTOR_WORKER_MODE`, `CONDUCTOR_GIT_AUTH_*`, `CONDUCTOR_REAL_GIT_PATH`, `CONDUCTOR_REAL_GH_PATH`, `CODEX_API_KEY`, `CURSOR_API_KEY` |
| Actions server | `CONDUCTOR_APP_ACTIONS_DIR`, `APP_TYPE`, `CONDUCTOR_INTERNAL_USER` |
| CLI | `CONDUCTOR_API_URL` (default `https://api.conductor.build`), `CONDUCTOR_API_KEY`, `CONDUCTOR_API_TOKEN`, `CONDUCTOR_WORKSPACE_ID`, `CONDUCTOR_INTERNAL_WORKSPACE_ID`, `CONDUCTOR_SESSION_ID`, `CONDUCTOR_IS_LOCAL`, `CONDUCTOR_WORKSPACE_PATH` |
| Claude SDK | `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_USE_{BEDROCK,VERTEX,FOUNDRY,MANTLE,…}`, OAuth overrides |

### B5. Modes `actions`, `logger`, `codex-mcp`

**`actions`** (L4262 to L4490) [V]
- HTTP server on `127.0.0.1:0`. Routes: `GET /health` ({ok, connected, pendingActions, queuedActions}), `GET /describe` (API help), `POST /execute` ({action, locator, value?}), `POST /query` ({locator, properties?}), `POST /explore` ({roles?}), `GET /poll` (long poll, 30 s, 204 when idle), `POST /result`.
- Locators mimic Playwright: `role` (+name, exact), `text`, `testId`, `label`, `placeholder`, `css`. Actions: `click`, `dblclick`, `fill`, `clear`, `check`, `uncheck`, `selectOption`, `hover`, `focus`, `blur`, `press`.
- Flow: a caller posts an action. The server queues it. The UI (through Rust `poll_app_action`) takes it, runs it against the DOM, and posts the result to `/result`. The caller's HTTP request completes with that result. Timeout 30 s returns 504.
- Priority is set below normal. Writes `latest-actions-server.json` to `$CONDUCTOR_APP_ACTIONS_DIR` and, in dev, to `~/.conductor/dev/app-actions/`. Gate: `APP_TYPE=dev` or internal user, otherwise exit 1.

**`logger`** (L344086, server L341973 to L342100) [V]
- HTTP on `127.0.0.1:0`, bearer token from `CONDUCTOR_APP_LOGGER_AUTH_TOKEN`. Routes: `GET /health`, `GET|POST /config`, `POST /logs`, `GET /logs` (filter by tags, origins, levels, search), `POST /save`, `POST /export` (NDJSON), `GET /stream` (server-sent events).
- Store `Dde`: ring buffer by bytes, optional continuous disk writing (`ensureSecureLogPath`, mode 0700 dirs, 0600 files), sinks. One sink exports OTLP logs to Honeycomb (`https://api.honeycomb.io/v1/logs`) for internal users only.
- Writes `latest-server.json` ({url, pid, updatedAt}) to the logs dir.

**`codex-mcp`** (L344185 to L344376) [V]
- A stdio MCP server (`@modelcontextprotocol/sdk` `McpServer` + stdio transport). Args: `--session-id`, `--socket`, `--workspace-dir`, optional `--enable-run-local-command`, `--enable-get-diff-comments`, `--enable-update-progress`, `--enable-set-target-branch`, `--enable-computer-admin`. Env `CONDUCTOR_MCP_AUTH_TOKEN` is required.
- It registers the same tool set as the in-process server (without `AskUserQuestion`) and forwards each call as one JSON line to the Unix socket `$TMPDIR/cmcp-<hash>-<rand>/s` that the sidecar owns. It also announces its pid ("hello") to the bridge.

### B6. Mode `internal` (cloud workspace child)

[V] L341568 to L341760; role [I].
- Runs inside a Linux sandbox, next to the checkout. Requires `CONDUCTOR_INTERNAL_ROUNDHOUSE_URL`, `…_WORKSPACE_ID`, `…_WORKSPACE_AUTH` or it throws.
- Reuses the same session core as the local sidecar (`PFe` handlers, `bFe` manager, `kFe` send). Differences: sessions persist in a file store under `…_WORKSPACE_SESSIONS_DIR`; there is no UI socket. Frontend requests (approvals, questions, diff, terminal) go to Roundhouse and a phone or desktop answers (`claimFrontendRpc`, `resolveFrontendRpc`).
- Work arrives by polling an inbox (`session-message-inbox`: discover, claim, drain, recover claims after restart). Each session emits `sandboxRestart` after a restart.
- Brokers: GitHub tokens (B3), Claude and Codex credentials per spawn (API key or subscription token placeholders swapped at the edge), MCP servers and env snapshot fetched from Roundhouse.
- Lifecycle: `…_IDLE_TIMEOUT_MS` and `…_MAX_LIFETIME_MS` timers. A checkout reporter watches git directories and reports branch heads. `CONDUCTOR_WORKER_MODE` runs one task and exits. Linux OOM attribution (`sessions.md`).
- After a PR is created it appends a hidden marker `<!-- conductor-workspace-link -->` and a link footer to the PR body.
- Optional tools: `RunLocalCommand` routed back to the user's Mac, and the computer-admin tools.
- The parent "workspace server" that spawns this child (`CONDUCTOR_INTERNAL_CHILD_ENTRYPOINT`) is not in this binary. [I] it ships in the sandbox image.

### B7. Mode `cli` (`conductor`)

[V] output of `bin/conductor --help` (read only) and L346064 to L347100. Version 0.92.1. It is a client of the public cloud API `https://api.conductor.build/v0/…`. It does not talk to the local app.

Global options: `-v/--version`, `--json`, `--token <token>`, `--debug` (logs every request), `--no-color`, `-h/--help`. Exit codes: 0 success, 1 runtime error, 2 usage error, 3 auth error, 4 server error.

| Group | Commands | API |
|---|---|---|
| auth | `login [--token]` (saves to Keychain, service `com.conductor.cli`), `logout`, `whoami`, `status` | `GET /me` |
| project | `list`, `get <id>`, `workspace <id>` | `/v0/projects`, `/v0/projects/{id}/workspaces` |
| workspace | `list` (filters: creator, mine, since, state, repo, name, include-archived, limit, offset, channel), `create` (project-id or repo-url, branch, name, session-name, agent, model, effort, fast-mode, message, message-file, env, channel), `get`, `rename`, `move` (section), `archive`, `session`, `status` | `/v0/workspaces`, `…/{id}/sessions`, `…/status`, `…/archive`, `…/rename`, `…/section`, `…/sleep` |
| section | `create <name> [--emoji] [--top]`, `delete`, `list` | `/v0/sections` |
| preview | `get`, `set --port`, `delete` | `/v0/workspaces/{id}/preview` |
| session | `create`, `get`, `rename`, `archive`, `message` (list transcript, `--after`), `status`, `cancel` | `/v0/sessions`, `…/messages`, `…/status`, `…/cancel`, `…/archive`, `…/rename` |
| message | `create --session … (--message | --message-file) [--attach] [--message-id]`, `get <id>` | `/v0/sessions/{id}/messages`, `/v0/messages/{id}`, `…/attachments` |
| routine | `create` (webhook trigger), `list`, `rotate-secret` | `/v0/routines`. Needs a user API key; a workspace token is refused. |
| model | list each agent's model ids, effort levels, defaults, favorites | `GET /v0/favorite-models` plus the catalog compiled into the CLI [I] |
| artifact (hidden, "internal experiment") | `new`, `publish <dir>`, `pull`, `list`, `delete`, `template` (list, create, update, delete) | team artifacts and templates; HTML plus `data.json`, versions |

Auth order: `--token`, then `CONDUCTOR_API_TOKEN` or `CONDUCTOR_API_KEY`, then Keychain. Inside a workspace the id defaults from `CONDUCTOR_WORKSPACE_ID`. Agents get this CLI on `PATH` and a hint in their first-message prompt. Effort levels accepted by agent (L346067): claude low, medium, high, xhigh, max, ultracode; codex none, low, medium, high, xhigh, max, ultra; cursor low, medium, high, xhigh.

### B8. Monorepo clues (from the embedded `package.json`, L35321)

[V] Root name `conductor` 0.92.0, pnpm 10.34, turbo, Bazel helper scripts, oxlint/oxfmt, vitest, Playwright component and visual-regression tests, Storybook.
- Layout from script paths: `src/client/frontends/desktop/{app,ui,terminal}`, `src/client/frontends/mobile/{native,shared,visual-preview}` (React Native with a Swift bridge generated from TypeScript), `src/client/shared`, `src/client/sidecar-v2`, `src/shared/core`, a `@roundhouse/internal` server package, `@conductor/webapp`, `@conductor/marketing`, `@conductor/internal`.
- Shared packages: `@shared/model-mappings`, `@shared/shellEnvCapture`, `@shared/use-scramble`, `@shared/utils`, `@desktop/terminal`.
- Codegen: `generate-rust-types`, `generate-zod`, `generate-settings-schemas`, SQLite and Postgres schema generation with `--check` modes. Boundary lints: `lint:tauri-boundary`, `lint:client-shared-boundary`, `lint:migrations-generated`.
- Pinned agent versions: claude 2.1.308, codex 0.164.0, ripgrep 15.1.0, GitHub CLI 2.100.0, gh-stack 0.1.0.

---

## C. Bundled scripts and binaries (`Contents/Resources/bin/`)

The same files are copied to `~/Library/Application Support/com.conductor.app/bin/` at launch (A9).

| File | Kind | Purpose | Interface |
|---|---|---|---|
| `conductor` | sh wrapper | `exec .internal/conductor-runtime cli "$@"` | args = CLI args |
| `.internal/{actions,internal,logger,sidecar}` | sh wrappers | `exec conductor-runtime <mode> "$@"` | none |
| `.internal/conductor-runtime` | Bun executable, 103.6 MB | all modes (section B) | `--version` |
| `checkpointer.sh` | bash, 323 lines | Private-ref snapshots of a worktree | below |
| `git-busy-check.sh` | bash, 52 lines | Is a git operation in progress? | below |
| `spotlighter.sh` | bash, 111 lines | Mirror a workspace into the repo root on every change (the "Spotlight" feature) | below |
| `watchexec` | binary 2.3.2 | File watcher used by spotlighter | upstream CLI |
| `gh` | binary, GitHub CLI 2.100.0 | PR, checks, auth | upstream CLI |
| `../conductor-skill/` | Claude plugin (`.claude-plugin/plugin.json`, `skills/conductor/SKILL.md`, 174 lines) | Teaches agents the product: settings files, scripts, env vars, docs links. Loaded with `--plugin-dir`. | frontmatter name `conductor` |

### C1. `checkpointer.sh`

- Usage: `checkpointer save [--id <id>] [--force]` | `restore <id>` | `diff <id1> <id2|current> [-- <git diff args>]` | `help`.
- Must run from the worktree root. Refuses if git's toplevel is an ancestor of the cwd (exit 103), to protect a git-controlled `$HOME`.
- `save`: calls `git-busy-check.sh`; if not `clean`, exit 101. Unmerged index entries: exit 102. Writes the index tree, then a full working-tree tree (tracked plus untracked, honouring `.gitignore`) through a temporary index. Creates a commit with a neutral identity (`Checkpointer <checkpointer@noreply>`) and a message holding `head`, `index-tree`, `worktree-tree`, `created`. Updates `refs/conductor-checkpoints/<id>`. Prints the id. Default id `cp-<UTC timestamp>`. An existing id needs `--force`. No file, HEAD or branch changes.
- `restore`: refuses a checkpoint saved on an unborn HEAD. Uses `reset --mixed` to the saved HEAD only when needed, `read-tree --reset -u` of the saved worktree tree (rewrites only differing files, so file watchers stay calm), `clean -fd` for stray untracked files (keeps ignored files), then restores the saved index and refreshes. Prints `restored checkpoint: <id>`.
- `diff`: left side is a checkpoint; right side is a checkpoint or `current` (a transient tree of the live worktree).
- Temp index dirs live in `<gitdir>/conductor-checkpoint-tmp/`, each with an `owner-pid` file. Dirs older than 60 minutes with a dead owner are pruned by the next run. `SIGTERM` and `SIGINT` exit 143 through the EXIT trap (Conductor sends SIGTERM on a save timeout).
- Exit codes: 0 ok, 1 error, 101 skipped (merge or rebase running), 102 skipped (unresolved conflicts), 103 refused (root is an ancestor of the cwd), 143 terminated.
- Env: none required. Uses `git` from `PATH`.

### C2. `git-busy-check.sh`

- Usage: `git-busy-check.sh <workspace-path>`.
- Prints one of `clean`, `busy:rebase`, `busy:merge`, `busy:squash-merge` (SQUASH_MSG plus unmerged entries), `busy:cherry-pick`, `busy:revert`. Logic follows git's `git-prompt.sh`.
- Exit 0 on success, 2 on a bad path or a non-repo (prints `error: …`).

### C3. `spotlighter.sh`

- No arguments. Required env: `CONDUCTOR_INT_CHECKPOINTER_PATH`, `CONDUCTOR_INT_WATCHEXEC_PATH`, `CONDUCTOR_ROOT_PATH` (the repo's main checkout). Run it with the workspace as the cwd. Exit 1 when a prerequisite is missing.
- It logs to `/tmp/conductor-spotlight-<pid>.log` (and stdout).
- `watchexec --watch . --shell=none --emit-events-to=environment --ignore '*.tmp.*' --ignore '.context/**'` runs a bash script on each change batch (watchexec serialises runs and queues the latest). The script prints which paths triggered it, runs `checkpointer save --id cp-spotlight-<epoch>-<pid> --force`, then `cd $CONDUCTOR_ROOT_PATH && checkpointer restore <id>`. A merge or rebase (exit 101) or a failed save skips the sync quietly. A failed restore warns and exits 0.
- Effect: the repo root mirrors the workspace's full state, so the user's dev server in the root runs the agent's changes. On stop, the UI restores the "pre-spotlight state" (`frontend.md` section 7).

---

## D. On-disk layout

Sizes are from this Mac. "Writer" names the code that creates the item.

### D1. `~/Library/Application Support/com.conductor.app/` (the data dir)

| Path | Size | What it holds | Writer / reader |
|---|---|---|---|
| `conductor.db` (+ `-wal`, `-shm`) | 12.3 GB, WAL 15 MB | Main SQLite DB, WAL mode: repos, workspaces, sessions, session_messages, session_events, outboxes, diff_comments, attachments, port_forwards, env_vars, navigation, settings, terminal_sessions | Rust runs migrations. The UI reads and writes through the sql plugin. The sidecar opens it read-only. [V] |
| `cache.db` (+ `-wal`, `-shm`) | 3.86 GB | Client cache (14 migrations): cloud workspaces, sessions, feed segments, pending messages, navigation | Rust migrations, UI access [V]. Space is not reclaimed (no vacuum) [I] |
| `local-storage.metadata.json` | 672 KB | Index of the local-storage layer: per subsystem `{subsystem, entryStorage, sizeLimit, totalSize, entries, protection?}` | Rust `terminal_history_storage` layer [V]; stale `*.tmp-<uuid>` copies from interrupted writes remain (2 files, about 1 MB) |
| `local-storage.subsystem.<name>.json` | 98 B to 4.4 MB | Small subsystems stored as one JSON file: `acp-session-config-options-v1`, `browser-local-storage`, `claude-context-windows`, `composer-drafts`, `dispatcher-state`, `model-picker-configs-v1`, `opencode-model-discovery-v1`, `pre-workspace-completions-v1`, `route-user-state`, `run-script-history`, `terminal`, `turn-changes-cache` (4.4 MB), `workspace-importance` | UI, with the key from `get_or_create_local_storage_encryption_key`. File mode 0600 [V] |
| `local-storage.entries/<subsystem>/` | 5.1 MB | One file per entry for bigger subsystems: `git-service-pr-v2` (41 files), `git-service-workspace-changes-v1`, `lottie-sprite-cache`, `terminal-history` (29 files, **encrypted**, limit 50 MiB). Dir mode 0700. | Rust (terminal history), UI [V]. Size limits of 5 MiB to 50 MiB per subsystem with eviction (`evict_old_terminal_history_entries`) |
| `sidecar-v2-session-event-outbox/` | 200 KB, 51 files | One JSON file per session with undelivered events | Sidecar writes, UI acks [V] |
| `sidecar-v2-completions/slash-command-snapshots.json` | 1.7 MB | Cached slash commands and skills per workspace | Sidecar [V] |
| `agent-binaries/{claude,codex}/<version>/` | 262 MB + 314 MB | Current agent executables only (old ones are pruned) | Rust binary manager [V] |
| `agent-binaries/.meta/<agent>-<version>.json` | 171 B each, 39 files | sha256, size, download and verify times. Never pruned. | Rust [V] |
| `agent-binaries/acp-providers/opencode/<version>/darwin-arm64/opencode` | 120 to 150 MB each, 1.8 GB for 9 versions | OpenCode ACP provider binaries, never pruned | Sidecar install script (curl + sha256) [V] |
| `bin/` | 308 MB | Copy of the app's `Resources/bin` plus symlinks `claude`, `codex`, `codex-code-mode-host` into `agent-binaries` | Rust `binary_verification` / `binary_manager` [V] |
| `bin-overrides/<hash>/claude` | symlink | User-chosen executable path | Rust `sync_agent_path_overrides` [V] |
| `.bin-source-markers.json` | 962 B | Name, size, mtimes of copied resources | Rust [V] |
| `terminal-shell-integration/zsh/.z{shenv,profile,shrc,login}` | 0.3 to 2.6 KB | `ZDOTDIR` shim with OSC 633 markers | UI, rewritten at each start [V] |
| `draft-attachments/` | empty now | Files copied from dropped paths while composing | Rust `attachments` [V] |
| `logs/latest-server.json` | 83 B | Discovery file of the logger server (pid, url, time) | logger process [V] |
| `opencode/opencode.db` | 700 KB | OpenCode's own database, used for model discovery | OpenCode binary [I] |
| `app-icons/` | small | Icons of "open in" apps (`iterm.png`, `xcode.png`) | UI [I] |
| `.window-state.json` | 216 B | Window size and position | window-state plugin [V] |

Other places the app touches, outside the data dir [V]:

| Path | What |
|---|---|
| `~/Library/Caches/com.conductor.app/` (7.6 MB) and `~/Library/WebKit/com.conductor.app/` (116 MB) | WebKit caches and storage |
| `~/Library/Preferences/com.conductor.app.plist` | Only window-frame and inspector defaults |
| `$TMPDIR/conductor-<sidecar pid>.log` | Sidecar log, mode 0600 (this one 672 KB). Older logs of earlier pids remain (`conductor-21240.log`, `conductor-88403.log`) |
| `$TMPDIR/conductor-sidecar-v2-<pid>.sock` | Sidecar JSON-RPC socket |
| `$TMPDIR/cmcp-<hash>-<rand>/s` | Per-workspace MCP bridge socket for Codex and ACP agents; 11 dirs remain from earlier runs |
| `$TMPDIR/conductor-<epoch>-<rand>.log`, `conductor-<rand>/` | Small temp logs and dirs |
| `/tmp/conductor-spotlight-<pid>.log` | Spotlight script log |
| `$TMPDIR/com.apple.WebKit.*+com.conductor.app` | WebKit helper processes' temp |
| Keychain | Service prefix `com.conductor.app.` (settings and secrets such as GitHub tokens); `com.conductor.cli` (CLI API token) |

### D2. `~/.conductor/`

| Path | Holds | Writer |
|---|---|---|
| `settings.toml` (651 B) | Global settings with a JSON-schema header: `claude_code_executable_path`, `claude_provider`, `codex_provider`, `[git] branch_prefix_type`, `[models] default, review, review_fast_mode, visible_provider_models`, `[models.claude_code] default_effort_level, review_effort_level`, `[models.codex] default_thinking_level, review_thinking_level` | UI (file-backed settings, migration 111) |
| `dev/app-actions/`, `dev/app-logs/` | Dev-build discovery files and logs; absent in production | actions and logger modes |
| `sidecar-v2-session-event-outbox/`, `sidecar-v2-completions/` | Defaults only. In the packaged app Rust redirects both into the data dir. | sidecar |

### D3. `~/conductor/`

| Path | Holds | Writer |
|---|---|---|
| `repos/<repo>/` | The main clone of each repository (`.git`, plus a `.conductor/` dir). This is the "root path" (`CONDUCTOR_ROOT_PATH`). Agents are told never to touch it (storage version 2). It also holds the private refs `refs/conductor-checkpoints/*` and `refs/conductor-archive-heads/*`. | UI via `git clone` |
| `workspaces/<repo>/<city>/` | One `git worktree` per workspace, on its own branch. `.git` is a file pointing to `<repo>/.git/worktrees/<city>`. Per-worktree config sets `push.autoSetupRemote`. Each has a gitignored `.context/` for notes, `todos.md`, `attachments/`, `pull-requests/<n>.md`, `plans/`, `artifacts/`. | UI via `git worktree add` (`frontend.md` section 6) |
| `archived-contexts/<repo>/<workspace>/` | The `.context` content of archived workspaces, kept after the worktree is removed | UI archive step [I] (the Rust binary has no such path; the UI path helper exists) |
| `cloud-workspaces/`, `remote-workspace-sync/` | Layout from the UI path helpers for cloud checkouts and the file-sync mirror; not present on this Mac | UI [V] helper, absent on disk |

On this Mac: 69 repos, 79 workspace folders, 9 archived-context folders.

---

## E. Open items and caveats

1. **Six UI-called commands without a Rust counterpart** (A2). Whether `get_user_shell` works through another route is unresolved. It needs a runtime trace in the devtools console, not static reading.
2. **Which sidecar children get which env vars** (A6 item 6) is inferred from adjacency in the string table.
3. **Speech API** (A5) is guessed as SpeechAnalyzer from error text. The Swift source is not recoverable.
4. **Remote control crypto.** Pairing and relay use `@noble` primitives, but I did not trace key exchange or what is end-to-end encrypted.
5. **Piccolo.** Found only in the cloud/`internal` path. Whether it is live, flagged or experimental is unknown. `agentType` in the local wire schema lists claude, codex, cursor, acp only.
6. **Sidecar restart policy** (A6): no restart loop seen in Rust symbols. Behaviour when the sidecar dies mid-turn was not tested.
7. **Which code writes `archived-contexts/`** is unconfirmed.
8. **Migration versions 124 to 126** are missing here. They may have been removed on purpose or may only exist in other builds.
9. Minified names (`moe`, `yit`, `Kqt`, `wJi`, line numbers) change on every build. Search by string, not by name.
