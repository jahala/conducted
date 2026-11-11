/**
 * @feature s1-core-1 Join the batch's features through the composition root
 * Owns: one test per feature in the batch, each reached through createTestContainer and the real
 * service or action the app calls.
 * Behaviour: D054 (a feature is reachable from the composition root).
 * Test first: each test fails when its feature's container wiring is removed.
 */
import { idleLiveState, type LiveState } from "@conducted/protocol";
import { type MessageId, ok, type Result, type TurnId } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileDropEvent, ShellOutput } from "../platform/platform.ts";
import { appendChatEvents, checkpointEvent } from "../test/chat-events.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../test/container.ts";
import { draftFile } from "./app-paths.ts";
import { createRepositories } from "./db/repositories.ts";
import { agentEvent, sampleSession, turnEndedEvent, userMessageEvent } from "./db/test-fixtures.ts";
import { checkpointRef, turnCheckpointId } from "./git/refs.ts";
import { buildDeepLink } from "./notifications.ts";
import { CHECKPOINT_PRUNE_AFTER_DAYS } from "./services/checkpoint.ts";
import { GIT_CACHE_VERSION, type GitCacheEntry, prInfoCacheFile } from "./services/git-cache.ts";
import type { WorkspacePrEntry } from "./services/github.ts";
import { type LinearIssue, linearIssueContextPath } from "./services/linear.ts";
import { SETTLE_DELAY_MS } from "./services/notifications.ts";

const DAY = 86_400_000;
const START = 1_800_000_000_000;

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const output = (stdout = "", stderr = "", exitCode = 0): Result<ShellOutput> =>
	ok({ stdout, stderr, exitCode });

/** The git arguments without the runner's `-c core.quotePath=false` prefix. */
const gitArgs = (command: { program: string; args: readonly string[] }): readonly string[] =>
	command.program === "git" && command.args[0] === "-c" ? command.args.slice(2) : command.args;

const working = (): LiveState => ({ ...idleLiveState, status: "working" });

/** Starts the container with the services unrelated to the lifetime job quiet. */
function startForLifetime(test: TestContainer): void {
	const { services } = test.container;
	for (const service of [
		services.repo,
		services.workspace,
		services.sections,
		services.favoriteModels,
		services.terminals,
		services.system,
	]) {
		vi.spyOn(service, "start").mockResolvedValue(ok(undefined) as never);
	}
	vi.spyOn(services.github, "checkAccess").mockResolvedValue(ok({ status: "unknown" }));
	vi.spyOn(services.runScripts, "stopAll").mockResolvedValue(ok(undefined));
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("s1-core-1 join", () => {
	it("CHAT-03 sends a queued message now as a steer through the container action", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const session = must(
				await test.container.services.sessions.create(workspace.id, sampleSession.config),
			);
			must(await test.container.services.sessions.applyLiveState(session.id, working()));
			const repositories = createRepositories(test.database, {
				clock: { now: () => 1000 },
				ids: { uuid: () => crypto.randomUUID() },
			});
			const row = must(
				await repositories.queuedMessages.enqueue({
					id: "join-steer" as MessageId,
					sessionId: session.id,
					text: "Steer this now",
					attachmentPaths: [],
					delivery: "queue",
				}),
			);
			const send = vi
				.spyOn(test.container.services.sessions, "send")
				.mockResolvedValue(ok(undefined));

			const result = await test.container.actions.sessions.queue.sendNowAsSteer(row.id);

			expect(result).toEqual(ok(undefined));
			expect(send).toHaveBeenCalledWith(session.id, "Steer this now", [], "steer", row.id);
			expect(must(await repositories.queuedMessages.get(row.id))).toBeNull();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("CHAT-15 reverts a chat to a turn through the container action", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, { repoId: repo.id });
			const session = must(
				await test.container.services.sessions.create(workspace.id, sampleSession.config),
			);
			const repositories = createRepositories(test.database, {
				clock: { now: () => 0 },
				ids: { uuid: () => crypto.randomUUID() },
			});
			const events = [
				userMessageEvent("e0", "t0", 5),
				agentEvent("e1", "t0", 6, [{ kind: "text", text: "Earlier answer" }]),
				turnEndedEvent("e2", "t0", 7),
				userMessageEvent("e3", "t1", 10),
				agentEvent("e4", "t1", 11, [{ kind: "text", text: "First answer" }]),
				turnEndedEvent("e5", "t1", 12),
				userMessageEvent("e6", "t2", 20),
				agentEvent("e7", "t2", 21, [{ kind: "text", text: "Second answer" }]),
				turnEndedEvent("e8", "t2", 22),
			];
			for (const event of events) {
				must(await repositories.sessionEvents.append(session.id, event, event.at));
			}
			must(await test.container.services.sessions.open(session.id));
			must(await test.container.services.settings.set("reset_chat_also_reset_files", true));
			test.memory.controls.scriptShell((command) => {
				if (command.args.includes("show-ref")) return output("", "", 0);
				if (command.args[0] === "restore") return output();
				return null;
			});

			const reverted = await test.container.actions.sessions.revertTo(session.id, "t1" as TurnId);

			expect(reverted).toEqual(ok(undefined));
			const rows = await repositories.sessionEvents.listFrom(session.id, 0, 100);
			expect(rows.ok).toBe(true);
			if (!rows.ok) return;
			expect(rows.value).toHaveLength(events.length);
			for (const row of rows.value.slice(0, 3)) expect(row.revertedAt).toBeNull();
			for (const row of rows.value.slice(3)) expect(row.revertedAt).not.toBeNull();
			expect(test.container.services.sessions.chatView(session.id)?.turns).toHaveLength(1);
			expect(test.memory.controls.shellCalls.some((command) => command.args[0] === "restore")).toBe(
				true,
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("CHAT-19 notifies when a chat finishes through the live-state path", async () => {
		vi.useFakeTimers();
		const test = createTestContainer({ windowFocused: () => false });
		try {
			const workspace = await seedWorkspace(test.container);
			const session = must(
				await test.container.services.sessions.create(workspace.id, sampleSession.config),
			);
			must(await test.container.services.sessions.rename(session.id, "Join the batch"));
			must(await test.container.services.sessions.applyLiveState(session.id, working()));
			must(await test.container.services.sessions.applyLiveState(session.id, idleLiveState));

			await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS);

			expect(test.memory.controls.notificationsShown).toEqual([
				{
					title: "Join the batch",
					body: "Agent finished. Click to view session.",
					deepLink: buildDeepLink(workspace.id, session.id),
				},
			]);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("DATA-02 runs the data-lifetime job from the startup sequence", async () => {
		let now = START;
		const test = createTestContainer({ clock: { now: () => now } });
		try {
			const fs = test.memory.platform.fs;
			const file = draftFile(fs.paths, "old-chat");
			now = START - 31 * DAY;
			must(await fs.writeTextAtomic(file, "{}"));
			now = START;

			startForLifetime(test);
			expect((await test.container.start()).ok).toBe(true);

			expect(await fs.exists(file)).toBe(false);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("DATA-06 prunes a deleted chat's checkpoint refs through the chat service", async () => {
		const test = createTestContainer();
		try {
			must(await test.container.platform.fs.mkdirp("/code/join-data-06"));
			const repo = await seedRepo(test.container, { rootPath: "/code/join-data-06" });
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: "/code/join-data-06/worktree",
			});
			const session = must(
				await test.container.services.sessions.create(workspace.id, sampleSession.config),
			);
			const refs = new Set([
				checkpointRef(turnCheckpointId(session.id, "turn-1", "start")),
				checkpointRef(turnCheckpointId(session.id, "turn-1", "end")),
			]);
			test.memory.controls.scriptShell((command) => {
				if (command.program !== "git") return null;
				if (command.args.includes("for-each-ref")) {
					const prefix = command.args.at(-1) ?? "";
					return output([...refs].filter((ref) => ref.startsWith(prefix)).join("\n"));
				}
				if (command.args.includes("update-ref") && command.args.includes("-d")) {
					refs.delete(command.args.at(-1) ?? "");
					return output();
				}
				return null;
			});

			expect(await test.container.services.sessions.delete(session.id)).toEqual(ok(undefined));
			expect([...refs]).toEqual([]);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("DATA-06 prunes refs 30 days after the workspace was archived", async () => {
		let now = START;
		const test = createTestContainer({ clock: { now: () => now } });
		try {
			const repo = await seedRepo(test.container, { rootPath: "/code/join-archive" });
			const repositories = createRepositories(test.database, {
				clock: { now: () => now },
				ids: { uuid: () => crypto.randomUUID() },
			});
			const workspace = must(
				await repositories.workspaces.create({
					repoId: repo.id,
					directoryName: "old",
					path: "/code/join-archive/old",
					branch: "jahala/old",
					branchIsPlaceholder: true,
					host: { kind: "local" },
					targetBranch: "origin/main",
					port: 55_101,
					linkedPaths: [],
					setupLogPath: null,
				}),
			);
			must(
				await repositories.workspaces.transitionState(workspace.id, "initializing", "archiving"),
			);
			now = START - 40 * DAY;
			must(await repositories.workspaces.markArchived(workspace.id, "sha"));
			now = START;
			const session = must(
				await repositories.sessions.create({
					workspaceId: workspace.id,
					title: "old chat",
					config: sampleSession.config,
				}),
			);
			const refs = new Set([
				checkpointRef(turnCheckpointId(session.id, "turn-1", "start")),
				checkpointRef(turnCheckpointId(session.id, "turn-1", "end")),
			]);
			test.memory.controls.scriptShell((command) => {
				if (command.program !== "git") return null;
				if (command.args.includes("for-each-ref")) {
					const prefix = command.args.at(-1) ?? "";
					return output([...refs].filter((ref) => ref.startsWith(prefix)).join("\n"));
				}
				if (command.args.includes("update-ref") && command.args.includes("-d")) {
					refs.delete(command.args.at(-1) ?? "");
					return output();
				}
				return null;
			});

			expect(
				await test.container.services.checkpoint.pruneArchived(CHECKPOINT_PRUNE_AFTER_DAYS),
			).toEqual(ok(2));
			expect([...refs]).toEqual([]);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("GIT-03 stores a rewritten remote on the snapshot the git service reads", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			must(await test.container.services.repo.loadConfig(repo.id));
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				branch: "feature",
			});
			test.memory.controls.scriptShell((command) => {
				if (command.program === "stat") return output("", "", 1);
				if (command.program !== "git") return null;
				const args = command.args;
				if (args.includes("--show-current")) return output("feature\n");
				if (args.includes("--git-path")) return output(`/git/${args.at(-1) ?? ""}\n`);
				if (args.includes("merge-base")) return output("merge-base\n");
				if (args.includes("--name-status") || args.includes("--numstat")) return output("");
				if (args.includes("status")) return output("");
				if (args.includes("ls-files")) return output("");
				if (args.includes("--symbolic-full-name")) return output("refs/remotes/origin/feature\n");
				if (args.includes("@{u}")) return output("head-oid\nupstream-oid\n");
				// The remote once pointed at the local tip, then a force-push moved it away.
				if (args.includes("reflog")) return output("upstream-oid\nhead-oid\n");
				if (args.includes("--left-right")) return output("2\t5\n");
				if (args.includes("--count")) return output("4\n");
				if (args.includes("log")) return output("");
				return null;
			});

			expect((await test.container.services.git.refresh(workspace.id, "full")).ok).toBe(true);
			expect(test.container.services.git.stateOf(workspace.id)?.sync).toEqual({
				ahead: 5,
				behind: 2,
				rewritten: true,
				hasUpstream: true,
			});
		} finally {
			test.container.services.repo.dispose();
			await test.container.stop();
			test.close();
		}
	});

	it("GIT-12 lists branches and switches branch through the container action", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container, { rootPath: "/code/join-git-12" });
			must(await test.container.services.repo.loadConfig(repo.id));
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: "/code/join-git-12/worktree",
				branch: "main",
			});
			test.memory.controls.scriptShell((command) => {
				if (command.program === "stat") return output("", "", 1);
				const args =
					command.program === "git" && command.args[0] === "-c"
						? command.args.slice(2)
						: command.args;
				if (args[0] === "fetch") return output();
				if (args[0] === "branch" && args[1]?.startsWith("--format")) {
					return output("main\nfeature\n");
				}
				if (args[0] === "branch" && args[1] === "--show-current") return output("feature\n");
				if (args[0] === "for-each-ref") return output("origin/main\norigin/feature\norigin/HEAD\n");
				if (args[0] === "worktree" && args[1] === "list") {
					return output("worktree /code/join-git-12/worktree\nHEAD aaa\nbranch refs/heads/main\n");
				}
				if (args[0] === "checkout") return output();
				if (args[0] === "symbolic-ref") return output("refs/heads/feature\n");
				if (args[0] === "show-ref") return output("", "", 0);
				if (args[0] === "merge-base" && args[1] === "--is-ancestor") return output();
				if (args[0] === "merge") return output();
				if (args[0] === "rev-parse" && args[1] === "--git-path") {
					return output(`/git/${args.at(-1) ?? ""}\n`);
				}
				if (args[0] === "rev-parse") return output("", "fatal: no upstream", 128);
				if (args[0] === "merge-base") return output("mb\n");
				if (args[0] === "diff") return output();
				if (args[0] === "status") return output();
				if (args[0] === "ls-files") return output();
				if (args[0] === "rev-list") return output("0\n");
				if (args[0] === "log") return output("");
				return null;
			});

			expect(await test.container.services.git.listBranches(repo.rootPath, "origin")).toEqual(
				ok({
					local: ["main", "feature"],
					remote: ["main", "feature"],
					checkedOut: ["main"],
				}),
			);
			expect(await test.container.actions.git.switchBranch(workspace.id, "feature")).toEqual(
				ok(undefined),
			);
			expect(
				test.container.services.workspace.store.getState().workspacesById[workspace.id]?.branch,
			).toBe("feature");
		} finally {
			test.container.services.repo.dispose();
			await test.container.stop();
			test.close();
		}
	});

	it("PLAT-33 delivers dropped file paths and the attachment and menu doors", async () => {
		const test = createTestContainer();
		try {
			const dropped: FileDropEvent[] = [];
			const stopDrops = test.container.platform.window.onFileDrop((event) => dropped.push(event));
			test.memory.controls.emitFileDrop({
				kind: "drop",
				paths: ["/Users/me/notes.txt"],
				x: 3,
				y: 4,
			});
			expect(dropped).toEqual([{ kind: "drop", paths: ["/Users/me/notes.txt"], x: 3, y: 4 }]);
			stopDrops();

			const fs = test.container.platform.fs;
			must(await fs.writeTextAtomic("/tmp/join-note.txt", "hello"));
			const materialized = await test.container.platform.attachments.materialize(
				"/tmp/join-note.txt",
				"/tmp/join-copy.txt",
				{ resizeImage: true },
			);
			expect(materialized.ok).toBe(true);
			const resized = await test.container.platform.attachments.resizeImage(
				"/tmp/join-note.txt",
				"/tmp/join-small.txt",
			);
			expect(resized.ok).toBe(true);
			expect(
				await test.container.platform.menu.setShortcuts([
					{ commandId: "palette.open", accelerator: "Cmd+K" },
				]),
			).toEqual(ok({ applied: ["palette.open"], rejected: [] }));
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("CHAT-16 forks a chat from a checkpointed turn through the container action", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const session = must(
				await test.container.services.sessions.create(workspace.id, sampleSession.config),
			);
			await appendChatEvents(test.container, session.id, [
				userMessageEvent("e1", "t1", 10),
				checkpointEvent("c1", "t1", 11, "start", "start-1"),
				agentEvent("a1", "t1", 12, [{ kind: "text", text: "First answer" }]),
				checkpointEvent("c2", "t1", 13, "end", "end-1"),
				turnEndedEvent("e2", "t1", 14),
				userMessageEvent("e3", "t2", 20),
			]);

			const forked = must(
				await test.container.actions.sessions.forkFrom(session.id, "t1" as TurnId),
			);

			expect(forked.id).not.toBe(session.id);
			expect(forked.workspaceId).toBe(workspace.id);
			const repositories = createRepositories(test.database, {
				clock: { now: () => 0 },
				ids: { uuid: () => crypto.randomUUID() },
			});
			const copied = must(await repositories.sessionEvents.listFrom(forked.id, 0, 100));
			expect(copied.map((row) => row.event.eventId)).toEqual(["e1", "c1", "a1", "c2", "e2"]);
			expect(test.container.services.sessions.store.getState().byWorkspace[workspace.id]).toContain(
				forked.id,
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("CHAT-17 copies a transcript and searches stored messages through the container", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const session = must(
				await test.container.services.sessions.create(workspace.id, sampleSession.config),
			);
			await appendChatEvents(test.container, session.id, [
				userMessageEvent("e1", "t1", 100),
				agentEvent("e2", "t1", 110, [{ kind: "text", text: "The login bug is fixed." }]),
			]);

			expect(await test.container.actions.sessions.copyTranscript(session.id, "concise")).toEqual(
				ok(undefined),
			);
			const copied = test.memory.controls.clipboardText ?? "";
			expect(copied).toContain("Fix the login bug");
			expect(copied).toContain("The login bug is fixed.");

			const hits = must(await test.container.services.sessions.searchHistory("login", 10));
			expect(hits.map((hit) => hit.sessionId)).toEqual([session.id, session.id]);
			expect(hits.map((hit) => hit.excerpt)).toEqual([
				"The login bug is fixed.",
				"Fix the login bug",
			]);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("DATA-07 saves and reads pull request info through the container's cache", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const entry: GitCacheEntry<WorkspacePrEntry> = {
				version: GIT_CACHE_VERSION,
				workspaceId: workspace.id,
				branch: workspace.branch,
				observedAt: 1_700_000_000_000,
				value: { pullRequest: null, unavailable: "no_pr", fetchedAt: null },
			};

			expect(await test.container.services.gitCache.savePrInfo(entry)).toEqual(ok(undefined));
			const loaded = must(
				await test.container.services.gitCache.loadPrInfo(workspace.id, workspace.branch),
			);
			expect(loaded).toEqual(entry);
			expect(
				await test.container.platform.fs.exists(
					prInfoCacheFile(test.container.platform.fs.paths, workspace.id),
				),
			).toBe(true);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("GIT-14 reads local-forge pull request info through the container's forge", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container, {
				rootPath: "/code/projects/join-git-14",
				remoteUrl: null,
			});
			must(await test.container.services.repo.loadConfig(repo.id));
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: "/code/workspaces/join-git-14",
				branch: "feature/local",
				targetBranch: "origin/main",
			});
			must(await test.container.services.settings.set("local_git_forge_enabled", true));
			test.memory.controls.scriptShell((command) => {
				const args = gitArgs(command);
				if (args[0] === "rev-list") return output("1\t2\n");
				if (args[0] === "merge-tree") return output("tree-oid\n", "", 1);
				return null;
			});

			const info = must(await test.container.services.localGitForge.synthesizePrInfo(workspace.id));
			expect(info).toEqual({ ahead: 2, behind: 1, mergeState: "DIRTY" });
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("GIT-15 opens the external diff tool and edits sparse checkout through the container", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container, { rootPath: "/code/projects/join-git-15" });
			must(await test.container.services.repo.loadConfig(repo.id));
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: "/code/workspaces/join-git-15",
			});
			let sparseEnabled = false;
			test.memory.controls.scriptShell((command) => {
				const args = gitArgs(command);
				if (args[0] === "diff" && args[1] === "--quiet") return output("", "", 1);
				if (args[0] === "-c" && args[1]?.startsWith("difftool.ksdiff.cmd=")) return output();
				if (args[0] === "config" && args.at(-1) === "core.sparseCheckout") {
					return sparseEnabled ? output("true\n") : output("", "", 1);
				}
				if (args[0] === "sparse-checkout" && args[1] === "init") {
					sparseEnabled = true;
					return output();
				}
				if (args[0] === "sparse-checkout" && args[1] === "set") return output();
				if (args[0] === "sparse-checkout" && args[1] === "list") return output("apps\n");
				if (args[0] === "ls-tree") return output("apps\npackages\n");
				return null;
			});

			expect(
				await test.container.services.git.setSparseCheckoutDirectories(workspace.id, ["apps"]),
			).toEqual(ok(undefined));
			expect(await test.container.services.git.sparseCheckoutSettings(workspace.id)).toEqual(
				ok({ enabled: true, directories: ["apps"], topLevelDirectories: ["apps", "packages"] }),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("PR-08 reads a stacked pull request through the container's GitHub service", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container, {
				rootPath: "/code/projects/join-pr-08",
				remoteUrl: "git@github.com:o/r.git",
			});
			must(await test.container.services.repo.loadConfig(repo.id));
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: "/code/workspaces/join-pr-08",
				branch: "feat-b",
			});
			const repositories = createRepositories(test.database, {
				clock: { now: () => 0 },
				ids: { uuid: () => crypto.randomUUID() },
			});
			must(
				await repositories.workspaces.setPullRequest(workspace.id, {
					number: 12,
					title: "Use the parser",
					description: null,
				}),
			);
			must(await test.container.services.workspace.start());
			must(await test.container.services.settings.set("github_stacked_prs_enabled", true));
			const stackAnswer = JSON.stringify({
				data: {
					repository: {
						pullRequest: {
							number: 12,
							stackEntry: { position: 2, stack: { number: 5, size: 3, baseRefName: "main" } },
						},
					},
				},
			});
			const membersAnswer = JSON.stringify({
				pull_requests: [
					{
						number: 10,
						title: "Add the parser",
						state: "OPEN",
						draft: false,
						head: { ref: "feat-a", sha: "a1" },
						base: { ref: "main", sha: "m0" },
					},
					{
						number: 11,
						title: "Use the parser",
						state: "OPEN",
						draft: false,
						head: { ref: "feat-b", sha: "b1" },
						base: { ref: "feat-a", sha: "a1" },
					},
					{
						number: 12,
						title: "Document the parser",
						state: "OPEN",
						draft: true,
						head: { ref: "feat-c", sha: "c1" },
						base: { ref: "feat-b", sha: "b1" },
					},
				],
			});
			test.memory.controls.scriptShell((command) => {
				if (command.program === "git" && gitArgs(command).includes("get-url")) {
					return output("git@github.com:o/r.git\n");
				}
				if (command.program === "gh" && command.args.includes("graphql")) {
					return output(stackAnswer);
				}
				if (
					command.program === "gh" &&
					command.args[0] === "api" &&
					command.args[1]?.includes("/stacks/5") === true
				) {
					return output(membersAnswer);
				}
				return null;
			});

			const entries = must(await test.container.services.github.readStack(workspace.id));
			expect(entries.map((entry) => entry.branch)).toEqual(["feat-a", "feat-b", "feat-c"]);
			expect(entries.map((entry) => entry.isCurrent)).toEqual([false, true, false]);
			expect(entries[2]?.state).toBe("draft");
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("PR-09 writes a Linear issue into the workspace through the container's service", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const issue: LinearIssue = {
				id: "issue-uuid-1",
				identifier: "ENG-12",
				title: "The list loses its place",
				description: "Scrolling resets when a new row arrives.",
				url: "https://linear.app/acme/issue/ENG-12",
				branchName: "eng-12-list-place",
				createdAt: 1_700_000_000_000,
				updatedAt: 1_700_100_000_000,
				state: { name: "In progress", type: "started" },
				assignee: "Ada",
				priorityLabel: "High",
				labels: ["Bug"],
				team: { id: "team-1", name: "Engineering", key: "ENG" },
				comments: [],
			};

			const relative = must(
				await test.container.services.linear.attachAsContext(issue, workspace.path),
			);
			expect(relative).toBe(linearIssueContextPath(issue));
			expect(test.memory.controls.files.get(`${workspace.path}/${relative}`)).toContain(
				"# ENG-12: The list loses its place",
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("PRJ-03 quick-starts a project from a template through the container action", async () => {
		const test = createTestContainer();
		try {
			must(await test.container.platform.fs.mkdirp("/code/join-prj-03"));
			test.memory.controls.scriptShell((command) => {
				const args = gitArgs(command);
				if (command.program === "git" && args[0] === "remote") {
					return output("", "fatal: no such remote", 1);
				}
				if (command.program === "git" && args[0] === "symbolic-ref") {
					return output("", "fatal: no such ref", 128);
				}
				if (command.program === "git" && args[0] === "branch") return output("main\n");
				if (command.program === "git" && args[0] === "init") return output("Initialized\n");
				if (command.program === "git" && args[0] === "add") return output();
				if (command.program === "git" && args[0] === "commit") return output();
				return null;
			});

			const repo = must(
				await test.container.actions.projects.createFromTemplate(
					"My App!",
					"/code/join-prj-03",
					"empty",
				),
			);

			expect(repo.name).toBe("my-app");
			expect(repo.rootPath).toBe("/code/join-prj-03/my-app");
			expect(test.memory.controls.files.get("/code/join-prj-03/my-app/.gitkeep")).toBe("");
			expect(test.container.services.repo.store.getState().order).toEqual([repo.id]);
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
