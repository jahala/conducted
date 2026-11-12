/**
 * @feature test support A container wired to the in-memory Platform and a real database
 * Owns: building the real composition root for tests, inert values for every outside world it
 * needs, and the seed helpers that write rows through the repositories and load them into the
 * matching service stores.
 * Behaviour: not applicable, test support only.
 * Must handle: every container input except the platform can be overridden, the app's database
 * can be wrapped (one held or failing statement) while the test reads the real one, a second
 * container can reopen the first one's database as a restarted app does, ids are never a
 * constant, and `close` releases the database it opened (a test that started the container awaits
 * `container.stop()` first). Construction does not call `container.start()`, so a test decides
 * when stores load.
 * Test first: a seeded project is visible through the repo service's store and two ids differ.
 */

import { LOCAL_HOST, type SessionEvent } from "@conducted/protocol";
import type { Clock, MessageId, SessionId, TurnId, WorkspaceId } from "@conducted/shared";
import { initialSyncEnabled } from "../core/cloud/file-sync.ts";
import {
	type Container,
	type ContainerInputs,
	createContainer,
	type UiToast,
} from "../core/container.ts";
import type { NewRepo } from "../core/db/repos.ts";
import { createRepositories } from "../core/db/repositories.ts";
import type { NewWorkspace } from "../core/db/workspaces.ts";
import type { Repo, Workspace } from "../core/model.ts";
import type { SoundPlayer } from "../core/services/notifications.ts";
import { tomlCodec } from "../core/services/toml-codec.ts";
import type { PlaceNames } from "../core/services/workspace-creation.ts";
import { writeRedactedReport } from "../features/diagnostics/diagnostics-report.ts";
import { createMemoryPlatform, type MemoryPlatform } from "../platform/memory.ts";
import type { Database } from "../platform/platform.ts";
import { createTestIds } from "./ids.ts";
import { openTestDatabase } from "./sqlite.ts";

const FIXED_NOW = 1_700_000_000_000;
const FIXED_CLOCK: Clock = { now: () => FIXED_NOW };
const SILENT_SOUND: SoundPlayer = { play: async () => {} };

/** A place name that is never already taken. */
const createTestPlaceNames = (): PlaceNames => ({
	pick: (taken) => {
		let attempt = 1;
		let name = "test-place";
		while (taken.has(name)) name = `test-place-${++attempt}`;
		return name;
	},
});

export type TestContainerOptions = Partial<Omit<ContainerInputs, "platform">> & {
	/** The in-memory file commands refuse paths outside the app's file scope, as files.rs does. */
	enforceFileScope?: boolean;
	/**
	 * Wraps the real database the app is given, for a test that holds or fails one statement
	 * (`holdingOnExecute`, `failingOnSelect`). `TestContainer.database` stays the unwrapped one.
	 */
	wrapDatabase?: (database: Database) => Database;
	/**
	 * Another container's database, so this container is the app after a restart over the same
	 * file. The container that opened it still owns it; this one's `close` leaves it open.
	 */
	restartOver?: Database;
};

export interface TestContainer {
	container: Container;
	memory: MemoryPlatform;
	database: Database;
	/** What the container told the user about background work that failed (`reportFailure`). */
	reported: { title: string; message: string }[];
	/** What the container asked the toast host to show (`showToast`). */
	toasted: UiToast[];
	close(): void;
}

/** A new migrated database that `close` releases, or a restarted app's shared one it leaves open. */
function databaseFor(shared: Database | undefined): { database: Database; close: () => void } {
	if (shared !== undefined) return { database: shared, close: () => {} };
	const store = openTestDatabase();
	return { database: store.database, close: () => store.close() };
}

/** Builds the real container over the in-memory Platform and a migrated database. */
export function createTestContainer(options: TestContainerOptions = {}): TestContainer {
	const clock = options.clock ?? FIXED_CLOCK;
	const ids = options.ids ?? createTestIds();
	const { database, close } = databaseFor(options.restartOver);
	const memory = createMemoryPlatform({
		clock,
		ids,
		database: options.wrapDatabase?.(database) ?? database,
		version: "0.0.0-test",
		channel: "dev",
		enforceFileScope: options.enforceFileScope,
	});
	// A normal app has its helper programs downloaded (PLAT-35). A test that checks what happens
	// without one removes it first.
	for (const program of ["gh", "watchexec"] as const) {
		memory.controls.files.set(`${memory.platform.fs.paths.appData}/bin/${program}`, "");
		memory.controls.setProgramStatus({
			program,
			state: "ready",
			version: "test",
			bytesDownloaded: 0,
			bytesTotal: null,
			attempt: 0,
			nextAttemptAt: null,
			error: null,
			path: `${memory.platform.fs.paths.appData}/bin/${program}`,
			follow: null,
		});
	}
	const reported: { title: string; message: string }[] = [];
	const toasted: UiToast[] = [];
	const container = createContainer({
		platform: memory.platform,
		clock,
		ids,
		toml: options.toml ?? tomlCodec,
		placeNames: options.placeNames ?? createTestPlaceNames(),
		sound: options.sound ?? SILENT_SOUND,
		windowFocused: options.windowFocused ?? (() => false),
		openLink: options.openLink,
		// The app entry toasts these; a test reads what would have been told from `reported`.
		reportFailure: (title, error) => {
			reported.push({ title, message: error.message });
		},
		showToast: options.showToast ?? ((notice) => toasted.push(notice)),
		writeDiagnosticsReport:
			options.writeDiagnosticsReport ??
			((capture, fileName) => writeRedactedReport(memory.platform, capture, fileName)),
	});
	return {
		container,
		memory,
		database,
		reported,
		toasted,
		close,
	};
}

/** Repositories over the container's database, for the seed helpers. */
const seedRepositories = (container: Container) =>
	createRepositories(container.platform.db, {
		clock: FIXED_CLOCK,
		ids: { uuid: () => crypto.randomUUID() },
	});

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

/** Appends one stored event through the repositories, so a service that reads the database sees it. */
export async function seedSessionEvent(
	container: Container,
	sessionId: SessionId,
	event: SessionEvent,
	receivedAt: number,
): Promise<void> {
	must(await seedRepositories(container).sessionEvents.append(sessionId, event, receivedAt));
}

/**
 * Writes a chat's user message and records its time, as the event ingest does, then reloads the
 * chat list so the store sees `lastUserMessageAt`.
 */
export async function seedUserMessage(
	container: Container,
	sessionId: SessionId,
	event: Extract<SessionEvent, { type: "user_message" }>,
	receivedAt: number,
): Promise<void> {
	const repositories = seedRepositories(container);
	must(await repositories.sessionEvents.append(sessionId, event, receivedAt));
	must(await repositories.sessions.recordUserMessage(sessionId, event.at));
	must(await container.services.sessions.start());
}

/** Marks a chat's events from a turn on as reverted, as a revert to that turn does (CHAT-15). */
export async function seedRevertFromTurn(
	container: Container,
	sessionId: SessionId,
	turnId: TurnId,
	revertedAt: number,
): Promise<void> {
	must(
		await seedRepositories(container).sessionEvents.markRevertedFromTurn(
			sessionId,
			turnId,
			revertedAt,
		),
	);
}

/** Writes one project through the repositories and loads the repo store from the database. */
export async function seedRepo(
	container: Container,
	partial: Partial<NewRepo> = {},
): Promise<Repo> {
	const suffix = crypto.randomUUID().slice(0, 8);
	const created = await seedRepositories(container).repos.create({
		name: partial.name ?? `project-${suffix}`,
		rootPath: partial.rootPath ?? `/code/projects/${suffix}`,
		remoteUrl: partial.remoteUrl ?? null,
		defaultBranch: partial.defaultBranch ?? "main",
		icon: partial.icon ?? null,
		hidden: partial.hidden,
	});
	must(await container.services.repo.start());
	return must(created);
}

/** Writes one workspace through the repositories and loads the workspace store. */
export async function seedWorkspace(
	container: Container,
	partial: Partial<NewWorkspace> = {},
): Promise<Workspace> {
	const repoId = partial.repoId ?? (await seedRepo(container)).id;
	const suffix = crypto.randomUUID().slice(0, 8);
	const created = await seedRepositories(container).workspaces.create({
		repoId,
		directoryName: partial.directoryName ?? `workspace-${suffix}`,
		path: partial.path ?? `/code/workspaces/${suffix}`,
		branch: partial.branch ?? `jahala/workspace-${suffix}`,
		branchIsPlaceholder: partial.branchIsPlaceholder ?? true,
		targetBranch: partial.targetBranch ?? "origin/main",
		port: partial.port ?? 55_000,
		linkedPaths: partial.linkedPaths ?? [],
		setupLogPath: partial.setupLogPath ?? null,
		host: partial.host ?? LOCAL_HOST,
		// As the app's create step: a cloud workspace starts with the Advanced setting (on by
		// default), one on this Mac with sync off.
		remoteFileSyncEnabled:
			partial.remoteFileSyncEnabled ?? initialSyncEnabled(partial.host ?? LOCAL_HOST, true),
	});
	must(await container.services.workspace.start());
	return must(created);
}

/** Stores the pull request a workspace is linked to. */
export async function seedPullRequest(
	container: Container,
	workspaceId: WorkspaceId,
	pr: { number: number; title: string; description: string | null },
): Promise<void> {
	must(await seedRepositories(container).workspaces.setPullRequest(workspaceId, pr));
}

/**
 * Stores a queued follow-up that failed to send, as the queue leaves one after a failed send. The
 * queue service reads it when the chat's queue loads.
 */
export async function seedFailedQueuedMessage(
	container: Container,
	sessionId: SessionId,
	text: string,
	lastError: string,
): Promise<MessageId> {
	const repositories = seedRepositories(container);
	const row = must(
		await repositories.queuedMessages.enqueue({
			id: crypto.randomUUID() as MessageId,
			sessionId,
			text,
			attachmentPaths: [],
			delivery: "queue",
		}),
	);
	must(await repositories.queuedMessages.setState(row.id, "waiting", "failed", lastError));
	return row.id;
}

/** Stores the context window an agent reported for a model, as the event ingest records it. */
export async function seedContextWindow(
	container: Container,
	agent: string,
	model: string,
	windowTokens: number,
): Promise<void> {
	must(await seedRepositories(container).modelContextWindows.record(agent, model, windowTokens));
}
