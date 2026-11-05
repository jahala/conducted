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
import "../test/dom-polyfills.ts";
import { setCurrentWorkspace, toast, workspaceToast, workspaceToastIds } from "../ui/Toast.tsx";
import { AppShell } from "./AppShell.tsx";
import { AppProviders, createQueryClient } from "./providers.tsx";
import { createAppRouter } from "./router.tsx";
import { createShellContainer, type ShellFixture } from "./shell-test-support.ts";

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
