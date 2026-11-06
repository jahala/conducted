/**
 * @feature CHAT-26 Start a chat with earlier chats and plans
 * Owns: the tests for attaching another chat's transcript and an agent's plan as draft files,
 * through the real composition root.
 * Behaviour: inventory:toast rows 756 to 758.
 * Test first: a chat with a user message attaches as "Transcript of <title>.md" and an empty chat
 * refuses with "No messages in this chat". The names follow Conductor (renderApp `_1a`): a chat
 * with no title is "Transcript of chat.md", and a plan is "<plan title>.md".
 */
import type { ToolUseId, TurnId } from "@conducted/shared";
import { appError, err } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createTestContainer,
	seedSessionEvent,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import {
	agentEvent,
	sampleSession,
	turnEndedEvent,
	userMessageEvent,
} from "../db/test-fixtures.ts";

const opened: TestContainer[] = [];

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const setup = async () => {
	const test = createTestContainer();
	opened.push(test);
	const workspace = await seedWorkspace(test.container);
	const source = must(
		await test.container.services.sessions.create(workspace.id, sampleSession.config),
	);
	const target = must(
		await test.container.services.sessions.create(workspace.id, sampleSession.config),
	);
	return { test, workspace, source, target };
};

afterEach(async () => {
	for (const test of opened.splice(0)) {
		await test.container.stop();
		test.close();
	}
});

const seedConversation = async (test: TestContainer, sessionId: string) => {
	await seedSessionEvent(test.container, sessionId as never, userMessageEvent("u1", "t1", 10), 10);
	await seedSessionEvent(
		test.container,
		sessionId as never,
		agentEvent("a1", "t1", 12, [{ kind: "text", text: "I fixed the login bug." }]),
		12,
	);
	await seedSessionEvent(test.container, sessionId as never, turnEndedEvent("e1", "t1", 13), 13);
};

const seedPlan = async (test: TestContainer, sessionId: string) => {
	await seedSessionEvent(
		test.container,
		sessionId as never,
		agentEvent("a1", "t1", 12, [
			{
				kind: "tool_call",
				toolUseId: "tool-1" as ToolUseId,
				tool: "exit_plan_mode",
				rawName: "ExitPlanMode",
				input: { plan: "# Fix the login bug\n\nChange the parser, then run the tests." },
			},
		]),
		12,
	);
};

describe("CHAT-26 attach an earlier chat", () => {
	it("saves the chat's transcript as a Markdown attachment named after its title", async () => {
		const { test, source, target } = await setup();
		must(await test.container.services.sessions.rename(source.id, "Login fix"));
		await seedConversation(test, source.id);

		const added = await test.container.actions.attachments.addChatTranscript(target.id, source.id);

		expect(added.ok).toBe(true);
		if (!added.ok) return;
		expect(added.value.endsWith("Transcript of Login fix.md")).toBe(true);
		const text = test.memory.controls.files.get(added.value) ?? "";
		expect(text).toContain("Fix the login bug");
		expect(text).toContain("I fixed the login bug.");
		expect(test.container.services.composer.draftOf(target.id).attachmentPaths).toEqual([
			added.value,
		]);
	});

	it("names a transcript of a chat with no title Transcript of chat.md", async () => {
		const { test, source, target } = await setup();
		await seedConversation(test, source.id);

		const added = await test.container.actions.attachments.addChatTranscript(target.id, source.id);

		expect(added.ok).toBe(true);
		if (!added.ok) return;
		expect(added.value.endsWith("/Transcript of chat.md")).toBe(true);
	});

	it("refuses a chat with no messages", async () => {
		const { test, source, target } = await setup();

		const added = await test.container.actions.attachments.addChatTranscript(target.id, source.id);

		expect(added.ok).toBe(false);
		if (added.ok) return;
		expect(added.error.message).toBe("No messages in this chat");
	});

	it("reports a failed write as Failed to attach chat transcript", async () => {
		const { test, source, target } = await setup();
		await seedConversation(test, source.id);
		vi.spyOn(test.container.platform.fs, "writeTextAtomic").mockResolvedValue(
			err(appError("fs_denied", "The file could not be written.")),
		);

		const added = await test.container.actions.attachments.addChatTranscript(target.id, source.id);

		expect(added.ok).toBe(false);
		if (added.ok) return;
		expect(added.error.message).toBe("Failed to attach chat transcript");
	});
});

describe("CHAT-26 attach a plan", () => {
	it("saves the plan as a Markdown attachment in the new chat's draft", async () => {
		const { test, source, target } = await setup();
		await seedPlan(test, source.id);

		const added = await test.container.actions.attachments.addPlan(target.id, {
			sessionId: source.id,
			turnId: "t1" as TurnId,
		});

		expect(added.ok).toBe(true);
		if (!added.ok) return;
		expect(added.value.endsWith("/Fix the login bug.md")).toBe(true);
		expect(test.memory.controls.files.get(added.value)).toBe(
			"# Fix the login bug\n\nChange the parser, then run the tests.",
		);
		expect(test.container.services.composer.draftOf(target.id).attachmentPaths).toEqual([
			added.value,
		]);
	});

	it("reports a failed write as Failed to attach plan", async () => {
		const { test, source, target } = await setup();
		await seedPlan(test, source.id);
		vi.spyOn(test.container.platform.fs, "writeTextAtomic").mockResolvedValue(
			err(appError("fs_denied", "The file could not be written.")),
		);

		const added = await test.container.actions.attachments.addPlan(target.id, {
			sessionId: source.id,
			turnId: "t1" as TurnId,
		});

		expect(added.ok).toBe(false);
		if (added.ok) return;
		expect(added.error.message).toBe("Failed to attach plan");
	});

	it("reports a plan that is no longer in the chat as Failed to attach plan", async () => {
		const { test, source, target } = await setup();

		const added = await test.container.actions.attachments.addPlan(target.id, {
			sessionId: source.id,
			turnId: "missing" as TurnId,
		});

		expect(added.ok).toBe(false);
		if (added.ok) return;
		expect(added.error.message).toBe("Failed to attach plan");
	});
});

describe("CHAT-26 a live user message dates the chat", () => {
	it("moves lastUserMessageAt forward when the sidecar's user message arrives", async () => {
		const { test, source } = await setup();
		expect(
			test.container.services.sessions.store.getState().sessions[source.id]?.lastUserMessageAt,
		).toBeNull();

		test.container.services.sessions.applyStoredEvent(
			source.id,
			0,
			userMessageEvent("u1", "t1", 40),
			41,
		);
		test.container.services.sessions.applyStoredEvent(
			source.id,
			0,
			userMessageEvent("u0", "t0", 30),
			41,
		);

		expect(
			test.container.services.sessions.store.getState().sessions[source.id]?.lastUserMessageAt,
		).toBe(40);
	});
});
