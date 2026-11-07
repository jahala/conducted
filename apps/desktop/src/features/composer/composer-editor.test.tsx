import type { SessionId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerEditor } from "./ComposerEditor.tsx";
import type { SendIntent, SendWith } from "./send-key.ts";

afterEach(cleanup);

const sessionId = "chat-1" as SessionId;

async function mountEditor(sendWith: SendWith = "enter") {
	const onSubmit = vi.fn<(intent: SendIntent) => void>();
	let editor: Editor | null = null;
	render(
		<ComposerEditor
			sessionId={sessionId}
			disabled={false}
			onSubmit={onSubmit}
			sendWith={sendWith}
			onEditorReady={(ready) => {
				editor = ready;
			}}
		/>,
	);
	await waitFor(() => expect(editor).not.toBeNull());
	const ready = editor as unknown as Editor;
	await waitFor(() => expect(ready.view.dom).toBeTruthy());
	return { onSubmit, editor: ready };
}

const type = (editor: Editor, text: string) => {
	act(() => {
		editor.commands.insertContent(text);
	});
};

describe("COMP-01 ComposerEditor", () => {
	it("takes the keyboard focus when it opens, as Conductor's composer does", async () => {
		const { editor } = await mountEditor();
		await waitFor(() => expect(document.activeElement).toBe(editor.view.dom));
	});

	it("leaves the focus alone while it is disabled", async () => {
		render(<ComposerEditor sessionId={sessionId} disabled onSubmit={vi.fn()} />);
		await waitFor(() => expect(screen.getByLabelText("composer")).toBeTruthy());
		expect(document.activeElement).toBe(document.body);
	});

	it("shows the placeholder and carries the screen reader name 'composer'", async () => {
		render(<ComposerEditor sessionId={sessionId} disabled={false} onSubmit={vi.fn()} />);
		// Conductor's placeholder for a chat's composer.
		expect(screen.getByText("Ask to make changes, @mention files, run /commands")).toBeTruthy();
		await waitFor(() => expect(screen.getByLabelText("composer")).toBeTruthy());
	});

	it("sends 'hello' on Enter in Enter mode", async () => {
		const { onSubmit, editor } = await mountEditor("enter");
		type(editor, "hello");
		await waitFor(() => expect(editor.getText()).toBe("hello"));
		fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		expect(onSubmit).toHaveBeenCalledWith("submit");
	});

	it("inserts a new line on Shift+Enter instead of sending", async () => {
		const { onSubmit, editor } = await mountEditor("enter");
		type(editor, "hello");
		fireEvent.keyDown(editor.view.dom, { key: "Enter", shiftKey: true });
		expect(onSubmit).not.toHaveBeenCalled();
		await waitFor(() => expect(editor.getText()).toContain("\n"));
	});

	it("sends on Cmd+Enter and adds a line on Enter in Cmd+Enter mode", async () => {
		const { onSubmit, editor } = await mountEditor("mod_enter");
		type(editor, "hello");
		fireEvent.keyDown(editor.view.dom, { key: "Enter" });
		expect(onSubmit).not.toHaveBeenCalled();
		fireEvent.keyDown(editor.view.dom, { key: "Enter", metaKey: true });
		expect(onSubmit).toHaveBeenCalledWith("submit");
	});

	it("sends the opposite way on Cmd+Enter in Enter mode", async () => {
		const { onSubmit, editor } = await mountEditor("enter");
		type(editor, "hello");
		fireEvent.keyDown(editor.view.dom, { key: "Enter", metaKey: true });
		expect(onSubmit).toHaveBeenCalledWith("submit_opposite");
	});

	it("does not send while text composition is in progress", async () => {
		const { onSubmit, editor } = await mountEditor("enter");
		type(editor, "こ");
		fireEvent.keyDown(editor.view.dom, { key: "Enter", isComposing: true, keyCode: 229 });
		expect(onSubmit).not.toHaveBeenCalled();
	});
});
