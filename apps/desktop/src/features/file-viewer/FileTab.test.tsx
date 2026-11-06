/**
 * @feature REV-08 FileTab
 * Tests the mode switch, the Cmd+E shortcut through the mounted dispatcher, and the preview mode,
 * over the real container and the real child panes.
 */

import { ok } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import type { FileDiff } from "../../core/api.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import "../../test/dom-polyfills.ts";
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
	await test.container.platform.fs.writeTextAtomic(
		`${workspace.path}/notes.md`,
		"# Hello from the tab",
	);
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
});
