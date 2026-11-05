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
 * steps it wires the dock badge, notification clicks, the hourly update check, the quit guard and
 * the Spotlight heal; deep links have one subscriber, the command dispatcher (NAV-14), which is
 * mounted with the app root, so this file does not listen for them a second time; `stop`
 * removes those listeners, stops the settings reload listener and its timer, stops the update
 * timer, disposes the repo service, kills terminals and runs, waits for chat events that are
 * being stored, and detaches from the sidecar; every stop step runs even when an earlier one
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
	appError,
	type Clock,
	err,
	type IdSource,
	ok,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
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
import { UPDATE_CHECK_INTERVAL_MS, UpdatesService } from "./services/updates.ts";
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
	/** Opens a notification click or deep link in the app. The app entry passes its router opener. */
	openLink?: (url: string) => void;
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
	/**
	 * Stops listeners and timers, kills terminals and runs, lets stored-event writes finish and
	 * detaches from the sidecar. Every step runs; a step that fails is logged. Safe to call twice.
	 */
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
		},
	});

	// ---- services ----
	const lookups = createLookups({
		workspaces: () => workspace.store,
		repos: () => repo.store,
		sessions: () => sessions.store,
	});
	const settings = new SettingsService({
		platform,
		repos: repositories,
		toml: inputs.toml,
		git: gitRunner,
	});
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
		workspaces: () => {
			const byId = workspace.store.getState().workspacesById;
			return new Map(
				Object.entries(byId).map(([id, row]) => [id as WorkspaceId, { state: row.state }]),
			);
		},
		sessions: () => Object.values(sessions.store.getState().sessions),
	});
	const followUpQueue = new FollowUpQueue({
		repos: repositories,
		deliver: (row) => sessions.send(row.sessionId, row.text, row.attachmentPaths, row.delivery),
		liveStateOf: (sessionId) => sessions.store.getState().liveStates[sessionId],
	});
	const sessions: SessionsService = new SessionsService({
		db: platform.db,
		repositories: () => repositories,
		repositoriesOn: (tx) => createRepositories(tx, repositoryDeps),
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
		workspaceFor: async (workspaceId) => lookups.workspace(workspaceId),
		repoFor: async (workspaceId) => lookups.repoOf(workspaceId),
		fs: platform.fs,
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
		fs: platform.fs,
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
		handlers: () =>
			createCommandHandlers(services, {
				pickFolder: (title) => platform.dialogs.pickFolder({ title }),
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
		{ name: "sidecar", phase: "sidecar", fatal: true, run: () => tunnel.start() },
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
	const cleanups: (() => void)[] = [];
	let updateTimer: ReturnType<typeof setInterval> | null = null;
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
					void platform.app.quit();
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
						if (confirmed) void platform.app.quit();
					})
					.catch((cause: unknown) => {
						quitPromptOpen = false;
						const message = cause instanceof Error ? cause.message : String(cause);
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
					const message = cause instanceof Error ? cause.message : String(cause);
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
			await step("the repo service", () => repo.dispose());
			await step("terminals", () => terminals.killAll());
			await step("run scripts", () => runScripts.stopAll());
			// Events the sidecar sent before the tunnel closes are written first, so none is lost.
			await step("chat event writes", () => ingest.idle());
			await step("the sidecar connection", () => tunnel.stop());
		},
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
