// @vitest-environment node
/**
 * @feature APP-18 Chat history from Conductor, at the size the owner's chats have
 * Tests that a chat of 200,000 rows comes over through the real container with memory bounded by
 * one read. One of the owner's chats has about 400,000 rows; the spike, which held a whole chat,
 * used about 426 MB per 200,000 rows.
 * The bounds, set before the first run: the heap the import retains (measured after a forced
 * collection, at every tenth read) stays within 64 MiB of the heap before it, for a chat whose
 * rows hold about 90 million characters, so holding the chat would retain more than the bound;
 * the copy is read in one round trip per page of 5,000 keys and per read of 1,000 rows, never per
 * row. Added after the first runs: the samples do not climb by 4 MiB or more while the rows are
 * read, because what the import holds then is the order of the rows, set by the first read, and
 * one read. The instrument was checked on a known case: while the test's sidecar still kept every
 * request it was sent, the same samples climbed with the rows. The test's time limit catches a
 * hang only; time is checked by the read counts, which grow with the chat and not with its square.
 */
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { ok } from "@conducted/shared";
import { afterEach, expect, it } from "vitest";
import { conductorChatRows, manyTurns } from "../../test/conductor-chat.ts";
import { buildConductorFixture } from "../../test/conductor-fixture.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { answerSidecar } from "../../test/sidecar-answers.ts";
import { answerHistory } from "../../test/sidecar-history.ts";
import { HISTORY_LIMITS } from "./history.ts";
import { conductorDatabasePath } from "./plan.ts";

const HOME = "/Users/conducted";
const ROOT = `${HOME}/conductor/repos/alpha`;
const WORKTREE = `${HOME}/conductor/workspaces/alpha/oslo`;
const TURNS = 40_000;
const ROWS = TURNS * 5;
const BOUND_BYTES = 64 * 1024 * 1024;

setFlagsFromString("--expose-gc");
const collect = runInNewContext("gc") as () => void;
const retained = (): number => {
	collect();
	return process.memoryUsage().heapUsed;
};

let current: TestContainer | null = null;
afterEach(async () => {
	await current?.container.stop();
	current?.close();
	current = null;
});

it("APP-18 a chat of 200,000 rows comes over with memory bounded by one read", async () => {
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
			sessions: [{ id: "s-big", workspace_id: "w-1", agent_type: "claude", model: "opus" }],
			session_messages: conductorChatRows("s-big", manyTurns(TURNS, 5, 1500)),
		}),
	);
	controls.addFolder(ROOT);
	controls.addFolder(WORKTREE);
	controls.files.set(`${ROOT}/.git/HEAD`, "ref: refs/heads/main\n");
	const sidecarCalls = answerSidecar(
		test,
		answerHistory(() => ({})),
	);
	/**
	 * The test's sidecar keeps every request it was sent, which the app's socket does not: empty
	 * those records, so the sample measures what the import itself holds.
	 */
	const forgetSidecarLines = (): void => {
		sidecarCalls.length = 0;
		(controls.sidecarSent as string[]).length = 0;
	};
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
	expect(preview.value.history.comes).toEqual({ chats: 1, rows: ROWS });

	// Count the reads and sample the retained heap as the import goes.
	const reads = test.memory.platform.conductorImport;
	const readKeys = reads.readMessageKeys.bind(reads);
	const readRows = reads.readMessages.bind(reads);
	const calls = { keys: 0, rows: 0, chars: 0 };
	const samples: number[] = [];
	reads.readMessageKeys = async (...args) => {
		calls.keys++;
		return readKeys(...args);
	};
	reads.readMessages = async (...args) => {
		calls.rows++;
		if (calls.rows % 10 === 0) {
			forgetSidecarLines();
			samples.push(retained());
		}
		const rows = await readRows(...args);
		if (rows.ok)
			calls.chars += rows.value.reduce((sum, row) => sum + (row.content?.length ?? 0), 0);
		return rows;
	};
	forgetSidecarLines();
	const before = retained();
	const outcome = await service.run();
	if (!outcome.ok) throw new Error(outcome.error.message);

	expect(outcome.value.history).toEqual({ chats: 1, changed: 0, failed: [] });
	const stored = await test.database.select<{ n: number }>(
		"SELECT COUNT(*) AS n FROM session_events WHERE session_id = 's-big'",
	);
	expect(Number(stored[0]?.n)).toBe(ROWS + TURNS);
	expect(calls.chars).toBeGreaterThan(90_000_000);
	expect(calls.keys).toBe(Math.ceil(ROWS / HISTORY_LIMITS.keysPerPage) + 1);
	expect(calls.rows).toBe(Math.ceil(ROWS / HISTORY_LIMITS.rowsPerRead));
	expect(samples.length).toBeGreaterThanOrEqual(10);
	const grown = Math.max(...samples) - before;
	// And it does not climb as the rows are read: what it holds is not the rows.
	expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(4 * 1024 * 1024);
	expect(grown).toBeLessThan(BOUND_BYTES);
}, 300_000);
