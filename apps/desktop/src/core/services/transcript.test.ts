// @vitest-environment node
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { escapeLike, HISTORY_SEARCH_SQL } from "./transcript.ts";

const migration = readFileSync(
	fileURLToPath(new URL("../../../src-tauri/migrations/0001_init.sql", import.meta.url)),
	"utf8",
);

describe("escapeLike", () => {
	it("escapes the wildcard characters and the escape character", () => {
		expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
	});
});

describe("HISTORY_SEARCH_SQL", () => {
	it("finds a literal percent sign and skips reverted events", () => {
		const db = new DatabaseSync(":memory:");
		db.exec(migration);
		db.exec(`INSERT INTO repos (id, name, root_path, default_branch, created_at, updated_at) VALUES ('r', 'n', '/r', 'main', 1, 1);
INSERT INTO workspaces (id, repo_id, directory_name, path, branch, target_branch, state, port, last_activity_at, created_at, updated_at) VALUES ('w', 'r', 'd', '/w', 'b', 'origin/main', 'ready', 55000, 1, 1, 1);
INSERT INTO sessions (id, workspace_id, config, created_at, updated_at) VALUES ('s', 'w', '{}', 1, 1);
INSERT INTO session_events (session_id, idx, event_id, type, turn_id, content, received_at, reverted_at) VALUES
 ('s', 0, 'e0', 'user_message', 't', '{"text":"fix 50% of bugs"}', 10, NULL),
 ('s', 1, 'e1', 'user_message', 't', '{"text":"fix 500 bugs"}', 11, NULL),
 ('s', 2, 'e2', 'user_message', 't', '{"text":"fix 50% later"}', 12, 99),
 ('s', 3, 'e3', 'checkpoint', 't', '{"text":"50% in a checkpoint"}', 13, NULL);`);
		const rows = db
			.prepare(HISTORY_SEARCH_SQL.replace(/\$(\d)/g, "?$1"))
			.all(`%${escapeLike("50%")}%`, 10) as { turn_id: string; received_at: number }[];
		db.close();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.received_at).toBe(10);
	});
});
