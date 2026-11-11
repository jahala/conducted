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
 * reorders, and dropping it anywhere outside the slots removes it; a drag cancelled with Escape
 * keeps it.
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
 * Our design choice: a drag is a pointer drag, as Conductor's Loadout is (renderApp, its slot and
 * model rows use motion's pointer drag). The app window's drag-drop handler answers every native
 * drag for file drops, so the page never gets a drag's drop (issue #481).
 * Test first: Enter on a model row puts it in the next empty slot.
 */
import type { ModelInfo } from "@conducted/protocol";
import type { Result } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { AGENT_CHOICES, agentDisplayName } from "../../../core/agent-catalog.ts";
import { useServices } from "../../../core/context.tsx";
import { type FavoriteModel, LOADOUT_SIZE } from "../../../core/favorite-model.ts";
import { useActions, useAgentInstalls, useModels } from "../../../core/hooks.ts";
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

type AgentColumnSpec = (typeof AGENT_CHOICES)[number];

/** What a drag carries: a model from an agent's column, or a filled slot being moved. */
type DragPayload =
	| { kind: "model"; choice: Choice }
	| { kind: "slot"; from: number; entry: LoadoutEntry };

/** A pointer drag in flight: the payload, the distance moved, and the slot under the pointer. */
interface DragState {
	payload: DragPayload;
	dx: number;
	dy: number;
	target: number | undefined;
}

/** Conductor's hit-test margin around a slot's rectangle, in pixels (renderApp's loadout editor). */
const SLOT_MARGIN = 16;
/** How far the pointer moves before a press becomes a drag; a shorter press stays a click. */
const DRAG_THRESHOLD = 4;

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
	const [drag, setDrag] = useState<DragState | null>(null);
	const slotNodes = useRef<(HTMLLIElement | null)[]>([]);
	const stopListening = useRef<(() => void) | null>(null);
	// Conductor suppresses the click that ends a drag on a slot (its `onClickCapture`), so a drag
	// never opens the slot's choices; the next press starts the question again.
	const clickAfterDrag = useRef(false);
	useEffect(() => () => stopListening.current?.(), []);
	const offset = entries[0]?.isDefault === true ? 1 : 0;

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
		const [moved] = ids.splice(from - offset, 1);
		if (moved === undefined) return;
		ids.splice(Math.max(0, to - offset), 0, moved);
		report("Couldn't reorder the loadout", await favorites.reorder(ids));
	};

	/**
	 * The slot under the pointer, as Conductor finds it: each slot's rectangle, widened by
	 * `SLOT_MARGIN`, and the nearest centre on the horizontal axis winning. Outside every slot
	 * gives undefined, which a dragged slot reads as "remove".
	 */
	const targetAt = (x: number, y: number): number | undefined => {
		let found: number | undefined;
		let nearest = Number.POSITIVE_INFINITY;
		slotNodes.current.forEach((node, index) => {
			if (node === null) return;
			const rect = node.getBoundingClientRect();
			if (
				x < rect.left - SLOT_MARGIN ||
				x > rect.right + SLOT_MARGIN ||
				y < rect.top - SLOT_MARGIN ||
				y > rect.bottom + SLOT_MARGIN
			)
				return;
			const distance = Math.abs(x - (rect.left + rect.width / 2));
			if (distance < nearest) {
				nearest = distance;
				found = index;
			}
		});
		return found;
	};

	/** The slot a drag rings: a model reaches the next empty slot, a slot moves among filled ones. */
	const shownTarget = (payload: DragPayload, raw: number | undefined): number | undefined => {
		if (raw === undefined) return undefined;
		if (payload.kind === "model") return raw <= entries.length ? raw : undefined;
		return Math.min(Math.max(raw, offset), Math.max(offset, entries.length - 1));
	};

	const drop = (payload: DragPayload, raw: number | undefined) => {
		if (payload.kind === "model") {
			if (raw === undefined || raw > entries.length) return;
			if (raw === 0 && payload.choice.agent !== "claude") return;
			void equip(payload.choice, raw);
			return;
		}
		if (raw === undefined) {
			void remove(payload.entry);
			return;
		}
		const to = Math.min(Math.max(raw, offset), Math.max(offset, entries.length - 1));
		if (to !== payload.from) void move(payload.from, to);
	};

	const startDrag = (event: ReactPointerEvent, payload: DragPayload) => {
		if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
		stopListening.current?.();
		const startX = event.clientX;
		const startY = event.clientY;
		const pointerId = event.pointerId;
		let active = false;
		const clean = () => {
			document.removeEventListener("pointermove", moved);
			document.removeEventListener("pointerup", ended);
			document.removeEventListener("pointercancel", ended);
			document.removeEventListener("keydown", keyed);
			if (stopListening.current === clean) stopListening.current = null;
		};
		const moved = (moveEvent: PointerEvent) => {
			if (moveEvent.pointerId !== pointerId) return;
			const dx = moveEvent.clientX - startX;
			const dy = moveEvent.clientY - startY;
			if (!active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
			active = true;
			clickAfterDrag.current = true;
			setDrag({
				payload,
				dx,
				dy,
				target: shownTarget(payload, targetAt(moveEvent.clientX, moveEvent.clientY)),
			});
		};
		const ended = (endEvent: PointerEvent) => {
			if (endEvent.pointerId !== pointerId) return;
			clean();
			setDrag(null);
			// A cancelled pointer changes nothing, as a drag cancelled with Escape does.
			if (endEvent.type === "pointercancel" || !active) return;
			drop(payload, targetAt(endEvent.clientX, endEvent.clientY));
		};
		const keyed = (keyEvent: KeyboardEvent) => {
			if (keyEvent.key !== "Escape") return;
			clean();
			setDrag(null);
		};
		document.addEventListener("pointermove", moved);
		document.addEventListener("pointerup", ended);
		document.addEventListener("pointercancel", ended);
		document.addEventListener("keydown", keyed);
		stopListening.current = clean;
	};

	return (
		<div className="flex w-full max-w-2xl select-none flex-col">
			{/* A slot dragged anywhere outside the slots is taken out of the loadout, as in Conductor. */}
			<ul
				aria-label="Loadout"
				className="relative m-0 grid list-none grid-cols-5 border-t border-l border-border p-0"
			>
				{Array.from({ length: LOADOUT_SIZE }, (_, index) => {
					const entry = entries[index];
					const highlighted = drag?.target === index;
					return (
						<li
							// biome-ignore lint/suspicious/noArrayIndexKey: a slot is its position.
							key={index}
							ref={(node) => {
								slotNodes.current[index] = node;
							}}
							aria-label={`Slot ${index + 1}`}
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
									dragging={
										drag?.payload.kind === "slot" && drag.payload.from === index ? drag : null
									}
									clickAfterDrag={clickAfterDrag}
									onDragStart={(event) => startDrag(event, { kind: "slot", from: index, entry })}
									onChange={(choice) =>
										entry.isDefault
											? void saveDefault(choice)
											: void favorites
													.replace(entry.id, choice)
													.then((result) => report("Couldn't change the loadout", result))
									}
									onRemove={() => void remove(entry)}
								/>
							)}
						</li>
					);
				})}
			</ul>
			<div className="mt-10 grid grid-cols-5 border-t border-l border-border">
				{AGENT_CHOICES.map((spec) => (
					<AgentColumn
						key={`${spec.agent}:${spec.acpAgent ?? ""}`}
						spec={spec}
						isEquipped={(choice) => entries.some((entry) => sameModel(entry.config, choice))}
						onAdd={addNext}
						drag={drag?.payload.kind === "model" ? drag : null}
						onDragStart={startDrag}
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
	dragging,
	clickAfterDrag,
	onDragStart,
	onChange,
	onRemove,
}: {
	entry: LoadoutEntry;
	index: number;
	/** The offset to draw the card at while it is dragged, or null. */
	dragging: { dx: number; dy: number } | null;
	clickAfterDrag: { current: boolean };
	onDragStart: (event: ReactPointerEvent) => void;
	onChange: (choice: Choice) => void;
	onRemove: () => void;
}) {
	const models = useModels(entry.config.agent, entry.config.acpAgent);
	const list = models.state === "ready" ? models.data : [];
	const model = list.find((item) => item.id === entry.config.model);
	const label = model?.label ?? entry.config.model;
	const effort = effortLabel(model, entry.config);
	const [menuOpen, setMenuOpen] = useState(false);

	return (
		<Menu open={menuOpen} onOpenChange={setMenuOpen}>
			{/*
			 * Conductor opens a slot's choices when the press is released, so a press that starts a
			 * drag never opens them (Hrr's openOnPressRelease). The menu opens its trigger on press, so
			 * the press stops here, before the menu sees it, and starts the drag instead. A click that
			 * ends no drag opens the choices; a click that ends a drag is suppressed, as Hrr's
			 * onClickCapture suppresses it; the keyboard still opens them through the menu.
			 */}
			<span
				className="contents"
				onPointerDownCapture={(event) => {
					if (event.button !== 0 || event.ctrlKey) return;
					event.stopPropagation();
					clickAfterDrag.current = false;
					if (!entry.isDefault) onDragStart(event);
				}}
			>
				<MenuTrigger asChild>
					<button
						type="button"
						aria-label={`${agentDisplayName(entry.config)} ${label}, ${effort}`}
						onClick={(event) => {
							if (clickAfterDrag.current && event.detail !== 0) {
								event.preventDefault();
								event.stopPropagation();
								return;
							}
							if (event.detail !== 0) setMenuOpen((open) => !open);
						}}
						style={
							dragging === null
								? undefined
								: { transform: `translate(${dragging.dx}px, ${dragging.dy}px)` }
						}
						className={cn(
							"group absolute inset-0 flex touch-none flex-col justify-end gap-1 bg-canvas px-3 pb-1.5 text-left font-mono text-xs outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-focus focus-visible:ring-inset",
							dragging !== null && "z-20 shadow-lg ring-1 ring-border",
						)}
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
			</span>
			<MenuContent align="start" className="w-56" aria-label={`Slot ${index + 1}`}>
				<ModelChoiceItems models={list} choice={entry.config} onChange={onChange} />
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

/**
 * The effort or thinking level of one model, and its fast mode where it has one. Shared by a
 * loadout slot and the Review model picker, which lists several agents' models above it.
 */
export function ModelEffortItems({
	model,
	choice,
	onChange,
}: {
	model: ModelInfo;
	choice: Choice;
	onChange: (choice: Choice) => void;
}) {
	const change = (patch: Partial<Choice>) => onChange({ ...choice, ...patch });
	return (
		<>
			<MenuSeparator />
			<MenuLabel>{model.effortAxis === "thinking" ? "Thinking" : "Effort"}</MenuLabel>
			<MenuRadioGroup value={choice.effort}>
				{model.efforts.map((level) => (
					<MenuRadioItem key={level} value={level} onSelect={() => change({ effort: level })}>
						{model.effortLabels?.[level] ?? EFFORT_LABELS[level]}
					</MenuRadioItem>
				))}
			</MenuRadioGroup>
			<MenuSeparator />
			<MenuCheckboxItem
				checked={choice.fastMode}
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
	);
}

/**
 * The choices of one model setting, shared by a loadout slot: the model among `models`, its
 * effort or thinking level, and fast mode where the model has it.
 */
export function ModelChoiceItems({
	models,
	choice,
	onChange,
}: {
	models: readonly ModelInfo[];
	choice: Choice;
	onChange: (choice: Choice) => void;
}) {
	const model = models.find((item) => item.id === choice.model);
	const change = (patch: Partial<Choice>) => onChange({ ...choice, ...patch });
	return (
		<>
			<MenuLabel>Model</MenuLabel>
			<MenuRadioGroup value={choice.model}>
				{models
					.filter((item) => item.status === "picker" || item.id === choice.model)
					.map((item) => (
						<MenuRadioItem
							key={item.id}
							value={item.id}
							onSelect={() =>
								change({
									model: item.id,
									effort: item.efforts.includes(choice.effort) ? choice.effort : item.defaultEffort,
									fastMode: item.supportsFastMode && choice.fastMode,
								})
							}
						>
							{item.label}
						</MenuRadioItem>
					))}
			</MenuRadioGroup>
			{model === undefined ? null : (
				<ModelEffortItems model={model} choice={choice} onChange={onChange} />
			)}
		</>
	);
}

function AgentColumn({
	spec,
	isEquipped,
	onAdd,
	drag,
	onDragStart,
}: {
	spec: AgentColumnSpec;
	isEquipped: (choice: Choice) => boolean;
	onAdd: (choice: Choice) => void;
	/** The model drag in flight, so the row it started from can follow the pointer. */
	drag: DragState | null;
	onDragStart: (event: ReactPointerEvent, payload: DragPayload) => void;
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
						onClick={() =>
							void navigate({ to: "/settings/user/$page", params: { page: "agents" } })
						}
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
							const dragging =
								drag?.payload.kind === "model" && sameModel(drag.payload.choice, choice)
									? drag
									: null;
							return (
								<button
									key={model.id}
									type="button"
									aria-label={`Add ${model.label} to loadout`}
									title={model.label}
									onPointerDown={(event) => onDragStart(event, { kind: "model", choice })}
									onClick={(event) => {
										// A mouse drags a model into a slot; Enter or Space adds it, as in Conductor.
										if (event.detail === 0) onAdd(choice);
									}}
									style={
										dragging === null
											? undefined
											: { transform: `translate(${dragging.dx}px, ${dragging.dy}px)` }
									}
									className={cn(
										"relative flex h-10 w-full touch-none cursor-grab items-center gap-1.5 border-b border-border bg-canvas pr-9 pl-3 text-left text-xs text-fg outline-none hover:bg-muted active:cursor-grabbing focus-visible:ring-1 focus-visible:ring-focus focus-visible:ring-inset",
										dragging !== null && "z-20 shadow-lg ring-1 ring-border",
									)}
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
