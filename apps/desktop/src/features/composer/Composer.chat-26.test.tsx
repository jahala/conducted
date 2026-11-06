/**
 * @feature CHAT-26 Start a chat with earlier chats and plans
 * Owns: the test that the composer shows a file attached to its draft from outside it (the empty
 * chat's shelves, the Files tab) and keeps it when the user types on.
 * Behaviour: inventory label #340-341 (the shelves attach to the open chat's draft).
 * Test first: a transcript attached through the actions appears on the attachment bar, and typing
 * afterwards keeps it in the draft.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { Result } from "@conducted/shared";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import "../../test/dom-polyfills.ts";
import { Composer } from "./Composer.tsx";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "claude-sonnet-4-5",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

let active: TestContainer | undefined;

afterEach(() => {
	cleanup();
	active?.close();
	active = undefined;
});

const must = <T,>(result: Result<T>): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

describe("CHAT-26 the composer follows its draft's attachments", () => {
	it("shows a file attached from outside and keeps it when the user types", async () => {
		const test = createTestContainer();
		active = test;
		const workspace = await seedWorkspace(test.container);
		const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
		let editor: Editor | null = null;
		const wrapper = ({ children }: { children: ReactNode }) => (
			<ServicesProvider container={test.container}>
				<CommandDispatcher>{children}</CommandDispatcher>
			</ServicesProvider>
		);
		render(
			<Composer
				workspaceId={workspace.id}
				sessionId={session.id}
				onEditorReady={(next) => {
					editor = next;
				}}
			/>,
			{ wrapper },
		);
		await waitFor(() => expect(editor).not.toBeNull());
		await waitFor(() =>
			expect(test.container.services.composer.store.getState().drafts[session.id]).toBeDefined(),
		);

		const path = must(
			await test.container.actions.attachments.addText(
				session.id,
				"Transcript of Login fix.md",
				"Fix the login bug",
			),
		);

		expect(
			await screen.findByRole("button", { name: "Remove Transcript of Login fix.md" }),
		).toBeTruthy();
		act(() => (editor as unknown as Editor).commands.insertContent("Use this"));
		await waitFor(() =>
			expect(test.container.services.composer.draftOf(session.id).text).toBe("Use this"),
		);
		expect(test.container.services.composer.draftOf(session.id).attachmentPaths).toEqual([path]);
	});
});
