import type { LiveState } from "@conducted/protocol";
import { idleLiveState } from "@conducted/protocol";
import type { RepoId, SectionId, SessionId, WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { attachmentFromRow, attachmentToParams } from "./attachments.ts";
import { diffCommentFromRow, diffCommentToParams } from "./diff-comments.ts";
import { envVarFromRow, envVarToParams } from "./env-vars.ts";
import { favoriteModelFromRow, favoriteModelToParams } from "./favorite-models.ts";
import { ageCutoff, MS_PER_DAY } from "./lifetime.ts";
import {
	queuedMessageFromRow,
	queuedMessagesFromRows,
	queuedMessageToParams,
} from "./queued-messages.ts";
import { interruptedTurnEvent } from "./repair.ts";
import { repoFromRow, repoToParams } from "./repos.ts";
import { createRepositories } from "./repositories.ts";
import { collectResults, parseJsonColumn, parseStringList, stringifyJson } from "./row-codec.ts";
import { sectionFromRow, sectionMemberToParams, sectionToParams } from "./sections.ts";
import { sessionEventFromRow, sessionEventToParams } from "./session-events.ts";
import { liveStateFromRow, liveStateToParams } from "./session-live-state.ts";
import { sessionFromRow, sessionToParams } from "./sessions.ts";
import { settingFromRow, settingToParams } from "./settings.ts";
import { terminalFromRow, terminalToParams } from "./terminals.ts";
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
	turnId,
	userMessageEvent,
	workspaceId,
} from "./test-fixtures.ts";
import { workspaceFromRow, workspaceToParams } from "./workspaces.ts";

/** Builds a row object from an insert parameter list and its column names. */
const rowFrom = <Row>(columns: readonly string[], params: readonly unknown[]): Row =>
	Object.fromEntries(columns.map((column, index) => [column, params[index]])) as Row;

/** A row of a local workspace; the host columns the codecs check (CLOUD-13). */
const LOCAL_HOST_COLUMNS = {
	host_kind: "local",
	host_url: null,
	host_vm_id: null,
} as const;

describe("row-codec", () => {
	it("returns an error for text that is not JSON", () => {
		const result = parseJsonColumn("{", z.object({}), "x.col");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("db.invalid_json");
	});

	it("returns an error for JSON of the wrong shape", () => {
		expect(parseStringList('{"a":1}', "x.col").ok).toBe(false);
		expect(parseStringList("[1]", "x.col").ok).toBe(false);
	});

	it("parses a list of strings", () => {
		expect(parseStringList('["a","b"]', "x.col")).toEqual({ ok: true, value: ["a", "b"] });
	});

	it("refuses values JSON cannot hold instead of throwing", () => {
		expect(stringifyJson(undefined, "x.col").ok).toBe(false);
		expect(stringifyJson(10n, "x.col").ok).toBe(false);
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		expect(stringifyJson(cycle, "x.col").ok).toBe(false);
	});

	it("collectResults returns the first error", () => {
		const bad = parseStringList("nope", "x.col");
		const good = parseStringList("[]", "x.col");
		expect(collectResults([good, bad, good]).ok).toBe(false);
		expect(collectResults([good, good])).toEqual({ ok: true, value: [[], []] });
	});
});

describe("repos", () => {
	it("round-trips and maps hidden to 0 and 1", () => {
		const params = repoToParams(sampleRepo);
		expect(params[7]).toBe(1);
		const row = rowFrom<Parameters<typeof repoFromRow>[0]>(
			[
				"id",
				"name",
				"root_path",
				"remote_url",
				"default_branch",
				"icon",
				"display_order",
				"hidden",
				"created_at",
				"updated_at",
			],
			params,
		);
		expect(repoFromRow(row)).toEqual(sampleRepo);
		expect(repoFromRow({ ...row, hidden: 0 }).hidden).toBe(false);
	});
});

describe("workspaces", () => {
	const columns = [
		"id",
		"repo_id",
		"directory_name",
		"path",
		"branch",
		"branch_is_placeholder",
		"display_name",
		"target_branch",
		"state",
		"kanban_status",
		"port",
		"pinned_at",
		"notes",
		"linked_paths",
		"pr_number",
		"pr_title",
		"pr_description",
		"archive_commit",
		"setup_log_path",
		"archived_at",
		"active_session_id",
		"files_copied",
		"host_kind",
		"host_url",
		"host_vm_id",
		"last_activity_at",
		"created_at",
		"updated_at",
	];

	it("round-trips, writing linked_paths as a JSON list", () => {
		const params = workspaceToParams(sampleWorkspace);
		expect(params.ok).toBe(true);
		if (!params.ok) return;
		expect(params.value[13]).toBe('["/code/other","/code/shared"]');
		const row = rowFrom<Parameters<typeof workspaceFromRow>[0]>(columns, params.value);
		const { setupLogPath: _ignored, ...model } = sampleWorkspace;
		expect(workspaceFromRow(row)).toEqual({ ok: true, value: model });
	});

	it("returns an error Result for bad linked_paths", () => {
		const params = workspaceToParams(sampleWorkspace);
		if (!params.ok) throw new Error("fixture must serialise");
		const row = rowFrom<Parameters<typeof workspaceFromRow>[0]>(columns, params.value);
		for (const bad of ["not json", '"a string"', "[1, 2]"]) {
			expect(workspaceFromRow({ ...row, linked_paths: bad }).ok).toBe(false);
		}
	});
});

describe("sessions", () => {
	const columns = [
		"id",
		"workspace_id",
		"title",
		"config",
		"agent_session_id",
		"unread_count",
		"context_used_tokens",
		"context_window_tokens",
		"queue_paused_at",
		"closed_at",
		"last_user_message_at",
		"created_at",
		"updated_at",
		"fork_resume_native_message_id",
	];

	it("round-trips the config", () => {
		const params = sessionToParams(sampleSession);
		if (!params.ok) throw new Error("fixture must serialise");
		const row = {
			...rowFrom<Parameters<typeof sessionFromRow>[0]>(columns, params.value),
			...LOCAL_HOST_COLUMNS,
		};
		expect(sessionFromRow(row)).toEqual({ ok: true, value: sampleSession });
	});

	it("returns an error Result when config is invalid", () => {
		const params = sessionToParams(sampleSession);
		if (!params.ok) throw new Error("fixture must serialise");
		const row = {
			...rowFrom<Parameters<typeof sessionFromRow>[0]>(columns, params.value),
			...LOCAL_HOST_COLUMNS,
		};
		expect(sessionFromRow({ ...row, config: "{" }).ok).toBe(false);
		expect(sessionFromRow({ ...row, config: '{"agent":"claude"}' }).ok).toBe(false);
		expect(sessionFromRow({ ...row, config: '{"agent":"nobody","model":"x"}' }).ok).toBe(false);
	});
});

describe("session events", () => {
	const events = [
		userMessageEvent("e1", "turn-1", 10),
		agentEvent("e2", "turn-1", 11, [{ kind: "text", text: "Done" }]),
		turnEndedEvent("e3", "turn-1", 12),
	];

	it("maps every event type from its stored content", () => {
		events.forEach((event, idx) => {
			const params = sessionEventToParams(sessionId, event, 99);
			if (!params.ok) throw new Error("fixture must serialise");
			const [session, eventId, type, turn, content, receivedAt] = params.value as [
				SessionId,
				string,
				string,
				string,
				string,
				number,
			];
			const stored = sessionEventFromRow({
				session_id: session,
				...LOCAL_HOST_COLUMNS,
				idx,
				event_id: eventId as never,
				type: type as never,
				turn_id: turn as never,
				content,
				received_at: receivedAt,
				reverted_at: null,
			});
			expect(stored).toMatchObject({ ok: true, value: { idx, event, receivedAt: 99 } });
		});
	});

	it("returns an error Result for bad content", () => {
		const row = {
			session_id: sessionId,
			...LOCAL_HOST_COLUMNS,
			idx: 0,
			event_id: "e1" as never,
			type: "user_message" as const,
			turn_id: turnId,
			reverted_at: null,
			received_at: 1,
		};
		expect(sessionEventFromRow({ ...row, content: "{" }).ok).toBe(false);
		expect(sessionEventFromRow({ ...row, content: '{"type":"agent"}' }).ok).toBe(false);
		expect(sessionEventFromRow({ ...row, content: '{"type":"mystery"}' }).ok).toBe(false);
	});

	it("builds the same parameters the append statement expects", () => {
		const params = sessionEventToParams(sessionId, events[0] as never, 5);
		expect(params).toMatchObject({ ok: true });
		if (params.ok) {
			expect(params.value.slice(0, 4)).toEqual([sessionId, "e1", "user_message", "turn-1"]);
			expect(params.value[5]).toBe(5);
		}
	});
});

describe("live state", () => {
	it("round-trips the idle state and a working state", () => {
		const working: LiveState = { ...idleLiveState, status: "working", error: "boom" };
		for (const state of [idleLiveState, working]) {
			const params = liveStateToParams(sessionId, state, 7);
			if (!params.ok) throw new Error("fixture must serialise");
			const [id, json, updatedAt] = params.value as [SessionId, string, number];
			expect(
				liveStateFromRow({
					session_id: id,
					...LOCAL_HOST_COLUMNS,
					live_state: json,
					updated_at: updatedAt,
				}),
			).toEqual({ ok: true, value: { sessionId, liveState: state, updatedAt: 7 } });
		}
	});

	it("returns an error Result for bad live_state", () => {
		const row = { session_id: sessionId, ...LOCAL_HOST_COLUMNS, updated_at: 1 };
		expect(liveStateFromRow({ ...row, live_state: "{" }).ok).toBe(false);
		expect(liveStateFromRow({ ...row, live_state: '{"status":"sleeping"}' }).ok).toBe(false);
	});
});

describe("queued messages", () => {
	const columns = [
		"id",
		"session_id",
		"text",
		"attachment_paths",
		"delivery",
		"position",
		"state",
		"last_error",
		"created_at",
		"updated_at",
	];

	it("round-trips and stamps created and updated time", () => {
		const params = queuedMessageToParams(sampleQueued, 55);
		if (!params.ok) throw new Error("fixture must serialise");
		expect(params.value.slice(-2)).toEqual([55, 55]);
		const row = rowFrom<Parameters<typeof queuedMessageFromRow>[0]>(columns, params.value);
		expect(queuedMessageFromRow(row)).toEqual({ ok: true, value: sampleQueued });
	});

	it("returns an error Result for bad attachment_paths, also in a list", () => {
		const params = queuedMessageToParams(sampleQueued, 55);
		if (!params.ok) throw new Error("fixture must serialise");
		const row = rowFrom<Parameters<typeof queuedMessageFromRow>[0]>(columns, params.value);
		const bad = { ...row, attachment_paths: "oops" };
		expect(queuedMessageFromRow(bad).ok).toBe(false);
		expect(queuedMessagesFromRows([row, bad]).ok).toBe(false);
		expect(queuedMessagesFromRows([row, row])).toMatchObject({ ok: true });
	});
});

describe("diff comments", () => {
	it("round-trips author, flags and nullable fields", () => {
		const params = diffCommentToParams(sampleComment);
		const row = rowFrom<Parameters<typeof diffCommentFromRow>[0]>(
			[
				"id",
				"workspace_id",
				"file_path",
				"line",
				"end_line",
				"body",
				"author_kind",
				"author_name",
				"author_avatar_url",
				"side",
				"thread_id",
				"reply_to_id",
				"suggestion",
				"remote_url",
				"resolved",
				"outdated",
				"state",
				"location",
				"created_at",
				"updated_at",
				"suggestion_base_code",
			],
			params,
		);
		expect(row.resolved).toBe(1);
		expect(row.outdated).toBe(0);
		expect(row.location).toBe("file");
		expect(diffCommentFromRow(row)).toEqual(sampleComment);
	});

	it("stores a pull request comment with no file as location pull_request", () => {
		const prComment = { ...sampleComment, filePath: null, line: null, endLine: null };
		const params = diffCommentToParams(prComment);
		expect(params[2]).toBe("");
		expect(params[17]).toBe("pull_request");
		const row = rowFrom<Parameters<typeof diffCommentFromRow>[0]>(
			[
				"id",
				"workspace_id",
				"file_path",
				"line",
				"end_line",
				"body",
				"author_kind",
				"author_name",
				"author_avatar_url",
				"side",
				"thread_id",
				"reply_to_id",
				"suggestion",
				"remote_url",
				"resolved",
				"outdated",
				"state",
				"location",
				"created_at",
				"updated_at",
				"suggestion_base_code",
			],
			params,
		);
		expect(diffCommentFromRow(row)).toEqual(prComment);
	});
});

describe("attachments", () => {
	it("round-trips and keeps message id and time as columns only", () => {
		const params = attachmentToParams(sampleAttachment);
		const row = rowFrom<Parameters<typeof attachmentFromRow>[0]>(
			[
				"id",
				"session_id",
				"message_id",
				"kind",
				"original_name",
				"path",
				"is_draft",
				"comment_id",
				"created_at",
			],
			params,
		);
		const { messageId: _m, createdAt: _c, ...model } = sampleAttachment;
		expect(attachmentFromRow(row)).toEqual(model);
		expect(row.is_draft).toBe(1);
	});
});

describe("terminals", () => {
	it("round-trips and keeps the size as columns only", () => {
		const params = terminalToParams(sampleTerminal);
		const row = rowFrom<Parameters<typeof terminalFromRow>[0]>(
			[
				"id",
				"workspace_id",
				"repo_id",
				"kind",
				"title",
				"cwd",
				"cols",
				"rows",
				"start_command",
				"screen_state",
				"started_at",
				"ended_at",
				"exit_code",
			],
			params,
		);
		const { cols: _c, rows: _r, screenState: _s, ...model } = sampleTerminal;
		expect(terminalFromRow(row)).toEqual(model);
		expect(row.cols).toBe(120);
	});
});

describe("sections", () => {
	const sectionRow = {
		id: "sec-1" as SectionId,
		name: "Review",
		emoji: null,
		position: 0,
		collapsed: 1,
		created_at: 5,
	};
	const member = (section: string, workspace: string, position: number) => ({
		section_id: section as SectionId,
		workspace_id: workspace as WorkspaceId,
		position,
	});

	it("orders members by position and ignores other sections", () => {
		const section = sectionFromRow(sectionRow, [
			member("sec-1", "w-b", 1),
			member("sec-2", "w-x", 0),
			member("sec-1", "w-a", 0),
			member("sec-1", "w-c", 1),
		]);
		expect(section.workspaceIds).toEqual(["w-a", "w-b", "w-c"]);
		expect(section.collapsed).toBe(true);
	});

	it("builds insert parameters with the created time", () => {
		expect(sectionToParams(sampleSection, 77)).toEqual(["sec-1", "Review", "eyes", 1, 1, 77]);
		expect(sectionMemberToParams(sampleSection.id, workspaceId, 3)).toEqual(["sec-1", "ws-1", 3]);
	});
});

describe("favorite models", () => {
	const config = { agent: "claude", model: "default", effort: "high", fastMode: false } as const;

	it("round-trips", () => {
		const params = favoriteModelToParams({ id: "f1", config, position: 0 });
		if (!params.ok) throw new Error("fixture must serialise");
		const [id, json, position] = params.value as [string, string, number];
		expect(favoriteModelFromRow({ id, config: json, position })).toEqual({
			ok: true,
			value: { id: "f1", config, position: 0 },
		});
	});

	it("returns an error Result when the config has no model", () => {
		const row = { id: "f1", position: 0 };
		expect(favoriteModelFromRow({ ...row, config: "{" }).ok).toBe(false);
		expect(
			favoriteModelFromRow({
				...row,
				config: '{"agent":"claude","effort":"high","fastMode":false}',
			}).ok,
		).toBe(false);
	});
});

describe("settings", () => {
	it("round-trips JSON values of every kind", () => {
		for (const value of [true, 0, "text", null, [1, 2], { nested: { a: 1 } }]) {
			const params = settingToParams({ key: "k", value, updatedAt: 9 });
			if (!params.ok) throw new Error("fixture must serialise");
			const [key, json, updatedAt] = params.value as [string, string, number];
			expect(settingFromRow({ key, value: json, updated_at: updatedAt })).toEqual({
				ok: true,
				value: { key: "k", value, updatedAt: 9 },
			});
		}
	});

	it("returns an error Result for bad stored JSON and for undefined values", () => {
		expect(settingFromRow({ key: "k", value: "{", updated_at: 1 }).ok).toBe(false);
		expect(settingToParams({ key: "k", value: undefined, updatedAt: 1 }).ok).toBe(false);
	});
});

describe("env vars", () => {
	it("round-trips global and repo rows", () => {
		const global = envVarFromRow({
			name: "API_URL",
			scope: "global",
			repo_id: null,
			keychain_ref: "kc-1",
		});
		expect(envVarToParams(global)).toEqual({
			ok: true,
			value: ["API_URL", "global", null, "kc-1"],
		});
		const scoped = { ...global, scope: "repo" as const, repoId: repoId as RepoId };
		expect(envVarToParams(scoped)).toEqual({
			ok: true,
			value: ["API_URL", "repo", "repo-1", "kc-1"],
		});
	});

	it("refuses a scope and repo id that disagree", () => {
		const base = { name: "X", keychainRef: "k" };
		expect(envVarToParams({ ...base, scope: "repo", repoId: null }).ok).toBe(false);
		expect(envVarToParams({ ...base, scope: "global", repoId: repoId }).ok).toBe(false);
	});
});

describe("repair and lifetime helpers", () => {
	it("builds a turn_ended event with outcome interrupted", () => {
		const event = interruptedTurnEvent(turnId, "e9" as never, 123);
		expect(event).toEqual({
			type: "turn_ended",
			eventId: "e9",
			at: 123,
			turnId,
			outcome: "interrupted",
		});
		const params = sessionEventToParams(sessionId, event, 123);
		expect(params).toMatchObject({ ok: true });
	});

	it("turns a day count into a cutoff time", () => {
		expect(ageCutoff(10 * MS_PER_DAY, 3)).toBe(7 * MS_PER_DAY);
	});
});

describe("createRepositories", () => {
	it("returns all eighteen repositories", () => {
		const unused = {} as never;
		const repositories = createRepositories(unused, unused);
		expect(Object.keys(repositories).sort()).toEqual(
			[
				"repos",
				"workspaces",
				"sessions",
				"sessionEvents",
				"liveStates",
				"queuedMessages",
				"diffComments",
				"attachments",
				"terminals",
				"sections",
				"favoriteModels",
				"settings",
				"envVars",
				"backlogWorkspaces",
				"snippets",
				"providerKeys",
				"modelContextWindows",
				"hostCopy",
			].sort(),
		);
	});
});
