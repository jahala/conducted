/**
 * @feature NAV-02 Route test support
 * Owns: the one container the router and shell tests render over: the real composition root on the in-memory
 * Platform, with the repo, workspace, chat and settings stores loaded with what a test names.
 * Behaviour: not applicable, test support only (docs/engineering.md: screens are tested over the real container).
 * Our design choice: `createTestContainer` cannot run under jsdom (its database loader needs a file URL), so
 * this builds the container over a database that refuses every query. The stores are filled directly, the way a
 * finished start would, and nothing in the shell reads the database after that.
 * Must handle: ids stay as the test wrote them; every settings write is recorded and can be made to fail with a
 * message; the same container serves the key, menu and deep-link listeners the root mounts.
 * Test first: covered by the router and shell tests that use it.
 */
import {
	appError,
	err,
	ok,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import { vi } from "vitest";
import { type Container, createContainer } from "../core/container.ts";
import type { Repo, Session, Workspace } from "../core/model.ts";
import type { SettingValue } from "../core/registries/settings.ts";
import { tomlCodec } from "../core/services/toml-codec.ts";
import { createMemoryPlatform } from "../platform/memory.ts";
import type { Database } from "../platform/platform.ts";
import { toastError } from "../ui/Toast.tsx";

export interface ShellFixture {
	repos?: readonly Repo[];
	workspaces?: readonly Workspace[];
	sessions?: readonly { id: string; workspaceId: string }[];
	/** Settings values the shell reads, over the registry defaults. */
	settings?: Record<string, SettingValue>;
	/** Makes every settings write fail with this message. */
	failSettingsWrites?: string;
}

export interface ShellContainer {
	container: Container;
	settingsWrites: { key: string; value: unknown }[];
}

/**
 * Writes a settings row the way an earlier run of the app left it, without touching the settings store.
 * The store learns of it when the settings service loads, as it does on a real launch.
 */
export async function saveSetting(database: Database, key: string, value: unknown): Promise<void> {
	await database.execute("INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3)", [
		key,
		JSON.stringify(value),
		1,
	]);
}

const refuseDatabase = (): Promise<never> =>
	Promise.reject(new Error("The shell tests do not read the database."));

const unusedDatabase: Database = {
	execute: refuseDatabase,
	select: refuseDatabase,
	transaction: refuseDatabase,
};

function session(row: { id: string; workspaceId: string }): Session {
	return {
		id: row.id as SessionId,
		workspaceId: row.workspaceId as WorkspaceId,
		title: null,
		config: {
			agent: "claude",
			model: "default",
			effort: "high",
			fastMode: false,
			planMode: false,
			requireToolApproval: false,
			additionalDirectories: [],
			appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
		},
		agentSessionId: null,
		forkResumeNativeMessageId: null,
		unreadCount: 0,
		contextUsedTokens: null,
		queuePausedAt: null,
		closedAt: null,
		lastUserMessageAt: null,
		createdAt: 0,
		updatedAt: 0,
	};
}

/** The real container on the in-memory Platform, with its stores holding the fixture. */
export function createShellContainer(fixture: ShellFixture = {}): ShellContainer {
	let nextId = 0;
	const clock = { now: () => 1_700_000_000_000 };
	const ids = { uuid: () => `shell-test-id-${++nextId}` };
	const memory = createMemoryPlatform({ clock, ids, database: unusedDatabase });
	const container = createContainer({
		platform: memory.platform,
		clock,
		ids,
		toml: tomlCodec,
		placeNames: { pick: () => `place-${++nextId}` },
		sound: { play: async () => {} },
		windowFocused: () => true,
		reportFailure: (title, error) => {
			toastError(title, error);
		},
	});
	const { services } = container;
	const repos = fixture.repos ?? [];
	const workspaces = fixture.workspaces ?? [];
	const sessions = fixture.sessions ?? [];

	services.repo.store.setState({
		loaded: true,
		reposById: Object.fromEntries(repos.map((row) => [row.id, row])),
		order: repos.map((row) => row.id),
		configs: {},
	});
	services.workspace.store.setState({
		loaded: true,
		workspacesById: Object.fromEntries(workspaces.map((row) => [row.id, row])),
	});
	services.sessions.store.setState({
		loaded: true,
		sessions: Object.fromEntries(sessions.map((row) => [row.id, session(row)])),
	});
	services.sections.store.setState({ loaded: true, sections: [] });
	services.terminals.store.setState({
		loaded: true,
		byWorkspace: Object.fromEntries(workspaces.map((row) => [row.id, []])),
	});
	vi.spyOn(services.terminals, "loadWorkspace").mockImplementation(async () => ok(undefined));
	// A finished start has loaded the settings, and the shell draws nothing until they are.
	services.settings.store.setState({ loaded: true });
	if (fixture.settings !== undefined) {
		const values = fixture.settings;
		services.settings.store.setState((state) => ({ values: { ...state.values, ...values } }));
	}

	const settingsWrites: { key: string; value: unknown }[] = [];
	vi.spyOn(services.settings, "set").mockImplementation(
		async (key: string, value: unknown): Promise<Result<void>> => {
			if (fixture.failSettingsWrites !== undefined) {
				return err(appError("settings_write_failed", fixture.failSettingsWrites));
			}
			settingsWrites.push({ key, value });
			services.settings.store.setState((state) => ({
				values: { ...state.values, [key]: value as SettingValue },
			}));
			return ok(undefined);
		},
	);
	vi.spyOn(container.actions.workspaces, "setActiveSession").mockImplementation(async () =>
		ok(undefined),
	);
	return { container, settingsWrites };
}
