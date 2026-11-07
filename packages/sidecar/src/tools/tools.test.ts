import { describe, expect, test } from "bun:test";
import { APP_TOOLS } from "@conducted/protocol";
import type { AppError, Result, SessionId } from "@conducted/shared";
import { appError, err, notImplemented, ok } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { SidecarToApp } from "../rpc/types.ts";
import type { InteractionBroker } from "../session/interactions.ts";
import { askUserQuestion } from "./ask-user-question.ts";
import {
	APP_NOT_CONNECTED_MESSAGE,
	type AppToolBackend,
	DIFF_REQUEST_TIMEOUT_MS,
	RpcAppToolBackend,
} from "./backend.ts";
import { diffCommentTool } from "./diff-comment.ts";
import { formatDiffComments, formatQuestionAnswers, QUESTION_WITHDRAWN_TEXT } from "./format.ts";
import { getDiffCommentsTool } from "./get-diff-comments.ts";
import { DEFAULT_TERMINAL_LINES, getTerminalOutputTool } from "./get-terminal-output.ts";
import { getWorkspaceDiffTool } from "./get-workspace-diff.ts";
import { createAppToolsServer } from "./in-process-server.ts";
import { enabledTools } from "./registry.ts";
import { setTargetBranchTool } from "./set-target-branch.ts";
import type { DiffCommentInput, ProgressUpdate, Question } from "./types.ts";
import { updateProgressTool } from "./update-progress.ts";

const sessionId = "s1" as SessionId;

function testLogger(warnings: string[] = [], debugMessages: string[] = []): Logger {
	const logger: Logger = {
		error: () => {},
		warn: (message) => {
			warnings.push(message);
		},
		info: () => {},
		debug: (message) => {
			debugMessages.push(message);
		},
		child: () => logger,
		setLevel: () => {},
	};
	return logger;
}

interface Calls {
	diff: { file?: string; statOnly: boolean }[];
	commentsRead: { file?: string }[];
	commentsWritten: DiffCommentInput[][];
	terminal: { source: string; maxLines: number }[];
	branches: string[];
	localCommands: {
		command: string;
		description?: string;
		reason?: string;
		cwd?: string;
		timeoutMs: number;
		extendedTimeoutReason?: string;
	}[];
	progress: ProgressUpdate[];
	questions: Question[][];
}

function makeBackend(overrides: Partial<AppToolBackend> = {}): {
	backend: AppToolBackend;
	calls: Calls;
} {
	const calls: Calls = {
		diff: [],
		commentsRead: [],
		commentsWritten: [],
		terminal: [],
		branches: [],
		localCommands: [],
		progress: [],
		questions: [],
	};
	const backend: AppToolBackend = {
		async getWorkspaceDiff(_sessionId, options) {
			calls.diff.push(options);
			return ok("");
		},
		async getDiffComments(_sessionId, options) {
			calls.commentsRead.push(options);
			return ok([]);
		},
		async addDiffComments(_sessionId, comments) {
			calls.commentsWritten.push(comments);
			return ok(comments.length);
		},
		async getTerminalOutput(_sessionId, options) {
			calls.terminal.push(options);
			return ok({ output: "", source: "auto", running: false });
		},
		async setTargetBranch(_sessionId, branch) {
			calls.branches.push(branch);
			return ok({ ok: true, message: `Now merging into ${branch}.` });
		},
		async runLocalCommand(_sessionId, options) {
			calls.localCommands.push(options);
			return ok({ code: 0, stdout: "", stderr: "" });
		},
		updateProgress(_sessionId, update) {
			calls.progress.push(update);
		},
		async askQuestions(_sessionId, questions) {
			calls.questions.push(questions);
			return ok(questions.map(() => []));
		},
	};
	return { backend: { ...backend, ...overrides }, calls };
}

function context(backend: AppToolBackend) {
	return { sessionId, backend };
}

function fakeApp(overrides: Record<string, unknown> = {}): SidecarToApp {
	return {
		connected: true,
		request: async () => ok({}),
		notify: () => true,
		onAttach: () => () => {},
		onDetach: () => () => {},
		...overrides,
	} as unknown as SidecarToApp;
}

function noInteractions(): InteractionBroker {
	return {
		open: async () => ({ kind: "withdrawn" }),
		answer: () => ({ accepted: false, superseded: true }),
		withdrawAll: () => {},
		openRequest: () => undefined,
	};
}

interface RegisteredTool {
	handler: (
		args: unknown,
		extra: unknown,
	) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
	annotations?: Record<string, unknown>;
}

function registeredTools(
	config: ReturnType<typeof createAppToolsServer>,
): Record<string, RegisteredTool> {
	return (
		config.instance as unknown as {
			_registeredTools: Record<string, RegisteredTool>;
		}
	)._registeredTools;
}

function toolNamed(tools: Record<string, RegisteredTool>, name: string): RegisteredTool {
	const tool = tools[name];
	if (tool === undefined) throw new Error(`No registered tool named ${name}`);
	return tool;
}

describe("SIDE-12 the app tools reach Claude as an in-process MCP server", () => {
	test("the config is type sdk, named conducted, with one tool per enabled definition", () => {
		const switches = {
			diffComments: false,
			progressUpdates: false,
			setTargetBranch: false,
		};
		const config = createAppToolsServer({
			sessionId,
			appTools: switches,
			backend: makeBackend().backend,
			logger: testLogger(),
		});
		expect(config.type).toBe("sdk");
		expect(config.name).toBe("conducted");
		expect(Object.keys(registeredTools(config))).toEqual(
			enabledTools(switches, { includeAskUserQuestion: true }).map((definition) => definition.name),
		);
	});

	test("a tool handler returns the definition's text and annotations", async () => {
		const config = createAppToolsServer({
			sessionId,
			appTools: {
				diffComments: true,
				progressUpdates: true,
				setTargetBranch: true,
				localExecution: true,
			},
			backend: makeBackend().backend,
			logger: testLogger(),
		});
		const tools = registeredTools(config);
		const result = await toolNamed(tools, "GetWorkspaceDiff").handler({}, {});
		expect(result).toEqual({
			content: [{ type: "text", text: "No changes found." }],
			isError: false,
		});
		expect(toolNamed(tools, "GetWorkspaceDiff").annotations).toMatchObject({
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		});
	});

	test("a thrown tool failure becomes an error result instead of crashing the sidecar", async () => {
		const warnings: string[] = [];
		const config = createAppToolsServer({
			sessionId,
			appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
			backend: makeBackend({
				async getWorkspaceDiff() {
					throw new Error("the backend exploded");
				},
			}).backend,
			logger: testLogger(warnings),
		});
		const result = await toolNamed(registeredTools(config), "GetWorkspaceDiff").handler({}, {});
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toBe("the backend exploded");
		expect(warnings).toEqual(["An app tool failed"]);
	});

	test("a NotImplemented placeholder names its feature id in the error text", async () => {
		const config = createAppToolsServer({
			sessionId,
			appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
			backend: makeBackend({
				async getWorkspaceDiff() {
					throw notImplemented("REV-03");
				},
			}).backend,
			logger: testLogger(),
		});
		const result = await toolNamed(registeredTools(config), "GetWorkspaceDiff").handler({}, {});
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("REV-03");
	});
});

describe("SIDE-12 the tool registry follows the switches", () => {
	test("progress off leaves out UpdateProgress, and every switch on gives every APP_TOOL", () => {
		const off = enabledTools(
			{ diffComments: true, progressUpdates: false, setTargetBranch: true },
			{ includeAskUserQuestion: true },
		);
		expect(off.map((tool) => tool.name)).not.toContain("UpdateProgress");
		const all = enabledTools(
			{ diffComments: true, progressUpdates: true, setTargetBranch: true, localExecution: true },
			{ includeAskUserQuestion: true },
		);
		expect(all.map((tool) => tool.name)).toEqual([...APP_TOOLS]);
	});
});

describe("SIDE-12 AskUserQuestion waits for the user's answers", () => {
	test("one answer returns the question and the numbered answer", async () => {
		const { backend } = makeBackend({
			async askQuestions() {
				return ok([["A"]]);
			},
		});
		const result = await askUserQuestion.execute(
			{ questions: [{ question: "Which database?", options: ["A", "B"] }] },
			context(backend),
		);
		expect(result).toEqual({
			text: "The user answered:\n1. Which database?\n   A",
			isError: false,
		});
	});

	test("a dismissed question is text the agent can carry on from", async () => {
		const { backend } = makeBackend({
			async askQuestions() {
				return ok("withdrawn");
			},
		});
		const result = await askUserQuestion.execute(
			{ questions: [{ question: "Continue?", options: ["Yes", "No"] }] },
			context(backend),
		);
		expect(result).toEqual({ text: QUESTION_WITHDRAWN_TEXT, isError: false });
	});

	test("a wrong answer count asks for one retry", async () => {
		const { backend } = makeBackend({
			async askQuestions() {
				return ok([[], []]);
			},
		});
		const result = await askUserQuestion.execute(
			{ questions: [{ question: "Which database?", options: ["A", "B"] }] },
			context(backend),
		);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("Retry: yes");
		expect(result.text).toContain("wrong_answer_count");
	});

	test("a delivery failure asks for a retry", async () => {
		const { backend } = makeBackend({
			async askQuestions(): Promise<Result<string[][] | "withdrawn", AppError>> {
				return err(appError("app_not_connected", "The app is not connected."));
			},
		});
		const result = await askUserQuestion.execute(
			{ questions: [{ question: "Which database?", options: ["A", "B"] }] },
			context(backend),
		);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("Retry: yes");
	});

	test("missing session callbacks are not retried", async () => {
		const { backend } = makeBackend({
			async askQuestions(): Promise<Result<string[][] | "withdrawn", AppError>> {
				return err(appError("no_session_callbacks", "No chat is listening."));
			},
		});
		const result = await askUserQuestion.execute(
			{ questions: [{ question: "Which database?", options: ["A", "B"] }] },
			context(backend),
		);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("Retry: no");
	});
});

describe("SIDE-12 result text is plain and complete", () => {
	test("a multi-select question lists both answers under item one", () => {
		expect(formatQuestionAnswers([{ question: "Which regions?" }], [["Europe", "Asia"]])).toBe(
			"The user answered:\n1. Which regions?\n   - Europe\n   - Asia",
		);
	});
});

describe("SIDE-12 GetWorkspaceDiff returns the diff the user sees", () => {
	test("an empty diff is a plain no-changes answer, not an error", async () => {
		const { backend } = makeBackend({
			async getWorkspaceDiff() {
				return ok("  \n");
			},
		});
		const result = await getWorkspaceDiffTool.execute({}, context(backend));
		expect(result).toEqual({ text: "No changes found.", isError: false });
	});

	test("a busy git says so, and the file and stat options reach the backend", async () => {
		const seen: { file?: string; statOnly: boolean }[] = [];
		const { backend } = makeBackend({
			async getWorkspaceDiff(_sessionId, options) {
				seen.push(options);
				return err(appError("git_busy", "A merge is in progress."));
			},
		});
		const result = await getWorkspaceDiffTool.execute(
			{ file: "src/a.ts", stat: true },
			context(backend),
		);
		expect(seen).toEqual([{ file: "src/a.ts", statOnly: true }]);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("merge or rebase");
	});
});

describe("SIDE-12 DiffComment posts review comments on the diff", () => {
	test("two comments call addDiffComments once and answer Posted 2 comments", async () => {
		const { backend, calls } = makeBackend();
		const result = await diffCommentTool.execute(
			{
				comments: [
					{ file: "src/a.ts", lineNumber: 3, body: "Rename this." },
					{ file: "src/b.ts", lineNumber: 7, endLine: 9, body: "This loop is too long." },
				],
			},
			context(backend),
		);
		expect(calls.commentsWritten).toHaveLength(1);
		expect(calls.commentsWritten[0]).toEqual([
			{ file: "src/a.ts", line: 3, endLine: undefined, body: "Rename this." },
			{ file: "src/b.ts", line: 7, endLine: 9, body: "This loop is too long." },
		]);
		expect(result).toEqual({ text: "Posted 2 comments on the diff.", isError: false });
	});
});

describe("SIDE-12 GetDiffComments lists the comments on the diff", () => {
	test("two comments come back through the plain text format with the file filter", async () => {
		const comments = [
			{ file: "a.ts", line: 3, endLine: 5, body: "one", author: "user" as const, resolved: false },
			{ file: "b.ts", line: 9, body: "x", author: "github" as const, resolved: true },
		];
		let seenFile: string | undefined;
		const { backend } = makeBackend({
			async getDiffComments(_sessionId, options) {
				seenFile = options.file;
				return ok(comments);
			},
		});
		const result = await getDiffCommentsTool.execute({ file: "a.ts" }, context(backend));
		expect(result).toEqual({ text: formatDiffComments(comments), isError: false });
		expect(result.text).toBe("a.ts:3-5 [user]\n  one\n\nb.ts:9 [github, resolved]\n  x");
		expect(seenFile).toBe("a.ts");
	});
});

describe("SIDE-12 GetTerminalOutput reads recent terminal text", () => {
	test("without maxLines the backend is asked for 1000 lines from auto", async () => {
		let seen: { source: string; maxLines: number } | undefined;
		const { backend } = makeBackend({
			async getTerminalOutput(_sessionId, options) {
				seen = options;
				return ok({ output: "ready", source: "run_script", running: true });
			},
		});
		const result = await getTerminalOutputTool.execute({}, context(backend));
		expect(seen).toEqual({ source: "auto", maxLines: DEFAULT_TERMINAL_LINES });
		expect(DEFAULT_TERMINAL_LINES).toBe(1000);
		expect(result).toEqual({
			text: "[run_script, still running]\nready",
			isError: false,
		});
	});
});

describe("SIDE-12 UpdateProgress fills the tracker above the composer", () => {
	test("an empty block list clears the tracker and answers Progress cleared", async () => {
		const { backend, calls } = makeBackend();
		const result = await updateProgressTool.execute(
			{ title: "Migration", blocks: [] },
			context(backend),
		);
		expect(calls.progress).toEqual([{ title: "Migration", blocks: [] }]);
		expect(result).toEqual({ text: "Progress cleared.", isError: false });
	});

	test("a non-empty tracker answers Progress updated", async () => {
		const { backend } = makeBackend();
		const result = await updateProgressTool.execute(
			{ blocks: [{ kind: "text", text: "Half way" }] },
			context(backend),
		);
		expect(result).toEqual({ text: "Progress updated.", isError: false });
	});
});

describe("SIDE-12 SetTargetBranch changes the merge target", () => {
	test("origin/main is refused with the bare name to pass instead", async () => {
		const { backend, calls } = makeBackend();
		const result = await setTargetBranchTool.execute({ branch: "origin/main" }, context(backend));
		expect(result.isError).toBe(true);
		expect(result.text).toContain('"main"');
		expect(calls.branches).toEqual([]);
	});

	test("a bare branch reaches the backend, and its refusal is an error", async () => {
		const accepted = makeBackend();
		expect(
			await setTargetBranchTool.execute({ branch: "develop" }, context(accepted.backend)),
		).toEqual({ text: "Now merging into develop.", isError: false });
		expect(accepted.calls.branches).toEqual(["develop"]);

		const refused = makeBackend({
			async setTargetBranch() {
				return ok({ ok: false, message: "origin/develop does not exist." });
			},
		});
		const result = await setTargetBranchTool.execute(
			{ branch: "develop" },
			context(refused.backend),
		);
		expect(result).toEqual({ text: "origin/develop does not exist.", isError: true });
	});
});

describe("SIDE-12 the backend over the app connection", () => {
	test("with no app connected GetWorkspaceDiff returns an error at once", async () => {
		const app = fakeApp({
			connected: false,
			request: () => {
				throw new Error("the request must not be sent");
			},
		});
		const backend = new RpcAppToolBackend({
			app,
			interactions: noInteractions(),
			logger: testLogger(),
		});
		const result = await backend.getWorkspaceDiff(sessionId, { statOnly: false });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("app_not_connected");
			expect(result.error.message).toBe(APP_NOT_CONNECTED_MESSAGE);
		}
	});

	test("the diff request carries its 20 second limit", async () => {
		const seen: { method: string; options?: { timeoutMs?: number } }[] = [];
		const app = fakeApp({
			request: async (method: string, _params: unknown, options?: { timeoutMs?: number }) => {
				seen.push({ method, options });
				return ok({ diff: "a diff" });
			},
		});
		const backend = new RpcAppToolBackend({
			app,
			interactions: noInteractions(),
			logger: testLogger(),
		});
		expect(await backend.getWorkspaceDiff(sessionId, { statOnly: false })).toEqual(ok("a diff"));
		expect(seen).toEqual([
			{ method: "getWorkspaceDiff", options: { timeoutMs: DIFF_REQUEST_TIMEOUT_MS } },
		]);
	});

	test("a timed out diff is an error result for the tool", async () => {
		const app = fakeApp({
			request: async () => err(appError("rpc_timeout", "The getWorkspaceDiff request timed out.")),
		});
		const backend = new RpcAppToolBackend({
			app,
			interactions: noInteractions(),
			logger: testLogger(),
		});
		const result = await getWorkspaceDiffTool.execute({}, context(backend));
		expect(result.isError).toBe(true);
		expect(result.text).toContain("timed out");
	});

	test("a busy diff keeps the app's git_busy code and the busy text", async () => {
		const app = fakeApp({
			request: async () =>
				err(
					appError("rpc_error_-32603", "Cannot fetch diff: merge or rebase in progress.", {
						appErrorCode: "git_busy",
					}),
				),
		});
		const backend = new RpcAppToolBackend({
			app,
			interactions: noInteractions(),
			logger: testLogger(),
		});
		const result = await getWorkspaceDiffTool.execute({}, context(backend));
		expect(result).toEqual({
			text: "Cannot fetch diff: merge or rebase in progress.",
			isError: true,
		});
	});

	test("progress goes to the app as one progress notification", () => {
		const notifications: { method: string; params: unknown }[] = [];
		const app = fakeApp({
			notify: (method: string, params: unknown) => {
				notifications.push({ method, params });
				return true;
			},
		});
		const backend = new RpcAppToolBackend({
			app,
			interactions: noInteractions(),
			logger: testLogger(),
		});
		backend.updateProgress(sessionId, { title: "Work", blocks: [] });
		expect(notifications).toEqual([
			{ method: "progress", params: { sessionId, progress: { title: "Work", blocks: [] } } },
		]);
	});

	test("a progress update with no app connected is dropped and logged", () => {
		const debugMessages: string[] = [];
		const app = fakeApp({
			connected: false,
			notify: () => false,
		});
		const backend = new RpcAppToolBackend({
			app,
			interactions: noInteractions(),
			logger: testLogger([], debugMessages),
		});
		backend.updateProgress(sessionId, { title: "Work", blocks: [] });
		expect(debugMessages).toEqual([
			"A progress update was dropped because the app did not accept it.",
		]);
	});
});
