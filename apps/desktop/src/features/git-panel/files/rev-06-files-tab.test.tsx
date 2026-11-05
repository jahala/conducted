import type { SessionConfig } from "@conducted/protocol";
import type { WorkspaceId } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Container } from "../../../core/container.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../../test/container.ts";
import { FilesTab } from "./FilesTab.tsx";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

function must<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
}

afterEach(cleanup);

function renderTab(container: Container, workspaceId: WorkspaceId) {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, refetchOnMount: false, staleTime: Number.POSITIVE_INFINITY },
		},
	});
	client.setQueryData(["git", "workspace", workspaceId, "changes", { kind: "branch" }], []);
	const view = render(
		<QueryClientProvider client={client}>
			<ServicesProvider container={container}>
				<FilesTab workspaceId={workspaceId} onOpenFile={() => {}} />
			</ServicesProvider>
		</QueryClientProvider>,
	);
	return { view, client };
}

describe("REV-06 all files tab", () => {
	it("filters the tree to the matching files", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/ws/files" });
			test.memory.controls.files.set("/ws/files/src/a.ts", "");
			test.memory.controls.files.set("/ws/files/README.md", "");
			const { view, client } = renderTab(test.container, workspace.id);

			fireEvent.click(await screen.findByRole("button", { name: "Expand src" }));
			expect(await screen.findByText("a.ts")).toBeTruthy();

			fireEvent.change(screen.getByRole("textbox", { name: "Filter files" }), {
				target: { value: "read" },
			});
			await waitFor(() => expect(screen.queryByText("a.ts")).toBeNull());
			expect(screen.getByText("README.md")).toBeTruthy();

			view.unmount();
			client.clear();
		} finally {
			test.close();
		}
	});

	it("attaches a file to the active chat from the row menu", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/ws/attach" });
			test.memory.controls.files.set("/ws/attach/README.md", "");
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			must(await test.container.services.workspace.setActiveSession(workspace.id, session.id));
			const { view, client } = renderTab(test.container, workspace.id);

			fireEvent.contextMenu(await screen.findByText("README.md"));
			const attach = await screen.findByRole("menuitem", { name: "Attach in chat" });
			expect(attach.getAttribute("data-disabled")).toBeNull();
			fireEvent.click(attach);
			await waitFor(() =>
				expect(test.container.services.composer.draftOf(session.id).attachmentPaths).toEqual([
					"/ws/attach/README.md",
				]),
			);

			view.unmount();
			client.clear();
		} finally {
			test.close();
		}
	});

	it("draws only a window of a very large tree", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/ws/large" });
			for (let index = 0; index < 5_000; index++) {
				test.memory.controls.files.set(
					`/ws/large/many/file-${String(index).padStart(4, "0")}.ts`,
					"",
				);
			}
			const { view, client } = renderTab(test.container, workspace.id);

			fireEvent.click(await screen.findByRole("button", { name: "Expand many" }));
			await waitFor(() => expect(screen.getAllByRole("treeitem").length).toBeGreaterThan(1));
			expect(screen.getAllByRole("treeitem").length).toBeLessThan(100);
			expect(screen.getAllByRole("treeitem").length).toBeLessThan(5_000);

			view.unmount();
			client.clear();
		} finally {
			test.close();
		}
	});
});
