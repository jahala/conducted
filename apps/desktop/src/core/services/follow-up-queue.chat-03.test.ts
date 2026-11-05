// @vitest-environment node
/**
 * @feature CHAT-03 Steer a running turn
 * Owns: sending a queued message into the running turn now, and the rules for an agent that cannot steer.
 * Behaviour: services-map.md 2.3.4 (a steer row is delivered at once and its row is deleted),
 * sessions-and-chats.md "While the agent is working", other-runners.md 2.4 (steering fallback).
 * Test first: sendNowAsSteer marks the row steer, sends it, and deletes it once accepted.
 */
import { appError, err, type MessageId, ok, type Result, type SessionId } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTestDatabase, type TestDatabase } from "../../test/sqlite.ts";
import { REPOS_SQL, repoToParams } from "../db/repos.ts";
import { createRepositories, type Repositories } from "../db/repositories.ts";
import { sampleRepo, sampleSession, sampleWorkspace, workspaceId } from "../db/test-fixtures.ts";
import { WORKSPACES_SQL, workspaceToParams } from "../db/workspaces.ts";
import type { QueuedMessage } from "../model.ts";
import { getCommand } from "../registries/commands.ts";
import { getSettingDef } from "../registries/settings.ts";
import { agentCanSteer, chooseDelivery, FollowUpQueue } from "./follow-up-queue.ts";

let store: TestDatabase;
let repositories: Repositories;
let sessionId: SessionId;
let deliver: ReturnType<typeof makeDeliver>;
let liveState: "idle" | "working";
let queue: FollowUpQueue;

const makeDeliver = () =>
	vi.fn(async (_row: QueuedMessage): Promise<Result<void>> => ok(undefined));

const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const enqueue = async (id: string, delivery: "queue" | "steer" = "queue") => {
	const created = await repositories.queuedMessages.enqueue({
		id: id as MessageId,
		sessionId,
		text: `Text ${id}`,
		attachmentPaths: [],
		delivery,
	});
	return must(created);
};

beforeEach(async () => {
	store = openTestDatabase();
	let next = 0;
	repositories = createRepositories(store.database, {
		clock: { now: () => 1000 },
		ids: { uuid: () => `repo-${++next}` },
	});
	store.raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
	store.raw.prepare(WORKSPACES_SQL.insert).run(bind(must(workspaceToParams(sampleWorkspace))));
	const session = must(
		await repositories.sessions.create({
			workspaceId,
			title: null,
			config: sampleSession.config,
		}),
	);
	sessionId = session.id;
	liveState = "working";
	deliver = makeDeliver();
	queue = new FollowUpQueue({
		repos: repositories,
		deliver,
		liveStateOf: () =>
			liveState === "working"
				? {
						status: "working",
						pendingSteerIds: [],
						backgroundTasks: [],
						fastModeAvailable: true,
					}
				: {
						status: "idle",
						pendingSteerIds: [],
						backgroundTasks: [],
						fastModeAvailable: true,
					},
	});
});

afterEach(() => {
	store.close();
});

describe("CHAT-03 send a queued message now as a steer", () => {
	it("marks the row steer, sends it now, and deletes it once accepted", async () => {
		const row = await enqueue("m1");
		queue.store.setState({ bySession: { [sessionId]: [row] } });

		const result = await queue.sendNowAsSteer(row.id);

		expect(result).toEqual(ok(undefined));
		expect(deliver).toHaveBeenCalledTimes(1);
		expect(deliver).toHaveBeenCalledWith(
			expect.objectContaining({ id: "m1", sessionId, text: "Text m1", delivery: "steer" }),
		);
		expect(must(await repositories.queuedMessages.get(row.id))).toBeNull();
		expect(queue.store.getState().bySession[sessionId]).toEqual([]);
	});

	it("keeps the row as failed and restores its follow-up delivery when the send fails", async () => {
		const row = await enqueue("m1");
		queue.store.setState({ bySession: { [sessionId]: [row] } });
		deliver.mockResolvedValueOnce(err(appError("sidecar_down", "The sidecar is not running.")));

		const result = await queue.sendNowAsSteer(row.id);

		expect(result).toMatchObject({ ok: false, error: { code: "sidecar_down" } });
		const stored = must(await repositories.queuedMessages.get(row.id));
		expect(stored).toMatchObject({
			state: "failed",
			delivery: "queue",
			lastError: "The sidecar is not running.",
		});
		expect(queue.store.getState().bySession[sessionId]).toEqual([
			expect.objectContaining({ id: "m1", state: "failed", delivery: "queue" }),
		]);
	});

	it("refuses a row that another send already took", async () => {
		const row = await enqueue("m1");
		must(await repositories.queuedMessages.setState(row.id, "waiting", "sending", null));

		const result = await queue.sendNowAsSteer(row.id);

		expect(result).toMatchObject({ ok: false, error: { code: "queue_not_waiting" } });
		expect(deliver).not.toHaveBeenCalled();
	});

	it("reports a queued message that no longer exists", async () => {
		const result = await queue.sendNowAsSteer("gone" as MessageId);

		expect(result).toMatchObject({ ok: false, error: { code: "queue_unknown" } });
		expect(deliver).not.toHaveBeenCalled();
	});

	it("refuses to steer while an agent that cannot steer is working", async () => {
		must(
			await repositories.sessions.setConfig(sessionId, {
				...sampleSession.config,
				agent: "acp",
				acpAgent: "opencode",
			}),
		);
		const row = await enqueue("m1");

		const result = await queue.sendNowAsSteer(row.id);

		expect(result).toMatchObject({ ok: false, error: { code: "steer_unsupported" } });
		expect(deliver).not.toHaveBeenCalled();
		const stored = must(await repositories.queuedMessages.get(row.id));
		expect(stored).toMatchObject({ state: "waiting", delivery: "queue" });
	});

	it("sends for an agent that cannot steer when no turn is running", async () => {
		must(
			await repositories.sessions.setConfig(sessionId, {
				...sampleSession.config,
				agent: "acp",
				acpAgent: "pi",
			}),
		);
		liveState = "idle";
		const row = await enqueue("m1");

		const result = await queue.sendNowAsSteer(row.id);

		expect(result).toEqual(ok(undefined));
		expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ id: "m1", delivery: "steer" }));
		expect(must(await repositories.queuedMessages.get(row.id))).toBeNull();
	});
});

describe("CHAT-03 the follow-up setting chooses steering or queueing", () => {
	it("offers 'Follow-up behavior' on General with steer and queue, defaulting to steer", () => {
		const setting = getSettingDef("default_message_send_mode");

		expect(setting).toMatchObject({
			page: "general",
			title: "Follow-up behavior",
			feature: "CHAT-03",
			type: "enum",
			default: "steer",
			options: [
				{ value: "steer", label: "Steer the agent" },
				{ value: "queue", label: "Queue for later" },
			],
		});
	});

	it("follows the setting for a working chat and keeps the queue when told to", () => {
		const base = { mode: "auto" as const, working: true, canSteer: true };
		expect(chooseDelivery({ ...base, defaultMode: "steer" })).toBe("steer");
		expect(chooseDelivery({ ...base, defaultMode: "queue" })).toBe("queue");
	});

	it("sends at once when no turn is running, whatever the setting says", () => {
		expect(
			chooseDelivery({ mode: "steer", working: false, defaultMode: "queue", canSteer: true }),
		).toBe("send_now");
		expect(
			chooseDelivery({ mode: "queue", working: false, defaultMode: "steer", canSteer: true }),
		).toBe("send_now");
	});

	it("queues a steer for OpenCode and Pi instead of offering it", () => {
		expect(agentCanSteer({ agent: "acp" })).toBe(false);
		expect(agentCanSteer({ agent: "claude" })).toBe(true);
		expect(agentCanSteer({ agent: "codex" })).toBe(true);
		expect(agentCanSteer({ agent: "cursor" })).toBe(true);
		expect(
			chooseDelivery({ mode: "steer", working: true, defaultMode: "steer", canSteer: false }),
		).toBe("queue");
	});

	it("binds Cmd+Enter to sending with the opposite follow-up behaviour", () => {
		expect(getCommand("chat.submitOpposite")).toMatchObject({
			defaultShortcuts: ["Cmd+Enter"],
			scope: "chat-input",
			feature: "CHAT-03",
		});
	});
});
