/**
 * @feature NAV-14 Shortcut and menu dispatcher
 * Owns: turning key presses, menu picks and deep links into command ids, and handing each command to the
 * right handler. Two hooks: `useCommandDispatcher` mounts the root listeners once; `useCommandHandler`
 * lets a screen register a handler for one command id with a priority.
 * Behaviour: ui-map.md 5.4 (shortcuts by scope), 8 ("Kn(commandId, handler, opts)" registers a handler with a
 * priority; a hint component reads the live binding so tooltips follow rebinds), 1.1 (root listeners for
 * menu events and deep links); structure-map.md 3.2 (one registry feeds menus, palette and shortcuts).
 * Data: the command table and scopes are in core/registries/commands.ts. The menu event is
 * Platform.menu.onCommand. Commands without a screen handler fall back to `Actions.app.runCommand`
 * (core/services/command-runner.ts), so core keeps one table of service-level handlers.
 * Must handle: the same keys meaning different things in different scopes (chat input, terminal, diff,
 * dialog, palette, menu, chat cards); a key press during IME composition or key repeat (ignored); the
 * send-key swap (Enter versus Cmd+Enter) applied before lookup; the user's rebinds, read live; a focused
 * text field keeping plain letters while a global Cmd shortcut still works; two handlers for one command
 * (the higher priority runs; a handler that returns false passes the command on); a handler that
 * unmounts (its registration is removed); a command that is disabled (the key press does nothing and is
 * not swallowed); a menu pick for an id the registry does not know (reported, not thrown).
 * Our design choice: priorities are three named levels (`base`, `area`, `modal`), not numbers. A terminal
 * or diff area registers at `area`; a dialog registers at `modal`, so it wins while it is open.
 * Our design choice: a focus area marks itself with `data-command-scope="chat-input"` (or several scope
 * names, space separated). Without a mark, editable fields count as `chat-input` and the shared
 * `.xterm` and `[data-diff]` wrappers count as their area. Every lookup ends with `global`.
 * Our design choice: menu accelerators are the live first binding in Tauri's syntax, so a rebind changes
 * the menu bar without a second table. A deep link that names a settings page opens settings; links
 * that open a route stay with NAV-17, and the caller can pass `onDeepLink` to take them.
 * Test first: with a `base` and a `modal` handler registered for "palette.open", the dispatcher runs only
 * the `modal` one; after the modal handler unmounts, the `base` one runs.
 */
import type { Result } from "@conducted/shared";
import { useEffect, useMemo, useRef } from "react";
import { useServices } from "../core/context.tsx";
import { useSetting, useShortcutOverrides } from "../core/hooks.ts";
import {
	COMMANDS,
	type CommandId,
	type CommandScope,
	effectiveShortcuts,
	getCommand,
	parseShortcut,
	type ShortcutOverrides,
} from "../core/registries/commands.ts";
import type { MenuShortcut } from "../platform/platform.ts";
import { useOverlayStore } from "./overlay-store.ts";

export type HandlerPriority = "base" | "area" | "modal";

/** Returns false to pass the command on to the next lower handler. */
export type CommandHandlerFn = () => boolean | undefined;

/** The parts of a keyboard event the lookup needs, so it can be tested without a DOM. */
export interface KeyPress {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	isComposing: boolean;
	repeat: boolean;
}

/** One binding as the registry writes it, for example "Cmd+Shift+P", after the user's rebinds. */
export interface KeyBinding {
	commandId: CommandId;
	scope: CommandScope;
	shortcut: string;
}

/**
 * The send-key setting's two modes. The names match `message_send_key`'s values and the composer's
 * `SendWith`, so nothing has to translate a third time.
 */
export type SendKeyMode = "enter" | "mod_enter";

/** Commands whose keys the send-key setting swaps, and the key each takes in Cmd+Enter mode. */
const SEND_KEY_SWAP: Readonly<Record<string, string>> = {
	"chat.newLine": "Enter",
	"chat.submit": "Cmd+Enter",
	"chat.submitOpposite": "Alt+Enter",
	"chat.question.submit": "Cmd+Enter",
};

const SCOPES: ReadonlySet<string> = new Set([
	"global",
	"chat-input",
	"terminal",
	"diff",
	"palette",
	"dialog",
	"menu",
	"chat-card",
	"chat-question",
	"chat-queue",
	"chat-queue-edit",
	"chat-goal",
]);

const PRIORITY_RANK: Readonly<Record<HandlerPriority, number>> = {
	base: 0,
	area: 1,
	modal: 2,
};

const NAMED_EVENT_KEYS: Readonly<Record<string, string>> = {
	" ": "Space",
	Spacebar: "Space",
	Esc: "Escape",
	Escape: "Escape",
	Enter: "Enter",
	NumpadEnter: "Enter",
	Tab: "Tab",
	Backspace: "Backspace",
	Delete: "Delete",
	ArrowUp: "ArrowUp",
	ArrowDown: "ArrowDown",
	ArrowLeft: "ArrowLeft",
	ArrowRight: "ArrowRight",
	Home: "Home",
	End: "End",
	PageUp: "PageUp",
	PageDown: "PageDown",
};

/** The base key a shifted symbol sits on, so "{" matches the binding written "[" plus Shift. */
const SHIFTED_SYMBOLS: Readonly<Record<string, string>> = {
	"~": "`",
	"!": "1",
	"@": "2",
	"#": "3",
	$: "4",
	"%": "5",
	"^": "6",
	"&": "7",
	"*": "8",
	"(": "9",
	")": "0",
	_: "-",
	"{": "[",
	"}": "]",
	"|": "\\",
	":": ";",
	'"': "'",
	"<": ",",
	">": ".",
	"?": "/",
};

const TEXT_INPUT_TYPES = new Set([
	"button",
	"checkbox",
	"color",
	"file",
	"hidden",
	"image",
	"radio",
	"range",
	"reset",
	"submit",
]);

function normalizeEventKey(key: string): { key: string; clearShift: boolean } | null {
	const named = NAMED_EVENT_KEYS[key];
	if (named !== undefined) {
		return { key: named, clearShift: false };
	}
	if (key === "+" || key === "NumpadAdd") {
		return { key: "Plus", clearShift: true };
	}
	const shifted = SHIFTED_SYMBOLS[key];
	if (shifted !== undefined) {
		return { key: shifted, clearShift: false };
	}
	if (key.length === 1) {
		return { key: key.toUpperCase(), clearShift: false };
	}
	return null;
}

function eventKeyForm(press: KeyPress): string | null {
	if (press.isComposing || press.repeat) return null;
	const normalized = normalizeEventKey(press.key);
	if (normalized === null) return null;
	const shift = normalized.clearShift ? false : press.shiftKey;
	return [
		press.ctrlKey ? "1" : "0",
		press.altKey ? "1" : "0",
		press.metaKey ? "1" : "0",
		shift ? "1" : "0",
		normalized.key,
	].join(":");
}

function shortcutForm(spec: string): string | null {
	const parsed = parseShortcut(spec);
	if (!parsed.ok) return null;
	const { ctrl, alt, cmd, shift, key } = parsed.value;
	return [ctrl ? "1" : "0", alt ? "1" : "0", cmd ? "1" : "0", shift ? "1" : "0", key].join(":");
}

/** The live binding text after the send-key swap, unless the user rebound that command. */
function swappedShortcut(commandId: string, shortcut: string, mode: SendKeyMode): string {
	if (mode !== "mod_enter") return shortcut;
	const swap = SEND_KEY_SWAP[commandId];
	if (swap === undefined) return shortcut;
	const command = getCommand(commandId);
	if (command === undefined || !command.defaultShortcuts.includes(shortcut)) return shortcut;
	return swap;
}

/**
 * Finds the command for a key press. `scopes` lists the active scopes, most specific first.
 * Null means the key is not a shortcut here and the browser keeps it.
 */
export function commandForKeyPress(
	press: KeyPress,
	scopes: readonly CommandScope[],
	bindings: readonly KeyBinding[],
	sendKeyMode: SendKeyMode = "enter",
): CommandId | null {
	const form = eventKeyForm(press);
	if (form === null) return null;
	for (const scope of scopes) {
		for (const binding of bindings) {
			if (binding.scope !== scope) continue;
			const shortcut = swappedShortcut(binding.commandId, binding.shortcut, sendKeyMode);
			if (shortcutForm(shortcut) === form) return binding.commandId;
		}
	}
	return null;
}

/** Every live binding in table order, with the user's overrides applied. */
export function keyBindings(overrides: ShortcutOverrides = {}): KeyBinding[] {
	return COMMANDS.flatMap((command) =>
		effectiveShortcuts(command, overrides).map((shortcut) => ({
			commandId: command.id,
			scope: command.scope,
			shortcut,
		})),
	);
}

/** The menu accelerators in Tauri's syntax. Unbound commands send null, which clears the item. */
export function menuShortcuts(
	overrides: ShortcutOverrides = {},
	sendKeyMode: SendKeyMode = "enter",
): MenuShortcut[] {
	return COMMANDS.map((command) => {
		const shortcut = effectiveShortcuts(command, overrides)[0];
		const live = shortcut === undefined ? null : swappedShortcut(command.id, shortcut, sendKeyMode);
		return {
			commandId: command.id,
			accelerator: live === null ? null : toAccelerator(live),
		};
	});
}

function toAccelerator(spec: string): string | null {
	const parsed = parseShortcut(spec);
	if (!parsed.ok) return null;
	const modifiers = [
		parsed.value.ctrl ? "Control" : null,
		parsed.value.alt ? "Alt" : null,
		parsed.value.cmd ? "CmdOrCtrl" : null,
		parsed.value.shift ? "Shift" : null,
	].filter((part): part is string => part !== null);
	const key = ACCELERATOR_KEYS[parsed.value.key] ?? parsed.value.key;
	return [...modifiers, key].join("+");
}

const ACCELERATOR_KEYS: Readonly<Record<string, string>> = {
	ArrowUp: "Up",
	ArrowDown: "Down",
	ArrowLeft: "Left",
	ArrowRight: "Right",
	Space: "Space",
	Plus: "Plus",
	Backspace: "Backspace",
	Delete: "Delete",
	Enter: "Enter",
	Escape: "Escape",
	Tab: "Tab",
};

/** The active scopes for a focused element, most specific first. Always ends with `global`. */
export function scopesForTarget(
	target: EventTarget | null,
	openOverlay: "palette" | "shortcuts" | "passport" | "quick-open" | "search-files" | null = null,
): CommandScope[] {
	const scopes: CommandScope[] = [];
	const element = target instanceof Element ? target : null;

	if (element !== null && element.closest("[role='menu'], [role='menuitem']") !== null) {
		scopes.push("menu");
	}
	if (openOverlay === "palette") scopes.push("palette");
	else if (openOverlay !== null) scopes.push("dialog");
	if (element !== null && element.closest("[role='dialog']") !== null) scopes.push("dialog");

	const marked = element?.closest("[data-command-scope]");
	for (const name of (marked?.getAttribute("data-command-scope") ?? "").split(/\s+/)) {
		if (SCOPES.has(name)) scopes.push(name as CommandScope);
	}

	if (element !== null && isTextEntry(element)) scopes.push("chat-input");
	if (element !== null && element.closest(".xterm, [data-terminal]") !== null) {
		scopes.push("terminal");
	}
	if (element !== null && element.closest("[data-diff], [data-file-viewer]") !== null) {
		scopes.push("diff");
	}

	scopes.push("global");
	return [...new Set(scopes)];
}

function isTextEntry(element: Element): boolean {
	const field = element.closest("input, textarea, [contenteditable]");
	if (field === null) return false;
	if (field instanceof HTMLInputElement) return !TEXT_INPUT_TYPES.has(field.type);
	return field.getAttribute("contenteditable") !== "false";
}

// ---------------------------------------------------------------- handlers

interface HandlerRegistration {
	priority: HandlerPriority;
	order: number;
	handler: CommandHandlerFn;
}

const registrations = new Map<string, HandlerRegistration[]>();
let registrationOrder = 0;

/** Registers a handler and returns the function that removes it. Not a hook, so it can be unit tested. */
export function registerCommandHandler(
	commandId: string,
	priority: HandlerPriority,
	handler: CommandHandlerFn,
): () => void {
	const registration: HandlerRegistration = { priority, order: registrationOrder, handler };
	registrationOrder += 1;
	const current = registrations.get(commandId) ?? [];
	current.push(registration);
	registrations.set(commandId, current);
	let active = true;
	return () => {
		if (!active) return;
		active = false;
		const list = registrations.get(commandId);
		if (list === undefined) return;
		const index = list.indexOf(registration);
		if (index >= 0) list.splice(index, 1);
		if (list.length === 0) registrations.delete(commandId);
	};
}

/**
 * Runs the registered handlers for a command, highest priority first. A handler that returns false
 * passes the command to the next one. True means a handler took it.
 */
export function runCommandHandlers(commandId: string): boolean {
	const list = registrations.get(commandId);
	if (list === undefined) return false;
	const ordered = [...list].sort(
		(a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.order - a.order,
	);
	for (const registration of ordered) {
		if (registration.handler() !== false) return true;
	}
	return false;
}

/** Removes every registered handler. Test support, so one test cannot leak into the next. */
export function clearCommandHandlers(): void {
	registrations.clear();
}

/** Registers `handler` for `commandId` while the calling component is mounted. */
export function useCommandHandler(
	commandId: CommandId,
	priority: HandlerPriority,
	handler: CommandHandlerFn,
): void {
	const latest = useRef(handler);
	latest.current = handler;
	useEffect(
		() => registerCommandHandler(commandId, priority, () => latest.current()),
		[commandId, priority],
	);
}

// ---------------------------------------------------------------- dispatch

/** The edges a dispatch needs. Passed in so the dispatch itself stays testable. */
export interface CommandDispatchDeps {
	isEnabled: (commandId: string) => boolean;
	run: (commandId: string) => Promise<Result<void>>;
	report: (message: string) => void;
}

/**
 * Runs a command by id: a focused screen handler first, then the service-level runner. An unknown
 * id or a failed run is reported, never thrown.
 */
export function dispatchCommand(commandId: string, deps: CommandDispatchDeps): void {
	if (runCommandHandlers(commandId)) return;
	if (getCommand(commandId) === undefined) {
		deps.report(`No command named ${commandId}.`);
		return;
	}
	void deps.run(commandId).then((result) => {
		if (!result.ok) deps.report(result.error.message);
	});
}

/** The command a deep link opens, or null when its route belongs to NAV-17. */
export function commandForDeepLink(url: string): CommandId | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== "conducted:") return null;
	if (parsed.hostname === "settings") return "app.openSettings";
	return null;
}

export interface CommandDispatcherOptions {
	/** Takes deep links that open a route. When absent, this file opens the ones it knows. */
	onDeepLink?: (url: string) => void;
}

/** Mounts the key, menu and deep-link listeners once, at the root of the app. */
export function useCommandDispatcher(options: CommandDispatcherOptions = {}): void {
	const { services, platform } = useServices();
	const { overrides } = useShortcutOverrides();
	const sendKey = useSetting<string>("message_send_key");
	const sendKeyMode: SendKeyMode = sendKey === "cmd-enter" ? "mod_enter" : "enter";
	const { onDeepLink } = options;

	const bindings = useMemo(() => keyBindings(overrides), [overrides]);
	const accelerators = useMemo(
		() => menuShortcuts(overrides, sendKeyMode),
		[overrides, sendKeyMode],
	);
	const deps = useMemo<CommandDispatchDeps>(
		() => ({
			isEnabled: (commandId) => services.commands.isEnabled(commandId),
			run: (commandId) => services.commands.run(commandId),
			report: (message) => platform.app.writeLog("warn", message),
		}),
		[services, platform],
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			const press: KeyPress = {
				key: event.key,
				metaKey: event.metaKey,
				ctrlKey: event.ctrlKey,
				altKey: event.altKey,
				shiftKey: event.shiftKey,
				isComposing: event.isComposing,
				repeat: event.repeat,
			};
			const scopes = scopesForTarget(event.target, useOverlayStore.getState().open);
			const commandId = commandForKeyPress(press, scopes, bindings, sendKeyMode);
			if (commandId === null) return;
			if (!deps.isEnabled(commandId)) return;
			event.preventDefault();
			dispatchCommand(commandId, deps);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [bindings, deps, sendKeyMode]);

	useEffect(() => {
		void platform.menu.setShortcuts(accelerators).then((result) => {
			if (!result.ok) {
				platform.app.writeLog("warn", `Could not set the menu shortcuts: ${result.error.message}`);
				return;
			}
			if (result.value.rejected.length > 0) {
				platform.app.writeLog(
					"warn",
					`The menu rejected shortcuts for: ${result.value.rejected.join(", ")}.`,
				);
			}
		});
	}, [accelerators, platform]);

	useEffect(
		() => platform.menu.onCommand((commandId) => dispatchCommand(commandId, deps)),
		[deps, platform],
	);

	useEffect(
		() =>
			platform.app.onDeepLink((url) => {
				if (onDeepLink !== undefined) {
					onDeepLink(url);
					return;
				}
				const commandId = commandForDeepLink(url);
				if (commandId === null) {
					deps.report(`No command handles the deep link ${url}.`);
					return;
				}
				dispatchCommand(commandId, deps);
			}),
		[deps, onDeepLink, platform],
	);
}
