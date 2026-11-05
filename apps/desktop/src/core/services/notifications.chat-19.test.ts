/**
 * @feature CHAT-19 Notify when a chat finishes or needs the user
 * Owns: the tests for when a chat notice fires, what it says, and the order of the sound and the
 * native notification.
 * Behaviour: services-map.md 5B.2.2 to 5B.2.4 (triggers, suppression, delay, title), ui-map.md 6.
 * Test first: a finished notice waits two seconds, then plays the sound before the notification.
 */
import type { Interaction, LiveState, SessionConfig } from "@conducted/protocol";
import type { InteractionId, MessageId, SessionId, ToolUseId } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { createRepositories } from "../db/repositories.ts";
import { userMessageEvent } from "../db/test-fixtures.ts";
import type { Session, Workspace } from "../model.ts";
import { getSettingDef } from "../registries/settings.ts";
import { buildDeepLink, isSuppressed, SETTLE_DELAY_MS } from "./notifications.ts";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const working = (): LiveState => ({
	status: "working",
	pendingSteerIds: [],
	backgroundTasks: [],
	fastModeAvailable: true,
});

const idle = (over: Partial<LiveState> = {}): LiveState => ({
	status: "idle",
	pendingSteerIds: [],
	backgroundTasks: [],
	fastModeAvailable: true,
	...over,
});

const open = (id: string, interaction: Interaction): LiveState =>
	idle({
		status: "working",
		openInteraction: {
			interactionId: id as InteractionId,
			interaction,
			since: 1,
		},
	});

const question: Interaction = {
	kind: "question",
	questions: [{ question: "Continue?", options: [], multiSelect: false }],
};

const toolApproval: Interaction = {
	kind: "tool_approval",
	toolUseId: "tool-1" as ToolUseId,
	toolName: "Bash",
	input: {},
};

const planApproval: Interaction = { kind: "plan_approval", plan: "Do the work." };

const permissionGrant: Interaction = {
	kind: "permission_grant",
	description: "Read the project files",
	paths: [],
	network: false,
};

const mcpForm: Interaction = {
	kind: "mcp_form",
	server: "linear",
	message: "Fill in the issue.",
	schema: {},
};

interface Harness {
	test: ReturnType<typeof createTestContainer>;
	session: Session;
	workspace: Workspace;
	played: string[];
	events: string[];
}

async function harness(options: { windowFocused?: boolean } = {}): Promise<Harness> {
	const played: string[] = [];
	const events: string[] = [];
	const test = createTestContainer({
		windowFocused: () => options.windowFocused ?? false,
		sound: {
			play: async (soundId) => {
				played.push(soundId);
				events.push(`sound:${soundId}`);
			},
		},
	});
	const workspace = await seedWorkspace(test.container);
	const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	const native = test.memory.platform.notifications.notify.bind(test.memory.platform.notifications);
	test.memory.platform.notifications.notify = async (input) => {
		events.push("native");
		await native(input);
	};
	return { test, session, workspace, played, events };
}

async function finish(h: Harness, live: LiveState = idle()): Promise<void> {
	must(await h.test.container.services.sessions.applyLiveState(h.session.id, working()));
	must(await h.test.container.services.sessions.applyLiveState(h.session.id, live));
	await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS);
}

async function stop(h: Harness): Promise<void> {
	await h.test.container.stop();
	h.test.close();
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("CHAT-19 finished and failed notices", () => {
	it("waits two seconds, then names the chat and plays the sound before the notification", async () => {
		const h = await harness();
		try {
			must(await h.test.container.services.sessions.rename(h.session.id, "Fix the failing tests"));
			must(await h.test.container.services.sessions.applyLiveState(h.session.id, working()));
			must(await h.test.container.services.sessions.applyLiveState(h.session.id, idle()));

			await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS - 1);
			expect(h.test.memory.controls.notificationsShown).toHaveLength(0);

			await vi.advanceTimersByTimeAsync(1);
			expect(h.test.memory.controls.notificationsShown).toEqual([
				{
					title: "Fix the failing tests",
					body: "Agent finished. Click to view session.",
					deepLink: buildDeepLink(h.workspace.id, h.session.id),
				},
			]);
			expect(h.events).toEqual(["sound:default", "native"]);
		} finally {
			await stop(h);
		}
	});

	it("names the workspace when the chat has no title", async () => {
		const h = await harness();
		try {
			must(await h.test.container.services.workspace.rename(h.workspace.id, "Payment service"));
			await finish(h);
			expect(h.test.memory.controls.notificationsShown[0]?.title).toBe("Payment service");
		} finally {
			await stop(h);
		}
	});

	it("does not announce a turn closed as interrupted as finished", async () => {
		const h = await harness();
		try {
			const repositories = createRepositories(h.test.container.platform.db, {
				clock: { now: () => 1000 },
				ids: { uuid: () => crypto.randomUUID() },
			});
			must(
				await repositories.sessionEvents.append(
					h.session.id,
					userMessageEvent("event-1", "turn-1", 1),
					1,
				),
			);
			must(await h.test.container.services.sessions.applyLiveState(h.session.id, working()));
			must(await h.test.container.services.sessions.markInterrupted(h.session.id));
			await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS);
			expect(h.test.memory.controls.notificationsShown).toHaveLength(0);
		} finally {
			await stop(h);
		}
	});

	it("raises the failed notice for a turn that ended with an error", async () => {
		const h = await harness();
		try {
			await finish(h, idle({ error: "The model ran out of context." }));
			expect(h.test.memory.controls.notificationsShown[0]?.body).toBe(
				"Agent failed. Click to view session.",
			);
		} finally {
			await stop(h);
		}
	});

	it("does not notify for an error that is not a settled turn", async () => {
		const h = await harness();
		try {
			must(
				await h.test.container.services.sessions.applyLiveState(
					h.session.id,
					idle({ error: "A query failed." }),
				),
			);
			await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS);
			expect(h.test.memory.controls.notificationsShown).toHaveLength(0);
			expect(h.played).toEqual([]);
		} finally {
			await stop(h);
		}
	});

	it("notifies once per turn, even when the same idle state arrives twice", async () => {
		const h = await harness();
		try {
			await finish(h);
			expect(h.test.memory.controls.notificationsShown).toHaveLength(1);

			must(await h.test.container.services.sessions.applyLiveState(h.session.id, idle()));
			await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS);
			expect(h.test.memory.controls.notificationsShown).toHaveLength(1);

			await finish(h);
			expect(h.test.memory.controls.notificationsShown).toHaveLength(2);
		} finally {
			await stop(h);
		}
	});
});

describe("CHAT-19 settings", () => {
	it("turns native notifications off and still plays the completion sound", async () => {
		const h = await harness();
		try {
			must(await h.test.container.services.settings.set("notifications_enabled", false));
			await finish(h);
			expect(h.test.memory.controls.notificationsShown).toHaveLength(0);
			expect(h.played).toEqual(["default"]);
		} finally {
			await stop(h);
		}
	});

	it("offers our own two completion sounds", () => {
		const def = getSettingDef("sound_type");
		expect(def?.type).toBe("enum");
		expect(def?.type === "enum" ? def.options.map((option) => option.value) : []).toEqual([
			"default",
			"none",
		]);
	});

	it("plays the chosen sound, and no sound when sound_type is none", async () => {
		const h = await harness();
		try {
			must(await h.test.container.services.settings.set("sound_type", "none"));
			await finish(h);
			expect(h.played).toEqual([]);
			expect(h.test.memory.controls.notificationsShown).toHaveLength(1);
		} finally {
			await stop(h);
		}
	});
});

describe("CHAT-19 messages that need the user", () => {
	it("notifies at once for a plan, a question, a tool approval, a permission grant and an MCP form", async () => {
		const h = await harness();
		try {
			const interactions: Interaction[] = [
				planApproval,
				question,
				toolApproval,
				permissionGrant,
				mcpForm,
			];
			for (const [index, interaction] of interactions.entries()) {
				must(
					await h.test.container.services.sessions.applyLiveState(
						h.session.id,
						open(`interaction-${index}`, interaction),
					),
				);
			}
			expect(h.test.memory.controls.notificationsShown.map((notice) => notice.body)).toEqual([
				"Plan ready. Click to review and approve the plan.",
				"Agent has a question. Click to answer it.",
				"Bash requires your permission",
				"Codex requests permission",
				"linear needs information",
			]);
		} finally {
			await stop(h);
		}
	});

	it("still notifies for a tool approval while the chat is on screen and the window focused", async () => {
		const h = await harness({ windowFocused: true });
		try {
			h.test.container.services.sessions.setViewing(h.session.id);
			must(
				await h.test.container.services.sessions.applyLiveState(
					h.session.id,
					open("approval-1", toolApproval),
				),
			);
			expect(h.test.memory.controls.notificationsShown[0]?.body).toBe(
				"Bash requires your permission",
			);
		} finally {
			await stop(h);
		}
	});

	it("skips a finished notice while the chat is on screen and the window focused", async () => {
		const h = await harness({ windowFocused: true });
		try {
			h.test.container.services.sessions.setViewing(h.session.id);
			await finish(h);
			expect(h.test.memory.controls.notificationsShown).toHaveLength(0);
			expect(h.played).toEqual([]);
		} finally {
			await stop(h);
		}
	});

	it("never notifies for a hidden chat", async () => {
		const h = await harness();
		try {
			must(await h.test.container.services.sessions.close(h.session.id));
			await finish(h);
			expect(h.test.memory.controls.notificationsShown).toHaveLength(0);
		} finally {
			await stop(h);
		}
	});

	it("suppresses notices for an archived workspace", () => {
		expect(
			isSuppressed({
				kind: "finished",
				sessionHidden: false,
				workspaceArchived: true,
				viewingThisChat: false,
				windowFocused: false,
			}),
		).toBe(true);
	});
});

describe("CHAT-19 waiting turns and queued follow-ups", () => {
	it("stays quiet while background tasks run, then notifies when they finish", async () => {
		const h = await harness();
		try {
			must(await h.test.container.services.sessions.applyLiveState(h.session.id, working()));
			must(
				await h.test.container.services.sessions.applyLiveState(
					h.session.id,
					idle({
						backgroundTasks: [{ id: "task-1", kind: "shell", description: "npm test" }],
					}),
				),
			);
			await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS);
			expect(h.test.memory.controls.notificationsShown).toHaveLength(0);

			must(await h.test.container.services.sessions.applyLiveState(h.session.id, idle()));
			await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS);
			expect(h.test.memory.controls.notificationsShown).toHaveLength(1);
		} finally {
			await stop(h);
		}
	});

	it("stays quiet while a follow-up is queued", async () => {
		const h = await harness();
		try {
			h.test.container.services.followUpQueue.store.setState({
				bySession: {
					[h.session.id]: [
						{
							id: "message-1" as MessageId,
							sessionId: h.session.id as SessionId,
							text: "Run the tests again",
							attachmentPaths: [],
							delivery: "queue",
							position: 0,
							state: "waiting",
							lastError: null,
						},
					],
				},
			});
			await finish(h);
			expect(h.test.memory.controls.notificationsShown).toHaveLength(0);
		} finally {
			await stop(h);
		}
	});

	it("clears its settle timer when the app stops", async () => {
		const h = await harness();
		try {
			must(await h.test.container.services.sessions.applyLiveState(h.session.id, working()));
			must(await h.test.container.services.sessions.applyLiveState(h.session.id, idle()));
			h.test.container.services.notifications.stop();
			await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS);
			expect(h.test.memory.controls.notificationsShown).toHaveLength(0);
		} finally {
			await stop(h);
		}
	});
});
