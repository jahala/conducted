/**
 * @feature COMP-02 Favourite models for the model picker
 * Owns: the user's saved model choices (agent, model, effort, fast mode) and their order.
 * Behaviour: services-map.md 5B.5.3 (favourite models: ordered list written as a diff), 5B.5.2
 * (default model per agent), ui-map.md 3.5 (model picker).
 * Must handle: the same choice saved twice is one favourite; a favourite whose model the agent
 * no longer offers stays in the list but is marked unavailable by the picker; order is the
 * `position` column and stays dense; writes are one transaction (update, insert, delete missing);
 * at most five favourites are saved.
 * Our design choice: favourites are local only, with no sync.
 * Test first: adding an existing configuration returns the existing favourite.
 */
import type { SessionConfig } from "@conducted/protocol";
import { appError, err, ok, type Result } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Repositories } from "../db/repositories.ts";

export interface FavoriteModel {
	id: string;
	config: Pick<SessionConfig, "agent" | "acpAgent" | "model" | "effort" | "fastMode">;
	position: number;
}

/** The picker shows five loadouts, selected with Cmd+Ctrl+1 to 5. */
export const MAX_FAVORITES = 5;

export interface FavoriteModelsState {
	loaded: boolean;
	favorites: readonly FavoriteModel[];
}

export interface FavoriteModelsServiceDeps {
	repos: Pick<Repositories, "favoriteModels">;
}

/** Two choices are the same favourite when every field of the choice matches. */
export function sameFavoriteChoice(
	left: FavoriteModel["config"],
	right: FavoriteModel["config"],
): boolean {
	return (
		left.agent === right.agent &&
		left.acpAgent === right.acpAgent &&
		left.model === right.model &&
		left.effort === right.effort &&
		left.fastMode === right.fastMode
	);
}

const byPosition = (favorites: readonly FavoriteModel[]): FavoriteModel[] =>
	[...favorites].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

export class FavoriteModelsService {
	readonly store: StoreApi<FavoriteModelsState>;
	readonly #deps: FavoriteModelsServiceDeps;

	constructor(deps: FavoriteModelsServiceDeps) {
		this.#deps = deps;
		this.store = createStore<FavoriteModelsState>(() => ({ loaded: false, favorites: [] }));
	}

	async start(): Promise<Result<void>> {
		const listed = await this.#deps.repos.favoriteModels.list();
		if (!listed.ok) return err(listed.error);
		this.store.setState({ loaded: true, favorites: byPosition(listed.value) });
		return ok(undefined);
	}

	async add(config: FavoriteModel["config"]): Promise<Result<FavoriteModel>> {
		const state = this.store.getState();
		if (!state.loaded) {
			const loaded = await this.start();
			if (!loaded.ok) return err(loaded.error);
		}
		const favorites = this.store.getState().favorites;
		const existing = favorites.find((favorite) => sameFavoriteChoice(favorite.config, config));
		if (existing !== undefined) return ok(existing);
		if (favorites.length >= MAX_FAVORITES) {
			return err(
				appError("favorite_limit", "You can save up to five favourite models. Remove one first."),
			);
		}
		const added = await this.#deps.repos.favoriteModels.add(config);
		if (!added.ok) return err(added.error);
		this.store.setState({ favorites: byPosition([...favorites, added.value]) });
		return ok(added.value);
	}

	async remove(id: string): Promise<Result<void>> {
		const before = this.store.getState().favorites;
		const removed = await this.#deps.repos.favoriteModels.delete(id);
		if (!removed.ok) return err(removed.error);
		const remaining = before.filter((favorite) => favorite.id !== id);
		if (remaining.length === before.length) return ok(undefined);
		const reordered = await this.#deps.repos.favoriteModels.reorder(
			remaining.map((favorite) => favorite.id),
		);
		if (!reordered.ok) return err(reordered.error);
		this.store.setState({
			favorites: remaining.map((favorite, position) => ({ ...favorite, position })),
		});
		return ok(undefined);
	}

	async reorder(orderedIds: readonly string[]): Promise<Result<void>> {
		const before = this.store.getState().favorites;
		if (before.length === 0) return ok(undefined);
		const byId = new Map(before.map((favorite) => [favorite.id, favorite]));
		const ordered: FavoriteModel[] = [];
		for (const id of orderedIds) {
			const favorite = byId.get(id);
			if (favorite !== undefined && !ordered.includes(favorite)) ordered.push(favorite);
		}
		for (const favorite of before) {
			if (!ordered.includes(favorite)) ordered.push(favorite);
		}
		const written = await this.#deps.repos.favoriteModels.reorder(
			ordered.map((favorite) => favorite.id),
		);
		if (!written.ok) return err(written.error);
		this.store.setState({
			favorites: ordered.map((favorite, position) => ({ ...favorite, position })),
		});
		return ok(undefined);
	}
}
