import type { ModelInfo } from "@conducted/protocol";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { DefaultModelsPage } from "./DefaultModelsPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	test?.close();
	test = undefined;
});

const model = (
	id: string,
	label: string,
	supportsFastMode: boolean,
	isDefault = false,
): ModelInfo => ({
	id,
	label,
	status: "picker",
	isNew: false,
	isDefault,
	efforts: ["low", "medium", "high"],
	defaultEffort: "high",
	effortAxis: "effort",
	liveEffortChange: false,
	supportsFastMode,
	contextWindowTokens: 200_000,
});

/** The page over the real container, inside a router for the Configure links. */
async function renderPage() {
	test = createTestContainer();
	const container = test.container;
	await container.services.settings.start();
	await container.services.favoriteModels.start();
	container.services.agentCatalog.store.setState((state) => ({
		...state,
		installs: {
			state: "ready",
			data: [
				{ agent: "claude", installed: true, authenticated: true },
				{ agent: "codex", installed: true, authenticated: true },
				{ agent: "cursor", installed: false },
				{ agent: "acp", acpAgent: "opencode", installed: false },
				{ agent: "acp", acpAgent: "pi", installed: false },
			],
		},
		models: {
			claude: {
				state: "ready",
				data: [
					model("fast-model", "Fast model", true, true),
					model("slow-model", "Slow model", false),
				],
			},
			codex: { state: "ready", data: [model("gpt", "GPT", false, true)] },
		},
	}));
	await container.actions.settings.set("default_model", "fast-model");
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const page = createRoute({
		getParentRoute: () => rootRoute,
		path: "/settings/$page",
		component: () => <DefaultModelsPage />,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([page]),
		history: createMemoryHistory({ initialEntries: ["/settings/models"] }),
	});
	render(
		<ServicesProvider container={container}>
			<RouterProvider router={router} />
		</ServicesProvider>,
	);
	await act(() => router.load());
	return { container, router };
}

const slot = (number: number) => screen.getByRole("listitem", { name: `Slot ${number}` });

describe("SET-02 DefaultModelsPage", () => {
	it("draws Conductor's Loadout: five slots, the first the DEFAULT model, then the next and empty ones", async () => {
		await renderPage();
		expect(screen.getByRole("heading", { name: "Loadout" })).toBeTruthy();
		expect(screen.getByText("Choose which models you want to use")).toBeTruthy();
		expect(within(slot(1)).getByText("DEFAULT")).toBeTruthy();
		expect(within(slot(1)).getByText("Fast model")).toBeTruthy();
		expect(within(slot(2)).getByText("DROP MODEL HERE")).toBeTruthy();
		expect(within(slot(2)).getByText("2")).toBeTruthy();
		for (const number of [3, 4, 5]) expect(within(slot(number)).getByText("EMPTY")).toBeTruthy();
	});

	it("lists each agent's models in its own column, and Configure for an agent not set up", async () => {
		const { router } = await renderPage();
		const claude = screen.getByRole("region", { name: "Claude Code" });
		expect(within(claude).getByRole("button", { name: "Add Slow model to loadout" })).toBeTruthy();
		// The default model is in the loadout, so its row is checked.
		expect(within(claude).getByText("In the loadout")).toBeTruthy();
		const cursor = screen.getByRole("region", { name: "Cursor" });
		fireEvent.click(within(cursor).getByRole("button", { name: "Configure Cursor" }));
		await waitFor(() => expect(router.state.location.pathname).toBe("/settings/agents"));
	});

	it("puts a model into the next empty slot with Enter, and replaces it by a drop", async () => {
		const { container } = await renderPage();
		const codex = screen.getByRole("region", { name: "Codex" });
		fireEvent.click(within(codex).getByRole("button", { name: "Add GPT to loadout" }));
		await waitFor(() =>
			expect(container.services.favoriteModels.store.getState().favorites).toEqual([
				expect.objectContaining({
					config: { agent: "codex", model: "gpt", effort: "high", fastMode: false },
				}),
			]),
		);
		expect(await within(slot(2)).findByText("GPT")).toBeTruthy();

		const dropped = JSON.stringify({
			agent: "claude",
			model: "slow-model",
			effort: "low",
			fastMode: false,
		});
		fireEvent.drop(slot(2), {
			dataTransfer: { getData: (type: string) => (type.endsWith("model") ? dropped : "") },
		});
		await waitFor(() =>
			expect(
				container.services.favoriteModels.store
					.getState()
					.favorites.map((entry) => entry.config.model),
			).toEqual(["slow-model"]),
		);
	});

	/** A drag's data, as a browser keeps it between dragstart and drop. */
	const dragData = (dropEffect: string) => {
		const data = new Map<string, string>();
		return {
			setData: (type: string, value: string) => data.set(type, value),
			getData: (type: string) => data.get(type) ?? "",
			get types() {
				return [...data.keys()];
			},
			effectAllowed: "move",
			dropEffect,
		};
	};

	it("takes a model out of the loadout when its slot is dropped outside the slots", async () => {
		const { container } = await renderPage();
		fireEvent.click(
			within(screen.getByRole("region", { name: "Codex" })).getByRole("button", {
				name: "Add GPT to loadout",
			}),
		);
		expect(await within(slot(2)).findByText("GPT")).toBeTruthy();

		// WebKit, the engine of the app's window, reports a drop's effect unlike Chromium, so the
		// drop on the page is what takes the model out, not the effect dragend reports.
		const transfer = dragData("move");
		fireEvent.dragStart(within(slot(2)).getByRole("button"), { dataTransfer: transfer });
		const heading = screen.getByRole("heading", { name: "Default models" });
		fireEvent.dragOver(heading, { dataTransfer: transfer });
		fireEvent.drop(heading, { dataTransfer: transfer });
		fireEvent.dragEnd(within(slot(2)).getByRole("button"), { dataTransfer: transfer });

		await waitFor(() =>
			expect(container.services.favoriteModels.store.getState().favorites).toEqual([]),
		);
	});

	it("keeps the model when a slot's drag is cancelled with no drop", async () => {
		const { container } = await renderPage();
		fireEvent.click(
			within(screen.getByRole("region", { name: "Codex" })).getByRole("button", {
				name: "Add GPT to loadout",
			}),
		);
		expect(await within(slot(2)).findByText("GPT")).toBeTruthy();

		const transfer = dragData("none");
		fireEvent.dragStart(within(slot(2)).getByRole("button"), { dataTransfer: transfer });
		fireEvent.dragEnd(within(slot(2)).getByRole("button"), { dataTransfer: transfer });
		await act(async () => {
			await Promise.resolve();
		});

		expect(
			container.services.favoriteModels.store
				.getState()
				.favorites.map((entry) => entry.config.model),
		).toEqual(["gpt"]);
	});

	it("opens a slot's choices on the click, never on the press that may start a drag", async () => {
		await renderPage();
		const trigger = within(slot(1)).getByRole("button");

		fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
		expect(screen.queryByRole("menu", { name: "Slot 1" })).toBeNull();

		fireEvent.click(trigger, { detail: 1 });
		expect(await screen.findByRole("menu", { name: "Slot 1" })).toBeTruthy();
	});

	it("changes the default model from its slot, and disables fast mode the model lacks", async () => {
		const { container } = await renderPage();
		const trigger = within(slot(1)).getByRole("button");
		fireEvent.keyDown(trigger, { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitemradio", { name: "Slow model" }));
		await waitFor(() =>
			expect(container.services.settings.store.getState().values.default_model).toBe("slow-model"),
		);

		fireEvent.keyDown(within(slot(1)).getByRole("button"), { key: "Enter" });
		const fast = await screen.findByRole("menuitemcheckbox", { name: "Fast mode" });
		expect(fast.getAttribute("aria-disabled")).toBe("true");
		expect(screen.getByText("The chosen model does not support fast mode.")).toBeTruthy();
	});

	it("picks the review model, its effort and fast mode in one picker, as Conductor does", async () => {
		const { container } = await renderPage();
		const row = document.querySelector('[data-setting-key="review_model"]');
		if (!(row instanceof HTMLElement)) throw new Error("no Review model row");
		expect(within(row).queryByRole("textbox")).toBeNull();
		// An empty review model is the default model, so the picker names it.
		const trigger = within(row).getByRole("button", { name: /Review model: Fast model, High/ });

		fireEvent.keyDown(trigger, { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitemradio", { name: "Slow model" }));
		await waitFor(() =>
			expect(container.services.settings.store.getState().values.review_model).toBe("slow-model"),
		);

		fireEvent.keyDown(within(row).getByRole("button", { name: /Review model: Slow model/ }), {
			key: "Enter",
		});
		fireEvent.click(await screen.findByRole("menuitemradio", { name: "Low" }));
		await waitFor(() =>
			expect(container.services.settings.store.getState().values.review_claude_effort_level).toBe(
				"low",
			),
		);
		// The picker holds the effort and fast mode, so they have no rows of their own.
		const keys = [...document.querySelectorAll("[data-setting-key]")].map((entry) =>
			entry.getAttribute("data-setting-key"),
		);
		expect(keys).not.toContain("review_claude_effort_level");
		expect(keys).not.toContain("review_fast_mode");
	});

	it("asks for the agent list when nothing has read it yet, as the Agents page does", async () => {
		const { container } = await renderPage();
		const refresh = vi.spyOn(container.actions.agents, "refresh");
		container.services.agentCatalog.store.setState({ installs: { state: "loading" } });
		await waitFor(() => expect(refresh).toHaveBeenCalled());
	});

	it("follows the Loadout with Conductor's rows in its order", async () => {
		await renderPage();
		const keys = [...document.querySelectorAll("[data-setting-key]")].map((row) =>
			row.getAttribute("data-setting-key"),
		);
		const order = [
			"default_model",
			"default_codex_personality",
			"default_claude_personality",
			"review_model",
			"default_plan_mode",
		];
		const positions = order.map((key) => keys.indexOf(key));
		expect(positions).toHaveLength(5);
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
		// The default's model, effort and fast mode are the first slot's, so they have no rows.
		expect(keys).not.toContain("default_fast_mode");
		expect(keys).not.toContain("default_claude_effort_level");
	});
});
