/**
 * The release trusts main's CI instead of running the suite on the owner's Mac, and signs with the
 * Developer ID identity whose certificate lasts longest, by hash, because several identities in one
 * keychain can share a name and codesign refuses an ambiguous name.
 */
import { expect, test } from "bun:test";
import { type CiRun, ciGate, parseIdentities, pickSigningIdentity } from "./gates.ts";

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

const FIND_IDENTITY = `  1) 1111111111111111111111111111111111111111 "Apple Development: Someone (AAAAAAAAAA)"
  2) 2222222222222222222222222222222222222222 "Developer ID Application: Someone (TEAM123)"
  3) 3333333333333333333333333333333333333333 "Developer ID Application: Someone (TEAM123)"
     3 valid identities found`;

test("reads hash and name of each valid identity", () => {
	expect(parseIdentities(FIND_IDENTITY)).toEqual([
		{
			hash: "1111111111111111111111111111111111111111",
			name: "Apple Development: Someone (AAAAAAAAAA)",
		},
		{
			hash: "2222222222222222222222222222222222222222",
			name: "Developer ID Application: Someone (TEAM123)",
		},
		{
			hash: "3333333333333333333333333333333333333333",
			name: "Developer ID Application: Someone (TEAM123)",
		},
	]);
});

test("picks the Developer ID Application identity that expires last, by hash", () => {
	const picked = pickSigningIdentity([
		{ hash: "1111", name: "Apple Development: Someone (A)", notAfter: new Date("2035-01-01") },
		{
			hash: "2222",
			name: "Developer ID Application: Someone (T)",
			notAfter: new Date("2027-02-01"),
		},
		{
			hash: "3333",
			name: "Developer ID Application: Someone (T)",
			notAfter: new Date("2031-01-23"),
		},
	]);
	expect(picked).toEqual({ ok: true, value: "3333" });
});

test("refuses when no Developer ID Application identity is in the keychain", () => {
	const picked = pickSigningIdentity([
		{ hash: "1111", name: "Apple Development: Someone (A)", notAfter: new Date("2035-01-01") },
	]);
	expect(picked.ok).toBe(false);
	if (!picked.ok) expect(picked.error.message).toContain("Developer ID Application");
});
