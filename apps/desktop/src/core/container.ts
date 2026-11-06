/**
 * @feature APP-01 Composition root: builds every service from a Platform
 * Owns: constructing the repositories, git runner, sidecar tunnel and services in dependency
 * order, wiring them to each other through narrow ports, and starting them in the right order.
 * Behaviour: services-map.md 1.1 to 1.4 (three layers of wiring, the container, per-service
 * dependency objects), part 6 (startup order: settings first, sessions reset to idle before any
 * screen sees them, the sidecar after the stores exist, a newer database blocks everything).
 * Must handle: construction does no I/O; services that need each other are wired through
 * closures that read the other service when called, so no construction order creates a cycle;
 * `start` runs the steps in order, stops at the first fatal failure and returns it, and records
 * non-fatal failures (no GitHub access, a failed Spotlight heal) as warnings; the sidecar not
 * starting is fatal, because without it no chat can run (the failed state carries the sidecar log
 * path in `app/startup.ts`); `start` runs once (a second call returns the first result); after the
 * steps it wires the dock badge, notification clicks, the hourly update check, the keep-awake scan
 * and its 10-second timer, the quit guard and the Spotlight heal; a quit (asked for, or confirmed
 * while agents work) runs `stop` first and then quits, because the Rust shell exits at once; editor
 * drafts of a workspace that left the store are dropped; deep links have one subscriber,
 * the command dispatcher (NAV-14), which is mounted with the app root and hands them to NAV-17's
 * opener, so this file does not listen for them a second time; `stop` removes those listeners, stops the settings reload
 * listener and its timer, stops the update and keep-awake timers, cancels `caffeinate`, disposes
 * the repo service, stops every git poll and branch watcher, writes composer drafts still waiting
 * for their debounce, kills terminals and runs, waits for chat events that are being stored, and
 * detaches from the sidecar; every stop step runs even when an earlier one
 * fails (the failure is logged), and a `stop` that comes during `start` lets the running
 * step finish, ends the start before it wires anything new, and then tears down; the
 * database-version check happens before `start` (see the proposed `Platform.app.dbVersionWarning`);
 * after the sidecar reconnects, chats are resumed (after the run already in flight, if any).
 * Our design choice: one `createContainer` function with every dependency as a parameter. There
 * is no module-level singleton, so tests build as many containers as they like. The timers here
 * are the only global clock use in core; they sit in the root, the edge of the program.
 * Test first: createContainer returns a container whose `services` has every service named in
 * the `Services` interface, and builds without calling any placeholder.
 */

import {
	AGENT_PROVIDER_TABLE,
	type AgentLaunch,
	idleLiveState,
	signInEnvVars,
} from "@conducted/protocol";
import {
	type AcpAgent,
	type AgentKind,
	appError,
	type Clock,
	err,
	type IdSource,
	messageOf,
	ok,
	type RepoId,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import type { Platform } from "../platform/platform.ts";
import { createActions } from "./actions.ts";
import type { Actions } from "./api.ts";
import {
	checkpointerScript,
	gitBusyCheckScript,
	programsBinDir,
	spotlighterScript,
} from "./app-paths.ts";
import { fireAndForget } from "./async/fire-and-forget.ts";
import { DEFAULT_LIFETIME_LIMITS, lifetimeJobResult, runDataLifetimeJob } from "./db/lifetime.ts";
import { runStartupRepair } from "./db/repair.ts";
import { createRepositories } from "./db/repositories.ts";
import { KeyedMutex } from "./git/locks.ts";
import { ShellGitRunner } from "./git/runner.ts";
import { createLookups, defaultSessionConfig, type Lookups } from "./lookups.ts";
import type { DiagnosticsCapture, Session } from "./model.ts";
import { AgentCatalogService, agentKey } from "./services/agent-catalog.ts";
import { ChatTitleService } from "./services/chat-titles.ts";
import { CHECKPOINT_PRUNE_AFTER_DAYS, CheckpointService } from "./services/checkpoint.ts";
import { CommandRunner, createCommandHandlers } from "./services/command-runner.ts";
import { ComposerService } from "./services/composer.ts";
import { ContextWindowService } from "./services/context-windows.ts";
import { FavoriteModelsService } from "./services/favorite-models.ts";
import { FileDiffService } from "./services/file-diff.ts";
import { FollowUpQueue } from "./services/follow-up-queue.ts";
import { GitService } from "./services/git.ts";
import { connectGitCache, createGitCache, type GitCache } from "./services/git-cache.ts";
import { GithubService } from "./services/github.ts";
import { GraphiteService } from "./services/graphite.ts";
import {
	KEEP_AWAKE_SCAN_MS,
	KEEP_AWAKE_SETTING_KEY,
	KeepAwakeService,
	REMOTE_KEEP_AWAKE_SETTING_KEY,
} from "./services/keep-awake.ts";
import { createLinearHttp, LinearService } from "./services/linear.ts";
import { LocalGitForge } from "./services/local-git-forge.ts";
import { McpService } from "./services/mcp.ts";
import { buildDeepLink, NotificationService, type SoundPlayer } from "./services/notifications.ts";
import { PortService } from "./services/ports.ts";
import { RepoService } from "./services/repo.ts";
import { ReviewService } from "./services/review.ts";
import { RunScriptsService } from "./services/run-scripts.ts";
import { SectionsService } from "./services/sections.ts";
import { SessionsService } from "./services/sessions.ts";
import { SettingsService, type TomlCodec } from "./services/settings.ts";
import { SpotlightService } from "./services/spotlight.ts";
import { SystemService } from "./services/system.ts";
import {
	DEFAULT_TERMINAL_OUTPUT_LINES,
	NO_TERMINAL_OUTPUT,
	TerminalsService,
	terminalLimit,
} from "./services/terminals.ts";
import { UPDATE_CHECK_INTERVAL_MS, UpdatesService } from "./services/updates.ts";
import { type PlaceNames, WorkspaceService } from "./services/workspace.ts";
import { WorkspaceFilesService } from "./services/workspace-files.ts";
import { chosenAgentPrograms, followAgentPrograms } from "./sidecar/agent-programs.ts";
import {
	createSidecarNotificationHandlers,
	createSidecarRequestHandlers,
	type SidecarHandlerPorts,
} from "./sidecar/handlers.ts";
import { EventIngest } from "./sidecar/ingest.ts";
import { SessionResume } from "./sidecar/resume.ts";
import { type SidecarClient, SidecarTunnel } from "./sidecar/tunnel.ts";

/**
 * How long a quit waits for the container to stop before the app quits anyway. Our choice (D064):
 * the research gives no limit, and a hung step must not leave Cmd+Q doing nothing.
 */
export const QUIT_STOP_LIMIT_MS = 5_000;

export interface ContainerInputs {
	platform: Platform;
	clock: Clock;
	ids: IdSource;
	/** A TOML parser and writer. */
	toml: TomlCodec;
	placeNames: PlaceNames;
	sound: SoundPlayer;
	/** Whether the window has focus. Read when a notification is considered. */
	windowFocused: () => boolean;
	/** Opens a notification click or deep link in the app. The app entry passes its router opener. */
	openLink?: (url: string) => void;
	/**
	 * Writes the redacted diagnostics report for a new chat and returns its path (APP-03). The app
	 * entry passes the writer, because redaction lives with the diagnostics screen.
	 */
	writeDiagnosticsReport?: (
		capture: DiagnosticsCapture,
		fileName: string,
	) => Promise<Result<string>>;
}

export interface Services {
	settings: SettingsService;
	repo: RepoService;
	workspace: WorkspaceService;
	sections: SectionsService;
	favoriteModels: FavoriteModelsService;
	contextWindows: ContextWindowService;
	agentCatalog: AgentCatalogService;
	mcp: McpService;
	linear: LinearService;
	git: GitService;
	graphite: GraphiteService;
	gitCache: GitCache;
	github: GithubService;
	localGitForge: LocalGitForge;
	checkpoint: CheckpointService;
	fileDiff: FileDiffService;
	workspaceFiles: WorkspaceFilesService;
	review: ReviewService;
	sessions: SessionsService;
	followUpQueue: FollowUpQueue;
	composer: ComposerService;
	runScripts: RunScriptsService;
	spotlight: SpotlightService;
	ports: PortService;
	terminals: TerminalsService;
	notifications: NotificationService;
	updates: UpdatesService;
	system: SystemService;
	commands: CommandRunner;
}

export interface StartReport {
	/** Non-fatal problems met while starting, for the diagnostics page. */
	warnings: { step: string; message: string }[];
}

/** Reported before each startup step runs, so the app can draw progress. */
export interface StartProgress {
	step: string;
	phase: "settings" | "services" | "sidecar";
}

export interface Container {
	readonly platform: Platform;
	readonly services: Services;
	readonly actions: Actions;
	readonly lookups: Lookups;
	readonly sidecar: SidecarTunnel;
	/**
	 * Runs the startup sequence once. The database-version check must have passed already. A
	 * second call returns the first call's result and ignores its own `onProgress`.
	 */
	start(onProgress?: (progress: StartProgress) => void): Promise<Result<StartReport>>;
	/**
	 * Stops listeners and timers, writes pending composer drafts, kills terminals and runs, lets
	 * stored-event writes finish and detaches from the sidecar. Every step runs; a step that fails
	 * is logged. Safe to call twice. A quit request runs it before the app quits.
	 */
	stop(): Promise<void>;
}

interface StartStep {
	name: string;
	phase: StartProgress["phase"];
	fatal: boolean;
	run: () => Promise<Result<unknown>>;
}

/** What archive-on-merge needs to archive and, when that fails, tell the user why. */
export interface ArchiveOnMergedPorts {
	archive: (workspaceId: WorkspaceId, prNumber: number) => Promise<Result<void>>;
	notify: (input: { title: string; body: string; deepLink?: string }) => Promise<void>;
	/** Reports a failure of the notification itself, so it is not dropped. */
	reportError: (message: string) => void;
}

/**
 * Handles a merged pull request without waiting for the poll. A failed archive (a running chat, a
 * corrupted workspace, a snapshot or script failure) reaches the user as a notification; the
 * Result is never dropped.
 */
export function createArchiveOnMerged(
	ports: ArchiveOnMergedPorts,
): (workspaceId: WorkspaceId, prNumber: number) => void {
	return (workspaceId, prNumber) => {
		fireAndForget(
			async () => {
				const archived = await ports.archive(workspaceId, prNumber);
				if (archived.ok) return;
				await ports.notify({
					title: "Couldn't archive the workspace",
					body: archived.error.message,
					deepLink: buildDeepLink(workspaceId, null),
				});
			},
			(error) => ports.reportError(`Could not report a failed archive: ${String(error)}`),
		);
	};
}

/** The setting that holds the program the user chose for an agent, when the agent has one. */
function programPathSetting(
	agent: AgentKind,
	acpAgent: AcpAgent | undefined,
): "claude_executable_path" | "codex_executable_path" | "opencode_executable_path" | null {
	if (agent === "claude") return "claude_executable_path";
	if (agent === "codex") return "codex_executable_path";
	if (agent === "acp" && acpAgent === "opencode") return "opencode_executable_path";
	return null;
}

/**
 * Whether a stored provider key goes into an agent's launch (SET-09, D033). Only the credential of the
 * chosen sign-in reaches the agent: the keys of its provider that the agent-provider table lists for
 * that sign-in. Claude's standard sign-in (an empty `claude_provider`) is the Claude Code
 * subscription, so its API key stays out; Codex's is the ChatGPT account, so the OpenAI API key stays
 * out. An agent without a provider setting takes its one sign-in. OpenCode and Pi choose a provider in
 * their own config, so every stored key may apply. A setting value the table does not list (set in a
 * settings file) takes the keys stored under a provider of that name.
 */
function launchTakesKey(
	agent: AgentKind,
	chosenProvider: string | undefined,
	key: { provider: string; envVar: string },
): boolean {
	const facts = AGENT_PROVIDER_TABLE[agent];
	if (facts.configProviders !== undefined) return true;
	const signIn =
		chosenProvider === undefined
			? facts.signIns[0]
			: facts.signIns.find((entry) => entry.launchProvider === chosenProvider);
	if (signIn === undefined) return key.provider.toLowerCase() === chosenProvider;
	return (
		key.provider.toLowerCase() === signIn.provider && signInEnvVars(signIn).includes(key.envVar)
	);
}

/** Builds everything. Does no I/O. */
export function createContainer(inputs: ContainerInputs): Container {
	const { platform, clock, ids } = inputs;
	const repositoryDeps = { clock, ids };
	const repositories = createRepositories(platform.db, repositoryDeps);
	const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
	const log = (level: "warn" | "info", message: string) => platform.app.writeLog(level, message);
	const gitRunner = new ShellGitRunner({
		shell: platform.shell,
		locks: new KeyedMutex(),
		programsBin: programsBinDir(platform.fs.paths),
		sleep,
		log,
	});
	const ready = <T>(result: Result<T>): Promise<Result<T>> => Promise.resolve(result);
	const setting = <T>(key: string): T => settings.get(key);
	const paths = platform.fs.paths;
	const writeDiagnosticsReport = inputs.writeDiagnosticsReport;

	// ---- sidecar side: built first, with closures into services that come later ----
	const client: SidecarClient = {
		request: (method, params) => tunnel.request(method, params),
		notify: (method, params) => tunnel.notify(method, params),
	};
	const contextWindows = new ContextWindowService({
		repository: () => repositories.modelContextWindows,
	});
	const ingest = new EventIngest({
		repositories: () => repositories,
		runInTransaction: (work) =>
			platform.db.transaction((tx) => work(createRepositories(tx, repositoryDeps))),
		sidecar: client,
		listener: {
			onStored: (sessionId, envelope, idx) =>
				sessions.applyStoredEvent(sessionId, idx, envelope.event, clock.now()),
			isViewing: (sessionId) => sessions.store.getState().viewingSessionId === sessionId,
			onContextWindow: (agent, model, windowTokens) =>
				contextWindows.remember(agent, model, windowTokens),
		},
		log: (level, message, data) => platform.app.writeLog(level, message, data),
	});
	const handlerPorts: SidecarHandlerPorts = {
		interactions: {
			request: (request) => sessions.requestInteraction(request),
			closed: (params) => sessions.interactionClosed(params),
		},
		ingest,
		liveState: {
			setLiveState: (p) => sessions.applyLiveState(p.sessionId, p.liveState),
			setAgentSessionId: (p) => sessions.setAgentSessionId(p.sessionId, p.agentSessionId),
			setProgress: (p) => sessions.setProgress(p.sessionId, p.progress),
		},
		agentCatalog: { setAgentInstalls: (p) => agentCatalog.setInstalls(p.agents) },
		agentConfig: {
			setAgentConfig: (p) => sessions.applyAgentConfig(p.sessionId, p.config),
		},
		remoteControl: {
			setStatus: (p) => sessions.applyRemoteControlState(p.sessionId, p.status),
		},
		goal: { setGoal: (p) => sessions.applyGoalChanged(p.sessionId, p.goal) },
		workspaceDiff: {
			diffForSession: async (sessionId, file, statOnly) => {
				const workspace = lookups.workspaceOfSession(sessionId);
				return workspace.ok ? git.agentDiff(workspace.value.id, file, statOnly) : workspace;
			},
		},
		diffComments: {
			forSession: async (sessionId, file) => {
				const found = lookups.workspaceOfSession(sessionId);
				if (!found.ok) return found;
				const comments = await review.listForAgent(found.value.id, file);
				if (!comments.ok) return comments;
				// The diff tool lists comments on lines of the diff. Pull request comments without a
				// file (REV-13) have no place there, so they are left out.
				return ok(
					comments.value.flatMap((c) =>
						c.filePath === null
							? []
							: [
									{
										file: c.filePath,
										line: c.line ?? 1,
										...(c.endLine === null ? {} : { endLine: c.endLine }),
										body: c.body,
										author: c.author.kind,
										resolved: c.resolved,
									},
								],
					),
				);
			},
			addForSession: async (sessionId, comments) => {
				const found = lookups.workspaceOfSession(sessionId);
				if (!found.ok) return found;
				// The agent's comments carry the chat's model as their author.
				const model = sessions.store.getState().sessions[sessionId]?.config.model ?? null;
				return review.addFromAgent(found.value.id, comments, model);
			},
		},
		terminalOutput: {
			outputForSession: async (sessionId, source, maxLines) => {
				const found = lookups.workspaceOfSession(sessionId);
				return found.ok ? terminals.outputFor(found.value.id, source, maxLines) : found;
			},
		},
		targetBranch: {
			setForSession: async (sessionId, branch) => {
				const found = lookups.workspaceOfSession(sessionId);
				return found.ok ? git.setTargetBranchFromAgent(found.value.id, branch) : found;
			},
		},
		shellEnv: {
			captureFailed: (params) => {
				log(
					"warn",
					`Could not capture the login-shell environment for ${params.folder} (${params.kind}): ${params.message}`,
				);
			},
		},
	};
	const tunnel = new SidecarTunnel({
		transport: platform.sidecar,
		requestHandlers: createSidecarRequestHandlers(handlerPorts),
		notificationHandlers: createSidecarNotificationHandlers(handlerPorts),
		log: (level, message, data) => platform.app.writeLog(level, message, data),
		setTimer: (callback, ms) => {
			const handle = setTimeout(callback, ms);
			return () => clearTimeout(handle);
		},
		clock,
		random: Math.random,
	});
	const resume = new SessionResume({
		sidecar: client,
		// Startup repair already reset stored live states, so at startup this list is empty and
		// the reconnect run is the one that finds lost chats.
		workingSessionIds: async () =>
			Object.entries(sessions.store.getState().liveStates)
				.filter(([, live]) => live.status === "working")
				.map(([id]) => id as SessionId),
		liveStateOf: (sessionId) => sessions.store.getState().liveStates[sessionId],
		apply: {
			adoptLiveState: (sessionId, liveState) => sessions.applyLiveState(sessionId, liveState),
			markInterrupted: (sessionId) => sessions.markInterrupted(sessionId),
			warm: (sessionId) => sessions.warm(sessionId),
		},
	});

	// ---- services ----
	const lookups = createLookups({
		workspaces: () => workspace.store,
		repos: () => repo.store,
		sessions: () => sessions.store,
	});
	const agentCatalog = new AgentCatalogService({
		sidecar: client,
		workspacePathOf: (sessionId) => ready(lookups.workspacePathOfSession(sessionId)),
		repoRootPathOf: (sessionId) => {
			const ws = lookups.workspaceOfSession(sessionId);
			if (!ws.ok) return ready(ws);
			const repo = lookups.repoOf(ws.value.id);
			return ready(repo.ok ? ok(repo.value.rootPath) : repo);
		},
		launchFor: (agent, acpAgent, sessionId) => {
			if (sessionId === null) return launchForAgent(agent, acpAgent, null);
			const ws = lookups.workspaceOfSession(sessionId);
			return ws.ok ? launchForAgent(agent, acpAgent, ws.value.repoId) : ready(ws);
		},
		providerKeys: repositories.providerKeys,
		keychain: platform.keychain,
		files: platform.fs,
		toml: inputs.toml,
	});
	const settings = new SettingsService({
		platform,
		repos: repositories,
		toml: inputs.toml,
		git: gitRunner,
	});
	const system = new SystemService({
		platform,
		setting,
		now: () => clock.now(),
		agentInstalls: () => {
			const installs = agentCatalog.store.getState().installs;
			return installs.state === "ready" ? installs.data : [];
		},
	});
	/**
	 * Builds how one chat's agent starts (SIDE-21): the program the user chose, the provider and its
	 * region or project, the Environment page's variables (a repository's replacing the global one
	 * of the same name) and the provider keys that belong to that agent and its sign-in choice
	 * (`launchTakesKey`). Secrets come from the Keychain; a key chosen from the Mac goes as a marker
	 * the sidecar fills from the login shell it captured. A list that
	 * cannot be read, or a saved value the Keychain cannot give back, fails the launch with a message
	 * that names it, so the send or warm that asked shows it instead of starting without it.
	 */
	const launchForAgent = async (
		agent: AgentKind,
		acpAgent: AcpAgent | undefined,
		repoId: RepoId | null,
	): Promise<Result<AgentLaunch>> => {
		const env: Record<string, string> = {};
		const providerKeys: AgentLaunch["providerKeys"] = {};
		const providerSetting =
			agent === "claude" ? "claude_provider" : agent === "codex" ? "codex_provider" : null;
		const chosenProvider =
			providerSetting === null ? undefined : setting<string>(providerSetting).trim().toLowerCase();
		const readSecret = async (ref: string, name: string): Promise<Result<string>> => {
			const read = await platform.keychain.get(ref);
			if (!read.ok) {
				return err(
					appError(
						"launch_secret_unreadable",
						`The value of ${name} could not be read from the Keychain: ${read.error.message}`,
						read.error,
					),
				);
			}
			if (read.value === null) {
				return err(
					appError(
						"launch_secret_missing",
						`The value of ${name} is missing from the Keychain. Enter it again in Settings.`,
					),
				);
			}
			return ok(read.value);
		};
		// Claude reads its Bedrock region and Vertex project from these variables. They go in first,
		// so a variable of the same name on the Environment page wins.
		if (agent === "claude" && chosenProvider === "bedrock") {
			const region = setting<string>("bedrock_region").trim();
			if (region !== "") env.AWS_REGION = region;
		}
		if (agent === "claude" && chosenProvider === "vertex") {
			const project = setting<string>("vertex_project_id").trim();
			if (project !== "") env.ANTHROPIC_VERTEX_PROJECT_ID = project;
		}
		// The Environment page's variables, by the one rule the repository scripts also use. Without a
		// repository (a model list), only the global ones.
		const variables = await settings.environmentFor(repoId);
		if (!variables.ok) return variables;
		Object.assign(env, variables.value);
		const keys = await repositories.providerKeys.listForAgent(agent, acpAgent ?? null);
		if (!keys.ok) {
			return err(
				appError(
					"launch_keys_unreadable",
					`The provider keys could not be read: ${keys.error.message}`,
					keys.error,
				),
			);
		}
		for (const key of keys.value) {
			if (!launchTakesKey(agent, chosenProvider, key)) continue;
			if (key.source === "this_mac") {
				// The app cannot read the Mac's environment. The sidecar fills the value in from the login
				// shell it captured, and fails the launch when that variable is not set there.
				providerKeys[key.envVar] = { value: "", source: "this_mac" };
				continue;
			}
			if (key.keychainRef === null) continue;
			const value = await readSecret(key.keychainRef, key.envVar);
			if (!value.ok) return value;
			providerKeys[key.envVar] = { value: value.value, source: "entered" };
		}
		const executableKey = programPathSetting(agent, acpAgent);
		const executablePath = executableKey === null ? "" : setting<string>(executableKey).trim();
		const provider =
			chosenProvider === undefined || chosenProvider === "" ? undefined : chosenProvider;
		return ok({
			env,
			providerKeys,
			...(executablePath === "" ? {} : { executablePath }),
			...(provider === undefined ? {} : { provider }),
		});
	};
	const launchFor = async (session: Session): Promise<Result<AgentLaunch>> => {
		const workspace = lookups.workspace(session.workspaceId);
		if (!workspace.ok) return workspace;
		return launchForAgent(session.config.agent, session.config.acpAgent, workspace.value.repoId);
	};
	const chatTitles = new ChatTitleService({
		sidecar: client,
		titlesEnabled: () =>
			setting<boolean>("ai_generated_chat_titles") !== false &&
			!setting<boolean>("enterprise_data_privacy"),
		// The catalog has no price field, so the default picker model is the utility choice.
		cheapestModel: (session) => {
			const models =
				agentCatalog.store.getState().models[
					agentKey(session.config.agent, session.config.acpAgent)
				];
			if (models?.state === "ready") {
				const picker = models.data.filter((model) => model.status === "picker");
				const choice = picker.find((model) => model.isDefault) ?? picker[0];
				if (choice !== undefined) return choice.id;
			}
			return session.config.model === "" ? null : session.config.model;
		},
		launchFor,
		log,
	});
	const ports = new PortService({ platform, repos: repositories });
	const terminals = new TerminalsService({
		platform,
		repos: repositories,
		maxPerWorkspace: () => terminalLimit(setting<boolean>("experimental_tab_freak_mode")),
		scrollbackLimitBytes: () => setting<number>("terminal_scrollback_limit_bytes"),
		now: () => clock.now(),
		pathPrefixFor: () => system.pathPrefix(),
	});
	const composer = new ComposerService({
		platform,
		repos: repositories,
		setDebounce: (callback, ms) => {
			const handle = setTimeout(callback, ms);
			return () => clearTimeout(handle);
		},
		activeSessionOf: (id) => {
			const found = lookups.workspace(id);
			return found.ok ? ok(found.value.activeSessionId) : found;
		},
		terminalOutputOf: async (sessionId) => {
			const workspace = lookups.workspaceOfSession(sessionId);
			if (!workspace.ok) return workspace;
			const output = await terminals.outputFor(
				workspace.value.id,
				"auto",
				DEFAULT_TERMINAL_OUTPUT_LINES,
			);
			if (!output.ok) return output;
			if (output.value.output === NO_TERMINAL_OUTPUT) return ok(null);
			return ok({ text: output.value.output, source: output.value.source });
		},
	});
	const notifications = new NotificationService({
		platform,
		sound: inputs.sound,
		setting,
		isViewing: (sessionId) => sessions.store.getState().viewingSessionId === sessionId,
		windowFocused: inputs.windowFocused,
		sessionOf: (sessionId) => sessions.store.getState().sessions[sessionId],
		workspaceOf: (workspaceId) => workspace.store.getState().workspacesById[workspaceId],
		liveStateOf: (sessionId) => sessions.store.getState().liveStates[sessionId],
		queuedCountOf: (sessionId) =>
			(followUpQueue.store.getState().bySession[sessionId] ?? []).length,
		workspaces: () => {
			const byId = workspace.store.getState().workspacesById;
			return new Map(
				Object.entries(byId).map(([id, row]) => [id as WorkspaceId, { state: row.state }]),
			);
		},
		sessions: () => Object.values(sessions.store.getState().sessions),
		setTimer: (callback, ms) => {
			const handle = setTimeout(callback, ms);
			return () => clearTimeout(handle);
		},
		log,
	});
	const followUpQueue = new FollowUpQueue({
		repos: repositories,
		// The row id is the message id, so startup repair can tell that a row in `sending` was
		// already delivered, and the sidecar's duplicate guard drops a second send of it.
		deliver: (row) =>
			sessions.send(row.sessionId, row.text, row.attachmentPaths, row.delivery, row.id),
		// A loaded chat with no live state yet is idle, as `sessions.send` takes it. Its rows can
		// wait there for the agent's program (PLAT-28) before the chat ever ran.
		liveStateOf: (sessionId) => {
			const state = sessions.store.getState();
			const live = state.liveStates[sessionId];
			if (live !== undefined) return live;
			return state.sessions[sessionId] === undefined ? undefined : idleLiveState;
		},
		newId: () => ids.uuid(),
		now: () => clock.now(),
		log,
		isHeld: (sessionId) => {
			const session = sessions.store.getState().sessions[sessionId];
			return session !== undefined && system.holdsSend(session.config.agent);
		},
	});
	/**
	 * The repository that holds a workspace's checkpoint refs, or null when its folder is gone (git
	 * cannot run there, and the refs went with it).
	 */
	const checkpointRepoRoot = async (workspaceId: WorkspaceId): Promise<Result<string | null>> => {
		const workspace = await repositories.workspaces.get(workspaceId);
		if (!workspace.ok) return workspace;
		if (workspace.value === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		const repository = await repositories.repos.get(workspace.value.repoId);
		if (!repository.ok) return repository;
		if (repository.value === null)
			return err(appError("repo_unknown", "That project was removed."));
		if (!(await platform.fs.exists(repository.value.rootPath))) return ok(null);
		return ok(repository.value.rootPath);
	};
	const sessions: SessionsService = new SessionsService({
		db: platform.db,
		repositories: () => repositories,
		repositoriesOn: (tx) => createRepositories(tx, repositoryDeps),
		fs: platform.fs,
		sidecar: client,
		composer,
		queue: followUpQueue,
		notifications,
		programHeld: (agent) => system.holdsSend(agent),
		pruneCheckpoints: async (sessionId, workspaceId) => {
			const root = await checkpointRepoRoot(workspaceId);
			if (!root.ok) return root;
			// A project folder that is gone took its refs with it, so there is nothing to prune.
			if (root.value === null) return ok(0);
			return checkpoint.pruneForChat(sessionId, root.value);
		},
		copyCheckpoints: async (workspaceId, pairs) => {
			const root = await checkpointRepoRoot(workspaceId);
			if (!root.ok) return root;
			// A project folder that is gone took its refs with it, so there is nothing to copy.
			if (root.value === null) return ok(0);
			return checkpoint.copyRefs(root.value, pairs);
		},
		workspaceContextOf: (id) => ready(lookups.sidecarContext(id, undefined)),
		defaultConfig: (id) => ready(defaultSessionConfig(id, lookups, setting)),
		launchFor,
		onFirstMessage: async (session, text) => {
			const renamed = await workspace.renameBranchAfterFirstMessage(session.id, text);
			if (!renamed.ok) {
				log("warn", `Couldn't rename the branch after the first message: ${renamed.error.message}`);
			}
		},
		log,
		setting,
		copyText: (text) => system.copyText(text),
		captureDiagnostics: () => system.captureDiagnostics(),
		writeDiagnosticsReport:
			writeDiagnosticsReport === undefined
				? undefined
				: (capture) => writeDiagnosticsReport(capture, ids.uuid()),
		now: () => clock.now(),
		newId: () => ids.uuid(),
	});
	const anyChatWorking = (): boolean =>
		Object.values(sessions.store.getState().liveStates).some((live) => live.status === "working");
	const anyRemoteControlConnected = (): boolean =>
		Object.values(sessions.store.getState().remoteControl ?? {}).some(
			(status) => status.state === "connected",
		);
	const keepAwake = new KeepAwakeService({
		platform,
		setting,
		anyChatWorking,
		anyRemoteControlConnected,
	});
	const runScripts = new RunScriptsService({
		terminals,
		configFor: async (workspaceId) => {
			const found = lookups.workspace(workspaceId);
			return found.ok ? repo.loadConfig(found.value.repoId) : found;
		},
		workspaceFor: async (workspaceId) => lookups.workspace(workspaceId),
		repoFor: async (workspaceId) => lookups.repoOf(workspaceId),
		fs: platform.fs,
		shell: platform.shell,
		ports,
		log,
		environmentFor: (repoId) => settings.environmentFor(repoId),
		pathPrefixFor: () => system.pathPrefix(),
	});
	const repo: RepoService = new RepoService({
		platform,
		git: gitRunner,
		repos: repositories,
		settings,
		removal: {
			removeWorkspacesOf: (repoId) => workspace.removeWorkspacesOf(repoId),
			releaseBacklogOf: (repoId) => workspace.releaseBacklogOf(repoId),
		},
	});
	const gitCache = createGitCache({ fs: platform.fs });
	const workspace: WorkspaceService = new WorkspaceService({
		platform,
		git: gitRunner,
		repos: repositories,
		placeNames: inputs.placeNames,
		sessions,
		ports,
		repoConfig: (repoId) => repo.loadConfig(repoId),
		github: {
			pullRequestByNumber: (remoteUrl, number) => github.pullRequestByNumber(remoteUrl, number),
		},
		branchNames: chatTitles,
		scripts: runScripts,
		checkpointerPath: checkpointerScript(paths),
		setting,
		now: () => clock.now(),
		gitCache,
	});
	const sections = new SectionsService({ db: platform.db, repos: repositories });
	const favoriteModels = new FavoriteModelsService({ repos: repositories });
	const mcp = new McpService({
		sidecar: client,
		workspacePathOf: (sessionId) => ready(lookups.workspacePathOfSession(sessionId)),
		agentOf: (sessionId) => {
			const session = sessions.store.getState().sessions[sessionId];
			if (session === undefined) {
				return err(appError("session_unknown", "That chat no longer exists."));
			}
			return ok({ agent: session.config.agent, acpAgent: session.config.acpAgent });
		},
		launchFor: (agent, acpAgent, sessionId) => {
			if (sessionId === null) return launchForAgent(agent, acpAgent, null);
			const ws = lookups.workspaceOfSession(sessionId);
			return ws.ok ? launchForAgent(agent, acpAgent, ws.value.repoId) : ready(ws);
		},
	});
	const linear = new LinearService({
		http: createLinearHttp(platform.http),
		keychain: platform.keychain,
		fs: platform.fs,
		workspacePathOf: async (id) => {
			const found = lookups.workspace(id);
			return found.ok ? ok(found.value.path) : found;
		},
		now: () => clock.now(),
	});
	const graphite = new GraphiteService({
		git: gitRunner,
		setting,
		now: () => clock.now(),
	});
	const git = new GitService({
		git: gitRunner,
		graphite,
		contextOf: (id) => ready(lookups.gitContext(id)),
		agent: sessions,
		promptFor: async (id) => {
			const found = lookups.repoOf(id);
			if (!found.ok) return found;
			const config = await repo.loadConfig(found.value.id);
			return config.ok ? ok(config.value.prompts.resolveConflicts) : config;
		},
		renameWorkspaceBranch: (id, branch) => workspace.applyBranchRename(id, branch),
		now: () => clock.now(),
		fs: platform.fs,
		setIntendedTargetBranch: (id, branch) => workspace.setIntendedTargetBranch(id, branch),
		moveOpenPullRequestBase: (id, branch) => github.moveOpenPullRequestBase(id, branch),
		stackOf: (id) => github.stackMembersOf(id),
	});
	const github = new GithubService({
		git: gitRunner,
		agent: sessions,
		contextOf: (id) => ready(lookups.prContext(id)),
		onMerged: createArchiveOnMerged({
			archive: (id, prNumber) => workspace.onPullRequestMerged(id, prNumber),
			notify: (input) => platform.notifications.notify(input),
			reportError: (message) => log("warn", message),
		}),
		onPullRequestChanged: (id) => {
			fireAndForget(
				async () => {
					const synced = await review.syncFromGithub(id);
					if (!synced.ok) {
						log("warn", `Could not sync review comments: ${synced.error.message}`);
					}
				},
				(error) => log("warn", `Could not sync review comments: ${String(error)}`),
			);
		},
		now: () => clock.now(),
		keychain: platform.keychain,
		setting,
		fixErrorsPromptOf: async (id) => {
			const found = lookups.repoOf(id);
			if (!found.ok) return found;
			const config = await repo.loadConfig(found.value.id);
			return config.ok ? ok(config.value.prompts.fixErrors) : config;
		},
		probeCwd: platform.fs.paths.home,
		fs: platform.fs,
		graphite,
	});
	const gitCacheConnection = connectGitCache({
		cache: gitCache,
		changes: git,
		pullRequests: github,
		branchOf: (id) => {
			const found = lookups.workspace(id);
			return found.ok ? found.value.branch : null;
		},
		now: () => clock.now(),
		log,
	});
	const localGitForge = new LocalGitForge({
		git: gitRunner,
		agent: sessions,
		contextOf: (id) => ready(lookups.gitContext(id)),
		enabled: () => setting<boolean>("local_git_forge_enabled"),
	});
	const checkpoint = new CheckpointService({
		git: gitRunner,
		checkpointerPath: checkpointerScript(paths),
		workspacePathOf: (sessionId) => ready(lookups.workspacePathOfSession(sessionId)),
		events: repositories.sessionEvents,
		markViewReverted: (sessionId, turnId, at) => sessions.markReverted(sessionId, turnId, at),
		setting,
		repositories: () => repositories,
		createWorkspaceFromCommit: (input, baseSha) => workspace.createFromCommit(input, baseSha),
		forkSessionInto: (sessionId, turnId, workspaceId) =>
			sessions.forkIntoWorkspace(sessionId, turnId, workspaceId),
		removeWorkspace: (workspaceId) => workspace.remove(workspaceId),
		forkCheckpointOf: (sessionId, turnId) => sessions.forkCheckpoint(sessionId, turnId),
		setActiveSession: (workspaceId, sessionId) =>
			workspace.setActiveSession(workspaceId, sessionId),
		now: () => clock.now(),
	});
	const fileDiff = new FileDiffService({
		git: gitRunner,
		fs: platform.fs,
		resolveScope: (id, scope) => git.resolveScope(id, scope),
	});
	const workspaceFiles = new WorkspaceFilesService({
		fs: platform.fs,
		search: platform.fileSearch,
		shell: platform.shell,
		git: gitRunner,
		rootsOf: (id) => ready(lookups.allowedRoots(id)),
		opener: platform.opener,
	});
	const review = new ReviewService({
		repos: repositories,
		git: gitRunner,
		agent: sessions,
		fs: platform.fs,
		githubComments: {
			readReviewThreads: (id) => github.readReviewThreads(id),
			readGeneralComments: (id) => github.readGeneralComments(id),
			resolveReviewThread: (id, threadId) => github.resolveReviewThread(id, threadId),
		},
		workspacePathOf: async (id) => {
			const found = lookups.workspace(id);
			return found.ok ? ok(found.value.path) : found;
		},
		customPromptOf: async (id) => {
			const found = lookups.repoOf(id);
			if (!found.ok) return found;
			const config = await repo.loadConfig(found.value.id);
			return config.ok ? ok(config.value.prompts.codeReview) : config;
		},
		startReviewChat: (id, text) => sessions.startReviewChat(id, text),
	});
	const spotlight = new SpotlightService({
		git: gitRunner,
		terminals,
		checkpointerPath: checkpointerScript(paths),
		spotlighterPath: spotlighterScript(paths),
		busyCheckPath: gitBusyCheckScript(paths),
		watchexecPath: "watchexec",
		configFor: async (workspaceId) => {
			const found = lookups.workspace(workspaceId);
			return found.ok ? repo.loadConfig(found.value.repoId) : found;
		},
		workspaceFor: async (workspaceId) => lookups.workspace(workspaceId),
		repoFor: async (workspaceId) => lookups.repoOf(workspaceId),
		stopRuns: (workspaceId) => runScripts.stopWorkspace(workspaceId),
		openRepoTerminal: (repoId) => terminals.openForRepo(repoId),
		log,
	});
	const updates = new UpdatesService({
		platform,
		anyChatWorking: () =>
			Object.values(sessions.store.getState().liveStates).some((live) => live.status === "working"),
		setting,
	});
	const commands = new CommandRunner({
		handlers: () =>
			createCommandHandlers(services, {
				pickFolder: (title) => platform.dialogs.pickFolder({ title }),
				toggleInspector: () => platform.window.toggleInspector(),
			}),
		context: () => {
			const workspaces = workspace.store.getState().workspacesById;
			const viewingSessionId = sessions.store.getState().viewingSessionId;
			const pullRequests = github.store.getState().byWorkspace;
			return {
				hasWorkspace: Object.keys(workspaces).length > 0,
				hasOpenPr: Object.values(pullRequests).some((entry) => entry.pullRequest !== null),
				hasOpenChat: viewingSessionId !== null,
			};
		},
	});

	const services: Services = {
		settings,
		repo,
		workspace,
		sections,
		favoriteModels,
		contextWindows,
		agentCatalog,
		mcp,
		linear,
		git,
		graphite,
		gitCache,
		github,
		localGitForge,
		checkpoint,
		fileDiff,
		workspaceFiles,
		review,
		sessions,
		followUpQueue,
		composer,
		runScripts,
		spotlight,
		ports,
		terminals,
		notifications,
		updates,
		system,
		commands,
	};
	const actions = createActions(services, platform);

	// ---- startup ----
	const steps: StartStep[] = [
		{ name: "settings", phase: "settings", fatal: true, run: () => settings.start() },
		{
			name: "repair",
			phase: "settings",
			fatal: true,
			run: async () => {
				const repaired = await runStartupRepair({
					db: platform.db,
					fs: platform.fs,
					clock,
					ids,
				});
				if (!repaired.ok) return repaired;
				return workspace.recoverArchiving(repaired.value.archivingWorkspaces);
			},
		},
		{ name: "repos", phase: "services", fatal: true, run: () => repo.start() },
		{ name: "workspaces", phase: "services", fatal: true, run: () => workspace.start() },
		{
			name: "git cache",
			phase: "services",
			fatal: false,
			// The last changes and pull request info of each active workspace show before the first
			// poll answers (DATA-07).
			run: () =>
				gitCacheConnection.paint(
					Object.values(workspace.store.getState().workspacesById)
						.filter((found) => found.state !== "archived")
						.map((found) => ({ id: found.id, branch: found.branch })),
				),
		},
		{ name: "sections", phase: "services", fatal: false, run: () => sections.start() },
		{ name: "favorite models", phase: "services", fatal: false, run: () => favoriteModels.start() },
		{ name: "context windows", phase: "services", fatal: false, run: () => contextWindows.start() },
		{ name: "terminals", phase: "services", fatal: false, run: () => terminals.start() },
		{ name: "chats", phase: "services", fatal: true, run: () => sessions.start() },
		{ name: "github access", phase: "services", fatal: false, run: () => github.checkAccess() },
		{ name: "linear access", phase: "services", fatal: false, run: () => linear.start() },
		{ name: "programs", phase: "services", fatal: false, run: () => system.start() },
		{ name: "sidecar", phase: "sidecar", fatal: true, run: () => tunnel.start() },
		{ name: "resume chats", phase: "sidecar", fatal: false, run: () => resume.resume() },
		{
			name: "checkpoint pruning",
			phase: "sidecar",
			fatal: false,
			run: () => checkpoint.pruneArchived(CHECKPOINT_PRUNE_AFTER_DAYS),
		},
		{
			name: "data lifetime",
			phase: "sidecar",
			fatal: false,
			run: async () => {
				const ran = await runDataLifetimeJob({
					db: platform.db,
					fs: platform.fs,
					clock,
					limits: DEFAULT_LIFETIME_LIMITS,
				});
				// A step that failed sits inside the report; this makes it a start warning.
				return ran.ok ? lifetimeJobResult(ran.value) : ran;
			},
		},
	];
	let started: Promise<Result<StartReport>> | null = null;
	let detachReconnect: (() => void) | null = null;
	const cleanups: (() => void)[] = [];
	// The queue drains when a chat can take a message, and pauses when a turn adds an error.
	// Watching the store here covers every chat, not only the one on screen.
	cleanups.push(
		sessions.store.subscribe((state) => {
			for (const sessionId of Object.keys(state.liveStates)) {
				followUpQueue.observeLiveState(sessionId as SessionId);
			}
		}),
	);
	// A message waiting for its agent's program goes out once the program is ready (PLAT-28).
	cleanups.push(
		system.store.subscribe((state, previous) => {
			if (state.programs === previous.programs) return;
			for (const sessionId of Object.keys(followUpQueue.store.getState().bySession)) {
				void followUpQueue.release(sessionId as SessionId).then((result) => {
					if (!result.ok) {
						log("warn", `Failed to send a queued message: ${result.error.message}`);
					}
				});
			}
		}),
	);
	// An editor draft lives until it is saved or discarded, or its workspace is removed. An archived
	// workspace keeps its drafts, because Restore brings the same folder back.
	cleanups.push(
		workspace.store.subscribe((state) => {
			workspaceFiles.dropDraftsExcept((id) => state.workspacesById[id] !== undefined);
		}),
	);
	let updateTimer: ReturnType<typeof setInterval> | null = null;
	let keepAwakeTimer: ReturnType<typeof setInterval> | null = null;
	let wired = false;
	let stopped = false;

	const stoppedError = () =>
		appError("container_stopped", "The app stopped while it was starting.");

	const updateDockBadge = (): void => {
		void notifications.refreshDockBadge().then((result) => {
			if (!result.ok) log("warn", `Could not set the dock badge: ${result.error.message}`);
		});
	};

	const wireAfterStart = async (warnings: StartReport["warnings"]): Promise<void> => {
		// Wired once, before the awaits below. A failed wireAfterStart is not retried: start runs
		// once per container (see `start`), so there is no second caller to retry it.
		if (wired) return;
		wired = true;

		updateDockBadge();
		cleanups.push(sessions.store.subscribe(updateDockBadge));
		cleanups.push(workspace.store.subscribe(updateDockBadge));

		const openLink = inputs.openLink;
		if (openLink === undefined) {
			warnings.push({
				step: "links",
				message: "Notification clicks are not wired: no link opener was given to the container.",
			});
		} else {
			// Deep links are not listened for here: the command dispatcher (NAV-14) is their one
			// subscriber, so a link is not handled twice.
			cleanups.push(platform.notifications.onClicked(openLink));
		}

		for (const project of Object.values(repo.store.getState().reposById)) {
			const healed = await spotlight.healAfterCrash(project.rootPath);
			if (!healed.ok) warnings.push({ step: "spotlight", message: healed.error.message });
		}
		// `stop` ran during the heal and already cleaned what was wired above. Wire nothing more.
		if (stopped) return;

		// The sidecar's agent list reports the program paths chosen in Settings (SIDE-21).
		cleanups.push(
			followAgentPrograms({
				programs: () =>
					chosenAgentPrograms((agent, acpAgent) => {
						const key = programPathSetting(agent, acpAgent);
						return key === null ? "" : setting<string>(key);
					}),
				onSettingsChanged: (listener) => settings.store.subscribe(listener),
				onReconnected: (listener) => tunnel.onReconnected(listener),
				send: (params) => client.notify("setAgentPrograms", params),
				log: (message) => log("warn", message),
			}),
		);

		// Keep-awake follows the setting and the chats' work, and re-checks every scan so a
		// battery that falls low or a caffeinate that exited by itself is handled. A scan reads
		// the live setting and chats, so a change made before it runs is already covered: only one
		// scan waits at a time, and two quick changes must not start `caffeinate` twice. A change
		// that arrives while a scan runs gets one more scan after it, with the newer state.
		let keepAwakeScans: Promise<void> = Promise.resolve();
		let keepAwakeScanQueued = false;
		let keepAwakeScanRunning = false;
		let keepAwakeScanAgain = false;
		const runKeepAwakeScan = (): void => {
			if (keepAwakeScanRunning) {
				keepAwakeScanAgain = true;
				return;
			}
			if (keepAwakeScanQueued) return;
			keepAwakeScanQueued = true;
			keepAwakeScans = keepAwakeScans.then(async () => {
				keepAwakeScanQueued = false;
				keepAwakeScanRunning = true;
				try {
					const outcome = await keepAwake.scan();
					if (!outcome.ok) log("warn", `Could not keep the Mac awake: ${outcome.error.message}`);
				} finally {
					keepAwakeScanRunning = false;
					if (keepAwakeScanAgain) {
						keepAwakeScanAgain = false;
						runKeepAwakeScan();
					}
				}
			});
		};
		// The stores fire on every change, and a working chat updates its store many times a
		// second, so a scan waits for the setting or whether a chat works to change.
		let keepAwakeInputs: string | null = null;
		const followKeepAwake = (): void => {
			const inputs = JSON.stringify([
				setting<boolean>(KEEP_AWAKE_SETTING_KEY) === true,
				anyChatWorking(),
				setting<boolean>(REMOTE_KEEP_AWAKE_SETTING_KEY) === true,
				anyRemoteControlConnected(),
			]);
			if (keepAwakeInputs === inputs) return;
			keepAwakeInputs = inputs;
			runKeepAwakeScan();
		};
		cleanups.push(settings.store.subscribe(followKeepAwake));
		cleanups.push(sessions.store.subscribe(followKeepAwake));
		followKeepAwake();
		keepAwakeTimer = setInterval(runKeepAwakeScan, KEEP_AWAKE_SCAN_MS);
		(keepAwakeTimer as unknown as { unref?: () => void }).unref?.();

		updateTimer = setInterval(() => {
			void updates.check().then((outcome) => {
				if (!outcome.ok) log("warn", `Update check failed: ${outcome.error.message}`);
			});
		}, UPDATE_CHECK_INTERVAL_MS);
		(updateTimer as unknown as { unref?: () => void }).unref?.();

		let quitPromptOpen = false;
		cleanups.push(
			platform.app.onQuitRequested(() => {
				if (updates.isSafeToQuit()) {
					stopThenQuit();
					return;
				}
				// Agents are still working. Ask before quitting, and only one prompt at a time.
				if (quitPromptOpen) return;
				quitPromptOpen = true;
				void platform.dialogs
					.confirm({
						title: "Quit Conducted?",
						message: "Agents are still working. Quitting stops their turns and running commands.",
						okLabel: "Quit",
					})
					.then((confirmed) => {
						quitPromptOpen = false;
						if (confirmed) stopThenQuit();
					})
					.catch((cause: unknown) => {
						quitPromptOpen = false;
						const message = messageOf(cause);
						log("warn", `Could not ask whether to quit: ${message}`);
					});
			}),
		);
		await platform.app.setQuitHandlerReady();
	};

	const runSteps = async (
		onProgress: ((progress: StartProgress) => void) | undefined,
	): Promise<Result<StartReport>> => {
		const warnings: StartReport["warnings"] = [];
		for (const step of steps) {
			if (stopped) return err(stoppedError());
			onProgress?.({ step: step.name, phase: step.phase });
			const result = await step.run();
			if (result.ok) continue;
			if (step.fatal)
				return err(
					appError(result.error.code, `${step.name}: ${result.error.message}`, result.error),
				);
			warnings.push({ step: step.name, message: result.error.message });
		}
		if (stopped) return err(stoppedError());
		detachReconnect = tunnel.onReconnected(() => {
			void resume.resumeAfterReconnect().then((outcome) => {
				if (!outcome.ok)
					log("warn", `Resuming chats after reconnect failed: ${outcome.error.message}`);
			});
		});
		await wireAfterStart(warnings);
		if (stopped) return err(stoppedError());
		return ok({ warnings });
	};

	const stop = async (): Promise<void> => {
		stopped = true;
		// Every step runs, in this order, even when an earlier one fails: a half-stopped app
		// would keep listeners and the sidecar connection alive.
		const step = async (name: string, run: () => unknown): Promise<void> => {
			try {
				const outcome = await run();
				if (isFailedResult(outcome)) {
					log("warn", `Stopping ${name} failed: ${outcome.error.message}`);
				}
			} catch (cause) {
				const message = messageOf(cause);
				log("warn", `Stopping ${name} failed: ${message}`);
			}
		};
		// A start in progress finishes its current step and then ends (it checks `stopped`). The
		// teardown below waits for that, so what the step registered is released too.
		await step("the start in progress", () => started?.then(noop, noop));
		await step("the reconnect listener", () => {
			detachReconnect?.();
			detachReconnect = null;
		});
		for (const cleanup of cleanups.splice(0)) await step("a listener", cleanup);
		await step("settings", () => settings.stop());
		await step("the update timer", () => {
			if (updateTimer !== null) clearInterval(updateTimer);
			updateTimer = null;
		});
		await step("the keep-awake timer", () => {
			if (keepAwakeTimer !== null) clearInterval(keepAwakeTimer);
			keepAwakeTimer = null;
		});
		await step("keep-awake", () => keepAwake.stop());
		await step("notifications", () => notifications.stop());
		await step("agent programs", () => system.dispose());
		await step("the repo service", () => repo.dispose());
		await step("git polling", () => git.dispose());
		await step("Graphite polling", () => graphite.dispose());
		await step("GitHub polling", () => github.dispose());
		await step("the git cache", () => gitCacheConnection.stop());
		await step("composer drafts", () => composer.flush());
		await step("terminals", () => terminals.killAll());
		await step("run scripts", () => runScripts.stopAll());
		// Events the sidecar sent before the tunnel closes are written first, so none is lost.
		await step("chat event writes", () => ingest.idle());
		await step("the sidecar connection", () => tunnel.stop());
	};

	// The Rust shell quits at once when asked (`app_quit`), so the work in flight is flushed first:
	// composer drafts, chat events being stored, terminals and runs. A second request while that
	// runs is ignored. A stop step that hangs must not keep the app open, so the quit goes ahead
	// after QUIT_STOP_LIMIT_MS whatever the stop has reached.
	let quitting = false;
	const stopThenQuit = (): void => {
		if (quitting) return;
		quitting = true;
		fireAndForget(
			async () => {
				let limit: ReturnType<typeof setTimeout> | undefined;
				const elapsed = new Promise<void>((resolve) => {
					limit = setTimeout(() => {
						log("warn", `Quitting before every stop step ended (${QUIT_STOP_LIMIT_MS} ms).`);
						resolve();
					}, QUIT_STOP_LIMIT_MS);
				});
				try {
					await Promise.race([stop(), elapsed]);
				} finally {
					clearTimeout(limit);
				}
				await platform.app.quit();
			},
			(cause) => {
				quitting = false;
				const message = messageOf(cause);
				log("warn", `Could not quit: ${message}`);
			},
		);
	};

	return {
		platform,
		services,
		actions,
		lookups,
		sidecar: tunnel,
		start(onProgress) {
			started ??= runSteps(onProgress);
			return started;
		},
		stop,
	};
}

const noop = (): void => {};

/** True for a `Result` that failed. Used for stop steps, which return a Result or nothing. */
function isFailedResult(value: unknown): value is { ok: false; error: { message: string } } {
	return (
		typeof value === "object" &&
		value !== null &&
		"ok" in value &&
		value.ok === false &&
		"error" in value
	);
}
