import { appError, err, ok } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { OnboardingScreen } from "./OnboardingScreen.tsx";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("../../ui/Toast.tsx", () => ({ toast: { error: toastError } }));

afterEach(cleanup);
beforeEach(() => toastError.mockReset());

async function renderGuide(test: TestContainer) {
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const onboardingRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/first-run-onboarding",
		component: () => <OnboardingScreen />,
	});
	const homeRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <div>Home</div>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([onboardingRoute, homeRoute]),
		history: createMemoryHistory({ initialEntries: ["/first-run-onboarding"] }),
	});
	render(
		<ServicesProvider container={test.container}>
			<RouterProvider router={router} />
		</ServicesProvider>,
	);
	await router.load();
	return router;
}

function setup() {
	const test = createTestContainer();
	vi.spyOn(test.container.services.agentCatalog, "refresh").mockResolvedValue(ok(undefined));
	return test;
}

// Conductor's slide titles; the current step is the list entry marked aria-current="step".
describe("APP-02 first-run onboarding", () => {
	it("Continue advances one step", async () => {
		const test = setup();
		try {
			await renderGuide(test);
			expect(
				await screen.findByRole("button", {
					name: /^Get coding agents working in parallel/,
					current: "step",
				}),
			).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Continue" }));
			expect(
				await screen.findByRole("button", {
					name: /^See at a glance what each agent is working on/,
					current: "step",
				}),
			).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Continue" }));
			expect(
				await screen.findByRole("button", {
					name: /^Review changes and create PRs/,
					current: "step",
				}),
			).toBeTruthy();
		} finally {
			test.close();
		}
	});

	it("Enter continues and ArrowDown cycles to the next step", async () => {
		const test = setup();
		try {
			await renderGuide(test);
			await screen.findByRole("button", {
				name: /^Get coding agents working in parallel/,
				current: "step",
			});
			expect(document.querySelector("svg[data-step]")?.getAttribute("data-step")).toBe("0");
			fireEvent.keyDown(window, { key: "Enter" });
			expect(
				await screen.findByRole("button", {
					name: /^See at a glance what each agent is working on/,
					current: "step",
				}),
			).toBeTruthy();
			expect(document.querySelector("svg[data-step]")?.getAttribute("data-step")).toBe("1");
			fireEvent.keyDown(window, { key: "ArrowDown" });
			expect(
				await screen.findByRole("button", {
					name: /^Review changes and create PRs/,
					current: "step",
				}),
			).toBeTruthy();
			fireEvent.keyDown(window, { key: "ArrowDown" });
			expect(
				await screen.findByRole("button", {
					name: /^Get coding agents working in parallel/,
					current: "step",
				}),
			).toBeTruthy();
		} finally {
			test.close();
		}
	});

	it("Exiting stores the onboarding state and navigates to '/'", async () => {
		const test = setup();
		try {
			const router = await renderGuide(test);
			fireEvent.click(screen.getByRole("button", { name: "Exit onboarding" }));
			await waitFor(() => expect(router.state.location.pathname).toBe("/"));
			expect(await screen.findByText("Home")).toBeTruthy();
			expect(test.container.services.settings.store.getState().values.onboarding_step).toBe(3);
		} finally {
			test.close();
		}
	});

	it("shows the setup error toast and stays when the state cannot be stored", async () => {
		const test = setup();
		vi.spyOn(test.container.services.settings, "set").mockResolvedValue(
			err(appError("settings_write_failed", "The settings table is locked.")),
		);
		try {
			const router = await renderGuide(test);
			fireEvent.click(screen.getByRole("button", { name: "Exit onboarding" }));
			await waitFor(() =>
				expect(toastError).toHaveBeenCalledWith("Couldn't finish setup. Please try again.", {
					description: "The settings table is locked.",
				}),
			);
			expect(router.state.location.pathname).toBe("/first-run-onboarding");
		} finally {
			test.close();
		}
	});

	it("leaves at once when the guide was already finished", async () => {
		const test = setup();
		test.container.services.settings.store.setState((state) => ({
			values: { ...state.values, onboarding_step: 3 },
		}));
		try {
			const router = await renderGuide(test);
			await waitFor(() => expect(router.state.location.pathname).toBe("/"));
			expect(await screen.findByText("Home")).toBeTruthy();
		} finally {
			test.close();
		}
	});
});
