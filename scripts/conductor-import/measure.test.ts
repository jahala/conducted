import { Database } from "bun:sqlite";
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { SPACE_MARGIN_BYTES } from "../../apps/desktop/src/core/conductor-import/plan.ts";
import { OPEN_TURNS } from "../../apps/desktop/src/core/services/chat-history.ts";
import {
	conductorChatRows,
	KNOWN_CHAT,
	manyTurns,
} from "../../apps/desktop/src/test/conductor-chat.ts";
import { CONDUCTOR_FIXTURE_SCHEMA } from "../../apps/desktop/src/test/conductor-schema.ts";

import { SOCKET_BASE } from "./measure.ts";

const MEASURE = join(import.meta.dir, "measure.ts");

/**
 * The large made-up chat, at the size of the owner's long chats (#598): 200,700 rows in 22,300
 * turns of nine rows, with 4,500 characters of output per tool call, about 338 million characters
 * in all. Holding it would take the import process past its memory bound.
 */
const BIG_TURNS = 22_300;
const BIG_CHAT = manyTurns(BIG_TURNS, 10, 4_500);
const BIG_ROWS = BIG_CHAT.reduce((sum, turn) => sum + turn.rows.length, 0);
/**
 * How far above where it began each process's memory may rise while the import runs, in MB, set
 * from the measurement (#598): on this chat the import process rose about 270 MB and the sidecar
 * about 330 to 390 MB, most of it text their collectors had not yet freed. An import that kept the
 * chat's events took the import process about 620 MB up.
 */
const IMPORT_RISE_MB = { app: 400, sidecar: 512 };
/**
 * How far opening the largest chat may raise the import process's peak, in MB (#617). Measured on
 * this test's chat: loading every event raised it 772 MB (543 to 1,315); reading the last five
 * turns raised it 0. On a chat of 608 million characters loading every event took it from 527 MB
 * to 1,907 MB.
 */
const OPEN_RISE_MB = 64;
/** Catches a hang only; a run on the large chat takes about 20 seconds on a loaded Mac. */
setDefaultTimeout(300_000);
const KNOWN_ROWS = KNOWN_CHAT.reduce((sum, turn) => sum + turn.rows.length, 0);

/** Values seeded into the database and the project's folder that must never reach the output. */
const SEEDED = [
	"secret-title-1",
	"secret-model-2",
	"claude-session-secret-3",
	"s-secret-id-4",
	"secret-repo-5",
	"secret-workspace-6",
	"secret-branch-7",
	"secret-script-8",
];

const N = String.raw`\d+`;
const S = String.raw`\d+\.\d{2}`;
const KINDS =
	"projects|workspaces|chats|review comments|sidebar sections|favourite models|settings|environment variables|scripts";
/** Every line the script may print: fixed words around numbers. */
const LINES = [
	"Conductor import at full size: counts and timings only",
	`dry run: ${S} s, of which the copy of the database ${S} s`,
	String.raw`dry run counts \(found, to import, already there, left out\):`,
	`  (${KINDS}) ${N} ${N} ${N} ${N}`,
	`dry run, chat history that comes: ${N} chats, ${N} rows`,
	`dry run, chat history already there: ${N} chats, ${N} rows`,
	`dry run, chats with no mapping yet: ${N} chats, ${N} rows`,
	`dry run, history staying behind with its chats: ${N} chats, ${N} rows`,
	`dry run, items listed as left out: ${N}`,
	`dry run, settings files to write: ${N}`,
	`dry run, disk space in bytes: chat history ${N}, needed free ${N}, free ${N}; it (fits|does not fit)`,
	`import: ${S} s, of which the rows ${S} s and chat history ${S} s`,
	`import, chat history: ${N} chats came, ${N} changed since the dry run, ${N} failed`,
	`total, dry run and import: ${S} s`,
	`chats timed: ${N}`,
	String.raw`slowest chats \(rows, seconds\):`,
	`  [1-5]: ${N} ${S}`,
	`database queue: held ${N} times, longest ${S} s \\((a chat of ${N} rows|the rows' write)\\); the rows' write held it ${S} s; the longest statement outside a transaction ${S} s`,
	`reads of the copy: ${N} pages of keys, ${N} reads of rows`,
	`peak resident memory in MB, import process and sidecar, sampled every 250 ms \\(${N} samples\\):`,
	`  (as the dry run began|dry run|import|opening the largest chat): ${N}, ${N}`,
	`largest chat: (no chat has events|${N} events, ${N} turns, ${N} of them loaded; opened in ${S} s, turns built in ${S} s)`,
	`outside the run's folder: ${N} files written by the import kept in the run's folder, ${N} writes refused, ${N} commands refused`,
	`scratch database in bytes, when the dry run ended: file ${N}, journal ${N}`,
	`scratch database in bytes, after the import: file ${N}, journal ${N}`,
	`chat history on disk: the file grew by ${N} bytes against the dry run's ${N}, a ratio of (${S}|none)`,
].map((line) => new RegExp(`^${line}$`));

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A folder's files with their sizes, modified times and bytes, to show nothing changed. */
function fingerprint(folder: string): string {
	const entries = readdirSync(folder, { recursive: true, withFileTypes: true })
		.map((entry) => join(entry.parentPath, entry.name))
		.sort()
		.map((path) => {
			const facts = statSync(path);
			return [path, facts.size, facts.mtimeMs, facts.isFile() ? readFileSync(path, "base64") : ""];
		});
	return JSON.stringify(entries);
}

/**
 * A made-up Conductor database beside a project folder that holds Conductor's settings file. One
 * archived workspace holds the large chat, a chat of known turns and a Codex chat; a live
 * workspace in a folder that is not a git repository stays behind with its chat.
 */
function fixture(): { dir: string; copy: string; project: string } {
	const dir = mkdtempSync(join(tmpdir(), "conducted-measure-test-"));
	dirs.push(dir);
	const project = join(dir, "secret-repo-5");
	mkdirSync(join(project, ".conductor"), { recursive: true });
	writeFileSync(
		join(project, ".conductor/settings.toml"),
		'[scripts]\nsetup = "./secret-script-8.sh $CONDUCTOR_ROOT_PATH"\n',
	);
	const copyFolder = join(dir, "copy");
	mkdirSync(copyFolder);
	const copy = join(copyFolder, "conductor.db");
	const db = new Database(copy);
	db.exec(CONDUCTOR_FIXTURE_SCHEMA);
	const insert = (table: string, row: Record<string, string | null>): void => {
		const columns = Object.keys(row);
		db.prepare(
			`INSERT INTO "${table}" (${columns.map((name) => `"${name}"`).join(", ")})
			VALUES (${columns.map(() => "?").join(", ")})`,
		).run(...columns.map((name) => row[name] ?? null));
	};
	insert("repos", { id: "r-1", name: "secret-repo-5", root_path: project });
	insert("workspaces", {
		local_id: "w-1",
		repository_id: "r-1",
		directory_name: "secret-workspace-6",
		workspace_name: "secret-workspace-6",
		branch: "secret-branch-7",
		state: "archived",
		workspace_path: join(dir, "secret-workspace-6"),
	});
	insert("workspaces", {
		local_id: "w-2",
		repository_id: "r-1",
		directory_name: "live",
		branch: "secret-branch-7",
		state: "ready",
	});
	const chat = (id: string, workspace: string, agent: string): void =>
		insert("sessions", {
			id,
			workspace_id: workspace,
			agent_type: agent,
			model: "secret-model-2",
			title: "secret-title-1",
			claude_session_id: "claude-session-secret-3",
		});
	chat("s-secret-id-4", "w-1", "claude");
	chat("s-known", "w-1", "claude");
	chat("s-codex", "w-1", "codex");
	chat("s-behind", "w-2", "claude");
	db.exec("BEGIN");
	for (const row of conductorChatRows("s-secret-id-4", BIG_CHAT)) {
		insert("session_messages", row);
	}
	for (const id of ["s-known", "s-codex", "s-behind"]) {
		for (const row of conductorChatRows(id, KNOWN_CHAT)) insert("session_messages", row);
	}
	db.exec("COMMIT");
	db.close();
	return { dir, copy, project };
}

/** Run folders and socket folders this script makes; none may be left once it ends. */
const runFolders = (): string[] => [
	...readdirSync(tmpdir()).filter((name) => name.startsWith("cim-")),
	...readdirSync(dirname(SOCKET_BASE))
		.filter((name) => name.startsWith(basename(SOCKET_BASE)))
		.map((name) => join(dirname(SOCKET_BASE), name)),
];

function measure(copy: string): { exitCode: number; stdout: string; stderr: string } {
	const ran = Bun.spawnSync([process.execPath, MEASURE, copy], { stdout: "pipe", stderr: "pipe" });
	return {
		exitCode: ran.exitCode,
		stdout: ran.stdout.toString(),
		stderr: ran.stderr.toString(),
	};
}

describe("APP-18 the full-size import measurement", () => {
	test("prints only lines from the fixed list, and leaves the copy and the project's folder as they were", () => {
		const { copy, project } = fixture();
		const copyBefore = fingerprint(join(copy, ".."));
		const projectBefore = fingerprint(project);
		const foldersBefore = runFolders();

		const { exitCode, stdout, stderr } = measure(copy);

		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
		// The import's settings file went to the run's folder, never into the project.
		expect(fingerprint(project)).toBe(projectBefore);
		expect(fingerprint(join(copy, ".."))).toBe(copyBefore);
		expect(runFolders()).toEqual(foldersBefore);
		const lines = stdout.trimEnd().split("\n");
		for (const line of lines) {
			expect(
				LINES.some((pattern) => pattern.test(line)),
				`not a fixed line: ${line}`,
			).toBe(true);
		}
		for (const value of SEEDED) expect(stdout).not.toContain(value);

		// The numbers are the made-up database's own.
		expect(lines).toContain(
			`dry run, chat history that comes: 2 chats, ${BIG_ROWS + KNOWN_ROWS} rows`,
		);
		expect(lines).toContain(`dry run, chats with no mapping yet: 1 chats, ${KNOWN_ROWS} rows`);
		expect(lines).toContain(
			`dry run, history staying behind with its chats: 1 chats, ${KNOWN_ROWS} rows`,
		);
		expect(lines).toContain(
			"import, chat history: 2 chats came, 0 changed since the dry run, 0 failed",
		);
		expect(lines).toContain("chats timed: 2");
		expect(lines.find((line) => line.startsWith("  1: "))).toStartWith(`  1: ${BIG_ROWS} `);
		expect(lines.find((line) => line.startsWith("database queue:"))).toMatch(
			new RegExp(`^database queue: held 3 times, longest ${S} s \\(a chat of ${BIG_ROWS} rows\\)`),
		);
		// Every turn ends with one more event, so the large chat holds a turn's rows and its end.
		expect(lines.find((line) => line.startsWith("largest chat:"))).toStartWith(
			`largest chat: ${BIG_ROWS + BIG_TURNS} events, ${BIG_TURNS} turns, ${OPEN_TURNS} of them loaded;`,
		);
		// Memory by stage (#598). The sampler found both processes, so the instrument reads
		// something real. The import holds one read at a time, so its memory stays within the
		// bound. Opening the chat reads its last turns only (#617), counted apart from the import.
		const memory = (stage: string): { app: number; sidecar: number } => {
			const found = new RegExp(`^  ${stage}: (\\d+), (\\d+)$`, "m").exec(stdout);
			return { app: Number(found?.[1]), sidecar: Number(found?.[2]) };
		};
		const began = memory("as the dry run began");
		const imported = memory("import");
		const opened = memory("opening the largest chat");
		expect(began.app).toBeGreaterThan(0);
		expect(began.sidecar).toBeGreaterThan(0);
		expect(imported.app - began.app).toBeLessThan(IMPORT_RISE_MB.app);
		expect(imported.sidecar - began.sidecar).toBeLessThan(IMPORT_RISE_MB.sidecar);
		expect(opened.app - imported.app).toBeLessThan(OPEN_RISE_MB);
		expect(lines).toContain(
			"outside the run's folder: 1 files written by the import kept in the run's folder, 0 writes refused, 0 commands refused",
		);
		// The dry run's estimate is checked against the scratch database's real size (D132): the
		// file grows by what chat history takes, within 5% above, and the journal holds the largest
		// chat's transaction within the room the dry run asked for it.
		const space = /chat history (\d+), needed free (\d+), free \d+; it fits$/m.exec(stdout);
		const grew = /the file grew by (\d+) bytes against the dry run's (\d+)/.exec(stdout);
		const after = /after the import: file \d+, journal (\d+)$/m.exec(stdout);
		const history = Number(space?.[1]);
		expect(Number(grew?.[2])).toBe(history);
		expect(history).toBeGreaterThanOrEqual(Number(grew?.[1]));
		expect(history).toBeLessThanOrEqual(Number(grew?.[1]) * 1.05);
		const journalRoom = Number(space?.[2]) - history - SPACE_MARGIN_BYTES;
		expect(Number(after?.[1])).toBeGreaterThan(0);
		expect(Number(after?.[1])).toBeLessThanOrEqual(journalRoom);
	});

	test("a copy that is not a database fails with its stage only", () => {
		const dir = mkdtempSync(join(tmpdir(), "conducted-measure-test-"));
		dirs.push(dir);
		const broken = join(dir, "broken.db");
		writeFileSync(broken, `not a database ${SEEDED.join(" ")}`);
		const foldersBefore = runFolders();

		const { exitCode, stdout, stderr } = measure(broken);

		expect(exitCode).toBe(1);
		expect(stdout).toBe("");
		expect(stderr).toBe("The measurement failed at: dry run\n");
		expect(runFolders()).toEqual(foldersBefore);
	});
});
