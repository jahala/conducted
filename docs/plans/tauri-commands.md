# Tauri command contract

The names the Rust shell registers and `apps/desktop/src/platform/tauri.ts` calls. Both sides use exactly these names. Arguments use camelCase in JavaScript, which Tauri maps to snake_case in Rust. Every command returns `Result<T, CommandError>` (see `src-tauri/src/error.rs`), which the Platform turns into a `Result` value.

Binary data (terminal output, history, images) travels as base64 strings or through a `tauri::ipc::Channel`, never as JSON number arrays.

Dialogs, clipboard, opening URLs, notifications permission and the SQL database use their Tauri plugins directly from `platform/tauri.ts`. They need no custom command.

| Platform method                                  | Command                                                                      | Rust module         | Events emitted                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------- | -------------------------------------- |
| `app.health`                                     | `health`                                                                     | lib.rs              |                                        |
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
