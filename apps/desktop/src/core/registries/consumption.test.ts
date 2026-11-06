/**
 * @feature SET-01 Settings registry
 * Owns: the check that a setting or command of a finished feature is used by some code outside the
 * registries.
 * Test first: a done feature's setting key or command id that no source file names fails the check.
 * Known gaps are listed below with the feature that must wire them. The check also fails when a
 * listed gap is wired, so the lists only shrink.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands.ts";
import { SETTINGS } from "./settings.ts";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, "../..");
const backlog = readFileSync(resolve(srcRoot, "../../../docs/plans/backlog.md"), "utf8");

/** Backlog status per feature id, read from the table rows. */
const statusOf = (feature: string): string | undefined => {
	const row = backlog.split("\n").find((line) => line.startsWith(`| ${feature} `));
	return row?.split("|")[6]?.trim();
};

/** Source text of every file that could use a key or an id: no tests, no registries. */
function consumerSource(): string {
	const parts: string[] = [];
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) {
				if (name !== "registries" && name !== "test") walk(path);
			} else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
				parts.push(readFileSync(path, "utf8"));
			}
		}
	};
	walk(srcRoot);
	return parts.join("\n");
}

const source = consumerSource();
const isNamed = (text: string): boolean => source.includes(`"${text}"`);

/** Settings of a done feature that no code reads yet. The settings pages (SET-02, SET-06) wire them. */
const KNOWN_UNUSED_SETTINGS: readonly string[] = [
	"big_terminal_custom_commands",
	"default_codex_thinking_level",
	"experimental_auto_permission_mode",
	"experimental_new_workspace_page",
	"internal_workspace_status_matrix",
	"last_clone_directory",
];

/** Commands of a done feature that no handler or caller names yet. */
const KNOWN_UNUSED_COMMANDS: readonly string[] = [
	"app.quit",
	"chat.approveTool",
	"chat.approveToolAlternate",
	"chat.denyTool",
	"chat.question.focusOther",
	"chat.question.next",
	"chat.question.previous",
	"chat.question.selectOption",
	"dialog.confirm",
	"terminal.clear",
	"terminal.close",
	"terminal.deleteLine",
	"terminal.find",
	"terminal.lineEnd",
	"terminal.lineStart",
	"terminal.new",
	"terminal.newline",
	"terminal.wordBack",
	"terminal.wordForward",
	"view.toggleTerminalPanel",
];

describe("registry entries are used", () => {
	it("reads the status of a feature from the backlog", () => {
		expect(statusOf("SET-01")).toBe("done");
		expect(statusOf("PLAT-12")).toBe("stub");
	});

	it("names every setting of a done feature somewhere, except the known gaps", () => {
		const unused = SETTINGS.filter((def) => statusOf(def.feature) === "done" && !isNamed(def.key))
			.map((def) => def.key)
			.sort();
		expect(unused).toEqual(KNOWN_UNUSED_SETTINGS);
	});

	it("names every command of a done feature somewhere, except the known gaps", () => {
		const unused = COMMANDS.filter(
			(command) => statusOf(command.feature) === "done" && !isNamed(command.id),
		)
			.map((command) => command.id)
			.sort();
		expect(unused).toEqual(KNOWN_UNUSED_COMMANDS);
	});
});
