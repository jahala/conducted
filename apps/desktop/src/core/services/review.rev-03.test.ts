/**
 * @feature REV-03 Review comments
 * Tests the comment store, its writes, the agent-facing reads and writes, and sending a comment
 * to the chat as a file.
 */
import { join } from "node:path";
import type { CommentId, WorkspaceId } from "@conducted/shared";
import { ok } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { createRepositories } from "../db/repositories.ts";
import { sampleSession } from "../db/test-fixtures.ts";
import type { GitRunner } from "../git/runner.ts";
import type { DiffComment } from "../model.ts";
import { ReviewService, type ReviewServiceDeps } from "./review.ts";

let test: TestContainer | undefined;

afterEach(() => {
	test?.close();
	test = undefined;
});

const clock = { now: () => 1_000 };

function ids() {
	let next = 0;
	return { uuid: () => `rev-03-${++next}` };
}

function serviceFor(
	container: TestContainer,
	overrides: Partial<ReviewServiceDeps> = {},
): { service: ReviewService; sent: { workspaceId: WorkspaceId; text: string }[] } {
	const sent: { workspaceId: WorkspaceId; text: string }[] = [];
	const repositories = createRepositories(container.database, { clock, ids: ids() });
	const deps: ReviewServiceDeps = {
		repos: repositories,
		git: {} as GitRunner,
		agent: {
			// A real chat takes the message, so the attachment rows that name it can be stored.
			sendInstruction: async (workspaceId, text) => {
				sent.push({ workspaceId, text });
				const chat = await container.container.services.sessions.create(
					workspaceId,
					sampleSession.config,
				);
				return chat.ok ? ok(chat.value.id) : chat;
			},
		},
		fs: container.container.platform.fs,
		workspacePathOf: async (workspaceId) => {
			const found = container.container.lookups.workspace(workspaceId);
			return found.ok ? ok(found.value.path) : found;
		},
		customPromptOf: async () => ok(null),
		startReviewChat: async () => {
			throw new Error("The review chat must not start in this test.");
		},
		...overrides,
	};
	return { service: new ReviewService(deps), sent };
}

function comment(id: string, over: Partial<DiffComment> = {}): DiffComment {
	return {
		id: id as CommentId,
		workspaceId: "ws-1" as WorkspaceId,
		filePath: "src/a.ts",
		line: 3,
		endLine: null,
		body: `body ${id}`,
		author: { kind: "user", name: null, avatarUrl: null },
		state: "pending",
		side: "additions",
		threadId: null,
		replyToId: null,
		suggestion: null,
		suggestionBaseCode: null,
		remoteUrl: null,
		resolved: false,
		outdated: false,
		createdAt: 1_000,
		updatedAt: 1_000,
		...over,
	};
}

describe("REV-03 review comment store over the real container", () => {
	it("creates, edits, resolves and removes a comment, and keeps the store in step", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const review = test.container.services.review;

		const added = await review.add(workspace.id, "src/a.ts", 4, null, "Rename this");
		if (!added.ok) throw new Error(added.error.message);
		expect(review.store.getState().byWorkspace[workspace.id]).toMatchObject([
			{ id: added.value.id, body: "Rename this", state: "pending" },
		]);

		expect(await review.edit(added.value.id, "Renamed")).toEqual(ok(undefined));
		expect(review.store.getState().byWorkspace[workspace.id]?.[0]?.body).toBe("Renamed");

		expect(await review.setResolved(added.value.id, true)).toEqual(ok(undefined));
		expect(review.store.getState().byWorkspace[workspace.id]?.[0]?.resolved).toBe(true);

		expect(await review.remove(added.value.id)).toEqual(ok(undefined));
		expect(review.store.getState().byWorkspace[workspace.id]).toEqual([]);
	});

	it("stores a comment's side, suggested change and reply through the actions", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const comments = test.container.actions.comments;

		const root = await comments.add(workspace.id, "src/a.ts", 7, 8, "Use a constant", {
			side: "deletions",
			suggestion: { code: "const limit = 10;", baseCode: "let limit = 10;" },
		});
		if (!root.ok) throw new Error(root.error.message);
		expect(root.value).toMatchObject({
			side: "deletions",
			suggestion: "const limit = 10;",
			suggestionBaseCode: "let limit = 10;",
			replyToId: null,
		});

		const reply = await comments.add(workspace.id, "src/a.ts", 7, 8, "Agreed", {
			side: "deletions",
			replyToId: root.value.id,
			threadId: root.value.id,
		});
		if (!reply.ok) throw new Error(reply.error.message);

		const stored = test.container.services.review.store.getState().byWorkspace[workspace.id];
		expect(stored?.find((entry) => entry.id === reply.value.id)).toMatchObject({
			side: "deletions",
			replyToId: root.value.id,
			threadId: root.value.id,
			suggestion: null,
			suggestionBaseCode: null,
		});
	});

	it("edits a suggested change, keeps it when only the text changes, and clears it", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const comments = test.container.actions.comments;
		const added = await comments.add(workspace.id, "src/a.ts", 2, null, "Shorter", {
			suggestion: { code: "a", baseCode: "abc" },
		});
		if (!added.ok) throw new Error(added.error.message);
		const read = () =>
			test?.container.services.review.store
				.getState()
				.byWorkspace[workspace.id]?.find((entry) => entry.id === added.value.id);

		expect(
			await comments.edit(added.value.id, "Shorter still", {
				suggestion: { code: "", baseCode: "abc" },
			}),
		).toEqual(ok(undefined));
		expect(read()).toMatchObject({
			body: "Shorter still",
			suggestion: "",
			suggestionBaseCode: "abc",
		});

		expect(await comments.edit(added.value.id, "Only the text")).toEqual(ok(undefined));
		expect(read()).toMatchObject({
			body: "Only the text",
			suggestion: "",
			suggestionBaseCode: "abc",
		});

		expect(await comments.edit(added.value.id, "No change", { suggestion: null })).toEqual(
			ok(undefined),
		);
		expect(read()).toMatchObject({ suggestion: null, suggestionBaseCode: null });
	});

	it("refuses a reply to a comment that is not in the workspace", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const reply = await test.container.actions.comments.add(
			workspace.id,
			"src/a.ts",
			1,
			null,
			"Orphan",
			{ replyToId: "gone" as CommentId },
		);
		expect(reply.ok).toBe(false);
		if (!reply.ok) expect(reply.error.code).toBe("db.not_found");
		expect(test.container.services.review.store.getState().byWorkspace[workspace.id] ?? []).toEqual(
			[],
		);
	});

	it("loads the workspace rows once when the store is empty", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const review = test.container.services.review;
		const added = await review.add(workspace.id, "src/a.ts", 1, null, "Loaded from SQLite");
		if (!added.ok) throw new Error(added.error.message);

		review.store.setState({ byWorkspace: {}, errors: {} });
		expect(await review.load(workspace.id)).toEqual(ok(undefined));
		expect(review.store.getState().byWorkspace[workspace.id]).toHaveLength(1);

		const again = await review.load(workspace.id);
		expect(again).toEqual(ok(undefined));
		expect(review.store.getState().byWorkspace[workspace.id]).toHaveLength(1);
	});

	it("lists only open comments for the agent, with an optional file filter", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const review = test.container.services.review;
		const first = await review.add(workspace.id, "src/a.ts", 1, null, "Open");
		const second = await review.add(workspace.id, "src/b.ts", 2, null, "Resolved");
		if (!first.ok || !second.ok) throw new Error("comments did not save");
		await review.setResolved(second.value.id, true);

		const listed = await review.listForAgent(workspace.id, undefined);
		expect(listed.ok ? listed.value.map((entry) => entry.body) : []).toEqual(["Open"]);

		const filtered = await review.listForAgent(workspace.id, "src/b.ts");
		expect(filtered.ok ? filtered.value : []).toEqual([]);
	});

	it("adds agent comments with the agent author kind", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const review = test.container.services.review;

		const added = await review.addFromAgent(
			workspace.id,
			[
				{ file: "src/a.ts", line: 3, body: "From the agent" },
				{ file: "src/a.ts", line: 9, body: "Another one" },
			],
			"claude-sonnet-4-5",
		);

		expect(added).toEqual(ok(2));
		const rows = review.store.getState().byWorkspace[workspace.id] ?? [];
		expect(rows.map((entry) => entry.author.kind)).toEqual(["agent", "agent"]);
		expect(rows.map((entry) => entry.author.name)).toEqual([
			"claude-sonnet-4-5",
			"claude-sonnet-4-5",
		]);
	});

	it("lets only the newest of two overlapping loads write the store", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const repositories = createRepositories(test.database, { clock, ids: ids() });
		let releaseFirst = () => {};
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let calls = 0;
		const stale = comment("stale", { workspaceId: workspace.id, body: "stale" });
		const fresh = comment("fresh", { workspaceId: workspace.id, body: "fresh" });
		const { service } = serviceFor(test, {
			repos: {
				attachments: repositories.attachments,
				diffComments: {
					...repositories.diffComments,
					listByWorkspace: async () => {
						calls += 1;
						if (calls === 1) {
							await firstGate;
							return ok([stale]);
						}
						return ok([fresh]);
					},
				},
			},
		});

		const earlier = service.load(workspace.id);
		const later = service.load(workspace.id);
		releaseFirst();
		await Promise.all([earlier, later]);

		expect(service.store.getState().byWorkspace[workspace.id]).toEqual([fresh]);
	});
});

describe("REV-03 sendToChat", () => {
	it("writes the comment file and asks the agent to review it", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const { service, sent } = serviceFor(test);
		const added = await service.add(workspace.id, "src/a.ts", 3, 5, "Use the new helper");
		if (!added.ok) throw new Error(added.error.message);

		expect(await service.sendToChat(workspace.id, [added.value.id])).toEqual(ok(undefined));

		const file = join(
			workspace.path,
			".context/attachments/comments",
			`${encodeURIComponent(added.value.id)}.md`,
		);
		const text = test.memory.controls.files.get(file) ?? "";
		expect(text).toContain("File: src/a.ts");
		expect(text).toContain("Lines: 3-5");
		expect(text).toContain("Outdated: no");
		expect(text).toContain("Resolved: no");
		expect(text).toContain("## Comment");
		expect(text).toContain("Use the new helper");
		expect(sent).toHaveLength(1);
		expect(sent[0]?.text).toContain(".context/attachments/comments/");
	});

	it("rewrites the file when a sent comment is edited", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const { service } = serviceFor(test);
		const added = await service.add(workspace.id, "src/a.ts", 3, null, "Old text");
		if (!added.ok) throw new Error(added.error.message);
		await service.sendToChat(workspace.id, [added.value.id]);
		const file = join(
			workspace.path,
			".context/attachments/comments",
			`${encodeURIComponent(added.value.id)}.md`,
		);

		await service.edit(added.value.id, "New text");

		expect(test.memory.controls.files.get(file)).toContain("New text");
	});

	it("refuses an inactive comment and sends nothing", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const { service, sent } = serviceFor(test);
		const added = await service.add(workspace.id, "src/a.ts", 3, null, "Resolved already");
		if (!added.ok) throw new Error(added.error.message);
		await service.setResolved(added.value.id, true);

		const result = await service.sendToChat(workspace.id, [added.value.id]);

		expect(result.ok).toBe(false);
		expect(sent).toHaveLength(0);
	});

	it("refuses to send when the comment file cannot be written", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const { service, sent } = serviceFor(test);
		const added = await service.add(workspace.id, "src/a.ts", 3, null, "Will not write");
		if (!added.ok) throw new Error(added.error.message);
		test.memory.controls.files.set(join(workspace.path, ".context"), "not a folder");

		const result = await service.sendToChat(workspace.id, [added.value.id]);

		expect(result.ok).toBe(false);
		expect(sent).toHaveLength(0);
	});
});
