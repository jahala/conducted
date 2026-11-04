/**
 * @feature SET-02 Advanced settings page
 * Owns: the Advanced page of Settings: where files live, agent program paths, and terminal
 * history size.
 * Behaviour: ui-map.md 6, "Advanced" table; services-map.md 4.2.3. Left out as cloud: SSH key path,
 * remote execution, always-allow local commands, file sync in cloud workspaces. The "set upstream
 * on plain push" row appears on the Git page only (one home per setting).
 * Rows (our wording), key, control:
 *   Root folder for repositories  conductor_root_path          folder picker, with a warning
 *   and workspaces                                             that it should be empty and
 *                                                              left alone
 *   Claude Code program path      claude_executable_path       path field, empty means search PATH
 *   Codex program path            codex_executable_path        path field
 *   OpenCode program path         opencode_executable_path     path field
 *   Pi and Cursor program paths   (keys set by SET-01)         path fields
 *   Terminal history size         terminal_scrollback_limit_   number with unit, default 10 MB
 *                                 bytes
 * Our design choice: program paths are checked when saved by asking the sidecar for the version;
 * an invalid path is refused with the reason (decision 7 in the scaffold plan: agent programs come
 * from the user's machine first).
 * Must handle: a path that does not exist or is not executable, a folder change for a root that
 * already holds workspaces (refuse, explain, no move), an empty value meaning "use PATH", and a
 * history limit below the minimum.
 * Test first: saving a non-existent program path shows the error and does not call settings.set.
 */
import { notImplemented } from "@conducted/shared";

export function AdvancedPage(): never {
	return notImplemented("SET-02");
}
