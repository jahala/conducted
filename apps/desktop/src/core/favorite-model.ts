/**
 * @feature COMP-02 Favourite models for the model picker
 * Owns: the shape of a saved favourite model choice and the loadout's size, which the model
 * pickers and the loadout editor read. The service that stores favourites imports them.
 * Behaviour: services-map.md 5B.5.3 (favourite models), ui-map.md 3.5 (model picker).
 */
import type { SessionConfig } from "@conducted/protocol";

export interface FavoriteModel {
	id: string;
	config: Pick<SessionConfig, "agent" | "acpAgent" | "model" | "effort" | "fastMode">;
	position: number;
}

/**
 * The loadout is five models, selected with Cmd+Ctrl+1 to 5: the default model first, then up to
 * four favourites, as in Conductor (renderApp, the picker's favourites and the Loadout page).
 */
export const LOADOUT_SIZE = 5;
export const MAX_FAVORITES = LOADOUT_SIZE - 1;
