/**
 * @feature COMP-02 Favourite models
 * Owns: The favourites list inside the model picker: up to five saved agent and model pairs, with
 * reorder and edit.
 * Behaviour: ui-map.md 3.5 (favourites called 'loadouts': up to 5, Cmd+Ctrl+1..5, reorder, 'Add
 * models', 'Edit'), services-map.md (favourite_models table).
 * Must handle: Fewer than five (an 'Add models' row); a favourite whose model is gone (shown muted,
 * picking it explains); reorder by keyboard; removing the last favourite; a sixth favourite is
 * refused with a message.
 * Test first: Adding a sixth favourite is refused with a message; Cmd+Ctrl+2 selects the second.
 */
import type { SessionConfig } from "@conducted/protocol";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import { type FavoriteModel, MAX_FAVORITES } from "../../core/services/favorite-models.ts";
import { Button } from "../../ui/Button.tsx";
import { CloseIcon } from "../../ui/icons.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";

/** What the user sees for an agent choice, including the two ACP agents. */
export function agentDisplayName(choice: Pick<SessionConfig, "agent" | "acpAgent">): string {
	if (choice.agent === "claude") return "Claude Code";
	if (choice.agent === "codex") return "Codex";
	if (choice.agent === "cursor") return "Cursor";
	return choice.acpAgent === "pi" ? "Pi" : "OpenCode";
}

export interface FavoriteModelsProps {
	onPick: (config: FavoriteModel["config"]) => void;
	/** The choice the picker is showing, used by "Add models". */
	config?: FavoriteModel["config"];
	/** False when the agent no longer offers the saved model. */
	isAvailable?: (config: FavoriteModel["config"]) => boolean;
}

const shortcut = (index: number): string => `⌘⌃${index + 1}`;

export function FavoriteModels({ onPick, config, isAvailable }: FavoriteModelsProps) {
	const service = useServices().services.favoriteModels;
	const loaded = useStore(service.store, (state) => state.loaded);
	const favorites = useStore(service.store, (state) => state.favorites);
	const [editing, setEditing] = useState(false);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!loaded) void service.start();
	}, [loaded, service]);

	// Cmd+Ctrl+1 to 5 pick a saved loadout even while the picker is closed.
	useEffect(() => {
		const handleShortcut = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			if (!event.metaKey || !event.ctrlKey || event.shiftKey || event.altKey) return;
			const index = Number(event.key) - 1;
			if (!Number.isInteger(index) || index < 0 || index >= MAX_FAVORITES) return;
			const favorite = favorites[index];
			if (favorite === undefined) return;
			event.preventDefault();
			onPick(favorite.config);
		};
		window.addEventListener("keydown", handleShortcut);
		return () => window.removeEventListener("keydown", handleShortcut);
	}, [favorites, onPick]);

	const add = async () => {
		if (config === undefined || busy) return;
		setBusy(true);
		const result = await service.add(config);
		setBusy(false);
		if (!result.ok) {
			toastError("Couldn't add the favourite", result.error);
			return;
		}
		toast("Favourite saved", {
			description: `${agentDisplayName(result.value.config)} · ${result.value.config.model}`,
		});
	};

	const move = async (index: number, delta: number) => {
		const target = index + delta;
		if (target < 0 || target >= favorites.length) return;
		const next = [...favorites];
		const current = next[index];
		const other = next[target];
		if (current === undefined || other === undefined) return;
		next[index] = other;
		next[target] = current;
		const result = await service.reorder(next.map((favorite) => favorite.id));
		if (!result.ok) toastError("Couldn't reorder the favourites", result.error);
	};

	const remove = async (favorite: FavoriteModel) => {
		const result = await service.remove(favorite.id);
		if (!result.ok) toastError("Couldn't remove the favourite", result.error);
	};

	return (
		<section aria-label="Favourite models" className="space-y-1">
			<div className="flex items-center justify-between px-2 py-1">
				<h3 className="text-xs font-medium text-fg-subtle">Favourites</h3>
				{favorites.length > 0 ? (
					<Button variant="ghost" size="xs" onClick={() => setEditing((value) => !value)}>
						{editing ? "Done" : "Edit"}
					</Button>
				) : null}
			</div>
			{favorites.map((favorite, index) => {
				const label = `${agentDisplayName(favorite.config)} · ${favorite.config.model}`;
				const available = isAvailable?.(favorite.config) ?? true;
				return (
					<div key={favorite.id} className="flex items-center gap-1">
						{editing ? (
							<>
								<Button
									variant="ghost"
									size="xs"
									aria-label={`Move ${label} up`}
									disabled={index === 0}
									onClick={() => void move(index, -1)}
								>
									↑
								</Button>
								<Button
									variant="ghost"
									size="xs"
									aria-label={`Move ${label} down`}
									disabled={index === favorites.length - 1}
									onClick={() => void move(index, 1)}
								>
									↓
								</Button>
							</>
						) : null}
						<button
							type="button"
							aria-label={`Select ${label}`}
							onClick={() => {
								if (!available) {
									toast("That model is no longer available", {
										description: "Choose another model for this agent.",
									});
									return;
								}
								onPick(favorite.config);
							}}
							className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg outline-none hover:bg-hover aria-disabled:text-fg-muted"
						>
							<span className="flex-1 truncate">{label}</span>
							{!available ? (
								<span className="text-2xs uppercase tracking-wider text-fg-muted">Unavailable</span>
							) : null}
							<span className="text-xs tracking-widest text-fg-muted">{shortcut(index)}</span>
						</button>
						{editing ? (
							<Button
								variant="ghost"
								size="xs"
								aria-label={`Remove ${label}`}
								onClick={() => void remove(favorite)}
							>
								<CloseIcon />
							</Button>
						) : null}
					</div>
				);
			})}
			{favorites.length < MAX_FAVORITES ? (
				<Button
					variant="ghost"
					size="sm"
					className="w-full justify-start"
					disabled={config === undefined || busy}
					onClick={() => void add()}
				>
					Add models
				</Button>
			) : null}
		</section>
	);
}
