/**
 * @feature SET-02 Loadout editor on the Default models page
 * Owns: the five loadout slots and the per-agent model columns below them, where models are put
 * into slots by dragging or with the keyboard.
 * Behaviour: Conductor's Loadout (renderApp, the models tab's "Loadout" row): five square slots in
 * one bordered row, the first marked DEFAULT; a filled slot names its model in mono text with the
 * effort under it and opens its choices when clicked; an empty slot reads "DROP MODEL HERE" when
 * it is the next one and "EMPTY" after that, with its number in the corner. Below, one column per
 * agent (Claude Code, Codex, Cursor, OpenCode) under a muted header: each model is a 40px row with
 * a check when it is in the loadout and a grip, dragged into a slot or added to the next slot with
 * Enter or Space; an agent that is not ready offers "Configure <agent>". Dropping a slot on another
 * reorders, and dropping it outside the slots removes it.
 * Data: useLoadout (the default model, then the favourites), the favourites service, useSettingSaves
 * for the default model's settings, useAgentInstalls and useModels per agent.
 * Our design choice: a slot's choices are a menu (model, effort, fast mode, and Remove for a
 * favourite) where Conductor opens its whole model picker, which is bound to a chat in our app. The
 * first slot is the default model of new chats, which start with Claude Code (core/lookups.ts), so
 * it takes Claude Code models only and stays first; the others reorder among themselves. Pi, our
 * own agent, has its column after OpenCode (D098). Conductor's "Share" needs a Conductor account
 * and is left out (D025, D107). Agent logos are not shipped, so headers and slots name the agent.
 * Must handle: the agent list not read yet (the editor asks for it, as the Agents page does);
 * models loading or failing per agent; an agent not installed; a full loadout (Enter
 * replaces the last slot, as Conductor's does); a choice already in another slot (it moves there);
 * a save that fails (a toast with the reason).
 * Test first: Enter on a model row puts it in the next empty slot.
 */
import type { ModelInfo } from "@conducted/protocol";
import type { AcpAgent, AgentKind, Result } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { type DragEvent, useEffect, useState } from "react";
import { useServices } from "../../../core/context.tsx";
import { useActions, useAgentInstalls, useModels } from "../../../core/hooks.ts";
import { agentDisplayName } from "../../../core/services/agent-catalog.ts";
import type { FavoriteModel } from "../../../core/services/favorite-models.ts";
import { LOADOUT_SIZE } from "../../../core/services/favorite-models.ts";
import { cn } from "../../../ui/cn.ts";
import { CheckIcon, GripVerticalIcon } from "../../../ui/icons.tsx";
import {
	Menu,
	MenuCheckboxItem,
	MenuContent,
	MenuItem,
	MenuLabel,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuTrigger,
} from "../../../ui/Menu.tsx";
import { toastError } from "../../../ui/Toast.tsx";
import { EFFORT_LABELS } from "../../composer/ModelPicker.tsx";
import { type LoadoutEntry, useLoadout } from "../../composer/use-loadout.ts";
import { useSettingSaves } from "../SettingRow.tsx";

type Choice = FavoriteModel["config"];

interface AgentColumnSpec {
	agent: AgentKind;
	acpAgent?: AcpAgent;
}

/** Conductor's columns, then Pi, our own ACP agent. */
const COLUMNS: readonly AgentColumnSpec[] = [
	{ agent: "claude" },
	{ agent: "codex" },
	{ agent: "cursor" },
	{ agent: "acp", acpAgent: "opencode" },
	{ agent: "acp", acpAgent: "pi" },
];

const MODEL_MIME = "application/x-conducted-loadout-model";
const SLOT_MIME = "application/x-conducted-loadout-slot";

const sameModel = (left: Choice, right: Choice): boolean =>
	left.agent === right.agent && left.acpAgent === right.acpAgent && left.model === right.model;

function effortLabel(model: ModelInfo | undefined, choice: Choice): string {
	return model?.effortLabels?.[choice.effort] ?? EFFORT_LABELS[choice.effort];
}

/** The choice a model row puts into a slot: the model with its own default effort. */
function choiceFor(spec: AgentColumnSpec, model: ModelInfo): Choice {
	return {
		agent: spec.agent,
		...(spec.acpAgent === undefined ? {} : { acpAgent: spec.acpAgent }),
		model: model.id,
		effort: model.defaultEffort,
		fastMode: false,
	};
}

export function LoadoutEditor() {
	const { entries } = useLoadout();
	const actions = useActions();
	const installs = useAgentInstalls();
	const installsAsked = installs.state !== "loading";
	// The agent list is read when a page needs it, as the Agents page does.
	useEffect(() => {
		if (!installsAsked) void actions.agents.refresh();
	}, [actions, installsAsked]);
	const favorites = useServices().services.favoriteModels;
	const saves = useSettingSaves();
	const [dropTarget, setDropTarget] = useState<number | null>(null);

	const report = (title: string, result: Result<unknown>) => {
		if (!result.ok) toastError(title, result.error);
	};

	const saveDefault = async (choice: Choice) => {
		// The default slot is new chats' model, and new chats start with Claude Code.
		if (choice.agent !== "claude") return;
		await saves.save("default_model", choice.model);
		await saves.save("default_claude_effort_level", choice.effort);
		await saves.save("default_fast_mode", choice.fastMode);
	};

	/** Puts `choice` into slot `index`: the default slot, a favourite's slot, or the next empty one. */
	const equip = async (choice: Choice, index: number) => {
		if (index === 0) {
			await saveDefault(choice);
			return;
		}
		const occupant = entries[index];
		if (occupant !== undefined && !occupant.isDefault) {
			report("Couldn't change the loadout", await favorites.replace(occupant.id, choice));
			return;
		}
		report("Couldn't add the model", await favorites.add(choice));
	};

	/** Enter or Space on a model row: the next empty slot, or the last one when all are full. */
	const addNext = (choice: Choice) => {
		void equip(choice, Math.min(entries.length, LOADOUT_SIZE - 1));
	};

	const remove = async (entry: LoadoutEntry) => {
		if (entry.isDefault) return;
		report("Couldn't remove the model", await favorites.remove(entry.id));
	};

	const move = async (from: number, to: number) => {
		const ids = entries.filter((entry) => !entry.isDefault).map((entry) => entry.id);
		const offset = entries[0]?.isDefault === true ? 1 : 0;
		const [moved] = ids.splice(from - offset, 1);
		if (moved === undefined) return;
		ids.splice(Math.max(0, to - offset), 0, moved);
		report("Couldn't reorder the loadout", await favorites.reorder(ids));
	};

	const dropOn = (index: number) => (event: DragEvent<HTMLElement>) => {
		event.preventDefault();
		setDropTarget(null);
		const model = event.dataTransfer.getData(MODEL_MIME);
		if (model !== "") {
			const choice = JSON.parse(model) as Choice;
			if (index === 0 && choice.agent !== "claude") return;
			void equip(choice, Math.min(index, entries.length));
			return;
		}
		const from = Number(event.dataTransfer.getData(SLOT_MIME));
		if (Number.isInteger(from) && from > 0 && index > 0 && from !== index) {
			void move(from, Math.min(index, entries.length - 1));
		}
	};

	const allowDrop = (index: number) => (event: DragEvent<HTMLElement>) => {
		event.preventDefault();
		setDropTarget(index);
	};

	return (
		<div className="flex w-full max-w-2xl select-none flex-col">
			{/* Dropping a slot anywhere outside the slots removes it, as in Conductor. */}
			<ul
				aria-label="Loadout"
				className="relative m-0 grid list-none grid-cols-5 border-t border-l border-border p-0"
			>
				{Array.from({ length: LOADOUT_SIZE }, (_, index) => {
					const entry = entries[index];
					const highlighted = dropTarget === index;
					return (
						<li
							// biome-ignore lint/suspicious/noArrayIndexKey: a slot is its position.
							key={index}
							aria-label={`Slot ${index + 1}`}
							onDragOver={allowDrop(index)}
							onDragLeave={() => setDropTarget(null)}
							onDrop={dropOn(index)}
							className={cn(
								"relative aspect-square border-r border-b border-border transition-shadow duration-100",
								highlighted && "ring-1 ring-focus ring-inset",
							)}
						>
							{entry === undefined ? (
								<EmptySlot index={index} next={index === entries.length} />
							) : (
								<SlotCard
									entry={entry}
									index={index}
									onChange={(choice) =>
										entry.isDefault
											? void saveDefault(choice)
											: void favorites
													.replace(entry.id, choice)
													.then((result) => report("Couldn't change the loadout", result))
									}
									onRemove={() => void remove(entry)}
									onDragOut={() => void remove(entry)}
								/>
							)}
						</li>
					);
				})}
			</ul>
			<div className="mt-10 grid grid-cols-5 border-t border-l border-border">
				{COLUMNS.map((spec) => (
					<AgentColumn
						key={`${spec.agent}:${spec.acpAgent ?? ""}`}
						spec={spec}
						isEquipped={(choice) => entries.some((entry) => sameModel(entry.config, choice))}
						onAdd={addNext}
					/>
				))}
			</div>
		</div>
	);
}

function EmptySlot({ index, next }: { index: number; next: boolean }) {
	return (
		<div className="absolute inset-0 font-mono text-3xs tracking-wider text-fg-muted">
			<span className="absolute inset-x-0 top-0 bottom-12 flex items-center justify-center">
				{next ? "DROP MODEL HERE" : "EMPTY"}
			</span>
			<span className="absolute inset-x-0 bottom-12 border-t border-border" />
			<span className="absolute right-3 bottom-4 text-fg-subtle">{index + 1}</span>
		</div>
	);
}

function SlotCard({
	entry,
	index,
	onChange,
	onRemove,
	onDragOut,
}: {
	entry: LoadoutEntry;
	index: number;
	onChange: (choice: Choice) => void;
	onRemove: () => void;
	onDragOut: () => void;
}) {
	const models = useModels(entry.config.agent, entry.config.acpAgent);
	const list = models.state === "ready" ? models.data : [];
	const model = list.find((item) => item.id === entry.config.model);
	const label = model?.label ?? entry.config.model;
	const effort = effortLabel(model, entry.config);
	const [dropped, setDropped] = useState(false);
	const change = (patch: Partial<Choice>) => onChange({ ...entry.config, ...patch });

	return (
		<Menu>
			<MenuTrigger asChild>
				<button
					type="button"
					aria-label={`${agentDisplayName(entry.config)} ${label}, ${effort}`}
					draggable={!entry.isDefault}
					onDragStart={(event) => {
						setDropped(false);
						event.dataTransfer.setData(SLOT_MIME, String(index));
						event.dataTransfer.effectAllowed = "move";
					}}
					onDrop={() => setDropped(true)}
					onDragEnd={(event) => {
						// Released outside every slot: Conductor takes the model out of the loadout.
						if (!dropped && event.dataTransfer.dropEffect === "none") onDragOut();
					}}
					className="group absolute inset-0 flex flex-col justify-end gap-1 bg-canvas px-3 pb-1.5 text-left font-mono text-xs outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-focus focus-visible:ring-inset"
				>
					{entry.isDefault ? (
						<span className="pointer-events-none absolute top-2.5 right-2.5 rounded-xs border border-accent px-1 font-mono text-[8px] leading-3 text-accent">
							DEFAULT
						</span>
					) : null}
					<span className="truncate font-sans text-2xs text-fg-muted">
						{agentDisplayName(entry.config)}
					</span>
					<span className="truncate font-medium text-fg">{label}</span>
					<span className="flex h-4 items-center truncate text-[11px] text-fg-muted">
						{effort}
						{entry.config.fastMode ? " · Fast" : ""}
					</span>
				</button>
			</MenuTrigger>
			<MenuContent align="start" className="w-56" aria-label={`Slot ${index + 1}`}>
				<MenuLabel>Model</MenuLabel>
				<MenuRadioGroup value={entry.config.model}>
					{list
						.filter((item) => item.status === "picker" || item.id === entry.config.model)
						.map((item) => (
							<MenuRadioItem
								key={item.id}
								value={item.id}
								onSelect={() =>
									change({
										model: item.id,
										effort: item.efforts.includes(entry.config.effort)
											? entry.config.effort
											: item.defaultEffort,
										fastMode: item.supportsFastMode && entry.config.fastMode,
									})
								}
							>
								{item.label}
							</MenuRadioItem>
						))}
				</MenuRadioGroup>
				{model === undefined ? null : (
					<>
						<MenuSeparator />
						<MenuLabel>{model.effortAxis === "thinking" ? "Thinking" : "Effort"}</MenuLabel>
						<MenuRadioGroup value={entry.config.effort}>
							{model.efforts.map((level) => (
								<MenuRadioItem key={level} value={level} onSelect={() => change({ effort: level })}>
									{model.effortLabels?.[level] ?? EFFORT_LABELS[level]}
								</MenuRadioItem>
							))}
						</MenuRadioGroup>
						<MenuSeparator />
						<MenuCheckboxItem
							checked={entry.config.fastMode}
							disabled={!model.supportsFastMode}
							onCheckedChange={(checked) => change({ fastMode: checked === true })}
						>
							Fast mode
						</MenuCheckboxItem>
						{model.supportsFastMode ? null : (
							<p className="px-2 pb-1.5 text-xs text-fg-muted">
								The chosen model does not support fast mode.
							</p>
						)}
					</>
				)}
				{entry.isDefault ? null : (
					<>
						<MenuSeparator />
						<MenuItem onSelect={onRemove}>Remove</MenuItem>
					</>
				)}
			</MenuContent>
		</Menu>
	);
}

function AgentColumn({
	spec,
	isEquipped,
	onAdd,
}: {
	spec: AgentColumnSpec;
	isEquipped: (choice: Choice) => boolean;
	onAdd: (choice: Choice) => void;
}) {
	const navigate = useNavigate();
	const installs = useAgentInstalls();
	const models = useModels(spec.agent, spec.acpAgent);
	const name = agentDisplayName(spec);
	const install =
		installs.state === "ready"
			? installs.data.find(
					(entry) =>
						entry.agent === spec.agent &&
						(spec.agent !== "acp" || entry.acpAgent === spec.acpAgent),
				)
			: undefined;
	const available = install?.installed === true && install.authenticated !== false;

	return (
		<section aria-label={name} className="min-w-0 border-r border-b border-border">
			<span className="flex h-10 items-center gap-1.5 border-b border-border bg-muted px-3 text-xs text-fg-muted">
				{name}
			</span>
			<div className="flex flex-col">
				{installs.state === "loading" || (available && models.state === "loading") ? (
					<p role="status" className="flex h-10 items-center px-3 text-xs text-fg-muted">
						Loading models...
					</p>
				) : !available ? (
					<button
						type="button"
						onClick={() => void navigate({ to: "/settings/$page", params: { page: "agents" } })}
						className="h-10 w-full border-b border-border text-xs text-fg-muted outline-none hover:bg-muted hover:text-fg focus-visible:ring-1 focus-visible:ring-focus focus-visible:ring-inset"
					>
						Configure {name}
					</button>
				) : models.state === "error" ? (
					<p role="alert" className="p-3 text-xs text-danger">
						Could not load models.
					</p>
				) : models.state !== "ready" ? null : (
					models.data
						.filter((model) => model.status === "picker")
						.map((model) => {
							const choice = choiceFor(spec, model);
							return (
								<button
									key={model.id}
									type="button"
									draggable
									aria-label={`Add ${model.label} to loadout`}
									title={model.label}
									onDragStart={(event) => {
										event.dataTransfer.setData(MODEL_MIME, JSON.stringify(choice));
										event.dataTransfer.effectAllowed = "copy";
									}}
									onClick={(event) => {
										// A mouse drags a model into a slot; Enter or Space adds it, as in Conductor.
										if (event.detail === 0) onAdd(choice);
									}}
									className="relative flex h-10 w-full cursor-grab items-center gap-1.5 border-b border-border bg-canvas pr-9 pl-3 text-left text-xs text-fg outline-none hover:bg-muted active:cursor-grabbing focus-visible:ring-1 focus-visible:ring-focus focus-visible:ring-inset"
								>
									<span className="min-w-0 truncate">{model.label}</span>
									{isEquipped(choice) ? (
										<>
											<CheckIcon className="size-3 shrink-0 text-fg-muted" />
											<span className="sr-only">In the loadout</span>
										</>
									) : null}
									<GripVerticalIcon className="pointer-events-none absolute right-3 size-3.5 text-fg-muted" />
								</button>
							);
						})
				)}
			</div>
		</section>
	);
}
