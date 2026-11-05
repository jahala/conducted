/**
 * @feature COMP-02 Favourite models
 * Owns: The favourites list inside the model picker: up to five saved agent and model pairs, with
 * reorder and edit.
 * Behaviour: ui-map.md 3.5 (favourites called 'loadouts': up to 5, Cmd+Ctrl+1..5, reorder, 'Add
 * models', 'Edit'), services-map.md (favourite_models table).
 * Must handle: An 'Add models' row at any count, which explains that five are the limit when full; a
 * favourite whose model is gone (shown muted and marked unavailable, picking it explains); reorder by
 * keyboard; removing the last favourite; a sixth favourite is refused with a message.
 * Keyboard: the loadout shortcuts are handled by the picker, which stays mounted while this list is
 * closed. The key caps here read the live binding so a rebind is shown.
 * Test first: Adding a sixth favourite is refused with a message; an unavailable favourite is muted.
 */
import type { SessionConfig } from "@conducted/protocol";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import { useLiveShortcut } from "../../core/hooks.ts";
import type { FavoriteModel } from "../../core/services/favorite-models.ts";
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

export function FavoriteModels({ onPick, config, isAvailable }: FavoriteModelsProps) {
	const service = useServices().services.favoriteModels;
	const loaded = useStore(service.store, (state) => state.loaded);
	const favorites = useStore(service.store, (state) => state.favorites);
	const shortcuts = [
		useLiveShortcut("chat.selectLoadout1"),
		useLiveShortcut("chat.selectLoadout2"),
		useLiveShortcut("chat.selectLoadout3"),
		useLiveShortcut("chat.selectLoadout4"),
		useLiveShortcut("chat.selectLoadout5"),
	];
	const [editing, setEditing] = useState(false);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!loaded) void service.start();
	}, [loaded, service]);

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
							aria-disabled={!available}
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
							<span className="text-xs tracking-widest text-fg-muted">
								{shortcuts[index] ?? ""}
							</span>
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
			<Button
				variant="ghost"
				size="sm"
				className="w-full justify-start"
				disabled={config === undefined || busy}
				onClick={() => void add()}
			>
				Add models
			</Button>
		</section>
	);
}
