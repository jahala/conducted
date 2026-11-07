/**
 * @feature catalogue Seed helpers for the states catalogue
 * Owns: writing projects, workspaces, chats, chat events and settings through the app's own repositories
 * before the app starts, so its services load them the way they load a user's database.
 * Behaviour: not applicable, a development tool. The helpers mirror src/test/container.ts (seedRepo,
 * seedWorkspace) and src/test/chat-events.ts, which do the same for the tests over node:sqlite.
 * Must handle: a failed write stops the state with the repository's own message, so a broken seed never
 * draws a half-seeded screen.
 * Test first: not applicable; the screenshot run opens every state on it.
 */
import { LOCAL_HOST, type SessionConfig, type SessionEvent } from "@conducted/protocol";
import type { Result, SessionId } from "@conducted/shared";
import type { Repo, Session, Workspace } from "../core/model.ts";
import { HOME, type World } from "./world.ts";

export const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(`Catalogue seed failed: ${result.error.message}`);
	return result.value;
};

export const CLAUDE_CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

/** Stores a setting in the database, as the settings page would. */
export async function setSetting(world: World, key: string, value: unknown): Promise<void> {
	must(await world.repositories.settings.set(key, value));
}

export interface RepoSeed {
	name: string;
	remoteUrl?: string | null;
	defaultBranch?: string;
}

/** Adds a project whose clone sits in `~/code/<name>`. */
export async function addRepo(world: World, seed: RepoSeed): Promise<Repo> {
	return must(
		await world.repositories.repos.create({
			name: seed.name,
			rootPath: `${HOME}/code/${seed.name}`,
			remoteUrl:
				seed.remoteUrl === undefined ? `git@github.com:acme/${seed.name}.git` : seed.remoteUrl,
			defaultBranch: seed.defaultBranch ?? "main",
			icon: null,
		}),
	);
}

export interface WorkspaceSeed {
	/** The place name, which is also the folder and the branch suffix. */
	name: string;
	/** Defaults to `sam/<name>`. */
	branch?: string;
	state?: "ready" | "archived" | "failed";
	displayName?: string;
	pr?: { number: number; title: string };
	pinned?: boolean;
	lastActivityAt?: number;
}

/** Adds a workspace under `~/conducted/workspaces/<project>/<name>`, ready unless the seed says otherwise. */
export async function addWorkspace(
	world: World,
	repo: Repo,
	seed: WorkspaceSeed,
): Promise<Workspace> {
	const { workspaces } = world.repositories;
	const taken = must(await workspaces.listPorts());
	const created = must(
		await workspaces.create({
			repoId: repo.id,
			directoryName: seed.name,
			path: `${HOME}/conducted/workspaces/${repo.name}/${seed.name}`,
			branch: seed.branch ?? `sam/${seed.name}`,
			branchIsPlaceholder: false,
			targetBranch: `origin/${repo.defaultBranch}`,
			port: 55_000 + 10 * taken.length,
			linkedPaths: [],
			setupLogPath: null,
			host: LOCAL_HOST,
		}),
	);
	const state = seed.state ?? "ready";
	if (state === "failed") {
		must(await workspaces.transitionState(created.id, "initializing", "failed"));
	} else {
		must(await workspaces.transitionState(created.id, "initializing", "ready"));
	}
	if (state === "archived") {
		must(await workspaces.transitionState(created.id, "ready", "archiving"));
		must(await workspaces.markArchived(created.id, "4f1c2ab"));
	}
	if (seed.displayName !== undefined) {
		must(await workspaces.setDisplayName(created.id, seed.displayName));
	}
	if (seed.pr !== undefined) {
		must(
			await workspaces.setPullRequest(created.id, {
				number: seed.pr.number,
				title: seed.pr.title,
				description: null,
			}),
		);
	}
	if (seed.pinned === true) must(await workspaces.setPinned(created.id, world.clock.now()));
	if (seed.lastActivityAt !== undefined) {
		must(await workspaces.touchActivity(created.id, seed.lastActivityAt));
	}
	return must(await workspaces.get(created.id)) ?? created;
}

export interface ChatSeed {
	/** Null, as for a chat that has no title yet. */
	title: string | null;
	config?: SessionConfig;
	unread?: number;
	/** Makes this the chat the workspace opens on. */
	active?: boolean;
}

/** Adds a chat to a workspace. */
export async function addChat(
	world: World,
	workspace: Workspace,
	seed: ChatSeed,
): Promise<Session> {
	const { sessions, workspaces } = world.repositories;
	const session = must(
		await sessions.create({
			workspaceId: workspace.id,
			title: seed.title,
			config: seed.config ?? CLAUDE_CONFIG,
		}),
	);
	for (let index = 0; index < (seed.unread ?? 0); index++) {
		must(await sessions.incrementUnread(session.id));
	}
	if (seed.active !== false) must(await workspaces.setActiveSession(workspace.id, session.id));
	return session;
}

/** Stores chat events in order, as the event ingest stores what the sidecar sends. */
export async function addEvents(
	world: World,
	sessionId: SessionId,
	events: readonly SessionEvent[],
): Promise<void> {
	for (const event of events) {
		must(await world.repositories.sessionEvents.append(sessionId, event, event.at));
	}
}
