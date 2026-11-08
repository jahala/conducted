import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { FavoriteModel } from "../favorite-model.ts";
import { FavoriteModelsService, type FavoriteModelsServiceDeps } from "./favorite-models.ts";

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
		nextId: initial.length,
		/** When set, `reorder` waits for it, so a test can interleave other calls. */
		reorderGate: null as Promise<void> | null,
	};
	return {
		state,
		async list() {
			return ok([...state.favorites]);
		},
		async add(config: FavoriteModel["config"]) {
			state.addCalls += 1;
			const model: FavoriteModel = {
				id: `fav-${++state.nextId}`,
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
			await state.reorderGate;
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

	it("saves only one of two quick favourites when the list has one slot", async () => {
		const { repo, service } = serviceWith([
			favorite("a", "m1", 0),
			favorite("b", "m2", 1),
			favorite("c", "m3", 2),
		]);
		await service.start();
		const results = await Promise.all([service.add(choice("m6")), service.add(choice("m7"))]);
		expect(results.filter((result) => result.ok)).toHaveLength(1);
		expect(repo.state.addCalls).toBe(1);
		expect(service.store.getState().favorites).toHaveLength(4);
	});

	// Conductor's loadout is five models: the default model, then four more (renderApp, the picker's
	// favourites and the Loadout page).
	it("refuses a fifth favourite instead of saving it: the default is the loadout's first", async () => {
		const { repo, service } = serviceWith([
			favorite("a", "m1", 0),
			favorite("b", "m2", 1),
			favorite("c", "m3", 2),
			favorite("d", "m4", 3),
		]);
		await service.start();
		const result = await service.add(choice("m6"));
		expect(result.ok).toBe(false);
		expect(result.ok ? "" : result.error.code).toBe("favorite_limit");
		expect(repo.state.addCalls).toBe(0);
		expect(service.store.getState().favorites).toHaveLength(4);
	});

	it("replaces a favourite in its own place", async () => {
		const { repo, service } = serviceWith([
			favorite("a", "m1", 0),
			favorite("b", "m2", 1),
			favorite("c", "m3", 2),
		]);
		await service.start();
		const replaced = await service.replace("b", choice("m9"));
		expect(replaced.ok).toBe(true);
		expect(service.store.getState().favorites.map((entry) => entry.config.model)).toEqual([
			"m1",
			"m9",
			"m3",
		]);
		expect(repo.state.deleteCalls).toEqual(["b"]);
		expect((await repo.list()).ok).toBe(true);
	});

	it("moves a favourite that already holds the new choice into the replaced place", async () => {
		const { repo, service } = serviceWith([
			favorite("a", "m1", 0),
			favorite("b", "m2", 1),
			favorite("c", "m3", 2),
		]);
		await service.start();
		const replaced = await service.replace("a", choice("m3"));
		expect(replaced.ok).toBe(true);
		expect(service.store.getState().favorites.map((entry) => entry.config.model)).toEqual([
			"m3",
			"m2",
		]);
		expect(repo.state.addCalls).toBe(0);
		expect(repo.state.deleteCalls).toEqual(["a"]);
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

	it("keeps a favourite added while a removal is writing", async () => {
		const { repo, service } = serviceWith([
			favorite("a", "m1", 0),
			favorite("b", "m2", 1),
			favorite("c", "m3", 2),
		]);
		await service.start();
		let release: () => void = () => undefined;
		repo.state.reorderGate = new Promise<void>((resolve) => {
			release = resolve;
		});

		const removing = service.remove("b");
		const adding = service.add(choice("m4"));
		release();
		const [removed, added] = await Promise.all([removing, adding]);

		expect(removed.ok && added.ok).toBe(true);
		const shown = service.store.getState().favorites.map((model) => model.config.model);
		expect(shown).toEqual(["m1", "m3", "m4"]);
		expect(repo.state.favorites.map((model) => model.config.model)).toEqual(shown);
	});

	it("gives every saved favourite its own id, also after a removal", async () => {
		const { repo, service } = serviceWith([favorite("fav-1", "m1", 0), favorite("fav-2", "m2", 1)]);
		await service.start();
		await service.remove("fav-1");
		await service.add(choice("m3"));
		await service.add(choice("m4"));
		const ids = repo.state.favorites.map((model) => model.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
