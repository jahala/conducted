// @vitest-environment node
/**
 * @feature RUN-02 Spotlight: test workspace changes in the repo root, restore on stop
 * Tests healing a repository root after a crash, the root preflight, starting and stopping
 * Spotlight, and reaching the service through the real container.
 */
import {
	appError,
	err,
	ok,
	type RepoId,
	type Result,
	type TerminalId,
	type WorkspaceId,
} from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import { FakeGitRunner, gitOutput, gitUnscripted } from "../../test/fake-git-runner.ts";
import { checkpointRef, PRE_SPOTLIGHT_CHECKPOINT_ID } from "../git/refs.ts";
import type { Repo, RepoConfig, Terminal, Workspace } from "../model.ts";
import { SPOTLIGHT_ACTION_ID } from "../spotlight.ts";
import { runListFor, SpotlightService, type SpotlightServiceDeps } from "./spotlight.ts";

const WORKSPACE_ID = "w1" as WorkspaceId;
const OTHER_WORKSPACE_ID = "w2" as WorkspaceId;
const REPO_ID = "r1" as RepoId;
const ROOT = "/code/project";
const WORKSPACE_PATH = "/code/workspaces/oslo";
const OTHER_WORKSPACE_PATH = "/code/workspaces/berlin";
const TERMINAL_ID = "t1" as TerminalId;
const OTHER_TERMINAL_ID = "t2" as TerminalId;
const CHECKPOINTER = "/app/bin/checkpointer.sh";
const SPOTLIGHTER = "/app/bin/spotlighter.sh";
const BUSY_CHECK = "/app/bin/git-busy-check.sh";
const WATCHEXEC = "/app/bin/watchexec";
const REF = checkpointRef(PRE_SPOTLIGHT_CHECKPOINT_ID);

afterEach(() => {
	vi.restoreAllMocks();
});

const baseWorkspace = (id: WorkspaceId = WORKSPACE_ID, path = WORKSPACE_PATH): Workspace => ({
	id,
	repoId: REPO_ID,
	directoryName: id === OTHER_WORKSPACE_ID ? "berlin" : "oslo",
	path,
	branch: "feature/oslo",
	branchIsPlaceholder: false,
	host: { kind: "local" },
	displayName: null,
	targetBranch: "origin/main",
	state: "ready",
	kanbanStatus: "in_progress",
	port: 55_010,
	pinnedAt: null,
	linkedPaths: [],
	prNumber: null,
	prTitle: null,
	prDescription: null,
	archiveCommit: null,
	archivedAt: null,
	activeSessionId: null,
	filesCopied: null,
	lastActivityAt: 1,
	createdAt: 1,
	updatedAt: 1,
});

const baseRepo: Repo = {
	id: REPO_ID,
	name: "project",
	rootPath: ROOT,
	remoteUrl: null,
	defaultBranch: "main",
	icon: null,
	displayOrder: 0,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
};

const baseConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
	setupScript: null,
	runScripts: [],
	runMode: "concurrent",
	archiveScript: null,
	copyFiles: [],
	previewUrls: [],
	spotlightTesting: true,
	autoRunAfterSetup: false,
	remoteName: null,
	prompts: {
		general: null,
		codeReview: null,
		createPr: null,
		fixErrors: null,
		resolveConflicts: null,
		renameBranch: null,
	},
	...overrides,
});

const terminal = (id: TerminalId, repoId: RepoId): Terminal => ({
	id,
	workspaceId: null,
	repoId,
	kind: "terminal",
	title: "Terminal 1",
	cwd: ROOT,
	hostKind: "local",
	startCommand: null,
	startedAt: 1,
	endedAt: null,
	exitCode: null,
});

interface GitControl {
	readonly refs: Set<string>;
	busy: string;
	branch: string;
	saveExit: number;
	restoreExit: number;
}

/** A git fake over one set of refs, one busy answer and one branch answer. */
function gitHarness(options: {
	refs?: Set<string>;
	busy?: string;
	branch?: string;
	saveExit?: number;
	restoreExit?: number;
}): { git: FakeGitRunner; control: GitControl } {
	const control: GitControl = {
		refs: options.refs ?? new Set<string>(),
		busy: options.busy ?? "clean",
		branch: options.branch ?? "main",
		saveExit: options.saveExit ?? 0,
		restoreExit: options.restoreExit ?? 0,
	};
	const git = new FakeGitRunner((command) => {
		if (command.program === CHECKPOINTER && command.args[0] === "restore") {
			return gitOutput("", control.restoreExit === 0 ? "" : "restore failed", control.restoreExit);
		}
		if (command.program === CHECKPOINTER && command.args[0] === "save") {
			if (control.saveExit === 0) control.refs.add(REF);
			return gitOutput("", "", control.saveExit);
		}
		if (command.program === BUSY_CHECK) return gitOutput(`${control.busy}\n`);
		if (command.program !== "git") return gitUnscripted(command);
		if (command.args[0] === "show-ref") {
			return gitOutput("", "", control.refs.has(command.args.at(-1) ?? "") ? 0 : 1);
		}
		if (command.args[0] === "update-ref" && command.args[1] === "-d") {
			control.refs.delete(command.args.at(-1) ?? "");
			return gitOutput();
		}
		if (command.args[0] === "branch" && command.args[1] === "--show-current") {
			return gitOutput(control.branch === "" ? "" : `${control.branch}\n`);
		}
		if (command.args[0] === "for-each-ref") {
			return gitOutput(`${[...control.refs].join("\n")}\n`);
		}
		return gitUnscripted(command);
	});
	return { git, control };
}

interface HarnessOptions {
	refs?: Set<string>;
	busy?: string;
	branch?: string;
	saveExit?: number;
	restoreExit?: number;
	config?: RepoConfig;
	workspaceFor?: (id: WorkspaceId) => Promise<Result<Workspace>>;
	repoFor?: (id: WorkspaceId) => Promise<Result<Repo>>;
	runScript?: (
		input: Parameters<SpotlightServiceDeps["terminals"]["runScript"]>[0],
	) => Promise<Result<{ terminalId: TerminalId; exit: Promise<number | null> }>>;
	stop?: (id: TerminalId) => Promise<Result<void>>;
	stopRuns?: (id: WorkspaceId) => Promise<Result<void>>;
	openRepoTerminal?: (id: RepoId) => Promise<Result<Terminal>>;
	watchexecPath?: () => Promise<Result<string>>;
}

function harness(options: HarnessOptions = {}) {
	const { git, control } = gitHarness(options);
	const terminalIds: TerminalId[] = [];
	const runScript =
		options.runScript ??
		vi.fn(async () => {
			const terminalId = terminalIds.length === 0 ? TERMINAL_ID : OTHER_TERMINAL_ID;
			terminalIds.push(terminalId);
			return ok({ terminalId, exit: new Promise<number | null>(() => {}) });
		});
	const stop = options.stop ?? vi.fn(async () => ok(undefined));
	const stopRuns = options.stopRuns ?? vi.fn(async () => ok(undefined));
	const openRepoTerminal =
		options.openRepoTerminal ?? vi.fn(async (id: RepoId) => ok(terminal(TERMINAL_ID, id)));
	const config = options.config ?? baseConfig();
	const service = new SpotlightService({
		git,
		terminals: { runScript, stop } as never,
		checkpointerPath: CHECKPOINTER,
		spotlighterPath: SPOTLIGHTER,
		busyCheckPath: BUSY_CHECK,
		watchexecPath: options.watchexecPath ?? (async () => ok(WATCHEXEC)),
		configFor: async () => ok(config),
		workspaceFor: options.workspaceFor ?? (async () => ok(baseWorkspace())),
		repoFor: options.repoFor ?? (async () => ok(baseRepo)),
		stopRuns,
		openRepoTerminal,
		log: vi.fn(),
	});
	return { service, git, control, runScript, stop, stopRuns, openRepoTerminal };
}

const commandText = (command: { program: string; args: readonly string[] }): string =>
	[command.program, ...command.args].join(" ");

describe("RUN-02 healing a repository root after a crash", () => {
	it("changes nothing when no pre-spotlight checkpoint is left", async () => {
		const { service, git } = harness();

		await expect(service.healAfterCrash(ROOT)).resolves.toEqual(ok(false));
		expect(git.commands.map((command) => command.args[0])).toEqual(["show-ref"]);
		expect(git.calls[0]?.options.cwd).toBe(ROOT);
	});

	it("restores a leftover checkpoint in the root, then deletes its ref", async () => {
		const { service, git, control } = harness({ refs: new Set([REF]) });

		await expect(service.healAfterCrash(ROOT)).resolves.toEqual(ok(true));
		expect(git.commands.map(commandText)).toEqual([
			`git show-ref --verify --quiet ${REF}`,
			`${CHECKPOINTER} restore ${PRE_SPOTLIGHT_CHECKPOINT_ID}`,
			`git update-ref -d ${REF}`,
		]);
		expect(git.calls.every((call) => call.options.cwd === ROOT)).toBe(true);
		expect(git.worktreeLocks).toEqual([ROOT]);
		expect(control.refs.size).toBe(0);
	});

	it("keeps the checkpoint when the restore fails, so the next start tries again", async () => {
		const { service, git, control } = harness({
			refs: new Set([REF]),
			restoreExit: 1,
		});

		const healed = await service.healAfterCrash(ROOT);

		expect(healed.ok).toBe(false);
		if (healed.ok) return;
		expect(healed.error.code).toBe("spotlight_restore_failed");
		expect(healed.error.message).toContain("the next start tries again");
		expect(control.refs.has(REF)).toBe(true);
		expect(git.commands.some((command) => command.args[0] === "update-ref")).toBe(false);
	});
});

describe("RUN-02 preflight of the repository root", () => {
	it("accepts a clean root that is on a branch", async () => {
		const { service, git } = harness();

		await expect(service.preflight(ROOT)).resolves.toEqual(ok({ ok: true, problem: null }));
		expect(git.commands.map(commandText)).toEqual([
			`${BUSY_CHECK} ${ROOT}`,
			"git branch --show-current",
		]);
	});

	it("asks the user to abort a merge in progress", async () => {
		const { service, git } = harness({ busy: "busy:merge" });

		const result = await service.preflight(ROOT);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.ok).toBe(false);
		expect(result.value.problem).toContain("git merge --abort");
		expect(result.value.problem).toContain("root repository");
		expect(git.commands.map((command) => command.args[0])).not.toContain("--show-current");
	});

	it("asks the user to abort a rebase in progress", async () => {
		const { service } = harness({ busy: "busy:rebase" });

		const result = await service.preflight(ROOT);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.problem).toContain("git rebase --abort");
	});

	it("asks the user to check out a branch when HEAD is detached", async () => {
		const { service } = harness({ branch: "" });

		const result = await service.preflight(ROOT);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.ok).toBe(false);
		expect(result.value.problem).toContain("not on a branch");
		expect(result.value.problem).toContain("Check out a branch");
	});
});

describe("RUN-02 starting Spotlight", () => {
	it("heals a leftover checkpoint before saving a new one and running the sync", async () => {
		const { service, git, control, runScript } = harness({ refs: new Set([REF]) });

		const started = await service.start(WORKSPACE_ID);

		expect(started).toEqual(ok(undefined));
		const commands = git.commands.map(commandText);
		const restored = commands.indexOf(`${CHECKPOINTER} restore ${PRE_SPOTLIGHT_CHECKPOINT_ID}`);
		const deleted = commands.indexOf(`git update-ref -d ${REF}`);
		const saved = commands.indexOf(
			`${CHECKPOINTER} save --id ${PRE_SPOTLIGHT_CHECKPOINT_ID} --force`,
		);
		expect(commands[0]).toBe(`git show-ref --verify --quiet ${REF}`);
		expect(restored).toBeGreaterThan(0);
		expect(deleted).toBeGreaterThan(restored);
		expect(saved).toBeGreaterThan(deleted);
		expect(control.refs.has(REF)).toBe(true);
		expect(runScript).toHaveBeenCalledTimes(1);
	});

	it("saves the repository root and runs the spotlighter in the workspace terminal", async () => {
		const { service, git, runScript, openRepoTerminal } = harness();

		const started = await service.start(WORKSPACE_ID);

		expect(started).toEqual(ok(undefined));
		expect(git.commands.map(commandText)).toContain(
			`${CHECKPOINTER} save --id ${PRE_SPOTLIGHT_CHECKPOINT_ID} --force`,
		);
		const save = git.calls.find(
			(call) => call.command.program === CHECKPOINTER && call.command.args[0] === "save",
		);
		expect(save?.options.cwd).toBe(ROOT);
		expect(git.worktreeLocks).toContain(ROOT);
		expect(runScript).toHaveBeenCalledWith({
			workspaceId: WORKSPACE_ID,
			kind: "spotlight",
			title: "Spotlight",
			command: `bash ${SPOTLIGHTER}`,
			cwd: WORKSPACE_PATH,
			env: {
				CONDUCTED_ROOT_PATH: ROOT,
				CONDUCTED_CHECKPOINTER_PATH: CHECKPOINTER,
				CONDUCTED_WATCHEXEC_PATH: WATCHEXEC,
			},
		});
		expect(service.store.getState().active[WORKSPACE_ID]).toEqual({
			active: true,
			terminalId: TERMINAL_ID,
		});
		expect(openRepoTerminal).toHaveBeenCalledWith(REPO_ID);
	});

	it("starts no sync when the app's watchexec is not installed, and names it", async () => {
		const { service, runScript } = harness({
			watchexecPath: async () =>
				err(
					appError(
						"program_not_installed",
						"watchexec is not installed. Retry its download in Settings > Advanced.",
					),
				),
		});

		const started = await service.start(WORKSPACE_ID);

		expect(started.ok).toBe(false);
		if (!started.ok) {
			expect(started.error.code).toBe("program_not_installed");
			expect(started.error.message).toContain("watchexec");
			expect(started.error.message).toContain("Retry");
		}
		expect(runScript).not.toHaveBeenCalled();
	});

	it("refuses to start when Spotlight testing is off for the repository", async () => {
		const { service, git, runScript } = harness({
			config: baseConfig({ spotlightTesting: false }),
		});

		const started = await service.start(WORKSPACE_ID);

		expect(started.ok).toBe(false);
		if (started.ok) return;
		expect(started.error.code).toBe("spotlight_disabled");
		expect(git.commands).toHaveLength(0);
		expect(runScript).not.toHaveBeenCalled();
	});

	it("refuses to start when the root has a merge in progress", async () => {
		const { service, git, runScript } = harness({ busy: "busy:merge" });

		const started = await service.start(WORKSPACE_ID);

		expect(started.ok).toBe(false);
		if (started.ok) return;
		expect(started.error.code).toBe("spotlight_preflight_failed");
		expect(started.error.message).toContain("git merge --abort");
		expect(git.commands.some((command) => command.args[0] === "save")).toBe(false);
		expect(runScript).not.toHaveBeenCalled();
	});

	it("reports a root that could not be saved and starts no sync", async () => {
		const { service, runScript } = harness({ saveExit: 101 });

		const started = await service.start(WORKSPACE_ID);

		expect(started.ok).toBe(false);
		if (started.ok) return;
		expect(started.error.code).toBe("spotlight_save_failed");
		expect(runScript).not.toHaveBeenCalled();
		expect(service.store.getState().active[WORKSPACE_ID]).toBeUndefined();
	});

	it("stops the workspace's run actions first", async () => {
		const { service, stopRuns } = harness();

		await service.start(WORKSPACE_ID);

		expect(stopRuns).toHaveBeenCalledWith(WORKSPACE_ID);
	});

	it("stops another workspace's Spotlight before starting this one", async () => {
		const workspaces: Record<string, Workspace> = {
			[WORKSPACE_ID]: baseWorkspace(WORKSPACE_ID, WORKSPACE_PATH),
			[OTHER_WORKSPACE_ID]: baseWorkspace(OTHER_WORKSPACE_ID, OTHER_WORKSPACE_PATH),
		};
		const { service, stop, runScript } = harness({
			workspaceFor: async (id) => ok(workspaces[id] as Workspace),
		});

		await service.start(WORKSPACE_ID);
		await service.start(OTHER_WORKSPACE_ID);

		expect(stop).toHaveBeenCalledWith(TERMINAL_ID);
		expect(runScript).toHaveBeenCalledTimes(2);
		expect(service.store.getState().active[WORKSPACE_ID]).toBeUndefined();
		expect(service.store.getState().active[OTHER_WORKSPACE_ID]?.active).toBe(true);
	});

	it("serialises two starts and leaves the second terminal active", async () => {
		const releases: (() => void)[] = [];
		let calls = 0;
		const runScript = vi.fn(
			async () =>
				await new Promise<Result<{ terminalId: TerminalId; exit: Promise<number | null> }>>(
					(resolve) => {
						const id = calls === 0 ? TERMINAL_ID : OTHER_TERMINAL_ID;
						calls += 1;
						releases.push(() =>
							resolve(ok({ terminalId: id, exit: new Promise<number | null>(() => {}) })),
						);
					},
				),
		);
		const { service, stop } = harness({ runScript });

		const first = service.start(WORKSPACE_ID);
		const second = service.start(WORKSPACE_ID);
		await vi.waitFor(() => expect(releases).toHaveLength(1));
		releases.shift()?.();
		await first;
		await vi.waitFor(() => expect(releases).toHaveLength(1));
		releases.shift()?.();
		await second;

		expect(stop).toHaveBeenCalledWith(TERMINAL_ID);
		expect(service.store.getState().active[WORKSPACE_ID]).toEqual({
			active: true,
			terminalId: OTHER_TERMINAL_ID,
		});
	});
});

describe("RUN-02 stopping Spotlight", () => {
	it("stops the sync, restores the root, then deletes the checkpoint", async () => {
		const { service, git, stop, control } = harness();
		await service.start(WORKSPACE_ID);
		const startedAt = git.commands.length;
		control.refs.add(REF);

		const stopped = await service.stop(WORKSPACE_ID);

		expect(stopped).toEqual(ok(undefined));
		expect(stop).toHaveBeenCalledWith(TERMINAL_ID);
		const after = git.commands.slice(startedAt).map(commandText);
		expect(after).toEqual([
			`git show-ref --verify --quiet ${REF}`,
			`${CHECKPOINTER} restore ${PRE_SPOTLIGHT_CHECKPOINT_ID}`,
			`git update-ref -d ${REF}`,
			`git for-each-ref --format=%(refname) refs/conducted/checkpoints/`,
		]);
		expect(control.refs.has(REF)).toBe(false);
		expect(service.store.getState().active[WORKSPACE_ID]).toBeUndefined();
	});

	it("removes the sync loop's checkpoints when Spotlight stops", async () => {
		const { service, control } = harness();
		await service.start(WORKSPACE_ID);
		const syncRef = checkpointRef("cp-spotlight-1700000000-42");
		control.refs.add(REF);
		control.refs.add(syncRef);

		const stopped = await service.stop(WORKSPACE_ID);

		expect(stopped).toEqual(ok(undefined));
		expect(control.refs.has(syncRef)).toBe(false);
		expect(control.refs.has(REF)).toBe(false);
	});

	it("keeps the checkpoint and reports the failure when the restore fails", async () => {
		const { service, control } = harness();
		await service.start(WORKSPACE_ID);
		control.refs.add(REF);
		control.restoreExit = 1;

		const stopped = await service.stop(WORKSPACE_ID);

		expect(stopped.ok).toBe(false);
		if (stopped.ok) return;
		expect(stopped.error.code).toBe("spotlight_restore_failed");
		expect(control.refs.has(REF)).toBe(true);
		expect(service.store.getState().active[WORKSPACE_ID]).toBeUndefined();
	});

	it("does nothing when Spotlight is not running", async () => {
		const { service, git, stop } = harness();

		await expect(service.stop(WORKSPACE_ID)).resolves.toEqual(ok(undefined));
		expect(stop).not.toHaveBeenCalled();
		expect(git.commands).toHaveLength(0);
	});
});

describe("RUN-02 the real container reaches Spotlight", () => {
	it("calls the Spotlight service from the Run action", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container, { rootPath: ROOT });
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: WORKSPACE_PATH,
			});
			const start = vi
				.spyOn(test.container.services.spotlight, "start")
				.mockResolvedValue(ok(undefined));

			const result = await test.container.actions.run.startSpotlight(workspace.id);

			expect(result).toEqual(ok(undefined));
			expect(start).toHaveBeenCalledWith(workspace.id);
		} finally {
			test.close();
		}
	});
});

describe("RUN-02 a stop that is not confirmed, and a sync that ends by itself", () => {
	it("restores nothing and keeps Spotlight on when the stop is not confirmed", async () => {
		const unconfirmed = err(
			appError("run_stop_unconfirmed", "The process did not stop within 20 seconds."),
		);
		const { service, git, control } = harness({ stop: vi.fn(async () => unconfirmed) });
		await service.start(WORKSPACE_ID);
		const startedAt = git.commands.length;

		const stopped = await service.stop(WORKSPACE_ID);

		expect(stopped).toEqual(unconfirmed);
		expect(git.commands.slice(startedAt)).toHaveLength(0);
		expect(control.refs.has(REF)).toBe(true);
		expect(service.store.getState().active[WORKSPACE_ID]).toEqual({
			active: true,
			terminalId: TERMINAL_ID,
		});
	});

	it("restores the root and turns Spotlight off when the sync loop exits by itself", async () => {
		let exit: (code: number | null) => void = () => {};
		const { service, control, stop } = harness({
			runScript: vi.fn(async () =>
				ok({
					terminalId: TERMINAL_ID,
					exit: new Promise<number | null>((resolve) => {
						exit = resolve;
					}),
				}),
			),
		});
		await service.start(WORKSPACE_ID);
		expect(control.refs.has(REF)).toBe(true);

		exit(64);

		await vi.waitFor(() => expect(service.store.getState().active[WORKSPACE_ID]).toBeUndefined());
		expect(control.refs.has(REF)).toBe(false);
		expect(stop).not.toHaveBeenCalled();
		expect(service.store.getState().problems[WORKSPACE_ID]).toBeUndefined();
	});

	it("keeps the checkpoint and records the problem when the restore after an exit fails", async () => {
		let exit: (code: number | null) => void = () => {};
		const { service, control } = harness({
			runScript: vi.fn(async () =>
				ok({
					terminalId: TERMINAL_ID,
					exit: new Promise<number | null>((resolve) => {
						exit = resolve;
					}),
				}),
			),
		});
		await service.start(WORKSPACE_ID);
		control.restoreExit = 1;

		exit(1);

		await vi.waitFor(() =>
			expect(service.store.getState().problems[WORKSPACE_ID]?.code).toBe(
				"spotlight_restore_failed",
			),
		);
		expect(control.refs.has(REF)).toBe(true);
		expect(service.store.getState().active[WORKSPACE_ID]).toBeUndefined();
	});
});

describe("RUN-02 the run list", () => {
	it("adds the synthetic Spotlight entry only while Spotlight testing is on", () => {
		expect(runListFor(baseConfig({ spotlightTesting: false }))).toEqual([]);
		expect(runListFor(baseConfig({ spotlightTesting: true }))).toEqual([
			{
				id: SPOTLIGHT_ACTION_ID,
				label: "Spotlight",
				command: "",
				args: [],
				cwd: null,
				isDefault: false,
				hidden: false,
				icon: "lamp-desk",
				origin: "local",
				availableIn: ["local"],
			},
		]);
	});

	it("leaves Spotlight out of a cloud workspace's run list", () => {
		expect(runListFor(baseConfig({ spotlightTesting: true }), "cloud")).toEqual([]);
	});
});
