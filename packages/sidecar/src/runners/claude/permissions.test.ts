import { describe, expect, test } from "bun:test";
import type { PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import {
	classifyToolUse,
	isInsideAny,
	modeAfterPlan,
	permissionModeFor,
	resolveEditPath,
	type ToolUseFacts,
	toPermissionResult,
	toPlanResult,
} from "./permissions.ts";

const facts = (over: Partial<ToolUseFacts>): ToolUseFacts => ({
	toolName: "Bash",
	input: {},
	resolvedEditPath: null,
	allowedRoots: ["/work/app"],
	requireToolApproval: true,
	autoApproveEdits: false,
	sessionLive: true,
	...over,
});

test("plan mode wins over approvals, approvals over bypass", () => {
	expect(permissionModeFor({ planMode: true, requireToolApproval: true })).toBe("plan");
	expect(permissionModeFor({ planMode: false, requireToolApproval: true })).toBe("default");
	expect(permissionModeFor({ planMode: false, requireToolApproval: false })).toBe(
		"bypassPermissions",
	);
});

test("a sibling folder with a shared prefix is not inside the root", () => {
	expect(isInsideAny("/work/app-other/x.ts", ["/work/app"])).toBe(false);
	expect(isInsideAny("/work/app/src/x.ts", ["/work/app"])).toBe(true);
	expect(isInsideAny("/work/app", ["/work/app/"])).toBe(true);
});

test("an edit outside the allowed folders is denied with the folders named", () => {
	const verdict = classifyToolUse(
		facts({
			toolName: "Edit",
			input: { file_path: "/work/app-other/x.ts" },
			resolvedEditPath: "/work/app-other/x.ts",
		}),
	);
	expect(verdict.kind).toBe("deny");
	if (verdict.kind === "deny") expect(verdict.message).toContain("/work/app");
});

describe("AGENT-04 edit path resolution", () => {
	const existingOnly = (paths: readonly string[]) => {
		const existing = new Set(paths);
		return async (path: string): Promise<string | null> => (existing.has(path) ? path : null);
	};

	test("a new file in a new subfolder resolves through its nearest existing ancestor", async () => {
		const realPath = existingOnly(["/work/app"]);

		expect(await resolveEditPath("/work/app/src/new/deep/a.ts", "/work/app", realPath)).toBe(
			"/work/app/src/new/deep/a.ts",
		);
	});

	test("a relative target resolves against the workspace, not the sidecar folder", async () => {
		const realPath = existingOnly(["/work/app", "/work/app/src"]);

		expect(await resolveEditPath("src/new.ts", "/work/app", realPath)).toBe("/work/app/src/new.ts");
	});

	test("a new file under a symlinked folder resolves to that folder's real path", async () => {
		const realPath = async (path: string): Promise<string | null> => {
			if (path === "/work/app/link") return "/elsewhere";
			if (path === "/work/app") return "/work/app";
			return null;
		};

		expect(await resolveEditPath("/work/app/link/new/a.ts", "/work/app", realPath)).toBe(
			"/elsewhere/new/a.ts",
		);
	});

	test("a target with no resolvable ancestor stays unresolved", async () => {
		expect(await resolveEditPath("/work/app/a.ts", "/work/app", async () => null)).toBeNull();
	});
});

test("an edit without a path, or with an unresolvable path, is denied", () => {
	expect(classifyToolUse(facts({ toolName: "Write", input: {} })).kind).toBe("deny");
	expect(
		classifyToolUse(
			facts({ toolName: "Write", input: { file_path: "/x" }, resolvedEditPath: null }),
		).kind,
	).toBe("deny");
});

test("the check order: plan exit, app tool, dead session, approvals off, auto edits, ask", () => {
	expect(classifyToolUse(facts({ toolName: "ExitPlanMode" })).kind).toBe("exit_plan_mode");
	expect(
		classifyToolUse(facts({ toolName: "mcp__conducted__DiffComment", sessionLive: false })).kind,
	).toBe("allow");
	expect(classifyToolUse(facts({ sessionLive: false })).kind).toBe("deny");
	expect(classifyToolUse(facts({ requireToolApproval: false })).kind).toBe("allow");
	const edit = {
		toolName: "Edit",
		input: { file_path: "/work/app/a.ts" },
		resolvedEditPath: "/work/app/a.ts",
	};
	expect(classifyToolUse(facts({ ...edit, autoApproveEdits: true })).kind).toBe("allow");
	expect(classifyToolUse(facts(edit)).kind).toBe("ask");
	expect(classifyToolUse(facts({})).kind).toBe("ask");
});

test("answers map to SDK results", () => {
	const input = { command: "ls" };
	const always = toPermissionResult("Bash", input, {
		kind: "tool_approval",
		decision: "always_allow",
	});
	expect(always.result).toMatchObject({
		behavior: "allow",
		updatedPermissions: [
			{ type: "addRules", destination: "localSettings", rules: [{ toolName: "Bash" }] },
		],
	});
	const edits = toPermissionResult("Edit", input, {
		kind: "tool_approval",
		decision: "allow_edits_for_session",
	});
	expect(edits.enableAutoApproveEdits).toBe(true);
	const denied = toPermissionResult("Bash", input, {
		kind: "tool_approval",
		decision: "deny",
		message: "no",
	});
	expect(denied.result).toEqual({ behavior: "deny", message: "no" });
	const withdrawn = toPermissionResult("Bash", input, { kind: "withdrawn" });
	expect(withdrawn.result.behavior).toBe("deny");
});

describe("AGENT-04 permission mode and suggested rules", () => {
	test("the auto permission mode follows approvals and plan mode", () => {
		expect(
			permissionModeFor({
				planMode: false,
				requireToolApproval: true,
				autoPermissionMode: true,
			}),
		).toBe("auto");
		expect(
			permissionModeFor({
				planMode: true,
				requireToolApproval: true,
				autoPermissionMode: true,
			}),
		).toBe("plan");
		expect(
			permissionModeFor({
				planMode: false,
				requireToolApproval: false,
				autoPermissionMode: true,
			}),
		).toBe("bypassPermissions");
		expect(modeAfterPlan({ requireToolApproval: true, autoPermissionMode: true })).toBe("auto");
	});

	test("allow with suggested rules adds the SDK's suggestions", () => {
		const suggestions: PermissionUpdate[] = [
			{
				type: "addRules",
				rules: [{ toolName: "Bash", ruleContent: "npm test" }],
				behavior: "allow",
				destination: "localSettings",
			},
		];
		const outcome = toPermissionResult(
			"Bash",
			{ command: "npm test" },
			{ kind: "tool_approval", decision: "allow_with_suggested_rules" },
			suggestions,
		);

		expect(outcome.result).toEqual({
			behavior: "allow",
			updatedInput: { command: "npm test" },
			updatedPermissions: suggestions,
		});
		expect(outcome.enableAutoApproveEdits).toBe(false);
	});

	test("allow with suggested rules still allows when the SDK proposes nothing", () => {
		const outcome = toPermissionResult(
			"Bash",
			{ command: "ls" },
			{ kind: "tool_approval", decision: "allow_with_suggested_rules" },
		);

		expect(outcome.result).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
	});
});

test("plan approval returns to the normal mode, rejection interrupts with the feedback", () => {
	const approved = toPlanResult(
		{ plan: "p" },
		{ kind: "plan_approval", approved: true },
		{ requireToolApproval: false },
		"/plans/p.md",
	);
	expect(approved.nextMode).toBe("bypassPermissions");
	expect(approved.result).toMatchObject({
		behavior: "allow",
		updatedInput: { plan: "p", planFilePath: "/plans/p.md" },
		updatedPermissions: [{ type: "setMode", mode: "bypassPermissions", destination: "session" }],
	});
	const rejected = toPlanResult(
		{},
		{ kind: "plan_approval", approved: false, feedback: "less scope" },
		{ requireToolApproval: true },
	);
	expect(rejected.result).toEqual({ behavior: "deny", message: "less scope", interrupt: true });
	expect(modeAfterPlan({ requireToolApproval: true })).toBe("default");
});
