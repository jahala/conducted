import { describe, expect, test } from "bun:test";
import type { CanUseTool, PermissionMode, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import type { Interaction, InteractionAnswer, SessionConfig } from "@conducted/protocol";
import type { ToolUseId } from "@conducted/shared";
import type { TurnCallbacks } from "../runner.ts";
import { ClaudePermissionHandler, type PermissionHandlerDeps } from "./permission-handler.ts";

type ToolOptions = Parameters<CanUseTool>[2];

function toolOptions(over: Partial<ToolOptions> = {}): ToolOptions {
	return {
		signal: new AbortController().signal,
		toolUseID: "tool-1",
		requestId: "request-1",
		...over,
	};
}

function turnCallbacks(
	request: (interaction: Interaction) => Promise<InteractionAnswer>,
): TurnCallbacks {
	return {
		onMessage: () => {},
		requestInteraction: request,
		onAgentSessionId: () => {},
		onBackgroundTasks: () => {},
		beforeFirstWrite: async () => {},
		onFastModeUnavailable: () => {},
	};
}

interface HarnessOptions {
	config?: Partial<Pick<SessionConfig, "planMode" | "requireToolApproval" | "autoPermissionMode">>;
	allowed?: string[];
	/** null means the chat has no active turn callbacks. */
	callbacks?: TurnCallbacks | null;
	answer?:
		| InteractionAnswer
		| ((interaction: Interaction) => InteractionAnswer | Promise<InteractionAnswer>);
	realPath?: (path: string) => Promise<string | null>;
	live?: boolean;
}

interface Harness {
	handler: ClaudePermissionHandler;
	interactions: Interaction[];
	modes: PermissionMode[];
}

function harness(over: HarnessOptions = {}): Harness {
	const config = {
		planMode: false,
		requireToolApproval: true,
		autoPermissionMode: false,
		...over.config,
	};
	const interactions: Interaction[] = [];
	const modes: PermissionMode[] = [];
	const fallback: InteractionAnswer = { kind: "tool_approval", decision: "allow" };
	const answer = over.answer ?? fallback;
	const callbacks =
		over.callbacks === undefined
			? turnCallbacks(async (interaction) => {
					interactions.push(interaction);
					return typeof answer === "function" ? await answer(interaction) : answer;
				})
			: (over.callbacks ?? undefined);
	const deps: PermissionHandlerDeps = {
		config: () => config,
		allowedDirectories: () => over.allowed ?? ["/work/app"],
		callbacks: () => callbacks,
		realPath: over.realPath ?? (async (path) => path),
		isSessionLive: () => over.live ?? true,
		setPermissionMode: async (mode) => {
			modes.push(mode);
		},
	};
	return { handler: new ClaudePermissionHandler(deps), interactions, modes };
}

describe("AGENT-04 Claude permission handler", () => {
	test("a Bash call with approvals on asks the user with the tool name and input", async () => {
		const { handler, interactions } = harness();

		const result = await handler.canUseTool(
			"Bash",
			{ command: "ls" },
			toolOptions({ toolUseID: "tool-9" }),
		);

		expect(result).toMatchObject({ behavior: "allow", updatedInput: { command: "ls" } });
		expect(interactions).toEqual([
			{
				kind: "tool_approval",
				toolUseId: "tool-9" as ToolUseId,
				toolName: "Bash",
				input: { command: "ls" },
			},
		]);
	});

	test("an edit outside the allowed folders is denied without asking", async () => {
		const { handler, interactions } = harness();

		const result = await handler.canUseTool(
			"Edit",
			{ file_path: "/work/app-other/x.ts" },
			toolOptions(),
		);

		expect(result?.behavior).toBe("deny");
		if (result?.behavior === "deny") expect(result.message).toContain("/work/app");
		expect(interactions).toHaveLength(0);
	});

	test("a symlink that resolves outside the allowed folders is denied", async () => {
		const { handler, interactions } = harness({
			realPath: async (path) => (path === "/work/app/escape" ? "/etc/passwd" : path),
		});

		const result = await handler.canUseTool(
			"Write",
			{ file_path: "/work/app/escape" },
			toolOptions(),
		);

		expect(result?.behavior).toBe("deny");
		expect(interactions).toHaveLength(0);
	});

	test("an edit inside the workspace asks and is allowed", async () => {
		const { handler, interactions } = harness();

		const result = await handler.canUseTool(
			"Edit",
			{ file_path: "/work/app/src/a.ts" },
			toolOptions(),
		);

		expect(result?.behavior).toBe("allow");
		expect(interactions[0]).toMatchObject({ kind: "tool_approval", toolName: "Edit" });
	});

	test("the app's own tools and an approvals-off chat run without asking", async () => {
		const appTool = harness();
		expect(
			(await appTool.handler.canUseTool("mcp__conducted__DiffComment", {}, toolOptions()))
				?.behavior,
		).toBe("allow");
		expect(appTool.interactions).toHaveLength(0);

		const approvalsOff = harness({ config: { requireToolApproval: false } });
		expect((await approvalsOff.handler.canUseTool("Bash", {}, toolOptions()))?.behavior).toBe(
			"allow",
		);
		expect(approvalsOff.interactions).toHaveLength(0);
	});

	test("a dead session or a missing turn callback denies the call", async () => {
		const dead = harness({ live: false });
		expect((await dead.handler.canUseTool("Bash", {}, toolOptions()))?.behavior).toBe("deny");
		expect(dead.interactions).toHaveLength(0);

		const betweenTurns = harness({ callbacks: null });
		const result = await betweenTurns.handler.canUseTool("Bash", {}, toolOptions());
		expect(result?.behavior).toBe("deny");
	});

	test("the approval carries the reason, blocked path, suggested rules and sub-agent id", async () => {
		const suggestions: PermissionUpdate[] = [
			{
				type: "addRules",
				rules: [{ toolName: "Bash", ruleContent: "npm test" }],
				behavior: "allow",
				destination: "localSettings",
			},
		];
		const { handler, interactions } = harness();

		await handler.canUseTool(
			"Bash",
			{ command: "npm test" },
			toolOptions({
				decisionReason: "Needs the network",
				blockedPath: "/etc/hosts",
				suggestions,
				agentID: "agent-7",
			}),
		);

		expect(interactions[0]).toMatchObject({
			kind: "tool_approval",
			toolName: "Bash",
			reason: "Needs the network",
			blockedPath: "/etc/hosts",
			subAgentId: "agent-7",
		});
		const first = interactions[0];
		expect(first?.kind === "tool_approval" ? first.suggestedRules : []).toEqual([
			"Allow Bash: npm test",
		]);
	});

	test("allow, deny and allow edits for the session become the SDK results", async () => {
		const denied = harness({ answer: { kind: "tool_approval", decision: "deny", message: "no" } });
		expect(await denied.handler.canUseTool("Bash", {}, toolOptions())).toEqual({
			behavior: "deny",
			message: "no",
		});

		const edits = harness({
			answer: { kind: "tool_approval", decision: "allow_edits_for_session" },
		});
		await edits.handler.canUseTool("Edit", { file_path: "/work/app/a.ts" }, toolOptions());
		expect(edits.handler.editsAutoApproved).toBe(true);
		await edits.handler.canUseTool("Edit", { file_path: "/work/app/b.ts" }, toolOptions());
		expect(edits.interactions).toHaveLength(1);
	});

	test("allow with suggested rules applies the SDK's suggestions", async () => {
		const suggestions: PermissionUpdate[] = [
			{
				type: "addDirectories",
				directories: ["/work/app/vendor"],
				destination: "session",
			},
		];
		const { handler } = harness({
			answer: { kind: "tool_approval", decision: "allow_with_suggested_rules" },
		});

		const result = await handler.canUseTool(
			"Bash",
			{ command: "ls vendor" },
			toolOptions({ suggestions }),
		);

		expect(result).toMatchObject({ behavior: "allow", updatedPermissions: suggestions });
	});

	test("a plan approval asks, switches mode and allows with the plan", async () => {
		const { handler, interactions, modes } = harness({
			config: { planMode: true },
			answer: { kind: "plan_approval", approved: true },
		});

		const result = await handler.canUseTool(
			"ExitPlanMode",
			{ plan: "Change one file" },
			toolOptions(),
		);

		expect(interactions[0]).toMatchObject({ kind: "plan_approval", plan: "Change one file" });
		expect(result).toMatchObject({
			behavior: "allow",
			updatedPermissions: [{ type: "setMode", mode: "default", destination: "session" }],
		});
		expect(modes).toEqual(["default"]);
	});

	test("a rejected plan denies, interrupts and returns the feedback", async () => {
		const { handler, modes } = harness({
			config: { planMode: true },
			answer: { kind: "plan_approval", approved: false, feedback: "do less" },
		});

		const result = await handler.canUseTool("ExitPlanMode", { plan: "p" }, toolOptions());

		expect(result).toEqual({ behavior: "deny", message: "do less", interrupt: true });
		expect(modes).toHaveLength(0);
	});

	test("a plan without text is denied without asking", async () => {
		const { handler, interactions } = harness({ config: { planMode: true } });

		const result = await handler.canUseTool("ExitPlanMode", {}, toolOptions());

		expect(result?.behavior).toBe("deny");
		expect(interactions).toHaveLength(0);
	});

	test("leaving plan mode while the mode is already default approves without asking", async () => {
		const { handler, interactions, modes } = harness({
			config: { planMode: false, requireToolApproval: true },
		});

		const result = await handler.canUseTool("ExitPlanMode", { plan: "p" }, toolOptions());

		expect(result?.behavior).toBe("allow");
		expect(interactions).toHaveLength(0);
		expect(modes).toEqual(["default"]);
	});

	test("aborting while waiting denies the call", async () => {
		const abort = new AbortController();
		const { handler } = harness({
			callbacks: turnCallbacks(() => new Promise<InteractionAnswer>(() => {})),
		});

		const pending = handler.canUseTool("Bash", {}, toolOptions({ signal: abort.signal }));
		abort.abort();

		expect(await pending).toMatchObject({ behavior: "deny" });
	});
});
