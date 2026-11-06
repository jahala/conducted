/**
 * @feature NAV-07 Command runner: from a command id to its handler
 * Owns: running a command by id (menu, palette, shortcut), knowing which commands are enabled
 * right now, and the table of handlers.
 * Behaviour: ui-map.md 5.1 (palette), 5.4 (shortcuts), structure-map.md 3.2 (one registry feeds
 * menus, palette and shortcuts).
 * Must handle: an id the registry does not know returns an Err; a known id with no handler
 * returns an Err with code `command_unavailable` (so a menu item never does nothing silently); a
 * disabled command (no workspace selected, no open PR) returns an Err and the palette greys it
 * out; a handler that fails returns its Err (a handler that throws or rejects becomes an Err with
 * code `command_failed`); two runs of one command at once run once; commands
 * that need a dialog open it and return when it is opened, not when it is answered.
 * Our design choice: handlers are plain functions over services, kept in an optional table keyed by
 * `CommandId`. A command with no handler fails at run time with `command_unavailable`, so a menu
 * item never does nothing silently. `project.add` takes its folder from a picker port; the
 * composition root passes it once it wires the runner.
 * Test first: running an id without a handler returns `command_unavailable`.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import { createSingleFlight } from "../async/single-flight.ts";
import type { Services } from "../container.ts";
import { type CommandId, getCommand } from "../registries/commands.ts";

export type CommandHandler = () => Promise<Result<void>>;
export type CommandHandlers = Partial<Record<CommandId, CommandHandler>>;

export interface CommandContext {
	hasWorkspace: boolean;
	hasOpenPr: boolean;
	hasOpenChat: boolean;
}

/** The services a command handler may call. Narrowed so tests can pass only what a command uses. */
export type CommandServices = Pick<Services, "repo" | "updates" | "system">;

/** Edges a command needs that do not belong in the services. */
export interface CommandPorts {
	/** Shows the folder dialog for `project.add`. Null means the user cancelled. */
	pickFolder?: (title: string) => Promise<string | null>;
	/** Opens or closes the web inspector for `app.openDebugTools`. */
	toggleInspector?: () => Promise<void>;
}

export interface CommandRunnerDeps {
	/** Read on each run, so the table can be built after the runner. */
	handlers: () => CommandHandlers;
	context: () => CommandContext;
}

/**
 * Commands that start a flow rather than act on something already open. `workspace.create` is the
 * obvious one: it is how a first workspace appears.
 */
const NO_WORKSPACE_NEEDED: ReadonlySet<string> = new Set([
	"workspace.create",
	"workspace.createFromSource",
	"workspace.addToBacklog",
	"workspace.startFromBacklog",
	"workspace.nextFormTab",
	"workspace.previousFormTab",
	"workspace.toggleCreateFromPicker",
	"workspace.createSection",
]);

/**
 * Commands that jump to a chat, so they work even when the screen shows no chat. The next-chat
 * command is global: from Home or a terminal tab it opens the next chat that needs the user.
 */
const NO_OPEN_CHAT_NEEDED: ReadonlySet<string> = new Set(["chat.nextNeedingAttention"]);

/**
 * The context flag a command needs before it can run. `null` means it can always run.
 * Our design choice: the requirement follows the command's id prefix, with the create-flow and
 * next-chat commands exempt, so the registry needs no second table to keep in step.
 */
export function commandRequirement(id: string): keyof CommandContext | null {
	// Linking a pull request is how a workspace gets one, so it must work while it has none.
	if (id === "pr.link") return "hasWorkspace";
	if (id.startsWith("pr.")) return "hasOpenPr";
	if (id === "chat.newTab") return "hasWorkspace";
	if (id.startsWith("chat.") && !NO_OPEN_CHAT_NEEDED.has(id)) return "hasOpenChat";
	if (id.startsWith("workspace.") && !NO_WORKSPACE_NEEDED.has(id)) return "hasWorkspace";
	for (const prefix of ["git.", "review.", "terminal.", "sidebar."]) {
		if (id.startsWith(prefix)) return "hasWorkspace";
	}
	if (id === "nav.quickOpenFile" || id === "nav.searchInFiles") return "hasWorkspace";
	return null;
}

/** Runs a handler so that a throw or a rejection becomes an Err, as the header promises. */
async function settle(title: string, handler: CommandHandler): Promise<Result<void>> {
	try {
		return await handler();
	} catch (cause) {
		return err(appError("command_failed", `${title} failed.`, cause));
	}
}

export class CommandRunner {
	readonly #deps: CommandRunnerDeps;
	/** A command already running answers later calls with the same promise, so it runs once. */
	readonly #running = createSingleFlight<CommandId>();

	constructor(deps: CommandRunnerDeps) {
		this.#deps = deps;
	}

	/** Backs `Actions.app.runCommand`. */
	run(id: string): Promise<Result<void>> {
		const def = getCommand(id);
		if (def === undefined) {
			return Promise.resolve(err(appError("command_unknown", `No command named ${id}.`)));
		}
		const commandId = def.id as CommandId;
		const handler = this.#deps.handlers()[commandId];
		if (handler === undefined) {
			return Promise.resolve(
				err(appError("command_unavailable", `${def.title} is not available yet.`)),
			);
		}
		if (!this.isEnabled(id)) {
			return Promise.resolve(
				err(appError("command_disabled", `${def.title} is not available now.`)),
			);
		}
		return this.#running.run(commandId, () => settle(def.title, handler));
	}

	/** Backs `useCommands`' enabled flag. */
	isEnabled(id: string): boolean {
		const def = getCommand(id);
		if (def === undefined) return false;
		const requirement = commandRequirement(def.id);
		if (requirement === null) return true;
		return this.#deps.context()[requirement];
	}
}

/** Builds the real handler table from the services. The table is where each id meets its service. */
export function createCommandHandlers(
	services: CommandServices,
	ports: CommandPorts = {},
): CommandHandlers {
	const handlers: CommandHandlers = {
		"app.checkForUpdates": () => services.updates.check(),
		"app.openSidecarLogs": () => services.system.openSidecarLogs(),
		"app.openLogViewer": () => services.system.openAppLogs(),
	};
	const toggleInspector = ports.toggleInspector;
	if (toggleInspector !== undefined) {
		handlers["app.openDebugTools"] = async () => {
			try {
				await toggleInspector();
				return ok(undefined);
			} catch (cause) {
				return err(
					appError("debug_tools_failed", "The developer tools could not be opened.", cause),
				);
			}
		};
	}
	const pickFolder = ports.pickFolder;
	if (pickFolder !== undefined) {
		handlers["project.add"] = async () => {
			const folder = await pickFolder("Add a project");
			if (folder === null) return ok(undefined);
			const added = await services.repo.addLocal(folder);
			return added.ok ? ok(undefined) : added;
		};
	}
	return handlers;
}
