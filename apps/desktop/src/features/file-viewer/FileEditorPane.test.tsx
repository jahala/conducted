/**
 * @feature REV-08 File editor pane
 * Tests the dirty draft, the disk-change banner, Discard, Save and a binary file's "Open in another
 * app" over the real container, with a textarea in place of the CodeMirror surface so a test can
 * type.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { FileEditorPane } from "./FileEditorPane.tsx";

// seam: REV-08 a textarea drives edits without a CodeMirror DOM, which jsdom cannot edit.
vi.mock("./editor/EditorSurface.tsx", () => ({
	EditorSurface: ({
		text,
		onChange,
		onSave,
	}: {
		text: string;
		onChange: (text: string) => void;
		onSave: () => void;
	}) => (
		<div>
			<textarea
				aria-label="Editor"
				value={text}
				onChange={(event) => onChange(event.target.value)}
			/>
			<button type="button" onClick={onSave}>
				Save now
			</button>
		</div>
	),
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function wrapper(
	container: ReturnType<typeof createTestContainer>["container"],
	client: QueryClient,
) {
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<ServicesProvider container={container}>{children}</ServicesProvider>
		</QueryClientProvider>
	);
}

async function setup(path = "/code/workspaces/editor") {
	let now = 1_700_000_000_000;
	const test = createTestContainer({ clock: { now: () => now } });
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const workspace = await seedWorkspace(test.container, { path });
	const writeDisk = async (text: string): Promise<void> => {
		now += 1_000;
		await test.container.platform.fs.writeTextAtomic(`${workspace.path}/a.ts`, text);
	};
	await writeDisk("one");
	return { test, client, workspace, writeDisk };
}

describe("REV-08 FileEditorPane", () => {
	it("shows the banner and keeps the draft when the disk changed", async () => {
		const { test, client, workspace, writeDisk } = await setup("/code/workspaces/editor-banner");
		try {
			const { rerender } = render(
				<FileEditorPane workspaceId={workspace.id} path="a.ts" onDirtyChange={() => {}} />,
				{ wrapper: wrapper(test.container, client) },
			);
			const editor = await screen.findByRole("textbox", { name: "Editor" });
			fireEvent.change(editor, { target: { value: "one changed" } });

			await writeDisk("from the agent");
			await client.invalidateQueries({ queryKey: ["files", "content", workspace.id, "a.ts"] });
			rerender(<FileEditorPane workspaceId={workspace.id} path="a.ts" onDirtyChange={() => {}} />);

			expect(await screen.findByText("File changed on disk")).toBeTruthy();
			expect((screen.getByRole("textbox", { name: "Editor" }) as HTMLTextAreaElement).value).toBe(
				"one changed",
			);
		} finally {
			client.clear();
			test.close();
		}
	});

	it("replaces the draft with the disk text on Discard my edits", async () => {
		const { test, client, workspace, writeDisk } = await setup("/code/workspaces/editor-discard");
		try {
			const { rerender } = render(
				<FileEditorPane workspaceId={workspace.id} path="a.ts" onDirtyChange={() => {}} />,
				{ wrapper: wrapper(test.container, client) },
			);
			fireEvent.change(await screen.findByRole("textbox", { name: "Editor" }), {
				target: { value: "mine" },
			});
			await writeDisk("their version");
			await client.invalidateQueries({ queryKey: ["files", "content", workspace.id, "a.ts"] });
			rerender(<FileEditorPane workspaceId={workspace.id} path="a.ts" onDirtyChange={() => {}} />);

			fireEvent.click(await screen.findByRole("button", { name: "Discard my edits" }));
			await waitFor(() =>
				expect((screen.getByRole("textbox", { name: "Editor" }) as HTMLTextAreaElement).value).toBe(
					"their version",
				),
			);
		} finally {
			client.clear();
			test.close();
		}
	});

	it("reloads a clean file silently when the disk changed", async () => {
		const { test, client, workspace, writeDisk } = await setup("/code/workspaces/editor-clean");
		try {
			const { rerender } = render(
				<FileEditorPane workspaceId={workspace.id} path="a.ts" onDirtyChange={() => {}} />,
				{ wrapper: wrapper(test.container, client) },
			);
			await screen.findByRole("textbox", { name: "Editor" });
			await writeDisk("two");
			await client.invalidateQueries({ queryKey: ["files", "content", workspace.id, "a.ts"] });
			rerender(<FileEditorPane workspaceId={workspace.id} path="a.ts" onDirtyChange={() => {}} />);

			await waitFor(() =>
				expect((screen.getByRole("textbox", { name: "Editor" }) as HTMLTextAreaElement).value).toBe(
					"two",
				),
			);
			expect(screen.queryByText("File changed on disk")).toBeNull();
		} finally {
			client.clear();
			test.close();
		}
	});

	it("opens the find bar with Cmd+F through the root dispatcher", async () => {
		const { test, client, workspace } = await setup("/code/workspaces/editor-find");
		try {
			render(
				<div data-file-viewer>
					<CommandDispatcher>
						<FileEditorPane workspaceId={workspace.id} path="a.ts" onDirtyChange={() => {}} />
					</CommandDispatcher>
				</div>,
				{ wrapper: wrapper(test.container, client) },
			);
			const editor = await screen.findByRole("textbox", { name: "Editor" });
			fireEvent.keyDown(editor, { key: "f", metaKey: true });
			// The bar is a <search> landmark. aria-query 5.3.0, which Testing Library reads roles
			// from, maps no element to the search role, so the bar is found by its name instead.
			const bar = await screen.findByLabelText("Find in file");
			expect(bar.tagName).toBe("SEARCH");
		} finally {
			client.clear();
			test.close();
		}
	});

	it("saves the draft with the modified time it read", async () => {
		const { test, client, workspace } = await setup("/code/workspaces/editor-save");
		try {
			const onDirtyChange = vi.fn();
			render(
				<FileEditorPane workspaceId={workspace.id} path="a.ts" onDirtyChange={onDirtyChange} />,
				{
					wrapper: wrapper(test.container, client),
				},
			);
			fireEvent.change(await screen.findByRole("textbox", { name: "Editor" }), {
				target: { value: "two" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Save now" }));
			await waitFor(() =>
				expect(test.memory.controls.files.get(`${workspace.path}/a.ts`)).toBe("two"),
			);
			await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
		} finally {
			client.clear();
			test.close();
		}
	});

	it("opens a binary file in the default Open in app instead of editing it", async () => {
		const { test, client, workspace } = await setup("/code/workspaces/editor-binary");
		try {
			vi.spyOn(test.container.services.workspaceFiles, "readContent").mockResolvedValue({
				ok: true,
				value: { kind: "binary", sizeBytes: 4, modifiedAt: 0, previewUrl: null },
			});
			expect((await test.container.actions.settings.set("default_open_in", "Zed")).ok).toBe(true);
			const openWith = vi.spyOn(test.container.platform.opener, "openWith");
			render(<FileEditorPane workspaceId={workspace.id} path="a.ts" />, {
				wrapper: wrapper(test.container, client),
			});

			fireEvent.click(await screen.findByRole("button", { name: "Open in another app" }));

			await waitFor(() => expect(openWith).toHaveBeenCalledWith("Zed", `${workspace.path}/a.ts`));
		} finally {
			client.clear();
			test.close();
		}
	});
});
