# Tauri command contract

The names the Rust shell registers and `apps/desktop/src/platform/tauri.ts` calls. Both sides use exactly these names. Arguments use camelCase in JavaScript, which Tauri maps to snake_case in Rust. Every command returns `Result<T, CommandError>` (see `src-tauri/src/error.rs`), which the Platform turns into a `Result` value.

Binary data (terminal output, history, images) travels as base64 strings or through a `tauri::ipc::Channel`, never as JSON number arrays.

Dialogs, clipboard, opening URLs, notifications permission and the SQL database use their Tauri plugins directly from `platform/tauri.ts`. They need no custom command.

| Platform method                                  | Command                                                                      | Rust module         | Events emitted                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------- | -------------------------------------- |
| `app.health`                                     | `health`                                                                     | lib.rs              |                                        |
| `app.dbVersionWarning`                           | `db_version_check`                                                           | db.rs               |                                        |
| `app.version`, `app.channel`                     | `app_info`                                                                   | lib.rs              |                                        |
| `app.onQuitRequested`, `app.quit`                | `app_quit`                                                                   | lib.rs              | `app://quit-requested`                 |
| `app.onDeepLink`                                 | (plugin)                                                                     | deep_link.rs        | `app://deep-link`                      |
| `app.resourceUsage`                              | `resource_usage`                                                             | resource_usage.rs   |                                        |
| `app.writeLog`                                   | `log_write`                                                                  | logger.rs           |                                        |
| `app.exportLogs`                                 | `logs_export`                                                                | logger.rs           |                                        |
| (startup)                                        | `db_version_check`                                                           | db.rs               |                                        |
| `shell.run`                                      | `shell_run`                                                                  | shell.rs            |                                        |
| `shell.start`, `RunningCommand.cancel`           | `shell_start`, `shell_cancel`                                                | shell.rs            | `shell://done`                         |
| `shell.loginEnv`                                 | `shell_login_env`                                                            | shell.rs            |                                        |
| `fs.readText`                                    | `fs_read_text`                                                               | files.rs            |                                        |
| `fs.writeTextAtomic`                             | `fs_write_text_atomic`                                                       | files.rs            |                                        |
| `fs.exists`, `fs.stat`                           | `fs_stat`                                                                    | files.rs            |                                        |
| `fs.mkdirp`                                      | `fs_mkdirp`                                                                  | files.rs            |                                        |
| `fs.readDir`                                     | `fs_read_dir`                                                                | files.rs            |                                        |
| `fs.trash`                                       | `fs_trash`                                                                   | files.rs            |                                        |
| `fs.paths`                                       | `fs_paths`                                                                   | files.rs            |                                        |
| `fileSearch.listTree`                            | `search_list_tree`                                                           | file_search.rs      |                                        |
| `fileSearch.fuzzyMatch`                          | `search_fuzzy`                                                               | file_search.rs      |                                        |
| `fileSearch.grep`                                | `search_grep`                                                                | file_search.rs      |                                        |
| `pty.spawn`                                      | `pty_spawn` (takes a Channel for output)                                     | pty.rs              | `pty://exit`                           |
| `PtyHandle.write`                                | `pty_write`                                                                  | pty.rs              |                                        |
| `PtyHandle.resize`                               | `pty_resize`                                                                 | pty.rs              |                                        |
| `PtyHandle.kill`                                 | `pty_kill`                                                                   | pty.rs              |                                        |
| `PtyHandle.ack`                                  | `pty_ack`                                                                    | pty.rs              |                                        |
| `PtyHandle.screenText`                           | `pty_screen_text`                                                            | pty.rs              |                                        |
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
| (attachments)                                    | `attachment_materialize`, `image_resize`                                     | attachments.rs      |                                        |
| (menu)                                           | `menu_set_shortcuts`                                                         | menu.rs             | `menu://command` (payload: command id) |

Commands outside the Platform interface:

- `notification_take_pending`: returns notification clicks that arrived before the web view was ready, so a click that launches the app is not lost.

## Sidecar launch

How the Rust shell (`sidecar.rs`, PLAT-09) starts the sidecar, and what the sidecar (`packages/sidecar`) expects. Both sides follow this list.

Command: `conducted-sidecar sidecar`. The separate logger mode goes when SIDE-18 is built (D026).

Environment the Rust shell sets:

| Variable                                         | Meaning                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `CONDUCTED_PARENT_PID`                           | The app's process id. The sidecar exits when its parent changes (SIDE-19). |
| `CONDUCTED_OUTBOX_ROOT`                          | Folder for the write-ahead event log (SIDE-06).                            |
| `CONDUCTED_LOG_DIR`                              | Folder for sidecar log files.                                              |
| `CONDUCTED_BIN_DIR`                              | Folder holding `checkpointer.sh`, `git-busy-check.sh`, `spotlighter.sh`.   |
| `CONDUCTED_APP_VERSION`                          | The app version, for logs.                                                 |
| `CONDUCTED_LOGGER_TOKEN`, `CONDUCTED_LOGGER_DIR` | Logger mode only; removed with it (D026).                                  |

The sidecar never reads the database, so it gets no database path.

Handshake: the sidecar prints one line `SOCKET_PATH=<path>` on stdout once its Unix socket listens. Everything else on stdout and stderr is log output, which the Rust shell writes into the app log files with a sidecar tag (D026).

Environment the sidecar sets for each agent process: `CONDUCTED_WORKSPACE_PATH`, `CONDUCTED_ROOT_PATH`, `CONDUCTED_DEFAULT_BRANCH`, `CONDUCTED_PORT`, `CONDUCTED_SESSION_ID`, and `CONDUCTED_APP_TOOLS_TOKEN` for the app-tools bridge. `spotlighter.sh` also needs `CONDUCTED_CHECKPOINTER_PATH`, `CONDUCTED_WATCHEXEC_PATH` and `CONDUCTED_ROOT_PATH`; the app downloads and updates `watchexec` (PLAT-35, D024).
