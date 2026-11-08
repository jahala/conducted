import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { FavoriteModel } from "../../core/favorite-model.ts";
import type { FavoriteModelsService } from "../../core/services/favorite-models.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { Toaster, toast } from "../../ui/Toast.tsx";
import { FavoriteModels } from "./FavoriteModels.tsx";

let test: TestContainer;

beforeEach(() => {
	test = createTestContainer();
});

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
	test.close();
});

const choice = (model: string): FavoriteModel["config"] => ({
	agent: "claude",
	model,
	effort: "high",
	fastMode: false,
});

const favorite = (id: string, model: string, position: number): FavoriteModel => ({
	id,
	config: choice(model),
	position,
});

const addFavorite = async (config: FavoriteModel["config"]): Promise<void> => {
	const added = await test.container.services.favoriteModels.add(config);
	if (!added.ok) throw new Error(added.error.message);
};

const harness = async (initial: readonly FavoriteModel[] = []) => {
	for (const model of initial) await addFavorite(model.config);
	const service: FavoriteModelsService = test.container.services.favoriteModels;
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>{children}</ServicesProvider>
	);
	return { service, wrapper };
};

describe("COMP-02 favourite models list", () => {
	it("lists the default model first, as loadout 1, with no edit controls", async () => {
		const { wrapper } = await harness([favorite("a", "m1", 0)]);
		render(<FavoriteModels onPick={() => {}} editing />, { wrapper });
		const rows = screen.getAllByRole("button", { name: /^Select / });
		expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
			"Select Claude Code · default",
			"Select Claude Code · m1",
		]);
		expect(screen.queryByRole("button", { name: "Remove Claude Code · default" })).toBeNull();
		expect(screen.getByRole("button", { name: "Remove Claude Code · m1" })).toBeTruthy();
	});

	it("refuses a fifth favourite with a message", async () => {
		const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
		const { service, wrapper } = await harness([
			favorite("a", "m1", 0),
			favorite("b", "m2", 1),
			favorite("c", "m3", 2),
			favorite("d", "m4", 3),
		]);
		// "Add models" shows under three favourites or in edit mode, as Conductor shows it under three.
		render(<FavoriteModels config={choice("m6")} onPick={() => {}} editing />, { wrapper });
		fireEvent.click(screen.getByRole("button", { name: "Add models" }));
		await waitFor(() =>
			expect(toastSpy).toHaveBeenCalledWith(
				"Couldn't add the favourite",
				expect.objectContaining({
					description: "The loadout holds the default model and four more. Remove one first.",
				}),
			),
		);
		expect(service.store.getState().favorites).toHaveLength(4);
	});

	it("marks an unavailable favourite disabled and explains when picked", async () => {
		const onPick = vi.fn();
		const { wrapper } = await harness([favorite("a", "gone", 0)]);
		render(
			<>
				<FavoriteModels onPick={onPick} isAvailable={() => false} />
				<Toaster />
			</>,
			{ wrapper },
		);
		const select = await screen.findByRole("button", { name: "Select Claude Code · gone" });
		expect(select.getAttribute("aria-disabled")).toBe("true");
		fireEvent.click(select);
		expect(await screen.findByText("That model is no longer available")).toBeTruthy();
		expect(onPick).not.toHaveBeenCalled();
	});

	it("reorders with the edit controls", async () => {
		const { service, wrapper } = await harness([
			favorite("a", "m1", 0),
			favorite("b", "m2", 1),
			favorite("c", "m3", 2),
		]);
		// "Edit" moved to the model picker's footer, as in Conductor; the list takes edit mode as a prop.
		render(<FavoriteModels onPick={() => {}} editing />, { wrapper });
		// Conductor's rows reorder by a grip; from the keyboard the grip moves its row up and down.
		fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Claude Code · m2" }), {
			key: "ArrowUp",
		});
		await waitFor(() =>
			expect(service.store.getState().favorites.map((model) => model.config.model)).toEqual([
				"m2",
				"m1",
				"m3",
			]),
		);
	});

	it("drags a favourite by its grip onto another row, with no arrow buttons", async () => {
		const { service, wrapper } = await harness([
			favorite("a", "m1", 0),
			favorite("b", "m2", 1),
			favorite("c", "m3", 2),
		]);
		render(<FavoriteModels onPick={() => {}} editing />, { wrapper });
		expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
		const grip = screen.getByRole("button", { name: "Reorder Claude Code · m3" });
		expect(grip.getAttribute("draggable")).toBe("true");
		// The default model's row has no grip: it stays first.
		expect(screen.queryByRole("button", { name: "Reorder Claude Code · default" })).toBeNull();

		const data = new Map<string, string>();
		const dataTransfer = {
			setData: (type: string, value: string) => data.set(type, value),
			getData: (type: string) => data.get(type) ?? "",
			get types() {
				return [...data.keys()];
			},
			effectAllowed: "move",
			dropEffect: "move",
		};
		fireEvent.dragStart(grip, { dataTransfer });
		const target = screen.getByRole("button", { name: "Select Claude Code · m1" });
		fireEvent.dragOver(target, { dataTransfer });
		fireEvent.drop(target, { dataTransfer });

		await waitFor(() =>
			expect(service.store.getState().favorites.map((model) => model.config.model)).toEqual([
				"m3",
				"m1",
				"m2",
			]),
		);
	});

	it("removes the last favourite", async () => {
		const { service, wrapper } = await harness([favorite("a", "m1", 0)]);
		render(<FavoriteModels onPick={() => {}} editing />, { wrapper });
		fireEvent.click(screen.getByRole("button", { name: "Remove Claude Code · m1" }));
		await waitFor(() => expect(service.store.getState().favorites).toHaveLength(0));
		// The list reloads from the database empty, so the removal was stored.
		const reloaded = await service.start();
		expect(reloaded.ok).toBe(true);
		expect(service.store.getState().favorites).toHaveLength(0);
	});
});
