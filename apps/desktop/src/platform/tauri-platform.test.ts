/**
 * @feature PLAT-02 Tauri implementation of the Platform interface
 * Owns: tests for the Tauri Platform door: startup build order, the database wrapper, the file
 * system commands, dialogs, the opener, the clipboard and quitting.
 * Behaviour: docs/plans/tauri-commands.md, services-map.md 1.1, 2.1 and 6,
 * native-and-sidecar-map.md A2.
 */

import { describe, expect, it, vi } from "vitest";
import type { Database, FileStat } from "./platform.ts";
import {
	COMMANDS,
	createTauriAppInfo,
	createTauriClipboard,
	createTauriDatabase,
	createTauriDialogs,
	createTauriFileSystem,
	createTauriOpener,
	createTauriPlatform,
	EVENTS,
	type SqlDatabase,
	type TauriBindings,
} from "./tauri.ts";

interface Call {
	command: string;
	args?: Record<string, unknown>;
}

function commandBindings(
	handler: (command: string, args?: Record<string, unknown>) => unknown,
	extra: Partial<TauriBindings> = {},
): TauriBindings {
	return {
		invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> =>
			handler(command, args) as T,
		listen: async () => () => {},
		...extra,
	};
}

function fakeSql(overrides: Partial<SqlDatabase> = {}): SqlDatabase {
	return {
		execute: async () => ({ rowsAffected: 0 }),
		select: async <Rows>(): Promise<Rows> => [] as unknown as Rows,
		...overrides,
	};
}

describe("PLAT-02 Tauri file system", () => {
	const paths = {
		home: "/Users/me",
		appData: "/data",
		temp: "/tmp",
		resources: "/res",
	};

	it("PLAT-02 sends the file commands and turns a missing stat into an Err", async () => {
		const calls: Call[] = [];
		const file: FileStat = {
			path: "/data/file.txt",
			isDirectory: false,
			isSymlink: false,
			size: 6,
			modifiedAt: 1,
		};
		const fs = createTauriFileSystem(
			commandBindings((command, args) => {
				calls.push({ command, args });
				switch (command) {
					case COMMANDS.fsReadText:
						return "héllo";
					case COMMANDS.fsStat:
						return args?.path === file.path ? file : null;
					case COMMANDS.fsReadDir:
						return [file];
					default:
						return undefined;
				}
			}),
			paths,
		);

		expect(await fs.readText(file.path)).toEqual({ ok: true, value: "héllo" });
		expect(await fs.exists(file.path)).toBe(true);
		expect(await fs.exists("/data/missing")).toBe(false);
		expect(await fs.stat("/data/missing")).toMatchObject({
			ok: false,
			error: { code: "fs_not_found" },
		});
		expect(await fs.stat(file.path)).toEqual({ ok: true, value: file });
		expect(await fs.readDir("/data")).toEqual({ ok: true, value: [file] });
		expect(await fs.mkdirp("/data/new")).toEqual({ ok: true, value: undefined });
		expect(await fs.trash("/data/old")).toEqual({ ok: true, value: undefined });
		expect(await fs.writeTextAtomic(file.path, "new")).toEqual({ ok: true, value: undefined });
		expect(fs.paths).toBe(paths);

		expect(calls).toContainEqual({
			command: COMMANDS.fsReadText,
			args: { path: file.path },
		});
		expect(calls).toContainEqual({
			command: COMMANDS.fsWriteTextAtomic,
			args: { path: file.path, text: "new" },
		});
		expect(calls).toContainEqual({
			command: COMMANDS.fsReadDir,
			args: { path: "/data" },
		});
		expect(calls).toContainEqual({
			command: COMMANDS.fsTrash,
			args: { path: "/data/old" },
		});
	});
});

describe("PLAT-02 Tauri dialogs, opener and clipboard", () => {
	it("PLAT-02 passes dialog arguments to the plugin and maps a cancel", async () => {
		const calls: unknown[][] = [];
		const answers: (string | string[] | null)[] = ["/picked/folder", ["/a.txt", "/b.txt"], null];
		const bindings: TauriBindings = {
			invoke: async <T>(): Promise<T> => undefined as T,
			listen: async () => () => {},
			dialog: {
				open: async (options) => {
					calls.push(["open", options]);
					return answers.shift() ?? null;
				},
				save: async (options) => {
					calls.push(["save", options]);
					return "/saved.txt";
				},
				ask: async (message, options) => {
					calls.push(["ask", message, options]);
					return true;
				},
			},
		};
		const dialogs = createTauriDialogs(bindings);

		expect(await dialogs.pickFolder({ title: "Pick", defaultPath: "/start" })).toBe(
			"/picked/folder",
		);
		expect(await dialogs.pickFiles({ title: "Files", multiple: true })).toEqual([
			"/a.txt",
			"/b.txt",
		]);
		expect(await dialogs.pickFolder({ title: "Pick again" })).toBeNull();
		expect(await dialogs.pickSavePath({ title: "Save", defaultPath: "/x" })).toBe("/saved.txt");
		expect(await dialogs.confirm({ title: "Confirm", message: "Continue?", okLabel: "Yes" })).toBe(
			true,
		);

		expect(calls).toEqual([
			["open", { title: "Pick", defaultPath: "/start", directory: true, multiple: false }],
			["open", { title: "Files", directory: false, multiple: true }],
			["open", { title: "Pick again", directory: true, multiple: false }],
			["save", { title: "Save", defaultPath: "/x" }],
			["ask", "Continue?", { title: "Confirm", okLabel: "Yes" }],
		]);
	});

	it("PLAT-02 passes the URL and clipboard data to their plugins", async () => {
		const opened: string[] = [];
		const texts: string[] = [];
		const images: Uint8Array[] = [];
		const bindings: TauriBindings = {
			invoke: async <T>(): Promise<T> => undefined as T,
			listen: async () => () => {},
			opener: { openUrl: async (url) => void opened.push(url) },
			clipboard: {
				writeText: async (text) => void texts.push(text),
				writeImage: async (image) => void images.push(image),
			},
		};

		await createTauriOpener(bindings).openUrl("https://example.com");
		const clipboard = createTauriClipboard(bindings);
		await clipboard.writeText("copied text");
		const pngBytes = new Uint8Array([137, 80, 78, 71]);
		await clipboard.writeImage(pngBytes);

		expect(opened).toEqual(["https://example.com"]);
		expect(texts).toEqual(["copied text"]);
		expect(images).toEqual([pngBytes]);
	});
});

describe("PLAT-02 Tauri app info", () => {
	it("PLAT-02 calls app_quit and listens for app://quit-requested", async () => {
		const calls: string[] = [];
		const listeners = new Map<string, (payload: unknown) => void>();
		const bindings: TauriBindings = {
			invoke: async <T>(command: string): Promise<T> => {
				calls.push(command);
				return undefined as T;
			},
			listen: async <T>(event: string, handler: (payload: T) => void) => {
				listeners.set(event, handler as (payload: unknown) => void);
				return () => {
					listeners.delete(event);
				};
			},
		};
		const app = createTauriAppInfo(bindings, { version: "0.1.0", channel: "dev" });

		let quitRequests = 0;
		const unsubscribe = app.onQuitRequested(() => {
			quitRequests++;
		});
		await Promise.resolve();
		await Promise.resolve();

		listeners.get(EVENTS.quitRequested)?.({});
		expect(quitRequests).toBe(1);

		unsubscribe();
		expect(listeners.has(EVENTS.quitRequested)).toBe(false);
		expect(quitRequests).toBe(1);

		await app.quit();
		expect(calls).toEqual([COMMANDS.appQuit]);
		expect(app.version).toBe("0.1.0");
		expect(app.channel).toBe("dev");
	});
});

describe("PLAT-02 Tauri database", () => {
	it("PLAT-02 opens conducted.db in WAL with foreign keys on", async () => {
		const loaded: string[] = [];
		const statements: string[] = [];
		const raw = fakeSql({
			execute: async (sql) => {
				statements.push(sql);
				return { rowsAffected: 0 };
			},
		});
		const result = await createTauriDatabase({
			sql: {
				load: async (path) => {
					loaded.push(path);
					return raw;
				},
			},
		});

		expect(result.ok).toBe(true);
		expect(loaded).toEqual(["sqlite:conducted.db"]);
		expect(statements).toEqual(["PRAGMA journal_mode = WAL", "PRAGMA foreign_keys = ON"]);
	});

	it("PLAT-02 turns a plugin load rejection into an Err", async () => {
		const result = await createTauriDatabase({
			sql: {
				load: async () => {
					throw { code: "sql_load_failed", message: "the database is locked" };
				},
			},
		});

		expect(result).toEqual({
			ok: false,
			error: { code: "sql_load_failed", message: "the database is locked" },
		});
	});

	it("PLAT-02 merges identical concurrent select calls", async () => {
		let selects = 0;
		let release: (rows: { name: string }[]) => void = () => {};
		const waiting = new Promise<{ name: string }[]>((resolve) => {
			release = resolve;
		});
		const raw = fakeSql({
			select: async <Rows>(): Promise<Rows> => {
				selects++;
				return (await waiting) as unknown as Rows;
			},
		});
		const result = await createTauriDatabase({ sql: { load: async () => raw } });
		if (!result.ok) throw new Error("the database did not open");

		const first = result.value.select<{ name: string }>("SELECT name FROM t WHERE id = $1", [1]);
		const second = result.value.select<{ name: string }>("SELECT name FROM t WHERE id = $1", [1]);
		await Promise.resolve();
		expect(selects).toBe(1);

		release([{ name: "one" }]);
		await expect(first).resolves.toEqual([{ name: "one" }]);
		await expect(second).resolves.toEqual([{ name: "one" }]);
	});

	it("PLAT-02 logs a SQLite call that reaches the slow threshold", async () => {
		const logs: { level: string; message: string; data: unknown }[] = [];
		const result = await createTauriDatabase(
			{ sql: { load: async () => fakeSql() } },
			{
				slowMs: 0,
				log: (level, message, data) => {
					logs.push({ level, message, data });
				},
			},
		);
		if (!result.ok) throw new Error("the database did not open");

		await result.value.select("SELECT 1");

		expect(logs).toContainEqual({
			level: "warn",
			message: "Slow SQLite call",
			data: { sql: "SELECT 1", elapsedMs: expect.any(Number) },
		});
	});

	it("PLAT-02 runs a transaction as BEGIN IMMEDIATE then COMMIT", async () => {
		const statements: string[] = [];
		const raw = fakeSql({
			execute: async (sql) => {
				statements.push(sql);
				return { rowsAffected: 0 };
			},
		});
		const result = await createTauriDatabase({ sql: { load: async () => raw } });
		if (!result.ok) throw new Error("the database did not open");

		await result.value.transaction(async (tx) => {
			await tx.execute("INSERT INTO t (id) VALUES ($1)", [1]);
		});

		expect(statements).toEqual([
			"PRAGMA journal_mode = WAL",
			"PRAGMA foreign_keys = ON",
			"BEGIN IMMEDIATE",
			"INSERT INTO t (id) VALUES ($1)",
			"COMMIT",
		]);
	});

	it("PLAT-02 rolls back a failed transaction and rethrows its error", async () => {
		const statements: string[] = [];
		const raw = fakeSql({
			execute: async (sql) => {
				statements.push(sql);
				return { rowsAffected: 0 };
			},
		});
		const result = await createTauriDatabase({ sql: { load: async () => raw } });
		if (!result.ok) throw new Error("the database did not open");

		await expect(
			result.value.transaction(async (tx) => {
				await tx.execute("INSERT INTO t (id) VALUES ($1)", [1]);
				throw new Error("contract rollback");
			}),
		).rejects.toThrow("contract rollback");

		expect(statements.slice(-2)).toEqual(["INSERT INTO t (id) VALUES ($1)", "ROLLBACK"]);
	});

	it("PLAT-02 serialises two transactions", async () => {
		const events: string[] = [];
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let started: () => void = () => {};
		const firstStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const raw = fakeSql({
			execute: async () => ({ rowsAffected: 0 }),
		});
		const result = await createTauriDatabase({ sql: { load: async () => raw } });
		if (!result.ok) throw new Error("the database did not open");

		const first = result.value.transaction(async () => {
			events.push("first-start");
			started();
			await gate;
			events.push("first-end");
		});
		await firstStarted;
		const second = result.value.transaction(async () => {
			events.push("second-start");
			events.push("second-end");
		});
		await Promise.resolve();
		expect(events).not.toContain("second-start");

		release();
		await Promise.all([first, second]);
		expect(events.join(",")).toBe("first-start,first-end,second-start,second-end");
	});

	it("PLAT-02 holds statements outside a transaction until it commits", async () => {
		const events: string[] = [];
		let releaseInside: () => void = () => {};
		const inside = new Promise<void>((resolve) => {
			releaseInside = resolve;
		});
		let markStarted: () => void = () => {};
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const raw = fakeSql({
			execute: async (sql) => {
				events.push(sql);
				return { rowsAffected: 0 };
			},
		});
		const result = await createTauriDatabase({ sql: { load: async () => raw } });
		if (!result.ok) throw new Error("the database did not open");

		const transaction = result.value.transaction(async (tx) => {
			markStarted();
			await inside;
			await tx.execute("INSERT INTO t (id) VALUES (1)");
		});
		await started;

		const outside = result.value.execute("INSERT INTO t (id) VALUES (2)");
		await Promise.resolve();
		expect(events).not.toContain("INSERT INTO t (id) VALUES (2)");

		releaseInside();
		await Promise.all([transaction, outside]);
		expect(events).toEqual([
			"PRAGMA journal_mode = WAL",
			"PRAGMA foreign_keys = ON",
			"BEGIN IMMEDIATE",
			"INSERT INTO t (id) VALUES (1)",
			"COMMIT",
			"INSERT INTO t (id) VALUES (2)",
		]);
	});

	it("PLAT-02 does not share an in-flight select across a write", async () => {
		let value = 1;
		let releaseFirst: () => void = () => {};
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let selects = 0;
		const raw = fakeSql({
			execute: async (sql) => {
				if (sql.startsWith("INSERT")) value = 2;
				return { rowsAffected: 1 };
			},
			select: async <Rows>(): Promise<Rows> => {
				selects++;
				if (selects === 1) await firstGate;
				return [{ value }] as unknown as Rows;
			},
		});
		const result = await createTauriDatabase({ sql: { load: async () => raw } });
		if (!result.ok) throw new Error("the database did not open");

		const first = result.value.select<{ value: number }>("SELECT value FROM t");
		const write = result.value.execute("INSERT INTO t (value) VALUES ($1)", [2]);
		const second = result.value.select<{ value: number }>("SELECT value FROM t");

		releaseFirst();
		await write;
		await expect(first).resolves.toEqual([{ value: 1 }]);
		await expect(second).resolves.toEqual([{ value: 2 }]);
	});

	it("PLAT-02 rejects a statement run on a transaction handle after the transaction ended", async () => {
		const statements: string[] = [];
		const raw = fakeSql({
			execute: async (sql) => {
				statements.push(sql);
				return { rowsAffected: 0 };
			},
		});
		const result = await createTauriDatabase({ sql: { load: async () => raw } });
		if (!result.ok) throw new Error("the database did not open");

		let kept: Database | null = null;
		await result.value.transaction(async (tx) => {
			kept = tx;
		});
		const before = statements.length;
		await expect(
			(kept as Database | null)?.execute("INSERT INTO t (id) VALUES (9)"),
		).rejects.toMatchObject({
			code: "transaction_closed",
		});
		await expect((kept as Database | null)?.select("SELECT 1")).rejects.toMatchObject({
			code: "transaction_closed",
		});
		expect(statements.length).toBe(before);
	});

	it("PLAT-02 keeps merging reads after an older select that a write cleared settles", async () => {
		const gates: (() => void)[] = [];
		let rawSelects = 0;
		const raw = fakeSql({
			select: async <Rows>(): Promise<Rows> => {
				rawSelects++;
				await new Promise<void>((resolve) => {
					gates.push(resolve);
				});
				return [] as unknown as Rows;
			},
		});
		const result = await createTauriDatabase({ sql: { load: async () => raw } });
		if (!result.ok) throw new Error("the database did not open");
		const db = result.value;

		const first = db.select("SELECT value FROM t");
		const write = db.execute("INSERT INTO t (value) VALUES (1)");
		const second = db.select("SELECT value FROM t");
		await vi.waitFor(() => expect(gates).toHaveLength(1));
		gates[0]?.();
		await first;
		await write;
		// The first select has settled. The second is still waiting, so a third must join it.
		const third = db.select("SELECT value FROM t");
		await vi.waitFor(() => expect(gates).toHaveLength(2));
		gates[1]?.();
		await Promise.all([second, third]);
		expect(rawSelects).toBe(2);
	});

	it("PLAT-02 refuses a transaction inside a transaction", async () => {
		const statements: string[] = [];
		const raw = fakeSql({
			execute: async (sql) => {
				statements.push(sql);
				return { rowsAffected: 0 };
			},
		});
		const result = await createTauriDatabase({ sql: { load: async () => raw } });
		if (!result.ok) throw new Error("the database did not open");

		await expect(
			result.value.transaction(async (tx) => {
				await tx.transaction(async () => undefined);
			}),
		).rejects.toMatchObject({ code: "transaction_nested" });

		expect(statements).toEqual([
			"PRAGMA journal_mode = WAL",
			"PRAGMA foreign_keys = ON",
			"BEGIN IMMEDIATE",
			"ROLLBACK",
		]);
	});
});

describe("PLAT-02 Tauri Platform build", () => {
	const extra: Partial<TauriBindings> = {
		sql: { load: async () => fakeSql() },
		dialog: {
			open: async () => null,
			save: async () => null,
			ask: async () => false,
		},
		clipboard: { writeText: async () => {}, writeImage: async () => {} },
		opener: { openUrl: async () => {} },
	};

	it("PLAT-02 builds every group after health, app_info and fs_paths", async () => {
		const calls: Call[] = [];
		const bindings = commandBindings((command, args) => {
			calls.push({ command, args });
			switch (command) {
				case COMMANDS.health:
					return "ok";
				case COMMANDS.appInfo:
					return { version: "0.1.0", channel: "dev" };
				case COMMANDS.fsPaths:
					return {
						home: "/Users/me",
						appData: "/data",
						temp: "/tmp",
						resources: "/res",
					};
				default:
					return undefined;
			}
		}, extra);

		const result = await createTauriPlatform(bindings);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(calls.slice(0, 3).map((call) => call.command)).toEqual([
			COMMANDS.health,
			COMMANDS.appInfo,
			COMMANDS.fsPaths,
		]);
		expect(result.value.app.version).toBe("0.1.0");
		expect(result.value.app.channel).toBe("dev");
		expect(result.value.fs.paths).toEqual({
			home: "/Users/me",
			appData: "/data",
			temp: "/tmp",
			resources: "/res",
		});
		expect(Object.keys(result.value).sort()).toEqual(
			[
				"app",
				"db",
				"shell",
				"fs",
				"fileSearch",
				"pty",
				"sidecar",
				"keychain",
				"notifications",
				"dialogs",
				"opener",
				"portForward",
				"clipboard",
				"cloud",
				"speech",
				"updater",
				"window",
				"menu",
				"system",
				"attachments",
				"programs",
				"http",
				"conductorImport",
				"visualizations",
			].sort(),
		);
	});

	it("PLAT-02 stops at the first failed startup call", async () => {
		const calls: string[] = [];
		const bindings = commandBindings((command) => {
			calls.push(command);
			return command === COMMANDS.health ? "nope" : undefined;
		});

		const result = await createTauriPlatform(bindings);

		expect(result).toMatchObject({ ok: false, error: { code: "health_unexpected" } });
		expect(calls).toEqual([COMMANDS.health]);
	});
});
