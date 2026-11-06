/**
 * @feature RUN-09 Zsh shell integration for terminals
 * Owns: where the zsh shim files live, so a terminal can report the program it runs.
 * Behaviour: native-and-sidecar-map.md A5 and D1 (the UI writes `terminal-shell-integration/zsh`
 * and starts interactive terminals with `ZDOTDIR` pointing there). `installShellIntegration` in
 * terminals.ts writes the files into this folder.
 * Test first: zshIntegrationDir is "terminal-shell-integration/zsh" under the app data folder.
 */
import { type AppPaths, appDataPath } from "../app-paths.ts";

/** Folder with the zsh files that make a terminal report its running program. */
export const zshIntegrationDir = (paths: AppPaths): string =>
	appDataPath(paths, "terminal-shell-integration", "zsh");
