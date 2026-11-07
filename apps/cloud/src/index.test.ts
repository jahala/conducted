/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Tests the Worker's front door inside Cloudflare's local runtime: the pairing token is checked
 * before any Durable Object, and each route answers the right refusal for a bad name, method or
 * body. The state route reads a real Durable Object's storage without a container.
 */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { WorkspaceState } from "./workspace.ts";

const BASE = "https://cloud.test";
const AUTH = { authorization: "Bearer test-pairing-token" };

const get = (path: string, headers: Record<string, string> = AUTH): Promise<Response> =>
	SELF.fetch(`${BASE}${path}`, { headers });

const post = (
	path: string,
	body: unknown,
	headers: Record<string, string> = AUTH,
): Promise<Response> =>
	SELF.fetch(`${BASE}${path}`, {
		method: "POST",
		headers: { ...headers, "content-type": "application/json" },
		body: JSON.stringify(body),
	});

describe("CLOUD-03 the Worker's front door", () => {
	it("refuses every route without the pairing token", async () => {
		expect((await get("/w/ws1/state", {})).status).toBe(401);
		expect((await get("/w/ws1/state", { authorization: "Bearer wrong" })).status).toBe(401);
		expect((await get("/w/ws1/state", { authorization: "test-pairing-token" })).status).toBe(401);
		expect((await post("/w/ws1/start", {}, {})).status).toBe(401);
		expect((await post("/w/ws1/git", { args: [], cwd: "/workspace" }, {})).status).toBe(401);
	});

	it("answers an unknown route with 404 and a bad workspace name with 400", async () => {
		expect((await get("/nope")).status).toBe(404);
		expect((await get("/w/Bad_Name/state")).status).toBe(400);
		expect((await get("/w/ws1/restart")).status).toBe(404);
	});

	it("refuses the wrong method and says which one is allowed", async () => {
		const response = await get("/w/ws1/git");
		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("POST");
	});

	it("refuses a body a route does not accept", async () => {
		expect((await post("/w/ws1/git", { args: ["status"], cwd: "relative" })).status).toBe(400);
		expect((await post("/w/ws1/exec", { program: "", args: [], cwd: "/workspace" })).status).toBe(
			400,
		);
		expect((await post("/w/ws1/files", { operation: "read", path: "README.md" })).status).toBe(400);
	});

	it("refuses a relay request that is not a WebSocket", async () => {
		expect((await get("/w/ws1/rpc")).status).toBe(426);
	});

	it("answers state from the workspace's Durable Object", async () => {
		const response = await get("/w/state-test/state");
		expect(response.status).toBe(200);
		const state = (await response.json()) as WorkspaceState;
		expect(state).toEqual({
			running: false,
			turnActive: false,
			alarmAt: null,
			instance: "basic",
			backups: [],
		});
	});
});
