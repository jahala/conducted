/**
 * @feature REV-08 FileTab
 * Tests the mode switch, the Cmd+E shortcut through the mounted dispatcher, the preview mode, the
 * unsaved draft kept across Cmd+E, and the header's renamed path, save spinner and save error,
 * over the real container and the real child panes.
 */

import { EditorView } from "@codemirror/view";
import { appError, err, ok, type Result } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import type { FileDiff } from "../../core/api.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { FileTab } from "./FileTab.tsx";

afterEach(cleanup);

const diff: FileDiff = {
	path: "notes.md",
	oldText: "old",
	newText: "new",
	patch: "",
	binary: false,
	tooLarge: false,
};

async function setup(path: string) {
	const test = createTestContainer();
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const workspace = await seedWorkspace(test.container, { path });
	test.memory.controls.addFile(`${workspace.path}/notes.md`, "# Hello from the tab");
	vi.spyOn(test.container.services.fileDiff, "load").mockResolvedValue(ok(diff));
	return { test, client, workspace };
}

function wrapper(
	container: ReturnType<typeof createTestContainer>["container"],
	client: QueryClient,
) {
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<ServicesProvider container={container}>
				<CommandDispatcher>{children}</CommandDispatcher>
			</ServicesProvider>
		</QueryClientProvider>
	);
}

/** Types at the end of the mounted editor, as one user transaction. */
async function typeInEditor(text: string): Promise<EditorView> {
	let view: EditorView | null = null;
	await waitFor(() => {
		const editor = document.querySelector<HTMLElement>(".cm-editor");
		view = editor === null ? null : EditorView.findFromDOM(editor);
		expect(view).not.toBeNull();
	});
	const found = view as EditorView | null;
	if (found === null) throw new Error("No editor is mounted.");
	act(() => {
		found.dispatch({ changes: { from: found.state.doc.length, insert: text } });
	});
	return found;
}

function pressCmd(key: string): void {
	const root = document.querySelector("[data-file-viewer]");
	if (root === null) throw new Error("No file viewer root.");
	fireEvent.keyDown(root, { key, metaKey: true });
}

describe("REV-08 FileTab", () => {
	it("shows the diff pane, the editor after Edit, and the Markdown preview", async () => {
		const { test, client, workspace } = await setup("/code/workspaces/tab-modes");
		try {
			render(
				<FileTab
					workspaceId={workspace.id}
					path="notes.md"
					mode="diff"
					scope={{ kind: "branch" }}
				/>,
				{ wrapper: wrapper(test.container, client) },
			);
			await waitFor(() => expect(document.querySelector("[data-diff]")).not.toBeNull());

			fireEvent.click(screen.getByRole("button", { name: "Edit" }));
			await waitFor(() =>
				expect(document.querySelector(".cm-content")?.textContent).toContain("Hello from the tab"),
			);

			fireEvent.click(screen.getByRole("button", { name: "Preview" }));
			expect(await screen.findByRole("heading", { name: "Hello from the tab" })).toBeTruthy();
		} finally {
			client.clear();
			test.close();
		}
	});

	it("toggles edit mode with Cmd+E through the root dispatcher", async () => {
		const { test, client, workspace } = await setup("/code/workspaces/tab-shortcut");
		try {
			const { container } = render(
				<FileTab
					workspaceId={workspace.id}
					path="notes.md"
					mode="diff"
					scope={{ kind: "branch" }}
				/>,
				{ wrapper: wrapper(test.container, client) },
			);
			const root = container.querySelector("[data-file-viewer]");
			expect(root).not.toBeNull();
			if (root !== null) fireEvent.keyDown(root, { key: "e", metaKey: true });
			await waitFor(() => expect(document.querySelector(".cm-editor")).not.toBeNull());
		} finally {
			client.clear();
			test.close();
		}
	});

	it("keeps unsaved edits when Cmd+E goes to Diff and back", async () => {
		const { test, client, workspace } = await setup("/code/workspaces/tab-keep-draft");
		try {
			render(
				<FileTab
					workspaceId={workspace.id}
					path="notes.md"
					mode="edit"
					scope={{ kind: "branch" }}
				/>,
				{ wrapper: wrapper(test.container, client) },
			);
			await typeInEditor(" edited");
			expect(screen.getByRole("status", { name: "Unsaved changes" })).toBeTruthy();

			pressCmd("e");
			await waitFor(() => expect(document.querySelector(".cm-editor")).toBeNull());
			expect(screen.getByRole("status", { name: "Unsaved changes" })).toBeTruthy();
			pressCmd("e");

			await waitFor(() =>
				expect(document.querySelector(".cm-content")?.textContent).toBe(
					"# Hello from the tab edited",
				),
			);
		} finally {
			client.clear();
			test.close();
		}
	});

	it("shows the old path of a renamed file", async () => {
		const { test, client, workspace } = await setup("/code/workspaces/tab-renamed");
		try {
			vi.spyOn(test.container.services.git, "changedFiles").mockResolvedValue(
				ok([
					{
						path: "notes.md",
						oldPath: "old-notes.md",
						status: "renamed",
						linesAdded: 0,
						linesRemoved: 0,
						binary: false,
						conflicted: false,
						viewed: false,
					},
				]),
			);
			render(
				<FileTab
					workspaceId={workspace.id}
					path="notes.md"
					mode="diff"
					scope={{ kind: "branch" }}
				/>,
				{ wrapper: wrapper(test.container, client) },
			);

			expect(await screen.findByText("from old-notes.md")).toBeTruthy();
		} finally {
			client.clear();
			test.close();
		}
	});

	it("shows the save in flight and then Conductor's Retry update control", async () => {
		const { test, client, workspace } = await setup("/code/workspaces/tab-saving");
		try {
			let finish: (result: Result<{ modifiedAt: number }>) => void = () => {};
			vi.spyOn(test.container.services.workspaceFiles, "saveFile").mockImplementation(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			);
			render(
				<FileTab
					workspaceId={workspace.id}
					path="notes.md"
					mode="edit"
					scope={{ kind: "branch" }}
				/>,
				{ wrapper: wrapper(test.container, client) },
			);
			await typeInEditor(" edited");

			fireEvent.click(screen.getByRole("button", { name: "Save" }));

			expect(await screen.findByRole("status", { name: "Saving file" })).toBeTruthy();
			await act(async () => {
				finish(err(appError("other", "The disk is full.")));
			});
			await waitFor(() =>
				expect(screen.getByRole("button", { name: "Update failed. Retry" })).toBeTruthy(),
			);
			expect(screen.queryByRole("status", { name: "Saving file" })).toBeNull();
			expect(screen.getByRole("status", { name: "Unsaved changes" })).toBeTruthy();
		} finally {
			client.clear();
			test.close();
		}
	});
});

describe("REV-08 FileTab code view", () => {
	it("shows a coloured, line-numbered Entire file for a Rust file", async () => {
		const test = createTestContainer();
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		try {
			const workspace = await seedWorkspace(test.container, {
				path: "/code/workspaces/tab-rust",
			});
			test.memory.controls.addFile(
				`${workspace.path}/src/main.rs`,
				"fn main() {\n    let count = 1;\n}",
			);
			render(
				<FileTab
					workspaceId={workspace.id}
					path="src/main.rs"
					mode="edit"
					scope={{ kind: "branch" }}
				/>,
				{ wrapper: wrapper(test.container, client) },
			);
			fireEvent.click(await screen.findByRole("button", { name: "Entire file" }));
			await waitFor(
				() => {
					const host = document.querySelector("diffs-container");
					const html = host?.shadowRoot?.innerHTML ?? "";
					expect(html).toContain("var(--color-code-keyword)");
					expect(html).toContain("data-line-number-content");
				},
				{ timeout: 8_000 },
			);
		} finally {
			client.clear();
			test.close();
		}
	}, 20_000);
});
