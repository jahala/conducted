import type { SlashCommand } from "@conducted/protocol";
import { fireEvent } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { composerBaseKit } from "../composer-extensions.ts";
import {
	builtinSlashCommands,
	createSlashCommands,
	isTerminalEffectCommand,
	mergeSlashCommands,
	slashCommandAction,
	slashCommandEntries,
	slashCommandProblem,
	slashCommandRows,
	terminalCommandLine,
} from "./SlashCommandExtension.ts";

const command = (over: Partial<SlashCommand> = {}): SlashCommand => ({
	name: "review",
	description: "Review the changes",
	source: "project",
	kind: "command",
	...over,
});

const labels = (rows: readonly { label: string }[]): string[] => rows.map((row) => row.label);

describe("COMP-06 slash command list", () => {
	it("lists /compact for Claude but not for an agent that lacks it", () => {
		const claude = labels(slashCommandRows([], "claude", "co"));
		const cursor = labels(slashCommandRows([], "cursor", "co"));

		expect(claude).toContain("/compact");
		expect(cursor).not.toContain("/compact");
	});

	it("adds only the built-ins the agent offers", () => {
		const claude = builtinSlashCommands("claude").map((entry) => entry.name);
		const codex = builtinSlashCommands("codex").map((entry) => entry.name);
		const cursor = builtinSlashCommands("cursor").map((entry) => entry.name);

		expect(claude).toContain("ultracode");
		expect(claude).toContain("hooks");
		expect(codex).toContain("personality");
		expect(codex).not.toContain("ultracode");
		expect(cursor).not.toContain("mcp-status");
		expect(cursor).toContain("fast");
	});

	it("groups the agent's commands as built-in, project and skills", () => {
		const entries = slashCommandEntries(
			[
				command({ name: "review", source: "project" }),
				command({ name: "skill-creator", source: "user", kind: "skill" }),
			],
			"claude",
			"",
		);

		const groups = new Set(entries.map((entry) => entry.group));
		expect(groups).toEqual(new Set(["Built-in", "Project", "Skills"]));
		const project = entries.find((entry) => entry.command.name === "review");
		const skill = entries.find((entry) => entry.command.name === "skill-creator");
		expect(project?.group).toBe("Project");
		expect(skill?.group).toBe("Skills");
	});

	it("keeps the sidecar's description and argument hint when it names a built-in", () => {
		const merged = mergeSlashCommands(
			[
				command({
					name: "compact",
					description: "Compact this chat",
					source: "builtin",
					argumentHint: "[instructions]",
				}),
			],
			"claude",
		);
		const compact = merged.filter((entry) => entry.name === "compact");

		expect(compact).toHaveLength(1);
		expect(compact[0]?.description).toBe("Compact this chat");

		const rows = slashCommandRows(
			[command({ name: "compact", source: "builtin", argumentHint: "[instructions]" })],
			"claude",
			"com",
		);
		expect(rows[0]?.detail).toContain("[instructions]");
	});

	it("filters by the typed prefix and ignores case", () => {
		const rows = slashCommandRows([command({ name: "Review" })], "claude", "RE");

		expect(labels(rows)).toContain("/Review");
	});

	it("marks the commands that run in the embedded terminal", () => {
		expect(isTerminalEffectCommand(command({ name: "mcp", source: "builtin" }))).toBe(true);
		expect(isTerminalEffectCommand(command({ name: "restart", source: "builtin" }))).toBe(false);
	});
});

describe("COMP-06 unavailable slash commands", () => {
	it("names an unoffered command", () => {
		expect(slashCommandProblem("not-a-command", "claude")).toBe(
			"This command isn't available in this workspace.",
		);
	});

	it("explains that plan mode is missing instead of the generic message", () => {
		expect(slashCommandProblem("plan", "cursor")).toBe("Plan mode is not available in this chat.");
	});

	it("has no problem for an empty query or a command the agent offers", () => {
		expect(slashCommandProblem("", "claude")).toBeNull();
		expect(slashCommandProblem("plan", "claude")).toBeNull();
	});
});

describe("COMP-06 slash command extension", () => {
	it("builds the extension the composer loads", () => {
		const extension = createSlashCommands({ commands: [], onRun: () => {} });

		expect(extension.name).toBe("slashCommands");
	});

	const editors: Editor[] = [];
	afterEach(() => {
		for (const editor of editors.splice(0)) editor.destroy();
	});

	const mount = (commands: SlashCommand[], onRun: (command: SlashCommand) => void) => {
		const editor = new Editor({
			extensions: [composerBaseKit, createSlashCommands({ commands, onRun, agent: "claude" })],
			content: "",
		});
		editors.push(editor);
		editor.commands.focus();
		return editor;
	};

	it("writes '/name ' for a command with an argument hint and waits for the arguments", () => {
		const onRun = vi.fn();
		const editor = mount(
			[command({ name: "review", argumentHint: "[focus]", source: "project" })],
			onRun,
		);
		editor.commands.insertContent("/rev");
		fireEvent.keyDown(editor.view.dom, { key: "Enter" });

		expect(onRun).not.toHaveBeenCalled();
		expect(editor.getText()).toBe("/review ");
		editor.commands.insertContent("the parser");
		expect(editor.getText()).toBe("/review the parser");
	});

	it("runs a command with no argument hint at once and clears what was typed", () => {
		const onRun = vi.fn();
		const editor = mount([], onRun);
		editor.commands.insertContent("/resta");
		fireEvent.keyDown(editor.view.dom, { key: "Enter" });

		expect(onRun).toHaveBeenCalledTimes(1);
		expect(onRun.mock.calls[0]?.[0]?.name).toBe("restart");
		expect(editor.getText()).toBe("");
	});
});

describe("COMP-06 what a chosen command does", () => {
	const builtin = (name: string): SlashCommand => command({ name, source: "builtin" });

	it("acts on the app for /clear, /restart, /plan, /fast and the terminal commands", () => {
		expect(slashCommandAction(builtin("clear"), [], "claude")).toEqual({ kind: "clear" });
		expect(slashCommandAction(builtin("restart"), [], "codex")).toEqual({ kind: "restart" });
		expect(slashCommandAction(builtin("plan"), [], "claude")).toEqual({
			kind: "screen",
			commandId: "chat.togglePlanMode",
		});
		expect(slashCommandAction(builtin("fast"), [], "cursor")).toEqual({
			kind: "screen",
			commandId: "chat.toggleFastMode",
		});
		expect(slashCommandAction(builtin("hooks"), [], "claude")).toEqual({ kind: "terminal" });
	});

	it("says plan mode is missing for an agent without it", () => {
		expect(slashCommandAction(builtin("plan"), [], "cursor")).toEqual({
			kind: "unavailable",
			message: "Plan mode is not available in this chat.",
		});
	});

	it("sends a command the agent lists, and refuses a built-in it neither lists nor the app runs", () => {
		const compact = builtin("compact");
		expect(slashCommandAction(compact, [compact], "claude")).toEqual({
			kind: "send",
			text: "/compact",
		});
		expect(
			slashCommandAction(command({ name: "review" }), [command({ name: "review" })], "claude"),
		).toEqual({
			kind: "send",
			text: "/review",
		});
		expect(slashCommandAction(compact, [], "claude")).toEqual({
			kind: "unavailable",
			message: "This command isn't available in this workspace.",
		});
	});

	it("types the agent's program and the command into the terminal, then exits", () => {
		expect(terminalCommandLine("claude", builtin("mcp"))).toBe("claude /mcp; exit");
		expect(terminalCommandLine("codex", builtin("mcp"))).toBe("codex /mcp; exit");
		expect(terminalCommandLine("cursor", builtin("mcp"))).toBeNull();
	});
});
