// @vitest-environment node
import type { DatabaseSync } from "node:sqlite";
import { idleLiveState } from "@conducted/protocol";
import {
	type MessageId,
	ok,
	type RepoId,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDatabase } from "../../test/sqlite.ts";
import { REPOS_SQL, repoToParams } from "./repos.ts";
import { createRepositories, type Repositories } from "./repositories.ts";
import { SESSIONS_SQL, sessionToParams } from "./sessions.ts";
import { SETTINGS_SQL } from "./settings.ts";
import {
	agentEvent,
	sampleAttachment,
	sampleComment,
	sampleQueued,
	sampleRepo,
	sampleSession,
	sampleWorkspace,
	sessionId,
	turnEndedEvent,
	userMessageEvent,
	workspaceId,
} from "./test-fixtures.ts";
import { WORKSPACES_SQL, workspaceToParams } from "./workspaces.ts";

/** node:sqlite binds `$1..$n` by name, so a positional list becomes `{ $1: ... }`. */
const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

let store: ReturnType<typeof openTestDatabase>;
let raw: DatabaseSync;
let repositories: Repositories;
let now: number;
let nextId: number;

beforeEach(() => {
	store = openTestDatabase();
	raw = store.raw;
	now = 1000;
	nextId = 0;
	repositories = createRepositories(store.database, {
		clock: { now: () => now },
		ids: { uuid: () => `generated-${++nextId}` },
	});
});

afterEach(() => {
	store.close();
});

const seedRepo = (): void => {
	const exists = raw.prepare("SELECT 1 FROM repos WHERE id = $1").get({ $1: sampleRepo.id });
	if (exists === undefined) {
		raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
	}
};

const seedWorkspace = (): void => {
	seedRepo();
	raw.prepare(WORKSPACES_SQL.insert).run(bind(must(workspaceToParams(sampleWorkspace))));
};

const seedSession = (): void => {
	raw.prepare(SESSIONS_SQL.insert).run(bind(must(sessionToParams(sampleSession))));
};

const seedAll = (): void => {
	seedRepo();
	seedWorkspace();
	seedSession();
};

describe("DATA-01 workspaces repository", () => {
	it("lists all, by repo and by state", async () => {
		seedRepo();
		seedWorkspace();
		now = 2000;
		const second = must(
			await repositories.workspaces.create({
				repoId: sampleRepo.id,
				directoryName: "lisbon",
				path: "/code/workspaces/lisbon",
				branch: "jahala/lisbon",
				branchIsPlaceholder: false,
				host: { kind: "local" },
				targetBranch: "origin/main",
				port: 55101,
				linkedPaths: [],
				setupLogPath: null,
			}),
		);

		expect(must(await repositories.workspaces.listAll()).map((w) => w.id)).toEqual([
			sampleWorkspace.id,
			second.id,
		]);
		expect(await repositories.workspaces.listByRepo(sampleRepo.id)).toMatchObject({ ok: true });
		expect(must(await repositories.workspaces.listByRepo(sampleRepo.id)).length).toBe(2);
		expect(must(await repositories.workspaces.listByState("ready"))).toHaveLength(1);
		expect(must(await repositories.workspaces.get("missing" as WorkspaceId))).toBeNull();
	});

	it("creates a workspace in initializing and refuses a duplicate path", async () => {
		seedRepo();
		now = 3000;
		const created = must(
			await repositories.workspaces.create({
				repoId: sampleRepo.id,
				directoryName: "kyoto",
				path: "/code/workspaces/kyoto",
				branch: "jahala/kyoto",
				branchIsPlaceholder: true,
				host: { kind: "local" },
				targetBranch: "origin/main",
				port: 55102,
				linkedPaths: ["/code/extra"],
				setupLogPath: "/data/setup-logs/kyoto.log",
			}),
		);
		expect(created).toMatchObject({
			id: "generated-1",
			state: "initializing",
			kanbanStatus: "in_progress",
			lastActivityAt: 3000,
		});
		expect(must(await repositories.workspaces.getSetupLogPath(created.id))).toBe(
			"/data/setup-logs/kyoto.log",
		);

		const duplicate = await repositories.workspaces.create({
			repoId: sampleRepo.id,
			directoryName: "kyoto-2",
			path: "/code/workspaces/kyoto",
			branch: "jahala/kyoto-2",
			branchIsPlaceholder: true,
			host: { kind: "local" },
			targetBranch: "origin/main",
			port: 55103,
			linkedPaths: [],
			setupLogPath: null,
		});
		expect(duplicate).toMatchObject({ ok: false, error: { code: "db.conflict" } });
	});

	it("moves state by compare-and-set and archives only from archiving", async () => {
		seedWorkspace();
		expect(
			await repositories.workspaces.transitionState(workspaceId, "ready", "archiving"),
		).toEqual({ ok: true, value: true });
		expect(
			await repositories.workspaces.transitionState(workspaceId, "ready", "archiving"),
		).toEqual({ ok: true, value: false });
		now = 6000;
		expect(await repositories.workspaces.markArchived(workspaceId, "abc123")).toEqual({
			ok: true,
			value: true,
		});
		const archived = must(await repositories.workspaces.get(workspaceId));
		expect(archived).toMatchObject({
			state: "archived",
			archiveCommit: "abc123",
			archivedAt: 6000,
		});
		expect(await repositories.workspaces.markArchived(workspaceId, "later")).toEqual({
			ok: true,
			value: false,
		});
	});

	it("finishes an unarchive with the restored branch, folder and path, and clears the archive time", async () => {
		seedWorkspace();
		must(await repositories.workspaces.transitionState(workspaceId, "ready", "archiving"));
		must(await repositories.workspaces.markArchived(workspaceId, "abc123"));
		must(await repositories.workspaces.transitionState(workspaceId, "archived", "initializing"));
		now = 7000;
		expect(
			await repositories.workspaces.finishUnarchive(workspaceId, {
				branch: "feature/restored",
				directoryName: "oslo-v1",
				path: "/code/workspaces/Project/oslo-v1",
			}),
		).toEqual({ ok: true, value: true });
		expect(must(await repositories.workspaces.get(workspaceId))).toMatchObject({
			state: "ready",
			branch: "feature/restored",
			directoryName: "oslo-v1",
			path: "/code/workspaces/Project/oslo-v1",
			archivedAt: null,
			archiveCommit: "abc123",
			lastActivityAt: 7000,
			updatedAt: 7000,
		});
		expect(
			await repositories.workspaces.finishUnarchive(workspaceId, {
				branch: "feature/again",
				directoryName: "oslo-v2",
				path: "/code/workspaces/Project/oslo-v2",
			}),
		).toEqual({ ok: true, value: false });
	});

	it("moves activity forward only", async () => {
		seedWorkspace();
		now = 2000;
		must(await repositories.workspaces.touchActivity(workspaceId, 2000));
		expect(must(await repositories.workspaces.get(workspaceId))?.lastActivityAt).toBe(3000);
		now = 4000;
		must(await repositories.workspaces.touchActivity(workspaceId, 5000));
		expect(must(await repositories.workspaces.get(workspaceId))?.lastActivityAt).toBe(5000);
	});

	it("writes every workspace field in its own update", async () => {
		seedWorkspace();
		must(await repositories.workspaces.setKanbanStatus(workspaceId, "in_review"));
		must(await repositories.workspaces.setDisplayName(workspaceId, "Review me"));
		must(await repositories.workspaces.setBranch(workspaceId, "jahala/renamed", false));
		must(await repositories.workspaces.setTargetBranch(workspaceId, "upstream/dev"));
		must(await repositories.workspaces.setPinned(workspaceId, null));
		must(await repositories.workspaces.setLinkedPaths(workspaceId, ["/a", "/b"]));
		must(
			await repositories.workspaces.setPullRequest(workspaceId, {
				number: 9,
				title: "Title",
				description: "Body",
			}),
		);
		const updated = must(await repositories.workspaces.get(workspaceId));
		expect(updated).toMatchObject({
			kanbanStatus: "in_review",
			displayName: "Review me",
			branch: "jahala/renamed",
			branchIsPlaceholder: false,
			targetBranch: "upstream/dev",
			pinnedAt: null,
			linkedPaths: ["/a", "/b"],
			prNumber: 9,
			prTitle: "Title",
			prDescription: "Body",
		});
	});

	it("reports a missing workspace from every setter", async () => {
		seedWorkspace();
		const missing = "missing" as WorkspaceId;
		const writes = [
			() => repositories.workspaces.setKanbanStatus(missing, "in_progress"),
			() => repositories.workspaces.setDisplayName(missing, "Name"),
			() => repositories.workspaces.setBranch(missing, "b", false),
			() => repositories.workspaces.setTargetBranch(missing, "origin/main"),
			() => repositories.workspaces.setPinned(missing, null),
			() => repositories.workspaces.setLinkedPaths(missing, []),
			() =>
				repositories.workspaces.setPullRequest(missing, {
					number: 1,
					title: null,
					description: null,
				}),
			() => repositories.workspaces.setSetupLogPath(missing, null),
		];
		for (const write of writes) {
			expect(await write()).toMatchObject({ ok: false, error: { code: "db.not_found" } });
		}
	});

	it("returns an error when a stored linked_paths column is not a list", async () => {
		seedWorkspace();
		raw
			.prepare("UPDATE workspaces SET linked_paths = $1 WHERE id = $2")
			.run({ $1: "not json", $2: workspaceId });
		expect(await repositories.workspaces.listAll()).toMatchObject({ ok: false });
		expect(await repositories.workspaces.get(workspaceId)).toMatchObject({ ok: false });
	});
});

describe("DATA-01 repos repository", () => {
	it("lists visible and hidden repositories in display order", async () => {
		seedRepo();
		expect(must(await repositories.repos.list({ includeHidden: true }))).toEqual([sampleRepo]);
		expect(must(await repositories.repos.list({ includeHidden: false }))).toEqual([]);
		expect(must(await repositories.repos.get(sampleRepo.id))).toEqual(sampleRepo);
		expect(must(await repositories.repos.getByRootPath(sampleRepo.rootPath))).toEqual(sampleRepo);
		expect(must(await repositories.repos.get("missing" as RepoId))).toBeNull();
	});

	it("creates a repo after the last display order and refuses a duplicate folder", async () => {
		seedRepo();
		now = 7000;
		const created = must(
			await repositories.repos.create({
				name: "Second",
				rootPath: "/code/second",
				remoteUrl: null,
				defaultBranch: "main",
				icon: null,
			}),
		);
		expect(created).toMatchObject({
			id: "generated-1",
			displayOrder: 3,
			hidden: false,
			createdAt: 7000,
			updatedAt: 7000,
		});

		const duplicate = await repositories.repos.create({
			name: "Again",
			rootPath: sampleRepo.rootPath,
			remoteUrl: null,
			defaultBranch: "main",
			icon: null,
		});
		expect(duplicate).toMatchObject({ ok: false, error: { code: "db.conflict" } });
	});

	it("updates one field at a time and reorders in a batch", async () => {
		seedRepo();
		now = 8000;
		const second = must(
			await repositories.repos.create({
				name: "Second",
				rootPath: "/code/second",
				remoteUrl: null,
				defaultBranch: "main",
				icon: null,
			}),
		);
		must(await repositories.repos.setDefaultBranch(second.id, "develop"));
		must(await repositories.repos.setRemoteUrl(second.id, "git@example.com:x/y.git"));
		must(await repositories.repos.setIcon(second.id, "star"));
		must(await repositories.repos.setHidden(second.id, true));
		expect(must(await repositories.repos.get(second.id))).toMatchObject({
			defaultBranch: "develop",
			remoteUrl: "git@example.com:x/y.git",
			icon: "star",
			hidden: true,
			updatedAt: 8000,
		});

		must(await repositories.repos.reorder([second.id, sampleRepo.id]));
		expect(must(await repositories.repos.list({ includeHidden: true })).map((r) => r.id)).toEqual([
			second.id,
			sampleRepo.id,
		]);
	});
});

describe("DATA-01 repos repository: missing rows and settings", () => {
	it("reports a missing repo from every setter", async () => {
		seedRepo();
		const missing = "missing" as RepoId;
		const writes = [
			() => repositories.repos.setDefaultBranch(missing, "main"),
			() => repositories.repos.setRemoteUrl(missing, null),
			() => repositories.repos.setIcon(missing, null),
			() => repositories.repos.setHidden(missing, true),
		];
		for (const write of writes) {
			expect(await write()).toMatchObject({ ok: false, error: { code: "db.not_found" } });
		}
	});

	it("removes the repo-scoped settings of a deleted repo and no one else's", async () => {
		seedRepo();
		const other = must(
			await repositories.repos.create({
				name: "Other",
				rootPath: "/code/other",
				remoteUrl: null,
				defaultBranch: "main",
				icon: null,
			}),
		);
		must(await repositories.settings.set(`repo:${sampleRepo.id}:scripts`, { run: "bun dev" }));
		must(await repositories.settings.set(`repo:${other.id}:scripts`, { run: "bun test" }));
		must(await repositories.settings.set("theme", "dark"));

		must(await repositories.repos.delete(sampleRepo.id));

		const keys = must(await repositories.settings.list()).map((setting) => setting.key);
		expect(keys).toEqual([`repo:${other.id}:scripts`, "theme"]);
		expect(must(await repositories.repos.get(sampleRepo.id))).toBeNull();
	});
});

describe("DATA-01 sessions repository", () => {
	it("creates a chat, reads it and updates its config and title", async () => {
		seedWorkspace();
		now = 2000;
		const created = must(
			await repositories.sessions.create({
				workspaceId,
				title: null,
				config: sampleSession.config,
			}),
		);
		expect(created).toMatchObject({
			id: "generated-1",
			unreadCount: 0,
			agentSessionId: null,
			createdAt: 2000,
		});
		expect(must(await repositories.sessions.get(created.id))).toEqual(created);

		expect(await repositories.sessions.setTitleIfEmpty(created.id, "From the agent")).toEqual({
			ok: true,
			value: true,
		});
		expect(await repositories.sessions.setTitleIfEmpty(created.id, "Again")).toEqual({
			ok: true,
			value: false,
		});
		must(
			await repositories.sessions.setConfig(created.id, { ...sampleSession.config, model: "opus" }),
		);
		expect(must(await repositories.sessions.get(created.id))?.config.model).toBe("opus");
	});

	it("keeps unread counts and the last user message moving forward", async () => {
		seedAll();
		must(await repositories.sessions.incrementUnread(sessionId));
		must(await repositories.sessions.incrementUnread(sessionId));
		expect(must(await repositories.sessions.get(sessionId))?.unreadCount).toBe(5);

		now = 3000;
		must(await repositories.sessions.recordUserMessage(sessionId, 3000));
		must(await repositories.sessions.recordUserMessage(sessionId, 2000));
		expect(must(await repositories.sessions.get(sessionId))?.lastUserMessageAt).toBe(4000);

		must(await repositories.sessions.clearUnread(sessionId));
		expect(must(await repositories.sessions.get(sessionId))?.unreadCount).toBe(0);
	});

	it("pauses once, closes once and reopens", async () => {
		seedAll();
		must(await repositories.sessions.pauseQueue(sessionId, 5000));
		must(await repositories.sessions.pauseQueue(sessionId, 6000));
		expect(must(await repositories.sessions.get(sessionId))?.queuePausedAt).toBe(5000);
		must(await repositories.sessions.resumeQueue(sessionId));

		expect(await repositories.sessions.close(sessionId)).toEqual({ ok: true, value: true });
		expect(await repositories.sessions.close(sessionId)).toEqual({ ok: true, value: false });
		expect(
			must(await repositories.sessions.listByWorkspace(workspaceId, { includeClosed: false })),
		).toHaveLength(0);
		must(await repositories.sessions.reopen(sessionId));
		expect(
			must(await repositories.sessions.listByWorkspace(workspaceId, { includeClosed: false })),
		).toHaveLength(1);
	});
});

describe("DATA-01 live state and events repositories", () => {
	it("keeps only the newest live state", async () => {
		seedAll();
		const working = { ...idleLiveState, status: "working" as const };
		expect(await repositories.liveStates.upsert(sessionId, working, 2000)).toEqual({
			ok: true,
			value: true,
		});
		expect(await repositories.liveStates.upsert(sessionId, idleLiveState, 1000)).toEqual({
			ok: true,
			value: false,
		});
		const live = must(await repositories.liveStates.listAll()).find(
			(row) => row.sessionId === sessionId,
		);
		expect(live?.liveState.status).toBe("working");
		expect(must(await repositories.liveStates.listAll())).toHaveLength(1);
	});

	it("appends each event once and reads it in position order", async () => {
		seedAll();
		const first = userMessageEvent("e1", "t1", 10);
		const second = agentEvent("e2", "t1", 11, [{ kind: "text", text: "Hi" }]);
		expect(await repositories.sessionEvents.append(sessionId, first, 100)).toEqual({
			ok: true,
			value: { kind: "appended", idx: 0 },
		});
		expect(await repositories.sessionEvents.append(sessionId, first, 101)).toEqual({
			ok: true,
			value: { kind: "duplicate" },
		});
		expect(await repositories.sessionEvents.append(sessionId, second, 102)).toEqual({
			ok: true,
			value: { kind: "appended", idx: 1 },
		});
		expect(must(await repositories.sessionEvents.lastIdx(sessionId))).toBe(1);
		expect(
			must(await repositories.sessionEvents.listFrom(sessionId, 0, 10)).map((e) => e.idx),
		).toEqual([0, 1]);
		expect(must(await repositories.sessionEvents.listByTurn(sessionId, first.turnId))).toHaveLength(
			2,
		);
		expect(
			must(await repositories.sessionEvents.listFrom(sessionId, 0, 10)).filter(
				(event) => event.event.type === "user_message",
			),
		).toHaveLength(1);
	});

	it("marks a turn reverted without deleting it and finds only live interrupted turns", async () => {
		seedAll();
		must(await repositories.sessionEvents.append(sessionId, userMessageEvent("e1", "t1", 10), 100));
		must(
			await repositories.sessionEvents.append(
				sessionId,
				agentEvent("e2", "t1", 11, [{ kind: "text", text: "x" }]),
				101,
			),
		);
		expect(
			must(await repositories.sessionEvents.markRevertedFromTurn(sessionId, "t1" as never, 500)),
		).toBe(2);
		const stored = must(await repositories.sessionEvents.listFrom(sessionId, 0, 10));
		expect(stored.map((event) => event.revertedAt)).toEqual([500, 500]);
		expect(must(await repositories.sessionEvents.findInterruptedTurns())).toEqual([]);

		must(await repositories.sessionEvents.append(sessionId, userMessageEvent("e3", "t2", 12), 102));
		expect(must(await repositories.sessionEvents.findInterruptedTurns())).toEqual([
			{ sessionId, turnId: "t2" },
		]);
		must(await repositories.sessionEvents.append(sessionId, turnEndedEvent("e4", "t2", 13), 103));
		expect(must(await repositories.sessionEvents.findInterruptedTurns())).toEqual([]);
	});
});

describe("DATA-01 queued messages repository", () => {
	it("queues in order", async () => {
		seedAll();
		const first = must(
			await repositories.queuedMessages.enqueue({
				...sampleQueued,
				id: "q1" as MessageId,
			}),
		);
		const second = must(
			await repositories.queuedMessages.enqueue({
				...sampleQueued,
				id: "q2" as MessageId,
			}),
		);
		expect([first.position, second.position]).toEqual([1, 2]);
		expect(
			must(await repositories.queuedMessages.listBySession(sessionId)).map((row) => row.id),
		).toEqual(["q1", "q2"]);
	});

	it("does not edit or cancel a sending message, and reorders the rest", async () => {
		seedAll();
		must(
			await repositories.queuedMessages.enqueue({
				...sampleQueued,
				id: "q1" as MessageId,
			}),
		);
		must(
			await repositories.queuedMessages.enqueue({
				...sampleQueued,
				id: "q2" as MessageId,
			}),
		);
		must(await repositories.queuedMessages.setState("q1" as MessageId, "waiting", "sending", null));
		expect(
			await repositories.queuedMessages.setContent("q1" as MessageId, {
				text: "new",
				attachmentPaths: [],
			}),
		).toEqual({ ok: true, value: false });
		expect(await repositories.queuedMessages.cancel("q1" as MessageId)).toEqual({
			ok: true,
			value: false,
		});
		expect(
			await repositories.queuedMessages.setState("q1" as MessageId, "sending", "failed", "offline"),
		).toEqual({ ok: true, value: true });

		must(await repositories.queuedMessages.reorder(sessionId, ["q2" as MessageId]));
		expect(must(await repositories.queuedMessages.get("q2" as MessageId))?.position).toBe(1);
	});

	it("refuses a reorder that leaves waiting messages out, so positions stay unique", async () => {
		seedAll();
		for (const id of ["q1", "q2", "q3"]) {
			must(
				await repositories.queuedMessages.enqueue({
					...sampleQueued,
					id: id as MessageId,
				}),
			);
		}
		expect(
			await repositories.queuedMessages.reorder(sessionId, ["q3" as MessageId, "q1" as MessageId]),
		).toMatchObject({ ok: false, error: { code: "db.conflict" } });
		const positions: number[] = [];
		for (const id of ["q1", "q2", "q3"]) {
			positions.push(must(await repositories.queuedMessages.get(id as MessageId))?.position ?? 0);
		}
		expect(positions).toEqual([1, 2, 3]);

		must(
			await repositories.queuedMessages.reorder(sessionId, [
				"q3" as MessageId,
				"q1" as MessageId,
				"q2" as MessageId,
			]),
		);
		expect(
			must(await repositories.queuedMessages.listBySession(sessionId)).map((m) => m.id),
		).toEqual(["q3", "q1", "q2"]);
	});
});

describe("DATA-01 attachments repository", () => {
	it("adds drafts, attaches only the same chat and returns the path on removal", async () => {
		seedAll();
		raw
			.prepare(SESSIONS_SQL.insert)
			.run(bind(must(sessionToParams({ ...sampleSession, id: "chat-2" as SessionId }))));
		const own = must(await repositories.attachments.addDraft(sampleAttachment));
		const other = must(
			await repositories.attachments.addDraft({
				...sampleAttachment,
				sessionId: "chat-2" as SessionId,
			}),
		);
		expect(own.isDraft).toBe(true);
		expect(other.sessionId).toBe("chat-2");

		expect(
			await repositories.attachments.attachDrafts(sessionId, "msg-1", [own.id, other.id]),
		).toEqual({ ok: true, value: 1 });
		expect(
			raw.prepare("SELECT id FROM attachments WHERE message_id = ?").all("msg-1"),
		).toHaveLength(1);
		expect(must(await repositories.attachments.listDraftsBySession(sessionId))).toHaveLength(0);

		expect(await repositories.attachments.restoreToDraft("msg-1")).toEqual({ ok: true, value: 1 });
		expect(must(await repositories.attachments.removeDraft(sessionId, own.id))).toBe(
			sampleAttachment.path,
		);
	});
});

describe("DATA-01 diff comments repository", () => {
	it("adds, edits and resolves a comment", async () => {
		seedWorkspace();
		now = 2000;
		const added = must(
			await repositories.diffComments.add({
				workspaceId,
				filePath: "src/app.ts",
				line: 4,
				endLine: null,
				body: "Please rename this",
				author: { kind: "user", name: null, avatarUrl: null },
				side: "additions",
				threadId: null,
				replyToId: null,
				suggestion: null,
				suggestionBaseCode: null,
			}),
		);
		expect(added).toMatchObject({
			state: "pending",
			resolved: false,
			outdated: false,
			createdAt: 2000,
		});
		expect(must(await repositories.diffComments.listByWorkspace(workspaceId))).toHaveLength(1);

		must(
			await repositories.diffComments.setBody(added.id, "Renamed", {
				suggestion: "const x = 1;",
				suggestionBaseCode: "let x = 1;",
			}),
		);
		must(await repositories.diffComments.setResolved(added.id, true));
		expect(must(await repositories.diffComments.get(added.id))).toMatchObject({
			body: "Renamed",
			suggestion: "const x = 1;",
			suggestionBaseCode: "let x = 1;",
			resolved: true,
		});
		must(await repositories.diffComments.delete(added.id));
		expect(must(await repositories.diffComments.get(added.id))).toBeNull();
	});

	it("syncs GitHub comments without undoing a local resolve", async () => {
		seedWorkspace();
		must(await repositories.diffComments.syncRemote(workspaceId, [sampleComment]));
		must(await repositories.diffComments.setResolved(sampleComment.id, true));
		must(
			await repositories.diffComments.syncRemote(workspaceId, [
				{ ...sampleComment, body: "Edited", resolved: false, updatedAt: 9000 },
			]),
		);
		expect(must(await repositories.diffComments.get(sampleComment.id))).toMatchObject({
			body: "Edited",
			resolved: true,
		});
		must(await repositories.diffComments.syncRemote(workspaceId, []));
		expect(must(await repositories.diffComments.listByWorkspace(workspaceId))).toHaveLength(0);
	});
});

describe("DATA-01 missing rows and ordering in smaller repositories", () => {
	it("reports a missing chat, comment, section, terminal and attachment from their setters", async () => {
		const writes = [
			() => repositories.sessions.setTitle("missing" as SessionId, "T"),
			() => repositories.sessions.setConfig("missing" as SessionId, sampleSession.config),
			() => repositories.sessions.setAgentSessionId("missing" as SessionId, null),
			() => repositories.sessions.reopen("missing" as SessionId),
			() =>
				repositories.diffComments.setBody("missing" as never, "b", {
					suggestion: null,
					suggestionBaseCode: null,
				}),
			() => repositories.diffComments.setResolved("missing" as never, true),
			() => repositories.sections.rename("missing" as never, "n", null),
			() => repositories.sections.setCollapsed("missing" as never, true),
			() => repositories.attachments.setPath("missing" as never, "/p"),
		];
		for (const write of writes) {
			expect(await write()).toMatchObject({ ok: false, error: { code: "db.not_found" } });
		}
	});

	it("never moves a chat's updated_at back when an older user message is recorded", async () => {
		seedAll();
		const before = must(await repositories.sessions.get(sessionId))?.updatedAt ?? 0;
		must(await repositories.sessions.recordUserMessage(sessionId, before - 500));
		expect(must(await repositories.sessions.get(sessionId))?.updatedAt).toBe(before);
		must(await repositories.sessions.recordUserMessage(sessionId, before + 500));
		expect(must(await repositories.sessions.get(sessionId))).toMatchObject({
			updatedAt: before + 500,
			lastUserMessageAt: before + 500,
		});
	});

	it("keeps an error only on a failed queued message", async () => {
		seedAll();
		must(await repositories.queuedMessages.enqueue({ ...sampleQueued, id: "q1" as MessageId }));
		must(await repositories.queuedMessages.setState("q1" as MessageId, "waiting", "sending", null));
		must(
			await repositories.queuedMessages.setState("q1" as MessageId, "sending", "failed", "offline"),
		);
		expect(must(await repositories.queuedMessages.get("q1" as MessageId))?.lastError).toBe(
			"offline",
		);
		must(
			await repositories.queuedMessages.setState("q1" as MessageId, "failed", "waiting", "stale"),
		);
		expect(must(await repositories.queuedMessages.get("q1" as MessageId))).toMatchObject({
			state: "waiting",
			lastError: null,
		});
	});

	it("refuses to sync a comment of another workspace and never rewrites one", async () => {
		seedWorkspace();
		must(await repositories.diffComments.syncRemote(workspaceId, [sampleComment]));
		const foreign = { ...sampleComment, workspaceId: "ws-2" as WorkspaceId, body: "Hijacked" };
		expect(await repositories.diffComments.syncRemote(workspaceId, [foreign])).toMatchObject({
			ok: false,
			error: { code: "db.invalid_row" },
		});

		raw.prepare(WORKSPACES_SQL.insert).run(
			bind(
				must(
					workspaceToParams({
						...sampleWorkspace,
						id: "ws-2" as WorkspaceId,
						directoryName: "lisbon",
						path: "/code/workspaces/lisbon",
					}),
				),
			),
		);
		must(await repositories.diffComments.syncRemote("ws-2" as WorkspaceId, [foreign]));
		expect(must(await repositories.diffComments.get(sampleComment.id))).toMatchObject({
			workspaceId,
			body: sampleComment.body,
		});
	});
});

describe("DATA-01 sections repository", () => {
	it("keeps a workspace in exactly one section when moving it", async () => {
		seedRepo();
		seedWorkspace();
		const first = must(await repositories.sections.create({ name: "Review", emoji: null }));
		const second = must(await repositories.sections.create({ name: "Later", emoji: null }));

		must(await repositories.sections.moveWorkspace(workspaceId, first.id));
		must(await repositories.sections.moveWorkspace(workspaceId, second.id));
		const sections = must(await repositories.sections.list());
		expect(sections.find((section) => section.id === first.id)?.workspaceIds).toEqual([]);
		expect(sections.find((section) => section.id === second.id)?.workspaceIds).toEqual([
			workspaceId,
		]);

		must(await repositories.sections.replaceMembers(first.id, [workspaceId]));
		const replaced = must(await repositories.sections.list());
		expect(replaced.find((section) => section.id === first.id)?.workspaceIds).toEqual([
			workspaceId,
		]);
		expect(replaced.find((section) => section.id === second.id)?.workspaceIds).toEqual([]);
	});

	it("renames, collapses, reorders and deletes a section without the workspaces", async () => {
		seedRepo();
		seedWorkspace();
		const first = must(await repositories.sections.create({ name: "One", emoji: null }));
		const second = must(await repositories.sections.create({ name: "Two", emoji: "star" }));
		must(await repositories.sections.rename(second.id, "Renamed", "eyes"));
		must(await repositories.sections.setCollapsed(second.id, true));
		must(await repositories.sections.reorder([second.id, first.id]));
		expect(must(await repositories.sections.list()).map((section) => section.id)).toEqual([
			second.id,
			first.id,
		]);
		must(await repositories.sections.delete(second.id));
		expect(must(await repositories.sections.list())).toHaveLength(1);
		expect(must(await repositories.workspaces.get(workspaceId))).not.toBeNull();
	});
});

describe("DATA-01 settings, environment and favorite models repositories", () => {
	it("stores settings by key and deletes by prefix", async () => {
		now = 3000;
		const saved = must(await repositories.settings.set("theme", { dark: true }));
		expect(saved).toEqual({ key: "theme", value: { dark: true }, updatedAt: 3000 });
		expect(must(await repositories.settings.list()).find((row) => row.key === "theme")).toEqual(
			saved,
		);
		now = 4000;
		must(await repositories.settings.set("theme", "light"));
		expect(must(await repositories.settings.list()).find((row) => row.key === "theme")?.value).toBe(
			"light",
		);
		must(await repositories.settings.set("repo:r1:branch", "main"));
		expect(
			must(await repositories.settings.list()).filter((row) => row.key.startsWith("repo:r1:")),
		).toHaveLength(1);
		expect(raw.prepare(SETTINGS_SQL.deleteByPrefix).run(bind(["repo:r1:"])).changes).toBe(1);
		expect(await repositories.settings.set("bad", undefined)).toMatchObject({ ok: false });
	});

	it("keeps one global environment row when the same name is set twice", async () => {
		seedRepo();
		must(
			await repositories.envVars.set({
				name: "TOKEN",
				scope: "global",
				repoId: null,
				keychainRef: "kc-1",
			}),
		);
		must(
			await repositories.envVars.set({
				name: "TOKEN",
				scope: "global",
				repoId: null,
				keychainRef: "kc-2",
			}),
		);
		must(
			await repositories.envVars.set({
				name: "TOKEN",
				scope: "repo",
				repoId: sampleRepo.id,
				keychainRef: "kc-3",
			}),
		);
		expect(must(await repositories.envVars.listGlobal())).toEqual([
			{ name: "TOKEN", scope: "global", repoId: null, keychainRef: "kc-2" },
		]);
		expect(must(await repositories.envVars.listByRepo(sampleRepo.id))).toHaveLength(1);
		expect(must(await repositories.envVars.listForRepo(sampleRepo.id))).toHaveLength(2);
		expect(
			must(await repositories.envVars.listForRepo(sampleRepo.id)).find(
				(row) => row.name === "TOKEN" && row.scope === "global",
			)?.keychainRef,
		).toBe("kc-2");
		must(await repositories.envVars.delete("TOKEN", "global", null));
		expect(must(await repositories.envVars.listGlobal())).toHaveLength(0);
		expect(
			await repositories.envVars.set({
				name: "BAD",
				scope: "repo",
				repoId: null,
				keychainRef: "kc",
			}),
		).toMatchObject({ ok: false, error: { code: "db.invalid_row" } });
	});

	it("adds, reorders and removes favorite models", async () => {
		const first = must(
			await repositories.favoriteModels.add({
				agent: "claude",
				model: "default",
				effort: "high",
				fastMode: false,
			}),
		);
		const second = must(
			await repositories.favoriteModels.add({
				agent: "codex",
				model: "gpt",
				effort: "low",
				fastMode: true,
			}),
		);
		expect([first.position, second.position]).toEqual([0, 1]);
		must(await repositories.favoriteModels.reorder([second.id, first.id]));
		expect(must(await repositories.favoriteModels.list()).map((model) => model.id)).toEqual([
			second.id,
			first.id,
		]);
		must(await repositories.favoriteModels.delete(second.id));
		expect(must(await repositories.favoriteModels.list())).toHaveLength(1);
	});
});

describe("DATA-01 terminals repository", () => {
	it("starts a terminal and keeps the first exit report", async () => {
		seedWorkspace();
		now = 2000;
		const started = must(
			await repositories.terminals.start({
				workspaceId,
				repoId: null,
				kind: "run",
				title: "dev server",
				cwd: "/code/workspaces/oslo",
				placement: "panel",
				startCommand: "bun dev",
			}),
		);
		expect(started).toMatchObject({ id: "generated-1", startedAt: 2000, endedAt: null });
		expect(await repositories.terminals.markEnded(started.id, 3000, 0)).toEqual({
			ok: true,
			value: true,
		});
		expect(await repositories.terminals.markEnded(started.id, 4000, 1)).toEqual({
			ok: true,
			value: false,
		});
		expect(must(await repositories.terminals.get(started.id))).toMatchObject({
			endedAt: 3000,
			exitCode: 0,
		});
	});

	it("saves a terminal's screen state and reads it back, and clears it", async () => {
		seedWorkspace();
		const started = must(
			await repositories.terminals.start({
				workspaceId,
				repoId: null,
				kind: "terminal",
				title: "zsh",
				cwd: "/code/workspaces/oslo",
				placement: "centre",
				startCommand: null,
			}),
		);
		expect(await repositories.terminals.getScreenState(started.id)).toEqual(ok(null));

		const snapshot = JSON.stringify({ cursor: { row: 3, col: 7 }, alternateScreen: false });
		expect(await repositories.terminals.setScreenState(started.id, snapshot)).toEqual(
			ok(undefined),
		);
		expect(await repositories.terminals.getScreenState(started.id)).toEqual(ok(snapshot));

		must(await repositories.terminals.setScreenState(started.id, null));
		expect(await repositories.terminals.getScreenState(started.id)).toEqual(ok(null));
	});
});
