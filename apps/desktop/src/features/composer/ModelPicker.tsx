/**
 * @feature COMP-02 Model picker
 * Owns: The button and menu that choose agent, model, effort and fast mode, with favourites: bound to a
 * chat (ModelPicker), and the same menu for the new-workspace dialog's first chat (ModelMenu).
 * Behaviour: ui-map.md 3.5 (Model picker, Cmd+/: favourites up to 5 selectable with Cmd+Ctrl+1..5,
 * submenus Agent, Model, Effort, toggle Fast (Cmd+Shift+E), search 'Search models', 'No models
 * found'; switching agent or model in a started chat shows 'Opens in new chat'; Cmd+Shift+/ cycles
 * effort), claude-runner.md 7.
 * Measured from Conductor 0.92.1 (renderApp @9236012-9246900, the composer's model menu, and the owner's
 * capture): the trigger reads "<model> <effort>" with the effort muted and a chevron. The menu opens
 * upward, 352px wide, on a muted frame with 4px padding. Inside it a raised card holds "Search models"
 * over a rule, the favourites as 32px rows, a rule, then the flyout rows (label, muted value, chevron,
 * opening a 256px submenu 6px to the right) and "Fast" with its shortcut and a 40 by 20px switch. Under
 * the card, the footer reads "Edit" with a gear on the left and the cycle-effort key and "Cycle effort"
 * on the right. Search lists matching models with their agent as the muted value. Fast stays in the
 * menu, disabled, when the model lacks it.
 * Our design choice: "Agent" and "Model" are flyout rows under the rule, as in Conductor's other model
 * menus (the composer's own menu leaves them out and reaches other models through favourites and
 * search). Search also lists matching agents.
 * Our design choice: A started chat keeps its agent: picking another agent opens a new chat. A
 * model change in a started chat is applied live when the agent allows it (the sidecar decides) and
 * warns that the next reply may be slower and cost more.
 * Keyboard: Cmd+/ (open), Cmd+Shift+E (fast mode), Cmd+Shift+/ (cycle effort) and the five loadout
 * keys are command handlers (NAV-14), so a shortcut the user rebinds moves with it. The picker stays
 * mounted while its popover is closed, so the handlers are always registered.
 * Must handle: Models not loaded (loading row); the agent is not installed or not signed in (item
 * disabled); a model that lacks the current effort (switch to its default and say so); fast mode not
 * available for the model or the account (toggle hidden); no models match the search; ACP agents
 * (OpenCode, Pi) listed under Agent.
 * Test first: Choosing a model that supports only 'high' effort while 'max' is set updates the
 * config to 'high' and says the effort changed.
 */

import type { Effort, ModelInfo, SessionConfig } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { createLatestWins } from "../../core/async/latest-wins.ts";
import { useServices } from "../../core/context.tsx";
import { useActions, useLiveShortcut, useModels, useSetting } from "../../core/hooks.ts";
import { agentDisplayName, agentKey } from "../../core/services/agent-catalog.ts";
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import {
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	GearIcon,
	SearchIcon,
} from "../../ui/icons.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";
import { FavoriteModels, isFavoriteSelected } from "./FavoriteModels.tsx";

export interface ModelPickerProps {
	sessionId: SessionId;
}

type Choice = Pick<SessionConfig, "agent" | "acpAgent">;
type ConfigChange = Pick<SessionConfig, "agent" | "acpAgent" | "model" | "effort" | "fastMode">;

const AGENT_CHOICES: readonly Choice[] = [
	{ agent: "claude" },
	{ agent: "codex" },
	{ agent: "cursor" },
	{ agent: "acp", acpAgent: "opencode" },
	{ agent: "acp", acpAgent: "pi" },
];

const EFFORT_LABELS: Record<Effort, string> = {
	none: "None",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra high",
	max: "Max",
	ultra: "Ultra",
	ultracode: "Ultracode",
};

const sameChoice = (left: Choice, right: Choice): boolean =>
	left.agent === right.agent && left.acpAgent === right.acpAgent;

/** The effort a model accepts, falling back to the model's own default. */
export function effortForModel(
	model: Pick<ModelInfo, "efforts" | "defaultEffort">,
	effort: Effort,
) {
	return model.efforts.includes(effort) ? effort : model.defaultEffort;
}

/**
 * Keep status hidden and deprecated out, then apply the visible-provider-models setting. The
 * setting is a list of model ids or labels separated by commas or whitespace; an empty list shows
 * every model.
 */
export function modelsForPicker(
	models: readonly ModelInfo[],
	visible: string | undefined,
): ModelInfo[] {
	const allowed = (visible ?? "")
		.split(/[,\s]+/)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
	return models.filter(
		(model) =>
			(model.status === "picker" || model.status === "gated") &&
			(allowed.length === 0 || allowed.includes(model.id) || allowed.includes(model.label)),
	);
}

/** The chat's picker: the menu bound to one session, with the chat's rules for a change. */
export function ModelPicker({ sessionId }: ModelPickerProps) {
	const actions = useActions();
	const { services } = useServices();
	const session = useStore(services.sessions.store, (state) => state.sessions[sessionId]);

	const applyConfig = useCallback(
		async (change: ConfigChange) => {
			if (session === undefined) return;
			const current = session.config;
			const nextConfig: SessionConfig = {
				...current,
				...change,
				acpAgent: change.agent === "acp" ? change.acpAgent : undefined,
			};
			const agentChanged = !sameChoice(current, change);
			const started = session.lastUserMessageAt !== null;
			if (agentChanged && started) {
				const created = await actions.sessions.create(session.workspaceId, nextConfig);
				if (!created.ok) {
					toastError("Couldn't start a new chat", created.error);
					return;
				}
				toast("Opens in new chat", {
					description: "A chat keeps the agent it started with.",
				});
				return;
			}
			if (
				!agentChanged &&
				started &&
				(change.model !== current.model || change.effort !== current.effort)
			) {
				toast("The next reply may be slower and cost more.", {
					description: "You changed the model or effort in a chat that already started.",
				});
			}
			const updated = await actions.sessions.updateConfig(sessionId, nextConfig);
			if (!updated.ok) toastError("Couldn't change the model", updated.error);
		},
		[actions, session, sessionId],
	);

	return (
		<ModelMenu
			config={session?.config}
			started={session !== undefined && session.lastUserMessageAt !== null}
			onApply={applyConfig}
			scope={sessionId}
			commands
		/>
	);
}

export type ModelChoice = ConfigChange;

export interface ModelMenuProps {
	/** The choice the menu shows; undefined while the chat loads. */
	config: ConfigChange | undefined;
	/** True when the chat has sent a message, so another agent opens a new chat. */
	started: boolean;
	onApply: (change: ConfigChange) => void | Promise<void>;
	/** Keys the newest-agent-choice rule, one per chat or dialog. */
	scope: string;
	/** Registers the chat shortcuts (Cmd+/, fast mode, cycle effort, loadouts). One menu per screen does. */
	commands?: boolean;
	disabled?: boolean;
}

/**
 * The model menu and its trigger, for any owner of a choice: the chat's picker and the new-workspace
 * dialog both use it, as Conductor uses one menu in both places.
 */
export function ModelMenu({
	config,
	started,
	onApply: applyConfig,
	scope,
	commands = false,
	disabled = false,
}: ModelMenuProps) {
	const { services } = useServices();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const installs = useStore(services.agentCatalog.store, (state) => state.installs);
	const favorites = useStore(services.favoriteModels.store, (state) => state.favorites);
	const visible = useSetting<string>("visible_provider_models");
	const models = useModels(config?.agent ?? "claude", config?.acpAgent);
	const fastShortcut = useLiveShortcut("chat.toggleFastMode");
	const [search, setSearch] = useState("");
	const agentChoices = useRef(createLatestWins());

	const allModels = models.state === "ready" ? models.data : [];
	const currentModel =
		config === undefined ? undefined : allModels.find((model) => model.id === config.model);
	const pickerModels = useMemo(() => modelsForPicker(allModels, visible), [allModels, visible]);
	const filteredModels = useMemo(() => {
		const query = search.trim().toLowerCase();
		if (query.length === 0) return pickerModels;
		return pickerModels.filter(
			(model) =>
				model.label.toLowerCase().includes(query) || model.id.toLowerCase().includes(query),
		);
	}, [pickerModels, search]);

	const changeOf = useCallback(
		(patch: Partial<ConfigChange>): ConfigChange | undefined => {
			if (config === undefined) return undefined;
			return {
				agent: config.agent,
				acpAgent: config.acpAgent,
				model: config.model,
				effort: config.effort,
				fastMode: config.fastMode,
				...patch,
			};
		},
		[config],
	);

	const chooseModel = useCallback(
		(model: ModelInfo) => {
			if (config === undefined) return;
			const effort = effortForModel(model, config.effort);
			if (effort !== config.effort) {
				toast(`Effort changed to ${EFFORT_LABELS[effort]}`, {
					description: `${model.label} does not support the previous effort.`,
				});
			}
			const change = changeOf({
				model: model.id,
				effort,
				fastMode: model.supportsFastMode ? config.fastMode : false,
			});
			if (change !== undefined) void applyConfig(change);
		},
		[applyConfig, changeOf, config],
	);

	const chooseAgent = useCallback(
		async (choice: Choice) => {
			if (config === undefined || sameChoice(config, choice)) return;
			const key = agentKey(choice.agent, choice.acpAgent);
			const ticket = agentChoices.current.begin(scope);
			let entry = services.agentCatalog.store.getState().models[key];
			if (entry === undefined) {
				const loaded = await services.agentCatalog.loadModels(choice.agent, choice.acpAgent);
				// A newer agent choice began while the models loaded: this answer is stale.
				if (!agentChoices.current.isLatest(ticket)) return;
				if (loaded.ok) entry = { state: "ready", data: loaded.value };
			}
			agentChoices.current.settle(ticket);
			const list = entry?.state === "ready" ? modelsForPicker(entry.data, visible) : [];
			const chosen = list.find((model) => model.isDefault) ?? list[0];
			if (chosen === undefined) {
				toast("No models found", {
					description: `Install or sign in to ${agentDisplayName(choice)} in Settings.`,
				});
				return;
			}
			await applyConfig({
				agent: choice.agent,
				acpAgent: choice.acpAgent,
				model: chosen.id,
				effort: effortForModel(chosen, config.effort),
				fastMode: chosen.supportsFastMode ? config.fastMode : false,
			});
		},
		[applyConfig, config, services, scope, visible],
	);

	const chooseEffort = useCallback(
		(effort: Effort) => {
			const change = changeOf({ effort });
			if (change !== undefined) void applyConfig(change);
		},
		[applyConfig, changeOf],
	);

	const toggleFast = useCallback(() => {
		if (config === undefined || currentModel?.supportsFastMode !== true) return;
		const change = changeOf({ fastMode: !config.fastMode });
		if (change !== undefined) void applyConfig(change);
	}, [applyConfig, changeOf, config, currentModel]);

	const cycleEffort = useCallback(() => {
		if (config === undefined || currentModel === undefined) return;
		const levels = currentModel.efforts;
		const next = levels[(levels.indexOf(config.effort) + 1) % levels.length];
		if (next === undefined) return;
		chooseEffort(next);
	}, [chooseEffort, config, currentModel]);

	const isFavoriteAvailable = useCallback(
		(choice: Choice & { model: string }): boolean => {
			if (config !== undefined && sameChoice(choice, config)) {
				return allModels.some((model) => model.id === choice.model);
			}
			const entry =
				services.agentCatalog.store.getState().models[agentKey(choice.agent, choice.acpAgent)];
			if (entry === undefined || entry.state !== "ready") return true;
			return entry.data.some((model) => model.id === choice.model);
		},
		[allModels, config, services],
	);

	const pickFavorite = useCallback(
		(favorite: (typeof favorites)[number]) => {
			if (!isFavoriteAvailable(favorite.config)) {
				toast("That model is no longer available", {
					description: "Choose another model for this agent.",
				});
				return;
			}
			void applyConfig(favorite.config);
		},
		[applyConfig, isFavoriteAvailable],
	);

	/** Applies the favourite at `index`. False when there is none, so the key passes on. */
	const selectLoadout = (index: number): boolean => {
		if (!commands) return false;
		const favorite = favorites[index];
		if (favorite === undefined) return false;
		pickFavorite(favorite);
		return true;
	};

	useCommandHandler("chat.openModelPicker", "area", () => {
		if (!commands || triggerRef.current === null) return false;
		triggerRef.current.click();
		return true;
	});
	useCommandHandler("chat.toggleFastMode", "area", () => {
		if (!commands || config === undefined) return false;
		toggleFast();
		return true;
	});
	useCommandHandler("chat.cycleEffort", "area", () => {
		if (!commands || config === undefined) return false;
		cycleEffort();
		return true;
	});
	useCommandHandler("chat.selectLoadout1", "area", () => selectLoadout(0));
	useCommandHandler("chat.selectLoadout2", "area", () => selectLoadout(1));
	useCommandHandler("chat.selectLoadout3", "area", () => selectLoadout(2));
	useCommandHandler("chat.selectLoadout4", "area", () => selectLoadout(3));
	useCommandHandler("chat.selectLoadout5", "area", () => selectLoadout(4));

	const modelName =
		config === undefined
			? "Model"
			: (currentModel?.label ?? (config.model || "Choose a model"));
	const effortName =
		config === undefined ||
		currentModel === undefined ||
		!currentModel.efforts.includes(config.effort)
			? null
			: (currentModel.effortLabels?.[config.effort] ?? EFFORT_LABELS[config.effort]);
	const cycleShortcut = useLiveShortcut("chat.cycleEffort");
	const [flyout, setFlyout] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);
	const searching = search.trim().length > 0;
	const labelFor = (choice: Choice & { model: string }): string => {
		const entry =
			config !== undefined && sameChoice(config, choice)
				? models
				: services.agentCatalog.store.getState().models[agentKey(choice.agent, choice.acpAgent)];
		const model =
			entry?.state === "ready" ? entry.data.find((item) => item.id === choice.model) : undefined;
		return model?.label ?? choice.model;
	};

	const isInstalled = (choice: Choice): boolean => {
		if (installs.state !== "ready") return true;
		const install = installs.data.find(
			(entry) =>
				entry.agent === choice.agent &&
				(choice.agent !== "acp" || entry.acpAgent === choice.acpAgent),
		);
		return install?.installed === true && install.authenticated !== false;
	};

	const flyoutRow =
		"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg outline-none hover:bg-hover focus-visible:bg-hover disabled:cursor-not-allowed disabled:opacity-50";

	const modelRow = (model: ModelInfo, value?: string) => {
		const selected = config?.model === model.id;
		return (
			<button
				key={model.id}
				type="button"
				aria-pressed={selected}
				onClick={() => {
					chooseModel(model);
					setFlyout(null);
				}}
				className={flyoutRow}
			>
				<span className="truncate">{model.label}</span>
				{model.isNew ? (
					<span className="text-2xs uppercase tracking-wider text-accent">New</span>
				) : null}
				{value === undefined ? null : (
					<span className="ml-auto min-w-0 truncate text-fg-muted">{value}</span>
				)}
				{selected ? <CheckIcon className="ml-auto size-3.5 shrink-0" /> : null}
			</button>
		);
	};

	const agentRow = (choice: Choice) => {
		const selected = config !== undefined && sameChoice(config, choice);
		return (
			<button
				key={`${choice.agent}:${choice.acpAgent ?? ""}`}
				type="button"
				disabled={!isInstalled(choice)}
				aria-pressed={selected}
				title={!selected && started ? "Opens in new chat" : undefined}
				onClick={() => {
					setFlyout(null);
					void chooseAgent(choice);
				}}
				className={flyoutRow}
			>
				<span className="flex-1 truncate">{agentDisplayName(choice)}</span>
				{selected ? <CheckIcon className="size-3.5 shrink-0" /> : null}
			</button>
		);
	};

	const flyoutMenu = (label: string, value: string | null, children: ReactNode) => (
		<Popover
			side="right"
			align="start"
			open={flyout === label}
			onOpenChange={(open) => setFlyout(open ? label : null)}
			className="grid max-h-80 w-64 gap-0.5 overflow-y-auto p-1! ring-1 ring-popover-ring"
			trigger={
				<button type="button" aria-label={label} className={flyoutRow}>
					<span className="shrink-0">{label}</span>
					<span className="ml-auto min-w-0 truncate text-fg-muted">{value}</span>
					<ChevronRightIcon className="size-3.5 shrink-0 text-fg-muted" />
				</button>
			}
		>
			{children}
		</Popover>
	);

	const query = search.trim().toLowerCase();
	const matchingAgents = AGENT_CHOICES.filter((choice) =>
		agentDisplayName(choice).toLowerCase().includes(query),
	);
	const agentName = agentDisplayName(config ?? { agent: "claude" });
	const currentIsFavorite =
		config !== undefined &&
		favorites.some((favorite) => isFavoriteSelected(favorite.config, config));
	const fastSupported = currentModel?.supportsFastMode === true;
	const effortSupported = effortName !== null;

	return (
		<Popover
			side="top"
			align="start"
			className="flex max-h-[min(28rem,calc(100vh-120px))] w-[22rem] flex-col overflow-hidden bg-muted! p-1!"
			onOpenChange={(open) => {
				if (!open) {
					setSearch("");
					setFlyout(null);
				}
			}}
			trigger={
				<Button
					ref={triggerRef}
					variant="ghost"
					size="sm"
					disabled={disabled}
					aria-label="Model picker"
					title={`${agentName}: change agent`}
					className="max-w-64 gap-1 px-2 font-normal"
				>
					<span className="truncate text-fg">{modelName}</span>
					{effortName === null ? null : (
						<span className="shrink-0 text-fg-muted">{effortName}</span>
					)}
					{config?.fastMode === true ? <span className="shrink-0 text-fg-muted">Fast</span> : null}
					<ChevronDownIcon className="ml-0.5 size-3 shrink-0 text-fg-muted" />
				</Button>
			}
		>
			<div className="flex min-h-0 flex-col rounded-md bg-raised p-1 ring-1 ring-popover-ring">
				<label className="mb-1 flex shrink-0 items-center gap-2 border-b border-border px-2 pt-0.5 pb-2">
					<SearchIcon className="size-3.5 shrink-0 text-fg-muted" />
					<input
						aria-label="Search models"
						placeholder="Search models"
						value={search}
						autoComplete="off"
						spellCheck={false}
						onChange={(event) => setSearch(event.target.value)}
						className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
					/>
				</label>
				<div className="grid min-h-0 content-start gap-1 overflow-y-auto">
					{searching ? (
						<section aria-label="Model" className="grid gap-1">
							{models.state === "loading" ? (
								<p className="px-2 py-1.5 text-center text-sm text-fg-muted">Loading models…</p>
							) : null}
							{models.state === "ready" &&
							filteredModels.length === 0 &&
							matchingAgents.length === 0 ? (
								<p className="px-2 py-1.5 text-center text-sm text-fg-muted">No models found</p>
							) : null}
							{filteredModels.map((model) => modelRow(model, agentName))}
							{matchingAgents.map(agentRow)}
						</section>
					) : (
						<>
							<FavoriteModels
								config={config}
								editing={editing}
								isAvailable={isFavoriteAvailable}
								labelFor={labelFor}
								effortLabelFor={(choice) => EFFORT_LABELS[choice.effort]}
								opensNewChat={(choice) =>
									started && config !== undefined && !sameChoice(config, choice)
								}
								onPick={(favorite) => void applyConfig(favorite)}
							/>
							{currentIsFavorite || config === undefined || currentModel === undefined ? null : (
								<div className="flex items-center gap-2 rounded-md bg-hover px-2 py-1.5 text-sm text-fg">
									<span className="min-w-0 truncate">{modelName}</span>
									{effortName === null ? null : (
										<span className="text-xs text-fg-muted">{effortName}</span>
									)}
									<CheckIcon className="ml-auto size-3.5 shrink-0" />
								</div>
							)}
							<div className="border-t border-border" />
							<section aria-label="Agent">
								{flyoutMenu("Agent", agentName, AGENT_CHOICES.map(agentRow))}
							</section>
							<section aria-label="Model">
								{flyoutMenu(
									"Model",
									modelName,
									<>
										{models.state === "loading" ? (
											<p className="px-2 py-1.5 text-sm text-fg-muted">Loading models…</p>
										) : null}
										{models.state === "error" ? (
											<p className="px-2 py-1.5 text-sm text-fg-muted">Couldn't load models.</p>
										) : null}
										{models.state === "ready" && pickerModels.length === 0 ? (
											<p className="px-2 py-1.5 text-sm text-fg-muted">No models found</p>
										) : null}
										{pickerModels.map((model) => modelRow(model))}
									</>,
								)}
							</section>
							<section aria-label="Effort">
								{flyoutMenu(
									currentModel?.effortAxis === "thinking" ? "Thinking" : "Effort",
									effortSupported ? effortName : "Not supported",
									currentModel === undefined ||
										(config !== undefined && !currentModel.efforts.includes(config.effort)) ? (
										<p className="px-2 py-1.5 text-sm text-fg-muted">
											Not supported for this model
										</p>
									) : (
										currentModel.efforts.map((effort) => {
											const selected = config?.effort === effort;
											return (
												<button
													key={effort}
													type="button"
													aria-pressed={selected}
													onClick={() => {
														chooseEffort(effort);
														setFlyout(null);
													}}
													className={flyoutRow}
												>
													<span className="flex-1 truncate">
														{currentModel.effortLabels?.[effort] ?? EFFORT_LABELS[effort]}
													</span>
													{selected ? <CheckIcon className="size-3.5 shrink-0" /> : null}
												</button>
											);
										})
									),
								)}
							</section>
							<section aria-label="Fast mode">
								<button
									type="button"
									aria-pressed={config?.fastMode === true}
									disabled={!fastSupported}
									title={fastSupported ? undefined : "Not supported for this model"}
									onClick={toggleFast}
									className={flyoutRow}
								>
									<span className="flex-1 truncate">Fast</span>
									{fastShortcut === null || !fastSupported ? null : (
										<span aria-hidden="true" className="text-xs tracking-widest text-fg-muted">
											{fastShortcut}
										</span>
									)}
									<span
										aria-hidden="true"
										className={cn(
											"flex h-5 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors",
											fastSupported && config?.fastMode === true
												? "bg-switch-on"
												: "bg-border-strong",
										)}
									>
										<span
											className={cn(
												"size-4 rounded-full bg-switch-thumb shadow-dialog transition-transform",
												fastSupported && config?.fastMode === true && "translate-x-5",
											)}
										/>
									</span>
								</button>
							</section>
						</>
					)}
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-1.5 px-2 pt-2 pb-1 text-xs text-fg-muted">
				<button
					type="button"
					aria-pressed={editing}
					onClick={() => setEditing(!editing)}
					className="flex items-center gap-1 rounded-sm px-1 py-0.5 outline-none hover:text-fg focus-visible:ring-1 focus-visible:ring-focus"
				>
					<GearIcon className="size-3" />
					{editing ? "Done" : "Edit"}
				</button>
				{cycleShortcut === null ? null : (
					<>
						<span className="ml-auto rounded-sm border border-border bg-raised px-1.5 py-px">
							{cycleShortcut}
						</span>
						<span>Cycle effort</span>
					</>
				)}
			</div>
		</Popover>
	);
}
