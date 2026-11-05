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
 * non-fatal failures (the sidecar not starting, no GitHub access) as warnings; `start` runs once
 * (a second call returns the first result); `stop` kills terminals and runs, then detaches from
 * the sidecar; the database-version check happens before `start` (see the proposed
 * `Platform.app.dbVersionWarning`); after the sidecar reconnects, chats are resumed again.
 * Our design choice: one `createContainer` function with every dependency as a parameter. There
 * is no module-level singleton, so tests build as many containers as they like. The timers here
 * are the only global clock use in core; they sit in the root, the edge of the program.
 * Test first: createContainer returns a container whose `services` has every service named in
 * the `Services` interface, and builds without calling any placeholder.
 */
import { appError, type Clock, err, type IdSource, ok, type Result } from "@conducted/shared";
import type { Platform } from "../platform/platform.ts";
import { createActions } from "./actions.ts";
import type { Actions } from "./api.ts";
import { checkpointerScript, spotlighterScript } from "./app-paths.ts";
import { DEFAULT_LIFETIME_LIMITS, runDataLifetimeJob } from "./db/lifetime.ts";
import { runStartupRepair } from "./db/repair.ts";
import { createRepositories } from "./db/repositories.ts";
import { KeyedMutex } from "./git/locks.ts";
import { ShellGitRunner } from "./git/runner.ts";
import { createLookups, defaultSessionConfig, type Lookups } from "./lookups.ts";
import { AgentCatalogService } from "./services/agent-catalog.ts";
import { CheckpointService } from "./services/checkpoint.ts";
import { CommandRunner, createCommandHandlers } from "./services/command-runner.ts";
import { ComposerService } from "./services/composer.ts";
import { FavoriteModelsService } from "./services/favorite-models.ts";
import { FileDiffService } from "./services/file-diff.ts";
import { FollowUpQueue } from "./services/follow-up-queue.ts";
import { GitService } from "./services/git.ts";
import { createGitCache } from "./services/git-cache.ts";
import { GithubService } from "./services/github.ts";
import { createCurlLinearHttp, LinearService } from "./services/linear.ts";
import { LocalGitForge } from "./services/local-git-forge.ts";
import { McpService } from "./services/mcp.ts";
import { NotificationService, type SoundPlayer } from "./services/notifications.ts";
import { PortService } from "./services/ports.ts";
import { RepoService } from "./services/repo.ts";
import { ReviewService } from "./services/review.ts";
import { RunScriptsService } from "./services/run-scripts.ts";
import { SectionsService } from "./services/sections.ts";
import { SessionsService } from "./services/sessions.ts";
import { SettingsService, type TomlCodec } from "./services/settings.ts";
import { SpotlightService } from "./services/spotlight.ts";
import { SystemService } from "./services/system.ts";
import { TerminalsService, terminalLimit } from "./services/terminals.ts";
import { UpdatesService } from "./services/updates.ts";
import { type PlaceNames, WorkspaceService } from "./services/workspace.ts";
import { WorkspaceFilesService } from "./services/workspace-files.ts";
import {
	createSidecarNotificationHandlers,
	createSidecarRequestHandlers,
	type SidecarHandlerPorts,
} from "./sidecar/handlers.ts";
import { EventIngest } from "./sidecar/ingest.ts";
import { SessionResume } from "./sidecar/resume.ts";
import { type SidecarClient, SidecarTunnel } from "./sidecar/tunnel.ts";

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
}

export interface Services {
	settings: SettingsService;
	repo: RepoService;
	workspace: WorkspaceService;
	sections: SectionsService;
	favoriteModels: FavoriteModelsService;
	agentCatalog: AgentCatalogService;
	mcp: McpService;
	linear: LinearService;
	git: GitService;
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
	/** Stops terminals and runs and detaches from the sidecar. Safe to call twice. */
	stop(): Promise<void>;
}

interface StartStep {
	name: string;
	phase: StartProgress["phase"];
	fatal: boolean;
	run: () => Promise<Result<unknown>>;
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
		sleep,
		log,
	});
	const ready = <T>(result: Result<T>): Promise<Result<T>> => Promise.resolve(result);
	const setting = <T>(key: string): T => settings.get(key);
	const paths = platform.fs.paths;

	// ---- sidecar side: built first, with closures into services that come later ----
	const client: SidecarClient = {
		request: (method, params) => tunnel.request(method, params),
		notify: (method, params) => tunnel.notify(method, params),
	};
	const ingest = new EventIngest({
		repositories: () => repositories,
		runInTransaction: (work) =>
			platform.db.transaction((tx) => work(createRepositories(tx, repositoryDeps))),
		sidecar: client,
		listener: {
			onStored: (sessionId, envelope, idx) =>
				sessions.applyStoredEvent(sessionId, idx, envelope.event, clock.now()),
			isViewing: (sessionId) => sessions.store.getState().viewingSessionId === sessionId,
		},
		log: (level, message, data) => platform.app.writeLog(level, message, data),
	});
	const handlerPorts: SidecarHandlerPorts = {
		interactions: { request: (request) => sessions.requestInteraction(request) },
		ingest,
		liveState: {
			setLiveState: (p) => sessions.applyLiveState(p.sessionId, p.liveState),
			setAgentSessionId: (p) => sessions.setAgentSessionId(p.sessionId, p.agentSessionId),
			setProgress: (p) => sessions.setProgress(p.sessionId, p.progress),
		},
		agentCatalog: { setAgentInstalls: (p) => agentCatalog.setInstalls(p.agents) },
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
				return found.ok ? review.addFromAgent(found.value.id, comments) : found;
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
				return found.ok ? git.setTargetBranch(found.value.id, branch) : found;
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
	});
	const resume = new SessionResume({
		repositories: () => repositories,
		sidecar: client,
		workingSessionIds: async () =>
			Object.entries(sessions.store.getState().liveStates)
				.filter(([, live]) => live.status === "working")
				.map(([id]) => id as never),
		apply: {
			adoptLiveState: (sessionId, liveState) => sessions.applyLiveState(sessionId, liveState),
			markInterrupted: (sessionId) => sessions.markInterrupted(sessionId),
		},
	});

	// ---- services ----
	const lookups = createLookups({
		workspaces: () => workspace.store,
		repos: () => repo.store,
		sessions: () => sessions.store,
	});
	const settings = new SettingsService({ platform, repos: repositories, toml: inputs.toml });
	const ports = new PortService({ platform });
	const terminals = new TerminalsService({
		platform,
		repos: repositories,
		maxPerWorkspace: () => terminalLimit(setting<boolean>("experimental_tab_freak_mode")),
		now: () => clock.now(),
	});
	const composer = new ComposerService({
		platform,
		repos: repositories,
		setDebounce: (callback, ms) => {
			const handle = setTimeout(callback, ms);
			return () => clearTimeout(handle);
		},
	});
	const notifications = new NotificationService({
		platform,
		sound: inputs.sound,
		setting,
		isViewing: (sessionId) => sessions.store.getState().viewingSessionId === sessionId,
		windowFocused: inputs.windowFocused,
	});
	const followUpQueue = new FollowUpQueue({
		repos: repositories,
		deliver: (row) => sessions.send(row.sessionId, row.text, row.attachmentPaths, row.delivery),
		liveStateOf: (sessionId) => sessions.store.getState().liveStates[sessionId],
	});
	const sessions: SessionsService = new SessionsService({
		db: platform.db,
		repositories: () => repositories,
		sidecar: client,
		composer,
		queue: followUpQueue,
		notifications,
		workspaceContextOf: (id) => ready(lookups.sidecarContext(id, undefined)),
		defaultConfig: (id) => ready(defaultSessionConfig(id, lookups, setting)),
		setting,
		now: () => clock.now(),
		newId: () => ids.uuid(),
	});
	const runScripts = new RunScriptsService({
		terminals,
		configFor: async (workspaceId) => {
			const found = lookups.workspace(workspaceId);
			return found.ok ? repo.loadConfig(found.value.repoId) : found;
		},
	});
	const repo: RepoService = new RepoService({
		platform,
		git: gitRunner,
		repos: repositories,
		settings,
		removal: { removeWorkspacesOf: (repoId) => workspace.removeWorkspacesOf(repoId) },
	});
	const workspace: WorkspaceService = new WorkspaceService({
		platform,
		git: gitRunner,
		repos: repositories,
		placeNames: inputs.placeNames,
		sessions,
		ports,
		scripts: runScripts,
		setting,
		now: () => clock.now(),
	});
	const sections = new SectionsService({ db: platform.db, repos: repositories });
	const favoriteModels = new FavoriteModelsService({ repos: repositories });
	const agentCatalog = new AgentCatalogService({
		sidecar: client,
		workspacePathOf: (sessionId) => ready(lookups.workspacePathOfSession(sessionId)),
	});
	const mcp = new McpService({ sidecar: client });
	const linear = new LinearService({
		http: createCurlLinearHttp(platform.shell),
		keychain: platform.keychain,
	});
	const gitCache = createGitCache({ fs: platform.fs });
	const git = new GitService({
		git: gitRunner,
		cache: gitCache,
		contextOf: (id) => ready(lookups.gitContext(id)),
		agent: sessions,
		now: () => clock.now(),
	});
	const github = new GithubService({
		git: gitRunner,
		cache: gitCache,
		agent: sessions,
		contextOf: (id) => ready(lookups.prContext(id)),
		onMerged: (id, prNumber) => {
			void workspace.onPullRequestMerged(id, prNumber);
		},
		now: () => clock.now(),
		keychain: platform.keychain,
		setting,
		probeCwd: platform.fs.paths.home,
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
	});
	const fileDiff = new FileDiffService({
		git: gitRunner,
		fs: platform.fs,
		resolveScope: (id, scope) => git.resolveScope(id, scope),
	});
	const workspaceFiles = new WorkspaceFilesService({
		fs: platform.fs,
		search: platform.fileSearch,
		rootsOf: (id) => ready(lookups.allowedRoots(id)),
	});
	const review = new ReviewService({
		repos: repositories,
		git: gitRunner,
		agent: sessions,
		startReviewChat: (id, text) => sessions.startReviewChat(id, text),
	});
	const spotlight = new SpotlightService({
		git: gitRunner,
		terminals,
		checkpointerPath: checkpointerScript(paths),
		spotlighterPath: spotlighterScript(paths),
	});
	const updates = new UpdatesService({
		platform,
		anyChatWorking: () =>
			Object.values(sessions.store.getState().liveStates).some((live) => live.status === "working"),
		setting,
	});
	const system = new SystemService({ platform, setting });
	const commands = new CommandRunner({
		handlers: () => createCommandHandlers(services),
		context: () => ({ hasWorkspace: false, hasOpenPr: false, hasOpenChat: false }),
	});

	const services: Services = {
		settings,
		repo,
		workspace,
		sections,
		favoriteModels,
		agentCatalog,
		mcp,
		linear,
		git,
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
			run: () => runStartupRepair({ db: platform.db, fs: platform.fs, clock, ids }),
		},
		{ name: "repos", phase: "services", fatal: true, run: () => repo.start() },
		{ name: "workspaces", phase: "services", fatal: true, run: () => workspace.start() },
		{ name: "sections", phase: "services", fatal: false, run: () => sections.start() },
		{ name: "favorite models", phase: "services", fatal: false, run: () => favoriteModels.start() },
		{ name: "terminals", phase: "services", fatal: false, run: () => terminals.start() },
		{ name: "chats", phase: "services", fatal: true, run: () => sessions.start() },
		{ name: "github access", phase: "services", fatal: false, run: () => github.checkAccess() },
		{ name: "programs", phase: "services", fatal: false, run: () => system.start() },
		{ name: "sidecar", phase: "sidecar", fatal: false, run: () => tunnel.start() },
		{ name: "resume chats", phase: "sidecar", fatal: false, run: () => resume.resume() },
		{
			name: "data lifetime",
			phase: "sidecar",
			fatal: false,
			run: () =>
				runDataLifetimeJob({
					db: platform.db,
					fs: platform.fs,
					clock,
					limits: DEFAULT_LIFETIME_LIMITS,
				}),
		},
	];
	let started: Promise<Result<StartReport>> | null = null;
	let detachReconnect: (() => void) | null = null;

	const runSteps = async (
		onProgress: ((progress: StartProgress) => void) | undefined,
	): Promise<Result<StartReport>> => {
		const warnings: StartReport["warnings"] = [];
		for (const step of steps) {
			onProgress?.({ step: step.name, phase: step.phase });
			const result = await step.run();
			if (result.ok) continue;
			if (step.fatal)
				return err(
					appError(result.error.code, `${step.name}: ${result.error.message}`, result.error),
				);
			warnings.push({ step: step.name, message: result.error.message });
		}
		detachReconnect = tunnel.onReconnected(() => {
			void resume.resume().then((outcome) => {
				if (!outcome.ok)
					log("warn", `Resuming chats after reconnect failed: ${outcome.error.message}`);
			});
		});
		return ok({ warnings });
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
		async stop() {
			detachReconnect?.();
			detachReconnect = null;
			await terminals.killAll();
			await runScripts.stopAll();
			tunnel.stop();
		},
	};
}
