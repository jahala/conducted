import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plainError, rewriteChannels } from "./bridge.ts";
import { hostRefusal, type LiveServer, startLiveServer } from "./live-server.ts";
import { identityMapping, REFUSED_CODE } from "./translator.ts";

const INDEX = `<!doctype html><html><head><script type="module" src="/assets/app.js"></script></head><body></body></html>`;

let dir: string;
let server: LiveServer;

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), "live-server-"));
	for (const front of ["conductor", "ours"]) {
		mkdirSync(join(dir, front, "assets"), { recursive: true });
		writeFileSync(join(dir, front, "index.html"), INDEX);
		writeFileSync(join(dir, front, "assets/app.js"), `export const front = "${front}";\n`);
	}
	server = await startLiveServer({
		bundles: { conductor: join(dir, "conductor"), ours: join(dir, "ours") },
		port: 0,
	});
});

afterAll(async () => {
	await server?.stop();
	rmSync(dir, { recursive: true, force: true });
});

/**
 * The bridge's side of the protocol, as bridge.ts speaks it: read jobs from the stream, answer each.
 * Our real app is not in a unit test, so this answers the jobs it is told to, and keeps what it saw.
 */
async function bridgeClient(answer: (job: { command: string; args: unknown }) => unknown) {
	const seen: { command?: string; args?: unknown; listen?: string }[] = [];
	const response = await fetch(`${server.url}/__reference/bridge/jobs`);
	const reader = response.body?.getReader();
	if (reader === undefined) throw new Error("no job stream");
	const decoder = new TextDecoder();
	let buffered = "";
	const pump = async (): Promise<void> => {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return;
			buffered += decoder.decode(value, { stream: true });
			let newline = buffered.indexOf("\n");
			while (newline !== -1) {
				const job = JSON.parse(buffered.slice(0, newline)) as {
					job?: number;
					command?: string;
					args?: unknown;
					listen?: string;
				};
				buffered = buffered.slice(newline + 1);
				seen.push(job);
				if (job.job !== undefined) {
					await fetch(`${server.url}/__reference/bridge/done`, {
						method: "POST",
						body: JSON.stringify({
							job: job.job,
							ok: true,
							value: answer({ command: job.command ?? "", args: job.args }),
						}),
					});
				}
				newline = buffered.indexOf("\n");
			}
		}
	};
	// The stream ends when the test stops reading or the server stops; either ends the pump.
	const pumping = pump().catch((cause: unknown) => cause);
	return {
		seen,
		stop: async () => {
			await reader.cancel();
			await pumping;
		},
	};
}

describe("hostRefusal", () => {
	test("refuses what reaches past the scratch folder and lets the rest through", () => {
		for (const command of [
			"keychain_get",
			"keychain_set",
			"plugin:clipboard-manager|read_text",
			"clipboard_read_file_paths",
			"plugin:dialog|open",
			"notify",
			"plugin:opener|open_url",
			"open_with",
			"reveal_in_finder",
			"full_disk_access_open_settings",
			"speech_start",
			"app_quit",
			"updater_install",
			"updater_relaunch",
			"window_toggle_inspector",
		]) {
			expect([command, hostRefusal(command) !== null]).toEqual([command, true]);
		}
		for (const command of ["shell_run", "fs_read_text", "plugin:sql|select", "sidecar_send"]) {
			expect([command, hostRefusal(command)]).toEqual([command, null]);
		}
	});
});

describe("startLiveServer", () => {
	test("a page's call reaches the bridge and comes back with the bridge's answer", async () => {
		server.prepare({
			state: "home",
			front: "ours",
			route: "/all-workspaces",
			mapping: identityMapping(),
			context: {},
			globals: { isTauri: true },
		});
		const bridge = await bridgeClient(({ command }) => (command === "health" ? "ok" : null));
		await server.bridged();
		const opened = await fetch(`${server.url}/__reference/open/home?front=ours`, {
			redirect: "manual",
		});
		expect(opened.headers.get("location")).toBe("/all-workspaces");
		const cookie = (opened.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
		const page = await (
			await fetch(`${server.url}/all-workspaces`, { headers: { cookie } })
		).text();
		const session = /"session":"([^"]+)"/.exec(page)?.[1] ?? "";
		expect(page.indexOf("/__reference/standin.js")).toBeLessThan(page.indexOf('type="module"'));

		const answer = await fetch(`${server.url}/__reference/invoke`, {
			method: "POST",
			headers: { "x-reference-session": session },
			body: JSON.stringify({ command: "health", args: {} }),
		});
		expect(await answer.json()).toEqual({ ok: true, value: "ok" });

		const refused = await fetch(`${server.url}/__reference/invoke`, {
			method: "POST",
			headers: { "x-reference-session": session },
			body: JSON.stringify({ command: "keychain_get", args: { key: "github_token" } }),
		});
		expect(await refused.json()).toEqual({
			ok: false,
			error: {
				code: REFUSED_CODE,
				message: "the live run never reads or writes the owner's keychain (key github_token)",
			},
		});
		// The refused call never reached the bridge; every event of ours was listened to.
		expect(
			bridge.seen.filter((job) => job.command !== undefined).map((job) => job.command),
		).toEqual(["health"]);
		expect(bridge.seen.some((job) => job.listen === "sidecar://line")).toBe(true);
		expect(server.calls().map((call) => [call.front, call.name, call.outcome, call.count])).toEqual(
			[
				["ours", "health", "answered", 1],
				["ours", "keychain_get", "refused", 1],
			],
		);
		await bridge.stop();
		server.resetBridge();
	});
});

describe("the bridge page's own logic", () => {
	test("each channel of the page becomes one of the bridge's, wherever it sits in the arguments", () => {
		const made: number[] = [];
		const rewritten = rewriteChannels(
			{ request: { onOutput: "__CHANNEL__:3", label: "__CHANNEL__:x" }, list: ["__CHANNEL__:4"] },
			(n) => {
				made.push(n);
				return `__CHANNEL__:${n + 100}`;
			},
		);
		expect(rewritten).toEqual({
			request: { onOutput: "__CHANNEL__:103", label: "__CHANNEL__:x" },
			list: ["__CHANNEL__:104"],
		});
		expect(made).toEqual([3, 4]);
	});

	test("an error goes back as plain JSON, as Tauri rejected with it", () => {
		expect(plainError({ code: "fs_not_found", message: "gone" })).toEqual({
			code: "fs_not_found",
			message: "gone",
		});
		expect(plainError("unknown path")).toBe("unknown path");
		expect(plainError(new Error("boom"))).toEqual({ code: "bridge_error", message: "boom" });
	});
});
