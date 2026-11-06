// @vitest-environment node
/**
 * @feature CHAT-21 Fork a chat to a new workspace
 * Reaches the fork through the real composition root: the actions contract creates a workspace
 * whose branch starts at the turn checkpoint's head, restores that checkpoint into the new
 * worktree, and moves a copy of the chat there.
 * Test first: actions.sessions.forkToWorkspace over createTestContainer returns a new workspace
 * holding a copy of the chat.
 */
import { ok, type Result, type SessionId, type TurnId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import {
	agentEvent,
	appendChatEvents,
	checkpointEvent,
	turnEndedEvent,
	userMessageEvent,
} from "../../test/chat-events.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { sampleSession } from "../db/test-fixtures.ts";
import { checkpointRef } from "../git/refs.ts";

const HEAD = "checkpoint-head-sha";
const GIT = /\/checkpointer\.sh$/;

const output = (stdout = "", stderr = "", exitCode = 0) => ({ stdout, stderr, exitCode });

const gitArgs = (command: { program: string; args: readonly string[] }): readonly string[] =>
	command.program === "git" && command.args[0] === "-c" ? command.args.slice(2) : command.args;

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

/** Answers the git and checkpointer calls a fork makes, as a real repository would. */
function scriptFork(test: TestContainer, refs: Set<string>): void {
	test.memory.controls.scriptShell((command) => {
		const args = gitArgs(command);
		if (GIT.test(command.program)) {
			if (args[0] === "restore") return ok(output());
			return null;
		}
		if (command.program === "lsof") return ok(output("", "", 1));
		if (command.program !== "git") return null;
		const [first, second] = args;
		if (first === "cat-file" && second === "commit") {
			return ok(
				output(`checkpoint:${args[2]}\nhead ${HEAD}\nindex-tree tree\nworktree-tree tree\n`),
			);
		}
		if (first === "show-ref") {
			const ref = args.at(-1) ?? "";
			return ok(output("", "", refs.has(ref) ? 0 : 1));
		}
		if (first === "rev-parse" && second === "HEAD") return ok(output(`${HEAD}\n`));
		if (first === "rev-parse" && second === "--git-common-dir") return ok(output(".git\n"));
		if (first === "worktree" && second === "add") return ok(output());
		if (first === "config") return ok(output());
		if (first === "ls-files") return ok(output());
		if (first === "for-each-ref") {
			const prefix = args.at(-1) ?? "";
			const listed = [...refs].filter((ref) => ref.startsWith(prefix));
			return ok(output(listed.map((ref) => `${ref}\n`).join("")));
		}
		if (first === "update-ref" && second === "--stdin") {
			for (const line of (command.stdin ?? "").split("\n")) {
				if (line.length === 0) continue;
				const created = line.split(" ")[1];
				if (created !== undefined) refs.add(created);
			}
			return ok(output());
		}
		if (first === "remote" && second === "get-url") {
			return ok(output("", "no remote", 2));
		}
		return null;
	});
}

describe("CHAT-21 fork through the composition root", () => {
	it("creates a workspace at the turn's checkpoint and opens a copy of the chat there", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			must(await test.container.services.settings.set("branch_prefix_type", "none"));
			const repo = await seedRepo(test.container, {
				rootPath: "/code/projects/fork-workspace",
				remoteUrl: null,
			});
			const originWorkspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: "/code/workspaces/origin",
				targetBranch: "main",
			});
			const origin = must(
				await test.container.services.sessions.create(originWorkspace.id, sampleSession.config),
			);
			await appendChatEvents(test.container, origin.id, [
				userMessageEvent("u1", "t1", 10),
				checkpointEvent("c1", "t1", 11, "start", "start-1"),
				agentEvent("a1", "t1", 12, [{ kind: "text", text: "First answer" }]),
				checkpointEvent("c2", "t1", 13, "end", "end-1"),
				turnEndedEvent("e1", "t1", 14),
			]);
			const refs = new Set([checkpointRef("start-1"), checkpointRef("end-1")]);
			scriptFork(test, refs);

			const forked = must(
				await test.container.actions.sessions.forkToWorkspace(origin.id, "t1" as TurnId),
			);

			expect(forked.id).not.toBe(originWorkspace.id);
			expect(forked.repoId).toBe(repo.id);
			expect(forked.state).toBe("ready");
			expect(forked.branch).not.toBe(originWorkspace.branch);

			const added = test.memory.controls.shellCalls.find((command) => {
				const args = gitArgs(command);
				return command.program === "git" && args[0] === "worktree" && args[1] === "add";
			});
			expect(gitArgs(added ?? { program: "", args: [] })).toEqual([
				"worktree",
				"add",
				forked.path,
				"-b",
				forked.branch,
				HEAD,
			]);

			const restored = test.memory.controls.shellCalls.filter((command) => {
				const args = gitArgs(command);
				return GIT.test(command.program) && args[0] === "restore";
			});
			expect(restored.map((command) => gitArgs(command))).toEqual([["restore", "end-1"]]);
			expect(restored[0]?.cwd).toBe(forked.path);

			const copies = test.container.services.sessions.store.getState().byWorkspace[forked.id];
			expect(copies).toHaveLength(1);
			const copiedId = copies?.[0];
			expect(copiedId).toBeDefined();
			if (copiedId === undefined) return;
			expect(forked.activeSessionId).toBe(copiedId);

			const repositories = test.container.services.sessions;
			const opened = must(await repositories.open(copiedId as SessionId));
			expect(opened).toBeUndefined();
			const view = repositories.chatView(copiedId as SessionId);
			expect(view?.turns).toHaveLength(1);
			expect(view?.turns[0]?.userMessage?.text).toBe("Fix the login bug");
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
