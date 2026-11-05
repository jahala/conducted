/**
 * @feature SIDE-09 Prompt assembly: first-message instruction, mentions, attachments, preferences
 * Owns: building the final text sent to the agent from the user's message, in a fixed order.
 * Behaviour: research/conductor/sessions.md section 9 "Message enrichment" and claude-runner.md
 * section 5: the sidecar, not the app, builds the final message. Order here: workspace instruction
 * (first message only), linked folders (when the agent has no add-dir flag), the expanded message,
 * the attachments block, the preferences block.
 * Must handle:
 *  - the first message gets the instruction block and the user's preferences; later messages do not
 *  - the steer case: a steer is assembled like a later message (no instruction block)
 *  - pull-request mentions: write the stub file once, never overwrite, create .context/pull-requests
 *  - a stub that cannot be written: the message still goes out with the link, the failure is
 *    logged (the agent can ask the user), nothing is dropped silently
 *  - a review-comment attachment: its file mentions join the referenced-files list; an unreadable
 *    file is logged and the message still goes out
 *  - a file whose size cannot be read is listed as "unknown size"
 *  - the stored user_message event keeps the raw text; only the agent sees the assembled one
 * Test first: assemble with firstMessage true starts with the instruction tag and ends with the
 * user's text when there are no attachments or preferences.
 * Our design choice: file reads and the stub write are ports, so the assembler has no hidden I/O.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { SessionConfig, WorkspaceContext } from "@conducted/protocol";
import type { AppError, Result } from "@conducted/shared";
import { appError, err, ok } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import {
	type AttachmentEntry,
	buildAttachmentsBlock,
	buildLinkedDirectoriesBlock,
	buildPreferencesBlock,
} from "./blocks.ts";
import {
	buildPullRequestStub,
	expandMentions,
	fileMentionPaths,
	pullRequestStubPath,
} from "./mentions.ts";
import { buildWorkspaceInstruction } from "./workspace-instruction.ts";

export interface PromptInput {
	text: string;
	attachmentPaths: readonly string[];
	firstMessage: boolean;
	workspace: WorkspaceContext;
	config: SessionConfig;
	/** For example "acme/app". Missing when the repository is not known yet. */
	pullRequestRepositoryFullName?: string;
}

/** File reads the assembler needs. Production uses node:fs; tests pass a fixed map. */
export interface PromptFiles {
	/** Bytes, or null when the file cannot be read. */
	size(path: string): Promise<number | null>;
	/** The text of a file, for review-comment attachments. */
	readText(path: string): Promise<Result<string, AppError>>;
}

export interface PromptAssembler {
	assemble(input: PromptInput): Promise<Result<string, AppError>>;
}

/** Writes `.context/pull-requests/<n>.md` if it does not exist yet. A port; production uses fs. */
export type WritePullRequestStub = (
	workspacePath: string,
	number: number,
	repositoryFullName?: string,
) => Promise<Result<void, AppError>>;

/** The review-comment folder Conductor reserves for files a diff comment sends to a chat. */
const REVIEW_COMMENT_MARKER = ".context/attachments/comments/";

function isReviewCommentAttachment(path: string): boolean {
	const normalized = path.replaceAll("\\", "/");
	return (
		normalized.includes(`/${REVIEW_COMMENT_MARKER}`) || normalized.startsWith(REVIEW_COMMENT_MARKER)
	);
}

function resolveAgainst(workspacePath: string, path: string): string {
	return isAbsolute(path) ? path : join(workspacePath, path);
}

/** Writes a pull-request stub with a create-only open, so an existing file is never replaced. */
export async function writePullRequestStubFile(
	workspacePath: string,
	number: number,
	repositoryFullName?: string,
): Promise<Result<void, AppError>> {
	const relative = pullRequestStubPath(number);
	const target = join(workspacePath, relative);
	try {
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, buildPullRequestStub(number, repositoryFullName), {
			encoding: "utf8",
			flag: "wx",
		});
		return ok(undefined);
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === "EEXIST") return ok(undefined);
		return err(
			appError(
				"PROMPT_PR_STUB_WRITE_FAILED",
				`Could not write the pull-request stub ${relative}.`,
				cause,
			),
		);
	}
}

export class MessagePromptAssembler implements PromptAssembler {
	constructor(
		protected readonly deps: {
			writePullRequestStub: WritePullRequestStub;
			files: PromptFiles;
			logger: Logger;
		},
	) {}

	async assemble(input: PromptInput): Promise<Result<string, AppError>> {
		const expanded = expandMentions(input.text);

		for (const pullRequest of expanded.pullRequests) {
			const written = await this.deps.writePullRequestStub(
				input.workspace.workspacePath,
				pullRequest.number,
				input.pullRequestRepositoryFullName,
			);
			if (!written.ok) {
				this.deps.logger.warn("Could not write the pull-request stub", {
					number: pullRequest.number,
					code: written.error.code,
					message: written.error.message,
				});
			}
		}

		const referencedPaths = new Set(expanded.filePaths);
		for (const attachmentPath of input.attachmentPaths) {
			if (!isReviewCommentAttachment(attachmentPath)) continue;
			const read = await this.deps.files.readText(
				resolveAgainst(input.workspace.workspacePath, attachmentPath),
			);
			if (!read.ok) {
				this.deps.logger.warn("Could not read review-comment attachment", {
					path: attachmentPath,
					code: read.error.code,
					message: read.error.message,
				});
				continue;
			}
			for (const path of fileMentionPaths(read.value)) referencedPaths.add(path);
		}

		const referenced = await this.describePaths(
			[...referencedPaths],
			input.workspace.workspacePath,
		);
		const attached = await this.describePaths(
			[...new Set(input.attachmentPaths)],
			input.workspace.workspacePath,
		);

		const parts: string[] = [];
		if (input.firstMessage) parts.push(buildWorkspaceInstruction(input.workspace));
		// Claude and ACP agents receive the linked folders through their own add-dir option.
		if (input.config.agent !== "claude" && input.config.agent !== "acp") {
			const linked = buildLinkedDirectoriesBlock(input.config.additionalDirectories);
			if (linked !== null) parts.push(linked);
		}
		parts.push(expanded.text);
		const attachments = buildAttachmentsBlock({ referenced, attached });
		if (attachments !== null) parts.push(attachments);
		const preferences = buildPreferencesBlock(input.workspace.userPreferences);
		if (preferences !== null) parts.push(preferences);
		return ok(parts.join("\n\n"));
	}

	private async describePaths(
		paths: readonly string[],
		workspacePath: string,
	): Promise<AttachmentEntry[]> {
		const entries: AttachmentEntry[] = [];
		for (const path of paths) {
			entries.push({
				path,
				sizeBytes: await this.deps.files.size(resolveAgainst(workspacePath, path)),
			});
		}
		return entries;
	}
}
