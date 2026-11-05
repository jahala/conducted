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
 * Test first: with a `base` and a `modal` handler registered for "palette.open", the dispatcher runs only
 * the `modal` one; after the modal handler unmounts, the `base` one runs.
 */
import { notImplemented } from "@conducted/shared";
import type { CommandId, CommandScope } from "../core/registries/commands.ts";

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
 * Finds the command for a key press. `scopes` lists the active scopes, most specific first.
 * Null means the key is not a shortcut here and the browser keeps it.
 */
export function commandForKeyPress(
	_press: KeyPress,
	_scopes: readonly CommandScope[],
	_bindings: readonly KeyBinding[],
): CommandId | null {
	return notImplemented("NAV-14");
}

/** Mounts the key, menu and deep-link listeners once, at the root of the app. */
export function useCommandDispatcher(): never {
	return notImplemented("NAV-14");
}

/** Registers `handler` for `commandId` while the calling component is mounted. */
export function useCommandHandler(
	_commandId: CommandId,
	_priority: HandlerPriority,
	_handler: CommandHandlerFn,
): never {
	return notImplemented("NAV-14");
}
