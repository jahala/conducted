/**
 * @feature COMP-02 Favourite models
 * Owns: The favourites list inside the model picker: up to five saved agent and model pairs, with
 * reorder and edit.
 * Behaviour: ui-map.md 3.5 (favourites called 'loadouts': up to 5, Cmd+Ctrl+1..5, reorder, 'Add
 * models', 'Edit'), services-map.md (favourite_models table).
 * Must handle: Fewer than five (an 'Add models' row); a favourite whose model is gone (shown muted,
 * picking it explains); reorder by keyboard; removing the last favourite.
 * Test first: Adding a sixth favourite is refused with a message; Cmd+Ctrl+2 selects the second.
 */
import { notImplemented } from "@conducted/shared";

export interface FavoriteModelsProps {
	onPick: (agent: string, model: string) => void;
}

export function FavoriteModels(_props: FavoriteModelsProps): never {
	return notImplemented("COMP-02");
}
