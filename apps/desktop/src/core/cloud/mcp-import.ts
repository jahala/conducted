/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Owns: the "Import from local" scan on the Cloud page: the remote MCP servers in this Mac's
 * agent config files, ready to be added to the user's cloud MCP servers.
 * Behaviour: ui-map.md 6 Organization ("Import from local", "Select MCP servers") and the scan
 * behind it in Conductor's bundle (renderApp, read 2026-11-07): Claude Code's `~/.claude.json`
 * (its own servers, each project's servers and each project's `.mcp.json`), Claude Code plugins
 * under `~/.claude/plugins`, Claude Desktop's `claude_desktop_config.json`, Cursor's
 * `~/.cursor/mcp.json` and each project's `.cursor/mcp.json`, OpenCode's
 * `~/.config/opencode/opencode.json` and each project's `opencode.json`, and Codex's
 * `~/.codex/config.toml`. Only remote HTTPS servers are offered; a stdio server, a plain-HTTP
 * server or an entry holding a `${...}` variable is counted and left out. Duplicates (same URL
 * and sorted headers) fold into one candidate with every source named.
 * Must handle: a missing file (nothing, never an error), an unreadable or unparsable one (its
 * source is named and the rest still read), a header value that is not a string, and a Codex
 * entry whose credential comes from the environment (Conductor's page cannot carry it).
 * Our design choice: the scan runs on the Mac over the Platform's file commands (D018's Host
 * rule is about workspaces, and these files are this Mac's). Cursor, OpenCode and Codex folders
 * are registered read-only for the scan, because they are outside the app's default file scope.
 * Test first: offers the remote HTTPS servers of every local agent, and folds duplicates together.
 */

import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import type { FileStat } from "../../platform/platform.ts";
import type { TomlCodec } from "../services/settings.ts";

/** One remote MCP server the scan found. */
export interface ImportedMcpServer {
	name: string;
	url: string;
	headers: Record<string, string>;
	/** The config files' agents that held it, by their labels. */
	sources: string[];
}

/** What "Import from local" found. */
export interface LocalMcpScan {
	candidates: ImportedMcpServer[];
	/** The sources that were there but could not be read or parsed. */
	unreadableSources: string[];
	/** Entries that were not a remote HTTPS server. */
	skippedCount: number;
}

/** The file commands the scan uses; all of them are the Platform's own. */
export interface LocalFileSystem {
	readText(path: string): Promise<Result<string>>;
	exists(path: string): Promise<boolean>;
	readDir(path: string): Promise<Result<FileStat[]>>;
	registerRoot(path: string): Promise<Result<void>>;
}

export interface CloudMcpImportDeps {
	files: LocalFileSystem;
	toml: Pick<TomlCodec, "parse">;
	home: string;
	/** The main checkout of every project, for the project-level config files. */
	repoRoots: () => readonly string[];
}

export interface CloudMcpImport {
	scan(): Promise<Result<LocalMcpScan, AppError>>;
}

/** Joins path parts with one separator, as the POSIX paths the Platform's file commands use. */
function joinPath(...parts: string[]): string {
	const joined = parts.filter((part) => part !== "").join("/");
	return joined.replace(/\/+/g, "/");
}

/** The last part of a path. */
function baseName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

/** A header name the HTTP specification allows (an RFC 9110 token). */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** A server name: 1 to 64 letters, numbers, hyphens or underscores (Conductor's rule). */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED_NAMES = new Set(["conductor", "conducted"]);

/** The tools whose local config files the scan reads, with the labels it shows. */
const SOURCES = {
	claude: "Claude Code",
	claudePlugins: "Claude Code plugins",
	claudeDesktop: "Claude Desktop",
	cursor: "Cursor",
	opencode: "OpenCode",
	codex: "Codex",
} as const;

/** Conductor's own words for header text it cannot read (renderApp `Inr`). */
const HEADER_LINES_MESSAGE = 'Enter headers as one "Header-Name: value" per line';

/**
 * The headers a user typed for one server: one `Name: value` per line. A blank line is ignored;
 * a line without a name and a value, or with a name that is not a header, refuses the whole text.
 */
export function headerLines(
	text: string,
): { ok: true; headers: Record<string, string> } | { ok: false; message: string } {
	const headers: Record<string, string> = {};
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line === "") continue;
		const colon = line.indexOf(":");
		if (colon < 1) return { ok: false, message: HEADER_LINES_MESSAGE };
		const name = line.slice(0, colon).trim();
		const value = line.slice(colon + 1).trim();
		if (!HEADER_NAME.test(name) || value === "") {
			return { ok: false, message: HEADER_LINES_MESSAGE };
		}
		headers[name] = value;
	}
	return { ok: true, headers };
}

/** A server name the Worker accepts, made from `base`, and unique among `taken`. */
export function uniqueMcpServerName(base: string, taken: readonly string[]): string {
	let name = base
		.replace(/[^A-Za-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
	if (name === "") name = "imported-mcp";
	if (!SERVER_NAME.test(name) || RESERVED_NAMES.has(name.toLowerCase())) {
		name = `mcp-${name}`.slice(0, 64);
	}
	if (!SERVER_NAME.test(name)) name = "imported-mcp";
	let unique = name;
	let attempt = 2;
	while (taken.includes(unique) || RESERVED_NAMES.has(unique.toLowerCase())) {
		unique = `${name.slice(0, 60)}-${attempt}`;
		attempt += 1;
	}
	return unique;
}

/** The URL a candidate is compared by, so one server found twice is one candidate. */
function urlKey(raw: string): string | null {
	try {
		return new URL(raw).toString();
	} catch {
		return null;
	}
}

/** A raw config entry turned into a candidate, or null when it is not a remote HTTPS server. */
function remoteServer(
	name: string,
	raw: unknown,
): { name: string; url: string; headers: Record<string, string> } | null {
	if (typeof raw !== "object" || raw === null) return null;
	const entry = raw as { url?: unknown; headers?: unknown; http_headers?: unknown };
	const url = typeof entry.url === "string" ? entry.url : null;
	if (url === null) return null;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== "https:") return null;
	const headersValue = entry.headers ?? entry.http_headers;
	const headers: Record<string, string> = {};
	if (headersValue !== undefined) {
		if (typeof headersValue !== "object" || headersValue === null) return null;
		for (const [header, value] of Object.entries(headersValue)) {
			if (typeof value !== "string") return null;
			headers[header] = value;
		}
	}
	if (url.includes("${") || Object.values(headers).some((value) => value.includes("${"))) {
		return null;
	}
	return { name, url, headers };
}

/** The name of the file a project keeps its Claude Code servers in. */
const CLAUDE_PROJECT_FILE = ".mcp.json";

/**
 * The scan over this Mac. Every source is read on its own: one unreadable file names its source
 * and leaves the others' candidates in place.
 */
export function createCloudMcpImport(deps: CloudMcpImportDeps): CloudMcpImport {
	const found = new Map<string, ImportedMcpServer>();
	const unreadable = new Set<string>();
	let skipped = 0;

	const add = (label: string, servers: unknown): void => {
		if (typeof servers !== "object" || servers === null) return;
		for (const [name, raw] of Object.entries(servers)) {
			if (typeof name !== "string" || !SERVER_NAME.test(name)) {
				skipped += 1;
				continue;
			}
			const server = remoteServer(name, raw);
			if (server === null) {
				skipped += 1;
				continue;
			}
			const key = `${urlKey(server.url) ?? server.url}\u0000${JSON.stringify(
				Object.entries(server.headers).sort(([left], [right]) => left.localeCompare(right)),
			)}`;
			const existing = found.get(key);
			if (existing !== undefined) {
				if (!existing.sources.includes(label)) existing.sources.push(label);
				continue;
			}
			found.set(key, { ...server, sources: [label] });
		}
	};

	/** Reads a text file; null when it is not there, and an unreadable source is named. */
	const read = async (label: string, file: string): Promise<string | null> => {
		const result = await deps.files.readText(file);
		if (!result.ok) {
			if (result.error.code !== "fs_not_found") unreadable.add(label);
			return null;
		}
		if (result.value.trim() === "") return null;
		return result.value;
	};

	const readJson = async (label: string, file: string): Promise<unknown | null> => {
		const text = await read(label, file);
		if (text === null) return null;
		try {
			return JSON.parse(text);
		} catch {
			unreadable.add(label);
			return null;
		}
	};

	/** Registers a folder outside the app's default file scope, so the scan can read it. */
	const reach = async (folder: string): Promise<void> => {
		await deps.files.registerRoot(folder);
	};

	/** The servers of one JSON config, under the key the tool writes them in. */
	const readServers = async (label: string, file: string, key: string): Promise<void> => {
		const parsed = await readJson(label, file);
		if (parsed === null || typeof parsed !== "object" || parsed === null) return;
		add(label, (parsed as Record<string, unknown>)[key]);
	};

	/** Claude Code's own servers, each project's servers, and each project's `.mcp.json`. */
	const readClaudeCode = async (): Promise<void> => {
		const file = joinPath(deps.home, ".claude.json");
		const parsed = await readJson(SOURCES.claude, file);
		if (parsed === null || typeof parsed !== "object" || parsed === null) return;
		const config = parsed as Record<string, unknown>;
		add(SOURCES.claude, config.mcpServers);
		const projects = config.projects;
		if (typeof projects !== "object" || projects === null) return;
		for (const [root, value] of Object.entries(projects)) {
			if (typeof value === "object" && value !== null) {
				const project = value as Record<string, unknown>;
				add(SOURCES.claude, project.mcpServers);
			}
			const projectFile = joinPath(root, CLAUDE_PROJECT_FILE);
			const projectConfig = await readJson(SOURCES.claude, projectFile);
			if (projectConfig !== null && typeof projectConfig === "object" && projectConfig !== null) {
				add(SOURCES.claude, (projectConfig as Record<string, unknown>).mcpServers);
			}
		}
	};

	/** Every `.mcp.json` and `.claude-plugin/plugin.json` below `~/.claude/plugins`. */
	const readClaudePlugins = async (): Promise<void> => {
		const root = joinPath(deps.home, ".claude", "plugins");
		const files: string[] = [];
		const walk = async (folder: string, depth: number): Promise<void> => {
			if (depth > 5) return;
			const listed = await deps.files.readDir(folder);
			if (!listed.ok) return;
			for (const entry of listed.value) {
				const name = baseName(entry.path);
				if (entry.isDirectory) {
					if (name === ".git" || name === "node_modules") continue;
					await walk(entry.path, depth + 1);
				} else if (
					name === CLAUDE_PROJECT_FILE ||
					(name === "plugin.json" && baseName(folder) === ".claude-plugin")
				) {
					files.push(entry.path);
				}
			}
		};
		await walk(root, 0);
		for (const file of files) {
			const parsed = await readJson(SOURCES.claudePlugins, file);
			if (parsed !== null && typeof parsed === "object" && parsed !== null) {
				add(SOURCES.claudePlugins, (parsed as Record<string, unknown>).mcpServers);
			}
		}
	};

	const readCodex = async (): Promise<void> => {
		const folder = joinPath(deps.home, ".codex");
		await reach(folder);
		const text = await read(SOURCES.codex, joinPath(folder, "config.toml"));
		if (text === null) return;
		const parsed = deps.toml.parse(text);
		if (!parsed.ok) {
			unreadable.add(SOURCES.codex);
			return;
		}
		const servers = parsed.value.mcp_servers;
		if (typeof servers !== "object" || servers === null) return;
		for (const [name, raw] of Object.entries(servers)) {
			if (typeof raw !== "object" || raw === null) {
				skipped += 1;
				continue;
			}
			const entry = raw as Record<string, unknown>;
			if (entry.bearer_token_env_var !== undefined || entry.env_http_headers !== undefined) {
				skipped += 1;
				continue;
			}
			add(SOURCES.codex, { [name]: entry });
		}
	};

	return {
		async scan(): Promise<Result<LocalMcpScan, AppError>> {
			found.clear();
			unreadable.clear();
			skipped = 0;
			try {
				await readClaudeCode();
				await readClaudePlugins();
				await readServers(
					SOURCES.claudeDesktop,
					joinPath(
						deps.home,
						"Library",
						"Application Support",
						"Claude",
						"claude_desktop_config.json",
					),
					"mcpServers",
				);
				const cursorFolder = joinPath(deps.home, ".cursor");
				await reach(cursorFolder);
				await readServers(SOURCES.cursor, joinPath(cursorFolder, "mcp.json"), "mcpServers");
				const openCodeFolder = joinPath(deps.home, ".config", "opencode");
				await reach(openCodeFolder);
				await readServers(SOURCES.opencode, joinPath(openCodeFolder, "opencode.json"), "mcp");
				for (const root of deps.repoRoots()) {
					await reach(root);
					await readServers(SOURCES.cursor, joinPath(root, ".cursor", "mcp.json"), "mcpServers");
					await readServers(SOURCES.opencode, joinPath(root, "opencode.json"), "mcp");
					await readServers(SOURCES.claude, joinPath(root, CLAUDE_PROJECT_FILE), "mcpServers");
				}
				await readCodex();
			} catch (cause) {
				return err(
					appError(
						"cloud_mcp_scan_failed",
						"Couldn't read local MCP configs",
						cause instanceof Error ? { message: cause.message } : null,
					),
				);
			}
			const candidates = [...found.values()]
				.map((candidate) => ({ ...candidate, sources: [...candidate.sources].sort() }))
				.sort((left, right) => left.name.localeCompare(right.name));
			return ok({ candidates, unreadableSources: [...unreadable].sort(), skippedCount: skipped });
		},
	};
}
