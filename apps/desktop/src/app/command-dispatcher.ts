/**
 * @feature NAV-14 Shortcut and menu dispatcher
 * Owns: turning key presses, menu picks and deep links into command ids, and handing each command to the
 * right handler. Five hooks: `useCommandDispatcher` mounts the root listeners once; `useCommandHandler`
 * lets a screen register a handler for one command id with a priority; `useRunCommandHandlers` lets a
 * screen run a command's handlers, as a slash command does for /plan and /fast; `useScopeKeyDown` lets
 * a focus-trapping dialog run its own scope's keys before its trap takes them. `useScopedKeyMatch` lets a
 * card that handles its own keys (question, tool approval) look a key up in its scope with the live rebinds.
 * Behaviour: ui-map.md 5.4 (shortcuts by scope), 8 ("Kn(commandId, handler, opts)" registers a handler with a
 * priority; a hint component reads the live binding so tooltips follow rebinds), 1.1 (root listeners for
 * menu events and deep links); structure-map.md 3.2 (one registry feeds menus, palette and shortcuts).
 * Data: the command table and scopes are in core/registries/commands.ts. The menu event is
 * Platform.menu.onCommand. A command with no screen handler at all falls back to
 * `Actions.app.runCommand` (core/services/command-runner.ts), so core keeps one table of
 * service-level handlers. A screen handler that returns false means the command has nothing to do
 * here (Cmd+2 with one workspace), so it does not reach the fallback and the user sees no error; the
 * "not available yet" result is only for a command with no handler anywhere.
 * Must handle: the same keys meaning different things in different scopes (chat input, terminal, diff,
 * dialog, palette, menu, chat cards); a key press during IME composition or key repeat (ignored); the
 * send-key swap (Enter versus Cmd+Enter), which follows COMP-01's one rule in send-key.ts; the user's
 * rebinds, read live; a focused text field keeping plain letters while a global Cmd shortcut still
 * works; the composer's own Enter handling (the dispatcher leaves it to COMP-01); two handlers for one
 * command (the higher priority runs; a handler that returns false passes the command on); a handler
 * that unmounts (its registration is removed); a command that is disabled (neither a key press nor a
 * menu pick runs it, and the key press is not swallowed); a dialog command no open dialog handles
 * (Cmd+Enter in a dialog without a confirm action passes on, with no error); a menu pick for an id the registry does not
 * know (reported, not thrown); a modal's focus trap that takes Tab and Shift+Tab before the root
 * listener sees them (the modal runs its own scope's keys first through `useScopeKeyDown`); a bare
 * character or caret key in a focused text field, which is the field's typing (`fieldOwnsKey`).
 * Our design choice: priorities are three named levels (`base`, `area`, `modal`), not numbers. A terminal
 * or diff area registers at `area`; a dialog registers at `modal`, so it wins while it is open.
 * Our design choice: a focus area marks itself with `data-command-scope="chat-input"` (or several scope
 * names, space separated). Without a mark, editable fields count as `chat-input` and the shared
 * `.xterm` and `[data-diff]` wrappers count as their area. A field inside a diff area (marked, or
 * under `[data-diff]` or `[data-file-viewer]`) is that area's field, never `chat-input`: the file
 * editor's Cmd+F is Find in file, not Search in the chat (ui-map.md 5.4, "Open code editor search").
 * Every lookup ends with `global`.
 * Our design choice: the handler registry is an object the caller passes in (`CommandRegistry`).
 * `CommandDispatcher` creates one per app root and provides it to `useCommandHandler`. The no-argument
 * helpers keep a registry of their own so screens that have not moved to the provider still work; the
 * container owning that registry is APP-01's change.
 * Our design choice: menu accelerators are the live first binding in Tauri's syntax, so a rebind changes
 * the menu bar without a second table. The Rust shell keeps Cmd+Q and Cmd+, fixed (menu.rs's
 * FIXED_MENU_IDS); the dispatcher leaves those commands out, so Rust keeps their accelerators and never
 * reports them as rejected. Every deep link goes to the caller's `onDeepLink` opener, which
 * NAV-17 owns; without one the link is reported to the log rather than parsed in a second place. A link the
 * Rust shell refused before any parser saw it (over 64 KiB, PLAT-16) shows "Invalid deep link", the
 * toast Conductor shows for a link it cannot read, and the reason goes to the app log.
 * Our design choice: `CommandHint` is the one keycap component. It reads the live binding, so a hint
 * follows a rebind instead of showing the shipped key.
 * Test first: with a `base` and a `modal` handler registered for "palette.open", the dispatcher runs only
 * the `modal` one; after the modal handler unmounts, the `base` one runs.
 */
import type { Result } from "@conducted/shared";
import {
	createContext,
	createElement,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useServices } from "../core/context.tsx";
import { useLiveShortcut, useSetting, useShortcutOverrides } from "../core/hooks.ts";
import {
	COMMANDS,
	type CommandId,
	type CommandScope,
	effectiveShortcuts,
	getCommand,
	parseShortcut,
	type ShortcutOverrides,
} from "../core/registries/commands.ts";
import { resolveSendKey, type SendIntent, type SendWith } from "../features/composer/send-key.ts";
import { TERMINAL_OWNED_COMMAND_IDS } from "../features/terminal/terminal-keys.ts";
import type { MenuShortcut } from "../platform/platform.ts";
import { Kbd } from "../ui/Kbd.tsx";
import { toast, toastError } from "../ui/Toast.tsx";
import { type OverlayId, useOverlayStore } from "./overlay-store.ts";

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
 * The send-key setting's two modes. This is COMP-01's `SendWith`, so the composer and the dispatcher
 * use one type and one rule.
 */
export type SendKeyMode = SendWith;

/** The intent each chat command carries, so send-key.ts's rule can choose its live key. */
const SEND_KEY_INTENTS: Readonly<Record<string, SendIntent>> = {
	"chat.newLine": "newline",
	"chat.submit": "submit",
	"chat.submitOpposite": "submit_opposite",
	"chat.question.submit": "submit",
};

/** Candidate Enter keys, most common first. send-key.ts decides which one means the intent. */
const SEND_KEY_CANDIDATES: readonly string[] = ["Enter", "Cmd+Enter", "Alt+Enter", "Shift+Enter"];

/** The key send-key.ts gives an intent in a mode, or null when the command has no send-key intent. */
function sendKeyShortcut(commandId: string, mode: SendWith): string | null {
	const intent = SEND_KEY_INTENTS[commandId];
	if (intent === undefined) return null;
	for (const spec of SEND_KEY_CANDIDATES) {
		const parsed = parseShortcut(spec);
		if (!parsed.ok) continue;
		const press = {
			key: "Enter",
			shiftKey: parsed.value.shift,
			metaKey: parsed.value.cmd,
			altKey: parsed.value.alt,
			ctrlKey: parsed.value.ctrl,
			isComposing: false,
		};
		if (resolveSendKey(press, mode) === intent) return spec;
	}
	return null;
}

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
	const command = getCommand(commandId);
	if (command === undefined || !command.defaultShortcuts.includes(shortcut)) return shortcut;
	return sendKeyShortcut(commandId, mode) ?? shortcut;
}

/** True when COMP-01's composer owns the key, so the dispatcher must leave it alone. */
function composerOwnsKey(
	press: KeyPress,
	scopes: readonly CommandScope[],
	sendWith: SendWith,
): boolean {
	if (scopes[0] !== "chat-input") return false;
	return (
		resolveSendKey(
			{
				key: press.key,
				shiftKey: press.shiftKey,
				metaKey: press.metaKey,
				altKey: press.altKey,
				ctrlKey: press.ctrlKey,
				isComposing: press.isComposing,
			},
			sendWith,
		) !== null
	);
}

/** Keys that move the caret or delete text in a field, as opposed to Tab, Enter and Escape. */
const CARET_KEYS: ReadonlySet<string> = new Set([
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"Backspace",
	"Delete",
	"Home",
	"End",
	"PageUp",
	"PageDown",
]);

/**
 * True when a key press is a focused text field's own typing or caret movement, so no command may
 * take it: a character, an arrow, Backspace, Delete, Home, End or a page key, with no Cmd, Ctrl or
 * Alt. Without this, the diff's bare ArrowUp and ArrowDown (previous and next file), the question
 * card's digits and the queue's E would fire while the user types in the file editor, the "Other"
 * answer or the queued message's editor. Tab, Enter, Escape and modified keys still reach the
 * dispatcher, which the palette, the composer and every shortcut rely on.
 */
export function fieldOwnsKey(press: KeyPress, target: Element | null): boolean {
	if (target === null || !isTextEntry(target)) return false;
	if (press.metaKey || press.ctrlKey || press.altKey) return false;
	return press.key.length === 1 || CARET_KEYS.has(press.key);
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

/** A command a key press means in one scope, and which of the command's live shortcuts matched. */
export interface ScopedKeyMatch {
	commandId: CommandId;
	/**
	 * The position of the matched shortcut in the command's live list. A command with one shortcut per
	 * target uses it as the target: the question card's "Pick an answer option by number" binds 1 to 9,
	 * so the shortcut at index 1 picks the second option.
	 */
	index: number;
}

/**
 * Finds the command a key press means in one scope, with the user's rebinds and the send-key swap.
 * A card that owns its keys (the question card, the tool approval card) calls this instead of
 * comparing key names, so a rebind on the Keyboard shortcuts page reaches it.
 */
function matchScopedKey(
	press: KeyPress,
	scope: CommandScope,
	overrides: ShortcutOverrides,
	sendKeyMode: SendKeyMode = "enter",
): ScopedKeyMatch | null {
	const form = eventKeyForm(press);
	if (form === null) return null;
	for (const command of COMMANDS) {
		if (command.scope !== scope) continue;
		const shortcuts = effectiveShortcuts(command, overrides);
		for (const [index, shortcut] of shortcuts.entries()) {
			if (shortcutForm(swappedShortcut(command.id, shortcut, sendKeyMode)) === form) {
				return { commandId: command.id, index };
			}
		}
	}
	return null;
}

/** The parts of a DOM keyboard event a lookup reads. */
export function keyPressOf(event: KeyboardEvent): KeyPress {
	return {
		key: event.key,
		metaKey: event.metaKey,
		ctrlKey: event.ctrlKey,
		altKey: event.altKey,
		shiftKey: event.shiftKey,
		isComposing: event.isComposing,
		repeat: event.repeat,
	};
}

/** The send-key setting as the dispatcher's mode. */
export function useSendKeyMode(): SendKeyMode {
	const sendKey = useSetting<string>("message_send_key");
	return sendKey === "cmd-enter" ? "mod_enter" : "enter";
}

/** `matchScopedKey` for one scope, reading the live rebinds and send-key setting. */
export function useScopedKeyMatch(scope: CommandScope): (press: KeyPress) => ScopedKeyMatch | null {
	const { overrides } = useShortcutOverrides();
	const sendKeyMode = useSendKeyMode();
	return useCallback(
		(press: KeyPress) => matchScopedKey(press, scope, overrides, sendKeyMode),
		[scope, overrides, sendKeyMode],
	);
}

/**
 * Every live binding in table order, with the user's overrides applied. The terminal keys xterm
 * handles itself are left out: the surface applies them, and a binding here would dispatch them a
 * second time and report them as unbuilt (features/terminal/terminal-keys.ts).
 */
export function keyBindings(overrides: ShortcutOverrides = {}): KeyBinding[] {
	return COMMANDS.filter((command) => !TERMINAL_OWNED_COMMAND_IDS.includes(command.id)).flatMap(
		(command) =>
			effectiveShortcuts(command, overrides).map((shortcut) => ({
				commandId: command.id,
				scope: command.scope,
				shortcut,
			})),
	);
}

/**
 * The first key a command answers to now: the user's own binding, or its default after the
 * send-key swap. Null for an unknown or unbound command. The menus and the shortcuts dialog
 * (NAV-09) show this, so they show what a key press does.
 */
export function liveBinding(
	commandId: string,
	overrides: ShortcutOverrides = {},
	sendKeyMode: SendKeyMode = "enter",
): string | null {
	const command = getCommand(commandId);
	if (command === undefined) return null;
	const shortcut = effectiveShortcuts(command, overrides)[0];
	return shortcut === undefined ? null : swappedShortcut(command.id, shortcut, sendKeyMode);
}

/**
 * Menu items whose key the user cannot change (ui-map 5.4). The Rust shell keeps their accelerators
 * fixed and refuses a binding for one, so the dispatcher never sends them. Rust's `FIXED_MENU_IDS`
 * in apps/desktop/src-tauri/src/menu.rs names the same commands.
 */
export const FIXED_MENU_COMMAND_IDS: readonly string[] = ["app.quit", "app.openSettings"];

/** The menu accelerators in Tauri's syntax. Unbound commands send null, which clears the item. */
export function menuShortcuts(
	overrides: ShortcutOverrides = {},
	sendKeyMode: SendKeyMode = "enter",
): MenuShortcut[] {
	return COMMANDS.filter((command) => !FIXED_MENU_COMMAND_IDS.includes(command.id)).map(
		(command) => {
			const live = liveBinding(command.id, overrides, sendKeyMode);
			return {
				commandId: command.id,
				accelerator: live === null ? null : toAccelerator(live),
			};
		},
	);
}

function toAccelerator(spec: string): string | null {
	const parsed = parseShortcut(spec);
	if (!parsed.ok) return null;
	const modifiers = [
		parsed.value.cmd ? "CmdOrCtrl" : null,
		parsed.value.ctrl ? "Control" : null,
		parsed.value.alt ? "Alt" : null,
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
	openOverlay: OverlayId | null = null,
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

	// A field inside a diff or the file viewer (the file editor, its find bar, a comment) belongs to
	// that area, so Cmd+F there is Find in file and the chat composer's keys stay out of it.
	const inDiff =
		scopes.includes("diff") ||
		(element !== null && element.closest("[data-diff], [data-file-viewer]") !== null);
	if (element !== null && !inDiff && isTextEntry(element)) scopes.push("chat-input");
	if (element !== null && element.closest(".xterm, [data-terminal]") !== null) {
		scopes.push("terminal");
	}
	if (inDiff) scopes.push("diff");

	scopes.push("global");
	return [...new Set(scopes)];
}

/** True when the element is, or sits inside, a field that takes typed text and keeps its own select-all. */
export function isTextEntry(element: Element): boolean {
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

/** The handlers a screen registered. One registry owns its own map; the app creates and passes it in. */
export interface CommandRegistry {
	/** Registers a handler and returns the function that removes it. */
	register(commandId: string, priority: HandlerPriority, handler: CommandHandlerFn): () => void;
	/** Runs the registered handlers, highest priority first. True means one took the command. */
	run(commandId: string): boolean;
	/** True while a screen has any handler registered for the command, whether or not it takes it. */
	has(commandId: string): boolean;
	/** Removes every registered handler. Test support, so one test cannot leak into the next. */
	clear(): void;
}

export function createCommandRegistry(): CommandRegistry {
	const registrations = new Map<string, HandlerRegistration[]>();
	let registrationOrder = 0;
	return {
		register(commandId, priority, handler) {
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
		},
		has(commandId) {
			return (registrations.get(commandId)?.length ?? 0) > 0;
		},
		run(commandId) {
			const list = registrations.get(commandId);
			if (list === undefined) return false;
			const ordered = [...list].sort(
				(a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.order - a.order,
			);
			for (const registration of ordered) {
				if (registration.handler() !== false) return true;
			}
			return false;
		},
		clear() {
			registrations.clear();
			registrationOrder = 0;
		},
	};
}

/**
 * The registry the no-argument helpers use. The app's real registry is created by `CommandDispatcher`
 * and provided to the hooks. This fallback exists only for a screen rendered without its provider,
 * which hides a missing provider in tests; APP-16 moves it into the container.
 */
const defaultRegistry = createCommandRegistry();

const CommandRegistryContext = createContext<CommandRegistry | null>(null);

/** Provides the registry `useCommandHandler` registers into. */
export function CommandRegistryProvider({
	registry,
	children,
}: {
	registry: CommandRegistry;
	children?: ReactNode;
}) {
	return createElement(CommandRegistryContext.Provider, { value: registry }, children);
}

/** Registers a handler and returns the function that removes it. Not a hook, so it can be unit tested. */
export function registerCommandHandler(
	commandId: string,
	priority: HandlerPriority,
	handler: CommandHandlerFn,
	registry: CommandRegistry = defaultRegistry,
): () => void {
	return registry.register(commandId, priority, handler);
}

/**
 * Runs the registered handlers for a command, highest priority first. A handler that returns false
 * passes the command to the next one. True means a handler took it.
 */
export function runCommandHandlers(
	commandId: string,
	registry: CommandRegistry = defaultRegistry,
): boolean {
	return registry.run(commandId);
}

/** Removes every registered handler. Test support, so one test cannot leak into the next. */
export function clearCommandHandlers(registry: CommandRegistry = defaultRegistry): void {
	registry.clear();
}

/** Registers `handler` for `commandId` while the calling component is mounted. */
export function useCommandHandler(
	commandId: CommandId,
	priority: HandlerPriority,
	handler: CommandHandlerFn,
): void {
	const provided = useContext(CommandRegistryContext);
	const registry = provided ?? defaultRegistry;
	const latest = useRef(handler);
	latest.current = handler;
	useEffect(
		() => registry.register(commandId, priority, () => latest.current()),
		[registry, commandId, priority],
	);
}

/**
 * Runs a command's screen handlers from inside a screen, as its key press would, so a control that
 * repeats a command (a slash command, a menu item) reaches the same handler. False when no handler
 * took it.
 */
export function useRunCommandHandlers(): (commandId: string) => boolean {
	const provided = useContext(CommandRegistryContext);
	const registry = provided ?? defaultRegistry;
	return useCallback((commandId: string) => registry.run(commandId), [registry]);
}

// ---------------------------------------------------------------- dispatch

/** The edges a dispatch needs. Passed in so the dispatch itself stays testable. */
export interface CommandDispatchDeps {
	registry: CommandRegistry;
	isEnabled: (commandId: string) => boolean;
	run: (commandId: string) => Promise<Result<void>>;
	/** Developer-facing notes: an unknown id, a link nothing handles. They go to the log. */
	report: (message: string) => void;
	/** A command the user asked for ran and failed. The user is told. */
	failed: (commandId: string, error: { message: string }) => void;
}

/**
 * Runs a command by id: a focused screen handler first, then the service-level runner. A screen
 * handler that exists but declines means the command has nothing to do here, so the runner is not
 * asked and the user sees no error. An unknown id is reported to the log, a failed run is shown to
 * the user, and neither is thrown. A disabled command runs neither path, so a menu pick cannot do
 * what the same key press refuses to do.
 */
export function dispatchCommand(commandId: string, deps: CommandDispatchDeps): void {
	if (getCommand(commandId) === undefined) {
		deps.report(`No command named ${commandId}.`);
		return;
	}
	if (!deps.isEnabled(commandId)) return;
	if (deps.registry.run(commandId)) return;
	// A handler that declines passes the command no further: the runner's "not available yet" is
	// for a command with no handler anywhere, not for one this screen cannot act on right now.
	if (deps.registry.has(commandId)) return;
	void deps.run(commandId).then((result) => {
		if (!result.ok) deps.failed(commandId, result.error);
	});
}

export interface CommandDispatcherOptions {
	/** Opens a deep link. The app passes NAV-17's opener; without one the link is reported, not parsed here. */
	onDeepLink?: (url: string) => void;
}

/**
 * Looks a key press up and runs its command, the way the root key listener does. With `onlyScope`,
 * only that scope's bindings count, and only while the scope is active. True means a command took the
 * key and the event's default was prevented.
 */
export type DispatchKey = (event: KeyboardEvent, onlyScope?: CommandScope | null) => boolean;

const DispatchKeyContext = createContext<DispatchKey | null>(null);

/**
 * Lets a layer that traps focus run its own scope's keys before the trap sees them. A modal dialog's
 * focus trap takes Tab and Shift+Tab to move focus before the event reaches the root listener, so the
 * command palette, whose scope binds those keys, calls this from its own keydown handler and stops
 * the event when it returns true. Without a dispatcher above, it takes no key.
 */
export function useScopeKeyDown(scope: CommandScope): (event: KeyboardEvent) => boolean {
	const dispatchKey = useContext(DispatchKeyContext);
	return useCallback(
		(event: KeyboardEvent) => (dispatchKey === null ? false : dispatchKey(event, scope)),
		[dispatchKey, scope],
	);
}

/**
 * Mounts the key, menu and deep-link listeners once, at the root of the app. Returns the key lookup
 * the root listener uses, so `CommandDispatcher` can hand it to `useScopeKeyDown`.
 */
export function useCommandDispatcher(
	registry: CommandRegistry = defaultRegistry,
	options: CommandDispatcherOptions = {},
): DispatchKey {
	const { services, platform } = useServices();
	const { overrides } = useShortcutOverrides();
	const sendKeyMode = useSendKeyMode();
	const { onDeepLink } = options;

	const bindings = useMemo(() => keyBindings(overrides), [overrides]);
	const accelerators = useMemo(
		() => menuShortcuts(overrides, sendKeyMode),
		[overrides, sendKeyMode],
	);
	const deps = useMemo<CommandDispatchDeps>(
		() => ({
			registry,
			isEnabled: (commandId) => services.commands.isEnabled(commandId),
			run: (commandId) => services.commands.run(commandId),
			report: (message) => platform.app.writeLog("warn", message),
			failed: (commandId, error) => {
				platform.app.writeLog("warn", `Command ${commandId} failed: ${error.message}`);
				// Conductor's command titles are names, not verbs ("Settings", "Toggle zen mode").
				toastError(`Couldn't run ${getCommand(commandId)?.title ?? commandId}`, error);
			},
		}),
		[registry, services, platform],
	);

	const dispatchKey = useCallback<DispatchKey>(
		(event, onlyScope = null) => {
			if (event.defaultPrevented) return false;
			const press = keyPressOf(event);
			const active = scopesForTarget(event.target, useOverlayStore.getState().open);
			const scopes = onlyScope === null ? active : active.filter((scope) => scope === onlyScope);
			if (composerOwnsKey(press, scopes, sendKeyMode)) return false;
			if (fieldOwnsKey(press, event.target instanceof Element ? event.target : null)) return false;
			const commandId = commandForKeyPress(press, scopes, bindings, sendKeyMode);
			if (commandId === null) return false;
			if (!deps.isEnabled(commandId)) return false;
			// A dialog command acts on the open dialog and has no app-wide handler, so a press no open
			// dialog takes (Cmd+Enter in quick open, which has no confirm action) passes on unswallowed.
			if (getCommand(commandId)?.scope === "dialog") {
				if (!deps.registry.run(commandId)) return false;
				event.preventDefault();
				return true;
			}
			event.preventDefault();
			dispatchCommand(commandId, deps);
			return true;
		},
		[bindings, deps, sendKeyMode],
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			dispatchKey(event);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [dispatchKey]);

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
				deps.report(`No deep-link opener is mounted for ${url}.`);
			}),
		[deps, onDeepLink, platform],
	);

	// A link the Rust shell refused (over 64 KiB) is shown the way Conductor shows a refused link.
	useEffect(
		() =>
			platform.app.onDeepLinkRejected((rejection) => {
				platform.app.writeLog("warn", `A deep link was refused: ${rejection.message}`);
				toast.error("Invalid deep link");
			}),
		[platform],
	);

	return dispatchKey;
}

export interface CommandDispatcherProps extends CommandDispatcherOptions {
	/**
	 * The registry handlers register into. When the caller passes none, a `CommandRegistryProvider` above is
	 * used; with neither, one is created.
	 */
	registry?: CommandRegistry;
	children?: ReactNode;
}

/**
 * Mounts the dispatcher once at the app root and provides its registry to every screen below.
 * Our design choice: one component, not a bare hook, so `useCommandHandler` in a child sees the
 * same registry the key and menu listeners dispatch into.
 */
export function CommandDispatcher({
	registry: provided,
	children,
	...options
}: CommandDispatcherProps) {
	const [created] = useState(createCommandRegistry);
	const outer = useContext(CommandRegistryContext);
	const registry = provided ?? outer ?? created;
	const dispatchKey = useCommandDispatcher(registry, options);
	return createElement(
		CommandRegistryContext.Provider,
		{ value: registry },
		createElement(DispatchKeyContext.Provider, { value: dispatchKey }, children),
	);
}

/**
 * A keycap for one command. It reads the live binding, so the hint follows a rebind.
 * Renders nothing when the command is unknown or unbound.
 */
export function CommandHint({ commandId, className }: { commandId: string; className?: string }) {
	const hint = useLiveShortcut(commandId);
	if (hint === null) return null;
	const props = { className, children: hint };
	return createElement(Kbd, props);
}
