/**
 * @feature SIDE-24 Chat titles and branch names from a short run of the user's own agent
 * Owns: asking the sidecar's `runUtilityPrompt` for a chat title after the first answer of a new
 * chat, and for a branch name after the first message of a workspace, and deciding when to skip
 * the call.
 * Behaviour: other-runners.md 2.2 (one-shot prompts through a throwaway session), services-map.md
 * 2.4 and 5B (title and branch-name prompts), 3.11 (the branch is renamed once after the first
 * message). The decision is D030 in docs/decisions.md.
 * Must handle: a chat or branch the user named (skip); a linked pull request, or a branch that
 * already changed (skip the branch name); an empty answer, or one equal to the placeholder (keep the
 * placeholder); an agent that is not signed in (the call fails, nothing is written); the privacy
 * switch for AI generated titles, and data privacy mode (no call at all, so the chat text never
 * leaves the user's own agent); a branch-name clash (retry once with a suffix); a failure (the
 * placeholder stays, one log line, no resend: D016); the cheapest model of the chat's own agent
 * (from its catalog).
 * Our design choice: the switch reaches the service as a function, because the settings registry
 * has no key for "AI generated chat titles" yet. The prompt text is ours, not Conductor's (D002).
 * Test first: with `titlesEnabled` returning false, `suggestChatTitle` returns `ok(null)` and
 * sends no request to the sidecar.
 */
import type { AgentLaunch } from "@conducted/protocol";
import { notImplemented, type Result } from "@conducted/shared";
import type { Session, Workspace } from "../model.ts";
import type { SidecarClient } from "../sidecar/tunnel.ts";

export interface ChatTitleServiceDeps {
	sidecar: Pick<SidecarClient, "request">;
	/** False when the user turned off AI generated titles or data privacy mode is on. */
	titlesEnabled: () => boolean;
	/** The cheapest model of an agent's catalog, or null when the catalog is empty. */
	cheapestModel: (session: Session) => string | null;
	/** How to start the chat's agent: program path, environment and keys (SIDE-21). */
	launchFor: (session: Session) => AgentLaunch;
}

/** What the title call needs from the chat. */
export interface ChatTitleInput {
	session: Session;
	workspace: Workspace;
	firstUserMessage: string;
	/** The agent's first answer, cut to what fits a short prompt. */
	firstAnswer: string;
}

export class ChatTitleService {
	readonly #deps: ChatTitleServiceDeps;

	constructor(deps: ChatTitleServiceDeps) {
		this.#deps = deps;
	}

	/** The new title, or `ok(null)` when the call was skipped or gave nothing usable. */
	suggestChatTitle(_input: ChatTitleInput): Promise<Result<string | null>> {
		void this.#deps;
		return notImplemented("SIDE-24");
	}

	/** The new branch name without the user's prefix, or `ok(null)` when skipped. */
	suggestBranchName(_input: Omit<ChatTitleInput, "firstAnswer">): Promise<Result<string | null>> {
		return notImplemented("SIDE-24");
	}
}
