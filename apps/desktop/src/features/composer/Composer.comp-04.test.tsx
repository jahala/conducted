/**
 * @feature COMP-04 @ file mentions
 * Owns: tests over the real container that Enter on the composer's open '@' menu goes to the menu,
 * not to the send key.
 * Behaviour: ui-map.md 3.5 ('@' mentions: Enter chooses a row), 5.4 (Enter sends).
 * Test first: Enter on the open '@' menu inserts the row's chip and sends nothing.
 */
import type { SessionConfig } from "@conducted/protocol";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
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
	vi.restoreAllMocks();
	active?.close();
	active = undefined;
});

const must = <T,>(
	result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

async function setup() {
	const test = createTestContainer();
	active = test;
	const workspace = await seedWorkspace(test.container, { linkedPaths: ["/code/shared"] });
	const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>
			<CommandDispatcher>{children}</CommandDispatcher>
		</ServicesProvider>
	);
	let editor: Editor | null = null;
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
	const send = vi.spyOn(test.container.actions.sessions, "send");
	return { send, editor: () => editor as unknown as Editor };
}

describe("COMP-04 Enter on the open '@' menu", () => {
	it("chooses the row and sends nothing", async () => {
		const { send, editor } = await setup();
		const textbox = screen.getByRole("textbox", { name: "composer" });

		act(() => editor().commands.insertContent("@code/shared"));
		await screen.findByRole("option", { name: /\/code\/shared/ });
		fireEvent.keyDown(textbox, { key: "Enter" });

		await waitFor(() =>
			expect(editor().getJSON().content?.[0]?.content?.[0]).toMatchObject({
				type: "fileMention",
				attrs: { path: "/code/shared" },
			}),
		);
		expect(send).not.toHaveBeenCalled();
	});

	it("does nothing with Enter or Tab while no row matches", async () => {
		const { send, editor } = await setup();
		const textbox = screen.getByRole("textbox", { name: "composer" });

		act(() => editor().commands.insertContent("@zzzzqq"));
		await screen.findByText("No files found");
		fireEvent.keyDown(textbox, { key: "Tab" });
		fireEvent.keyDown(textbox, { key: "Enter" });

		expect(editor().getText()).toBe("@zzzzqq");
		expect(send).not.toHaveBeenCalled();
	});
});
