/**
 * @feature NAV-10 Close a running chat
 * Owns: the dialog's words for one chat, several chats, a chat waiting on background tasks, and a
 * chat whose agent is not named.
 * Behaviour: research/conductor/success-side-effects.md row 6, renderApp @11398676.
 * Test first: a chat waiting on background tasks says closing it will stop them.
 */
import { describe, expect, it } from "vitest";
import type { Session } from "../../core/model.ts";
import { closeChatDialogText } from "./CloseChatDialog.tsx";

function session(agent: Session["config"]["agent"]): Session {
	return {
		id: "s1" as Session["id"],
		workspaceId: "w1" as Session["workspaceId"],
		title: null,
		config: { agent } as Session["config"],
		agentSessionId: null,
		forkResumeNativeMessageId: null,
		unreadCount: 0,
		contextUsedTokens: null,
		queuePausedAt: null,
		closedAt: null,
		lastUserMessageAt: null,
		createdAt: 0,
		updatedAt: 0,
	};
}

describe("NAV-10 close chat dialog words", () => {
	it("a chat waiting on background tasks says closing it will stop them", () => {
		expect(
			closeChatDialogText({ runningCount: 1, session: session("claude"), waiting: true }),
		).toEqual({
			title: "Close running chat?",
			description: "This chat is waiting for background tasks. Closing it will stop them.",
		});
	});

	it("names the agent being cancelled", () => {
		expect(
			closeChatDialogText({ runningCount: 1, session: session("codex"), waiting: false }),
		).toEqual({
			title: "Close running chat?",
			description: "This chat is currently running. Closing it will cancel Codex.",
		});
	});

	it("falls back to 'the agent' when no chat is named", () => {
		expect(
			closeChatDialogText({ runningCount: 1, session: null, waiting: false }).description,
		).toBe("This chat is currently running. Closing it will cancel the agent.");
	});

	it("uses the plural words for several chats", () => {
		expect(
			closeChatDialogText({
				runningCount: 3,
				session: session("claude"),
				waiting: false,
			}),
		).toEqual({
			title: "Close running chats?",
			description: "3 chats are currently running. Closing them will stop their agents.",
		});
	});
});
