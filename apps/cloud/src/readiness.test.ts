/**
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Tests the Worker's readiness route in Cloudflare's local runtime: the token is checked first,
 * the answer is booleans only, and it needs no workspace. The test runtime holds no GitHub token
 * and an empty Anthropic key, so the route reports both missing; the rule itself is tested on
 * plain values.
 */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { readinessOf } from "./readiness.ts";

const BASE = "https://cloud.test";
const AUTH = { authorization: "Bearer test-pairing-token" };

describe("CLOUD-19 the Worker's readiness route", () => {
	it("refuses a readiness check without the token", async () => {
		expect((await SELF.fetch(`${BASE}/readiness`)).status).toBe(401);
		expect(
			(await SELF.fetch(`${BASE}/readiness`, { headers: { authorization: "Bearer wrong" } }))
				.status,
		).toBe(401);
	});

	it("answers which secrets are missing, with no workspace", async () => {
		const response = await SELF.fetch(`${BASE}/readiness`, { headers: AUTH });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			github: false,
			agents: { anthropic: false, openai: false, cursor: false },
		});
	});

	it("refuses a method other than GET", async () => {
		const response = await SELF.fetch(`${BASE}/readiness`, { method: "POST", headers: AUTH });
		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET");
	});

	it("the readiness answer reports which secrets are set and never their values", () => {
		const answer = readinessOf({
			GITHUB_TOKEN: "ghp_secret-value",
			ANTHROPIC_API_KEY: "sk-ant-secret-value",
			OPENAI_API_KEY: "",
			CURSOR_API_KEY: undefined,
		});
		expect(answer).toEqual({
			github: true,
			agents: { anthropic: true, openai: false, cursor: false },
		});
		expect(JSON.stringify(answer)).not.toContain("secret-value");
	});
});
