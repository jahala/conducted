/**
 * @feature SIDE-24 Chat titles and branch names from a short run of the user's own agent
 * Owns: asking the sidecar's `runUtilityPrompt` for a chat title after the first answer of a new
 * chat, and for a branch name after the first message of a workspace, and deciding when to skip
 * the call.
 * Behaviour: other-runners.md 2.2 (one-shot prompts through a throwaway session), services-map.md
 * 2.4 and 5B (title and branch-name prompts), 3.11 (the branch is renamed once after the first
 * message). The decision is D030 in docs/decisions.md.
 * Must handle: a chat the user named or a branch that already changed (skip); a linked pull
 * request (skip the branch name); an empty answer, or one equal to the placeholder (keep the
 * placeholder); an agent that is not signed in (the call fails, nothing is written); a failure
 * (the placeholder stays and one log line is written; the app never resends the call, D016); the
 * `<none>` escape hatch a branch prompt may return.
 * The privacy switch, the cheapest model, the launch and the sidecar client arrive as injected
 * functions. When `titlesEnabled` is false this file sends no request, so the chat text never
 * leaves the user's own agent.
 * The branch's prefix, its clash retry and the rename itself belong to WS-04. The repository's
 * Rename branch prompt is appended to the branch prompt when the repository has one.
 * Our design choice: this service does no settings, catalogue or launch work. Building it belongs
 * to APP-01 (`core/container.ts`): the "AI generated chat titles" key and the
 * `enterprise_data_privacy` consumer belong to SET-02, the launch to SIDE-21, the first-answer
 * call site to CHAT-01/CHAT-02, and the branch call site to WS-04. The prompt text is ours, not
 * Conductor's (D002).
 * Test first: with `titlesEnabled` returning false, `suggestChatTitle` returns `ok(null)` and
 * sends no request to the sidecar.
 */
import type { AgentLaunch } from "@conducted/protocol";
import { type AcpAgent, appError, err, ok, type Result } from "@conducted/shared";
import type { Session, Workspace } from "../model.ts";
import type { SidecarClient } from "../sidecar/tunnel.ts";

/** The name the chat list shows until a title is generated. */
export const DEFAULT_CHAT_TITLE = "New chat";
/** What a branch prompt replies when the task suggests no name. */
export const NO_BRANCH_NAME = "<none>";
export const MAX_CHAT_TITLE_LENGTH = 80;
export const MAX_BRANCH_NAME_LENGTH = 30;

export interface ChatTitleServiceDeps {
	sidecar: Pick<SidecarClient, "request">;
	/** False when the user turned off AI generated titles or data privacy mode is on. */
	titlesEnabled: () => boolean;
	/** The cheapest model of an agent's catalog, or null when the catalog is empty. */
	cheapestModel: (session: Session) => string | null;
	/**
	 * How to start the chat's agent: program path, environment and keys (SIDE-21). A launch that
	 * cannot be built (a Keychain value is missing) is an error, and nothing is sent.
	 */
	launchFor: (session: Session) => Promise<Result<AgentLaunch>>;
	/** One line for a call that failed. */
	log: (level: "warn" | "info", message: string) => void;
}

/** What the title call needs from the chat. */
export interface ChatTitleInput {
	session: Session;
	workspace: Workspace;
	firstUserMessage: string;
	/** The agent's first answer; the title prompt carries it whole. */
	firstAnswer: string;
	/** The repository's Rename branch prompt, added to the built-in branch text. */
	customPrompt?: string | null;
}

export class ChatTitleService {
	readonly #deps: ChatTitleServiceDeps;

	constructor(deps: ChatTitleServiceDeps) {
		this.#deps = deps;
	}

	/** The new title, or `ok(null)` when the call was skipped or gave nothing usable. */
	async suggestChatTitle(input: ChatTitleInput): Promise<Result<string | null>> {
		if (!this.#deps.titlesEnabled()) return ok(null);
		if (input.session.title !== null) return ok(null);
		const answer = input.firstAnswer.trim();
		if (answer === "" || isPlaceholderTitle(answer)) return ok(null);
		const firstMessage = input.firstUserMessage.trim();
		if (firstMessage === "") return ok(null);

		const model = this.#deps.cheapestModel(input.session);
		if (model === null) {
			this.#deps.log("warn", "Failed to generate LLM session title");
			return err(appError("utility_model_missing", "No model is available to name this chat."));
		}

		const launch = await this.#deps.launchFor(input.session);
		if (!launch.ok) {
			this.#deps.log("warn", "Failed to generate LLM session title");
			return launch;
		}
		const asked = await this.#deps.sidecar.request("runUtilityPrompt", {
			...agentRef(input.session),
			model,
			prompt: chatTitlePrompt(firstMessage, input.firstAnswer.trim()),
			cwd: input.workspace.path,
			fastMode: input.session.config.fastMode,
			launch: launch.value,
		});
		if (!asked.ok) {
			this.#deps.log("warn", "Failed to generate LLM session title");
			return err(asked.error);
		}
		return ok(cleanChatTitle(asked.value.text));
	}

	/** The new branch name without the user's prefix, or `ok(null)` when skipped. */
	async suggestBranchName(
		input: Omit<ChatTitleInput, "firstAnswer">,
	): Promise<Result<string | null>> {
		if (!this.#deps.titlesEnabled()) return ok(null);
		if (!input.workspace.branchIsPlaceholder) return ok(null);
		if (input.workspace.prNumber !== null) return ok(null);
		const firstMessage = input.firstUserMessage.trim();
		if (firstMessage === "") return ok(null);

		const model = this.#deps.cheapestModel(input.session);
		if (model === null) {
			this.#deps.log("warn", "Failed to generate a branch name");
			return err(appError("utility_model_missing", "No model is available to name this branch."));
		}

		const launch = await this.#deps.launchFor(input.session);
		if (!launch.ok) {
			this.#deps.log("warn", "Failed to generate a branch name");
			return launch;
		}
		const asked = await this.#deps.sidecar.request("runUtilityPrompt", {
			...agentRef(input.session),
			model,
			prompt: branchNamePrompt(firstMessage, input.customPrompt ?? null),
			cwd: input.workspace.path,
			fastMode: input.session.config.fastMode,
			launch: launch.value,
		});
		if (!asked.ok) {
			this.#deps.log("warn", "Failed to generate a branch name");
			return err(asked.error);
		}
		return ok(cleanBranchName(asked.value.text, input.workspace.branch));
	}
}

function agentRef(session: Session): {
	agent: Session["config"]["agent"];
	acpAgent?: AcpAgent;
} {
	return {
		agent: session.config.agent,
		...(session.config.acpAgent === undefined ? {} : { acpAgent: session.config.acpAgent }),
	};
}

function chatTitlePrompt(firstMessage: string, firstAnswer: string): string {
	return [
		"Write a short title for this chat.",
		"Use at most six words. Reply with the title only, without quotes or a full stop.",
		"",
		"The user's first message:",
		firstMessage,
		"",
		"The agent's first answer:",
		firstAnswer,
	].join("\n");
}

function branchNamePrompt(firstMessage: string, customPrompt: string | null): string {
	const lines = [
		"Write a short git branch name for this task.",
		"Use lowercase words joined by hyphens, at most 30 characters, with no prefix.",
		`Reply with the name only. If the task suggests no clear name, reply ${NO_BRANCH_NAME}.`,
		"",
		"The user's first message:",
		firstMessage,
	];
	const custom = customPrompt?.trim() ?? "";
	if (custom !== "") {
		lines.push("", "Repository instructions for naming the branch:", custom);
	}
	return lines.join("\n");
}

function firstNonEmptyLine(text: string): string | null {
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed !== "") return trimmed;
	}
	return null;
}

function stripWrappingQuotes(text: string): string {
	return text
		.replace(/^["'`]+/, "")
		.replace(/["'`]+$/, "")
		.trim();
}

function isPlaceholderTitle(title: string): boolean {
	return title.toLowerCase() === DEFAULT_CHAT_TITLE.toLowerCase();
}

function cleanChatTitle(raw: string): string | null {
	const line = firstNonEmptyLine(raw);
	if (line === null) return null;
	const title = stripWrappingQuotes(line);
	if (title === "" || isPlaceholderTitle(title)) return null;
	return title.length > MAX_CHAT_TITLE_LENGTH
		? title.slice(0, MAX_CHAT_TITLE_LENGTH).trimEnd()
		: title;
}

function cleanBranchName(raw: string, placeholder: string): string | null {
	const line = firstNonEmptyLine(raw);
	if (line === null) return null;
	if (line.toLowerCase() === NO_BRANCH_NAME) return null;
	let name = stripWrappingQuotes(line)
		.toLowerCase()
		.replace(/[^a-z0-9._/-]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^[-./]+|[-./]+$/g, "");
	if (name.length > MAX_BRANCH_NAME_LENGTH) {
		name = name.slice(0, MAX_BRANCH_NAME_LENGTH).replace(/[-./]+$/g, "");
	}
	if (name === "" || name === placeholder.toLowerCase()) return null;
	return name;
}
