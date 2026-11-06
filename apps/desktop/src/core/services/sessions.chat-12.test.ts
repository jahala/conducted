// @vitest-environment node
/**
 * @feature CHAT-12 Plan review
 * Behaviour: claude-runner.md 3.5 (hand off sends the plan to a chat or a new one for
 * implementation), ui-map.md 3.3 (the 'Sending to <chat>' picker).
 * Test first: a new chat is created with plan mode off and receives the plan text; a chosen chat
 * receives it without a second chat being created.
 */
import type { SessionConfig } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";

const config: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: true,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const plan = "First, change the parser.\nThen run the tests.";

let open: TestContainer | null = null;

async function setup() {
	const test = createTestContainer();
	open = test;
	const workspace = await seedWorkspace(test.container);
	const origin = await test.container.services.sessions.create(workspace.id, config);
	if (!origin.ok) throw new Error(JSON.stringify(origin.error));
	return { test, workspace, origin: origin.value };
}

afterEach(() => {
	vi.restoreAllMocks();
	if (open !== null) {
		open.close();
		open = null;
	}
});

describe("CHAT-12 start from a plan", () => {
	it("creates a new chat with plan mode off and sends the plan there", async () => {
		const { test, workspace, origin } = await setup();
		test.container.services.settings.store.setState((state) => ({
			values: { ...state.values, default_plan_mode: true },
		}));
		const send = vi
			.spyOn(test.container.services.sessions, "send")
			.mockResolvedValue(ok(undefined));

		const result = await test.container.services.sessions.startFromPlan(origin.id, plan, null);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.id).not.toBe(origin.id);
		expect(result.value.workspaceId).toBe(workspace.id);
		expect(result.value.config.planMode).toBe(false);
		expect(send).toHaveBeenCalledWith(result.value.id, plan, [], "auto");
	});

	it("sends the plan to the chosen chat without creating another one", async () => {
		const { test, workspace, origin } = await setup();
		const target = await test.container.services.sessions.create(workspace.id, {
			...config,
			planMode: false,
		});
		if (!target.ok) throw new Error(JSON.stringify(target.error));
		const before = Object.keys(test.container.services.sessions.store.getState().sessions).length;
		const send = vi
			.spyOn(test.container.services.sessions, "send")
			.mockResolvedValue(ok(undefined));

		const result = await test.container.services.sessions.startFromPlan(
			origin.id,
			plan,
			target.value.id,
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.id).toBe(target.value.id);
		expect(send).toHaveBeenCalledWith(target.value.id, plan, [], "auto");
		expect(Object.keys(test.container.services.sessions.store.getState().sessions)).toHaveLength(
			before,
		);
	});

	it("refuses a chat in another workspace", async () => {
		const { test, origin } = await setup();
		const other = await seedWorkspace(test.container);
		const foreign = await test.container.services.sessions.create(other.id, config);
		if (!foreign.ok) throw new Error(JSON.stringify(foreign.error));
		const send = vi
			.spyOn(test.container.services.sessions, "send")
			.mockResolvedValue(ok(undefined));

		const result = await test.container.services.sessions.startFromPlan(
			origin.id,
			plan,
			foreign.value.id,
		);

		expect(result).toMatchObject({ ok: false, error: { code: "chat_plan_target_invalid" } });
		expect(send).not.toHaveBeenCalled();
	});

	it("refuses a plan with no text", async () => {
		const { test, origin } = await setup();
		const send = vi
			.spyOn(test.container.services.sessions, "send")
			.mockResolvedValue(ok(undefined));

		const result = await test.container.services.sessions.startFromPlan(origin.id, "   ", null);

		expect(result).toMatchObject({ ok: false, error: { code: "chat_plan_empty" } });
		expect(send).not.toHaveBeenCalled();
	});
});
