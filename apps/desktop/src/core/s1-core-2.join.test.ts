/**
 * @feature s1-core-2 Join the batch's features through the composition root
 * Owns: one test per feature in the batch, each reached through createTestContainer and the real
 * service or action the app calls.
 * Behaviour: D054 (a feature is reachable from the composition root).
 * Test first: each test fails when its feature's container wiring is removed.
 */
import type { SessionConfig } from "@conducted/protocol";
import { type CommentId, ok, type Result, type TerminalId } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShellCommand, ShellOutput } from "../platform/platform.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../test/container.ts";
import { programsBinDir } from "./app-paths.ts";
import { createRepositories } from "./db/repositories.ts";
import { sessionConfig } from "./db/test-fixtures.ts";
import { ChatTitleService } from "./services/chat-titles.ts";
import type { GithubReviewThread } from "./services/github.ts";

const LSOF_TIMEOUT_MS = 10_000;

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const output = (stdout = "", stderr = "", exitCode = 0): Result<ShellOutput> =>
	ok({ stdout, stderr, exitCode });

/** Drops the `-c core.quotePath=false` the git runner puts in front of every git command. */
const gitArgs = (command: ShellCommand): readonly string[] =>
	command.program === "git" && command.args[0] === "-c" ? command.args.slice(2) : command.args;

afterEach(() => {
	vi.restoreAllMocks();
});

describe("s1-core-2 join", () => {
	it("PR-06 marks a pull request ready through the container's actions", async () => {
		const harness = createTestContainer();
		const seen: ShellCommand[] = [];
		try {
			const repo = await seedRepo(harness.container, { rootPath: "/code/pr-06" });
			const workspace = await seedWorkspace(harness.container, {
				repoId: repo.id,
				path: "/code/pr-06/workspace",
				branch: "feat",
			});
			must(await harness.container.services.repo.loadConfig(repo.id));
			harness.container.services.workspace.store.setState((state) => ({
				workspacesById: {
					...state.workspacesById,
					[workspace.id]: { ...workspace, prNumber: 12 },
				},
			}));
			harness.memory.controls.scriptShell((command) => {
				if (command.program !== "gh") return null;
				seen.push(command);
				return output();
			});

			const result = await harness.container.actions.pullRequests.markReady(workspace.id);

			expect(result).toEqual(ok(undefined));
			expect(seen.map((command) => [...command.args])).toContainEqual(["pr", "ready", "12"]);
		} finally {
			await harness.container.stop();
			harness.close();
		}
	});

	it("RUN-03 allocates a port block through the container's port service", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			await seedWorkspace(test.container, { repoId: repo.id, port: 55_000 });
			await seedWorkspace(test.container, { repoId: repo.id, port: 55_010 });
			test.memory.controls.scriptShell((command) => {
				if (command.program !== "lsof" || !command.args.includes("-iTCP")) return null;
				return output("p321\ncdev\nn*:55020\n");
			});

			const allocated = await test.container.services.ports.allocateForNewWorkspace();

			expect(allocated).toEqual(ok(55_030));
			expect(test.memory.controls.shellCalls[0]?.timeoutMs).toBe(LSOF_TIMEOUT_MS);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("RUN-03 lists a workspace's ports through the run service", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: "/code/run-03/workspace",
			});
			test.memory.controls.scriptShell((command) => {
				if (command.program === "lsof" && command.args.includes("-iTCP")) {
					return output("p101\ncnode\nn*:3000\n");
				}
				if (command.program === "lsof" && command.args.includes("txt")) {
					return output("p101\nn/usr/local/bin/node\n");
				}
				if (command.program === "lsof" && command.args.includes("cwd")) {
					return output(`p101\nn${workspace.path}\n`);
				}
				return null;
			});

			const refreshed = await test.container.services.runScripts.refreshPorts(
				workspace.id,
				workspace.path,
			);

			expect(refreshed).toEqual(ok(undefined));
			expect(
				test.container.services.runScripts.store.getState().byWorkspace[workspace.id]
					?.detectedPorts,
			).toEqual([{ port: 3000, pid: 101, processName: "node", appName: null }]);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("WS-02 resolves a pull request's head through the container's workspace service", async () => {
		const test = createTestContainer();
		try {
			const remoteUrl = "git@github.com:me/project.git";
			const repo = await seedRepo(test.container, {
				rootPath: "/code/ws-02",
				remoteUrl,
			});
			const pullRequest = vi
				.spyOn(test.container.services.github, "pullRequestByNumber")
				.mockResolvedValue(
					ok({
						number: 42,
						title: "A pull request",
						branch: "feature/login",
						authorLogin: "octocat",
						authorAvatarUrl: null,
						state: "open" as const,
						updatedAt: 1,
					}),
				);
			test.memory.controls.scriptShell((command) => {
				if (command.program !== "git") return null;
				const args = gitArgs(command);
				if (args[0] === "fetch") return output();
				if (args[0] === "rev-parse" && args[1] === "refs/conducted/pull/42") {
					return output("pr-head-sha\n");
				}
				return null;
			});

			const result = await test.container.services.workspace.resolveBase(repo.id, {
				kind: "pull_request",
				number: 42,
			});

			expect(result).toEqual(ok({ baseSha: "pr-head-sha", branchName: "main", warning: null }));
			expect(pullRequest).toHaveBeenCalledWith(remoteUrl, 42);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("WS-04 renames the placeholder branch through the container's branch suggester", async () => {
		const test = createTestContainer();
		const renames: string[][] = [];
		const config: SessionConfig = { ...sessionConfig };
		try {
			const repo = await seedRepo(test.container, {
				rootPath: "/code/ws-04",
				remoteUrl: null,
			});
			test.container.services.settings.store.setState((state) => ({
				...state,
				values: {
					...state.values,
					branch_prefix_type: "none",
					auto_rename_new_branches: true,
					auto_rename_workspace_on_branch_name_set: true,
				},
			}));
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: "/code/ws-04/alpha",
				branch: "alpha",
				branchIsPlaceholder: true,
			});
			const session = must(await test.container.services.sessions.create(workspace.id, config));
			vi.spyOn(ChatTitleService.prototype, "suggestBranchName").mockResolvedValue(ok("fix-login"));
			test.memory.controls.scriptShell((command) => {
				if (command.program !== "git") return null;
				const args = gitArgs(command);
				if (args[0] === "branch" && args[1] === "--show-current") return output("alpha\n");
				if (args[0] === "show-ref") return output("", "", 1);
				if (args[0] === "remote" && args[1] === "get-url") {
					return output("", "no remote", 2);
				}
				if (args[0] === "branch" && args[1] === "-m") {
					renames.push([...args]);
					return output();
				}
				return null;
			});

			const result = await test.container.services.workspace.renameBranchAfterFirstMessage(
				session.id,
				"The login button does nothing",
			);

			expect(result).toEqual(ok(undefined));
			expect(renames).toContainEqual(["branch", "-m", "--", "alpha", "fix-login"]);
			expect(
				test.container.services.workspace.store.getState().workspacesById[workspace.id],
			).toMatchObject({
				branch: "fix-login",
				branchIsPlaceholder: false,
				displayName: "fix-login",
			});
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("WS-06 unarchives through the container's workspace service", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, { repoId: repo.id });
			await test.database.execute(
				"UPDATE workspaces SET state = 'archived', archive_commit = $1, archived_at = $2 WHERE id = $3",
				["archive-sha", 10, workspace.id],
			);
			test.memory.controls.scriptShell((command) => {
				if (command.program.endsWith("checkpointer.sh")) return output();
				if (command.program !== "git") return null;
				const args = gitArgs(command);
				if (args[0] === "show-ref") return output();
				if (args[0] === "rev-parse") return output("archive-sha\n");
				return output();
			});

			const result = await test.container.services.workspace.unarchive(workspace.id, {
				branchName: null,
				clearChats: false,
			});

			expect(result).toEqual(ok({ needsBranchName: false, uncommittedChangesLost: false }));
			expect(
				test.container.services.workspace.store.getState().workspacesById[workspace.id],
			).toMatchObject({ state: "ready", archivedAt: null });
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("WS-10 deletes a workspace and its chats through the container's actions", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: "/code/ws-10/workspace",
			});
			const session = must(
				await test.container.services.sessions.create(workspace.id, { ...sessionConfig }),
			);

			const removed = await test.container.actions.workspaces.remove(workspace.id);

			expect(removed).toEqual(ok(undefined));
			expect(
				test.container.services.workspace.store.getState().workspacesById[workspace.id],
			).toBeUndefined();
			expect(
				test.container.services.sessions.store.getState().sessions[session.id],
			).toBeUndefined();
			const repositories = createRepositories(test.database, {
				clock: { now: () => 1_000 },
				ids: { uuid: () => crypto.randomUUID() },
			});
			expect(must(await repositories.workspaces.get(workspace.id))).toBeNull();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("WS-10 removes a project's workspaces through the container's actions", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: "/code/ws-10/in-a-project",
			});

			const removed = await test.container.actions.projects.remove(repo.id);

			expect(removed).toEqual(ok(undefined));
			expect(
				test.container.services.workspace.store.getState().workspacesById[workspace.id],
			).toBeUndefined();
			expect(test.container.services.repo.store.getState().reposById[repo.id]).toBeUndefined();
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});

describe("s1-core-2 join: REV-04, RUN-02, SET-13, WS-07 and WS-11", () => {
	it("REV-04 syncs and resolves GitHub review comments through the container's review service", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, { repoId: repo.id });
			const thread: GithubReviewThread = {
				id: "PRT_1",
				isOutdated: false,
				isResolved: false,
				path: "src/a.ts",
				line: 5,
				startLine: null,
				originalLine: 5,
				originalStartLine: null,
				startDiffSide: null,
				diffSide: "RIGHT",
				comments: [
					{
						id: "PRRC_1",
						databaseId: 101,
						body: "Please rename this.",
						url: "https://github.com/o/r/pull/12#discussion_r101",
						authorLogin: "octocat",
						authorAvatarUrl: null,
						createdAt: 1,
						updatedAt: 2,
						lastEditedAt: null,
						diffHunk: "@@ -1,3 +1,3 @@",
						replyToId: null,
						replyToDatabaseId: null,
					},
				],
				commentsHasNextPage: false,
				commentsEndCursor: null,
			};
			vi.spyOn(test.container.services.github, "readReviewThreads").mockResolvedValue(ok([thread]));
			vi.spyOn(test.container.services.github, "readGeneralComments").mockResolvedValue(ok([]));
			const resolve = vi
				.spyOn(test.container.services.github, "resolveReviewThread")
				.mockResolvedValue(ok(undefined));

			const synced = await test.container.services.review.syncFromGithub(workspace.id);
			expect(synced).toEqual(ok(undefined));
			expect(
				test.container.services.review.store.getState().byWorkspace[workspace.id]?.[0],
			).toMatchObject({
				id: "github-PRT_1-101",
				filePath: "src/a.ts",
				body: "Please rename this.",
				resolved: false,
			});

			const resolved = await test.container.services.review.resolveOnGithub(
				"github-PRT_1-101" as CommentId,
			);
			expect(resolved).toEqual(ok(undefined));
			expect(resolve).toHaveBeenCalledWith(workspace.id, "PRT_1");
			expect(
				test.container.services.review.store.getState().byWorkspace[workspace.id]?.[0]?.resolved,
			).toBe(true);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("RUN-02 starts and stops Spotlight through the container's run actions", async () => {
		const test = createTestContainer();
		try {
			const root = "/code/run-02/project";
			const repo = await seedRepo(test.container, { rootPath: root });
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: `${root}/alpha`,
			});
			await test.container.platform.fs.mkdirp(workspace.path);
			must(await test.container.services.repo.updateConfig(repo.id, { spotlightTesting: true }));
			// The sync loop is a process that stays up until Spotlight stops it. The memory PTY
			// ends a spawned command at once, so this test holds the terminal open instead.
			vi.spyOn(test.container.services.terminals, "runScript").mockResolvedValue(
				ok({
					terminalId: "spotlight-terminal" as TerminalId,
					exit: new Promise<number | null>(() => {}),
				}),
			);
			vi.spyOn(test.container.services.terminals, "stop").mockResolvedValue(ok(undefined));
			let checkpointSaved = false;
			test.memory.controls.scriptShell((command) => {
				if (command.program.endsWith("git-busy-check.sh")) return output("clean\n");
				if (command.program.endsWith("checkpointer.sh")) {
					if (command.args[0] === "save") checkpointSaved = true;
					return output();
				}
				if (command.program !== "git") return null;
				const args = gitArgs(command);
				if (args[0] === "show-ref") return output("", "", checkpointSaved ? 0 : 1);
				if (args[0] === "branch" && args[1] === "--show-current") return output("main\n");
				if (args[0] === "update-ref" && args[1] === "-d") {
					checkpointSaved = false;
					return output();
				}
				if (args[0] === "for-each-ref") return output("");
				return null;
			});

			const started = await test.container.actions.run.startSpotlight(workspace.id);
			expect(started).toEqual(ok(undefined));
			expect(test.container.services.spotlight.store.getState().active[workspace.id]?.active).toBe(
				true,
			);
			expect(checkpointSaved).toBe(true);

			const stopped = await test.container.actions.run.stopSpotlight(workspace.id);
			expect(stopped).toEqual(ok(undefined));
			expect(
				test.container.services.spotlight.store.getState().active[workspace.id],
			).toBeUndefined();
			expect(checkpointSaved).toBe(false);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("SET-13 puts the chosen program shim folder into a terminal through the container's actions", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			await test.container.platform.fs.mkdirp(workspace.path);
			await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
				workspace.id,
			]);
			must(await test.container.services.workspace.start());
			must(await test.container.services.settings.set("claude_executable_path", "/opt/claude"));
			vi.spyOn(test.container.platform.programs, "syncPathOverrides").mockResolvedValue(
				ok("/data/bin-overrides/abc"),
			);
			const spawn = vi.spyOn(test.container.platform.pty, "spawn");

			const created = await test.container.actions.terminals.create(workspace.id);

			expect(created.ok).toBe(true);
			expect(spawn.mock.calls[0]?.[0].env?.CONDUCTED_PATH_PREFIX).toBe(
				`/data/bin-overrides/abc:${programsBinDir(test.container.platform.fs.paths)}`,
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("WS-07 saves linked folders through the container's workspace actions", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const session = must(
				await test.container.services.sessions.create(workspace.id, { ...sessionConfig }),
			);

			const saved = await test.container.actions.workspaces.setLinkedPaths(workspace.id, [
				"/code/shared",
			]);

			expect(saved).toEqual(ok(undefined));
			expect(
				test.container.services.workspace.store.getState().workspacesById[workspace.id]
					?.linkedPaths,
			).toEqual(["/code/shared"]);
			expect(test.container.lookups.allowedRoots(workspace.id)).toEqual(
				ok([workspace.path, "/code/shared"]),
			);
			expect(
				test.container.services.sessions.store.getState().sessions[session.id]?.config
					.additionalDirectories,
			).toEqual([]);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("WS-11 saves and removes a backlog workspace through the container's workspace actions", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);

			const saved = await test.container.actions.workspaces.addToBacklog({
				repoId: repo.id,
				from: { kind: "default" },
				prompt: "Finish the report",
				attachmentPaths: [],
				config: { ...sessionConfig },
				sectionId: null,
			});

			expect(saved.ok).toBe(true);
			if (!saved.ok) return;
			expect(
				test.container.services.workspace.store.getState().backlogById[saved.value.id],
			).toEqual(saved.value);

			const removed = await test.container.actions.workspaces.removeFromBacklog(saved.value.id);
			expect(removed).toEqual(ok(undefined));
			expect(
				test.container.services.workspace.store.getState().backlogById[saved.value.id],
			).toBeUndefined();
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
