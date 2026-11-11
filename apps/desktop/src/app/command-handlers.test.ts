/**
 * @feature NAV-07 Every command has a handler
 * Owns: the check that a registered command the root dispatcher can run has a screen handler or a
 * core handler, so none of them can answer "not available yet" (issues #478, #479, #492).
 * Behaviour: ui-map.md 5.1 and 5.4 (the palette and the shortcuts run the registry's commands),
 * structure-map.md 3.2 (one registry, one table of handlers).
 * Our design choice: the screen handlers are read from the source as `useCommandHandler("id")`
 * calls, because a screen registers while it is mounted and no single render mounts every screen.
 * A registration built from a variable at run time would look missing here and fail the check,
 * which is the safe direction. The core table is built by calling `createCommandHandlers` with its
 * ports passed.
 * Commands whose keys a screen reads itself are out: the composer and the chat cards match their
 * own keys against the registry (COMP-01, CHAT-*), a menu owns single letters, a dialog passes on
 * with no error, and xterm applies the terminal's own keys (`TERMINAL_OWNED_COMMAND_IDS`).
 * Test first: a command id added to the registry with no handler fails the check.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { COMMANDS, type CommandScope } from "../core/registries/commands.ts";
import { type CommandServices, createCommandHandlers } from "../core/services/command-runner.ts";
import { TERMINAL_OWNED_COMMAND_IDS } from "../features/terminal/terminal-keys.ts";
import { keyBindings } from "./command-dispatcher.ts";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, "..");

/**
 * Scopes whose keys a screen reads itself, so the root dispatcher never falls through to the
 * command runner for them: the composer and the chat cards, a menu's single letters, and dialogs
 * (which pass an unhandled command on without an error).
 */
const SCREEN_OWNED_SCOPES: ReadonlySet<CommandScope> = new Set([
	"chat-input",
	"chat-card",
	"chat-question",
	"chat-queue",
	"chat-queue-edit",
	"chat-goal",
	"menu",
	"dialog",
]);

/** Every command id a screen registers with `useCommandHandler("id", ...)`. */
function screenHandlerIds(): Set<string> {
	const ids = new Set<string>();
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) {
				if (name !== "test" && name !== "registries" && name !== "conductor-import") walk(path);
				continue;
			}
			if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
			const text = readFileSync(path, "utf8");
			for (const match of text.matchAll(/useCommandHandler\(\s*"([^"]+)"/g)) {
				if (match[1] !== undefined) ids.add(match[1]);
			}
		}
	};
	walk(srcRoot);
	return ids;
}

/** The ids `createCommandHandlers` serves, with both optional ports wired as the container wires them. */
function coreHandlerIds(): Set<string> {
	const services = {
		repo: { addLocal: async () => ok(undefined) },
		updates: { check: async () => ok(undefined) },
		system: {
			openSidecarLogs: async () => ok(undefined),
			openAppLogs: async () => ok(undefined),
			copyText: async () => ok(undefined),
		},
	} as unknown as CommandServices;
	const handlers = createCommandHandlers(services, {
		pickFolder: async () => null,
		toggleInspector: async () => {},
	});
	return new Set(Object.keys(handlers));
}

const screen = screenHandlerIds();
const core = coreHandlerIds();
const terminalOwned = new Set(TERMINAL_OWNED_COMMAND_IDS);

describe("NAV-07 every dispatchable command has a handler", () => {
	it("finds the handlers registered by screens and by the core table", () => {
		expect(screen.has("workspace.switch2")).toBe(true);
		expect(core.has("app.checkForUpdates")).toBe(true);
		expect(screen.has("nope.nothing")).toBe(false);
	});

	it("has a screen or core handler for every command the dispatcher can run", () => {
		const missing = COMMANDS.filter(
			(command) =>
				!SCREEN_OWNED_SCOPES.has(command.scope) &&
				!screen.has(command.id) &&
				!core.has(command.id) &&
				!terminalOwned.has(command.id),
		).map((command) => command.id);
		expect(missing).toEqual([]);
	});

	it("leaves the terminal's own keys out of the dispatcher", () => {
		expect(TERMINAL_OWNED_COMMAND_IDS.length).toBeGreaterThan(0);
		const bound = new Set<string>(keyBindings().map((binding) => binding.commandId));
		for (const id of TERMINAL_OWNED_COMMAND_IDS) {
			expect(COMMANDS.some((command) => command.id === id)).toBe(true);
			expect(bound.has(id)).toBe(false);
		}
	});
});
