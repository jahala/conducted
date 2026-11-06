/**
 * @feature COMP-02 Model picker
 * Owns: The button and menu that choose agent, model, effort and fast mode for a chat, with
 * favourites.
 * Behaviour: ui-map.md 3.5 (Model picker, Cmd+/: favourites up to 5 selectable with Cmd+Ctrl+1..5,
 * submenus Agent, Model, Effort, toggle Fast (Cmd+Shift+E), search 'Search models', 'No models
 * found'; switching agent or model in a started chat shows 'Opens in new chat'; Cmd+Shift+/ cycles
 * effort), claude-runner.md 7.
 * Measured from Conductor 0.92.1 (the composer's model picker and the owner's capture): the trigger reads
 * "<model> <effort>" with the effort muted and a chevron; the popover opens upward from it, with
 * "Search models" on top, the favourite models as 40px rows, then "Effort" with its value and a submenu,
 * "Fast" with its shortcut and a switch, and a footer naming the cycle-effort shortcut.
 * Our design choice: the agent list stays under the models (Conductor reaches other agents through search
 * and favourites), and the effort submenu opens in place under its row.
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
import { useCallback, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { createLatestWins } from "../../core/async/latest-wins.ts";
import { useServices } from "../../core/context.tsx";
import { useActions, useLiveShortcut, useModels, useSetting } from "../../core/hooks.ts";
import { agentDisplayName, agentKey } from "../../core/services/agent-catalog.ts";
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, SearchIcon } from "../../ui/icons.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";
import { FavoriteModels } from "./FavoriteModels.tsx";

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

export function ModelPicker({ sessionId }: ModelPickerProps) {
	const actions = useActions();
	const { services } = useServices();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const session = useStore(services.sessions.store, (state) => state.sessions[sessionId]);
	const installs = useStore(services.agentCatalog.store, (state) => state.installs);
	const favorites = useStore(services.favoriteModels.store, (state) => state.favorites);
	const visible = useSetting<string>("visible_provider_models");
	const config = session?.config;
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
					description: `${model.shortLabel ?? model.label} does not support the previous effort.`,
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
			const ticket = agentChoices.current.begin(sessionId);
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
		[applyConfig, config, services, sessionId, visible],
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
		const favorite = favorites[index];
		if (favorite === undefined) return false;
		pickFavorite(favorite);
		return true;
	};

	useCommandHandler("chat.openModelPicker", "area", () => {
		if (triggerRef.current === null) return false;
		triggerRef.current.click();
		return true;
	});
	useCommandHandler("chat.toggleFastMode", "area", () => {
		if (config === undefined) return false;
		toggleFast();
		return true;
	});
	useCommandHandler("chat.cycleEffort", "area", () => {
		if (config === undefined) return false;
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
			: (currentModel?.shortLabel ?? currentModel?.label ?? (config.model || "Choose a model"));
	const effortName =
		config === undefined ||
		currentModel === undefined ||
		!currentModel.efforts.includes(config.effort)
			? null
			: (currentModel.effortLabels?.[config.effort] ?? EFFORT_LABELS[config.effort]);
	const cycleShortcut = useLiveShortcut("chat.cycleEffort");
	const [effortOpen, setEffortOpen] = useState(false);
	const searching = search.trim().length > 0;

	const isInstalled = (choice: Choice): boolean => {
		if (installs.state !== "ready") return true;
		const install = installs.data.find(
			(entry) =>
				entry.agent === choice.agent &&
				(choice.agent !== "acp" || entry.acpAgent === choice.acpAgent),
		);
		return install?.installed === true && install.authenticated !== false;
	};

	const modelRow = (model: ModelInfo) => {
		const selected = config?.model === model.id;
		return (
			<button
				key={model.id}
				type="button"
				aria-pressed={selected}
				onClick={() => chooseModel(model)}
				className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-fg outline-none hover:bg-hover focus-visible:bg-hover"
			>
				<span className="truncate">{model.shortLabel ?? model.label}</span>
				{model.isNew ? (
					<span className="text-2xs uppercase tracking-wider text-accent">New</span>
				) : null}
				<span className="flex-1" />
				{selected ? <CheckIcon className="size-3.5" /> : null}
			</button>
		);
	};

	return (
		<Popover
			side="top"
			align="start"
			className="w-[22rem] p-0!"
			trigger={
				<Button
					ref={triggerRef}
					variant="ghost"
					size="sm"
					aria-label="Model picker"
					title={`${agentDisplayName(config ?? { agent: "claude" })}: change agent`}
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
			<div className="flex max-h-[32rem] flex-col">
				<label className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
					<SearchIcon className="size-4 shrink-0 text-fg-muted" />
					<input
						aria-label="Search models"
						placeholder="Search models"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
					/>
				</label>
				<div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1">
					{searching ? null : (
						<FavoriteModels
							config={config}
							isAvailable={isFavoriteAvailable}
							onPick={(favorite) => void applyConfig(favorite)}
						/>
					)}
					<section aria-label="Model" className="space-y-0.5">
						{models.state === "loading" ? (
							<p className="px-2 py-1.5 text-sm text-fg-muted">Loading models…</p>
						) : null}
						{models.state === "error" ? (
							<p className="px-2 py-1.5 text-sm text-fg-muted">Couldn't load models.</p>
						) : null}
						{models.state === "ready" && filteredModels.length === 0 ? (
							<p className="px-2 py-1.5 text-sm text-fg-muted">No models found</p>
						) : null}
						{filteredModels.map(modelRow)}
					</section>
					<section aria-label="Agent" className="space-y-0.5 border-t border-border pt-1">
						{AGENT_CHOICES.filter(
							(choice) =>
								!searching ||
								agentDisplayName(choice).toLowerCase().includes(search.trim().toLowerCase()),
						).map((choice) => {
							const selected = config !== undefined && sameChoice(config, choice);
							const available = isInstalled(choice);
							return (
								<button
									key={`${choice.agent}:${choice.acpAgent ?? ""}`}
									type="button"
									disabled={!available}
									aria-pressed={selected}
									onClick={() => void chooseAgent(choice)}
									className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-fg outline-none hover:bg-hover focus-visible:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
								>
									<span className="flex-1 truncate">{agentDisplayName(choice)}</span>
									{selected ? <CheckIcon className="size-3.5" /> : null}
								</button>
							);
						})}
					</section>
				</div>
				<div className="shrink-0 border-t border-border p-1">
					<section aria-label="Effort">
						<button
							type="button"
							aria-expanded={effortOpen}
							onClick={() => setEffortOpen(!effortOpen)}
							className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-fg outline-none hover:bg-hover focus-visible:bg-hover"
						>
							<span className="flex-1">
								{currentModel?.effortAxis === "thinking" ? "Thinking" : "Effort"}
							</span>
							{effortName === null ? null : <span className="text-fg-muted">{effortName}</span>}
							<ChevronRightIcon className="size-3.5 text-fg-muted" />
						</button>
						{effortOpen ? (
							models.state === "ready" && currentModel === undefined ? (
								<p className="px-2 py-1 text-sm text-fg-muted">Not supported for this model</p>
							) : currentModel === undefined ? null : (
								<div className="pl-3">
									{config !== undefined && !currentModel.efforts.includes(config.effort) ? (
										<p className="px-2 py-1 text-xs text-fg-muted">Not supported for this model</p>
									) : null}
									{currentModel.efforts.map((effort) => {
										const selected = config?.effort === effort;
										return (
											<button
												key={effort}
												type="button"
												aria-pressed={selected}
												onClick={() => chooseEffort(effort)}
												className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-fg outline-none hover:bg-hover focus-visible:bg-hover"
											>
												<span className="flex-1 truncate">
													{currentModel.effortLabels?.[effort] ?? EFFORT_LABELS[effort]}
												</span>
												{selected ? <CheckIcon className="size-3.5" /> : null}
											</button>
										);
									})}
								</div>
							)
						) : null}
					</section>
					{currentModel?.supportsFastMode === true ? (
						<section aria-label="Fast mode">
							<button
								type="button"
								aria-pressed={config?.fastMode === true}
								onClick={toggleFast}
								className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-fg outline-none hover:bg-hover focus-visible:bg-hover"
							>
								<span className="flex-1 truncate">Fast</span>
								{fastShortcut === null ? null : (
									<span className="text-xs tracking-widest text-fg-muted">{fastShortcut}</span>
								)}
								<span
									aria-hidden="true"
									className={cn(
										"flex h-5 w-10 items-center rounded-full p-0.5 transition-colors",
										config?.fastMode === true ? "bg-switch-on" : "bg-border-strong",
									)}
								>
									<span
										className={cn(
											"size-4 rounded-full bg-switch-thumb shadow-dialog transition-transform",
											config?.fastMode === true && "translate-x-5",
										)}
									/>
								</span>
							</button>
						</section>
					) : null}
				</div>
				{cycleShortcut === null ? null : (
					<div className="flex h-9 shrink-0 items-center justify-end gap-2 border-t border-border px-3 text-xs text-fg-muted">
						<span className="rounded-sm border border-border px-1 font-mono text-3xs">
							{cycleShortcut}
						</span>
						<span>Cycle effort</span>
					</div>
				)}
			</div>
		</Popover>
	);
}
