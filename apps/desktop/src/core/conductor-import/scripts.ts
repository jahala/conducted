/**
 * @feature APP-17 Repository scripts from Conductor, with CONDUCTED_ names
 * Owns: `RepoScripts`, the script settings and run actions of one Conductor settings file;
 * `scriptsOf`, which picks them out of a parsed file; `renameConductorNames`, which renames every
 * `CONDUCTOR_` variable in them to `CONDUCTED_` and lists each rename; `scriptFileCandidates`, the
 * repository files the scripts name; and `conductorNameLines`, the lines of such a file that read
 * a `CONDUCTOR_` name.
 * Behaviour: docs/plans/migrate-from-conductor.md, "Scripts and CONDUCTOR_* names" (D027: only
 * CONDUCTED_* names, no alias, so the rename happens once, on import); services-map.md 4.2.4 (the
 * `scripts` table of settings.toml and its named actions) and 4.2.5 (repo columns before
 * Conductor's file migration).
 * Must handle: a script string and an action's command, arguments and folder are all renamed; a
 * name is renamed whole (`CONDUCTOR_PORT_X` stays one name); a rename to a name Conducted does
 * not set is marked, so the dry run can say so; a script file outside the repository, with `..`
 * or an absolute path, is never named.
 * Test first: echo $CONDUCTOR_PORT becomes echo $CONDUCTED_PORT with one rename listed.
 */
import type { SettingValue } from "../registries/settings.ts";
import {
	RESERVED_ENV_VAR_NAMES,
	type SettingAction,
	type SettingsFileContents,
} from "../services/settings.ts";

/** The script settings of the `[scripts]` table, by our key (the same as Conductor's). */
export const SCRIPT_KEYS = [
	"setup_script",
	"run_script",
	"archive_script",
	"run_script_mode",
	"auto_run_after_setup",
] as const;
export type ScriptKey = (typeof SCRIPT_KEYS)[number];

export interface RepoScripts {
	values: Partial<Record<ScriptKey, SettingValue>>;
	actions: SettingAction[];
}

export interface NameRename {
	from: string;
	to: string;
	/** False when Conducted sets no variable of the new name, so the script would read nothing. */
	setByConducted: boolean;
}

export const EMPTY_SCRIPTS: RepoScripts = { values: {}, actions: [] };

export const hasScripts = (scripts: RepoScripts): boolean =>
	Object.keys(scripts.values).length > 0 || scripts.actions.length > 0;

/** The script settings and run actions of one parsed settings file. */
export function scriptsOf(contents: SettingsFileContents): RepoScripts {
	const values: RepoScripts["values"] = {};
	for (const key of SCRIPT_KEYS) {
		const value = contents.values[key];
		if (value !== undefined) values[key] = value;
	}
	return { values, actions: Object.values(contents.actions) };
}

const CONDUCTOR_NAME = /\bCONDUCTOR_([A-Z0-9_]+)\b/g;

/** Renames every CONDUCTOR_ name in `text`, adding each distinct rename to `seen`. */
function renameIn(text: string, seen: Map<string, NameRename>): string {
	return text.replace(CONDUCTOR_NAME, (from: string, rest: string) => {
		const to = `CONDUCTED_${rest}`;
		if (!seen.has(from)) {
			seen.set(from, { from, to, setByConducted: RESERVED_ENV_VAR_NAMES.includes(to) });
		}
		return to;
	});
}

/** The scripts with every CONDUCTOR_ name renamed, and the renames in the order first met. */
export function renameConductorNames(scripts: RepoScripts): {
	scripts: RepoScripts;
	renames: NameRename[];
} {
	const seen = new Map<string, NameRename>();
	const values: RepoScripts["values"] = {};
	for (const [key, value] of Object.entries(scripts.values) as [ScriptKey, SettingValue][]) {
		values[key] = typeof value === "string" ? renameIn(value, seen) : value;
	}
	const actions = scripts.actions.map((action) => ({
		...action,
		command: renameIn(action.command, seen),
		...(action.args === undefined ? {} : { args: action.args.map((arg) => renameIn(arg, seen)) }),
		...(typeof action.cwd === "string" ? { cwd: renameIn(action.cwd, seen) } : {}),
	}));
	return { scripts: { values, actions }, renames: [...seen.values()] };
}

/** A word in a command that names a file inside the repository: `./x`, `dir/x` or `x.sh`. */
const FILE_WORD = /^(?:\.\/)?(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/;

/** The repository files the scripts name, relative to the repository's folder, each once. */
export function scriptFileCandidates(scripts: RepoScripts): string[] {
	const words: string[] = [];
	const add = (text: string): void => {
		for (const raw of text.split(/[\s;&|()<>]+/)) {
			const word = raw.replace(/^["']|["']$/g, "");
			if (word === "" || word.startsWith("-") || word.includes("$")) continue;
			if (!FILE_WORD.test(word) || word.split("/").includes("..")) continue;
			if (!word.includes("/") && !/\.(sh|bash|zsh|command)$/.test(word)) continue;
			words.push(word.replace(/^\.\//, ""));
		}
	};
	for (const value of Object.values(scripts.values)) {
		if (typeof value === "string") add(value);
	}
	for (const action of scripts.actions) {
		add(action.command);
		for (const arg of action.args ?? []) add(arg);
	}
	return [...new Set(words)];
}

/** Each line of a script file that reads a CONDUCTOR_ name, with the name to use instead. */
export function conductorNameLines(
	text: string,
): { line: number; name: string; newName: string }[] {
	const found: { line: number; name: string; newName: string }[] = [];
	text.split("\n").forEach((content, index) => {
		const seen = new Set<string>();
		for (const match of content.matchAll(CONDUCTOR_NAME)) {
			const name = match[0];
			if (seen.has(name)) continue;
			seen.add(name);
			found.push({ line: index + 1, name, newName: `CONDUCTED_${match[1] ?? ""}` });
		}
	});
	return found;
}
