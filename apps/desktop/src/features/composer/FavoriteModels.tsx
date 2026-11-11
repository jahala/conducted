/**
 * @feature COMP-02 Favourite models
 * Owns: The loadout list inside the model picker: the default model first, then up to four saved
 * agent and model pairs, with reorder and edit for the saved ones (use-loadout.ts).
 * Behaviour: ui-map.md 3.5 (favourites called 'loadouts': up to 5, Cmd+Ctrl+1..5, reorder, 'Add
 * models', 'Edit'), services-map.md (favourite_models table).
 * Measured from Conductor 0.92.1 (renderApp, the model menu's favourites list and its rows): each row is
 * 32px with 4px between rows: the model name, its effort in small muted text, then a check when it is the
 * chat's choice, an up-right arrow when it opens a new chat, or its loadout shortcut. "Add models" shows
 * under the list while there are fewer than three favourites, with a plus in a 24px column.
 * While "Edit" (in the picker footer) is on, each saved favourite has Conductor's grip in the 24px
 * column ("Reorder", renderApp fsi @9227313): drag it onto another row to move it there. Remove sits
 * at the row end.
 * Our design choice: from the keyboard, ArrowUp and ArrowDown on a focused grip move its row one place;
 * Conductor's drag library lifts a row with Space first. "Add models" also shows while editing, so a
 * favourite can be added at any count.
 * Must handle: An 'Add models' row, which explains the limit when full; the default model's row,
 * which Edit cannot move or remove (it is Default models' first slot in Settings); a
 * favourite whose model is gone (shown muted and marked unavailable, picking it explains); reorder by
 * keyboard; removing the last favourite; a fifth favourite is refused with a message.
 * Keyboard: the loadout shortcuts are command handlers in the picker, which stays mounted while this
 * list is closed. The key caps here read the live binding so a rebind is shown.
 * Test first: Adding a fifth favourite is refused with a message; an unavailable favourite is muted;
 * the default model is the first row.
 */
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { agentDisplayName } from "../../core/agent-catalog.ts";
import { useServices } from "../../core/context.tsx";
import type { FavoriteModel } from "../../core/favorite-model.ts";
import { useLiveShortcut } from "../../core/hooks.ts";
import { cn } from "../../ui/cn.ts";
import {
	ArrowUpRightIcon,
	CheckIcon,
	CloseIcon,
	GripVerticalIcon,
	PlusIcon,
} from "../../ui/icons.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";
import { useLoadout } from "./use-loadout.ts";

export interface FavoriteModelsProps {
	onPick: (config: FavoriteModel["config"]) => void;
	/** The choice the picker is showing, used by "Add models" and to mark the selected row. */
	config?: FavoriteModel["config"];
	/** False when the agent no longer offers the saved model. */
	isAvailable?: (config: FavoriteModel["config"]) => boolean;
	/** The model's display name; the saved model id when the agent's models are not loaded. */
	labelFor?: (config: FavoriteModel["config"]) => string;
	/** The effort's display name. */
	effortLabelFor?: (config: FavoriteModel["config"]) => string | null;
	/** True when picking this favourite starts a new chat (another agent in a started chat). */
	opensNewChat?: (config: FavoriteModel["config"]) => boolean;
	/** Edit mode: reorder and remove controls, and "Add models" at any count. */
	editing?: boolean;
}

/** The chat's choice matches a favourite when the agent, model and effort match. */
export function isFavoriteSelected(
	favorite: FavoriteModel["config"],
	config: FavoriteModel["config"] | undefined,
): boolean {
	return (
		config !== undefined &&
		favorite.agent === config.agent &&
		favorite.acpAgent === config.acpAgent &&
		favorite.model === config.model &&
		favorite.effort === config.effort
	);
}

/** The drag type of a favourite moved by its grip; its data is the favourite's id. */
const FAVORITE_MIME = "application/x-conducted-favorite";

const rowClass =
	"flex w-full items-center gap-2 rounded-md py-1.5 pr-3 text-left text-sm text-fg outline-none hover:bg-hover focus-visible:bg-hover";

export function FavoriteModels({
	onPick,
	config,
	isAvailable,
	labelFor,
	effortLabelFor,
	opensNewChat,
	editing = false,
}: FavoriteModelsProps) {
	const service = useServices().services.favoriteModels;
	const loaded = useStore(service.store, (state) => state.loaded);
	const favorites = useStore(service.store, (state) => state.favorites);
	const { entries } = useLoadout();
	const shortcuts = [
		useLiveShortcut("chat.selectLoadout1"),
		useLiveShortcut("chat.selectLoadout2"),
		useLiveShortcut("chat.selectLoadout3"),
		useLiveShortcut("chat.selectLoadout4"),
		useLiveShortcut("chat.selectLoadout5"),
	];
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

	/** Moves the favourite with `id` to position `target` among the saved favourites. */
	const moveTo = async (id: string, target: number) => {
		const from = favorites.findIndex((favorite) => favorite.id === id);
		const to = Math.max(0, Math.min(target, favorites.length - 1));
		if (from === -1 || from === to) return;
		const next = [...favorites];
		const [moved] = next.splice(from, 1);
		if (moved === undefined) return;
		next.splice(to, 0, moved);
		const result = await service.reorder(next.map((favorite) => favorite.id));
		if (!result.ok) toastError("Couldn't reorder the favourites", result.error);
	};

	const remove = async (id: string) => {
		const result = await service.remove(id);
		if (!result.ok) toastError("Couldn't remove the favourite", result.error);
	};

	const showAdd = editing || favorites.length < 3;

	return (
		<section aria-label="Favourite models" className="flex flex-col gap-1">
			{entries.map((favorite, entryIndex) => {
				const index = favorites.findIndex((saved) => saved.id === favorite.id);
				const label = `${agentDisplayName(favorite.config)} · ${favorite.config.model}`;
				const available = isAvailable?.(favorite.config) ?? true;
				const selected = isFavoriteSelected(favorite.config, config);
				const newChat = !selected && (opensNewChat?.(favorite.config) ?? false);
				const effort = effortLabelFor?.(favorite.config) ?? null;
				return (
					// biome-ignore lint/a11y/noStaticElementInteractions: the row is where a dragged grip drops; its buttons are the interactive parts.
					<div
						key={favorite.id}
						className="flex min-w-0 items-center"
						onDragOver={(event) => {
							if (editing && event.dataTransfer.types.includes(FAVORITE_MIME)) {
								event.preventDefault();
								event.dataTransfer.dropEffect = "move";
							}
						}}
						onDrop={(event) => {
							const id = event.dataTransfer.getData(FAVORITE_MIME);
							if (!editing || id === "") return;
							event.preventDefault();
							// The default model stays first, so a drop on it moves the favourite to the top.
							void moveTo(id, favorite.isDefault ? 0 : index);
						}}
					>
						{editing && favorite.isDefault ? <span className="w-6 shrink-0" /> : null}
						{editing && !favorite.isDefault ? (
							<button
								type="button"
								draggable
								aria-label={`Reorder ${label}`}
								onDragStart={(event) => {
									event.dataTransfer.setData(FAVORITE_MIME, favorite.id);
									event.dataTransfer.effectAllowed = "move";
								}}
								onKeyDown={(event) => {
									if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
									event.preventDefault();
									event.stopPropagation();
									void moveTo(favorite.id, index + (event.key === "ArrowUp" ? -1 : 1));
								}}
								className="flex w-6 shrink-0 cursor-grab items-center justify-center self-stretch rounded-sm text-fg-muted outline-none focus-visible:bg-hover focus-visible:text-fg focus-visible:ring-1 focus-visible:ring-focus focus-visible:ring-inset active:cursor-grabbing"
							>
								<GripVerticalIcon className="size-3.5" />
							</button>
						) : null}
						<button
							type="button"
							aria-label={`Select ${label}`}
							aria-disabled={!available}
							data-selected={selected || undefined}
							title={label}
							onClick={() => {
								if (!available) {
									toast("That model is no longer available", {
										description: "Choose another model for this agent.",
									});
									return;
								}
								onPick(favorite.config);
							}}
							className={cn(
								rowClass,
								editing ? "pl-0" : "pl-2",
								"min-w-0 aria-disabled:text-fg-muted",
							)}
						>
							<span className="min-w-0 truncate">
								{labelFor?.(favorite.config) ?? favorite.config.model}
							</span>
							{effort === null ? null : (
								<span className="min-w-0 truncate text-xs text-fg-muted">{effort}</span>
							)}
							{!available ? (
								<span className="text-2xs uppercase tracking-wider text-fg-muted">Unavailable</span>
							) : null}
							{selected ? (
								<CheckIcon className="ml-auto size-3.5 shrink-0" />
							) : newChat ? (
								<span title="Opens in new chat" className="ml-auto shrink-0 text-fg-muted">
									<ArrowUpRightIcon className="size-3.5" />
								</span>
							) : (
								<span className="ml-auto shrink-0 text-xs tracking-widest text-fg-muted">
									{shortcuts[entryIndex] ?? ""}
								</span>
							)}
						</button>
						{editing && !favorite.isDefault ? (
							<button
								type="button"
								aria-label={`Remove ${label}`}
								onClick={() => void remove(favorite.id)}
								className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted outline-none hover:bg-hover hover:text-fg focus-visible:bg-hover"
							>
								<CloseIcon className="size-3" />
							</button>
						) : null}
					</div>
				);
			})}
			{showAdd ? (
				<button
					type="button"
					disabled={config === undefined || busy}
					onClick={() => void add()}
					className={cn(rowClass, "text-fg-muted disabled:cursor-not-allowed disabled:opacity-50")}
				>
					<span className="flex w-6 shrink-0 justify-center">
						<PlusIcon className="size-3.5" aria-hidden="true" />
					</span>
					<span className="min-w-0 truncate">Add models</span>
					<ArrowUpRightIcon className="ml-auto size-3.5 shrink-0" aria-hidden="true" />
				</button>
			) : null}
		</section>
	);
}
