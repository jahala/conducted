// @vitest-environment node
import type { DatabaseSync } from "node:sqlite";
import { idleLiveState } from "@conducted/protocol";
import type {
	AttachmentId,
	EventId,
	MessageId,
	SectionId,
	SessionId,
	TurnId,
	WorkspaceId,
} from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDatabase } from "../../test/sqlite.ts";
import type { AttachmentRow } from "./attachments.ts";
import { ATTACHMENTS_SQL, attachmentFromRow, attachmentToParams } from "./attachments.ts";
import type { BacklogWorkspaceRow } from "./backlog-workspaces.ts";
import {
	BACKLOG_WORKSPACES_SQL,
	backlogWorkspaceFromRow,
	backlogWorkspaceToParams,
} from "./backlog-workspaces.ts";
import type { DiffCommentRow } from "./diff-comments.ts";
import { DIFF_COMMENTS_SQL, diffCommentFromRow, diffCommentToParams } from "./diff-comments.ts";
import type { EnvVarRow } from "./env-vars.ts";
import { ENV_VARS_SQL, envVarToParams } from "./env-vars.ts";
import type { FavoriteModelRow } from "./favorite-models.ts";
import {
	FAVORITE_MODELS_SQL,
	favoriteModelFromRow,
	favoriteModelToParams,
} from "./favorite-models.ts";
import { ageCutoff, LIFETIME_SQL, MS_PER_DAY } from "./lifetime.ts";
import type { ProviderKeyRow } from "./provider-keys.ts";
import { PROVIDER_KEYS_SQL, providerKeyFromRow, providerKeyToParams } from "./provider-keys.ts";
import type { QueuedMessageRow } from "./queued-messages.ts";
import {
	QUEUED_MESSAGES_SQL,
	queuedMessageFromRow,
	queuedMessageToParams,
} from "./queued-messages.ts";
import { idleLiveStateJson, interruptedTurnEvent, REPAIR_SQL } from "./repair.ts";
import type { RepoRow } from "./repos.ts";
import { REPOS_SQL, repoFromRow, repoToParams } from "./repos.ts";
import type { SectionMemberRow, SectionRow } from "./sections.ts";
import { SECTIONS_SQL, sectionFromRow, sectionToParams } from "./sections.ts";
import type { SessionEventRow } from "./session-events.ts";
import { SESSION_EVENTS_SQL, sessionEventFromRow, sessionEventToParams } from "./session-events.ts";
import type { SessionLiveStateRow } from "./session-live-state.ts";
import {
	liveStateFromRow,
	liveStateToParams,
	SESSION_LIVE_STATE_SQL,
} from "./session-live-state.ts";
import type { SessionRow } from "./sessions.ts";
import { SESSIONS_SQL, sessionFromRow, sessionToParams } from "./sessions.ts";
import { SETTINGS_SQL, settingToParams } from "./settings.ts";
import type { SnippetRow } from "./snippets.ts";
import { SNIPPETS_SQL, snippetFromRow, snippetToParams } from "./snippets.ts";
import type { TerminalRow } from "./terminals.ts";
import { TERMINALS_SQL, terminalFromRow, terminalToParams } from "./terminals.ts";
import {
	agentEvent,
	repoId,
	sampleAttachment,
	sampleComment,
	sampleQueued,
	sampleRepo,
	sampleSection,
	sampleSession,
	sampleTerminal,
	sampleWorkspace,
	sessionId,
	turnEndedEvent,
	userMessageEvent,
	workspaceId,
} from "./test-fixtures.ts";
import type { WorkspaceRow } from "./workspaces.ts";
import { WORKSPACES_SQL, workspaceFromRow, workspaceToParams } from "./workspaces.ts";

const ALL_SQL: Record<string, Record<string, string>> = {
	REPOS_SQL,
	WORKSPACES_SQL,
	SESSIONS_SQL,
	SESSION_EVENTS_SQL,
	SESSION_LIVE_STATE_SQL,
	QUEUED_MESSAGES_SQL,
	DIFF_COMMENTS_SQL,
	ATTACHMENTS_SQL,
	TERMINALS_SQL,
	SECTIONS_SQL,
	FAVORITE_MODELS_SQL,
	SETTINGS_SQL,
	ENV_VARS_SQL,
	BACKLOG_WORKSPACES_SQL,
	SNIPPETS_SQL,
	PROVIDER_KEYS_SQL,
	LIFETIME_SQL,
	REPAIR_SQL,
};

type Params = readonly unknown[];

let store: ReturnType<typeof openTestDatabase>;
let db: DatabaseSync;

beforeEach(() => {
	store = openTestDatabase();
	db = store.raw;
});

afterEach(() => {
	store.close();
});

/** node:sqlite binds `$1..$n` by name, so a positional list becomes `{ $1: ..., $2: ... }`. */
const bind = (params: Params): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

const run = (sql: string, params: Params = []): number =>
	Number(db.prepare(sql).run(bind(params)).changes);

const rows = <Row>(sql: string, params: Params = []): Row[] =>
	db.prepare(sql).all(bind(params)) as unknown as Row[];

const one = <Row>(sql: string, params: Params = []): Row => {
	const found = rows<Row>(sql, params);
	if (found.length !== 1) throw new Error(`expected one row, got ${found.length}`);
	return found[0] as Row;
};

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

function seedWorkspace(): void {
	run(REPOS_SQL.insert, repoToParams(sampleRepo));
	run(WORKSPACES_SQL.insert, must(workspaceToParams(sampleWorkspace)));
	run(SESSIONS_SQL.insert, must(sessionToParams(sampleSession)));
}

function append(event: Parameters<typeof sessionEventToParams>[1], receivedAt = 100) {
	return rows<{ idx: number }>(
		SESSION_EVENTS_SQL.append,
		must(sessionEventToParams(sessionId, event, receivedAt)),
	);
}

describe("every statement is valid SQLite against migration 0001", () => {
	for (const [name, statements] of Object.entries(ALL_SQL)) {
		for (const [key, sql] of Object.entries(statements)) {
			it(`${name}.${key} prepares`, () => {
				expect(typeof sql).toBe("string");
				expect(() => db.prepare(sql)).not.toThrow();
			});
		}
	}

	it("numbers parameters in order of first appearance, so any binding style agrees", () => {
		for (const [name, statements] of Object.entries(ALL_SQL)) {
			for (const [key, sql] of Object.entries(statements)) {
				const order: number[] = [];
				for (const match of sql.matchAll(/\$(\d+)/g)) {
					const number = Number(match[1]);
					if (!order.includes(number)) order.push(number);
				}
				expect(order, `${name}.${key}`).toEqual(order.map((_, index) => index + 1));
			}
		}
	});
});

describe("round trips through real tables", () => {
	it("repos", () => {
		run(REPOS_SQL.insert, repoToParams(sampleRepo));
		const row = one<RepoRow>(REPOS_SQL.get, [sampleRepo.id]);
		expect(repoFromRow(row)).toEqual(sampleRepo);
		expect(rows(REPOS_SQL.listVisible)).toHaveLength(0);
		expect(one<{ next: number }>(REPOS_SQL.nextDisplayOrder).next).toBe(3);
		expect(
			run(
				REPOS_SQL.insert,
				repoToParams({ ...sampleRepo, id: "r2" as never, rootPath: "/code/other" }),
			),
		).toBe(1);
	});

	it("workspaces, sessions and the child tables", () => {
		seedWorkspace();
		const workspace = one<WorkspaceRow>(WORKSPACES_SQL.get, [workspaceId]);
		const { setupLogPath, ...model } = sampleWorkspace;
		expect(must(workspaceFromRow(workspace))).toEqual(model);
		expect(
			one<{ setup_log_path: string }>(WORKSPACES_SQL.getSetupLogPath, [workspaceId]).setup_log_path,
		).toBe(setupLogPath);
		expect(must(sessionFromRow(one<SessionRow>(SESSIONS_SQL.get, [sessionId])))).toEqual(
			sampleSession,
		);

		run(DIFF_COMMENTS_SQL.insert, diffCommentToParams(sampleComment));
		expect(
			diffCommentFromRow(one<DiffCommentRow>(DIFF_COMMENTS_SQL.get, [sampleComment.id])),
		).toEqual(sampleComment);

		run(ATTACHMENTS_SQL.insert, attachmentToParams(sampleAttachment));
		const { messageId, createdAt, ...attachment } = sampleAttachment;
		expect(
			attachmentFromRow(one<AttachmentRow>(ATTACHMENTS_SQL.get, [sampleAttachment.id])),
		).toEqual(attachment);
		expect(messageId).toBeNull();
		expect(createdAt).toBe(1000);

		run(TERMINALS_SQL.insert, terminalToParams(sampleTerminal));
		const { screenState: _screen, ...terminal } = sampleTerminal;
		expect(terminalFromRow(one<TerminalRow>(TERMINALS_SQL.get, [sampleTerminal.id]))).toEqual(
			terminal,
		);

		run(QUEUED_MESSAGES_SQL.insert, must(queuedMessageToParams(sampleQueued, 50)));
		expect(
			must(queuedMessageFromRow(one<QueuedMessageRow>(QUEUED_MESSAGES_SQL.get, [sampleQueued.id]))),
		).toEqual(sampleQueued);
	});

	it("has statements for a new session and its first message event", () => {
		seedWorkspace();
		expect(rows<{ id: string }>(SESSIONS_SQL.get, [sessionId])).toHaveLength(1);
		const firstMessage = userMessageEvent("e-new", "t-new", 10);
		expect(append(firstMessage)).toEqual([{ idx: 0 }]);
		expect(
			rows<{ type: string }>(
				"SELECT type FROM session_events WHERE session_id = $1 AND event_id = $2",
				[sessionId, firstMessage.eventId],
			),
		).toHaveLength(1);
	});

	it("live state, favorite models, sections, settings", () => {
		seedWorkspace();
		run(SESSION_LIVE_STATE_SQL.upsert, must(liveStateToParams(sessionId, idleLiveState, 10)));
		expect(
			must(
				liveStateFromRow(
					rows<SessionLiveStateRow>(SESSION_LIVE_STATE_SQL.listAll).find(
						(row) => row.session_id === sessionId,
					) as SessionLiveStateRow,
				),
			),
		).toEqual({ sessionId, liveState: idleLiveState, updatedAt: 10 });

		const favorite = {
			id: "f1",
			position: 0,
			config: { agent: "codex", model: "gpt", effort: "low", fastMode: true },
		} as const;
		run(FAVORITE_MODELS_SQL.insert, must(favoriteModelToParams(favorite)));
		expect(
			must(favoriteModelFromRow(one<FavoriteModelRow>(FAVORITE_MODELS_SQL.get, ["f1"]))),
		).toEqual(favorite);

		run(SECTIONS_SQL.insert, sectionToParams(sampleSection, 5));
		run(SECTIONS_SQL.addMember, ["sec-1", workspaceId, 0]);
		const section = sectionFromRow(
			one<SectionRow>(SECTIONS_SQL.get, ["sec-1"]),
			rows<SectionMemberRow>(SECTIONS_SQL.listMembers),
		);
		expect(section).toEqual({ ...sampleSection, workspaceIds: [workspaceId] });

		run(SETTINGS_SQL.upsert, must(settingToParams({ key: "a", value: { x: 1 }, updatedAt: 1 })));
		run(SETTINGS_SQL.upsert, must(settingToParams({ key: "a", value: { x: 2 }, updatedAt: 2 })));
		expect(rows<{ value: string }>(SETTINGS_SQL.list)).toEqual([
			expect.objectContaining({ key: "a", value: '{"x":2}', updated_at: 2 }),
		]);
	});
});

describe("session events", () => {
	beforeEach(seedWorkspace);

	it("append is idempotent on event id and assigns the next idx", () => {
		const first = userMessageEvent("e1", "t1", 10);
		const second = agentEvent("e2", "t1", 11, [{ kind: "text", text: "Hi" }]);

		expect(append(first)).toEqual([{ idx: 0 }]);
		expect(append(first)).toEqual([]);
		expect(append(second)).toEqual([{ idx: 1 }]);
		expect(append(first)).toEqual([]);
		expect(append(turnEndedEvent("e3", "t1", 12))).toEqual([{ idx: 2 }]);

		const stored = rows<SessionEventRow>(SESSION_EVENTS_SQL.listFrom, [sessionId, 0, 100]);
		expect(stored.map((row) => row.idx)).toEqual([0, 1, 2]);
		expect(stored.map((row) => row.event_id)).toEqual(["e1", "e2", "e3"]);
		expect(must(sessionEventFromRow(stored[0] as SessionEventRow)).event).toEqual(first);
	});

	it("numbers each chat on its own and lists from a cursor", () => {
		run(
			SESSIONS_SQL.insert,
			must(sessionToParams({ ...sampleSession, id: "chat-2" as SessionId })),
		);
		append(userMessageEvent("e1", "t1", 10));
		append(turnEndedEvent("e2", "t1", 11));
		const other = rows<{ idx: number }>(
			SESSION_EVENTS_SQL.append,
			must(sessionEventToParams("chat-2" as SessionId, userMessageEvent("e1", "t1", 10), 1)),
		);
		expect(other).toEqual([{ idx: 0 }]);
		expect(
			rows<SessionEventRow>(SESSION_EVENTS_SQL.listFrom, [sessionId, 1, 10]).map((r) => r.idx),
		).toEqual([1]);
		expect(rows<SessionEventRow>(SESSION_EVENTS_SQL.listFrom, [sessionId, 0, 1])).toHaveLength(1);
		expect(one<{ last_idx: number }>(SESSION_EVENTS_SQL.lastIdx, [sessionId]).last_idx).toBe(1);
	});

	it("marks events reverted from the first user message of a turn, once", () => {
		append(userMessageEvent("e1", "t1", 10));
		append(turnEndedEvent("e2", "t1", 11));
		append(userMessageEvent("e3", "t2", 12));
		append(agentEvent("e4", "t2", 13, [{ kind: "text", text: "x" }]));
		append(turnEndedEvent("e5", "t2", 14));

		expect(run(SESSION_EVENTS_SQL.markRevertedFromTurn, [500, sessionId, "t2"])).toBe(3);
		expect(run(SESSION_EVENTS_SQL.markRevertedFromTurn, [600, sessionId, "t1"])).toBe(2);
		const marks = rows<SessionEventRow>(SESSION_EVENTS_SQL.listFrom, [sessionId, 0, 10]).map(
			(row) => row.reverted_at,
		);
		expect(marks).toEqual([600, 600, 500, 500, 500]);
		expect(run(SESSION_EVENTS_SQL.markRevertedFromTurn, [700, sessionId, "unknown"])).toBe(0);
	});

	it("finds turns with a user message and no turn_ended", () => {
		append(userMessageEvent("e1", "t1", 10));
		append(turnEndedEvent("e2", "t1", 11));
		append(userMessageEvent("e3", "t2", 12));
		append(agentEvent("e4", "t2", 13, [{ kind: "text", text: "x" }]));
		expect(rows(SESSION_EVENTS_SQL.findInterruptedTurns)).toEqual([
			expect.objectContaining({ session_id: sessionId, turn_id: "t2" }),
		]);
	});
});

describe("live state writes", () => {
	it("drops a write that is older than the stored one", () => {
		seedWorkspace();
		const working = { ...idleLiveState, status: "working" as const };
		run(SESSION_LIVE_STATE_SQL.upsert, must(liveStateToParams(sessionId, working, 20)));
		expect(
			run(SESSION_LIVE_STATE_SQL.upsert, must(liveStateToParams(sessionId, idleLiveState, 10))),
		).toBe(0);
		expect(
			must(
				liveStateFromRow(
					rows<SessionLiveStateRow>(SESSION_LIVE_STATE_SQL.listAll).find(
						(row) => row.session_id === sessionId,
					) as SessionLiveStateRow,
				),
			).liveState.status,
		).toBe("working");
	});
});

describe("queued messages", () => {
	beforeEach(seedWorkspace);

	const queue = (id: string, position: number) =>
		run(
			QUEUED_MESSAGES_SQL.insert,
			must(
				queuedMessageToParams(
					{ ...sampleQueued, id: id as MessageId, position, state: "waiting", lastError: null },
					1,
				),
			),
		);

	it("gives the next position in order", () => {
		expect(one<{ next: number }>(QUEUED_MESSAGES_SQL.nextPosition, [sessionId]).next).toBe(1);
		queue("b", 2);
		queue("a", 1);
		expect(one<{ next: number }>(QUEUED_MESSAGES_SQL.nextPosition, [sessionId]).next).toBe(3);
		expect(
			rows<QueuedMessageRow>(QUEUED_MESSAGES_SQL.listBySession, [sessionId]).map((row) => row.id),
		).toEqual(["a", "b"]);
	});

	it("does not edit or cancel a message that is sending", () => {
		queue("a", 1);
		expect(run(QUEUED_MESSAGES_SQL.setState, ["sending", null, 9, "a", "waiting"])).toBe(1);
		expect(run(QUEUED_MESSAGES_SQL.setContent, ["new", "[]", 10, "a"])).toBe(0);
		expect(run(QUEUED_MESSAGES_SQL.deleteUnlessSending, ["a"])).toBe(0);
		expect(run(QUEUED_MESSAGES_SQL.setState, ["failed", "offline", 11, "a", "sending"])).toBe(1);
		expect(run(QUEUED_MESSAGES_SQL.setState, ["waiting", null, 12, "a", "sending"])).toBe(0);
	});
});

describe("sections", () => {
	it("replaces members, takes them from other sections and keeps the given order", () => {
		const extra = (id: string, path: string) =>
			run(
				WORKSPACES_SQL.insert,
				must(
					workspaceToParams({
						...sampleWorkspace,
						id: id as WorkspaceId,
						directoryName: id,
						path,
					}),
				),
			);
		run(REPOS_SQL.insert, repoToParams(sampleRepo));
		extra("w1", "/p/1");
		extra("w2", "/p/2");
		extra("w3", "/p/3");
		run(SECTIONS_SQL.insert, sectionToParams(sampleSection, 1));
		run(SECTIONS_SQL.insert, sectionToParams({ ...sampleSection, id: "sec-2" as SectionId }, 1));
		run(SECTIONS_SQL.addMember, ["sec-2", "w1", 0]);
		run(SECTIONS_SQL.addMember, ["sec-1", "w3", 0]);

		const replace = (ids: string[]) => {
			const json = JSON.stringify(ids);
			run(SECTIONS_SQL.replaceStep1RemoveOthers, ["sec-1", json]);
			run(SECTIONS_SQL.replaceStep2TakeFromOtherSections, ["sec-1", json]);
			run(SECTIONS_SQL.replaceStep3WriteOrder, ["sec-1", json]);
		};
		replace(["w2", "w1"]);
		replace(["w2", "w1"]);

		const members = rows<SectionMemberRow>(SECTIONS_SQL.listMembers);
		expect(members).toEqual([
			expect.objectContaining({ section_id: "sec-1", workspace_id: "w2", position: 0 }),
			expect.objectContaining({ section_id: "sec-1", workspace_id: "w1", position: 1 }),
		]);

		run(SECTIONS_SQL.removeFromAllSections, ["w1"]);
		run(SECTIONS_SQL.addMemberAtEnd, ["sec-2", "w1"]);
		run(SECTIONS_SQL.addMemberAtEnd, ["sec-2", "w1"]);
		expect(rows(SECTIONS_SQL.listMembers)).toHaveLength(2);

		run(SECTIONS_SQL.reorder, [JSON.stringify(["sec-2", "sec-1"])]);
		expect(rows<{ id: string }>(SECTIONS_SQL.list).map((row) => row.id)).toEqual([
			"sec-2",
			"sec-1",
		]);
	});
});

describe("env vars", () => {
	it("an upsert keeps one global row even though repo_id is NULL", () => {
		run(REPOS_SQL.insert, repoToParams(sampleRepo));
		const set = (name: string, scope: "global" | "repo", repo: string | null, ref: string) => {
			const params = must(envVarToParams({ name, scope, repoId: repo as never, keychainRef: ref }));
			const changed = run(ENV_VARS_SQL.upsertUpdate, [ref, name, scope, repo]);
			if (changed === 0) run(ENV_VARS_SQL.upsertInsert, params);
		};
		set("TOKEN", "global", null, "kc-1");
		set("TOKEN", "global", null, "kc-2");
		set("TOKEN", "repo", repoId, "kc-3");
		set("TOKEN", "repo", repoId, "kc-4");

		expect(rows<EnvVarRow>(ENV_VARS_SQL.listGlobal)).toEqual([
			expect.objectContaining({ keychain_ref: "kc-2" }),
		]);
		expect(rows<EnvVarRow>(ENV_VARS_SQL.listByRepo, [repoId])).toEqual([
			expect.objectContaining({ keychain_ref: "kc-4" }),
		]);
		expect(rows(ENV_VARS_SQL.listForRepo, [repoId])).toHaveLength(2);
		expect(run(ENV_VARS_SQL.delete, ["TOKEN", "global", null])).toBe(1);
		expect(rows(ENV_VARS_SQL.listGlobal)).toHaveLength(0);
	});
});

describe("diff comments and attachments", () => {
	beforeEach(seedWorkspace);

	it("a remote sync keeps a local resolve and removes GitHub comments that are gone", () => {
		run(DIFF_COMMENTS_SQL.insert, diffCommentToParams({ ...sampleComment, resolved: false }));
		run(DIFF_COMMENTS_SQL.setResolved, [1, 2000, sampleComment.id]);
		run(
			DIFF_COMMENTS_SQL.upsertRemote,
			diffCommentToParams({ ...sampleComment, body: "Edited", resolved: false, updatedAt: 3000 }),
		);
		const after = diffCommentFromRow(
			one<DiffCommentRow>(DIFF_COMMENTS_SQL.get, [sampleComment.id]),
		);
		expect(after.body).toBe("Edited");
		expect(after.resolved).toBe(true);

		run(
			DIFF_COMMENTS_SQL.insert,
			diffCommentToParams({
				...sampleComment,
				id: "mine" as never,
				author: { kind: "user", name: null, avatarUrl: null },
			}),
		);
		expect(run(DIFF_COMMENTS_SQL.deleteRemoteNotIn, [workspaceId, "[]"])).toBe(1);
		expect(rows(DIFF_COMMENTS_SQL.listByWorkspace, [workspaceId])).toHaveLength(1);
	});

	it("attaches only drafts of the same chat and returns the path on delete", () => {
		run(
			SESSIONS_SQL.insert,
			must(sessionToParams({ ...sampleSession, id: "chat-2" as SessionId })),
		);
		run(ATTACHMENTS_SQL.insert, attachmentToParams(sampleAttachment));
		run(
			ATTACHMENTS_SQL.insert,
			attachmentToParams({
				...sampleAttachment,
				id: "att-2" as AttachmentId,
				sessionId: "chat-2" as SessionId,
			}),
		);
		const ids = JSON.stringify(["att-1", "att-2"]);
		expect(run(ATTACHMENTS_SQL.attachDrafts, ["msg-1", sessionId, ids])).toBe(1);
		expect(
			rows<{ id: string }>("SELECT id FROM attachments WHERE message_id = $1", ["msg-1"]),
		).toHaveLength(1);
		expect(run(ATTACHMENTS_SQL.restoreToDraft, ["msg-1"])).toBe(1);
		expect(
			rows<{ path: string }>(ATTACHMENTS_SQL.deleteDraftReturningPath, ["att-1", sessionId]),
		).toEqual([{ path: sampleAttachment.path }]);
	});
});

describe("repair statements", () => {
	it("repairs a crashed database and a second run changes nothing", () => {
		seedWorkspace();
		run(
			SESSIONS_SQL.insert,
			must(sessionToParams({ ...sampleSession, id: "chat-2" as SessionId })),
		);
		const working = { ...idleLiveState, status: "working" as const };
		run(SESSION_LIVE_STATE_SQL.upsert, must(liveStateToParams(sessionId, working, 5)));

		// chat-1: a turn cut off by a crash.
		append(userMessageEvent("e1", "t1", 10));
		append(agentEvent("e2", "t1", 11, [{ kind: "text", text: "partial" }]));
		// queued: "msg-e1" was delivered (its event exists), "b" was not, "c" is only failed.
		const queued = (id: string, state: "sending" | "failed") =>
			run(
				QUEUED_MESSAGES_SQL.insert,
				must(
					queuedMessageToParams(
						{ ...sampleQueued, id: id as MessageId, state, lastError: null, delivery: "queue" },
						1,
					),
				),
			);
		queued("msg-e1", "sending");
		queued("b", "sending");
		queued("c", "failed");

		run(
			WORKSPACES_SQL.insert,
			must(
				workspaceToParams({
					...sampleWorkspace,
					id: "init" as never,
					directoryName: "i",
					path: "/p/i",
					state: "initializing",
				}),
			),
		);
		run(
			WORKSPACES_SQL.insert,
			must(
				workspaceToParams({
					...sampleWorkspace,
					id: "arch" as never,
					directoryName: "a",
					path: "/p/a",
					state: "archiving",
				}),
			),
		);
		run(TERMINALS_SQL.insert, terminalToParams(sampleTerminal));

		const repair = () => {
			const now = 9000;
			const counts = {
				live: run(REPAIR_SQL.resetLiveStates, [idleLiveStateJson(), now]),
				delivered: run(REPAIR_SQL.deleteDeliveredQueued),
				requeued: run(REPAIR_SQL.requeueSending, [now]),
				paused: run(REPAIR_SQL.pauseChatsWithQueue, [now]),
				failed: run(REPAIR_SQL.failInitializingWorkspaces, [now]),
				terminals: run(REPAIR_SQL.endOpenTerminals, [now]),
			};
			const turns = rows<{ session_id: SessionId; turn_id: TurnId }>(
				REPAIR_SQL.findInterruptedTurns,
			);
			for (const [n, turn] of turns.entries()) {
				const event = interruptedTurnEvent(turn.turn_id, `fix-${n}` as EventId, now);
				rows(
					REPAIR_SQL.appendInterruptedEvent,
					must(sessionEventToParams(turn.session_id, event, now)),
				);
			}
			return { counts, turns };
		};

		const first = repair();
		expect(first.counts).toEqual({
			live: 1,
			delivered: 1,
			requeued: 1,
			paused: 1,
			failed: 1,
			terminals: 1,
		});
		expect(first.turns).toHaveLength(1);

		const events = rows<SessionEventRow>(SESSION_EVENTS_SQL.listFrom, [sessionId, 0, 10]);
		expect(events.map((row) => row.type)).toEqual(["user_message", "agent", "turn_ended"]);
		expect(JSON.parse((events[2] as SessionEventRow).content)).toMatchObject({
			outcome: "interrupted",
			turnId: "t1",
		});
		expect(
			rows<{ id: string; state: string }>("SELECT id, state FROM queued_messages ORDER BY id"),
		).toEqual([
			{ id: "b", state: "waiting" },
			{ id: "c", state: "failed" },
		]);
		expect(
			rows<{ id: string; queue_paused_at: number | null }>(
				"SELECT id, queue_paused_at FROM sessions ORDER BY id",
			),
		).toEqual([
			{ id: "chat-1", queue_paused_at: 9000 },
			{ id: "chat-2", queue_paused_at: null },
		]);
		expect(rows<{ id: string }>(REPAIR_SQL.listArchivingWorkspaces)).toEqual([
			expect.objectContaining({ id: "arch" }),
		]);

		const second = repair();
		expect(second.turns).toHaveLength(0);
		expect(second.counts).toMatchObject({
			delivered: 0,
			requeued: 0,
			paused: 0,
			failed: 0,
			terminals: 0,
		});
	});
});

describe("lifetime statements", () => {
	beforeEach(seedWorkspace);

	const longOutput = "x".repeat(50);
	const toolEvent = (id: string, turn: string, at: number) =>
		agentEvent(id, turn, at, [
			{ kind: "text", text: "Running" },
			{
				kind: "tool_call",
				toolUseId: "tu1" as never,
				tool: "bash" as never,
				rawName: "Bash",
				input: { cmd: "ls" },
			},
			{
				kind: "tool_result",
				toolUseId: "tu1" as never,
				output: longOutput,
				isError: false,
				truncated: false,
			},
			{
				kind: "tool_result",
				toolUseId: "tu2" as never,
				output: "short",
				isError: false,
				truncated: false,
			},
		]);

	it("cuts long tool outputs of old events, keeps order, and is idempotent", () => {
		append(userMessageEvent("e1", "t1", 10), 1000);
		append(toolEvent("e2", "t1", 11), 1000);
		append(toolEvent("e3", "t1", 12), 9_000_000);

		// $1 the cut length, $2 the compacted_at time, $3 the age cutoff, $4 the batch size.
		const cut = () => run(LIFETIME_SQL.cutToolOutputs, [20, 9_500_000, 5_000_000, 200]);
		expect(cut()).toBe(1);
		expect(cut()).toBe(0);

		const events = rows<SessionEventRow>(SESSION_EVENTS_SQL.listFrom, [sessionId, 0, 10]);
		const items = (
			JSON.parse((events[1] as SessionEventRow).content) as {
				message: { items: { kind: string; output?: string; truncated?: boolean }[] };
			}
		).message.items;
		expect(items.map((item) => item.kind)).toEqual([
			"text",
			"tool_call",
			"tool_result",
			"tool_result",
		]);
		expect(items[2]).toMatchObject({ output: "x".repeat(20), truncated: true });
		expect(items[3]).toMatchObject({ output: "short", truncated: false });
		expect(must(sessionEventFromRow(events[1] as SessionEventRow)).event.type).toBe("agent");
		expect((events[2] as SessionEventRow).content).toContain(longOutput);
	});

	it("compacts a turn of an archived workspace and is safe to run twice", () => {
		append(userMessageEvent("e1", "t1", 10));
		append(toolEvent("e2", "t1", 11));
		append(
			agentEvent("e3", "t1", 12, [
				{
					kind: "tool_call",
					toolUseId: "tu3" as never,
					tool: "bash" as never,
					rawName: "Bash",
					input: {},
				},
			]),
		);
		append(
			agentEvent("e4", "t1", 13, [
				{ kind: "thinking", text: "hmm", summarized: false },
				{ kind: "text", text: "All done" },
				{ kind: "usage", inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
			]),
		);
		append(turnEndedEvent("e5", "t1", 14));
		// A turn with no text at all keeps only its user and end events.
		append(userMessageEvent("e6", "t2", 15));
		append(
			agentEvent("e7", "t2", 16, [
				{
					kind: "tool_call",
					toolUseId: "tu9" as never,
					tool: "bash" as never,
					rawName: "Bash",
					input: {},
				},
			]),
		);
		append(turnEndedEvent("e8", "t2", 17));

		const find = () =>
			rows<{ session_id: string; turn_id: string }>(LIFETIME_SQL.findCompactableTurns, [5000, 10]);
		expect(find()).toHaveLength(0);

		// A later edit of the archived workspace must not restart the 90-day count.
		run(
			"UPDATE workspaces SET state = 'archived', archived_at = 1000, updated_at = 9000000 WHERE id = $1",
			[workspaceId],
		);
		const turns = find();
		expect(turns.map((turn) => turn.turn_id)).toEqual(["t1", "t2"]);
		for (const turn of turns) {
			const params = [turn.session_id, turn.turn_id];
			run(LIFETIME_SQL.compactStripKeptEvent, params);
			run(LIFETIME_SQL.compactDropOtherAgentEvents, params);
			run(LIFETIME_SQL.compactMarkTurnEnded, [9000, ...params]);
		}

		const events = rows<SessionEventRow>(SESSION_EVENTS_SQL.listFrom, [sessionId, 0, 20]);
		expect(events.map((row) => row.event_id)).toEqual(["e1", "e4", "e5", "e6", "e8"]);
		const kept = must(sessionEventFromRow(events[1] as SessionEventRow)).event;
		expect(kept.type === "agent" && kept.message.items.map((item) => item.kind)).toEqual([
			"text",
			"usage",
		]);
		expect(kept.type === "agent" && kept.message.raw).toBeUndefined();
		const marked = rows<{ compacted_at: number | null }>(
			"SELECT compacted_at FROM session_events WHERE session_id = $1 AND event_id = 'e5'",
			[sessionId],
		);
		expect(marked[0]?.compacted_at).not.toBeNull();
		expect(find()).toHaveLength(0);
	});

	it("lists old drafts and ended terminals, then deletes by id list", () => {
		run(ATTACHMENTS_SQL.insert, attachmentToParams(sampleAttachment));
		run(
			ATTACHMENTS_SQL.insert,
			attachmentToParams({
				...sampleAttachment,
				id: "att-new" as AttachmentId,
				createdAt: 1000 + 8 * MS_PER_DAY,
			}),
		);
		run(
			ATTACHMENTS_SQL.insert,
			attachmentToParams({ ...sampleAttachment, id: "att-sent" as AttachmentId, isDraft: false }),
		);
		const cutoff = ageCutoff(1000 + 8 * MS_PER_DAY, 7);
		const old = rows<{ id: string }>(LIFETIME_SQL.listExpiredDraftAttachments, [cutoff, 10]);
		expect(old.map((row) => row.id)).toEqual(["att-1"]);
		expect(
			run(LIFETIME_SQL.deleteAttachmentsByIds, [JSON.stringify(old.map((row) => row.id))]),
		).toBe(1);

		run(TERMINALS_SQL.insert, terminalToParams({ ...sampleTerminal, endedAt: 100 }));
		run(TERMINALS_SQL.insert, terminalToParams({ ...sampleTerminal, id: "open" as never }));
		const ended = rows<{ id: string }>(LIFETIME_SQL.listEndedTerminals, [5000, 10]);
		expect(ended).toEqual([{ id: "term-1" }]);
		expect(run(LIFETIME_SQL.deleteTerminalsByIds, [JSON.stringify(["term-1"])])).toBe(1);

		expect(
			rows(LIFETIME_SQL.filterExistingSessionIds, [JSON.stringify([sessionId, "gone"])]),
		).toEqual([expect.objectContaining({ id: sessionId })]);
	});
});

describe("the tables of migration 0004", () => {
	it("backlog workspaces round-trip and outlive their repo with no repository", () => {
		run(REPOS_SQL.insert, repoToParams(sampleRepo));
		const entry = {
			id: workspaceId,
			repoId,
			displayName: null,
			prompt: "Add a retry to the uploader",
			attachmentPaths: ["/tmp/a.png"],
			config: sampleSession.config,
			sectionId: null,
			createdAt: 10,
			updatedAt: 20,
		};
		run(BACKLOG_WORKSPACES_SQL.insert, must(backlogWorkspaceToParams(entry)));
		expect(
			must(
				backlogWorkspaceFromRow(
					one<BacklogWorkspaceRow>(BACKLOG_WORKSPACES_SQL.get, [workspaceId]),
				),
			),
		).toEqual(entry);
		expect(
			rows<{ id: string }>("SELECT id FROM backlog_workspaces WHERE repo_id = $1", [repoId]),
		).toHaveLength(1);
		run(REPOS_SQL.delete, [repoId]);
		expect(rows(BACKLOG_WORKSPACES_SQL.list)).toHaveLength(1);
		expect(
			rows<{ id: string }>("SELECT id FROM backlog_workspaces WHERE repo_id = $1", [repoId]),
		).toHaveLength(0);
		expect(
			must(
				backlogWorkspaceFromRow(
					one<BacklogWorkspaceRow>(BACKLOG_WORKSPACES_SQL.get, [workspaceId]),
				),
			).repoId,
		).toBeNull();
	});

	it("a backlog workspace with a config that is not a SessionConfig is an error", () => {
		run(REPOS_SQL.insert, repoToParams(sampleRepo));
		run(BACKLOG_WORKSPACES_SQL.insert, [workspaceId, repoId, null, "p", "[]", "{}", null, 1, 1]);
		const row = one<BacklogWorkspaceRow>(BACKLOG_WORKSPACES_SQL.get, [workspaceId]);
		expect(backlogWorkspaceFromRow(row)).toMatchObject({ ok: false });
	});

	it("snippets round-trip, and only a keyword that is set must be unique", () => {
		const snippet = {
			id: "sn-1" as never,
			name: "Review",
			keyword: "rev",
			prompt: "Review this change.",
			createdAt: 1,
			updatedAt: 2,
		};
		run(SNIPPETS_SQL.insert, snippetToParams(snippet));
		expect(snippetFromRow(rows<SnippetRow>(SNIPPETS_SQL.list)[0] as SnippetRow)).toEqual(snippet);
		expect(() =>
			run(SNIPPETS_SQL.insert, snippetToParams({ ...snippet, id: "sn-2" as never })),
		).toThrow();
		const plain = { ...snippet, keyword: null };
		run(SNIPPETS_SQL.insert, snippetToParams({ ...plain, id: "sn-3" as never }));
		run(SNIPPETS_SQL.insert, snippetToParams({ ...plain, id: "sn-4" as never }));
		expect(rows(SNIPPETS_SQL.list)).toHaveLength(3);
		expect(run(SNIPPETS_SQL.delete, ["sn-1"])).toBe(1);
	});

	it("provider keys: a null acpAgent is stored as an empty string, and an upsert leaves one row", () => {
		const key = {
			agent: "claude",
			acpAgent: null,
			provider: "anthropic",
			envVar: "ANTHROPIC_API_KEY",
			source: "entered",
			keychainRef: "keychain-1",
			updatedAt: 5,
		} as const;
		run(PROVIDER_KEYS_SQL.upsert, must(providerKeyToParams(key)));
		run(PROVIDER_KEYS_SQL.upsert, must(providerKeyToParams({ ...key, keychainRef: "keychain-2" })));
		const stored = rows<ProviderKeyRow>(PROVIDER_KEYS_SQL.listForAgent, ["claude", ""]);
		expect(stored).toHaveLength(1);
		expect(stored[0]?.acp_agent).toBe("");
		expect(providerKeyFromRow(stored[0] as ProviderKeyRow)).toEqual({
			...key,
			keychainRef: "keychain-2",
		});
		expect(rows(PROVIDER_KEYS_SQL.listForAgent, ["claude", ""])).toHaveLength(1);
		expect(run(PROVIDER_KEYS_SQL.delete, ["claude", "", "anthropic", "ANTHROPIC_API_KEY"])).toBe(1);
	});

	it("a provider key needs a Keychain reference exactly when its source is entered", () => {
		const base = {
			agent: "codex",
			acpAgent: null,
			provider: "openai",
			envVar: "OPENAI_API_KEY",
			updatedAt: 1,
		} as const;
		expect(providerKeyToParams({ ...base, source: "entered", keychainRef: null })).toMatchObject({
			ok: false,
		});
		expect(providerKeyToParams({ ...base, source: "this_mac", keychainRef: "k" })).toMatchObject({
			ok: false,
		});
		expect(providerKeyToParams({ ...base, source: "this_mac", keychainRef: null })).toMatchObject({
			ok: true,
		});
	});
});
