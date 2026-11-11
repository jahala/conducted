// @vitest-environment node
/**
 * @feature AGENT-17 ACP chat options beyond the model
 * Behaviour: other-runners.md sections 2.2 and 5, services-map.md 2.5.2 and 5B.5.4.
 * Must handle: warming a saved chat before its options are listed, a chat that is not ACP,
 * a failed list, a rejected set, and two overlapping loads where only the newest answer may
 * change the store.
 * Test first: two loads whose answers arrive in the wrong order keep the newer options.
 */
import type { AcpConfigOption, SessionConfig } from "@conducted/protocol";
import { appError, err, ok, type Result, type SessionId } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import { openTestDatabase, type TestDatabase } from "../../test/sqlite.ts";
import { createRepositories, type Repositories } from "../db/repositories.ts";
import { SessionsService, type SessionsServiceDeps } from "./sessions.ts";

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
	let resolve = (_value: T): void => {};
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
};

const thoughtLevel = (current: string): AcpConfigOption => ({
	id: "thought_level",
	name: "Thought level",
	value: {
		kind: "select",
		current,
		choices: [
			{ value: "low", name: "Low" },
			{ value: "medium", name: "Medium" },
			{ value: "high", name: "High" },
		],
	},
});

const acpConfig = (over: Partial<SessionConfig> = {}): SessionConfig => ({
	agent: "acp",
	acpAgent: "opencode",
	model: "one",
	effort: "medium",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
	...over,
});

interface Call {
	method: string;
	params: Record<string, unknown>;
}

interface Harness {
	service: SessionsService;
	repositories: Repositories;
	calls: Call[];
}

const database = (): TestDatabase => openTestDatabase();
const open: TestDatabase[] = [];

const harness = (
	store: TestDatabase,
	reply: (method: string, params: Record<string, unknown>) => Promise<Result<unknown>>,
	launch: { launchFor: SessionsServiceDeps["launchFor"] } = {
		launchFor: async () => ok({ env: {}, providerKeys: {} }),
	},
): Harness => {
	const { launchFor } = launch;
	let next = 0;
	const calls: Call[] = [];
	const repositories = createRepositories(store.database, {
		clock: { now: () => 1000 },
		ids: { uuid: () => `id-${++next}` },
	});
	const workspace = {
		workspaceId: "ws-1",
		workspaceName: "demo",
		workspacePath: "/code/demo",
		repoRootPath: "/code/repo",
		targetBranch: "origin/main",
		placeholderBranch: false,
		port: 55_000,
	};
	const deps = {
		db: store.database,
		repositories: () => repositories,
		sidecar: {
			request: async (method: string, params: Record<string, unknown>) => {
				calls.push({ method, params });
				return reply(method, params);
			},
			notify: async () => ok(undefined),
		},
		composer: {
			materializeForSend: async () => ok([]),
			clearDraft: async () => ok(undefined),
			draftOf: () => ({ text: "", attachmentPaths: [] }),
			loadDraft: async () => ok({ text: "", attachmentPaths: [] }),
			saveDraft: async () => ok(undefined),
		},
		queue: {
			enqueue: async () => ok({}),
			release: () => {},
			pauseOnCancel: () => {},
			store: { getState: () => ({ bySession: {}, pausedSessionIds: {} }) },
		},
		notifications: { onLiveStateChanged: () => {} },
		...(launchFor === undefined ? {} : { launchFor }),
		workspaceContextOf: async () => ok(workspace),
		defaultConfig: async () => ok(acpConfig()),
		setting: () => "",
		now: () => 1000,
		newId: () => `id-${++next}`,
	};
	return {
		// seam: AGENT-17 the sidecar client is the only outside world this service needs here
		service: new SessionsService(deps as unknown as SessionsServiceDeps),
		repositories,
		calls,
	};
};

const seedChat = async (h: Harness, config: SessionConfig): Promise<SessionId> => {
	const repo = must(
		await h.repositories.repos.create({
			name: `repo-${Math.random().toString(36).slice(2)}`,
			rootPath: "/code/repo",
			remoteUrl: null,
			defaultBranch: "main",
			icon: null,
		}),
	);
	const workspace = must(
		await h.repositories.workspaces.create({
			repoId: repo.id,
			directoryName: `workspace-${Math.random().toString(36).slice(2)}`,
			path: "/code/demo",
			branch: "demo",
			branchIsPlaceholder: false,
			remoteFileSyncEnabled: false,
			host: { kind: "local" },
			targetBranch: "origin/main",
			port: 55_000,
			linkedPaths: [],
			setupLogPath: null,
		}),
	);
	const chat = must(
		await h.repositories.sessions.create({
			workspaceId: workspace.id,
			title: "ACP chat",
			config,
		}),
	);
	return chat.id;
};

afterEach(() => {
	for (const store of open.splice(0)) store.close();
});

describe("AGENT-17 ACP chat options service", () => {
	it("warms a saved ACP chat and lists its options beyond the model", async () => {
		const store = database();
		open.push(store);
		const h = harness(store, async (method) =>
			method === "listAcpConfigOptions" ? ok({ options: [thoughtLevel("high")] }) : ok({}),
		);
		const id = await seedChat(h, acpConfig({ acpConfig: { thought_level: "high" } }));

		const loaded = await h.service.loadAcpConfigOptions(id);

		expect(loaded).toEqual(ok([thoughtLevel("high")]));
		expect(h.calls.map((call) => call.method)).toEqual(["warmAgent", "listAcpConfigOptions"]);
		expect(h.calls[0]?.params).toMatchObject({
			sessionId: id,
			config: acpConfig({ acpConfig: { thought_level: "high" } }),
			launch: { env: {}, providerKeys: {} },
		});
		expect(h.service.store.getState().acpConfigOptions?.[id]).toEqual({
			state: "ready",
			data: [thoughtLevel("high")],
		});
	});

	it("returns no options for a chat that is not ACP and asks the sidecar nothing", async () => {
		const store = database();
		open.push(store);
		const h = harness(store, async () => ok({}));
		const id = await seedChat(h, acpConfig({ agent: "claude", acpAgent: undefined }));

		const loaded = await h.service.loadAcpConfigOptions(id);

		expect(loaded).toEqual(ok([]));
		expect(h.calls).toEqual([]);
		expect(h.service.store.getState().acpConfigOptions?.[id]).toEqual({
			state: "ready",
			data: [],
		});
	});

	it("keeps the newest options when two loads answer out of order", async () => {
		const store = database();
		open.push(store);
		const olderListStarted = deferred<void>();
		const releaseOlderList = deferred<void>();
		let list = 0;
		const h = harness(store, async (method) => {
			if (method !== "listAcpConfigOptions") return ok({});
			list += 1;
			if (list === 1) {
				olderListStarted.resolve(undefined);
				await releaseOlderList.promise;
				return ok({ options: [thoughtLevel("low")] });
			}
			return ok({ options: [thoughtLevel("high")] });
		});
		const id = await seedChat(h, acpConfig());

		const older = h.service.loadAcpConfigOptions(id);
		await olderListStarted.promise;
		const newer = h.service.loadAcpConfigOptions(id);
		await newer;
		expect(h.service.store.getState().acpConfigOptions?.[id]).toEqual({
			state: "ready",
			data: [thoughtLevel("high")],
		});

		releaseOlderList.resolve(undefined);
		await older;

		expect(h.service.store.getState().acpConfigOptions?.[id]).toEqual({
			state: "ready",
			data: [thoughtLevel("high")],
		});
	});

	it("stores a failed load as an error the composer can report", async () => {
		const store = database();
		open.push(store);
		const failure = appError("acp_model_not_loaded", "The model was not found.");
		const h = harness(store, async (method) =>
			method === "listAcpConfigOptions" ? err(failure) : ok({}),
		);
		const id = await seedChat(h, acpConfig());

		const loaded = await h.service.loadAcpConfigOptions(id);

		expect(loaded).toEqual(err(failure));
		expect(h.service.store.getState().acpConfigOptions?.[id]).toEqual({
			state: "error",
			error: failure,
		});
	});

	it("sets an option, keeps it in the chat config and stores the new option list", async () => {
		const store = database();
		open.push(store);
		const h = harness(store, async (method) =>
			method === "setAcpConfigOption" ? ok({ options: [thoughtLevel("high")] }) : ok({}),
		);
		const id = await seedChat(h, acpConfig());

		const changed = await h.service.setAcpOption(id, "thought_level", "high");

		expect(changed).toEqual(ok(undefined));
		expect(h.calls[0]).toEqual({
			method: "setAcpConfigOption",
			params: { sessionId: id, optionId: "thought_level", value: "high" },
		});
		expect(h.service.store.getState().acpConfigOptions?.[id]).toEqual({
			state: "ready",
			data: [thoughtLevel("high")],
		});
		const stored = must(await h.repositories.sessions.get(id));
		expect(stored?.config.acpConfig).toEqual({ thought_level: "high" });
	});

	it("keeps the saved config when the agent refuses the option", async () => {
		const store = database();
		open.push(store);
		const failure = appError("acp_option_unknown", "The agent no longer offers that option.");
		const h = harness(store, async (method) =>
			method === "setAcpConfigOption" ? err(failure) : ok({}),
		);
		const id = await seedChat(h, acpConfig({ acpConfig: { thought_level: "medium" } }));

		const changed = await h.service.setAcpOption(id, "ghost", "high");

		expect(changed).toEqual(err(failure));
		expect(h.calls.map((call) => call.method)).toEqual(["setAcpConfigOption"]);
		const stored = must(await h.repositories.sessions.get(id));
		expect(stored?.config.acpConfig).toEqual({ thought_level: "medium" });
	});
});

describe("AGENT-17 and SIDE-21 an ACP chat's options need its launch", () => {
	it("AGENT-17 with no launch settings the load fails with the reason and asks the sidecar nothing", async () => {
		const store = database();
		open.push(store);
		const h = harness(store, async () => ok({}), { launchFor: undefined });
		const id = await seedChat(h, acpConfig());

		const loaded = await h.service.loadAcpConfigOptions(id);

		expect(loaded).toMatchObject({ ok: false, error: { code: "chat_launch_missing" } });
		expect(h.calls).toEqual([]);
		expect(h.service.store.getState().acpConfigOptions?.[id]).toMatchObject({
			state: "error",
			error: { code: "chat_launch_missing" },
		});
	});

	it("SIDE-21 a launch that cannot be built fails the load with its reason and starts nothing", async () => {
		const store = database();
		open.push(store);
		const h = harness(store, async () => ok({}), {
			launchFor: async () =>
				err(appError("launch_secret_missing", "The value of OPENAI_API_KEY is missing.")),
		});
		const id = await seedChat(h, acpConfig());

		const loaded = await h.service.loadAcpConfigOptions(id);

		expect(loaded).toMatchObject({
			ok: false,
			error: { code: "launch_secret_missing", message: "The value of OPENAI_API_KEY is missing." },
		});
		expect(h.calls).toEqual([]);
	});
});
