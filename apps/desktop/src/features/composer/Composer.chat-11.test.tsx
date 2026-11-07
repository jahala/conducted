/**
 * @feature CHAT-11 Tool approval card
 * Owns: the test that a tool approval, over the real container, takes the place of the composer's
 * text box, as Conductor draws it (renderApp @9315874; D098), and that the text box comes back
 * with its draft once the approval is answered.
 * Test first: an open tool approval shows the card inside the composer and hides the text box.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { InteractionId, ToolUseId } from "@conducted/shared";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { Composer } from "./Composer.tsx";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
};

afterEach(cleanup);

describe("CHAT-11 the approval card in the composer", () => {
	it("takes the text box's place and gives it back, with its text, once answered", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const created = await test.container.services.sessions.create(workspace.id, CONFIG);
			if (!created.ok) throw new Error(JSON.stringify(created.error));
			const session = created.value;
			let editor: Editor | null = null;
			render(
				<ServicesProvider container={test.container}>
					<Composer
						workspaceId={workspace.id}
						sessionId={session.id}
						onEditorReady={(ready: Editor | null) => {
							editor = ready;
						}}
					/>
				</ServicesProvider>,
			);
			await waitFor(() => expect(editor).not.toBeNull());
			act(() => {
				(editor as unknown as Editor).commands.insertContent("half a thought");
			});

			const interactionId = "i1" as InteractionId;
			act(() => {
				void test.container.services.sessions.requestInteraction({
					sessionId: session.id,
					interactionId,
					interaction: {
						kind: "tool_approval",
						toolUseId: "t1" as ToolUseId,
						toolName: "Bash",
						input: { command: "ls" },
					},
				});
			});

			const card = await screen.findByRole("group", { name: "Tool approval" });
			expect(within(card).getByRole("button", { name: "Yes" })).toBeTruthy();
			expect(screen.queryByRole("textbox", { name: "composer" })).toBeNull();

			act(() => {
				test.container.services.sessions.store.setState((state) => {
					const { [session.id]: _answered, ...rest } = state.openInteractions;
					return { openInteractions: rest };
				});
			});

			const box = await screen.findByRole("textbox", { name: "composer" });
			expect(box.textContent).toBe("half a thought");
			expect(screen.queryByRole("group", { name: "Tool approval" })).toBeNull();
		} finally {
			test.close();
		}
	});
});
