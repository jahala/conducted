/**
 * @feature COMP-02 Model picker
 * Owns: The button and menu that choose agent, model, effort and fast mode for a chat, with
 * favourites.
 * Behaviour: ui-map.md 3.5 (Model picker, Cmd+/: favourites up to 5 selectable with Cmd+Ctrl+1..5,
 * submenus Agent, Model, Effort, toggle Fast (Cmd+Shift+E), search 'Search models', 'No models
 * found'; switching agent or model in a started chat shows 'Opens in new chat'; Cmd+Shift+/ cycles
 * effort), claude-runner.md 7.
 * Our design choice: A started chat keeps its agent: picking another agent opens a new chat. A
 * model change in a started chat is applied live when the agent allows it (the sidecar decides) and
 * warns that the next reply may be slower and cost more.
 * Keyboard: the picker's shortcuts are window listeners until the command runner (NAV-07) is
 * built, the same documented exception the composer takes for Cmd+L.
 * Must handle: Models not loaded (loading row); the agent is not installed or not signed in (item
 * disabled with a link to settings); a model that lacks the current effort (switch to its default
 * and say so); fast mode not available for the model or the account (toggle hidden); no models
 * match the search; ACP agents (OpenCode, Pi) listed under Agent.
 * Test first: Choosing a model that supports only 'high' effort while 'max' is set updates the
 * config to 'high'.
 */

import type { Effort, ModelInfo, SessionConfig } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import { useActions, useModels, useSetting } from "../../core/hooks.ts";
import type { FavoriteModel } from "../../core/services/favorite-models.ts";
import { Button } from "../../ui/Button.tsx";
import { Input } from "../../ui/Input.tsx";
import { CheckIcon, ChevronDownIcon } from "../../ui/icons.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";
import { agentDisplayName, FavoriteModels } from "./FavoriteModels.tsx";

export interface ModelPickerProps {
	sessionId: SessionId;
}

type Choice = Pick<SessionConfig, "agent" | "acpAgent">;
type ConfigChange = Pick<SessionConfig, "agent" | "acpAgent" | "model" | "effort" | "fastMode">;

const AGENT_CHOICES: readonly (Choice & { label: string })[] = [
	{ agent: "claude", label: "Claude Code" },
	{ agent: "codex", label: "Codex" },
	{ agent: "cursor", label: "Cursor" },
	{ agent: "acp", acpAgent: "opencode", label: "OpenCode" },
	{ agent: "acp", acpAgent: "pi", label: "Pi" },
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

/** Keep status hidden and deprecated out, then apply the visible-provider-models setting. */
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
	const [search, setSearch] = useState("");

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
			const change = changeOf({
				model: model.id,
				effort: effortForModel(model, config?.effort ?? "high"),
				fastMode: model.supportsFastMode ? (config?.fastMode ?? false) : false,
			});
			if (change !== undefined) void applyConfig(change);
		},
		[applyConfig, changeOf, config],
	);

	const chooseAgent = useCallback(
		async (choice: Choice) => {
			if (config === undefined || sameChoice(config, choice)) return;
			const key =
				choice.acpAgent === undefined ? choice.agent : `${choice.agent}:${choice.acpAgent}`;
			let entry = services.agentCatalog.store.getState().models[key];
			if (entry === undefined) {
				const loaded = await services.agentCatalog.loadModels(choice.agent, choice.acpAgent);
				if (loaded.ok) entry = { state: "ready", data: loaded.value };
			}
			const list = entry?.state === "ready" ? entry.data : [];
			const chosen =
				list.find((model) => model.isDefault && model.status === "picker") ??
				list.find((model) => model.status === "picker") ??
				list[0];
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
		[applyConfig, config, services],
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

	useEffect(() => {
		const handleShortcut = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
				if (event.key === "/") {
					event.preventDefault();
					triggerRef.current?.click();
					return;
				}
			}
			if (event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey) {
				if (event.key.toLowerCase() === "e") {
					event.preventDefault();
					toggleFast();
					return;
				}
				if (event.key === "/" || event.key === "?") {
					event.preventDefault();
					cycleEffort();
					return;
				}
			}
			if (event.metaKey && event.ctrlKey && !event.shiftKey && !event.altKey) {
				const index = Number(event.key) - 1;
				if (!Number.isInteger(index) || index < 0 || index >= 5) return;
				const favorite: FavoriteModel | undefined = favorites[index];
				if (favorite === undefined) return;
				event.preventDefault();
				void applyConfig(favorite.config);
			}
		};
		window.addEventListener("keydown", handleShortcut);
		return () => window.removeEventListener("keydown", handleShortcut);
	}, [applyConfig, cycleEffort, favorites, toggleFast]);

	const triggerLabel =
		config === undefined
			? "Model"
			: `${agentDisplayName(config)} · ${
					currentModel?.shortLabel ?? currentModel?.label ?? (config.model || "Choose a model")
				}`;

	const isFavoriteAvailable = (choice: Choice & { model: string }): boolean => {
		if (config !== undefined && sameChoice(choice, config)) {
			return allModels.some((model) => model.id === choice.model);
		}
		const key = choice.acpAgent === undefined ? choice.agent : `${choice.agent}:${choice.acpAgent}`;
		const entry = services.agentCatalog.store.getState().models[key];
		if (entry === undefined || entry.state !== "ready") return true;
		return entry.data.some((model) => model.id === choice.model);
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

	return (
		<Popover
			trigger={
				<Button
					ref={triggerRef}
					variant="ghost"
					size="sm"
					aria-label="Model picker"
					className="max-w-56"
				>
					<span className="truncate">{triggerLabel}</span>
					<ChevronDownIcon className="size-3 shrink-0" />
				</Button>
			}
		>
			<div className="max-h-[28rem] w-80 space-y-3 overflow-y-auto">
				<FavoriteModels
					config={config}
					isAvailable={isFavoriteAvailable}
					onPick={(favorite) => void applyConfig(favorite)}
				/>

				<section aria-label="Agent" className="space-y-1 border-t border-border pt-2">
					<h3 className="px-2 text-xs font-medium text-fg-subtle">Agent</h3>
					{AGENT_CHOICES.map((choice) => {
						const selected = config !== undefined && sameChoice(config, choice);
						const available = isInstalled(choice);
						return (
							<button
								key={`${choice.agent}:${choice.acpAgent ?? ""}`}
								type="button"
								disabled={!available}
								aria-pressed={selected}
								onClick={() => void chooseAgent(choice)}
								className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg outline-none hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
							>
								<span className="flex-1 truncate">{choice.label}</span>
								{selected ? <CheckIcon /> : null}
							</button>
						);
					})}
				</section>

				<section aria-label="Model" className="space-y-1 border-t border-border pt-2">
					<h3 className="px-2 text-xs font-medium text-fg-subtle">Model</h3>
					<div className="px-2">
						<Input
							aria-label="Search models"
							placeholder="Search models"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
					</div>
					{models.state === "loading" ? (
						<p className="px-2 py-1 text-sm text-fg-muted">Loading models…</p>
					) : null}
					{models.state === "error" ? (
						<p className="px-2 py-1 text-sm text-fg-muted">Couldn't load models.</p>
					) : null}
					{models.state === "ready" && filteredModels.length === 0 ? (
						<p className="px-2 py-1 text-sm text-fg-muted">No models found</p>
					) : null}
					{filteredModels.map((model) => {
						const selected = config?.model === model.id;
						return (
							<button
								key={model.id}
								type="button"
								aria-pressed={selected}
								onClick={() => chooseModel(model)}
								className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg outline-none hover:bg-hover"
							>
								<span className="flex-1 truncate">{model.shortLabel ?? model.label}</span>
								{model.isNew ? (
									<span className="text-2xs uppercase tracking-wider text-accent">New</span>
								) : null}
								{selected ? <CheckIcon /> : null}
							</button>
						);
					})}
				</section>

				<section aria-label="Effort" className="space-y-1 border-t border-border pt-2">
					<h3 className="px-2 text-xs font-medium text-fg-subtle">
						{currentModel?.effortAxis === "thinking" ? "Thinking" : "Effort"}
					</h3>
					{currentModel === undefined ? (
						<p className="px-2 py-1 text-sm text-fg-muted">Not supported for this model</p>
					) : (
						<>
							{!currentModel.efforts.includes(config?.effort ?? "high") ? (
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
										className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg outline-none hover:bg-hover"
									>
										<span className="flex-1 truncate">
											{currentModel.effortLabels?.[effort] ?? EFFORT_LABELS[effort]}
										</span>
										{selected ? <CheckIcon /> : null}
									</button>
								);
							})}
						</>
					)}
				</section>

				{currentModel?.supportsFastMode === true ? (
					<section aria-label="Fast mode" className="border-t border-border pt-2">
						<button
							type="button"
							aria-pressed={config?.fastMode === true}
							onClick={toggleFast}
							className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg outline-none hover:bg-hover"
						>
							<span className="flex-1 truncate">Fast</span>
							<span className="text-xs tracking-widest text-fg-muted">⌘⇧E</span>
							{config?.fastMode === true ? <CheckIcon /> : null}
						</button>
					</section>
				) : null}
			</div>
		</Popover>
	);
}
