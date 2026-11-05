/**
 * The driver's pure parts: prompts must carry the rules and the right replacements, `--only` must
 * not drop an unknown id, the balance call must fail loudly, and importing the file must have no
 * effect (no folder made, no command run).
 */
import { expect, test } from "bun:test";
import type { BacklogRow } from "../issues/model.ts";
import {
	auditPrompt,
	deepseekBalance,
	fixerPrompt,
	joinNodeId,
	joinPromptFor,
	markDone,
	needsJoin,
	nodeId,
	promptFor,
	RULES,
	selectFeatures,
} from "./drive.ts";
import type { Batch } from "./plan-batches.ts";

const row = (id: string): BacklogRow => ({
	id,
	title: `Title of ${id}`,
	owner: "D/core",
	research: "",
	priority: 1,
	status: "stub",
	needs: [],
	epic: "x",
});

test("a builder prompt names its feature, its issue and its test-name rule", () => {
	const prompt = promptFor(row("CHAT-03"), 42);
	expect(prompt).toContain("Feature: CHAT-03 Title of CHAT-03.");
	expect(prompt).toContain("gh issue view 42 --repo jahala/conducted");
	expect(prompt).toContain('describe("CHAT-03 ..."');
	expect(prompt).toContain("fn chat_03_runs_a_command()");
	expect(prompt).not.toContain("{ID}");
	expect(prompt).not.toContain("{SNAKE}");
	expect(promptFor(row("CHAT-03"), undefined)).toContain("the backlog row CHAT-03");
});

test("the audit prompt points each feature at its own issue", () => {
	const prompt = auditPrompt(
		"n1-s1-core",
		[row("CHAT-03"), row("CHAT-04")],
		new Map([["CHAT-03", 7]]),
		"/out/findings.md",
	);
	expect(prompt).toContain("CHAT-03 Title of CHAT-03 (gh issue view 7 --repo jahala/conducted)");
	expect(prompt).toContain("CHAT-04 Title of CHAT-04 (gh issue view ? --repo");
	expect(prompt).toContain("Each feature's GitHub issue (listed below)");
	expect(prompt).not.toContain("Your GitHub issue (command below)");
	expect(prompt).toContain("/out/findings.md");
});

test("a fixer prompt for a group carries every id's rule", () => {
	const single = fixerPrompt(["CHAT-03"], "boom");
	expect(single).toContain("boom");
	expect(single).not.toContain("apply the same way");
	const group = fixerPrompt(["CHAT-03", "CHAT-04"], "boom");
	expect(group).toContain("each of CHAT-03, CHAT-04");
	expect(group).toContain("The GitHub issues of these features");
});

test("the rules still carry the engineering rules the audits enforce", () => {
	for (const phrase of ["no silent failures", "createLatestWins", "createTestContainer"]) {
		expect(RULES).toContain(phrase);
	}
});

test("node ids are the lower-case id with a dot", () => {
	expect(nodeId("CHAT-03")).toBe("chat.03");
});

test("--only refuses an id the batch does not hold", () => {
	const batch: Batch = {
		id: "s1-core",
		step: 1,
		program: "core",
		features: [row("CHAT-03"), row("CHAT-04")],
	};
	expect(selectFeatures(batch, undefined)).toHaveLength(2);
	expect(selectFeatures(batch, "CHAT-04").map((f) => f.id)).toEqual(["CHAT-04"]);
	expect(() => selectFeatures(batch, "CHAT-04,CHAT-99")).toThrow("does not hold CHAT-99");
});

const BACKLOG =
	"| CHAT-03 | Steer | D/core | r | 1 | stub | CHAT-02 |\n| CHAT-04 | Cancel | D/core | r | 1 | stub |  |\n";

test("mark-done flips only the named rows and refuses a row that is not a stub", () => {
	const next = markDone(BACKLOG, ["CHAT-03"]);
	expect(next).toContain("| CHAT-03 | Steer | D/core | r | 1 | done | CHAT-02 |");
	expect(next).toContain("| CHAT-04 | Cancel | D/core | r | 1 | stub |  |");
	expect(() => markDone(next, ["CHAT-03"])).toThrow("CHAT-03 has no stub row");
	expect(() => markDone(BACKLOG, ["CHAT-.*"])).toThrow("is not a feature id");
});

test("the balance call fails on a missing key, a refusal and a missing USD entry", async () => {
	const answer = (status: number, body: unknown) => async () =>
		new Response(JSON.stringify(body), { status });
	await expect(deepseekBalance(undefined)).rejects.toThrow("DEEPSEEK_API_KEY is not set");
	await expect(deepseekBalance("k", answer(401, {}))).rejects.toThrow("HTTP 401");
	await expect(
		deepseekBalance("k", answer(200, { balance_infos: [{ currency: "CNY", total_balance: "5" }] })),
	).rejects.toThrow("no USD balance");
	expect(
		await deepseekBalance(
			"k",
			answer(200, { balance_infos: [{ currency: "USD", total_balance: "7.25" }] }),
		),
	).toBe("7.25");
});

test("a TypeScript batch of two or more features gets a joining node; Rust and single features do not", () => {
	expect(needsJoin("core", 2)).toBe(true);
	expect(needsJoin("ui", 8)).toBe(true);
	expect(needsJoin("sidecar", 3)).toBe(true);
	expect(needsJoin("core", 1)).toBe(false);
	expect(needsJoin("rust", 6)).toBe(false);
	expect(joinNodeId("s1-core-1")).toBe("join.s1-core-1");
});

test("the joining prompt names every feature, the composition root and the integration test file", () => {
	const prompt = joinPromptFor("s2-core-1", "core", [row("CHAT-03"), row("GIT-03")]);
	expect(prompt).toContain("CHAT-03");
	expect(prompt).toContain("GIT-03");
	expect(prompt).toContain("apps/desktop/src/core/container.ts");
	expect(prompt).toContain("apps/desktop/src/core/s2-core-1.join.test.ts");
	expect(prompt).toContain("createTestContainer");
	const sidecar = joinPromptFor("s2-sidecar", "sidecar", [row("SIDE-21"), row("SIDE-13")]);
	expect(sidecar).toContain("packages/sidecar/src/modes/sidecar-mode.ts");
	expect(sidecar).toContain("packages/sidecar/src/modes/s2-sidecar.join.test.ts");
});

test("every builder prompt carries the reach-it-from-the-real-app rule (D054)", () => {
	const prompt = promptFor(row("CHAT-03"), 42);
	expect(prompt).toContain("Reach it from the real app (D054)");
	expect(prompt).toContain("createTestContainer");
	expect(RULES).toContain("Never assert placeholder text");
});
