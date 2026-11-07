import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Push } from "./backend.ts";
import {
	type CallRecord,
	identityMapping,
	type LiveAnswer,
	type LiveMapping,
	OUR_SIDECAR,
	type Ours,
	openLiveSession,
	REFUSED_CODE,
} from "./translator.ts";

/**
 * Our backend as the bridge hands it over: each call by name, answered by a table, every call kept.
 * The translator only sees `invoke`, so this is the whole contract it relies on.
 */
/** The arguments of the nth call to ours; fails the test when there was no such call. */
function argsOf(calls: readonly { args: unknown }[], index: number): Record<string, string> {
	const call = calls[index];
	if (call === undefined) throw new Error(`no call ${index} reached ours`);
	return call.args as Record<string, string>;
}

function backend(answers: Record<string, (args: unknown) => LiveAnswer>) {
	const calls: { command: string; args: unknown }[] = [];
	const ours: Ours = {
		invoke: async (command, args) => {
			calls.push({ command, args });
			const answer = answers[command];
			return answer === undefined
				? { ok: false, error: { code: "unknown_command", message: command } }
				: answer(args);
		},
	};
	return { ours, calls };
}

function open<State>(mapping: LiveMapping<State>, state: State, ours: Ours) {
	const pushed: Push[] = [];
	const records: CallRecord[] = [];
	const session = openLiveSession({
		mapping,
		state,
		ours,
		push: (push) => pushed.push(push),
		record: (record) => records.push(record),
	});
	return { session, pushed, records };
}

const tunnel = { command: "rpc_to_sidecar", lineArg: "line", replyEvent: "rpc_from_sidecar" };

const mapping: LiveMapping<{ home: string }> = {
	commands: {
		get_home: async (_args, context) => {
			const paths = (await context.ours.invoke("fs_paths")) as { home: string };
			return paths.home;
		},
		app_name: (_args, context) => context.decided("D025", "Conductor"),
		set_theme: () => null,
		read: async (args, context) => await context.ours.invoke("fs_read_text", { path: args.path }),
		secret: async (args, context) => await context.ours.invoke("keychain_get", { key: args.key }),
		spawn: async (args, context) => {
			const page = Number(String(args.onData).replace("__CHANNEL__:", ""));
			const channel = context.ours.channel((message) =>
				context.emit("pty-data", { id: args.id, data: message }),
			);
			await context.ours.invoke("pty_spawn", { onOutput: channel });
			context.pageChannel(page, { started: true });
			return null;
		},
		ask: (args, context) => context.decline(`ask ${String(args.what)}`),
	},
	tunnel,
	sidecar: {
		getHarnessVersions: async (_params, context) =>
			await context.ours.sidecar("getAgentInstalls", {}),
	},
	events: {
		"pty://exit": (payload, context) => context.emit("pty-exit", payload),
		[OUR_SIDECAR.lineEvent]: async (payload, context) => {
			const message = JSON.parse(String(payload)) as {
				id?: number;
				method?: string;
				params?: unknown;
			};
			if (message.method === "requestInteraction") {
				const answer = await context.sidecarRequest("toolApproval", message.params);
				await context.ours.sidecarReply(message.id ?? 0, { result: answer.result });
			}
		},
	},
	listens: {
		"pty-exit": "pty://exit",
		"deep-link://new-url": null,
		open_best_practices_url: { decided: "D025" },
	},
};

/** Lets queued work run until `done` holds; a bounded number of turns, never a fixed time. */
async function until(done: () => boolean): Promise<void> {
	for (let turn = 0; turn < 100 && !done(); turn++) await Bun.sleep(0);
}

const okFor = (value: unknown) => () => ({ ok: true as const, value });

describe("openLiveSession", () => {
	test("answers a command through ours and records which of ours answered it", async () => {
		const { ours, calls } = backend({ fs_paths: okFor({ home: "/tmp/h" }) });
		const { session, records } = open(mapping, { home: "/tmp/h" }, ours);
		expect(await session.invoke("get_home", {})).toEqual({ ok: true, value: "/tmp/h" });
		expect(calls).toEqual([{ command: "fs_paths", args: {} }]);
		expect(records).toEqual([
			{ kind: "command", name: "get_home", outcome: "answered", via: ["fs_paths"] },
		]);
	});

	test("keeps apart what ours answered, what a decision answers and what the translator alone answers", async () => {
		const { ours } = backend({});
		const { session, records } = open(mapping, { home: "" }, ours);
		expect(await session.invoke("app_name", {})).toEqual({ ok: true, value: "Conductor" });
		expect(await session.invoke("set_theme", {})).toEqual({ ok: true, value: null });
		expect(records.map((record) => [record.name, record.outcome, record.decision])).toEqual([
			["app_name", "decided", "D025"],
			["set_theme", "translator", undefined],
		]);
	});

	test("passes our error on as it is, and records the call as failed with its message", async () => {
		const { ours } = backend({
			fs_read_text: () => ({ ok: false, error: { code: "fs_not_found", message: "no such file" } }),
		});
		const { session, records } = open(mapping, { home: "" }, ours);
		expect(await session.invoke("read", { path: "/x" })).toEqual({
			ok: false,
			error: { code: "fs_not_found", message: "no such file" },
		});
		expect(records).toEqual([
			{
				kind: "command",
				name: "read",
				outcome: "failed",
				detail: "fs_read_text: no such file",
				via: ["fs_read_text"],
			},
		]);
	});

	test("records a call the host refuses, one with no counterpart and one declined, as refused", async () => {
		const { ours } = backend({
			keychain_get: () => ({
				ok: false,
				error: { code: REFUSED_CODE, message: "the owner's keychain" },
			}),
		});
		const { session, records } = open(mapping, { home: "" }, ours);
		expect((await session.invoke("secret", { key: "k" })).ok).toBe(false);
		expect((await session.invoke("crash_rust", {})).ok).toBe(false);
		expect((await session.invoke("ask", { what: "x" })).ok).toBe(false);
		expect(records.map((record) => [record.name, record.outcome, record.detail])).toEqual([
			["secret", "refused", "keychain_get: the owner's keychain"],
			["crash_rust", "refused", "no counterpart in our backend"],
			["ask", "refused", "ask x"],
		]);
	});

	test("routes our channel's messages to the handler and the page's channel to the page", async () => {
		const { ours, calls } = backend({ pty_spawn: okFor(null) });
		const { session, pushed } = open(mapping, { home: "" }, ours);
		await session.invoke("spawn", { id: "t1", onData: "__CHANNEL__:7" });
		const ourChannel = Number(String(argsOf(calls, 0).onOutput).split(":")[1]);
		session.ourChannel(ourChannel, { index: 0, message: [104, 105] });
		expect(pushed).toEqual([
			{ kind: "channel", channel: 7, message: { started: true } },
			{
				kind: "event",
				event: "pty-data",
				payload: { id: "t1", data: { index: 0, message: [104, 105] } },
			},
		]);
	});

	test("asks our sidecar through our send command and answers the page's request with its reply", async () => {
		const { ours, calls } = backend({ [OUR_SIDECAR.send]: okFor(null) });
		const { session, pushed, records } = open(mapping, { home: "" }, ours);
		await session.invoke("rpc_to_sidecar", {
			line: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "getHarnessVersions", params: {} }),
		});
		await until(() => calls.length > 0);
		const sent = JSON.parse(String(argsOf(calls, 0).line)) as { id: string };
		expect(calls[0]?.command).toBe("sidecar_send");
		session.ourEvent(
			OUR_SIDECAR.lineEvent,
			JSON.stringify({ jsonrpc: "2.0", id: sent.id, result: { agents: [] } }),
		);
		await until(() => pushed.length > 0);
		expect(pushed).toEqual([
			{
				kind: "event",
				event: "rpc_from_sidecar",
				payload: { line: JSON.stringify({ jsonrpc: "2.0", id: 4, result: { agents: [] } }) },
			},
		]);
		expect(records).toEqual([
			{
				kind: "sidecar",
				name: "getHarnessVersions",
				outcome: "answered",
				via: ["sidecar:getAgentInstalls"],
			},
		]);
	});

	test("hands our sidecar's request to the page and sends the page's answer back to our sidecar", async () => {
		const { ours, calls } = backend({ [OUR_SIDECAR.send]: okFor(null) });
		const { session, pushed } = open(mapping, { home: "" }, ours);
		session.ourEvent(
			OUR_SIDECAR.lineEvent,
			JSON.stringify({
				jsonrpc: "2.0",
				id: 9,
				method: "requestInteraction",
				params: { tool: "Bash" },
			}),
		);
		await until(() => pushed.length > 0);
		const asked = JSON.parse(String((pushed[0] as { payload: { line: string } }).payload.line)) as {
			id: number;
			method: string;
		};
		expect(asked.method).toBe("toolApproval");
		await session.invoke("rpc_to_sidecar", {
			line: JSON.stringify({ jsonrpc: "2.0", id: asked.id, result: { decision: "allow" } }),
		});
		await until(() => calls.length > 0);
		expect(JSON.parse(String(argsOf(calls, 0).line))).toEqual({
			jsonrpc: "2.0",
			id: 9,
			result: { decision: "allow" },
		});
	});

	test("records each event the page listens to as answered by ours, or refused", () => {
		const { ours } = backend({});
		const { session, records } = open(mapping, { home: "" }, ours);
		session.listen("pty-exit");
		session.listen("deep-link://new-url");
		session.listen("open_settings_page");
		session.listen("open_best_practices_url");
		expect(
			records.map((record) => [record.name, record.outcome, record.via, record.decision]),
		).toEqual([
			["pty-exit", "answered", ["pty://exit"], undefined],
			["deep-link://new-url", "refused", [], undefined],
			["open_settings_page", "refused", [], undefined],
			["open_best_practices_url", "decided", [], "D025"],
		]);
	});
});

describe("OUR_SIDECAR", () => {
	test("names the sidecar command and event our platform uses", () => {
		const platform = readFileSync(
			join(import.meta.dir, "../../apps/desktop/src/platform/tauri.ts"),
			"utf8",
		);
		const named = (key: string): string | undefined =>
			new RegExp(`\\b${key}: "([^"]+)"`).exec(platform)?.[1];
		expect([OUR_SIDECAR.send, OUR_SIDECAR.lineEvent]).toEqual([
			named("sidecarSend") ?? "(none)",
			named("sidecarLine") ?? "(none)",
		]);
	});
});

describe("identityMapping", () => {
	test("forwards every command and event unchanged, so our own UI runs on the same backend", async () => {
		const { ours, calls } = backend({ health: okFor("ok") });
		const { session, pushed, records } = open(identityMapping(), {}, ours);
		expect(await session.invoke("health", { a: 1 })).toEqual({ ok: true, value: "ok" });
		session.ourEvent("sidecar://line", "{}");
		expect(calls).toEqual([{ command: "health", args: { a: 1 } }]);
		expect(pushed).toEqual([{ kind: "event", event: "sidecar://line", payload: "{}" }]);
		expect(records).toEqual([
			{ kind: "command", name: "health", outcome: "answered", via: ["health"] },
		]);
	});
});
