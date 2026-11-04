/**
 * @feature NAV-07 Command runner: from a command id to its handler
 * Owns: running a command by id (menu, palette, shortcut), knowing which commands are enabled
 * right now, and the table of handlers.
 * Behaviour: ui-map.md 5.1 (palette), 5.4 (shortcuts), structure-map.md 3.2 (one registry feeds
 * menus, palette and shortcuts).
 * Must handle: an id the registry does not know returns an Err; a known id with no handler
 * returns an Err with code `command_unavailable` (so a menu item never does nothing silently); a
 * disabled command (no workspace selected, no open PR) returns an Err and the palette greys it
 * out; a handler that fails returns its Err; two runs of one command at once run once; commands
 * that need a dialog open it and return when it is opened, not when it is answered.
 * Our design choice: handlers are plain functions over services, collected in one table typed by
 * `CommandId`, so a new command without a handler is visible as a missing key.
 * Test first: running an id without a handler returns `command_unavailable`.
 */
import { appError, err, notImplemented, type Result } from "@conducted/shared";
import type { Services } from "../container.ts";
import { type CommandId, getCommand } from "../registries/commands.ts";

export type CommandHandler = () => Promise<Result<void>>;
export type CommandHandlers = Partial<Record<CommandId, CommandHandler>>;

export interface CommandContext {
	hasWorkspace: boolean;
	hasOpenPr: boolean;
	hasOpenChat: boolean;
}

export interface CommandRunnerDeps {
	/** Read on each run, so the table can be built after the runner. */
	handlers: () => CommandHandlers;
	context: () => CommandContext;
}

export class CommandRunner {
	readonly #deps: CommandRunnerDeps;

	constructor(deps: CommandRunnerDeps) {
		this.#deps = deps;
	}

	/** Backs `Actions.app.runCommand`. */
	async run(id: string): Promise<Result<void>> {
		const def = getCommand(id);
		if (def === undefined) return err(appError("command_unknown", `No command named ${id}.`));
		const handler = this.#deps.handlers()[def.id as CommandId];
		if (handler === undefined) {
			return err(appError("command_unavailable", `${def.title} is not available yet.`));
		}
		if (!this.isEnabled(id))
			return err(appError("command_disabled", `${def.title} is not available now.`));
		return handler();
	}

	/** Backs `useCommands`' enabled flag. */
	isEnabled(_id: string): boolean {
		void this.#deps.context;
		return notImplemented("NAV-07");
	}
}

/** Builds the real handler table from the services. The table is where each id meets its service. */
export function createCommandHandlers(_services: Services): CommandHandlers {
	return notImplemented("NAV-07");
}
