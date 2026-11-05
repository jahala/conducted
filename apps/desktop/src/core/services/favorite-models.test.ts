import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import {
	type FavoriteModel,
	FavoriteModelsService,
	type FavoriteModelsServiceDeps,
} from "./favorite-models.ts";

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

const serviceWith = (initial: readonly FavoriteModel[] = []) => {
	const repo = fakeRepo(initial);
	const service = new FavoriteModelsService({
		repos: { favoriteModels: repo },
	} as unknown as FavoriteModelsServiceDeps);
	return { repo, service };
};

describe("COMP-02 favourite models service", () => {
	it("loads the saved favourites in position order", async () => {
		const { service } = serviceWith([favorite("a", "m1", 1), favorite("b", "m2", 0)]);
		expect(await service.start()).toEqual({ ok: true, value: undefined });
		expect(service.store.getState().favorites.map((model) => model.id)).toEqual(["b", "a"]);
	});

	it("adding an existing configuration returns the existing favourite", async () => {
		const { repo, service } = serviceWith([favorite("a", "m1", 0)]);
		await service.start();
		const result = await service.add(choice("m1"));
		expect(result.ok && result.value.id).toBe("a");
		expect(repo.state.addCalls).toBe(0);
		expect(service.store.getState().favorites).toHaveLength(1);
	});

	it("adds a new configuration after the last favourite", async () => {
		const { service } = serviceWith([favorite("a", "m1", 0)]);
		await service.start();
		const result = await service.add(choice("m2"));
		expect(result.ok).toBe(true);
		expect(service.store.getState().favorites.map((model) => model.config.model)).toEqual([
			"m1",
			"m2",
		]);
	});

	it("refuses a sixth favourite instead of saving it", async () => {
		const { repo, service } = serviceWith([
			favorite("a", "m1", 0),
			favorite("b", "m2", 1),
			favorite("c", "m3", 2),
			favorite("d", "m4", 3),
			favorite("e", "m5", 4),
		]);
		await service.start();
		const result = await service.add(choice("m6"));
		expect(result.ok).toBe(false);
		expect(result.ok ? "" : result.error.code).toBe("favorite_limit");
		expect(repo.state.addCalls).toBe(0);
		expect(service.store.getState().favorites).toHaveLength(5);
	});

	it("removing a favourite leaves dense positions", async () => {
		const { repo, service } = serviceWith([
			favorite("a", "m1", 0),
			favorite("b", "m2", 1),
			favorite("c", "m3", 2),
		]);
		await service.start();
		expect(await service.remove("b")).toEqual({ ok: true, value: undefined });
		expect(service.store.getState().favorites).toEqual([
			favorite("a", "m1", 0),
			favorite("c", "m3", 1),
		]);
		expect(repo.state.reorderCalls.at(-1)).toEqual(["a", "c"]);
	});

	it("reordering keeps every favourite and rewrites positions", async () => {
		const { repo, service } = serviceWith([
			favorite("a", "m1", 0),
			favorite("b", "m2", 1),
			favorite("c", "m3", 2),
		]);
		await service.start();
		expect(await service.reorder(["c", "a", "b"])).toEqual({ ok: true, value: undefined });
		expect(service.store.getState().favorites.map((model) => model.id)).toEqual(["c", "a", "b"]);
		expect(service.store.getState().favorites.map((model) => model.position)).toEqual([0, 1, 2]);
		expect(repo.state.reorderCalls.at(-1)).toEqual(["c", "a", "b"]);
	});
});
