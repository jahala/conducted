// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { vitestContractHarness } from "../test/contract-harness.ts";
import { createNodeQueuedDatabase } from "../test/node-sql.ts";
import { type ContractControls, runPlatformContract } from "../test/platform-contract.ts";
import { createMemoryPlatform } from "./memory.ts";

let caseNumber = 0;
let contractIdCounter = 0;

const SCRIPTED_SHELL =
	"the stand-in answers shell commands from a script and starts no process, so this case would read the script back; the Node-backed Tauri run starts real processes, and the stand-in's own pass-through is tested below";

runPlatformContract(
	vitestContractHarness,
	"memory",
	async () => {
		caseNumber++;
		const db = new DatabaseSync(":memory:");
		db.exec("PRAGMA foreign_keys = ON");
		const memory = createMemoryPlatform({
			clock: { now: () => 1_700_000_000_000 + caseNumber },
			ids: {
				uuid: () => `00000000-0000-4000-8000-${String(++contractIdCounter).padStart(12, "0")}`,
			},
			database: createNodeQueuedDatabase(db),
			version: "0.0.0-test",
			channel: "dev",
			home: `/memory/${caseNumber}/home`,
			appData: `/memory/${caseNumber}/app-data`,
			temp: `/memory/${caseNumber}/temp`,
			resources: `/memory/${caseNumber}/resources`,
			enforceFileScope: true,
		});
		// The memory Platform's one connection is the database this run hands it, so the run is
		// what can lose it. The controls keep their getters through the prototype.
		let connectionOpen = true;
		const loseDatabaseConnection = (): void => {
			if (connectionOpen) db.close();
			connectionOpen = false;
		};
		const controls: ContractControls = Object.assign(
			Object.create(memory.controls) as ContractControls,
			{ loseDatabaseConnection },
		);
		return {
			platform: memory.platform,
			controls,
			// The default workspaces folder, so the cases write inside the default file scope.
			root: `/memory/${caseNumber}/home/conducted`,
			outside: `/memory/${caseNumber}/outside`,
			cleanup: async () => {
				try {
					expect(memory.controls.dispose()).toBe(0);
				} finally {
					loseDatabaseConnection();
				}
			},
		};
	},
	{
		controls: true,
		skips: {
			"shell.run-stdout": SCRIPTED_SHELL,
			"shell.run-nonzero": SCRIPTED_SHELL,
			"shell.run-cwd-env-stdin": SCRIPTED_SHELL,
			"shell.run-timeout": SCRIPTED_SHELL,
			"shell.no-shell-string": SCRIPTED_SHELL,
		},
	},
);

let nextId = 0;

function freshPlatform() {
	const db = new DatabaseSync(":memory:");
	db.exec("PRAGMA foreign_keys = ON");
	const memory = createMemoryPlatform({
		clock: { now: () => 42 },
		ids: { uuid: () => `uuid-${++nextId}` },
		database: createNodeQueuedDatabase(db),
	});
	return { memory, db };
}

describe("PLAT-01 in-memory Platform", () => {
	it("reports an unscripted shell command instead of inventing a result", async () => {
		const { db, memory } = freshPlatform();
		try {
			const result = await memory.platform.shell.run({
				program: "/bin/true",
				args: [],
				cwd: "/",
			});
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.code).toBe("shell_unscripted");
		} finally {
			db.close();
		}
	});

	it("hands the script the command exactly as given and records it", async () => {
		const { db, memory } = freshPlatform();
		try {
			const seen: unknown[] = [];
			memory.controls.scriptShell((command) => {
				seen.push(command);
				return ok({ exitCode: 0, stdout: "", stderr: "" });
			});
			const command = {
				program: "/bin/echo",
				args: ["two words", "$HOME", "'quoted'"],
				cwd: "/work",
				env: { A: "1" },
				stdin: "in\n",
				timeoutMs: 30,
			};
			await memory.platform.shell.run(command);
			expect(seen).toEqual([command]);
			expect(memory.controls.shellCalls).toEqual([command]);
		} finally {
			db.close();
		}
	});

	it("tries the newest script first and falls back to older ones", async () => {
		const { db, memory } = freshPlatform();
		try {
			memory.controls.scriptShell(() => ok({ exitCode: 0, stdout: "older", stderr: "" }));
			memory.controls.scriptShell((command) =>
				command.program === "/bin/echo" ? ok({ exitCode: 0, stdout: "newer", stderr: "" }) : null,
			);
			const echo = await memory.platform.shell.run({ program: "/bin/echo", args: [], cwd: "/" });
			const other = await memory.platform.shell.run({ program: "/bin/ls", args: [], cwd: "/" });
			expect(echo.ok && echo.value.stdout).toBe("newer");
			expect(other.ok && other.value.stdout).toBe("older");
		} finally {
			db.close();
		}
	});

	it("dispose reports listeners that are still attached", () => {
		const { db, memory } = freshPlatform();
		try {
			const unsubscribe = memory.platform.sidecar.onLine(() => {});
			expect(memory.controls.dispose()).toBe(1);
			unsubscribe();
			expect(memory.controls.dispose()).toBe(0);
		} finally {
			db.close();
		}
	});

	it("takes time and ids from its options", async () => {
		const { db, memory } = freshPlatform();
		try {
			memory.controls.addFolder("/work");
			const write = await memory.platform.fs.writeTextAtomic("/work/file.txt", "x");
			expect(write.ok).toBe(true);
			const stat = await memory.platform.fs.stat("/work/file.txt");
			expect(stat.ok && stat.value.modifiedAt).toBe(42);
			const first = await memory.platform.pty.spawn({
				terminalId: "memory-terminal",
				cwd: "/",
				cols: 80,
				rows: 24,
			});
			const second = await memory.platform.pty.spawn({
				terminalId: "memory-terminal",
				cwd: "/",
				cols: 80,
				rows: 24,
			});
			const running = memory.platform.shell.start({ program: "/bin/true", args: [], cwd: "/" });
			const ids = [first.ok && first.value.id, second.ok && second.value.id, running.id];
			expect(ids.every((id) => typeof id === "string" && /^uuid-\d+$/.test(id))).toBe(true);
			expect(new Set(ids).size).toBe(3);
		} finally {
			db.close();
		}
	});

	it("keeps a held command terminal running until it is killed", async () => {
		const { db, memory } = freshPlatform();
		try {
			memory.controls.holdNextPty();
			const spawn = { terminalId: "setup", cwd: "/", cols: 80, rows: 24 };
			const command = { program: "/bin/zsh", args: ["-lc", "pnpm install"] };
			const held = await memory.platform.pty.spawn({ ...spawn, command });
			const next = await memory.platform.pty.spawn({ ...spawn, terminalId: "next", command });
			if (!held.ok || !next.ok) throw new Error("A terminal did not start.");
			const exits: (number | null)[] = [];
			held.value.onExit((code) => exits.push(code));
			// The hold is used once: the next command terminal ends at once, as before.
			const nextEnded = await new Promise<number | null>((resolve) => next.value.onExit(resolve));
			expect(nextEnded).toBe(0);
			expect(exits).toEqual([]);
			await held.value.kill();
			expect(exits).toEqual([143]);
		} finally {
			db.close();
		}
	});

	it("ends a cancelled shell.start with shell_cancelled, as the Rust shell does", async () => {
		const { db, memory } = freshPlatform();
		try {
			memory.controls.holdNextStart();
			const running = memory.platform.shell.start({ program: "/bin/sleep", args: ["5"], cwd: "/" });
			await running.cancel();
			const result = await running.done;
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.code).toBe("shell_cancelled");
		} finally {
			db.close();
		}
	});

	it("keeps a queued dialog answer for the dialog kind it was queued for", async () => {
		const { db, memory } = freshPlatform();
		try {
			memory.controls.queueDialogAnswers({ confirm: true });
			expect(await memory.platform.dialogs.pickFolder({ title: "x" })).toBeNull();
			expect(await memory.platform.dialogs.pickFiles({ title: "x", multiple: true })).toEqual([]);
			expect(
				await memory.platform.dialogs.confirm({ title: "x", message: "y", okLabel: "z" }),
			).toBe(true);
		} finally {
			db.close();
		}
	});

	it("returns no matches for a grep limit of 0", async () => {
		const { db, memory } = freshPlatform();
		try {
			memory.controls.addFile("/r/a.txt", "needle");
			const result = await memory.platform.fileSearch.grep("/r", "needle", {
				caseSensitive: false,
				wholeWord: false,
				regex: false,
				limit: 0,
			});
			expect(result).toEqual({ ok: true, value: [] });
		} finally {
			db.close();
		}
	});

	it("answers a missing attachment source with attachment_missing, as attachments.rs does", async () => {
		const { db, memory } = freshPlatform();
		try {
			const result = await memory.platform.attachments.materialize(
				"/missing/photo.png",
				"/dest/photo.png",
				{ resizeImage: false },
			);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.code).toBe("attachment_missing");
		} finally {
			db.close();
		}
	});

	it("answers a bad grep pattern with search_bad_pattern, as file_search.rs does", async () => {
		const { db, memory } = freshPlatform();
		try {
			const result = await memory.platform.fileSearch.grep("/r", "(", {
				caseSensitive: false,
				wholeWord: false,
				regex: true,
				limit: 10,
			});
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.code).toBe("search_bad_pattern");
		} finally {
			db.close();
		}
	});

	it("rejects a listArtifacts cursor it did not hand out", async () => {
		const { db, memory } = freshPlatform();
		try {
			const result = await memory.platform.fileSearch.listArtifacts("/w", {
				cursor: "abc",
				limit: 5,
			});
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.code).toBe("invalid_cursor");
		} finally {
			db.close();
		}
	});
});
