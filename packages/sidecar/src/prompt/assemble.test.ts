import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionConfig, WorkspaceContext } from "@conducted/protocol";
import type { AppError, Result, WorkspaceId } from "@conducted/shared";
import { appError, err, ok } from "@conducted/shared";
import { createLogger, type LogRecord } from "../logging/logger.ts";
import {
	MessagePromptAssembler,
	type PromptFiles,
	type WritePullRequestStub,
	writePullRequestStubFile,
} from "./assemble.ts";
import { formatFileMention, formatPullRequestMention } from "./mentions.ts";

const workspace: WorkspaceContext = {
	workspaceId: "w1" as WorkspaceId,
	workspaceName: "lisbon",
	workspacePath: "/work/my tree",
	repoRootPath: "/repos/app",
	targetBranch: "origin/main",
	placeholderBranch: false,
	port: 5100,
};

const config: SessionConfig = {
	agent: "claude",
	model: "claude-test",
	effort: "medium",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
};

function makeFiles(options: {
	sizes?: Record<string, number | null>;
	texts?: Record<string, Result<string, AppError>>;
}): PromptFiles {
	return {
		size: async (path) => options.sizes?.[path] ?? null,
		readText: async (path) =>
			options.texts?.[path] ?? err(appError("ENOENT", `No file at ${path}.`)),
	};
}

function makeLogger(): { logger: ReturnType<typeof createLogger>; records: LogRecord[] } {
	const records: LogRecord[] = [];
	const logger = createLogger({
		sink: (record) => records.push(record),
		clock: { now: () => 0 },
		level: "debug",
		scope: "prompt",
	});
	return { logger, records };
}

function makeStubWriter(result: Result<void, AppError> = ok(undefined)): {
	calls: { workspacePath: string; number: number; repositoryFullName: string | undefined }[];
	write: WritePullRequestStub;
} {
	const calls: {
		workspacePath: string;
		number: number;
		repositoryFullName: string | undefined;
	}[] = [];
	return {
		calls,
		write: async (workspacePath, number, repositoryFullName) => {
			calls.push({ workspacePath, number, repositoryFullName });
			return result;
		},
	};
}

function makeAssembler(options: { files?: PromptFiles; stubResult?: Result<void, AppError> }): {
	assembler: MessagePromptAssembler;
	calls: { workspacePath: string; number: number; repositoryFullName: string | undefined }[];
	records: LogRecord[];
} {
	const { logger, records } = makeLogger();
	const { calls, write } = makeStubWriter(options.stubResult);
	return {
		assembler: new MessagePromptAssembler({
			writePullRequestStub: write,
			files: options.files ?? makeFiles({}),
			logger,
		}),
		calls,
		records,
	};
}

describe("SIDE-09 prompt assembly", () => {
	test("a first message starts with the instruction tag and ends with the user's text", async () => {
		const { assembler } = makeAssembler({});
		const result = await assembler.assemble({
			text: "Hello there",
			attachmentPaths: [],
			firstMessage: true,
			workspace,
			config,
		});
		if (!result.ok) throw new Error(result.error.message);
		expect(result.value.startsWith("<conducted_context>")).toBe(true);
		expect(result.value.endsWith("Hello there")).toBe(true);
	});

	test("the first message carries the user's preferences, while later messages do not get the instruction", async () => {
		const prefs = "Always run the tests.";
		const { assembler } = makeAssembler({});
		const first = await assembler.assemble({
			text: "Hello",
			attachmentPaths: [],
			firstMessage: true,
			workspace: { ...workspace, userPreferences: prefs },
			config,
		});
		const later = await assembler.assemble({
			text: "Hello",
			attachmentPaths: [],
			firstMessage: false,
			workspace: { ...workspace, userPreferences: prefs },
			config,
		});
		if (!first.ok || !later.ok) throw new Error("assemble failed");
		expect(first.value).toContain("<user_preferences>");
		expect(first.value).toContain(prefs);
		expect(first.value.endsWith("</user_preferences>")).toBe(true);
		expect(later.value).not.toContain("<conducted_context>");
		expect(later.value).toContain(prefs);
	});

	test("mentions expand, their files gain a size, and each pull request gets one stub", async () => {
		const file = join(workspace.workspacePath, "src/a b.ts");
		const { assembler, calls } = makeAssembler({
			files: makeFiles({ sizes: { [file]: 1234 } }),
		});
		const result = await assembler.assemble({
			text: `fix ${formatFileMention("src/a b.ts")} and ${formatPullRequestMention(12)}`,
			attachmentPaths: [],
			firstMessage: false,
			workspace,
			config,
			pullRequestRepositoryFullName: "acme/app",
		});
		if (!result.ok) throw new Error(result.error.message);
		expect(result.value).toContain("fix src/a b.ts and [pull request 12](");
		expect(result.value).toContain(".context/pull-requests/12.md)");
		expect(result.value).toContain("- src/a b.ts (1.2 KB)");
		expect(calls).toEqual([
			{
				workspacePath: "/work/my tree",
				number: 12,
				repositoryFullName: "acme/app",
			},
		]);
	});

	test("a review-comment file adds its own file mentions to the referenced list", async () => {
		const commentPath = ".context/attachments/comments/c1.md";
		const absoluteComment = join(workspace.workspacePath, commentPath);
		const mentioned = join(workspace.workspacePath, "src/from-comment.ts");
		const { assembler } = makeAssembler({
			files: makeFiles({
				texts: {
					[absoluteComment]: ok(`See ${formatFileMention("src/from-comment.ts")}.`),
				},
				sizes: { [absoluteComment]: 100, [mentioned]: 2048 },
			}),
		});
		const result = await assembler.assemble({
			text: "Please handle the review comment.",
			attachmentPaths: [commentPath],
			firstMessage: false,
			workspace,
			config,
		});
		if (!result.ok) throw new Error(result.error.message);
		expect(result.value).toContain("- src/from-comment.ts (2 KB)");
		expect(result.value).toContain(`- ${commentPath} (100 B)`);
	});

	test("an unreadable review-comment file is logged and the message still goes out", async () => {
		const { assembler, records } = makeAssembler({});
		const result = await assembler.assemble({
			text: "Handle it",
			attachmentPaths: [".context/attachments/comments/c2.md"],
			firstMessage: false,
			workspace,
			config,
		});
		if (!result.ok) throw new Error(result.error.message);
		expect(result.value).toContain("Handle it");
		expect(
			records.some(
				(record) =>
					record.level === "warn" && record.message === "Could not read review-comment attachment",
			),
		).toBe(true);
	});

	test("a failing stub write is logged, and the message keeps its link", async () => {
		const { assembler, records } = makeAssembler({
			stubResult: err(appError("DISK_FULL", "The disk is full.")),
		});
		const result = await assembler.assemble({
			text: `see ${formatPullRequestMention(7)}`,
			attachmentPaths: [],
			firstMessage: false,
			workspace,
			config,
		});
		if (!result.ok) throw new Error(result.error.message);
		expect(result.value).toContain(".context/pull-requests/7.md");
		expect(
			records.some(
				(record) =>
					record.level === "warn" && record.message === "Could not write the pull-request stub",
			),
		).toBe(true);
	});

	test("agents without an add-dir flag get the linked folders, Claude does not", async () => {
		const codex: SessionConfig = {
			...config,
			agent: "codex",
			additionalDirectories: ["/shared/lib"],
		};
		const { assembler } = makeAssembler({});
		const codexResult = await assembler.assemble({
			text: "Work",
			attachmentPaths: [],
			firstMessage: false,
			workspace,
			config: codex,
		});
		const claudeResult = await assembler.assemble({
			text: "Work",
			attachmentPaths: [],
			firstMessage: false,
			workspace,
			config: { ...config, additionalDirectories: ["/shared/lib"] },
		});
		const acpResult = await assembler.assemble({
			text: "Work",
			attachmentPaths: [],
			firstMessage: false,
			workspace,
			config: { ...config, agent: "acp", additionalDirectories: ["/shared/lib"] },
		});
		if (!codexResult.ok || !claudeResult.ok || !acpResult.ok) throw new Error("assemble failed");
		expect(codexResult.value).toContain("<linked_directories>");
		expect(codexResult.value).toContain("- /shared/lib");
		expect(claudeResult.value).not.toContain("<linked_directories>");
		expect(acpResult.value).not.toContain("<linked_directories>");
	});

	test("a pull-request stub is written once and an existing file is kept", async () => {
		const dir = mkdtempSync(join(tmpdir(), "conducted-side-09-"));
		try {
			const first = await writePullRequestStubFile(dir, 12, "acme/app");
			expect(first.ok).toBe(true);
			const target = join(dir, ".context/pull-requests/12.md");
			const content = readFileSync(target, "utf8");
			expect(content).toContain("# Pull request #12");
			expect(content).toContain("https://github.com/acme/app/pull/12");

			writeFileSync(target, "notes from the agent\n");
			const second = await writePullRequestStubFile(dir, 12, "acme/app");
			expect(second.ok).toBe(true);
			expect(readFileSync(target, "utf8")).toBe("notes from the agent\n");

			const withoutRepository = await writePullRequestStubFile(dir, 13);
			expect(withoutRepository.ok).toBe(true);
			expect(readFileSync(join(dir, ".context/pull-requests/13.md"), "utf8")).toBe(
				"# Pull request #13\n",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
