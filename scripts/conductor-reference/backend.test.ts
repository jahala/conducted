import { beforeAll, describe, expect, test } from "bun:test";
import { openSession, type Push, type ReferenceMapping, UnansweredLog } from "./backend.ts";
import { buildDatabase } from "./sql-plugin.ts";
import { loadSqlJs, type SqlJsStatic } from "./sqljs-types.ts";

let SQL: SqlJsStatic;
beforeAll(async () => {
	SQL = await loadSqlJs();
});

interface Sample {
	home: string;
}

const mapping: ReferenceMapping<Sample> = {
	route: () => "/",
	databases: () => [],
	boot: () => ({ windowLabel: "main", webviewLabel: "main", globals: {} }),
	commands: {
		get_home: (_args, context) => context.state.home,
		quit: () => undefined,
		broken: () => {
			throw new Error("the disk is gone");
		},
		watch: (args, context) => {
			const channel = Number(String(args.onEvent).replace("__CHANNEL__:", ""));
			context.send(channel, "first");
			context.send(channel, "second");
			return null;
		},
	},
	tunnel: { command: "rpc_send", lineArg: "line", replyEvent: "rpc_reply" },
	sidecar: {
		ping: (params) => ({ pong: params }),
		started: (_params, context) => context.sidecarSend("welcome", { hello: true }),
		fails: () => {
			throw new Error("no agent");
		},
	},
};

function session() {
	const pushed: Push[] = [];
	const log = new UnansweredLog();
	const backend = openSession({
		SQL,
		mapping,
		state: { home: "/Users/sam" },
		databases: [
			{
				name: "sqlite:t.db",
				bytes: buildDatabase(SQL, { name: "sqlite:t.db", schema: "CREATE TABLE t (a TEXT)" }),
			},
		],
		log,
		push: (push) => pushed.push(push),
	});
	const lines = () =>
		pushed.map((push) =>
			push.kind === "event" ? JSON.parse((push.payload as { line: string }).line) : push,
		);
	return { backend, pushed, log, lines };
}

describe("a reference backend session", () => {
	test("answers mapped commands, and a handler with no value answers null", async () => {
		const { backend } = session();
		expect(await backend.invoke("get_home", {})).toEqual({ ok: true, value: "/Users/sam" });
		expect(await backend.invoke("quit", {})).toEqual({ ok: true, value: null });
		backend.close();
	});

	test("logs an unanswered command with its arguments and answers it with an error", async () => {
		const { backend, log } = session();
		const answer = await backend.invoke("open_window", { label: "x" });
		await backend.invoke("open_window", { label: "y" });
		expect(answer).toEqual({
			ok: false,
			error: "The reference backend does not answer open_window.",
		});
		expect(log.list()).toEqual([
			{ kind: "command", name: "open_window", count: 2, firstArgs: { label: "x" } },
		]);
		backend.close();
	});

	test("answers a throwing handler with its message", async () => {
		const { backend } = session();
		expect(await backend.invoke("broken", {})).toEqual({ ok: false, error: "the disk is gone" });
		backend.close();
	});

	test("runs the SQL plugin against the session's own database", async () => {
		const { backend } = session();
		await backend.invoke("plugin:sql|execute", {
			db: "sqlite:t.db",
			query: "INSERT INTO t (a) VALUES (?)",
			values: ["x"],
		});
		expect(
			await backend.invoke("plugin:sql|select", { db: "sqlite:t.db", query: "SELECT a FROM t" }),
		).toEqual({ ok: true, value: [{ a: "x" }] });
		backend.close();
	});

	test("answers tunnel requests on the reply event, and errors for methods nobody answers", async () => {
		const { backend, lines, log } = session();
		const send = (message: object) =>
			backend.invoke("rpc_send", { line: JSON.stringify({ jsonrpc: "2.0", ...message }) });
		await send({ id: 1, method: "ping", params: 3 });
		await send({ id: 2, method: "unknown", params: {} });
		await send({ id: 3, method: "fails" });
		await send({ method: "started" });
		await send({ method: "silent", params: { a: 1 } });
		expect(lines()).toEqual([
			{ jsonrpc: "2.0", id: 1, result: { pong: 3 } },
			{
				jsonrpc: "2.0",
				id: 2,
				error: { code: -32601, message: "The reference sidecar does not answer unknown." },
			},
			{ jsonrpc: "2.0", id: 3, error: { code: -32000, message: "no agent" } },
			{ jsonrpc: "2.0", id: 1, method: "welcome", params: { hello: true } },
		]);
		expect(log.list().map((entry) => entry.name)).toEqual(["silent", "unknown"]);
		backend.close();
	});

	test("numbers channel messages in order and echoes frontend emits", async () => {
		const { backend, pushed } = session();
		await backend.invoke("watch", { onEvent: "__CHANNEL__:7" });
		await backend.invoke("plugin:event|emit", { event: "theme", payload: "dark" });
		expect(pushed).toEqual([
			{ kind: "channel", channel: 7, message: { index: 0, message: "first" } },
			{ kind: "channel", channel: 7, message: { index: 1, message: "second" } },
			{ kind: "event", event: "theme", payload: "dark" },
		]);
		backend.close();
	});
});
