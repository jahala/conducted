/**
 * @feature REV-10 Git panel Artifacts tab and its setting
 * Owns: tests that the panel offers the Artifacts tab by default, hides it when "Show Artifacts
 * tab" is off, lists the workspace's `.context` files through the real container, and leaves
 * Artifacts for the tab that Cmd+Alt+U or the URL asks for.
 * Behaviour: ui-map.md 3.6 (tab strip), ui-map.md 6 (the setting); services-map.md 5A.5.1.
 * Test first: the panel shows an Artifacts tab and choosing it lists `.context/notes.md`.
 */
import type { WorkspaceId } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { clearCommandHandlers, useCommandDispatcher } from "../../app/command-dispatcher.ts";
import type { DiffScope } from "../../core/api.ts";
import { ServicesProvider } from "../../core/context.tsx";
import type { GitPanelTab } from "../../core/model.ts";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import "../../test/dom-polyfills.ts";
import { GitPanel } from "./GitPanel.tsx";

afterEach(() => {
	cleanup();
	clearCommandHandlers();
});

function Dispatcher({ children }: { children: ReactNode }) {
	useCommandDispatcher();
	return <>{children}</>;
}

/** The panel as the workspace screen mounts it: under the root dispatcher, with the URL's props. */
function panelInScreen(
	test: ReturnType<typeof createTestContainer>,
	client: QueryClient,
	workspaceId: WorkspaceId,
	url: { tab: GitPanelTab; scope: DiffScope },
) {
	return (
		<QueryClientProvider client={client}>
			<ServicesProvider container={test.container}>
				<Dispatcher>
					<GitPanel workspaceId={workspaceId} tab={url.tab} scope={url.scope} />
				</Dispatcher>
			</ServicesProvider>
		</QueryClientProvider>
	);
}

function queryClientFor(workspaceId: WorkspaceId): QueryClient {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, refetchOnMount: false, staleTime: Number.POSITIVE_INFINITY },
		},
	});
	for (const kind of ["branch", "uncommitted"] as const) {
		client.setQueryData(["git", "workspace", workspaceId, "changes", { kind }], []);
	}
	return client;
}

const selected = (name: string | RegExp): string | null =>
	screen.getByRole("tab", { name }).getAttribute("aria-selected");

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

	it("leaves Artifacts for the Changes tab when Cmd+Alt+U is pressed", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/ws/artifacts-shortcut" });
			test.memory.controls.files.set("/ws/artifacts-shortcut/.context/notes.md", "notes");
			const client = queryClientFor(workspace.id);
			const view = render(
				panelInScreen(test, client, workspace.id, { tab: "changes", scope: { kind: "branch" } }),
			);

			fireEvent.mouseDown(screen.getByRole("tab", { name: "Artifacts" }), { button: 0 });
			expect(await screen.findByText("notes.md")).toBeTruthy();
			expect(selected("Artifacts")).toBe("true");

			fireEvent.keyDown(document.body, { key: "u", metaKey: true, altKey: true });

			expect(selected(/^Changes/)).toBe("true");
			expect(selected("Artifacts")).toBe("false");
			expect(screen.queryByText("notes.md")).toBeNull();
			view.unmount();
			client.clear();
		} finally {
			test.close();
		}
	});

	it("leaves Artifacts for the tab and scope a URL sets", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/ws/artifacts-url" });
			test.memory.controls.files.set("/ws/artifacts-url/.context/notes.md", "notes");
			const client = queryClientFor(workspace.id);
			const view = render(
				panelInScreen(test, client, workspace.id, { tab: "changes", scope: { kind: "branch" } }),
			);

			fireEvent.mouseDown(screen.getByRole("tab", { name: "Artifacts" }), { button: 0 });
			expect(await screen.findByText("notes.md")).toBeTruthy();

			// A link from the chat keeps `gitTab=changes` and sets a new scope.
			view.rerender(
				panelInScreen(test, client, workspace.id, {
					tab: "changes",
					scope: { kind: "uncommitted" },
				}),
			);

			expect(selected(/^Changes/)).toBe("true");
			expect(selected("Artifacts")).toBe("false");
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
