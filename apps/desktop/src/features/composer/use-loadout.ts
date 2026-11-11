/**
 * @feature COMP-02 The loadout
 * Owns: the five models the picker offers first and Cmd+Ctrl+1 to 5 selects: the default model,
 * then the saved favourites.
 * Behaviour: Conductor's picker lists the default model's favourite first and then the stored ones,
 * five at most (renderApp, the model picker's favourites); its Loadout settings page draws the same
 * five slots with the first marked DEFAULT.
 * Data: the default from settings through core/lookups.ts defaultModelChoice (the rule new chats
 * use), the favourites from FavoriteModelsService.
 * Must handle: a default effort setting no chat can use (no default entry; the favourites still
 * show); favourites still loading.
 * Test first: the default model is loadout 1 and the first favourite loadout 2.
 */
import { useMemo } from "react";
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import type { FavoriteModel } from "../../core/favorite-model.ts";
import { useSetting } from "../../core/hooks.ts";
import { defaultModelChoice } from "../../core/lookups.ts";

export interface LoadoutEntry {
	/** "default" for the default model, else the favourite's id. */
	id: string;
	config: FavoriteModel["config"];
	isDefault: boolean;
}

export const DEFAULT_LOADOUT_ID = "default";

export function useLoadout(): { loaded: boolean; entries: readonly LoadoutEntry[] } {
	const service = useServices().services.favoriteModels;
	const loaded = useStore(service.store, (state) => state.loaded);
	const favorites = useStore(service.store, (state) => state.favorites);
	const model = useSetting<string>("default_model");
	const effort = useSetting<string>("default_claude_effort_level");
	const fastMode = useSetting<boolean>("default_fast_mode");
	const entries = useMemo(() => {
		const values: Record<string, unknown> = {
			default_model: model,
			default_claude_effort_level: effort,
			default_fast_mode: fastMode,
		};
		const chosen = defaultModelChoice(<T>(key: string) => values[key] as T);
		const first: LoadoutEntry[] = chosen.ok
			? [{ id: DEFAULT_LOADOUT_ID, config: chosen.value, isDefault: true }]
			: [];
		return [
			...first,
			...favorites.map((favorite) => ({
				id: favorite.id,
				config: favorite.config,
				isDefault: false,
			})),
		];
	}, [effort, fastMode, favorites, model]);
	return { loaded, entries };
}
