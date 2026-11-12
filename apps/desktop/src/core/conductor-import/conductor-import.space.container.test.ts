// @vitest-environment node
/**
 * @feature APP-18 Chat history from Conductor: the dry run's estimate of the space it takes (D132)
 * Tests that the space the dry run says chat history takes is what the database grows by when
 * the import writes it, on made-up chats of four shapes: many small events; tool output of 2,500
 * characters, whose rows leave part of each page empty; tool output of 20,000 characters, whose
 * rows spill into overflow pages; and the known chat's mix of thinking, sub-agents and edits. The
 * chat, its messages and its turns have random UUIDs for ids, as Conductor's do, because how full
 * the index pages get depends on the order ids arrive in. measure.test.ts checks the other case,
 * short ids in order, on a database file with its journal.
 * The tolerance: the estimate is never below what the database grew by, and at most 5% above it.
 * A first run with a flat allowance on the rows' bytes missed by up to 90%, because how full a
 * page is depends on the rows' sizes; the page model in plan.ts lands 0.2% to 2.7% above on these
 * shapes. The instrument is SQLite's own page count, the size the database file takes; `dbstat`
 * split by table and index summed to the same figure on every shape.
 * And the table's indexes are the ones the estimate counts, so a new index fails here first.
 */
import { createHash } from "node:crypto";
import { ok } from "@conducted/shared";
import { afterEach, expect, it } from "vitest";
import {
	type ChatTurnRows,
	conductorChatRows,
	KNOWN_CHAT,
	manyTurns,
} from "../../test/conductor-chat.ts";
import { buildConductorFixture } from "../../test/conductor-fixture.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { answerSidecar } from "../../test/sidecar-answers.ts";
import { answerHistory } from "../../test/sidecar-history.ts";
import { SESSION_EVENT_INDEXES } from "../db/session-events.ts";
import { conductorDatabasePath } from "./plan.ts";

const HOME = "/Users/conducted";
const ROOT = `${HOME}/conductor/repos/alpha`;
const WORKTREE = `${HOME}/conductor/workspaces/alpha/oslo`;
const CHAT = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TOLERANCE = 0.05;

let current: TestContainer | null = null;
afterEach(async () => {
	await current?.container.stop();
	current?.close();
	current = null;
});

/** A UUID made from `text`, so a run's ids are the same each time and spread as random ones. */
function uuidOf(text: string): string {
	const hex = createHash("sha1").update(text).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The chat's rows with Conductor's kind of ids: a random UUID for each message and each turn. */
const withUuids = (rows: Record<string, string>[]): Record<string, string>[] =>
	rows.map((row) => ({
		...row,
		id: uuidOf(row.id ?? ""),
		turn_id: uuidOf(row.turn_id ?? ""),
	}));

/** The known chat `copies` times over, each copy with turn ids of its own. */
const known = (copies: number): ChatTurnRows[] =>
	Array.from({ length: copies }, (_, copy) =>
		KNOWN_CHAT.map((turn) => ({ ...turn, turnId: `${turn.turnId}-${copy}` })),
	).flat();

const SHAPES: readonly [string, () => ChatTurnRows[]][] = [
	["many small events", () => manyTurns(3000, 5, 0)],
	["tool output that leaves pages part-empty", () => manyTurns(1500, 9, 2500)],
	["tool output that spills into overflow pages", () => manyTurns(300, 7, 20_000)],
	["the known chat's mix", () => known(400)],
];

/** The database's size as SQLite counts it: its pages times their size. */
async function databaseBytes(test: TestContainer): Promise<number> {
	const count = await test.database.select<{ page_count: number }>("PRAGMA page_count");
	const size = await test.database.select<{ page_size: number }>("PRAGMA page_size");
	return Number(count[0]?.page_count) * Number(size[0]?.page_size);
}

it.each(SHAPES)(
	"APP-18 the dry run's estimate of %s is what the database grows by, within 5% above",
	async (_shape, turns) => {
		const test = createTestContainer();
		current = test;
		const { controls } = test.memory;
		controls.seedConductorDatabase(
			conductorDatabasePath(HOME),
			buildConductorFixture({
				repos: [{ id: "r-alpha", name: "alpha", root_path: ROOT }],
				workspaces: [
					{
						local_id: "w-1",
						repository_id: "r-alpha",
						directory_name: "oslo",
						branch: "me/oslo",
						state: "ready",
					},
				],
				sessions: [{ id: CHAT, workspace_id: "w-1", agent_type: "claude", model: "opus" }],
				session_messages: withUuids(conductorChatRows(CHAT, turns())),
			}),
		);
		controls.addFolder(ROOT);
		controls.addFolder(WORKTREE);
		controls.files.set(`${ROOT}/.git/HEAD`, "ref: refs/heads/main\n");
		answerSidecar(
			test,
			answerHistory(() => ({})),
		);
		controls.scriptShell((command) => {
			if (command.program === "lsof") return ok({ exitCode: 1, stdout: "", stderr: "" });
			if (command.args.join(" ").endsWith("worktree list --porcelain") && command.cwd === ROOT) {
				const list = `worktree ${ROOT}\nbranch refs/heads/main\n\nworktree ${WORKTREE}\nbranch refs/heads/me/oslo\n`;
				return ok({ exitCode: 0, stdout: list, stderr: "" });
			}
			return null;
		});
		const started = await test.container.start();
		if (!started.ok) throw new Error(started.error.message);
		const service = test.container.services.conductorImport;
		const preview = await service.preview();
		if (!preview.ok) throw new Error(preview.error.message);

		const before = await databaseBytes(test);
		const outcome = await service.run();
		if (!outcome.ok) throw new Error(outcome.error.message);
		const grown = (await databaseBytes(test)) - before;

		expect(outcome.value.history).toEqual({ chats: 1, changed: 0, failed: [] });
		const estimate = preview.value.space.historyBytes;
		expect(estimate).toBeGreaterThanOrEqual(grown);
		expect(estimate).toBeLessThanOrEqual(grown * (1 + TOLERANCE));
	},
	120_000,
);

it("APP-18 the events table has the indexes the estimate counts", async () => {
	const test = createTestContainer();
	current = test;
	const indexes = await test.database.select<{ name: string }>("PRAGMA index_list(session_events)");
	expect(indexes.map((index) => index.name).sort()).toEqual([...SESSION_EVENT_INDEXES].sort());
});
