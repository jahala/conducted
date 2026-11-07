// @vitest-environment node
/**
 * @feature CLOUD-07 Pair the desktop app with the user's Worker
 * Tests the check the pairing form and service run before a Worker is asked anything: the URL is
 * https with a host and nothing that could point at another host, and the token is not blank.
 */
import { describe, expect, it } from "vitest";
import { checkPairingInput, checkWorkerUrl } from "./pairing.ts";

const must = <T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
	if (!result.ok) throw new Error(`${result.error.code}`);
	return result.value;
};

describe("CLOUD-07 pairing input", () => {
	it("accepts an https Worker URL and drops one trailing slash", () => {
		expect(must(checkWorkerUrl("https://conducted.example.workers.dev/"))).toBe(
			"https://conducted.example.workers.dev",
		);
		expect(must(checkWorkerUrl("  https://conducted.example.workers.dev  "))).toBe(
			"https://conducted.example.workers.dev",
		);
		expect(must(checkWorkerUrl("https://example.dev/team/worker"))).toBe(
			"https://example.dev/team/worker",
		);
	});

	it("refuses a URL that is not https or names another host", () => {
		for (const url of [
			"http://conducted.example.workers.dev",
			"ftp://conducted.example.workers.dev",
			"https://user:pass@conducted.example.workers.dev",
			"https://conducted.example.workers.dev?x=1",
			"https://conducted.example.workers.dev#top",
			"not a url",
			"",
		]) {
			const result = checkWorkerUrl(url);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.code).toBe("cloud_url_not_allowed");
		}
	});

	it("trims the token and refuses a blank one", () => {
		const input = must(
			checkPairingInput({
				url: "https://conducted.example.workers.dev/",
				token: "  32-random-bytes\n",
			}),
		);
		expect(input).toEqual({
			url: "https://conducted.example.workers.dev",
			token: "32-random-bytes",
		});

		for (const token of ["", "   ", "\n\t"]) {
			const result = checkPairingInput({
				url: "https://conducted.example.workers.dev",
				token,
			});
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.code).toBe("cloud_token_invalid");
		}
	});
});
