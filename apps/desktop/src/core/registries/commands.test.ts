import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	COMMAND_CATEGORIES,
	COMMANDS,
	type CommandDef,
	commandsByCategory,
	findShortcutConflicts,
	formatShortcut,
	getCommand,
	parseShortcut,
	toCommandEntries,
} from "./commands.ts";

const here = dirname(fileURLToPath(import.meta.url));
const backlog = readFileSync(resolve(here, "../../../../../docs/plans/backlog.md"), "utf8");
const backlogIds = new Set(backlog.match(/^\| [A-Z]+-\d+/gm)?.map((row) => row.slice(2)) ?? []);

describe("command table", () => {
	it("has unique ids", () => {
		const ids = COMMANDS.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("reads at least the feature ids from the backlog file", () => {
		expect(backlogIds.has("NAV-07")).toBe(true);
	});

	it("points every command at a feature that exists in the backlog", () => {
		const unknown = COMMANDS.filter((c) => !backlogIds.has(c.feature)).map((c) => c.id);
		expect(unknown).toEqual([]);
	});

	it("uses every category and only the known ones", () => {
		const used = new Set(COMMANDS.map((c) => c.category));
		expect([...used].sort()).toEqual([...COMMAND_CATEGORIES].sort());
	});

	it("has shortcuts that all parse", () => {
		const bad = COMMANDS.flatMap((c) =>
			c.defaultShortcuts.filter((s) => !parseShortcut(s).ok).map((s) => `${c.id}: ${s}`),
		);
		expect(bad).toEqual([]);
	});

	it("has no two commands sharing a shortcut inside one scope", () => {
		expect(findShortcutConflicts()).toEqual([]);
	});

	it("keeps palette-only commands unbound and the unrebindable ones fixed", () => {
		expect(getCommand("app.toggleTheme")?.defaultShortcuts).toEqual(["Cmd+Alt+T"]);
		expect(getCommand("app.checkForUpdates")?.defaultShortcuts).toEqual([]);
		for (const id of ["app.openSettings", "app.quit", "app.sendFeedback", "app.openDebugTools"]) {
			expect(getCommand(id)?.configurable).toBe(false);
		}
	});

	it("stores the default send-key mode", () => {
		expect(getCommand("chat.submit")?.defaultShortcuts).toEqual(["Enter"]);
		expect(getCommand("chat.newLine")?.defaultShortcuts).toEqual(["Shift+Enter"]);
		expect(getCommand("chat.submitOpposite")?.defaultShortcuts).toEqual(["Cmd+Enter"]);
	});
});

describe("getCommand and commandsByCategory", () => {
	it("returns undefined for an unknown id", () => {
		expect(getCommand("no.such.command")).toBeUndefined();
	});

	it("finds a known command", () => {
		expect(getCommand("workspace.create")?.title).toBe("Create a workspace");
	});

	it("groups every command exactly once", () => {
		const groups = commandsByCategory();
		const total = COMMAND_CATEGORIES.reduce((n, cat) => n + groups[cat].length, 0);
		expect(total).toBe(COMMANDS.length);
		expect(groups.Terminal.every((c) => c.category === "Terminal")).toBe(true);
		expect(Object.keys(groups)).toEqual([...COMMAND_CATEGORIES]);
	});
});

describe("parseShortcut and formatShortcut", () => {
	const cases: [string, string][] = [
		["Cmd+Shift+P", "⌘⇧P"],
		["Cmd+Alt+/", "⌥⌘/"],
		["Ctrl+Tab", "⌃⇥"],
		["Cmd+Shift+Backspace", "⌘⇧⌫"],
		["Cmd+Alt+ArrowUp", "⌥⌘↑"],
		["Enter", "↵"],
		["Cmd+Plus", "⌘+"],
	];
	it.each(cases)("formats %s as %s", (spec, display) => {
		expect(formatShortcut(spec)).toBe(display);
	});

	it("parses modifiers and normalises the key", () => {
		expect(parseShortcut("Cmd+Shift+p")).toEqual({
			ok: true,
			value: { ctrl: false, alt: false, shift: true, cmd: true, key: "P" },
		});
		expect(parseShortcut("Ctrl+Alt+Escape")).toEqual({
			ok: true,
			value: { ctrl: true, alt: true, shift: false, cmd: false, key: "Escape" },
		});
	});

	it("rejects unknown modifiers, unknown keys, repeats and empty text", () => {
		for (const bad of ["Meta+K", "Cmd+Banana", "Cmd+Cmd+K", "", "Cmd+", "Cmd++", "K+Cmd"]) {
			const result = parseShortcut(bad);
			expect(result.ok, bad).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("shortcut_invalid");
			}
		}
	});

	it("returns bad text unchanged when formatting", () => {
		expect(formatShortcut("Cmd+Banana")).toBe("Cmd+Banana");
	});

	it("round trips five specs through parse, rebuild and format", () => {
		for (const spec of [
			"Cmd+Shift+P",
			"Cmd+Alt+/",
			"Ctrl+Tab",
			"Alt+ArrowLeft",
			"Cmd+Shift+Backspace",
		]) {
			const parsed = parseShortcut(spec);
			if (!parsed.ok) {
				throw new Error(`${spec} should parse`);
			}
			const { cmd, ctrl, alt, shift, key } = parsed.value;
			const rebuilt = [cmd && "Cmd", ctrl && "Ctrl", alt && "Alt", shift && "Shift", key]
				.filter(Boolean)
				.join("+");
			expect(parseShortcut(rebuilt)).toEqual(parsed);
			expect(formatShortcut(rebuilt)).toBe(formatShortcut(spec));
		}
	});

	it("gives every shipped shortcut a display form that differs from its text", () => {
		for (const command of COMMANDS) {
			for (const spec of command.defaultShortcuts) {
				const display = formatShortcut(spec);
				expect(display, `${command.id} ${spec}`).not.toBe("");
				if (spec.includes("+")) {
					expect(display, `${command.id} ${spec}`).not.toBe(spec);
				}
			}
		}
	});
});

describe("findShortcutConflicts", () => {
	const make = (id: string, scope: CommandDef["scope"], shortcuts: string[]): CommandDef => ({
		id,
		title: id,
		category: "General",
		defaultShortcuts: shortcuts,
		configurable: true,
		scope,
		feature: "NAV-07",
	});

	it("reports a pair that shares keys in one scope, whatever the modifier order", () => {
		const found = findShortcutConflicts([
			make("a", "global", ["Cmd+Shift+K"]),
			make("b", "global", ["Shift+Cmd+K"]),
		]);
		expect(found).toEqual([{ ids: ["a", "b"], scope: "global", shortcut: "⌘⇧K" }]);
	});

	it("allows the same keys in different scopes", () => {
		expect(
			findShortcutConflicts([make("a", "global", ["Cmd+F"]), make("b", "terminal", ["Cmd+F"])]),
		).toEqual([]);
	});
});

describe("toCommandEntries", () => {
	it("maps the display shortcut, the null shortcut and the enabled flag", () => {
		const entries = toCommandEntries((id) => id !== "workspace.create");
		expect(entries).toHaveLength(COMMANDS.length);
		const create = entries.find((e) => e.id === "workspace.create");
		expect(create).toEqual({
			id: "workspace.create",
			title: "Create a workspace",
			category: "Workspace",
			shortcut: "⌘N",
			defaultShortcut: "⌘N",
			enabled: false,
		});
		const updates = entries.find((e) => e.id === "app.checkForUpdates");
		expect(updates?.shortcut).toBeNull();
		expect(updates?.defaultShortcut).toBeNull();
		expect(updates?.enabled).toBe(true);
	});

	it("shows the first shortcut when a command has several", () => {
		const entry = toCommandEntries(() => true).find((e) => e.id === "tab.next");
		expect(entry?.shortcut).toBe("⌃⇥");
	});
});
