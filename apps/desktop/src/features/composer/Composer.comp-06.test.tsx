/**
 * @feature COMP-06 / slash commands
 * Owns: tests over the real container that Enter on the composer's open '/' menu goes to the
 * menu, not to the send key.
 * Behaviour: ui-map.md 3.5 (choosing a command by Enter; "This command isn't available in this
 * workspace."), 5.4 (Enter sends).
 * Test first: Enter on the open '/' menu runs the chosen command and sends nothing.
 */
import type { SessionConfig } from "@conducted/protocol";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { Toaster, toast } from "../../ui/Toast.tsx";
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
	toast.dismiss();
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
	await test.container.services.settings.start();
	const workspace = await seedWorkspace(test.container);
	const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>
			<CommandDispatcher>
				{children}
				<Toaster />
			</CommandDispatcher>
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
	return { send, editor: () => editor as unknown as Editor, test, workspace, session };
}

describe("COMP-06 Enter on the open '/' menu", () => {
	it("runs the chosen command and sends nothing", async () => {
		const { send, editor } = await setup();
		const textbox = screen.getByRole("textbox", { name: "composer" });

		act(() => editor().commands.insertContent("/add-dir"));
		await screen.findByRole("option", { name: /\/add-dir/ });
		fireEvent.keyDown(textbox, { key: "Enter" });

		expect(await screen.findByPlaceholderText("Search workspaces...")).toBeTruthy();
		expect(editor().getText()).toBe("");
		expect(send).not.toHaveBeenCalled();
	});

	it("says a command with no row is not available, and sends nothing", async () => {
		const { send, editor } = await setup();
		const textbox = screen.getByRole("textbox", { name: "composer" });

		act(() => editor().commands.insertContent("/zzzzqq"));
		await screen.findByText("No results found");
		fireEvent.keyDown(textbox, { key: "Enter" });

		expect(await screen.findByText("This command isn't available in this workspace.")).toBeTruthy();
		expect(editor().getText()).toBe("/zzzzqq");
		expect(send).not.toHaveBeenCalled();
	});

	it("runs /clear as the real clear action, closing the old chat", async () => {
		const { send, editor, test, workspace, session } = await setup();
		const textbox = screen.getByRole("textbox", { name: "composer" });

		act(() => editor().commands.insertContent("/clear"));
		await screen.findByRole("option", { name: /\/clear/ });
		fireEvent.keyDown(textbox, { key: "Enter" });

		await waitFor(() => {
			const state = test.container.services.sessions.store.getState();
			expect(state.sessions[session.id]?.closedAt).not.toBeNull();
			const open = state.byWorkspace[workspace.id] ?? [];
			expect(open).toHaveLength(1);
			expect(open[0]).not.toBe(session.id);
		});
		expect(send).not.toHaveBeenCalled();
	});
});
