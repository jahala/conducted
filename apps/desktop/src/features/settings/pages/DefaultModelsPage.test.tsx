import type { ModelInfo } from "@conducted/protocol";
import { ok } from "@conducted/shared";
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
import { NEW_CHAT_EFFORT_FALLBACK } from "../../../core/workspace-helpers.ts";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { Toaster, toast } from "../../../ui/Toast.tsx";
import { EFFORT_LABELS } from "../../composer/ModelPicker.tsx";
import { DefaultModelsPage } from "./DefaultModelsPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	toast.dismiss();
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
		path: "/settings/user/$page",
		component: () => <DefaultModelsPage />,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([page]),
		history: createMemoryHistory({ initialEntries: ["/settings/user/models"] }),
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

/** A slot's rectangle in the test's layout: five 140px slots in one row. */
const slotBox = (number: number): DOMRect => {
	const left = (number - 1) * 140;
	return {
		x: left,
		y: 0,
		width: 140,
		height: 140,
		top: 0,
		left,
		right: left + 140,
		bottom: 140,
		toJSON: () => ({}),
	};
};

/** Gives every slot a rectangle, since jsdom has no layout. */
const layOutSlots = () => {
	for (let number = 1; number <= 5; number += 1) {
		vi.spyOn(slot(number), "getBoundingClientRect").mockReturnValue(slotBox(number));
	}
};

const slotCentre = (number: number) => ({ x: (number - 1) * 140 + 70, y: 70 });

/** A pointer drag: press, move past the drag threshold, release at the point. */
const dragPointer = (from: HTMLElement, to: { x: number; y: number }) => {
	fireEvent.pointerDown(from, {
		button: 0,
		ctrlKey: false,
		pointerId: 1,
		clientX: 5,
		clientY: 5,
	});
	fireEvent.pointerMove(document, { pointerId: 1, clientX: to.x, clientY: to.y });
	fireEvent.pointerUp(document, { pointerId: 1, clientX: to.x, clientY: to.y });
};

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
		await waitFor(() => expect(router.state.location.pathname).toBe("/settings/user/agents"));
	});

	it("puts a model into the next empty slot with Enter, then replaces it by a drag", async () => {
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

		layOutSlots();
		const claude = screen.getByRole("region", { name: "Claude Code" });
		dragPointer(
			within(claude).getByRole("button", { name: "Add Slow model to loadout" }),
			slotCentre(2),
		);
		await waitFor(() =>
			expect(
				container.services.favoriteModels.store
					.getState()
					.favorites.map((entry) => entry.config.model),
			).toEqual(["slow-model"]),
		);
	});

	it("drags a model into an empty slot with pointer events", async () => {
		const { container } = await renderPage();
		layOutSlots();
		const codex = screen.getByRole("region", { name: "Codex" });
		dragPointer(within(codex).getByRole("button", { name: "Add GPT to loadout" }), slotCentre(2));
		await waitFor(() =>
			expect(
				container.services.favoriteModels.store
					.getState()
					.favorites.map((entry) => entry.config.model),
			).toEqual(["gpt"]),
		);
		expect(await within(slot(2)).findByText("GPT")).toBeTruthy();
	});

	it("takes a model out of the loadout when its slot is dragged outside the slots", async () => {
		const { container } = await renderPage();
		fireEvent.click(
			within(screen.getByRole("region", { name: "Codex" })).getByRole("button", {
				name: "Add GPT to loadout",
			}),
		);
		expect(await within(slot(2)).findByText("GPT")).toBeTruthy();

		layOutSlots();
		dragPointer(within(slot(2)).getByRole("button"), { x: 2000, y: 2000 });

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

		layOutSlots();
		fireEvent.pointerDown(within(slot(2)).getByRole("button"), {
			button: 0,
			pointerId: 1,
			clientX: 5,
			clientY: 5,
		});
		fireEvent.pointerMove(document, { pointerId: 1, ...slotCentre(2) });
		fireEvent.pointerCancel(document, { pointerId: 1 });
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

	it("falls back to the new chat's effort when the default loadout cannot be read (one home per rule)", async () => {
		const { container } = await renderPage();
		// A default effort no chat can use leaves the loadout with no default entry, so the review
		// picker has no model to read its effort from.
		act(() =>
			container.services.settings.store.setState((state) => ({
				...state,
				values: { ...state.values, default_claude_effort_level: "turbo" },
			})),
		);
		const row = document.querySelector('[data-setting-key="review_model"]');
		if (!(row instanceof HTMLElement)) throw new Error("no Review model row");
		expect(
			within(row).getByRole("button", {
				name: new RegExp(`Review model: .*, ${EFFORT_LABELS[NEW_CHAT_EFFORT_FALLBACK]}`),
			}),
		).toBeTruthy();
	});

	it("lists every agent's models, and stores the chosen agent with its model", async () => {
		const { container } = await renderPage();
		const row = document.querySelector('[data-setting-key="review_model"]');
		if (!(row instanceof HTMLElement)) throw new Error("no Review model row");
		// An empty review model is the default model, so the picker names it.
		const trigger = within(row).getByRole("button", { name: /Review model: Fast model/ });

		fireEvent.keyDown(trigger, { key: "Enter" });
		// Codex's model is offered beside Claude Code's, under its agent's name.
		const menu = await screen.findByRole("menu", { name: "Review model" });
		expect(within(menu).getByText("Codex")).toBeTruthy();
		fireEvent.click(within(menu).getByRole("menuitemradio", { name: "GPT" }));
		await waitFor(() => {
			const values = container.services.settings.store.getState().values;
			expect(values.review_agent).toBe("codex");
			expect(values.review_model).toBe("gpt");
		});

		// The effort follows the chosen agent, so Codex's thinking level is stored.
		fireEvent.keyDown(within(row).getByRole("button", { name: /Review model: GPT/ }), {
			key: "Enter",
		});
		fireEvent.click(await screen.findByRole("menuitemradio", { name: "Low" }));
		await waitFor(() =>
			expect(container.services.settings.store.getState().values.review_codex_thinking_level).toBe(
				"low",
			),
		);
		// The agent and its effort have no rows of their own.
		const keys = [...document.querySelectorAll("[data-setting-key]")].map((entry) =>
			entry.getAttribute("data-setting-key"),
		);
		expect(keys).not.toContain("review_agent");
		expect(keys).not.toContain("review_codex_thinking_level");
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

	it("puts a switch back when its setting cannot be saved, with no line under the row (issue #600)", async () => {
		const { container } = await renderPage();
		// The settings folder is a file now, so the save cannot make it.
		const home = container.platform.fs.paths.home;
		expect(await container.platform.fs.trash(`${home}/.conducted`)).toEqual({
			ok: true,
			value: undefined,
		});
		test?.memory.controls.addFile(`${home}/.conducted`, "");
		const row = document.querySelector('[data-setting-key="default_plan_mode"]') as HTMLElement;
		const toggle = within(row).getByRole("switch");
		expect(toggle.getAttribute("aria-checked")).toBe("false");

		fireEvent.click(toggle);

		// The toast says it (the next test); as in Conductor, the row has no line of its own.
		await waitFor(() => expect(container.services.settings.get("default_plan_mode")).toBe(false));
		expect(within(row).queryByRole("alert")).toBeNull();
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		expect(container.services.settings.get("default_plan_mode")).toBe(false);
	});

	// Conductor's settings writer toasts every failed save (Uz, main @389863): "Failed to save
	// setting", or for a file it cannot read, "Can't save setting because your settings file is
	// invalid" with the parse error's first six lines.
	it("toasts Failed to save setting when a switch cannot be saved, as Conductor does (issue #614)", async () => {
		const { container } = await renderPage();
		render(<Toaster />);
		const home = container.platform.fs.paths.home;
		expect(await container.platform.fs.trash(`${home}/.conducted`)).toEqual({
			ok: true,
			value: undefined,
		});
		test?.memory.controls.addFile(`${home}/.conducted`, "");
		const row = document.querySelector('[data-setting-key="default_plan_mode"]') as HTMLElement;

		fireEvent.click(within(row).getByRole("switch"));

		await waitFor(() =>
			expect(document.querySelector("[data-sonner-toast]")?.textContent).toBe(
				"Failed to save setting",
			),
		);
	});

	it("toasts that the settings file is invalid, with its parse error, when it cannot be read (issue #614)", async () => {
		const { container } = await renderPage();
		render(<Toaster />);
		const file = `${container.platform.fs.paths.home}/.conducted/settings.toml`;
		test?.memory.controls.files.set(file, "[models\n");
		const row = document.querySelector('[data-setting-key="default_plan_mode"]') as HTMLElement;

		fireEvent.click(within(row).getByRole("switch"));

		const shown = await waitFor(() => {
			const element = document.querySelector("[data-sonner-toast]");
			expect(element).not.toBeNull();
			return element as HTMLElement;
		});
		expect(
			within(shown).getByText("Can't save setting because your settings file is invalid"),
		).toBeTruthy();
		const parsed = container.services.settings.readSettingsText("[models\n", file);
		const parseError = !parsed.ok ? (parsed.error.cause as { message: string }).message : "";
		expect(parseError).not.toBe("");
		expect(shown.textContent).toContain(parseError.split("\n")[0]);
	});

	// Conductor's invalid-file toast carries "Overwrite file" once the app has read the file whole
	// for a save (Uz, main @389730; mutateSettingsFile, @416065). Pressing it saves the setting
	// again over the file as that save left it (readSettingsFileDataForWrite, @416200).
	it("offers Overwrite file for an invalid settings file, and pressing it saves the setting (issue #622)", async () => {
		// renderPage saved the default model, so the app has read the file whole.
		const { container } = await renderPage();
		render(<Toaster />);
		const file = `${container.platform.fs.paths.home}/.conducted/settings.toml`;
		test?.memory.controls.files.set(file, "[models\n");
		const row = document.querySelector('[data-setting-key="default_plan_mode"]') as HTMLElement;
		const toggle = within(row).getByRole("switch");

		fireEvent.click(toggle);
		const overwrite = await screen.findByRole("button", { name: "Overwrite file" });
		expect(container.services.settings.get("default_plan_mode")).toBe(false);
		fireEvent.click(overwrite);

		await waitFor(() => expect(container.services.settings.get("default_plan_mode")).toBe(true));
		const written = container.services.settings.readSettingsText(
			test?.memory.controls.files.get(file) ?? "",
			file,
		);
		expect(written.ok && written.value.values).toMatchObject({
			default_model: "fast-model",
			default_plan_mode: true,
		});
		await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
	});

	// Conductor's Reset removes a file-backed setting through the same writer as a save
	// (deleteSetting, main @410879, onForce @411783), so a refused reset gets the writer's toast
	// and its "Overwrite file" (Uz, @389730). Ours said "Failed to reset setting" (issue #654).
	it("offers Overwrite file when a setting's Reset meets an invalid settings file, and pressing it resets", async () => {
		const { container } = await renderPage();
		render(<Toaster />);
		expect(await container.actions.settings.set("default_plan_mode", true)).toEqual(ok(undefined));
		const file = `${container.platform.fs.paths.home}/.conducted/settings.toml`;
		test?.memory.controls.files.set(file, "[models\n");
		const row = document.querySelector('[data-setting-key="default_plan_mode"]') as HTMLElement;

		fireEvent.keyDown(within(row).getByRole("button", { name: "Setting actions" }), {
			key: "Enter",
		});
		fireEvent.click(await screen.findByRole("menuitem", { name: "Reset" }));

		const shown = await waitFor(() => {
			const element = document.querySelector("[data-sonner-toast]");
			expect(element).not.toBeNull();
			return element as HTMLElement;
		});
		expect(shown.querySelector("[data-title]")?.textContent).toBe(
			"Can't save setting because your settings file is invalid",
		);
		fireEvent.click(within(shown).getByRole("button", { name: "Overwrite file" }));

		await waitFor(() => {
			const written = container.services.settings.readSettingsText(
				test?.memory.controls.files.get(file) ?? "",
				file,
			);
			expect(written.ok && written.value.values.default_model).toBe("fast-model");
			expect(written.ok && "default_plan_mode" in written.value.values).toBe(false);
		});
	});
});
