/**
 * @feature CHAT-21 Fork a chat to a new workspace
 * Tests the turn footer's Fork to new workspace action over the real container: a turn with a
 * checkpoint offers the action, choosing it forks into a new workspace and opens that workspace's
 * copied chat, and a turn without a checkpoint keeps the action disabled with a reason.
 * Test first: choosing Fork to new workspace navigates to a workspace other than the one on screen.
 */
import { ok, type Result, type TurnId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { ChatTurn } from "../../core/model.ts";
import {
	agentEvent,
	appendChatEvents,
	checkpointEvent,
	turnEndedEvent,
	userMessageEvent,
} from "../../test/chat-events.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";

const navigate = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("../../ui/Toast.tsx", () => ({ toastError }));

const { TurnFooter } = await import("./TurnFooter.tsx");

const CONFIG = {
	agent: "claude" as const,
	model: "default",
	effort: "high" as const,
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};
const HEAD = "checkpoint-head-sha";
const GIT = /\/checkpointer\.sh$/;

const output = (stdout = "", stderr = "", exitCode = 0) => ({ stdout, stderr, exitCode });

const gitArgs = (command: { program: string; args: readonly string[] }): readonly string[] =>
	command.program === "git" && command.args[0] === "-c" ? command.args.slice(2) : command.args;

const must = <T,>(result: Result<T>): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const turn = (over: Partial<ChatTurn> = {}): ChatTurn => ({
	turnId: "t1" as TurnId,
	startedBy: "user",
	userMessage: {
		messageId: "m1" as never,
		text: "Hello",
		attachmentPaths: [],
		at: 10,
		sender: null,
	},
	steers: [],
	blocks: [{ kind: "text", text: "The final answer." }],
	startCheckpointId: "start-1",
	endCheckpointId: "end-1",
	changes: [],
	outcome: "success",
	error: null,
	startedAt: 10,
	endedAt: 20,
	usage: null,
	reverted: false,
	...over,
});

function scriptFork(test: ReturnType<typeof createTestContainer>, refs: Set<string>): void {
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
		if (first === "remote" && second === "get-url") return ok(output("", "no remote", 2));
		return null;
	});
}

async function seedChat(checkpointed: boolean) {
	const test = createTestContainer();
	await test.container.services.settings.start();
	must(await test.container.services.settings.set("branch_prefix_type", "none"));
	const repo = await seedRepo(test.container, {
		rootPath: "/code/projects/footer-fork",
		remoteUrl: null,
	});
	const workspace = await seedWorkspace(test.container, {
		repoId: repo.id,
		path: "/code/workspaces/footer-origin",
		targetBranch: "main",
	});
	const created = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	const events = checkpointed
		? [
				userMessageEvent("u1", "t1", 10),
				checkpointEvent("c1", "t1", 11, "start", "start-1"),
				agentEvent("a1", "t1", 12, [{ kind: "text", text: "First answer" }]),
				checkpointEvent("c2", "t1", 13, "end", "end-1"),
				turnEndedEvent("e1", "t1", 14),
			]
		: [
				userMessageEvent("u1", "t1", 10),
				agentEvent("a1", "t1", 11, [{ kind: "text", text: "First answer" }]),
				turnEndedEvent("e1", "t1", 12),
			];
	await appendChatEvents(test.container, created.id, events);
	if (checkpointed) {
		scriptFork(
			test,
			new Set([`refs/conducted/checkpoints/start-1`, `refs/conducted/checkpoints/end-1`]),
		);
	}
	return { test, workspaceId: workspace.id, sessionId: created.id };
}

async function openMenu(): Promise<void> {
	const trigger = screen.getByRole("button", { name: "More turn actions" });
	trigger.focus();
	fireEvent.keyDown(trigger, { key: "Enter" });
}

afterEach(() => {
	cleanup();
	navigate.mockReset();
	toastError.mockReset();
});

describe("CHAT-21 fork from the turn footer", () => {
	it("forks into a new workspace and opens its copied chat", async () => {
		const { test, workspaceId, sessionId } = await seedChat(true);
		try {
			render(
				<ServicesProvider container={test.container}>
					<TurnFooter turn={turn()} sessionId={sessionId} />
				</ServicesProvider>,
			);
			await openMenu();
			fireEvent.click(await screen.findByRole("menuitem", { name: "Fork to new workspace" }));

			await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1), { timeout: 5_000 });
			const call = navigate.mock.calls[0]?.[0] as {
				to: string;
				params: { repositoryId: string; workspaceId: string };
				search: { tab?: string; sessionId?: string };
			};
			expect(call.to).toBe("/repository/$repositoryId/workspace/$workspaceId");
			expect(call.params.workspaceId).not.toBe(workspaceId);
			expect(call.search.tab).toBe("session");
			const newWorkspaceId = call.params.workspaceId;
			const copies = test.container.services.sessions.store.getState().byWorkspace[newWorkspaceId];
			expect(copies).toHaveLength(1);
			expect(call.search.sessionId).toBe(copies?.[0]);
			expect(
				test.container.services.workspace.store.getState().workspacesById[newWorkspaceId],
			).toBeDefined();
			expect(toastError).not.toHaveBeenCalled();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("keeps Fork to new workspace disabled when the turn has no checkpoint", async () => {
		const { test, sessionId } = await seedChat(false);
		try {
			render(
				<ServicesProvider container={test.container}>
					<TurnFooter
						turn={turn({ startCheckpointId: null, endCheckpointId: null })}
						sessionId={sessionId}
					/>
				</ServicesProvider>,
			);
			await openMenu();
			const item = await screen.findByRole("menuitem", { name: "Fork to new workspace" });
			expect(item.getAttribute("aria-disabled")).toBe("true");
			expect(item.getAttribute("title")).toBe("This turn has no checkpoint to fork from.");
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
