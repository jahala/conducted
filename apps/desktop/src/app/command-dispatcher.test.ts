/**
 * @feature NAV-14 Shortcut and menu dispatcher
 * Owns: tests for the pure lookup, send-key swap, scope mapping, handler priority and menu accelerators.
 * Behaviour: ui-map.md 5.4, 8; structure-map.md 3.2.
 * Test first: with a base and a modal handler registered for "palette.open", only the modal one runs.
 */

import { appError, err, type Result } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { effectiveShortcuts, getCommand } from "../core/registries/commands.ts";
import {
	commandForDeepLink,
	commandForKeyPress,
	createCommandRegistry,
	dispatchCommand,
	type KeyBinding,
	type KeyPress,
	keyBindings,
	menuShortcuts,
	scopesForTarget,
} from "./command-dispatcher.ts";

const press = (overrides: Partial<KeyPress> = {}): KeyPress => ({
	key: "K",
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	isComposing: false,
	repeat: false,
	...overrides,
});

const bindings: readonly KeyBinding[] = [
	{ commandId: "chat.submit", scope: "chat-input", shortcut: "Enter" },
	{ commandId: "dialog.confirm", scope: "dialog", shortcut: "Enter" },
	{ commandId: "app.commandPalette", scope: "global", shortcut: "Cmd+K" },
];

describe("NAV-14 commandForKeyPress", () => {
	it("finds a command in the most specific active scope", () => {
		expect(commandForKeyPress(press({ key: "Enter" }), ["dialog", "global"], bindings)).toBe(
			"dialog.confirm",
		);
		expect(commandForKeyPress(press({ key: "Enter" }), ["chat-input", "global"], bindings)).toBe(
			"chat.submit",
		);
	});

	it("keeps a plain key for the browser when the scope has no binding", () => {
		expect(commandForKeyPress(press({ key: "Enter" }), ["global"], bindings)).toBeNull();
		expect(commandForKeyPress(press({ key: "K" }), ["global"], bindings)).toBeNull();
	});

	it("matches a global Cmd shortcut from inside a text field", () => {
		expect(
			commandForKeyPress(press({ key: "k", metaKey: true }), ["chat-input", "global"], bindings),
		).toBe("app.commandPalette");
	});

	it("ignores a key press during IME composition or key repeat", () => {
		expect(
			commandForKeyPress(
				press({ key: "k", metaKey: true, isComposing: true }),
				["global"],
				bindings,
			),
		).toBeNull();
		expect(
			commandForKeyPress(press({ key: "k", metaKey: true, repeat: true }), ["global"], bindings),
		).toBeNull();
	});

	it("matches shifted punctuation and the plus key", () => {
		const extra: readonly KeyBinding[] = [
			{ commandId: "tab.next", scope: "global", shortcut: "Cmd+Shift+[" },
			{ commandId: "view.zoomIn", scope: "global", shortcut: "Cmd+Plus" },
		];
		expect(
			commandForKeyPress(press({ key: "{", metaKey: true, shiftKey: true }), ["global"], extra),
		).toBe("tab.next");
		expect(
			commandForKeyPress(press({ key: "+", metaKey: true, shiftKey: true }), ["global"], extra),
		).toBe("view.zoomIn");
	});

	it("takes a key that a user rebound to another command", () => {
		const rebound = keyBindings({ "app.commandPalette": ["Cmd+J"] });
		expect(commandForKeyPress(press({ key: "j", metaKey: true }), ["global"], rebound)).toBe(
			"app.commandPalette",
		);
		expect(commandForKeyPress(press({ key: "k", metaKey: true }), ["global"], rebound)).toBeNull();
	});
});

describe("NAV-14 send-key swap", () => {
	const live = keyBindings();

	it("sends with Enter and adds a line with Shift+Enter in the default mode", () => {
		expect(commandForKeyPress(press({ key: "Enter" }), ["chat-input"], live)).toBe("chat.submit");
		expect(commandForKeyPress(press({ key: "Enter", shiftKey: true }), ["chat-input"], live)).toBe(
			"chat.newLine",
		);
	});

	it("adds a line with Enter and sends with Cmd+Enter in Cmd+Enter mode", () => {
		expect(commandForKeyPress(press({ key: "Enter" }), ["chat-input"], live, "mod_enter")).toBe(
			"chat.newLine",
		);
		expect(
			commandForKeyPress(press({ key: "Enter", metaKey: true }), ["chat-input"], live, "mod_enter"),
		).toBe("chat.submit");
		expect(
			commandForKeyPress(press({ key: "Enter", altKey: true }), ["chat-input"], live, "mod_enter"),
		).toBe("chat.submitOpposite");
	});

	it("does not swap a command the user rebound", () => {
		const rebound = keyBindings({ "chat.submit": ["Cmd+J"] });
		expect(
			commandForKeyPress(press({ key: "j", metaKey: true }), ["chat-input"], rebound, "mod_enter"),
		).toBe("chat.submit");
	});
});

describe("NAV-14 handler priority", () => {
	it("runs only the modal handler, then the base one after the modal unmounts", () => {
		const registry = createCommandRegistry();
		const calls: string[] = [];
		const offBase = registry.register("palette.open", "base", () => {
			calls.push("base");
			return true;
		});
		const offModal = registry.register("palette.open", "modal", () => {
			calls.push("modal");
			return true;
		});

		expect(registry.run("palette.open")).toBe(true);
		expect(calls).toEqual(["modal"]);

		offModal();
		expect(registry.run("palette.open")).toBe(true);
		expect(calls).toEqual(["modal", "base"]);

		offBase();
		expect(registry.run("palette.open")).toBe(false);
	});

	it("passes the command down while a handler returns false", () => {
		const registry = createCommandRegistry();
		const calls: string[] = [];
		registry.register("app.commandPalette", "area", () => {
			calls.push("area");
			return false;
		});
		registry.register("app.commandPalette", "base", () => {
			calls.push("base");
			return true;
		});

		expect(registry.run("app.commandPalette")).toBe(true);
		expect(calls).toEqual(["area", "base"]);
	});
});

describe("NAV-14 dispatchCommand", () => {
	const deps = (
		registry = createCommandRegistry(),
		run = vi.fn(),
		report = vi.fn(),
		failed = vi.fn(),
	) => ({
		registry,
		isEnabled: () => true,
		run: run as (commandId: string) => Promise<Result<void>>,
		report,
		failed,
	});

	it("falls back to the service runner when no focused handler takes the command", () => {
		const run = vi.fn().mockResolvedValue({ ok: true, value: undefined });
		dispatchCommand("app.commandPalette", deps(createCommandRegistry(), run));
		expect(run).toHaveBeenCalledWith("app.commandPalette");
	});

	it("runs a focused handler instead of the service runner", () => {
		const registry = createCommandRegistry();
		const run = vi.fn().mockResolvedValue({ ok: true, value: undefined });
		registry.register("app.commandPalette", "base", () => true);
		dispatchCommand("app.commandPalette", deps(registry, run));
		expect(run).not.toHaveBeenCalled();
	});

	it("does not run a disabled command", () => {
		const registry = createCommandRegistry();
		const run = vi.fn().mockResolvedValue({ ok: true, value: undefined });
		const report = vi.fn();
		dispatchCommand("workspace.archive", {
			...deps(registry, run, report),
			isEnabled: () => false,
		});
		expect(run).not.toHaveBeenCalled();
		expect(report).not.toHaveBeenCalled();
	});

	it("hands a failed run to the user-facing reporter, not only the log", async () => {
		const failure = appError("archive_failed", "The workspace is busy");
		const run = vi.fn().mockResolvedValue(err(failure));
		const report = vi.fn();
		const failed = vi.fn();
		dispatchCommand("workspace.archive", deps(createCommandRegistry(), run, report, failed));
		await vi.waitFor(() => expect(failed).toHaveBeenCalledWith("workspace.archive", failure));
		expect(report).not.toHaveBeenCalled();
	});

	it("reports an unknown id instead of throwing", () => {
		const run = vi.fn().mockResolvedValue({ ok: true, value: undefined });
		const report = vi.fn();
		expect(() =>
			dispatchCommand("no.such.command", deps(createCommandRegistry(), run, report)),
		).not.toThrow();
		expect(run).not.toHaveBeenCalled();
		expect(report).toHaveBeenCalledWith("No command named no.such.command.");
	});
});

describe("NAV-14 menuShortcuts", () => {
	it("writes the live first binding in Tauri's syntax", () => {
		const shortcuts = menuShortcuts();
		expect(
			shortcuts.find((shortcut) => shortcut.commandId === "view.toggleLeftSidebar")?.accelerator,
		).toBe("CmdOrCtrl+B");
		expect(
			shortcuts.find((shortcut) => shortcut.commandId === "view.toggleRightSidebar")?.accelerator,
		).toBe("CmdOrCtrl+Alt+B");
		expect(shortcuts.find((shortcut) => shortcut.commandId === "app.quit")?.accelerator).toBe(
			"CmdOrCtrl+Q",
		);
	});

	it("follows a rebind", () => {
		const shortcuts = menuShortcuts({ "view.toggleLeftSidebar": ["Cmd+Shift+B"] });
		expect(
			shortcuts.find((shortcut) => shortcut.commandId === "view.toggleLeftSidebar")?.accelerator,
		).toBe("CmdOrCtrl+Shift+B");
	});

	it("clears the accelerator of an unbound command", () => {
		const shortcuts = menuShortcuts({ "view.toggleLeftSidebar": [] });
		expect(
			shortcuts.find((shortcut) => shortcut.commandId === "view.toggleLeftSidebar")?.accelerator,
		).toBeNull();
	});

	it("uses the send-key swap for a chat command", () => {
		const shortcuts = menuShortcuts({}, "mod_enter");
		expect(shortcuts.find((shortcut) => shortcut.commandId === "chat.submit")?.accelerator).toBe(
			"CmdOrCtrl+Enter",
		);
		expect(
			shortcuts.find((shortcut) => shortcut.commandId === "chat.submitOpposite")?.accelerator,
		).toBe("Alt+Enter");
		expect(shortcuts.find((shortcut) => shortcut.commandId === "chat.newLine")?.accelerator).toBe(
			"Enter",
		);
	});
});

describe("NAV-14 scopesForTarget", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("puts a dialog above the text field inside it", () => {
		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		const input = document.createElement("textarea");
		dialog.appendChild(input);
		document.body.appendChild(dialog);

		expect(scopesForTarget(input)).toEqual(["dialog", "chat-input", "global"]);
	});

	it("reads an explicit focus area and the open palette", () => {
		const card = document.createElement("div");
		card.setAttribute("data-command-scope", "chat-card");
		const button = document.createElement("button");
		button.type = "button";
		card.appendChild(button);
		document.body.appendChild(card);

		expect(scopesForTarget(button, "palette")).toEqual(["palette", "chat-card", "global"]);
	});

	it("recognises terminal and diff wrappers", () => {
		const terminal = document.createElement("div");
		terminal.className = "xterm";
		const terminalChild = document.createElement("span");
		terminal.appendChild(terminalChild);
		document.body.appendChild(terminal);

		const diff = document.createElement("div");
		diff.setAttribute("data-diff", "");
		const diffChild = document.createElement("span");
		diff.appendChild(diffChild);
		document.body.appendChild(diff);

		expect(scopesForTarget(terminalChild)).toEqual(["terminal", "global"]);
		expect(scopesForTarget(diffChild)).toEqual(["diff", "global"]);
	});

	it("keeps a text field inside the file viewer or a diff area out of the chat input", () => {
		const viewer = document.createElement("div");
		viewer.setAttribute("data-file-viewer", "");
		const editor = document.createElement("div");
		editor.setAttribute("contenteditable", "true");
		viewer.appendChild(editor);
		document.body.appendChild(viewer);

		const comments = document.createElement("div");
		comments.setAttribute("data-command-scope", "diff");
		const reply = document.createElement("textarea");
		comments.appendChild(reply);
		document.body.appendChild(comments);

		expect(scopesForTarget(editor)).toEqual(["diff", "global"]);
		expect(scopesForTarget(reply)).toEqual(["diff", "global"]);
		expect(
			commandForKeyPress(
				press({ key: "f", metaKey: true }),
				scopesForTarget(editor),
				keyBindings(),
			),
		).toBe("review.findInFile");
	});

	it("returns global when there is no element", () => {
		expect(scopesForTarget(null)).toEqual(["global"]);
	});
});

describe("NAV-14 commandForDeepLink", () => {
	it("opens settings for the settings host", () => {
		expect(commandForDeepLink("conducted://settings")).toBe("app.openSettings");
	});

	it("leaves route links and other schemes to NAV-17", () => {
		expect(commandForDeepLink("conducted://workspace?id=w1")).toBeNull();
		expect(commandForDeepLink("https://example.com")).toBeNull();
		expect(commandForDeepLink("not a url")).toBeNull();
	});
});

describe("NAV-14 bindings agree with the registry", () => {
	it("gives every registry shortcut a binding", () => {
		const live = keyBindings();
		for (const command of ["app.commandPalette", "view.toggleLeftSidebar", "chat.submit"]) {
			const commandDef = getCommand(command);
			if (commandDef === undefined) throw new Error(`${command} is missing`);
			const expected = effectiveShortcuts(commandDef, {});
			const found = live
				.filter((binding) => binding.commandId === command)
				.map((binding) => binding.shortcut);
			expect(found).toEqual(expected);
		}
	});
});
