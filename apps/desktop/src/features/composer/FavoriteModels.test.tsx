import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import type { Container } from "../../core/container.ts";
import { ServicesProvider } from "../../core/context.tsx";
import {
	type FavoriteModel,
	FavoriteModelsService,
	type FavoriteModelsServiceDeps,
} from "../../core/services/favorite-models.ts";
import { toast } from "../../ui/Toast.tsx";
import { FavoriteModels } from "./FavoriteModels.tsx";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
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

const fakeRepo = (initial: readonly FavoriteModel[] = []) => {
	const state = {
		favorites: [...initial],
		addCalls: 0,
		reorderCalls: [] as string[][],
		deleteCalls: [] as string[],
	};
	return {
		state,
		async list() {
			return ok([...state.favorites]);
		},
		async add(config: FavoriteModel["config"]) {
			state.addCalls += 1;
			const model: FavoriteModel = {
				id: `fav-${state.favorites.length + 1}`,
				config,
				position: state.favorites.length,
			};
			state.favorites.push(model);
			return ok(model);
		},
		async setConfig() {
			return ok(true);
		},
		async reorder(orderedIds: readonly string[]) {
			state.reorderCalls.push([...orderedIds]);
			state.favorites = state.favorites
				.map((model) => ({ ...model, position: orderedIds.indexOf(model.id) }))
				.sort((a, b) => a.position - b.position);
			return ok(undefined);
		},
		async delete(id: string) {
			state.deleteCalls.push(id);
			state.favorites = state.favorites.filter((model) => model.id !== id);
			return ok(undefined);
		},
	};
};

const harness = async (initial: readonly FavoriteModel[] = []) => {
	const repo = fakeRepo(initial);
	const service = new FavoriteModelsService({
		repos: { favoriteModels: repo },
	} as unknown as FavoriteModelsServiceDeps);
	await service.start();
	const container = { services: { favoriteModels: service } } as unknown as Container;
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={container}>{children}</ServicesProvider>
	);
	return { repo, service, wrapper };
};

describe("COMP-02 favourite models list", () => {
	it("refuses a sixth favourite with a message", async () => {
		const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "toast-id");
		const { repo, service, wrapper } = await harness([
			favorite("a", "m1", 0),
			favorite("b", "m2", 1),
			favorite("c", "m3", 2),
			favorite("d", "m4", 3),
			favorite("e", "m5", 4),
		]);
		render(<FavoriteModels config={choice("m6")} onPick={() => {}} />, { wrapper });
		fireEvent.click(screen.getByRole("button", { name: "Add models" }));
		await waitFor(() =>
			expect(toastSpy).toHaveBeenCalledWith(
				"Couldn't add the favourite",
				expect.objectContaining({
					description: "You can save up to five favourite models. Remove one first.",
				}),
			),
		);
		expect(repo.state.addCalls).toBe(0);
		expect(service.store.getState().favorites).toHaveLength(5);
	});

	it("selects the second favourite with Cmd+Ctrl+2", async () => {
		const onPick = vi.fn();
		const { wrapper } = await harness([favorite("a", "m1", 0), favorite("b", "m2", 1)]);
		render(<FavoriteModels onPick={onPick} />, { wrapper });
		await screen.findByRole("button", { name: "Select Claude Code · m2" });
		fireEvent.keyDown(window, { key: "2", metaKey: true, ctrlKey: true });
		await waitFor(() => expect(onPick).toHaveBeenCalledWith(choice("m2")));
	});

	it("reorders with the edit controls", async () => {
		const { repo, service, wrapper } = await harness([
			favorite("a", "m1", 0),
			favorite("b", "m2", 1),
			favorite("c", "m3", 2),
		]);
		render(<FavoriteModels onPick={() => {}} />, { wrapper });
		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		fireEvent.click(screen.getByRole("button", { name: "Move Claude Code · m2 up" }));
		await waitFor(() =>
			expect(service.store.getState().favorites.map((model) => model.id)).toEqual(["b", "a", "c"]),
		);
		expect(repo.state.reorderCalls.at(-1)).toEqual(["b", "a", "c"]);
	});

	it("removes the last favourite", async () => {
		const { repo, service, wrapper } = await harness([favorite("a", "m1", 0)]);
		render(<FavoriteModels onPick={() => {}} />, { wrapper });
		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		fireEvent.click(screen.getByRole("button", { name: "Remove Claude Code · m1" }));
		await waitFor(() => expect(service.store.getState().favorites).toHaveLength(0));
		expect(repo.state.deleteCalls).toEqual(["a"]);
	});
});
