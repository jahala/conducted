/**
 * @feature COMP-02 Favourite models for the model picker
 * Owns: the user's saved model choices (agent, model, effort, fast mode) and their order.
 * Behaviour: services-map.md 5B.5.3 (favourite models: ordered list written as a diff), 5B.5.2
 * (default model per agent), ui-map.md 3.5 (model picker).
 * Must handle: the same choice saved twice is one favourite; a favourite whose model the agent
 * no longer offers stays in the list but is marked unavailable by the picker; order is the
 * `position` column and stays dense; writes are one transaction (update, insert, delete missing).
 * Our design choice: favourites are local only, with no sync.
 * Test first: adding an existing configuration returns the existing favourite.
 */
import type { SessionConfig } from "@conducted/protocol";
import { notImplemented, type Result } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Repositories } from "../db/repositories.ts";

export interface FavoriteModel {
	id: string;
	config: Pick<SessionConfig, "agent" | "acpAgent" | "model" | "effort" | "fastMode">;
	position: number;
}

export interface FavoriteModelsState {
	loaded: boolean;
	favorites: readonly FavoriteModel[];
}

export interface FavoriteModelsServiceDeps {
	repos: Pick<Repositories, "favoriteModels">;
}

export class FavoriteModelsService {
	readonly store: StoreApi<FavoriteModelsState>;
	readonly #deps: FavoriteModelsServiceDeps;

	constructor(deps: FavoriteModelsServiceDeps) {
		this.#deps = deps;
		this.store = createStore<FavoriteModelsState>(() => ({ loaded: false, favorites: [] }));
	}

	start(): Promise<Result<void>> {
		void this.#deps;
		return notImplemented("COMP-02");
	}

	add(_config: FavoriteModel["config"]): Promise<Result<FavoriteModel>> {
		return notImplemented("COMP-02");
	}

	remove(_id: string): Promise<Result<void>> {
		return notImplemented("COMP-02");
	}

	reorder(_orderedIds: readonly string[]): Promise<Result<void>> {
		return notImplemented("COMP-02");
	}
}
