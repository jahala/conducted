/**
 * @feature DATA-01 All repositories built over one database handle
 * Owns: the one list of repositories and the one function that builds them, so a service can
 * run several tables inside a single transaction.
 * Behaviour: services-map.md 2.3 (operations per table); the S.U.P.E.R. rule that dependencies
 * are parameters.
 * Must handle: building is cheap and does no I/O, so `db.transaction((tx) => createRepositories(
 * tx, deps))` is the normal way to touch two tables atomically; the handle passed in decides
 * which transaction the statements join.
 * Test first: createRepositories returns an object with all seventeen repositories.
 */
import type { Database } from "../../platform/platform.ts";
import { type AttachmentRepository, createAttachmentRepository } from "./attachments.ts";
import {
	type BacklogWorkspaceRepository,
	createBacklogWorkspaceRepository,
} from "./backlog-workspaces.ts";
import type { RepositoryDeps } from "./deps.ts";
import { createDiffCommentRepository, type DiffCommentRepository } from "./diff-comments.ts";
import { createEnvVarRepository, type EnvVarRepository } from "./env-vars.ts";
import { createFavoriteModelRepository, type FavoriteModelRepository } from "./favorite-models.ts";
import {
	createModelContextWindowRepository,
	type ModelContextWindowRepository,
} from "./model-context-windows.ts";
import { createProviderKeyRepository, type ProviderKeyRepository } from "./provider-keys.ts";
import { createQueuedMessageRepository, type QueuedMessageRepository } from "./queued-messages.ts";
import { createRepoRepository, type RepoRepository } from "./repos.ts";
import { createSectionRepository, type SectionRepository } from "./sections.ts";
import { createSessionEventRepository, type SessionEventRepository } from "./session-events.ts";
import {
	createSessionLiveStateRepository,
	type SessionLiveStateRepository,
} from "./session-live-state.ts";
import { createSessionRepository, type SessionRepository } from "./sessions.ts";
import { createSettingsRepository, type SettingsRepository } from "./settings.ts";
import { createSnippetRepository, type SnippetRepository } from "./snippets.ts";
import { createTerminalRepository, type TerminalRepository } from "./terminals.ts";
import { createWorkspaceRepository, type WorkspaceRepository } from "./workspaces.ts";

export type { RepositoryDeps } from "./deps.ts";

export interface Repositories {
	repos: RepoRepository;
	workspaces: WorkspaceRepository;
	sessions: SessionRepository;
	sessionEvents: SessionEventRepository;
	liveStates: SessionLiveStateRepository;
	queuedMessages: QueuedMessageRepository;
	diffComments: DiffCommentRepository;
	attachments: AttachmentRepository;
	terminals: TerminalRepository;
	sections: SectionRepository;
	favoriteModels: FavoriteModelRepository;
	settings: SettingsRepository;
	envVars: EnvVarRepository;
	backlogWorkspaces: BacklogWorkspaceRepository;
	snippets: SnippetRepository;
	providerKeys: ProviderKeyRepository;
	modelContextWindows: ModelContextWindowRepository;
}

export function createRepositories(db: Database, deps: RepositoryDeps): Repositories {
	return {
		repos: createRepoRepository(db, deps),
		workspaces: createWorkspaceRepository(db, deps),
		sessions: createSessionRepository(db, deps),
		sessionEvents: createSessionEventRepository(db, deps),
		liveStates: createSessionLiveStateRepository(db, deps),
		queuedMessages: createQueuedMessageRepository(db, deps),
		diffComments: createDiffCommentRepository(db, deps),
		attachments: createAttachmentRepository(db, deps),
		terminals: createTerminalRepository(db, deps),
		sections: createSectionRepository(db, deps),
		favoriteModels: createFavoriteModelRepository(db, deps),
		settings: createSettingsRepository(db, deps),
		envVars: createEnvVarRepository(db, deps),
		backlogWorkspaces: createBacklogWorkspaceRepository(db, deps),
		snippets: createSnippetRepository(db, deps),
		providerKeys: createProviderKeyRepository(db, deps),
		modelContextWindows: createModelContextWindowRepository(db, deps),
	};
}
