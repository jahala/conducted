import type { WorkspaceId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import type { Container } from "../core/container.ts";
import { ServicesProvider } from "../core/context.tsx";
import { RepoService, type RepoServiceDeps } from "../core/services/repo.ts";
import "../test/dom-polyfills.ts";
import { setCurrentWorkspace, workspaceToast } from "../ui/Toast.tsx";
import { AppShell } from "./AppShell.tsx";
import { AppProviders, createQueryClient } from "./providers.tsx";
import { createAppRouter } from "./router.tsx";

/** The settings values the shell reads, plus the writes it makes. */
function testSettings(initial: Record<string, unknown> = {}) {
	const writes: { key: string; value: unknown }[] = [];
	const store = createStore<{ values: Record<string, unknown> }>(() => ({
		values: { left_panel_visible: true, left_panel_width: 256, ...initial },
	}));
	return {
		writes,
		store,
		get<T>(key: string): T {
			return store.getState().values[key] as T;
		},
		async set(key: string, value: unknown) {
			writes.push({ key, value });
			store.setState({ values: { ...store.getState().values, [key]: value } });
		},
	};
}

type TestSettings = ReturnType<typeof testSettings>;

/** A route component that throws, to prove the centre's boundary keeps the shell. */
function BrokenCentre(): never {
	throw new Error("centre broke");
}

/** The sidebar reads the repo store and the action table; the other regions say what is unbuilt. */
function testContainer(settings: TestSettings = testSettings()): Container {
	return {
		services: { repo: new RepoService({} as RepoServiceDeps), settings },
		actions: {},
	} as unknown as Container;
}

async function openApp(path = "/", settings: TestSettings = testSettings()) {
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	render(
		<ServicesProvider container={testContainer(settings)}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	return router;
}

beforeEach(() => {
	window.localStorage.clear();
	setCurrentWorkspace(null);
});
afterEach(cleanup);

describe("NAV-01 app shell", () => {
	it("shows the sidebar and the centre empty state while features are unbuilt", async () => {
		await openApp();

		expect(await screen.findByRole("heading", { name: "Run agents side by side" })).toBeTruthy();
		expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy();
		expect(screen.getByRole("main")).toBeTruthy();
		expect(screen.getByText("Not built yet: NAV-03")).toBeTruthy();
	});

	it("comes back with the sidebar collapsed when the saved settings say so", async () => {
		const settings = testSettings({ left_panel_visible: false });

		await openApp("/", settings);

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
			<ServicesProvider container={testContainer()}>
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
		await screen.findByText("Git panel");

		let own: string | null = null;
		let other: string | null = null;
		act(() => {
			own = workspaceToast("w1" as WorkspaceId, "For this workspace");
			other = workspaceToast("w2" as WorkspaceId, "For another workspace");
		});

		expect(own).not.toBeNull();
		expect(other).toBeNull();
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
