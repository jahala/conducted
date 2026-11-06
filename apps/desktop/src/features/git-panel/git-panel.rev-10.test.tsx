/**
 * @feature REV-10 Git panel Artifacts tab and its setting
 * Owns: tests that the panel offers the Artifacts tab by default, hides it when "Show Artifacts
 * tab" is off, and lists the workspace's `.context` files through the real container.
 * Behaviour: ui-map.md 3.6 (tab strip), ui-map.md 6 (the setting); services-map.md 5A.5.1.
 * Test first: the panel shows an Artifacts tab and choosing it lists `.context/notes.md`.
 */
import type { WorkspaceId } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import "../../test/dom-polyfills.ts";
import { GitPanel } from "./GitPanel.tsx";

afterEach(cleanup);

function renderPanel(test: ReturnType<typeof createTestContainer>, workspaceId: WorkspaceId) {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, refetchOnMount: false, staleTime: Number.POSITIVE_INFINITY },
		},
	});
	client.setQueryData(["git", "workspace", workspaceId, "changes", { kind: "branch" }], []);
	return {
		client,
		view: render(
			<QueryClientProvider client={client}>
				<ServicesProvider container={test.container}>
					<GitPanel workspaceId={workspaceId} />
				</ServicesProvider>
			</QueryClientProvider>,
		),
	};
}

describe("REV-10 git panel artifacts tab", () => {
	it("offers the Artifacts tab and lists the workspace's .context files", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/ws/panel-artifacts" });
			test.memory.controls.files.set("/ws/panel-artifacts/.context/notes.md", "notes");
			const { view, client } = renderPanel(test, workspace.id);

			fireEvent.mouseDown(screen.getByRole("tab", { name: "Artifacts" }), { button: 0 });

			expect(await screen.findByText("notes.md")).toBeTruthy();
			expect(screen.getByRole("tab", { name: "Artifacts" })).toBeTruthy();
			view.unmount();
			client.clear();
		} finally {
			test.close();
		}
	});

	it("hides the Artifacts tab when Show Artifacts tab is off", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/ws/no-artifacts" });
			test.container.services.settings.store.setState((state) => ({
				...state,
				values: { ...state.values, artifacts_tab_enabled: false },
			}));
			const { view, client } = renderPanel(test, workspace.id);

			expect(screen.queryByRole("tab", { name: "Artifacts" })).toBeNull();
			expect(screen.getByRole("tab", { name: "All files" })).toBeTruthy();
			view.unmount();
			client.clear();
		} finally {
			test.close();
		}
	});
});
