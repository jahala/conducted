/**
 * @feature APP-01 Startup sequence
 * Owns: the container side of the ordered start: its inputs, the services it builds, the order of its
 * steps, the one-run guard, stop, and the wiring that runs after start.
 * Behaviour: services-map.md 1.1, 6 and the appendix (explicit start order, settings first, stores
 * before the sidecar, chats reset before a screen reads them).
 * Test first: createContainer returns a container whose services has every service named in the
 * Services interface, and builds without calling any placeholder.
 */
import { appError, err, ok } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryPlatform, type MemoryPlatform } from "../platform/memory.ts";
import type { Database } from "../platform/platform.ts";
import { createContainer, QUIT_STOP_LIMIT_MS, type Services } from "./container.ts";
import type { Repo, Session, Workspace } from "./model.ts";
import { tomlCodec } from "./services/toml-codec.ts";
import { UPDATE_CHECK_INTERVAL_MS } from "./services/updates.ts";
import { SessionResume } from "./sidecar/resume.ts";

vi.mock("./db/lifetime.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./db/lifetime.ts")>();
	return {
		...actual,
		runDataLifetimeJob: async () => ({
			ok: true,
			value: { kind: "skipped", lastRunAt: 0 },
		}),
	};
});

const clock = { now: () => 1_000 };
const ids = (() => {
	let next = 0;
	return { uuid: () => `id-${++next}` };
})();

// Every key of the Services interface. The compiler rejects this object when a service is added
// or removed, so the list cannot drift from the interface it checks.
const SERVICE_NAMES = Object.keys({
	settings: true,
	repo: true,
	workspace: true,
	sections: true,
	favoriteModels: true,
	contextWindows: true,
	agentCatalog: true,
	mcp: true,
	linear: true,
	cloudPairing: true,
	cloudDeploy: true,
	cloudWorkspace: true,
	cloudSettings: true,
	cloudMcpOAuth: true,
	cloudMcpImport: true,
	cloudFileSync: true,
	git: true,
	graphite: true,
	gitCache: true,
	github: true,
	localGitForge: true,
	checkpoint: true,
	fileDiff: true,
	workspaceFiles: true,
	review: true,
	sessions: true,
	followUpQueue: true,
	composer: true,
	runScripts: true,
	spotlight: true,
	ports: true,
	portForwards: true,
	terminals: true,
	notifications: true,
	updates: true,
	system: true,
	commands: true,
	conductorImport: true,
} satisfies Record<keyof Services, true>);

function recordingDatabase(events: string[]): Database {
	const database: Database = {
		execute: async (sql) => {
			events.push(`sql:${sql}`);
			return { rowsAffected: 0 };
		},
		select: async <Row>() => [] as Row[],
		transaction: async <T>(work: (tx: Database) => Promise<T>) => work(database),
	};
	return database;
}

interface Harness {
	container: ReturnType<typeof createContainer>;
	memory: MemoryPlatform;
	events: string[];
}

function build(options: { openLink?: (url: string) => void } = {}): Harness {
	const events: string[] = [];
	const memory = createMemoryPlatform({
		clock,
		ids,
		database: recordingDatabase(events),
	});
	const container = createContainer({
		platform: memory.platform,
		clock,
		ids,
		toml: tomlCodec,
		placeNames: { pick: () => "place" },
		sound: { play: async () => {} },
		windowFocused: () => true,
		// This test starts no background work, so nothing is reported.
		reportFailure: () => undefined,
		showToast: () => undefined,
		...(options.openLink === undefined ? {} : { openLink: options.openLink }),
	});
	return { container, memory, events };
}

/** Replaces the services other features still own, so the container's own order is what runs. */
function stubStartup(harness: Harness): void {
	const { container, events } = harness;
	const settingsStart = container.services.settings.start.bind(container.services.settings);
	vi.spyOn(container.services.settings, "start").mockImplementation(async () => {
		events.push("start:settings");
		return settingsStart();
	});
	const record = (service: { start: () => Promise<{ ok: boolean }> }, name: string): void => {
		vi.spyOn(service, "start").mockImplementation(async () => {
			events.push(`start:${name}`);
			return ok(undefined) as never;
		});
	};
	record(container.services.repo, "repo");
	record(container.services.workspace, "workspace");
	record(container.services.sections, "sections");
	record(container.services.favoriteModels, "favorite-models");
	record(container.services.terminals, "terminals");
	record(container.services.sessions, "chats");
	record(container.services.system, "programs");

	// Run scripts belongs to RUN-01 and its stop is still a placeholder; the container's own stop
	// wiring is what this test checks, so the unbuilt dependency is stubbed like the starts above.
	vi.spyOn(container.services.runScripts, "stopAll").mockResolvedValue(ok(undefined));

	vi.spyOn(container.sidecar, "start").mockImplementation(async () => {
		events.push("start:sidecar");
		return ok(undefined);
	});
	vi.spyOn(container.sidecar, "onReconnected").mockReturnValue(() => {});
	vi.spyOn(container.sidecar, "stop").mockImplementation(() => {});
	vi.spyOn(SessionResume.prototype, "resume").mockImplementation(async () => {
		events.push("resume");
		return ok({ adopted: [], interrupted: [], failed: [] });
	});
}

function indexOf(events: string[], needle: string): number {
	return events.findIndex((event) => event.includes(needle));
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("APP-01 container", () => {
	it("builds every named service without touching the database", () => {
		const database: Database = {
			execute: () => Promise.reject(new Error("APP-01 must not read the database while building.")),
			select: () => Promise.reject(new Error("APP-01 must not read the database while building.")),
			transaction: () =>
				Promise.reject(new Error("APP-01 must not read the database while building.")),
		};
		const memory = createMemoryPlatform({ clock, ids, database });
		const container = createContainer({
			platform: memory.platform,
			clock,
			ids,
			toml: tomlCodec,
			placeNames: { pick: () => "place" },
			sound: { play: async () => {} },
			windowFocused: () => true,
			// This test starts no background work, so nothing is reported.
			reportFailure: () => undefined,
			showToast: () => undefined,
		});

		expect(Object.keys(container.services).sort()).toEqual([...SERVICE_NAMES].sort());
		expect(Object.keys(container.actions)).toEqual(
			expect.arrayContaining(["projects", "workspaces", "sessions", "app"]),
		);
	});

	it("passes the TOML codec and the git runner into settings", async () => {
		const { container, memory } = build();

		await container.services.settings.getForRepo("branch_prefix_custom", "/code/app", null);

		expect(memory.controls.shellCalls.some((command) => command.program === "git")).toBe(true);
	});

	it("starts settings first, then repos, workspaces, chats, the sidecar and resume", async () => {
		const harness = build();
		stubStartup(harness);

		const result = await harness.container.start();
		expect(result.ok).toBe(true);

		const events = harness.events;
		expect(events[0]).toBe("start:settings");
		expect(indexOf(events, "start:repo")).toBeLessThan(indexOf(events, "start:workspace"));
		expect(indexOf(events, "start:workspace")).toBeLessThan(indexOf(events, "start:chats"));
		expect(indexOf(events, "start:chats")).toBeLessThan(indexOf(events, "start:sidecar"));
		expect(indexOf(events, "start:sidecar")).toBeLessThan(indexOf(events, "resume"));
		expect(events).not.toContain("start:git");

		await harness.container.stop();
	});

	it("awaits each step before starting the next", async () => {
		const harness = build();
		stubStartup(harness);
		let releaseRepo: () => void = () => {};
		const repoGate = new Promise<void>((resolve) => {
			releaseRepo = resolve;
		});
		vi.mocked(harness.container.services.repo.start).mockImplementation(async () => {
			harness.events.push("start:repo");
			await repoGate;
			return ok(undefined);
		});

		const running = harness.container.start();
		await vi.waitFor(() => expect(harness.events).toContain("start:repo"));
		expect(harness.events).not.toContain("start:workspace");

		releaseRepo();
		await running;
		expect(harness.events).toContain("start:workspace");

		await harness.container.stop();
	});

	it("keeps starting when a non-fatal step fails, as favourite models and sections may", async () => {
		const harness = build();
		stubStartup(harness);
		vi.mocked(harness.container.services.favoriteModels.start).mockResolvedValue(
			err(appError("favorites_failed", "The favourite models could not be read.")),
		);
		vi.mocked(harness.container.services.sections.start).mockResolvedValue(
			err(appError("sections_failed", "The sections could not be read.")),
		);

		const result = await harness.container.start();

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.warnings).toEqual(
				expect.arrayContaining([
					{ step: "favorite models", message: "The favourite models could not be read." },
					{ step: "sections", message: "The sections could not be read." },
				]),
			);
		}
		expect(harness.events).toContain("start:chats");

		await harness.container.stop();
	});

	it("resets chat live state before the chats service reads it", async () => {
		const harness = build();
		stubStartup(harness);

		await harness.container.start();

		const resetAt = indexOf(harness.events, "UPDATE session_live_state");
		expect(resetAt).toBeGreaterThanOrEqual(0);
		expect(resetAt).toBeLessThan(indexOf(harness.events, "start:chats"));

		await harness.container.stop();
	});

	it("runs the start once and hands the same result to a second caller", async () => {
		const harness = build();
		stubStartup(harness);

		const first = harness.container.start();
		const second = harness.container.start();
		expect(second).toBe(first);
		await first;
		expect(vi.mocked(harness.container.services.settings.start).mock.calls.length).toBe(1);

		await harness.container.stop();
	});

	it("stops the repo service and the after-start listeners", async () => {
		const harness = build({ openLink: () => {} });
		stubStartup(harness);
		const dispose = vi.spyOn(harness.container.services.repo, "dispose");

		await harness.container.start();
		expect(harness.memory.controls.dispose()).toBeGreaterThan(0);

		await harness.container.stop();

		expect(dispose).toHaveBeenCalledTimes(1);
		expect(harness.memory.controls.dispose()).toBe(0);
	});

	it("stops the settings service, releasing its focus listener and reload timer", async () => {
		const harness = build();
		stubStartup(harness);
		const stop = vi.spyOn(harness.container.services.settings, "stop");

		await harness.container.start();
		await harness.container.stop();

		expect(stop).toHaveBeenCalledTimes(1);
	});
});

describe("APP-01 after start", () => {
	it("keeps the dock badge in step with unread chats", async () => {
		const harness = build();
		stubStartup(harness);

		await harness.container.start();
		expect(harness.memory.controls.dockBadge).toBeNull();

		harness.container.services.workspace.store.setState({
			workspacesById: { w: { state: "ready" } as Workspace },
		});
		harness.container.services.sessions.store.setState({
			sessions: {
				s: { workspaceId: "w", unreadCount: 3, closedAt: null } as Session,
			},
		});

		expect(harness.memory.controls.dockBadge).toBe(1);

		await harness.container.stop();
	});

	it("routes notification clicks to the app opener and leaves deep links to the dispatcher", async () => {
		const opened: string[] = [];
		const harness = build({ openLink: (url) => opened.push(url) });
		stubStartup(harness);

		await harness.container.start();
		harness.memory.controls.emitNotificationClick("conducted://workspace?id=w&session=s");
		harness.memory.controls.emitDeepLink("conducted://settings/general");

		expect(opened).toEqual(["conducted://workspace?id=w&session=s"]);

		await harness.container.stop();
	});

	it("reports a warning when no link opener was given", async () => {
		const harness = build();
		stubStartup(harness);

		const result = await harness.container.start();

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.warnings).toContainEqual({
				step: "links",
				message: "Notification clicks are not wired: no link opener was given to the container.",
			});
		}

		await harness.container.stop();
	});

	it("schedules update checks at start", async () => {
		vi.useFakeTimers();
		const harness = build();
		stubStartup(harness);
		vi.mocked(harness.container.services.settings.start).mockResolvedValue(ok(undefined));
		const check = vi
			.spyOn(harness.container.services.updates, "check")
			.mockResolvedValue(ok(undefined));

		await harness.container.start();
		expect(check).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
		expect(check).toHaveBeenCalledTimes(1);

		await harness.container.stop();
	});

	it("asks whether agents are idle before quitting", async () => {
		const harness = build();
		stubStartup(harness);
		const safe = vi
			.spyOn(harness.container.services.updates, "isSafeToQuit")
			.mockReturnValue(false);
		const quit = vi.spyOn(harness.memory.platform.app, "quit").mockResolvedValue(undefined);
		const confirm = vi.spyOn(harness.memory.platform.dialogs, "confirm");

		await harness.container.start();

		harness.memory.controls.queueDialogAnswers({ confirm: false });
		harness.memory.controls.emitQuitRequested();
		await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
		expect(quit).not.toHaveBeenCalled();

		safe.mockReturnValue(true);
		harness.memory.controls.emitQuitRequested();
		await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));

		await harness.container.stop();
	});

	it("the Quit command asks and quits the same way as the menu's Quit", async () => {
		const harness = build();
		stubStartup(harness);
		const safe = vi
			.spyOn(harness.container.services.updates, "isSafeToQuit")
			.mockReturnValue(false);
		const quit = vi.spyOn(harness.memory.platform.app, "quit").mockResolvedValue(undefined);
		const confirm = vi.spyOn(harness.memory.platform.dialogs, "confirm");

		await harness.container.start();

		harness.memory.controls.queueDialogAnswers({ confirm: false });
		harness.container.actions.app.quit();
		await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
		expect(quit).not.toHaveBeenCalled();

		safe.mockReturnValue(true);
		harness.container.actions.app.quit();
		await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));

		await harness.container.stop();
	});

	it("quits once the stop limit passes, even when a stop step never ends", async () => {
		const harness = build();
		stubStartup(harness);
		vi.spyOn(harness.container.services.updates, "isSafeToQuit").mockReturnValue(true);
		const quit = vi.spyOn(harness.memory.platform.app, "quit").mockResolvedValue(undefined);
		// A composer flush that hangs, as a stuck disk write would.
		vi.spyOn(harness.container.services.composer, "flush").mockReturnValue(new Promise(() => {}));

		await harness.container.start();
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			harness.memory.controls.emitQuitRequested();
			await vi.advanceTimersByTimeAsync(QUIT_STOP_LIMIT_MS - 1);
			expect(quit).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			expect(quit).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("stops the container before it quits, so drafts and stored events are written first", async () => {
		const harness = build();
		stubStartup(harness);
		vi.spyOn(harness.container.services.updates, "isSafeToQuit").mockReturnValue(true);
		const quit = vi.spyOn(harness.memory.platform.app, "quit").mockResolvedValue(undefined);
		const flush = vi.spyOn(harness.container.services.composer, "flush");
		const detach = vi.mocked(harness.container.sidecar.stop);

		await harness.container.start();
		harness.memory.controls.emitQuitRequested();
		// A second request while the first one stops the app does not stop or quit twice.
		harness.memory.controls.emitQuitRequested();
		await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));

		expect(flush).toHaveBeenCalledTimes(1);
		expect(detach).toHaveBeenCalledTimes(1);
		const [flushedAt] = flush.mock.invocationCallOrder;
		const [detachedAt] = detach.mock.invocationCallOrder;
		const [quitAt] = quit.mock.invocationCallOrder;
		expect(flushedAt).toBeLessThan(quitAt ?? 0);
		expect(detachedAt).toBeLessThan(quitAt ?? 0);
	});

	it("quits through the same stop-first path for a screen that cannot send the quit request", async () => {
		const harness = build();
		stubStartup(harness);
		const quit = vi.spyOn(harness.memory.platform.app, "quit").mockResolvedValue(undefined);
		const flush = vi.spyOn(harness.container.services.composer, "flush");
		const detach = vi.mocked(harness.container.sidecar.stop);

		await harness.container.start();
		harness.container.quit();
		// A second call while the first one stops the app does not stop or quit twice.
		harness.container.quit();
		await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));

		expect(flush).toHaveBeenCalledTimes(1);
		expect(detach).toHaveBeenCalledTimes(1);
		const [flushedAt] = flush.mock.invocationCallOrder;
		const [detachedAt] = detach.mock.invocationCallOrder;
		const [quitAt] = quit.mock.invocationCallOrder;
		expect(flushedAt).toBeLessThan(quitAt ?? 0);
		expect(detachedAt).toBeLessThan(quitAt ?? 0);
	});

	it("asks the user before quitting while agents are working", async () => {
		const harness = build();
		stubStartup(harness);
		vi.spyOn(harness.container.services.updates, "isSafeToQuit").mockReturnValue(false);
		const quit = vi.spyOn(harness.memory.platform.app, "quit").mockResolvedValue(undefined);
		const confirm = vi.spyOn(harness.memory.platform.dialogs, "confirm");

		await harness.container.start();

		harness.memory.controls.queueDialogAnswers({ confirm: false });
		harness.memory.controls.emitQuitRequested();
		await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
		expect(quit).not.toHaveBeenCalled();

		harness.memory.controls.queueDialogAnswers({ confirm: true });
		harness.memory.controls.emitQuitRequested();
		await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));

		await harness.container.stop();
	});

	it("fails the start when the sidecar does not start", async () => {
		const harness = build();
		stubStartup(harness);
		vi.mocked(harness.container.sidecar.start).mockResolvedValue(
			err(appError("sidecar_failed", "The agent sidecar did not start.")),
		);

		const result = await harness.container.start();

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain("The agent sidecar did not start.");
		}
		expect(harness.container.services.sessions.start).toHaveBeenCalled();

		await harness.container.stop();
	});

	it("heals a leftover Spotlight checkpoint for every repository", async () => {
		const harness = build();
		stubStartup(harness);
		harness.container.services.repo.store.setState({
			reposById: { r: { rootPath: "/code/app" } as Repo },
		});
		const heal = vi
			.spyOn(harness.container.services.spotlight, "healAfterCrash")
			.mockResolvedValue(ok(true));

		await harness.container.start();

		expect(heal).toHaveBeenCalledWith("/code/app");

		await harness.container.stop();
	});
});
