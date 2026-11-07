# Tauri command contract

The names the Rust shell registers and `apps/desktop/src/platform/tauri.ts` calls. Both sides use exactly these names. Arguments use camelCase in JavaScript, which Tauri maps to snake_case in Rust. Every command returns `Result<T, CommandError>` (see `src-tauri/src/error.rs`), which the Platform turns into a `Result` value.

Binary data (terminal output, history, images) travels as base64 strings or through a `tauri::ipc::Channel`, never as JSON number arrays.

Dialogs, clipboard text and images, opening URLs, notifications permission and the SQL database use their Tauri plugins directly from `platform/tauri.ts`. Window focus, theme and drag and drop, and the webview zoom, use Tauri's window and webview API (the zoom needs `core:webview:allow-set-webview-zoom` in `capabilities/default.json`). They need no custom command.

| Platform method                                  | Command                                                                      | Rust module         | Events emitted                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------- | -------------------------------------- |
| `app.health`                                     | `health`                                                                     | lib.rs              |                                        |
| `app.dbVersionWarning`                           | `db_version_check`                                                           | db.rs               |                                        |
| `app.version`, `app.channel`                     | `app_info`                                                                   | lib.rs              |                                        |
| `app.onQuitRequested`, `app.quit`                | `app_quit`                                                                   | lib.rs              | `app://quit-requested`                 |
| `app.onDeepLink`                                 | `deep_link_launch` (the launch links)                                        | deep_link.rs        | `app://deep-link`                      |
| `app.onDeepLinkRejected`                         | `deep_link_launch` (the refused launch links)                                | deep_link.rs        | `app://deep-link-rejected`             |
| `app.resourceUsage`                              | `resource_usage`                                                             | resource_usage.rs   |                                        |
| `app.writeLog`                                   | `log_write`                                                                  | logger.rs           |                                        |
| `app.setLogLevel`                                | `log_set_level`                                                              | logger.rs           |                                        |
| `app.exportLogs`                                 | `logs_export`                                                                | logger.rs           |                                        |
| `app.setQuitHandlerReady`                        | `set_quit_handler_ready`                                                     | lib.rs              |                                        |
| (startup)                                        | `db_version_check`                                                           | db.rs               |                                        |
| `shell.run`                                      | `shell_run`                                                                  | shell.rs            |                                        |
| `shell.start`, `RunningCommand.cancel`           | `shell_start`, `shell_cancel`                                                | shell.rs            | `shell://done`                         |
| `shell.loginEnv`                                 | `shell_login_env { cwd }` (null for the app-wide capture)                    | shell.rs            |                                        |
| `fs.readText`                                    | `fs_read_text`                                                               | files.rs            |                                        |
| `fs.writeTextAtomic`                             | `fs_write_text_atomic`                                                       | files.rs            |                                        |
| `fs.exists`, `fs.stat`                           | `fs_stat`                                                                    | files.rs            |                                        |
| `fs.mkdirp`                                      | `fs_mkdirp`                                                                  | files.rs            |                                        |
| `fs.readDir`                                     | `fs_read_dir`                                                                | files.rs            |                                        |
| `fs.trash`                                       | `fs_trash`                                                                   | files.rs            |                                        |
| `fs.paths`                                       | `fs_paths`                                                                   | files.rs            |                                        |
| `fs.registerRoot`                                | `fs_register_root` (also adds the folder to the asset protocol's scope)      | files.rs            |                                        |
| `fs.assetUrl`                                    | (`convertFileSrc`, the asset protocol)                                       | files.rs            |                                        |
| `fileSearch.listTree`                            | `search_list_tree`                                                           | file_search.rs      |                                        |
| `fileSearch.fuzzyMatch`                          | `search_fuzzy`                                                               | file_search.rs      |                                        |
| `fileSearch.grep`                                | `search_grep`                                                                | file_search.rs      |                                        |
| `fileSearch.listArtifacts`                       | `search_list_artifacts`                                                      | file_search.rs      |                                        |
| `pty.spawn`                                      | `pty_spawn` (takes a Channel for output)                                     | pty.rs              | `pty://exit` (with `historyError`)     |
| `PtyHandle.write`                                | `pty_write`                                                                  | pty.rs              |                                        |
| `PtyHandle.resize`                               | `pty_resize`                                                                 | pty.rs              |                                        |
| `PtyHandle.kill`                                 | `pty_kill`                                                                   | pty.rs              |                                        |
| `PtyHandle.ack`                                  | `pty_ack`                                                                    | pty.rs              |                                        |
| `PtyHandle.screenText`                           | `pty_screen_text`                                                            | pty.rs              |                                        |
| `PtyHandle.screenSnapshot`                       | `pty_screen_snapshot`                                                        | pty.rs              |                                        |
| `pty.loadHistory`                                | `pty_load_history`                                                           | terminal_history.rs |                                        |
| `sidecar.ensureStarted`                          | `sidecar_ensure_started`                                                     | sidecar.rs          |                                        |
| `sidecar.send`                                   | `sidecar_send`                                                               | sidecar.rs          |                                        |
| `sidecar.onLine`, `sidecar.onRestart`            |                                                                              | sidecar.rs          | `sidecar://line`, `sidecar://restart`  |
| `sidecar.logPath`                                | `sidecar_log_path`                                                           | sidecar.rs          |                                        |
| `keychain.get`, `.set`, `.delete`                | `keychain_get`, `keychain_set`, `keychain_delete`                            | keychain.rs         |                                        |
| `notifications.notify`                           | `notify`                                                                     | notifications.rs    | `notification://clicked`               |
| `notifications.setDockBadge`                     | `set_dock_badge`                                                             | notifications.rs    |                                        |
| `opener.revealInFinder`                          | `reveal_in_finder`                                                           | open_with.rs        |                                        |
| `opener.openWith`                                | `open_with`                                                                  | open_with.rs        |                                        |
| `opener.installedApps`                           | `installed_apps`                                                             | open_with.rs        |                                        |
| `speech.available`, `.start`, `.stop`, `.cancel` | `speech_available`, `speech_start` (Channel), `speech_stop`, `speech_cancel` | speech.rs           |                                        |
| `updater.check`, `.install`, `.relaunch`         | `updater_check`, `updater_install`, `updater_relaunch`                       | updater.rs          | `updater://status`                     |
| `updater.installedUpdate`                        | `updater_installed_update`                                                   | updater.rs          |                                        |
| `attachments.materialize`, `.resizeImage`        | `attachment_materialize`, `image_resize`                                     | attachments.rs      |                                        |
| `attachments.writeBytes`                         | `attachment_write_bytes` (bytes as base64)                                   | attachments.rs      |                                        |
| `clipboard.readFilePaths`                        | `clipboard_read_file_paths`                                                  | pasteboard.rs       |                                        |
| `menu.setShortcuts`, `menu.onCommand`            | `menu_set_shortcuts`                                                         | menu.rs             | `menu://command` (payload: command id) |
| `window.isFocused`, `.onFocusChanged`            | (window API)                                                                 |                     | `tauri://focus`, `tauri://blur`        |
| `window.onFileDrop`                              | (webview API `onDragDropEvent`)                                              |                     |                                        |
| `window.setZoom`, `window.setTheme`              | (webview and window API)                                                     |                     |                                        |
| `window.setVibrancy`                             | `window_set_vibrancy`                                                        | window.rs           |                                        |
| `window.setTrafficLightPosition`                 | `window_set_traffic_lights`                                                  | window.rs           |                                        |
| `window.toggleInspector`                         | `window_toggle_inspector` (needs Tauri's `devtools` feature)                 | window.rs           |                                        |
| `system.info`                                    | `system_info`                                                                | lib.rs              |                                        |
| `system.isOnline`, `.onNetworkChanged`           | `network_status`                                                             | network.rs          | `network://changed`                    |
| `system.hasFullDiskAccess`                       | `full_disk_access_check`                                                     | permissions.rs      |                                        |
| `system.openFullDiskAccessSettings`              | `full_disk_access_open_settings`                                             | permissions.rs      |                                        |
| `programs.statuses`, `.onStatus`                 | `programs_state`                                                             | binaries.rs         | `programs://status`                    |
| `programs.install`, `.redownload`, `.remove`     | `program_install`, `program_redownload`, `program_remove`                    | binaries.rs         |                                        |
| `programs.prefetchForUpdate`                     | `programs_prefetch`                                                          | binaries.rs         |                                        |
| `programs.verificationErrors`                    | `programs_verification_errors`                                               | binaries.rs         | `programs://verification-errors`       |
| `programs.syncPathOverrides`                     | `programs_sync_path_overrides`                                               | binaries.rs         |                                        |
| `http.fetch`                                     | `http_fetch`                                                                 | http.rs             |                                        |
| `http.download`, `HttpDownload.cancel`           | `http_download` (Channel for progress), `http_cancel`                        | http.rs             |                                        |
| `cloud.paired`                                   | `cloud_paired`                                                               | cloud.rs            |                                        |
| `cloud.request`                                  | `cloud_request`                                                              | cloud.rs            |                                        |
| `cloud.openRelay`, `CloudRelay.send`, `.close`   | `cloud_relay_open`, `cloud_relay_send`, `cloud_relay_close`                  | cloud.rs            | `cloud://line`, `cloud://closed`       |

Commands outside the Platform interface:

- `notification_take_pending`: returns notification clicks that arrived before the web view was ready, so a click that launches the app is not lost.

## Sidecar launch

How the Rust shell (`sidecar.rs`, PLAT-09) starts the sidecar, and what the sidecar (`packages/sidecar`) expects. Both sides follow this list.

Command: `conducted-sidecar sidecar`. There is no logger mode; the sidecar writes its log lines to stderr (D026).

Environment the Rust shell sets. Today the launcher sets every row the sidecar reads: all of them except `CONDUCTED_ACP_PROVIDERS_DIR`, which is set when the feature that reads it is built (SIDE-15), and `CONDUCTED_SKILL_PLUGIN_DIR` only when the build ships the skill. A contract test compares the launcher's list with what `packages/sidecar/src` reads (PLAT-09):

| Variable                       | Meaning                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `CONDUCTED_PARENT_PID`         | The app's process id. The sidecar exits when its parent changes (SIDE-19).                                                               |
| `CONDUCTED_OUTBOX_ROOT`        | Folder for the write-ahead event log (SIDE-06).                                                                                          |
| `CONDUCTED_LOG_DIR`            | Folder for sidecar log files.                                                                                                            |
| `CONDUCTED_BIN_DIR`            | `<app data>/bin`: the helper scripts and the links to the managed programs; agents get it first on PATH (PLAT-35).                       |
| `CONDUCTED_APP_VERSION`        | The app version, for logs.                                                                                                               |
| `CONDUCTED_LOG_LEVEL`          | The most detailed level the sidecar writes (SIDE-18).                                                                                    |
| `CONDUCTED_AGENT_BINARIES_DIR` | `<app data>/agent-binaries`, the managed programs, `<program>/<version>/`. A bin link that points in here is the managed copy (PLAT-28). |
| `CONDUCTED_ACP_PROVIDERS_DIR`  | Folder where the sidecar installs ACP adapters (OpenCode, Pi) (SIDE-15).                                                                 |
| `CONDUCTED_SKILL_PLUGIN_DIR`   | The bundled skill that teaches agents the app, given to Claude (AGENT-18).                                                               |
| `CONDUCTED_COMPLETIONS_DIR`    | Folder for the saved slash-command lists (SIDE-22).                                                                                      |
| `CONDUCTED_CURSOR_STORE_DIR`   | `<app data>/cursor-sdk-store`, one Cursor SDK run store per workspace (AGENT-09).                                                        |

The sidecar never reads the database, so it gets no database path.

Handshake: the sidecar prints one line `SOCKET_PATH=<path>` on stdout once its Unix socket listens. Everything else on stdout and stderr is log output, which the Rust shell writes to `<app data>/logs/sidecar-<pid>.log`. Routing it into the app log files with a sidecar tag (D026) is a SIDE-18 item that is not built yet.

Environment the sidecar sets for each agent process: `CONDUCTED_WORKSPACE_ID`, `CONDUCTED_WORKSPACE_NAME`, `CONDUCTED_WORKSPACE_PATH`, `CONDUCTED_ROOT_PATH`, `CONDUCTED_DEFAULT_BRANCH`, `CONDUCTED_PORT`, `CONDUCTED_SESSION_ID`, and `CONDUCTED_APP_TOOLS_TOKEN` for the app-tools bridge. `spotlighter.sh` also needs `CONDUCTED_CHECKPOINTER_PATH`, `CONDUCTED_WATCHEXEC_PATH` and `CONDUCTED_ROOT_PATH`; the app downloads and updates `watchexec` (PLAT-35, D024).
