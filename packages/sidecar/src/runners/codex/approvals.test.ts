import { describe, expect, test } from "bun:test";
import type { Interaction } from "@conducted/protocol";
import type { ToolUseId } from "@conducted/shared";
import {
	consentOutcomeFor,
	decisionForApproval,
	elicitationReply,
	permissionGranted,
	planCommandApproval,
	planFileChangeApproval,
	planMcpElicitation,
	planPermissionApproval,
	planToolUserInput,
} from "./approvals.ts";

describe("AGENT-08 approvals", () => {
	test("approval decisions map to Codex's four replies", () => {
		const answer = (decision: "allow" | "allow_edits_for_session" | "always_allow" | "deny") =>
			({ kind: "tool_approval", decision }) as const;
		expect(decisionForApproval(answer("allow"))).toBe("accept");
		expect(decisionForApproval(answer("allow_edits_for_session"))).toBe("acceptForSession");
		expect(decisionForApproval(answer("always_allow"))).toBe("acceptForSession");
		expect(decisionForApproval(answer("deny"))).toBe("decline");
		expect(decisionForApproval({ kind: "withdrawn" })).toBe("cancel");
		expect(decisionForApproval({ kind: "question", answers: [] })).toBe("decline");
	});

	test("a command approval becomes a Bash tool approval with the command text", () => {
		const plan = planCommandApproval({
			threadId: "thread-1",
			turnId: "turn-1",
			itemId: "item-1",
			reason: "Needs to read the lock file",
			command: "npm install",
			cwd: "/workspace",
		});
		expect(plan?.interaction).toEqual({
			kind: "tool_approval",
			toolUseId: "item-1" as ToolUseId,
			toolName: "Bash",
			input: { command: "npm install", cwd: "/workspace" },
			reason: "Needs to read the lock file",
		});
		expect(plan?.reply({ kind: "tool_approval", decision: "allow" })).toEqual({
			decision: "accept",
		});
		expect(plan?.reply({ kind: "withdrawn" })).toEqual({ decision: "cancel" });
	});

	test("a file-change approval becomes an Edit tool approval", () => {
		const plan = planFileChangeApproval({
			threadId: "thread-1",
			turnId: "turn-1",
			itemId: "item-2",
			reason: "Writes outside the workspace",
			grantRoot: "/repo",
		});
		expect(plan?.interaction).toMatchObject({
			kind: "tool_approval",
			toolUseId: "item-2",
			toolName: "Edit",
			reason: "Writes outside the workspace",
		});
		expect(plan?.reply({ kind: "tool_approval", decision: "allow_edits_for_session" })).toEqual({
			decision: "acceptForSession",
		});
	});

	test("the user input tool becomes a question and its answers are keyed by question id", () => {
		const plan = planToolUserInput({
			threadId: "thread-1",
			turnId: "turn-1",
			itemId: "item-3",
			questions: [
				{
					id: "pick",
					header: "Choose",
					question: "Which database?",
					isOther: true,
					isSecret: false,
					options: [
						{ label: "Postgres", description: "Production" },
						{ label: "SQLite", description: "Local" },
					],
				},
				{
					id: "name",
					header: "Name",
					question: "What should it be called?",
					isOther: true,
					isSecret: true,
					options: null,
				},
			],
		});
		expect(plan?.interaction).toEqual({
			kind: "question",
			questions: [
				{
					header: "Choose",
					question: "Which database?",
					options: [
						{ label: "Postgres", description: "Production" },
						{ label: "SQLite", description: "Local" },
					],
					multiSelect: false,
					secret: false,
				},
				{
					header: "Name",
					question: "What should it be called?",
					options: [],
					multiSelect: false,
					secret: true,
				},
			],
		});
		expect(plan?.reply({ kind: "question", answers: [["Postgres"], ["main"]] })).toEqual({
			answers: {
				pick: { answers: ["Postgres"] },
				name: { answers: ["main"] },
			},
		});
	});

	test("an MCP form becomes a form interaction and keeps its schema", () => {
		const schema = {
			type: "object",
			properties: { branch: { type: "string" } },
			required: ["branch"],
		};
		const plan = planMcpElicitation({
			threadId: "thread-1",
			turnId: "turn-1",
			serverName: "linear",
			mode: "form",
			message: "Which branch?",
			requestedSchema: schema,
		});
		expect(plan).toMatchObject({
			kind: "interaction",
			interaction: {
				kind: "mcp_form",
				server: "linear",
				message: "Which branch?",
				schema,
			},
		});
		if (plan?.kind !== "interaction") throw new Error("expected a form interaction");
		expect(plan.reply({ kind: "mcp_form", action: "accept", content: { branch: "main" } })).toEqual(
			{
				action: "accept",
				content: { branch: "main" },
				_meta: null,
			},
		);
		expect(plan.reply({ kind: "mcp_form", action: "decline" })).toEqual({
			action: "decline",
			content: null,
			_meta: null,
		});
	});

	test("an MCP form in url mode is declined without asking", () => {
		const plan = planMcpElicitation({
			threadId: "thread-1",
			turnId: null,
			serverName: "linear",
			mode: "url",
			message: "Sign in",
			url: "https://example.com/login",
			elicitationId: "elicit-1",
		});
		expect(plan).toMatchObject({ kind: "unsupported", mode: "url" });
		if (plan?.kind !== "unsupported") throw new Error("expected an unsupported mode");
		expect(plan.reply()).toEqual({ action: "decline", content: null, _meta: null });
	});

	test("a form reply is only sent back with content when accepted", () => {
		expect(elicitationReply({ kind: "mcp_form", action: "accept", content: { a: 1 } })).toEqual({
			action: "accept",
			content: { a: 1 },
			_meta: null,
		});
		expect(elicitationReply({ kind: "mcp_form", action: "decline", content: { a: 1 } })).toEqual({
			action: "decline",
			content: null,
			_meta: null,
		});
		expect(elicitationReply({ kind: "withdrawn" })).toEqual({
			action: "cancel",
			content: null,
			_meta: null,
		});
	});

	test("a permission request shows its reason, paths and network switch", () => {
		const plan = planPermissionApproval({
			threadId: "thread-1",
			turnId: "turn-1",
			itemId: "item-4",
			cwd: "/workspace",
			reason: "Needs the package cache",
			permissions: {
				network: { enabled: true },
				fileSystem: {
					read: ["/tmp"],
					write: null,
					entries: [
						{ path: { type: "path", path: "/home/me/.cache" }, access: "write" },
						{ path: { type: "glob_pattern", pattern: "**/*.ts" }, access: "read" },
						{ path: { type: "special", value: { kind: "tmpdir" } }, access: "read" },
					],
				},
			},
		});
		expect(plan?.interaction).toEqual({
			kind: "permission_grant",
			description: "Needs the package cache",
			reason: "Needs the package cache",
			paths: [
				{ path: "/home/me/.cache", pathKind: "path", access: "write" },
				{ path: "**/*.ts", pathKind: "glob", access: "read" },
				{ path: "tmpdir", pathKind: "special", access: "read" },
			],
			network: true,
		});
	});

	test("a permission grant keeps the requested profile and the chosen scope", () => {
		const permissions = {
			network: { enabled: true },
			fileSystem: { read: ["/tmp"], write: null },
		};
		const plan = planPermissionApproval({
			threadId: "thread-1",
			turnId: "turn-1",
			itemId: "item-4",
			cwd: "/workspace",
			reason: null,
			permissions,
		});
		expect(plan?.reply({ kind: "permission_grant", granted: true, grantFor: "session" })).toEqual({
			permissions,
			scope: "session",
		});
		expect(plan?.reply({ kind: "permission_grant", granted: true })).toEqual({
			permissions,
			scope: "turn",
		});
		expect(plan?.reply({ kind: "permission_grant", granted: false })).toEqual({
			permissions: {},
			scope: "turn",
		});
		expect(plan?.reply({ kind: "withdrawn" })).toEqual({ permissions: {}, scope: "turn" });
	});

	test("only an explicit grant grants", () => {
		expect(permissionGranted({ kind: "permission_grant", granted: true })).toBe(true);
		expect(permissionGranted({ kind: "permission_grant", granted: false })).toBe(false);
		expect(permissionGranted({ kind: "withdrawn" })).toBe(false);
	});

	test("consent outcomes name what ended the request", () => {
		const form = { kind: "mcp_form", server: "s", message: "m", schema: {} } as const;
		expect(consentOutcomeFor(form, { kind: "withdrawn" })).toBe("user_canceled");
		expect(consentOutcomeFor(form, { kind: "mcp_form", action: "decline" })).toBe("user_declined");
		expect(consentOutcomeFor(form, { kind: "mcp_form", action: "cancel" })).toBe("user_canceled");
		expect(consentOutcomeFor(form, { kind: "mcp_form", action: "accept" })).toBeUndefined();
		const permission: Interaction = {
			kind: "permission_grant",
			description: "d",
			paths: [],
			network: false,
		};
		expect(consentOutcomeFor(permission, { kind: "permission_grant", granted: false })).toBe(
			"user_declined",
		);
		expect(
			consentOutcomeFor(permission, { kind: "permission_grant", granted: true }),
		).toBeUndefined();
	});
});
