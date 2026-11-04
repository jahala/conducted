/**
 * @feature RUN-03 One port per workspace, port detection and preview URLs
 * Owns: choosing the block of ports a workspace gets (exported as CONDUCTED_PORT), finding ports
 * that processes of a workspace listen on, and expanding the repo's preview URL template.
 * Behaviour: services-map.md 5A.3.1 (CONDUCTOR_PORT allocation: first block 55000, 10 ports per
 * workspace), 5A.3.2 (detecting listening ports), ui-map.md 3.7 (Open and Choose preview URL,
 * "Preview URLs" template with the port variable).
 * Must handle: two workspaces never share a block; a block stays with its workspace across
 * restarts; the first free block at or above 55000 is used, so a gap left by a deleted workspace
 * is reused; a template without the variable is used as written; a template with unknown
 * variables is returned as an error, never half expanded; ports that were not opened by this
 * workspace's processes are not shown for it.
 * Our design choice: Conductor keeps the port in memory, so numbers change after a restart. We
 * store it in `workspaces.port`, which the schema already requires, so the number is stable.
 * Detection uses `lsof` through the shell (the platform has no port probe).
 * Test first: allocatePort with 55000 and 55010 taken returns 55020.
 */
import {
	appError,
	err,
	notImplemented,
	ok,
	type Result,
	type WorkspaceId,
} from "@conducted/shared";
import type { Platform } from "../../platform/platform.ts";

export const PORT_BASE = 55_000;
export const PORT_BLOCK_SIZE = 10;
export const PORT_MAX = 65_000;

/** The first block start (55000, 55010, ...) that is not in `taken`. `taken` holds block starts. */
export function allocatePort(taken: ReadonlySet<number>): Result<number> {
	for (let port = PORT_BASE; port + PORT_BLOCK_SIZE <= PORT_MAX; port += PORT_BLOCK_SIZE) {
		if (!taken.has(port)) return ok(port);
	}
	return err(appError("ports_exhausted", "All workspace port blocks are in use."));
}

/** Replaces `$CONDUCTED_PORT` and `${CONDUCTED_PORT}` in a preview URL template. */
export function expandPreviewUrl(template: string, port: number): Result<string> {
	const withPort = template.replace(/\$\{CONDUCTED_PORT\}|\$CONDUCTED_PORT\b/g, String(port));
	const leftover = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.exec(withPort);
	return leftover
		? err(appError("preview_url_invalid", `Unknown variable ${leftover[0]} in the preview URL.`))
		: ok(withPort);
}

export interface ListeningPort {
	port: number;
	pid: number;
	command: string;
}

export interface PortServiceDeps {
	platform: Pick<Platform, "shell">;
}

export class PortService {
	readonly #deps: PortServiceDeps;

	constructor(deps: PortServiceDeps) {
		this.#deps = deps;
	}

	/** Picks a free block using the ports of all workspaces in the database. */
	allocateForNewWorkspace(): Promise<Result<number>> {
		void this.#deps;
		return notImplemented("RUN-03");
	}

	/** Lists TCP ports in LISTEN state for processes whose folder is inside the workspace. */
	listListening(
		_workspaceId: WorkspaceId,
		_workspacePath: string,
	): Promise<Result<ListeningPort[]>> {
		return notImplemented("RUN-03");
	}
}
