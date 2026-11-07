/**
 * The release trusts main's CI instead of running the suite on the owner's Mac, and signs with the
 * Developer ID identity whose certificate lasts longest, by hash, because several identities in one
 * keychain can share a name and codesign refuses an ambiguous name.
 */
import { expect, test } from "bun:test";
import { type CiRun, ciGate } from "./gates.ts";

const HEAD = "a1b2c3";
const ciRun = (overrides: Partial<CiRun> = {}): CiRun => ({
	name: "CI",
	headSha: HEAD,
	status: "completed",
	conclusion: "success",
	...overrides,
});

test("passes when HEAD is main and main's CI run for it succeeded", () => {
	expect(
		ciGate({ head: HEAD, mainHead: HEAD, runs: [ciRun({ name: "Coverage" }), ciRun()] }),
	).toEqual({ ok: true, value: undefined });
});

test("refuses a HEAD that is not origin/main", () => {
	const result = ciGate({ head: HEAD, mainHead: "ffffff", runs: [ciRun()] });
	expect(result.ok).toBe(false);
	if (!result.ok) expect(result.error.message).toContain("origin/main");
});

test("refuses when CI has not run for HEAD", () => {
	const result = ciGate({ head: HEAD, mainHead: HEAD, runs: [ciRun({ headSha: "other" })] });
	expect(result.ok).toBe(false);
	if (!result.ok) expect(result.error.message).toContain("has not run");
});

test("refuses a CI run that is still going, and one that failed", () => {
	const running = ciGate({
		head: HEAD,
		mainHead: HEAD,
		runs: [ciRun({ status: "in_progress", conclusion: "" })],
	});
	expect(running.ok).toBe(false);
	if (!running.ok) expect(running.error.message).toContain("still running");

	const failed = ciGate({ head: HEAD, mainHead: HEAD, runs: [ciRun({ conclusion: "failure" })] });
	expect(failed.ok).toBe(false);
	if (!failed.ok) expect(failed.error.message).toContain("failure");
});

test("reads the newest CI run for HEAD, so a green re-run counts", () => {
	const runs = [ciRun(), ciRun({ conclusion: "failure" })];
	expect(ciGate({ head: HEAD, mainHead: HEAD, runs }).ok).toBe(true);
});
