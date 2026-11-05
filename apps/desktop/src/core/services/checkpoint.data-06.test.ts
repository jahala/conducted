/**
 * @feature DATA-06 Prune turn snapshots
 * Tests removing a deleted chat's checkpoint refs, the 30-day archive prune counted from
 * archived_at, and the real container wiring that reaches both paths.
 */
import { type Clock, ok, type SessionId, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedRepo } from "../../test/container.ts";
import { FakeGitRunner, gitOutput } from "../../test/fake-git-runner.ts";
import { createRepositories } from "../db/repositories.ts";
import { sampleSession } from "../db/test-fixtures.ts";
import { checkpointRef, turnCheckpointId } from "../git/refs.ts";
import { CHECKPOINT_PRUNE_AFTER_DAYS, CheckpointService } from "./checkpoint.ts";

const DAY = 86_400_000;
const BASE = 1_700_000_000_000;
const REPO_ROOT = "/code/project";

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const refsFor = (sessionId: SessionId, turns: readonly string[]): string[] =>
	turns.flatMap((turn) => [
		checkpointRef(turnCheckpointId(sessionId, turn, "start")),
		checkpointRef(turnCheckpointId(sessionId, turn, "end")),
	]);

/** A git fake that lists and deletes refs from one mutable set, as git would. */
function refGit(refs: Set<string>): FakeGitRunner {
	return new FakeGitRunner((command) => {
		if (command.args[0] === "for-each-ref") {
			const prefix = command.args.at(-1) ?? "";
			return gitOutput([...refs].filter((ref) => ref.startsWith(prefix)).join("\n"));
		}
		if (command.args[0] === "update-ref" && command.args[1] === "-d") {
			refs.delete(command.args.at(-1) ?? "");
			return gitOutput();
		}
		return gitOutput();
	});
}

const makeService = (git: FakeGitRunner): CheckpointService =>
	new CheckpointService({
		git,
		checkpointerPath: "/bin/checkpointer.sh",
		workspacePathOf: async () => ok("/code/project/worktree"),
		sleep: async () => {},
	});

describe("DATA-06 pruning a deleted chat's checkpoint refs", () => {
	it("removes every start and end ref of the chat under the repository lock", async () => {
		const session = "chat-1" as SessionId;
		const refs = new Set(refsFor(session, ["turn-1", "turn-2"]));
		const git = refGit(refs);
		const service = makeService(git);

		await expect(service.pruneForChat(session, REPO_ROOT)).resolves.toEqual({
			ok: true,
			value: 4,
		});
		expect([...refs]).toEqual([]);
		expect(git.repoLocks).toEqual([REPO_ROOT]);
		for (const call of git.calls) expect(call.options.cwd).toBe(REPO_ROOT);

		await expect(service.pruneForChat(session, REPO_ROOT)).resolves.toEqual({
			ok: true,
			value: 0,
		});
	});

	it("leaves another chat's refs alone even when its id starts the same way", async () => {
		const deleted = "chat-1" as SessionId;
		const kept = "chat-10" as SessionId;
		const refs = new Set([...refsFor(deleted, ["turn-1"]), ...refsFor(kept, ["turn-1"])]);
		const service = makeService(refGit(refs));

		await expect(service.pruneForChat(deleted, REPO_ROOT)).resolves.toEqual({
			ok: true,
			value: 2,
		});
		expect([...refs].sort()).toEqual(refsFor(kept, ["turn-1"]).sort());
	});
});

describe("DATA-06 pruning archived workspaces", () => {
	it("counts 30 days from archived_at, not from a later edit", async () => {
		let now = BASE;
		const clock: Clock = { now: () => now };
		const test = createTestContainer({ clock });
		const repos = createRepositories(test.database, {
			clock,
			ids: { uuid: () => crypto.randomUUID() },
		});
		const repo = await seedRepo(test.container, { rootPath: REPO_ROOT });

		const archiveAt = async (
			name: string,
			archivedAt: number,
			port: number,
		): Promise<WorkspaceId> => {
			now = archivedAt - DAY;
			const workspace = must(
				await repos.workspaces.create({
					repoId: repo.id,
					directoryName: name,
					path: `/code/project/${name}`,
					branch: `jahala/${name}`,
					branchIsPlaceholder: true,
					targetBranch: "origin/main",
					port,
					linkedPaths: [],
					setupLogPath: null,
				}),
			);
			must(await repos.workspaces.transitionState(workspace.id, "initializing", "archiving"));
			now = archivedAt;
			must(await repos.workspaces.markArchived(workspace.id, "sha"));
			return workspace.id;
		};

		const current = BASE + 100 * DAY;
		const old = await archiveAt("old", current - 40 * DAY, 55_001);
		const recent = await archiveAt("recent", current - DAY, 55_002);
		const boundary = await archiveAt("boundary", current - 30 * DAY, 55_003);

		const createSession = async (workspaceId: WorkspaceId, title: string) =>
			must(
				await repos.sessions.create({
					workspaceId,
					title,
					config: sampleSession.config,
				}),
			);
		const oldChat = await createSession(old, "old chat");
		const recentChat = await createSession(recent, "recent chat");
		const boundaryChat = await createSession(boundary, "boundary chat");

		// A note moves updated_at to now, after the archive. The prune must still use archived_at.
		now = current;
		must(await repos.workspaces.setNotes(old, "noted after the archive"));
		const storedOld = must(await repos.workspaces.get(old));
		expect(storedOld?.updatedAt).toBe(current);

		const refs = new Set([
			...refsFor(oldChat.id, ["turn-1"]),
			...refsFor(recentChat.id, ["turn-1"]),
			...refsFor(boundaryChat.id, ["turn-1"]),
		]);
		const calls: { cwd: string | undefined; args: readonly string[] }[] = [];
		test.memory.controls.scriptShell((command) => {
			if (command.program !== "git") return null;
			calls.push({ cwd: command.cwd, args: command.args });
			if (command.args.includes("for-each-ref")) {
				const prefix = command.args.at(-1) ?? "";
				return ok({
					stdout: [...refs].filter((ref) => ref.startsWith(prefix)).join("\n"),
					stderr: "",
					exitCode: 0,
				});
			}
			if (command.args.includes("update-ref") && command.args.includes("-d")) {
				refs.delete(command.args.at(-1) ?? "");
				return ok({ stdout: "", stderr: "", exitCode: 0 });
			}
			return null;
		});

		await expect(
			test.container.services.checkpoint.pruneArchived(CHECKPOINT_PRUNE_AFTER_DAYS),
		).resolves.toEqual({ ok: true, value: 2 });

		expect([...refs].sort()).toEqual(
			[...refsFor(recentChat.id, ["turn-1"]), ...refsFor(boundaryChat.id, ["turn-1"])].sort(),
		);
		expect(calls.length).toBeGreaterThan(0);
		for (const call of calls) expect(call.cwd).toBe(REPO_ROOT);
		test.close();
	});

	it("reaches the archive prune through the container's real repositories and clock", async () => {
		const test = createTestContainer();
		try {
			await expect(
				test.container.services.checkpoint.pruneArchived(CHECKPOINT_PRUNE_AFTER_DAYS),
			).resolves.toEqual({ ok: true, value: 0 });
		} finally {
			test.close();
		}
	});
});

describe("DATA-06 deleting a chat through the real container", () => {
	it("prunes the deleted chat's refs before the row goes", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container, { rootPath: REPO_ROOT });
			const repos = createRepositories(test.database, {
				clock: { now: () => BASE },
				ids: { uuid: () => crypto.randomUUID() },
			});
			const workspace = must(
				await repos.workspaces.create({
					repoId: repo.id,
					directoryName: "worktree",
					path: "/code/project/worktree",
					branch: "jahala/worktree",
					branchIsPlaceholder: true,
					targetBranch: "origin/main",
					port: 55_010,
					linkedPaths: [],
					setupLogPath: null,
				}),
			);
			const chat = must(
				await repos.sessions.create({
					workspaceId: workspace.id,
					title: "a chat",
					config: sampleSession.config,
				}),
			);
			const refs = new Set(refsFor(chat.id, ["turn-1"]));
			test.memory.controls.scriptShell((command) => {
				if (command.program !== "git") return null;
				if (command.args.includes("for-each-ref")) {
					const prefix = command.args.at(-1) ?? "";
					return ok({
						stdout: [...refs].filter((ref) => ref.startsWith(prefix)).join("\n"),
						stderr: "",
						exitCode: 0,
					});
				}
				if (command.args.includes("update-ref") && command.args.includes("-d")) {
					refs.delete(command.args.at(-1) ?? "");
					return ok({ stdout: "", stderr: "", exitCode: 0 });
				}
				return null;
			});

			await expect(test.container.services.sessions.delete(chat.id)).resolves.toEqual({
				ok: true,
				value: undefined,
			});
			expect([...refs]).toEqual([]);
			const listing = test.memory.controls.shellCalls.find(
				(command) => command.program === "git" && command.args.includes("for-each-ref"),
			);
			expect(listing?.cwd).toBe(REPO_ROOT);
		} finally {
			test.close();
		}
	});
});
