/**
 * @feature AGENT-18 Bundled skill that teaches agents the app
 * Owns: passing the app's bundled skill folder to Claude, so Claude knows the app's settings
 * files, scripts and environment variables.
 * Behaviour: claude-runner.md 1.2 (`plugins` option, a local plugin that becomes `--plugin-dir`)
 * and 5.6 (the skill teaches the product), native-and-sidecar-map.md A6 steps 6 and C (the
 * folder is `conductor-skill/` with `.claude-plugin/plugin.json` and `skills/conductor/SKILL.md`).
 * Ours is a separate folder with our own text (D002). The Rust launcher sets
 * `CONDUCTED_SKILL_PLUGIN_DIR` (`sidecar::skill_plugin_dir`).
 * Must handle: the variable missing (no plugin, no error: a dev run has no bundle); a folder that
 * does not exist (an error value that names it; the Claude session starts without the plugin and
 * tells the user once per chat); a relative path (refused: the path must be absolute; config.ts
 * refuses one at startup too, and this function checks the value it is given whoever calls it); the
 * skill text only names `CONDUCTED_*` variables (D027).
 * Our design choice: `config.ts` (SIDE-01) reads the variable (`SIDECAR_ENV.skillPluginDir`, the one
 * home of its name), and the value comes in as a parameter, so this file never reads `process.env`.
 * Test first: with a folder path, the result holds one local plugin with that path; with no
 * folder, it holds none.
 */
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { appError, err, ok, type Result } from "@conducted/shared";

/** The `plugins` option for `buildClaudeOptions`. Undefined when there is no bundled skill. */
export function bundledSkillPlugins(
	skillPluginDir: string | undefined,
	exists: (path: string) => boolean,
): Result<Options["plugins"] | undefined> {
	if (skillPluginDir === undefined || skillPluginDir === "") return ok(undefined);
	if (!skillPluginDir.startsWith("/")) {
		return err(
			appError(
				"skill_plugin_path_relative",
				`The bundled skill folder ${skillPluginDir} must be an absolute path.`,
			),
		);
	}
	if (!exists(skillPluginDir)) {
		return err(
			appError("skill_plugin_missing", `The bundled skill folder ${skillPluginDir} was not found.`),
		);
	}
	return ok([{ type: "local", path: skillPluginDir }]);
}
