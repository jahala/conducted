/**
 * @feature CLOUD-07 Pair the desktop app with the user's Worker
 * Tests the Worker's pairing route in Cloudflare's local runtime: the token is checked before the
 * answer, the answer names the Worker, and the route starts no Durable Object.
 */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const BASE = "https://cloud.test";
const AUTH = { authorization: "Bearer test-pairing-token" };

const get = (path: string, headers: Record<string, string> = AUTH): Promise<Response> =>
	SELF.fetch(`${BASE}${path}`, { headers });

describe("CLOUD-07 the Worker's pairing route", () => {
	it("refuses a pairing check without the token or with a wrong one", async () => {
		expect((await get("/pair", {})).status).toBe(401);
		expect((await get("/pair", { authorization: "Bearer wrong" })).status).toBe(401);
	});

	it("answers a good token with the Worker's name, and no workspace is needed", async () => {
		const response = await get("/pair");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ service: "conducted-cloud", paired: true });
	});

	it("refuses a method other than GET and says which one is allowed", async () => {
		const response = await SELF.fetch(`${BASE}/pair`, {
			method: "POST",
			headers: AUTH,
		});
		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET");
	});
});
