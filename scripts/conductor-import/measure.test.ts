import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
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
import { join } from "node:path";
import {
	conductorChatRows,
	KNOWN_CHAT,
	manyTurns,
} from "../../apps/desktop/src/test/conductor-chat.ts";
import { CONDUCTOR_FIXTURE_SCHEMA } from "../../apps/desktop/src/test/conductor-schema.ts";

const MEASURE = join(import.meta.dir, "measure.ts");

/** The large made-up chat: 10,000 turns of five rows each. */
const BIG_TURNS = 10_000;
const BIG_ROWS = BIG_TURNS * 5;
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
	`import: ${S} s, of which the rows ${S} s and chat history ${S} s`,
	`import, chat history: ${N} chats came, ${N} changed since the dry run, ${N} failed`,
	`total, dry run and import: ${S} s`,
	`chats timed: ${N}`,
	String.raw`slowest chats \(rows, seconds\):`,
	`  [1-5]: ${N} ${S}`,
	`database queue: held ${N} times, longest ${S} s \\((a chat of ${N} rows|the rows' write)\\); the rows' write held it ${S} s`,
	`reads of the copy: ${N} pages of keys, ${N} reads of rows`,
	`peak resident memory, sampled every 250 ms: import process ${N} MB \\(${N} MB as the dry run began\\), sidecar ${N} MB, both together ${N} MB \\(${N} samples\\)`,
	`largest chat: (no chat has events|${N} events, ${N} turns; opened in ${S} s, turns built in ${S} s)`,
	`outside the run's folder: ${N} files written by the import kept in the run's folder, ${N} writes refused, ${N} commands refused`,
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
	for (const row of conductorChatRows("s-secret-id-4", manyTurns(BIG_TURNS, 5, 200))) {
		insert("session_messages", row);
	}
	for (const id of ["s-known", "s-codex", "s-behind"]) {
		for (const row of conductorChatRows(id, KNOWN_CHAT)) insert("session_messages", row);
	}
	db.exec("COMMIT");
	db.close();
	return { dir, copy, project };
}

/** Run folders this script makes; none may be left once it ends. */
const runFolders = (): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith("cim-"));

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
			`largest chat: ${BIG_ROWS + BIG_TURNS} events, ${BIG_TURNS} turns;`,
		);
		// The sampler found both processes: the instrument reads something real.
		const memory =
			/import process (\d+) MB \((\d+) MB as the dry run began\), sidecar (\d+) MB/.exec(stdout);
		expect(Number(memory?.[1])).toBeGreaterThan(0);
		expect(Number(memory?.[2])).toBeGreaterThan(0);
		expect(Number(memory?.[2])).toBeLessThanOrEqual(Number(memory?.[1]));
		expect(Number(memory?.[3])).toBeGreaterThan(0);
		expect(lines).toContain(
			"outside the run's folder: 1 files written by the import kept in the run's folder, 0 writes refused, 0 commands refused",
		);
	});

	test("a copy that is not a database fails with its stage only", () => {
		const { dir } = fixture();
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
