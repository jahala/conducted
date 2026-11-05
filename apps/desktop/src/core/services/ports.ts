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
 * Detection uses `lsof` through the shell (the platform has no port probe), with a 10 second
 * timeout. Port 22 stays reserved for SSH: blocks start at 55000, so no block can hold it.
 * Each `lsof` scan goes through one runner that treats exit 1 (nothing matched) as an empty list
 * and any other failure as `ports_unavailable` naming what could not be read.
 * Test first: allocatePort with 55000 and 55010 taken returns 55020.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import type { Platform } from "../../platform/platform.ts";
import { createKeyedQueue } from "../async/serial-queue.ts";
import type { Repositories } from "../db/repositories.ts";

export const PORT_BASE = 55_000;
export const PORT_BLOCK_SIZE = 10;
export const PORT_MAX = 65_000;

/**
 * The first block start (55000, 55010, ...) that is not in `taken`. `taken` holds block starts.
 * Every block lies between 55000 and 65000, so the SSH port (22) is never given out.
 */
export function allocatePort(taken: ReadonlySet<number>): Result<number> {
	for (let port = PORT_BASE; port + PORT_BLOCK_SIZE <= PORT_MAX; port += PORT_BLOCK_SIZE) {
		if (!taken.has(port)) return ok(port);
	}
	return err(appError("ports_exhausted", "All workspace port blocks are in use."));
}

/** Replaces `$PORT`, `${PORT}`, `$CONDUCTED_PORT` and `${CONDUCTED_PORT}` in a template. */
export function expandPreviewUrl(template: string, port: number): Result<string> {
	const withPort = template.replace(
		/\$\{(?:CONDUCTED_PORT|PORT)\}|\$(?:CONDUCTED_PORT|PORT)\b/g,
		String(port),
	);
	const leftover = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.exec(withPort);
	return leftover
		? err(appError("preview_url_invalid", `Unknown variable ${leftover[0]} in the preview URL.`))
		: ok(withPort);
}

export interface ListeningPort {
	port: number;
	pid: number;
	command: string;
	/** The macOS application that owns the process, such as a browser or Electron app. */
	appName: string | null;
}

export interface PortServiceDeps {
	platform: Pick<Platform, "shell">;
	repos: Pick<Repositories, "workspaces">;
}

const LSOF_TIMEOUT_MS = 10_000;

interface ListeningEntry {
	port: number;
	pid: number;
	command: string;
}

/** Parses `lsof -F pcn` output into one entry per listening port. */
function parseListening(output: string): ListeningEntry[] {
	const entries: ListeningEntry[] = [];
	let pid = 0;
	let command = "";
	for (const line of output.split("\n")) {
		if (line === "") continue;
		const field = line.charAt(0);
		const value = line.slice(1);
		if (field === "p") {
			const parsed = Number(value);
			if (Number.isInteger(parsed) && parsed > 0) pid = parsed;
		} else if (field === "c") {
			command = value;
		} else if (field === "n") {
			const match = /:(\d+)$/.exec(value);
			if (match === null || pid === 0) continue;
			const port = Number(match[1]);
			if (!Number.isInteger(port) || port <= 0 || port > 65_535) continue;
			entries.push({ port, pid, command });
		}
	}
	return entries;
}

/** Parses `lsof -F pn` output into pid to path, for a working folder or an executable. */
function parsePidPaths(output: string): Map<number, string> {
	const cwds = new Map<number, string>();
	let pid = 0;
	for (const line of output.split("\n")) {
		if (line === "") continue;
		const field = line.charAt(0);
		const value = line.slice(1);
		if (field === "p") {
			const parsed = Number(value);
			if (Number.isInteger(parsed) && parsed > 0) pid = parsed;
		} else if (field === "n" && pid !== 0) {
			cwds.set(pid, value);
		}
	}
	return cwds;
}

/** The app bundle name in an executable path, or null for a plain process. */
function appNameFor(path: string): string | null {
	const match = /\/([^/]+)\.app\/Contents\/MacOS\//.exec(path);
	return match?.[1] ?? null;
}

/** True when `folder` is `root` or sits inside it. */
function isInside(folder: string, root: string): boolean {
	const clean = (value: string) => value.replace(/\/+$/, "");
	if (clean(folder) === clean(root)) return true;
	return clean(folder).startsWith(`${clean(root)}/`);
}

export class PortService {
	readonly #deps: PortServiceDeps;
	/** One allocation at a time, so two workspaces never pick the same block. */
	readonly #allocations = createKeyedQueue();

	constructor(deps: PortServiceDeps) {
		this.#deps = deps;
	}

	/** Picks a free block using the ports of all workspaces in the database. */
	allocateForNewWorkspace(): Promise<Result<number>> {
		return this.#allocations.run("allocate", async () => {
			const stored = await this.#deps.repos.workspaces.listPorts();
			if (!stored.ok) return stored;
			const listening = await this.#listening();
			if (!listening.ok) return listening;
			const taken = new Set(stored.value);
			// A block is skipped only when its first port is already busy, as the research says.
			for (const entry of listening.value) taken.add(entry.port);
			return allocatePort(taken);
		});
	}

	/** Lists TCP ports in LISTEN state for processes whose folder is inside the workspace. */
	async listListening(
		_workspaceId: WorkspaceId,
		workspacePath: string,
	): Promise<Result<ListeningPort[]>> {
		const listening = await this.#listening();
		if (!listening.ok) return listening;
		const cwds = await this.#cwds();
		if (!cwds.ok) return cwds;
		const apps = await this.#executablePaths();
		if (!apps.ok) return apps;
		const seen = new Set<string>();
		const result: ListeningPort[] = [];
		for (const entry of listening.value) {
			if (!isInside(cwds.value.get(entry.pid) ?? "", workspacePath)) continue;
			const key = `${entry.pid}:${entry.port}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const path = apps.value.get(entry.pid) ?? "";
			result.push({
				port: entry.port,
				pid: entry.pid,
				command: entry.command,
				appName: appNameFor(path),
			});
		}
		result.sort((left, right) => left.port - right.port);
		return ok(result);
	}

	#listening(): Promise<Result<ListeningEntry[]>> {
		return this.#runLsof(
			["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"],
			"The listening ports",
			parseListening,
		);
	}

	#cwds(): Promise<Result<Map<number, string>>> {
		return this.#runLsof(
			["-nP", "-a", "-d", "cwd", "-F", "pn"],
			"The process folders",
			parsePidPaths,
		);
	}

	#executablePaths(): Promise<Result<Map<number, string>>> {
		return this.#runLsof(
			["-nP", "-a", "-d", "txt", "-F", "pn"],
			"The process paths",
			parsePidPaths,
		);
	}

	/**
	 * Runs one `lsof` scan with the 10 second timeout and parses its output. lsof exits 1 when
	 * nothing matches; that is an empty result, not a failure. Any other exit is
	 * `ports_unavailable`, naming `what` could not be read.
	 */
	async #runLsof<T>(
		args: string[],
		what: string,
		parse: (stdout: string) => T,
	): Promise<Result<T>> {
		const run = await this.#deps.platform.shell.run({
			program: "lsof",
			args,
			cwd: "/",
			timeoutMs: LSOF_TIMEOUT_MS,
		});
		if (!run.ok) return run;
		if (run.value.exitCode !== 0 && run.value.exitCode !== 1) {
			const detail = run.value.stderr.trim() || `lsof exited ${run.value.exitCode}`;
			return err(appError("ports_unavailable", `${what} could not be read: ${detail}`));
		}
		return ok(parse(run.value.stdout));
	}
}
