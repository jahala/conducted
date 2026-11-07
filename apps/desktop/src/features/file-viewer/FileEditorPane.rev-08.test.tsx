/**
 * @feature REV-08 File editor pane
 * Tests the pane over the real CodeMirror surface and the real container: a disk reload that keeps
 * a clean file clean, the deleted-file banner's two answers, a draft that outlives the pane, and
 * the find bar driving the editor's selection, Replace and Replace All. Edits are CodeMirror
 * transactions dispatched on the live view, as typing makes them.
 */
import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { FileEditorPane } from "./FileEditorPane.tsx";

afterEach(cleanup);

function wrapper(
	container: ReturnType<typeof createTestContainer>["container"],
	client: QueryClient,
) {
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<ServicesProvider container={container}>
				<CommandDispatcher>
					<div data-file-viewer>{children}</div>
				</CommandDispatcher>
			</ServicesProvider>
		</QueryClientProvider>
	);
}

async function setup(path: string, text = "one") {
	let now = 1_700_000_000_000;
	const test = createTestContainer({ clock: { now: () => now } });
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const workspace = await seedWorkspace(test.container, { path });
	const absolute = `${workspace.path}/a.ts`;
	const writeDisk = async (next: string): Promise<void> => {
		now += 1_000;
		await test.container.platform.fs.writeTextAtomic(absolute, next);
	};
	await writeDisk(text);
	const reread = () =>
		client.invalidateQueries({ queryKey: ["files", "content", workspace.id, "a.ts"] });
	return { test, client, workspace, absolute, writeDisk, reread };
}

/** The live editor view, once the pane shows it. */
async function editorView(): Promise<EditorView> {
	let view: EditorView | null = null;
	await waitFor(() => {
		const editor = document.querySelector<HTMLElement>(".cm-editor");
		view = editor === null ? null : EditorView.findFromDOM(editor);
		expect(view).not.toBeNull();
	});
	const found = view as EditorView | null;
	if (found === null) throw new Error("No editor is mounted.");
	return found;
}

const docOf = (view: EditorView): string => view.state.doc.toString();

/** Types at the end of the document, as one user transaction. */
function typeAtEnd(view: EditorView, text: string): void {
	act(() => {
		view.dispatch({ changes: { from: view.state.doc.length, insert: text } });
	});
}

function pressOnRoot(key: string): void {
	const root = document.querySelector("[data-file-viewer]");
	if (root === null) throw new Error("No file viewer root.");
	fireEvent.keyDown(root, { key, metaKey: true });
}

describe("REV-08 FileEditorPane over the real editor", () => {
	it("reloads a clean file from disk and keeps it clean", async () => {
		const { test, client, workspace, writeDisk, reread } = await setup(
			"/code/workspaces/real-clean",
		);
		try {
			const onDirtyChange = vi.fn();
			render(
				<FileEditorPane workspaceId={workspace.id} path="a.ts" onDirtyChange={onDirtyChange} />,
				{ wrapper: wrapper(test.container, client) },
			);
			const view = await editorView();
			await writeDisk("two");
			await reread();

			await waitFor(() => expect(docOf(view)).toBe("two"));
			expect(onDirtyChange).not.toHaveBeenCalledWith(true);
			expect(screen.queryByText("File changed on disk")).toBeNull();
		} finally {
			client.clear();
			test.close();
		}
	});

	it("keeps a deleted file's draft quiet after Keep mine while the user types on", async () => {
		const { test, client, workspace, absolute, reread } = await setup(
			"/code/workspaces/real-deleted-keep",
		);
		try {
			render(<FileEditorPane workspaceId={workspace.id} path="a.ts" />, {
				wrapper: wrapper(test.container, client),
			});
			const view = await editorView();
			typeAtEnd(view, " mine");
			test.memory.controls.files.delete(absolute);
			await reread();

			fireEvent.click(await screen.findByRole("button", { name: "Keep mine" }));
			expect(screen.queryByText("File was deleted on disk")).toBeNull();
			typeAtEnd(view, " more");

			expect(docOf(view)).toBe("one mine more");
			expect(screen.queryByText("File was deleted on disk")).toBeNull();
		} finally {
			client.clear();
			test.close();
		}
	});

	it("drops a deleted file's draft on Discard my edits", async () => {
		const { test, client, workspace, absolute, reread } = await setup(
			"/code/workspaces/real-deleted-discard",
		);
		try {
			render(<FileEditorPane workspaceId={workspace.id} path="a.ts" />, {
				wrapper: wrapper(test.container, client),
			});
			typeAtEnd(await editorView(), " mine");
			test.memory.controls.files.delete(absolute);
			await reread();

			fireEvent.click(await screen.findByRole("button", { name: "Discard my edits" }));

			expect(await screen.findByText("File not found")).toBeTruthy();
			expect(document.querySelector(".cm-editor")).toBeNull();
		} finally {
			client.clear();
			test.close();
		}
	});

	it("keeps the draft when the pane unmounts and mounts again", async () => {
		const { test, client, workspace } = await setup("/code/workspaces/real-remount");
		try {
			const first = render(<FileEditorPane workspaceId={workspace.id} path="a.ts" />, {
				wrapper: wrapper(test.container, client),
			});
			typeAtEnd(await editorView(), " edited");
			first.unmount();

			render(<FileEditorPane workspaceId={workspace.id} path="a.ts" />, {
				wrapper: wrapper(test.container, client),
			});

			expect(docOf(await editorView())).toBe("one edited");
		} finally {
			client.clear();
			test.close();
		}
	});

	it("selects each match in the editor as Next moves", async () => {
		const { test, client, workspace } = await setup("/code/workspaces/real-find", "one two one");
		try {
			render(<FileEditorPane workspaceId={workspace.id} path="a.ts" />, {
				wrapper: wrapper(test.container, client),
			});
			const view = await editorView();
			pressOnRoot("f");
			fireEvent.change(await screen.findByRole("textbox", { name: "Find" }), {
				target: { value: "one" },
			});

			fireEvent.click(screen.getByRole("button", { name: "Next" }));
			expect(view.state.selection.main.from).toBe(0);
			expect(view.state.selection.main.to).toBe(3);
			fireEvent.click(screen.getByRole("button", { name: "Next" }));
			expect(view.state.selection.main.from).toBe(8);
			expect(view.state.selection.main.to).toBe(11);
		} finally {
			client.clear();
			test.close();
		}
	});

	it("replaces the first match when Replace is pressed before Next", async () => {
		const { test, client, workspace } = await setup("/code/workspaces/real-replace", "one two one");
		try {
			render(<FileEditorPane workspaceId={workspace.id} path="a.ts" />, {
				wrapper: wrapper(test.container, client),
			});
			const view = await editorView();
			pressOnRoot("f");
			fireEvent.change(await screen.findByRole("textbox", { name: "Find" }), {
				target: { value: "one" },
			});
			fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), {
				target: { value: "1" },
			});

			fireEvent.click(screen.getByRole("button", { name: "Replace" }));

			await waitFor(() => expect(docOf(view)).toBe("1 two one"));
		} finally {
			client.clear();
			test.close();
		}
	});

	it("writes a dollar replacement literally with Replace All", async () => {
		const { test, client, workspace } = await setup("/code/workspaces/real-replace-all", "banana");
		try {
			render(<FileEditorPane workspaceId={workspace.id} path="a.ts" />, {
				wrapper: wrapper(test.container, client),
			});
			const view = await editorView();
			pressOnRoot("f");
			fireEvent.change(await screen.findByRole("textbox", { name: "Find" }), {
				target: { value: "a" },
			});
			fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), {
				target: { value: "$&$" },
			});

			fireEvent.click(screen.getByRole("button", { name: "Replace All" }));

			await waitFor(() => expect(docOf(view)).toBe("b$&$n$&$n$&$"));
		} finally {
			client.clear();
			test.close();
		}
	});
});
