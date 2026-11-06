import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReferenceMapping } from "./backend.ts";
import { type Catalogue, loadCatalogue, type SeededState } from "./catalogue.ts";
import {
	CONTENT_POLICY,
	fileUnder,
	injectBefore,
	type ReferenceServer,
	startReferenceServer,
} from "./server.ts";

// A bundle of our own: an index page with one module, and one asset.
const INDEX = `<!doctype html><html><head><script type="module" src="/assets/app-TEST0001.js"></script></head><body></body></html>`;

// A mapping of our own: the catalogue's projects become rows of a one-table schema.
const mapping: ReferenceMapping<SeededState> = {
	route: (state) => (state.id === "first-run" ? null : `/projects/${state.id}`),
	databases: (state) => [
		{
			name: "sqlite:projects.db",
			schema: "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT)",
			rows: {
				projects: (state.tables.repos ?? []).map((repo) => ({ id: repo.id, name: repo.name })),
			},
		},
	],
	boot: () => ({
		windowLabel: "main",
		webviewLabel: "main",
		globals: { __TEST_OS__: { platform: "macos" } },
	}),
	commands: { get_home: () => "/Users/sam" },
	tunnel: { command: "rpc_send", lineArg: "line", replyEvent: "rpc_reply" },
	sidecar: { ping: () => "pong" },
};

let dir: string;
let catalogue: Catalogue;
let server: ReferenceServer;

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), "reference-server-"));
	mkdirSync(join(dir, "assets"));
	writeFileSync(join(dir, "index.html"), INDEX);
	writeFileSync(join(dir, "assets/app-TEST0001.js"), "export {};\n");
	catalogue = await loadCatalogue();
	server = await startReferenceServer({ bundleDir: dir, mapping, catalogue });
});

afterAll(async () => {
	await server?.stop();
	rmSync(dir, { recursive: true, force: true });
});

const get = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init);

/** Opens a state and returns the page's HTML, the cookie that names the state, and the boot data. */
async function openPage(state: string) {
	const opened = await get(`/__reference/open/${state}`, { redirect: "manual" });
	const cookie = (opened.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
	const location = opened.headers.get("location") ?? "";
	const page = await get(location, { headers: { cookie } });
	const html = await page.text();
	const boot = JSON.parse(/window\.__REFERENCE_BOOT__=(.*?);<\/script>/.exec(html)?.[1] ?? "null");
	return { opened, location, page, html, boot, cookie };
}

describe("the reference server", () => {
	test("binds 127.0.0.1 on the port it reports", () => {
		expect(server.url).toBe(`http://127.0.0.1:${server.port}/`);
	});

	test("opens a state at its mapped route, with the stand-in before the page's module", async () => {
		const { opened, location, page, html } = await openPage("sidebar");
		expect(opened.status).toBe(302);
		expect(location).toBe("/projects/sidebar");
		expect(page.headers.get("content-security-policy")).toBe(CONTENT_POLICY);
		const standin = html.indexOf("/__reference/standin.js");
		expect(standin).toBeGreaterThan(-1);
		expect(standin).toBeLessThan(html.indexOf('type="module"'));
	});

	test("says so when the mapping has no screen for a state", async () => {
		const opened = await get("/__reference/open/first-run", { redirect: "manual" });
		expect(opened.status).toBe(404);
		expect(await opened.text()).toBe("The reference has no screen for first-run.");
	});

	test("serves the bundle's files and nothing outside the folder", async () => {
		expect(await (await get("/assets/app-TEST0001.js")).text()).toBe("export {};\n");
		expect((await get("/assets/missing-TEST0002.js")).status).toBe(404);
		expect(fileUnder(dir, "/../outside.txt")).toBeNull();
		expect(fileUnder(dir, "/%2e%2e/outside.txt")).toBeNull();
	});

	test("the served stand-in answers SQL from the state's rows, commands, events and the tunnel", async () => {
		const { boot, cookie } = await openPage("sidebar");
		const script = await (await get("/__reference/standin.js")).text();
		const errors: unknown[] = [];
		const host: Record<string, unknown> = {
			__REFERENCE_BOOT__: boot,
			console: { error: (...args: unknown[]) => errors.push(args) },
			fetch: (path: string, init?: RequestInit) =>
				get(path, { ...init, headers: { ...(init?.headers as Record<string, string>), cookie } }),
		};
		new Function("window", script)(host);
		const internals = host.__TAURI_INTERNALS__ as {
			invoke(command: string, args?: object): Promise<unknown>;
			transformCallback(callback: (payload: unknown) => void): number;
			metadata: unknown;
		};
		expect(internals.metadata).toEqual({
			currentWindow: { label: "main" },
			currentWebview: { windowLabel: "main", label: "main" },
		});
		expect(host.__TEST_OS__).toEqual({ platform: "macos" });

		const rows = await internals.invoke("plugin:sql|select", {
			db: "sqlite:projects.db",
			query: "SELECT name FROM projects ORDER BY name",
		});
		expect(rows).toEqual([{ name: "atlas" }, { name: "relay" }]);
		expect(await internals.invoke("get_home")).toBe("/Users/sam");
		await expect(internals.invoke("open_window", { label: "x" })).rejects.toBe(
			"The reference backend does not answer open_window.",
		);

		const reply = new Promise<unknown>((resolve) => {
			const handler = internals.transformCallback((event) => resolve(event));
			void internals.invoke("plugin:event|listen", { event: "rpc_reply", handler });
		});
		await internals.invoke("rpc_send", {
			line: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" }),
		});
		expect(await reply).toMatchObject({
			event: "rpc_reply",
			payload: { line: JSON.stringify({ jsonrpc: "2.0", id: 9, result: "pong" }) },
		});

		const log = (await (await get("/__reference/log")).json()) as Record<
			string,
			{ unanswered: unknown[] }
		>;
		expect(log.sidebar?.unanswered).toEqual([
			{ kind: "command", name: "open_window", count: 1, firstArgs: { label: "x" } },
		]);
		expect(errors).toEqual([]);
	});
});

describe("injectBefore", () => {
	test("puts the stand-in before the first module script, or before </head>", () => {
		expect(injectBefore('<head><script type="module" src="a.js"></script>', "<x>")).toBe(
			'<head><x><script type="module" src="a.js"></script>',
		);
		expect(injectBefore("<head></head>", "<x>")).toBe("<head><x></head>");
	});
});
