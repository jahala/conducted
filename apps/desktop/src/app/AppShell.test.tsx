import type { WorkspaceId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../test/container.ts";
import "../test/dom-polyfills.ts";
import { workspaceLayoutGroupId } from "../ui/layout-sizes.ts";
import { setCurrentWorkspace, toast, workspaceToast, workspaceToastIds } from "../ui/Toast.tsx";
import { AppShell } from "./AppShell.tsx";
import { loadPanelLayout, savePanelLayout } from "./layout-persistence.ts";
import { AppProviders, createQueryClient } from "./providers.tsx";
import { createAppRouter } from "./router.tsx";
import { createShellContainer, type ShellFixture, saveSetting } from "./shell-test-support.ts";

/** A route component that throws, to prove the centre's boundary keeps the shell. */
function BrokenCentre(): never {
	throw new Error("centre broke");
}

async function openApp(path = "/", fixture: ShellFixture = {}) {
	const shell = createShellContainer(fixture);
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	render(
		<ServicesProvider container={shell.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	return { router, shell };
}

beforeEach(() => {
	window.localStorage.clear();
	setCurrentWorkspace(null);
});
afterEach(() => {
	cleanup();
	toast.dismiss();
});

describe("NAV-01 app shell", () => {
	it("shows the sidebar and the centre empty state while features are unbuilt", async () => {
		await openApp();

		expect(await screen.findByRole("heading", { name: "Run agents side by side" })).toBeTruthy();
		expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy();
		expect(screen.getByRole("main")).toBeTruthy();
		const nav = screen.getByRole("navigation", { name: "Main" });
		expect(within(nav).getByRole("link", { name: /Home/ })).toBeTruthy();
		expect(screen.getByText("No projects yet")).toBeTruthy();
	});

	it("comes back with the sidebar collapsed when the saved settings say so", async () => {
		await openApp("/", { settings: { left_panel_visible: false } });

		expect(await screen.findByRole("button", { name: "Show sidebar" })).toBeTruthy();
	});

	it("keeps the shell when the centre route throws", async () => {
		const rootRoute = createRootRoute({ component: AppShell });
		const brokenRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/",
			component: BrokenCentre,
		});
		const router = createRouter({
			routeTree: rootRoute.addChildren([brokenRoute]),
			history: createMemoryHistory({ initialEntries: ["/"] }),
		});

		render(
			<ServicesProvider container={createShellContainer().container}>
				<AppProviders client={createQueryClient(() => {})}>
					<RouterProvider router={router} />
				</AppProviders>
			</ServicesProvider>,
		);
		await router.load();

		expect(await screen.findByText("This part failed to load.")).toBeTruthy();
		expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy();
	});

	it("tells the toast host which workspace is open", async () => {
		await openApp("/repository/r1/workspace/w1");
		await screen.findByRole("tab", { name: "All files" });

		let own: string | null = null;
		let other: string | null = null;
		act(() => {
			own = workspaceToast("w1" as WorkspaceId, "For this workspace");
			other = workspaceToast("w2" as WorkspaceId, "For another workspace");
		});

		expect(own).not.toBeNull();
		expect(other).toBeNull();
	});

	it("shows the user when the sidebar layout cannot be saved", async () => {
		await openApp("/", { failSettingsWrites: "The settings file is read-only" });
		fireEvent.click(await screen.findByRole("button", { name: "Hide sidebar" }));

		expect(await screen.findByText("Couldn't save the sidebar layout")).toBeTruthy();
		expect(screen.getByText("The settings file is read-only")).toBeTruthy();
	});

	it("saves the sidebar state when the user hides it", async () => {
		const { shell } = await openApp("/");
		fireEvent.click(await screen.findByRole("button", { name: "Hide sidebar" }));

		await waitFor(() =>
			expect(shell.settingsWrites).toContainEqual({ key: "left_panel_visible", value: false }),
		);
	});

	it("forgets a workspace's saved panel sizes when the workspace is deleted", async () => {
		const seeded = createTestContainer();
		try {
			const workspace = await seedWorkspace(seeded.container);
			const repo = seeded.container.services.repo.store.getState().reposById[workspace.repoId];
			if (repo === undefined) throw new Error("The seeded workspace has no project.");
			savePanelLayout(workspaceLayoutGroupId(workspace.id), { "main-content": 60 });
			const { shell } = await openApp("/", { repos: [repo], workspaces: [workspace] });
			await screen.findByRole("complementary", { name: "Sidebar" });

			act(() => {
				shell.container.services.workspace.store.setState({ workspacesById: {} });
			});

			expect(loadPanelLayout(workspaceLayoutGroupId(workspace.id))).toBeNull();
		} finally {
			seeded.close();
		}
	});

	it("dismisses a workspace toast when the route leaves that workspace", async () => {
		const { router } = await openApp("/repository/r1/workspace/w1");
		await screen.findByRole("tab", { name: "All files" });
		act(() => {
			workspaceToast("w1" as WorkspaceId, "Build finished", { duration: 60_000 });
		});
		expect(await screen.findByText("Build finished")).toBeTruthy();

		await act(async () => {
			await router.navigate({ to: "/all-workspaces" });
		});

		await waitFor(() => expect(screen.queryByText("Build finished")).toBeNull());
		expect(workspaceToastIds()).toEqual([]);
	});

	it("leaves Cmd+A alone inside a text field and stops it everywhere else", async () => {
		await openApp();
		await screen.findByRole("heading", { name: "Run agents side by side" });

		const pageEvent = new KeyboardEvent("keydown", {
			key: "a",
			metaKey: true,
			bubbles: true,
			cancelable: true,
		});
		document.body.dispatchEvent(pageEvent);
		expect(pageEvent.defaultPrevented).toBe(true);

		const field = document.createElement("input");
		document.body.append(field);
		field.focus();
		const fieldEvent = new KeyboardEvent("keydown", {
			key: "a",
			metaKey: true,
			bubbles: true,
			cancelable: true,
		});
		field.dispatchEvent(fieldEvent);
		expect(fieldEvent.defaultPrevented).toBe(false);
		field.remove();
	});
});

describe("NAV-01 saved sidebar state at launch", () => {
	async function openUnstartedApp(test: ReturnType<typeof createTestContainer>) {
		const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
		render(
			<ServicesProvider container={test.container}>
				<AppProviders client={createQueryClient(() => {})}>
					<RouterProvider router={router} />
				</AppProviders>
			</ServicesProvider>,
		);
		await router.load();
	}

	/** The title-bar inset the shell root sets for the headers inside it. */
	const shellInset = (): string => {
		let node: HTMLElement | null = screen.getByRole("complementary", { name: "Sidebar" });
		while (node !== null && node.style.getPropertyValue("--shell-left-inset") === "") {
			node = node.parentElement;
		}
		if (node === null) throw new Error("The shell root does not set the title-bar inset.");
		return node.style.getPropertyValue("--shell-left-inset");
	};

	it("draws no sidebar until the settings are loaded, then applies a saved collapsed sidebar", async () => {
		const test = createTestContainer();
		try {
			await saveSetting(test.database, "left_panel_visible", false);
			await openUnstartedApp(test);

			expect(screen.queryByRole("complementary", { name: "Sidebar" })).toBeNull();
			expect(screen.queryByRole("button", { name: "Hide sidebar" })).toBeNull();

			await act(async () => {
				await test.container.services.settings.start();
			});

			expect(await screen.findByRole("button", { name: "Show sidebar" })).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Hide sidebar" })).toBeNull();
			expect(shellInset()).toBe("var(--shell-controls-width)");
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("applies a saved open sidebar after the settings are loaded", async () => {
		const test = createTestContainer();
		try {
			await saveSetting(test.database, "left_panel_visible", true);
			await saveSetting(test.database, "left_panel_width", 300);
			await openUnstartedApp(test);

			await act(async () => {
				await test.container.services.settings.start();
			});

			expect(await screen.findByRole("button", { name: "Hide sidebar" })).toBeTruthy();
			expect(shellInset()).toBe("0px");
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("writes nothing back to the settings when it applies the saved state", async () => {
		const test = createTestContainer();
		try {
			await saveSetting(test.database, "left_panel_visible", false);
			await openUnstartedApp(test);
			await act(async () => {
				await test.container.services.settings.start();
			});
			await screen.findByRole("button", { name: "Show sidebar" });

			const rows = await test.database.select<{ key: string; value: string }>(
				"SELECT key, value FROM settings ORDER BY key",
			);
			expect(rows).toEqual([{ key: "left_panel_visible", value: "false" }]);
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});
});
