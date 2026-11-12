/**
 * @feature catalogue The outside world one catalogue state runs in
 * Owns: building the in-memory Platform over a real SQLite with a fixed clock and counting ids, the
 * repositories the seeds write through, the scripted shell answers (with the git repositories they
 * describe), the pictures a state gives its image files, and the scripted sidecar that answers the app's requests and delivers the lines a state
 * needs.
 * Behaviour: not applicable, a development tool. The memory Platform's controls (platform/memory.ts) are
 * the same ones the tests script; nothing here changes what the app does with an answer.
 * Our design choice: a request nobody scripted gets a JSON-RPC error that names the method, and a shell
 * command nobody scripted gets the memory Platform's own `shell_unscripted` error. Both are logged to the
 * browser console, so a screen that shows an error state says why.
 * Must handle: the same seed gives the same screen on every run (no real time, no random ids); a reply is
 * delivered after the request was sent, as a real sidecar's would be.
 * Test first: not applicable; the screenshot run opens every state on it.
 */
import type {
	AgentInstall,
	AppToSidecarRequest,
	appToSidecarRequests,
	ModelInfo,
	ParamsOf,
	ResultOf,
} from "@conducted/protocol";
import type { Clock, IdSource } from "@conducted/shared";
import { programsBinDir } from "../core/app-paths.ts";
import { createRepositories, type Repositories } from "../core/db/repositories.ts";
import { createMemoryPlatform, type MemoryPlatform, type ShellScript } from "../platform/memory.ts";
import type { Database } from "../platform/platform.ts";
import { createTestIds } from "../test/ids.ts";
import { type ScriptedRepo, scriptRepo } from "./git-repo.ts";
import { CATALOGUE_NOW } from "./time.ts";

/** The home folder of the catalogue's made-up Mac user. */
export const HOME = "/Users/sam";

type Requests = typeof appToSidecarRequests;

/** Answers for requests the app sends the sidecar, by method. A method left out goes to the next. */
export type SidecarAnswers = {
	[M in AppToSidecarRequest]?: (params: ParamsOf<Requests[M]>) => ResultOf<Requests[M]>;
};

interface RpcMessage {
	jsonrpc: "2.0";
	id?: number | string;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code: number; message: string };
}

export interface World {
	clock: Clock;
	ids: IdSource;
	memory: MemoryPlatform;
	repositories: Repositories;
	/** Adds shell answers. A later script is tried first. */
	scriptShell(script: ShellScript): void;
	/**
	 * Scripts git for one folder from its description (git-repo.ts) and keeps the description, so a
	 * tool can build the same repository on a real disk (scripts/conductor-reference/world-disk.ts).
	 */
	plantRepo(repo: ScriptedRepo): void;
	/** Every repository planted so far, in order. */
	readonly repos: readonly ScriptedRepo[];
	/** Adds sidecar answers. A later answer is tried first. */
	answerSidecar(answers: SidecarAnswers): void;
	/** Leaves every request for `method` unanswered, as a sidecar still working on it would. */
	holdSidecar(method: AppToSidecarRequest): void;
	/** Answers every request for `method` with an error. */
	failSidecar(method: AppToSidecarRequest): void;
	/** Delivers a notification from the sidecar to the app. */
	notify(method: string, params: unknown): void;
	/** Sends a request from the sidecar to the app, such as `requestInteraction`. */
	request(method: string, params: unknown): void;
	/**
	 * Gives the file at `path` a picture the browser can load, as the app's webview loads a real
	 * image. Every other file keeps its asset:// address, which the browser cannot open.
	 */
	showPicture(path: string, url: string): void;
}

/** The agents this Mac has: Claude Code and Codex, both installed and signed in. */
const AGENT_INSTALLS: AgentInstall[] = [
	{
		agent: "claude",
		installed: true,
		path: `${HOME}/Library/Application Support/Conducted/bin/claude`,
		source: "managed",
		version: "2.1.30",
		authenticated: true,
		authMethod: "claude.ai",
	},
	{
		agent: "codex",
		installed: true,
		path: `${HOME}/Library/Application Support/Conducted/bin/codex`,
		source: "managed",
		version: "0.98.0",
		authenticated: true,
		authMethod: "chatgpt",
	},
	// The sidecar lists every agent it knows, installed or not, so the Agents page has a tab for each,
	// as Conductor's capture shows Cursor and OpenCode beside Claude Code and Codex.
	// Not installed, so the model picker's states keep their two agents.
	{ agent: "cursor", installed: false },
	{ agent: "acp", acpAgent: "opencode", installed: false },
	{ agent: "acp", acpAgent: "pi", installed: false },
];

const model = (id: string, label: string, options: Partial<ModelInfo> = {}): ModelInfo => ({
	id,
	label,
	status: "picker",
	isNew: false,
	isDefault: false,
	efforts: ["low", "medium", "high"],
	defaultEffort: "high",
	effortAxis: "effort",
	liveEffortChange: true,
	supportsFastMode: false,
	contextWindowTokens: 200_000,
	...options,
});

/** The catalogue's model lists. The labels are sample data, not a claim about any provider's list. */
const MODELS: Record<string, ModelInfo[]> = {
	claude: [
		model("default", "Opus 4.7", {
			shortLabel: "Opus",
			isDefault: true,
			supportsFastMode: true,
			efforts: ["low", "medium", "high", "max", "ultracode"],
		}),
		model("sonnet", "Sonnet 4.6", { shortLabel: "Sonnet", contextWindowTokens: 1_000_000 }),
		model("haiku", "Haiku 4.5", { shortLabel: "Haiku", isNew: true }),
	],
	codex: [
		model("gpt-5.5", "GPT-5.5", { isDefault: true, effortAxis: "thinking" }),
		model("gpt-5.5-mini", "GPT-5.5 mini", { effortAxis: "thinking" }),
	],
};

/** What the scripted sidecar answers when no state says otherwise. */
const DEFAULT_ANSWERS: SidecarAnswers = {
	getAgentInstalls: () => ({ agents: AGENT_INSTALLS }),
	// The sidecar takes a message as a new turn; nothing replies unless a state delivers events.
	sendMessage: () => ({ deliveredAs: "new_turn" }),
	// The short agent run that names a new chat and its branch (D030).
	runUtilityPrompt: () => ({ text: "Add a health check route" }),
	listModels: ({ agent }) => ({ models: MODELS[agent] ?? [] }),
	listSlashCommands: () => ({
		commands: [
			{
				name: "review",
				description: "Review the current diff",
				source: "builtin",
				kind: "command",
			},
			{ name: "compact", description: "Summarise the chat", source: "builtin", kind: "command" },
		],
		fromCache: false,
	}),
	listMcpServers: () => ({ servers: [] }),
	listAgentProviders: () => ({ providers: [] }),
	getShellEnv: () => ({ shell: "/bin/zsh", path: "/opt/homebrew/bin:/usr/bin:/bin" }),
	getSessionStatus: () => ({ known: false }),
	getContextUsage: () => ({ usedTokens: 41_200, windowTokens: 200_000, rateLimits: [] }),
	warmAgent: () => ({}),
	resetAgent: () => ({}),
	setAutoApproveEdits: () => ({}),
	updateConfig: () => ({ applied: "live" }),
	getGoal: () => ({ goal: null }),
	listAcpConfigOptions: () => ({ options: [] }),
};

/**
 * Builds a fresh world over a freshly migrated database: the Platform over it, and empty scripts. The
 * caller opens the database (sqlite.ts in the browser), so Bun tools can build the same world.
 */
export function createWorld(database: Database): World {
	const clock: Clock = { now: () => CATALOGUE_NOW };
	const ids = createTestIds("c");
	const memory = createMemoryPlatform({
		clock,
		ids,
		database,
		version: "0.1.0",
		channel: "dev",
		home: HOME,
		appData: `${HOME}/Library/Application Support/Conducted`,
		temp: "/tmp/conducted",
	});
	// Seeds draw their own ids, so the app's first ids are the same whatever a state seeds.
	const repositories = createRepositories(database, { clock, ids: createTestIds("seed") });

	// The helper programs the program manager has downloaded (PLAT-35). A gh command runs only
	// from the manager's ready copy (D088), so the Checks tab has checks instead of a missing
	// program error.
	const binDir = programsBinDir(memory.platform.fs.paths);
	for (const program of ["gh", "watchexec"] as const) {
		const path = `${binDir}/${program}`;
		memory.controls.files.set(path, "");
		memory.controls.setProgramStatus({
			program,
			state: "ready",
			version: "test",
			bytesDownloaded: 0,
			bytesTotal: null,
			attempt: 0,
			nextAttemptAt: null,
			error: null,
			path,
		});
	}

	memory.controls.scriptShell((command) => {
		console.info("[catalogue] unscripted shell command:", command.program, command.args.join(" "));
		return null;
	});

	const answers: SidecarAnswers[] = [DEFAULT_ANSWERS];
	const held = new Map<string, "hold" | "fail">();
	const emit = (message: RpcMessage): void => {
		queueMicrotask(() => memory.controls.emitSidecarLine(JSON.stringify(message)));
	};
	const transport = memory.platform.sidecar;
	const send = transport.send.bind(transport);
	let nextRequestId = 1_000_000;
	transport.send = async (line) => {
		const sent = await send(line);
		const message = JSON.parse(line) as RpcMessage;
		if (message.method === undefined || message.id === undefined) return sent;
		const { id, method, params } = message;
		const mode = held.get(method);
		if (mode === "hold") return sent;
		if (mode === "fail") {
			emit({
				jsonrpc: "2.0",
				id,
				error: { code: -32000, message: `${method} failed: the agent program did not answer.` },
			});
			return sent;
		}
		for (const table of [...answers].reverse()) {
			const answer = table[method as AppToSidecarRequest] as
				| ((params: unknown) => unknown)
				| undefined;
			if (answer !== undefined) {
				// A flow can see that a request reached the sidecar, such as Create PR's chat message.
				if (method === "sendMessage") console.info("[catalogue] answered sidecar request:", method);
				emit({ jsonrpc: "2.0", id, result: answer(params) });
				return sent;
			}
		}
		console.info("[catalogue] unanswered sidecar request:", method);
		emit({
			jsonrpc: "2.0",
			id,
			error: { code: -32601, message: `The catalogue's sidecar does not answer ${method}.` },
		});
		return sent;
	};

	const pictures = new Map<string, string>();
	const fs = memory.platform.fs;
	const assetUrl = fs.assetUrl.bind(fs);
	fs.assetUrl = (path) => pictures.get(path) ?? assetUrl(path);

	const repos: ScriptedRepo[] = [];
	return {
		clock,
		ids,
		memory,
		repositories,
		scriptShell: (script) => memory.controls.scriptShell(script),
		plantRepo: (repo) => {
			repos.push(repo);
			memory.controls.scriptShell(scriptRepo(repo));
		},
		repos,
		answerSidecar: (answer) => answers.push(answer),
		holdSidecar: (method) => held.set(method, "hold"),
		failSidecar: (method) => held.set(method, "fail"),
		notify: (method, params) => emit({ jsonrpc: "2.0", method, params }),
		request: (method, params) => emit({ jsonrpc: "2.0", id: nextRequestId++, method, params }),
		showPicture: (path, url) => pictures.set(path, url),
	};
}
