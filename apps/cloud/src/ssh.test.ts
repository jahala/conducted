/**
 * @feature CLOUD-12 SSH into a cloud workspace and open it in a local editor
 * Tests the Worker's SSH door: the pairing token is checked before a Durable Object, the tunnel
 * must be a WebSocket (the sandbox image's SSH port is its only target), the key route accepts
 * only a public key, and an open SSH session keeps the keep-alive alarm set (D119).
 * Test first: `/w/ws1/ssh` without an upgrade is 426, and an SSH session sets the alarm.
 */
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const BASE = "https://cloud.test";
const AUTH = { authorization: "Bearer test-pairing-token" };
const UPGRADE = { ...AUTH, upgrade: "websocket" };

describe("CLOUD-12 the Worker's SSH door", () => {
	it("checks the pairing token before any Durable Object", async () => {
		expect(
			(await SELF.fetch(`${BASE}/w/ws1/ssh`, { headers: { upgrade: "websocket" } })).status,
		).toBe(401);
		expect(
			(
				await SELF.fetch(`${BASE}/w/ws1/ssh-key`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ publicKey: "ssh-ed25519 AAAA test" }),
				})
			).status,
		).toBe(401);
	});

	it("refuses an SSH tunnel that is not a WebSocket", async () => {
		expect((await SELF.fetch(`${BASE}/w/ws1/ssh`, { headers: AUTH })).status).toBe(426);
	});

	it("answers 503 when the workspace has no container configured", async () => {
		expect((await SELF.fetch(`${BASE}/w/ws1/ssh`, { headers: UPGRADE })).status).toBe(503);
	});

	it("refuses a key route with the wrong method or a body that is not a public key", async () => {
		const wrongMethod = await SELF.fetch(`${BASE}/w/ws1/ssh-key`, { headers: AUTH });
		expect(wrongMethod.status).toBe(405);
		expect(wrongMethod.headers.get("allow")).toBe("POST");

		const bad = await SELF.fetch(`${BASE}/w/ws1/ssh-key`, {
			method: "POST",
			headers: { ...AUTH, "content-type": "application/json" },
			body: JSON.stringify({ publicKey: "not a key" }),
		});
		expect(bad.status).toBe(400);

		const newline = await SELF.fetch(`${BASE}/w/ws1/ssh-key`, {
			method: "POST",
			headers: { ...AUTH, "content-type": "application/json" },
			body: JSON.stringify({ publicKey: "ssh-ed25519 AAAA test\nssh-ed25519 BBBB other" }),
		});
		expect(newline.status).toBe(400);
	});

	it("keeps the alarm while an SSH session is open and clears it when the last one closes", async () => {
		const workspace = env.WORKSPACE.getByName("ssh-alarm");
		const opened = await workspace.noteSsh(true);
		expect(opened.sshActive).toBe(1);
		expect(opened.alarmAt).not.toBeNull();

		const second = await workspace.noteSsh(true);
		expect(second.sshActive).toBe(2);
		expect(second.alarmAt).not.toBeNull();

		const firstClosed = await workspace.noteSsh(false);
		expect(firstClosed.sshActive).toBe(1);
		expect(firstClosed.alarmAt).not.toBeNull();

		const allClosed = await workspace.noteSsh(false);
		expect(allClosed).toEqual({ sshActive: 0, alarmAt: null });
	});

	it("keeps the alarm for a turn that is still running when SSH closes", async () => {
		const workspace = env.WORKSPACE.getByName("ssh-turn-alarm");
		await workspace.noteTurn(
			JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendMessage", params: {} }),
		);
		await workspace.noteSsh(true);
		const closed = await workspace.noteSsh(false);
		expect(closed.sshActive).toBe(0);
		expect(closed.alarmAt).not.toBeNull();
		await workspace.noteTurn(
			JSON.stringify({
				jsonrpc: "2.0",
				method: "liveState",
				params: { sessionId: "s1", liveState: { status: "idle" } },
			}),
		);
		expect((await workspace.state()).alarmAt).toBeNull();
	});
});
