/**
 * @feature CLOUD-14 Cloud agents ask to run commands on the Mac
 * Owns: tests for the app's RunLocalCommand service: refusals, the approval choices, the
 * notification and the command's output.
 * Behaviour: research/conductor/claude-runner.md section 4.2 and ui-map.md 3.3.
 * Test first: a command on a local workspace is refused before any card is shown.
 */
import type { InteractionAnswer, InteractionRequest } from "@conducted/protocol";
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { appError, err, ok, type Result } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { Workspace } from "../model.ts";
import { LocalCommandService, resolveLocalCwd, truncateLocalOutput } from "./local-command.ts";

const SESSION = "session-1" as SessionId;
const WORKSPACE = "workspace-1" as WorkspaceId;
const HOME = "/Users/me";

const ORIGIN = { kind: "cloud", url: "https://w.example.dev", vmId: "vm-1" } as const;

function cloudWorkspace(): Workspace {
	return { id: WORKSPACE, path: "/workspace", host: ORIGIN } as Workspace;
}

interface Harness {
	service: LocalCommandService;
	cards: InteractionRequest[];
	withdrawn: string[];
	notified: { sessionId: SessionId; kind: string; body: string }[];
	shells: { program: string; args: readonly string[]; cwd: string; timeoutMs?: number }[];
	writes: { path: string; text: string }[];
	settings: Map<string, unknown>;
	answerWith: InteractionAnswer;
	shellAnswer: Result<{ exitCode: number; stdout: string; stderr: string }>;
}

function harness(options: { workspace?: Workspace; home?: string } = {}): Harness {
	const state: Harness = {
		service: undefined as unknown as LocalCommandService,
		cards: [],
		withdrawn: [],
		notified: [],
		shells: [],
		writes: [],
		settings: new Map(),
		answerWith: { kind: "tool_approval", decision: "allow" },
		shellAnswer: ok({ exitCode: 0, stdout: "hi\n", stderr: "" }),
	};
	let next = 0;
	state.service = new LocalCommandService({
		workspaceOfSession: () => ok(options.workspace ?? cloudWorkspace()),
		shell: {
			run: async (command) => {
				state.shells.push(command);
				return state.shellAnswer;
			},
		},
		fs: {
			mkdirp: async () => ok(undefined),
			writeTextAtomic: async (path, text) => {
				state.writes.push({ path, text });
				return ok(undefined);
			},
		},
		homePath: () => options.home ?? HOME,
		openApproval: async (request) => {
			state.cards.push(request);
			return state.answerWith;
		},
		withdrawApproval: (id) => {
			state.withdrawn.push(id);
		},
		notify: async (input) => {
			state.notified.push(input);
			return ok(undefined);
		},
		setting: <T>(key: string) => state.settings.get(key) as T,
		setSetting: async (key, value) => {
			state.settings.set(key, value);
			return ok(undefined);
		},
		newId: () => `id-${++next}`,
		log: () => {},
	});
	return state;
}

describe("CLOUD-14 local command approvals and output", () => {
	it("a command on a local workspace is refused before any card is shown", async () => {
		const h = harness({ workspace: { ...cloudWorkspace(), host: { kind: "local" } } as Workspace });
		const answer = await h.service.run({ sessionId: SESSION, command: "ls" }, ORIGIN);
		expect(answer.denied).toBe(true);
		expect(answer.error).toContain("not available");
		expect(h.cards).toEqual([]);
		expect(h.shells).toEqual([]);
	});

	it("a sandbox cannot ask for a chat in another cloud workspace", async () => {
		const h = harness();
		h.answerWith = { kind: "tool_approval", decision: "allow_for_session" };
		await h.service.run({ sessionId: SESSION, command: "ls" }, ORIGIN);
		const other = { kind: "cloud", url: "https://w.example.dev", vmId: "vm-2" } as const;
		const answer = await h.service.run({ sessionId: SESSION, command: "ls" }, other);
		expect(answer.denied).toBe(true);
		expect(answer.error).toContain("not available");
		expect(h.cards).toHaveLength(1);
		expect(h.shells).toHaveLength(1);
	});

	it("the Mac's own sidecar cannot ask the Mac to run a command", async () => {
		const h = harness();
		const answer = await h.service.run({ sessionId: SESSION, command: "ls" }, null);
		expect(answer.denied).toBe(true);
		expect(h.cards).toEqual([]);
		expect(h.shells).toEqual([]);
	});

	it("denying the card runs nothing and reports the refusal", async () => {
		const h = harness();
		h.answerWith = { kind: "tool_approval", decision: "deny" };
		const answer = await h.service.run({ sessionId: SESSION, command: "rm -rf /" }, ORIGIN);
		expect(answer.denied).toBe(true);
		expect(answer.error).toBe("The user denied local command execution.");
		expect(h.shells).toEqual([]);
	});

	it("the card names the command, the reason it shows, and the notification", async () => {
		const h = harness();
		await h.service.run({ sessionId: SESSION, command: "git status" }, ORIGIN);
		const card = h.cards[0]?.interaction;
		expect(card?.kind).toBe("tool_approval");
		if (card?.kind === "tool_approval") {
			expect(card.toolName).toBe("mcp__conducted__RunLocalCommand");
			expect(card.reason).toBe("A remote agent wants to run a command on this Mac.");
			expect(card.input).toMatchObject({ command: "git status", cwd: HOME });
		}
		expect(h.notified).toEqual([
			{ sessionId: SESSION, kind: "tool_approval", body: "Approve local command: git status" },
		]);
	});

	it("Yes always turns on the setting and skips the next card", async () => {
		const h = harness();
		h.answerWith = { kind: "tool_approval", decision: "always_allow" };
		await h.service.run({ sessionId: SESSION, command: "ls" }, ORIGIN);
		expect(h.settings.get("always_allow_local_execution")).toBe(true);
		const again = await h.service.run({ sessionId: SESSION, command: "ls" }, ORIGIN);
		expect(again.denied).toBeUndefined();
		expect(h.cards).toHaveLength(1);
	});

	it("Yes for this session skips the card for the same chat", async () => {
		const h = harness();
		h.answerWith = { kind: "tool_approval", decision: "allow_for_session" };
		await h.service.run({ sessionId: SESSION, command: "ls" }, ORIGIN);
		await h.service.run({ sessionId: SESSION, command: "ls" }, ORIGIN);
		expect(h.cards).toHaveLength(1);
	});

	it("a command that times out is reported as timed out", async () => {
		const h = harness();
		h.shellAnswer = err(appError("shell_timeout", "The command timed out after 60000 ms."));
		const answer = await h.service.run({ sessionId: SESSION, command: "sleep 99" }, ORIGIN);
		expect(answer.timedOut).toBe(true);
		expect(answer.code).toBeUndefined();
	});

	it("a long output is saved in the workspace and the answer points at it", async () => {
		const h = harness();
		h.shellAnswer = ok({ exitCode: 0, stdout: "x".repeat(40_000), stderr: "" });
		const answer = await h.service.run({ sessionId: SESSION, command: "yes" }, ORIGIN);
		expect(answer.outputPath).toBe(
			"/workspace/.context/conductor/run-local-command-output-id-2.txt",
		);
		expect(answer.stdoutTruncated).toBe(true);
		expect(h.writes[0]?.text).toHaveLength(40_000);
	});

	it("a relative cwd resolves against the Mac's home, and a null byte is refused", () => {
		expect(resolveLocalCwd(undefined, HOME)).toEqual(ok(HOME));
		expect(resolveLocalCwd("projects/app", HOME)).toEqual(ok("/Users/me/projects/app"));
		expect(resolveLocalCwd("bad\0path", HOME).ok).toBe(false);
	});

	it("stdout is cut first, then stderr, and each says when it was cut", () => {
		expect(truncateLocalOutput("short", "also short")).toEqual({
			stdout: "short",
			stderr: "also short",
			stdoutTruncated: false,
			stderrTruncated: false,
		});
		const cut = truncateLocalOutput("x".repeat(31_999), "y".repeat(100));
		expect(cut.stderr).toHaveLength(1);
		expect(cut.stderrTruncated).toBe(true);
	});
});
