/**
 * @feature SET-02 Review model picker on the Default models page
 * Owns: the "Review model" row: a picker that names the model AI code reviews use with its agent
 * and effort, and whose menu chooses the agent, the model, the effort and fast mode together.
 * Behaviour: Conductor's review_model row (renderApp mWa, @11260749) holds its model picker, which
 * writes the review model, the review effort or thinking level and review fast mode in one choice;
 * those have no rows of their own there. Its picker is the full model picker, whose agent menu
 * reaches every agent, so the row lists every agent's models under the agent's name.
 * Data: useLoadout (the default model, which an empty review model means), useModels and
 * useAgentInstalls for every agent, useSetting for review_agent, review_model, the review effort
 * settings and review_fast_mode, useSettingSaves.
 * Our design choice: the picker stores the agent with the model, because our model ids do not
 * carry their agent (Conductor derives it from the model). The review chat then starts with that
 * agent (core/services/sessions.ts, reviewConfigFrom). A review chat with no stored agent keeps the
 * default chat's agent, and an empty review model keeps the default model. Claude and Codex keep
 * their own review effort settings; Cursor and the ACP agents share `review_effort`, since our app
 * has no per-model effort store. The Codex thinking level for reviews therefore has no row of its
 * own any more; the picker reaches it when a Codex model is chosen.
 * Must handle: a search for the review agent, effort or fast mode (this row is highlighted), an
 * empty review model (the default model's name and effort are shown), an empty effort (the
 * default's), a default loadout that cannot be read (the new chat's own fallbacks from
 * core/services/workspace.ts, so the two rules have one home), the models still loading (the
 * trigger names the stored id), an agent that is not installed (its models are left out), and a
 * save that fails (the row's error line).
 * Test first: picks the review model, its effort and fast mode in one picker, as Conductor does.
 * Test first: lists every agent's models, and stores the chosen agent with its model.
 */
import type { Effort, ModelInfo } from "@conducted/protocol";
import { useAgentInstalls, useModels, useSetting } from "../../../core/hooks.ts";
import { getSettingDef, pageDescriptionOf } from "../../../core/registries/settings.ts";
import {
	AGENT_CHOICES,
	agentDisplayName,
	agentKey,
	parseAgentKey,
} from "../../../core/services/agent-catalog.ts";
import type { FavoriteModel } from "../../../core/services/favorite-models.ts";
import {
	NEW_CHAT_EFFORT_FALLBACK,
	NEW_CHAT_MODEL_FALLBACK,
} from "../../../core/services/workspace.ts";
import { Button } from "../../../ui/Button.tsx";
import { ChevronDownIcon } from "../../../ui/icons.tsx";
import {
	Menu,
	MenuContent,
	MenuLabel,
	MenuRadioGroup,
	MenuRadioItem,
	MenuTrigger,
} from "../../../ui/Menu.tsx";
import { EFFORT_LABELS, modelsForPicker } from "../../composer/ModelPicker.tsx";
import { useLoadout } from "../../composer/use-loadout.ts";
import { SettingRow, useSettingSaves } from "../SettingRow.tsx";
import { ModelEffortItems } from "./LoadoutEditor.tsx";

type Choice = FavoriteModel["config"];
type AgentChoice = { agent: Choice["agent"]; acpAgent?: Choice["acpAgent"] };

const KEY = "review_model";
const AGENT_KEY = "review_agent";

/** The settings the picker holds besides the model; a search for one highlights this row. */
export const IN_REVIEW_PICKER: readonly string[] = [
	AGENT_KEY,
	"review_claude_effort_level",
	"review_codex_thinking_level",
	"review_effort",
	"review_fast_mode",
];

/** The setting a chosen agent's review effort is stored in. */
function effortKeyFor(agent: Choice["agent"]): string {
	if (agent === "claude") return "review_claude_effort_level";
	if (agent === "codex") return "review_codex_thinking_level";
	return "review_effort";
}

function keyOf(choice: AgentChoice): string {
	return agentKey(choice.agent, choice.acpAgent);
}

function sameAgent(left: AgentChoice, right: AgentChoice): boolean {
	return keyOf(left) === keyOf(right);
}

/** The choice a model row makes: its agent, its model and its own default effort when needed. */
function choiceFor(spec: AgentChoice, item: ModelInfo, current: Choice): Choice {
	return {
		agent: spec.agent,
		...(spec.agent === "acp" ? { acpAgent: spec.acpAgent } : {}),
		model: item.id,
		effort: item.efforts.includes(current.effort) ? current.effort : item.defaultEffort,
		fastMode: item.supportsFastMode && current.fastMode,
	};
}

/**
 * One agent's models under its name. A fragment inside the picker's single radio group, so one
 * selected row spans every agent. An agent that is not installed offers no models.
 */
function ReviewAgentModels({
	spec,
	choice,
	visible,
	onPick,
}: {
	spec: AgentChoice;
	choice: Choice;
	visible: string | undefined;
	onPick: (item: ModelInfo) => void;
}) {
	const models = useModels(spec.agent, spec.acpAgent);
	const installs = useAgentInstalls();
	const install =
		installs.state === "ready"
			? installs.data.find(
					(entry) =>
						entry.agent === spec.agent &&
						(spec.agent !== "acp" || entry.acpAgent === spec.acpAgent),
				)
			: undefined;
	if (install !== undefined && (install.installed !== true || install.authenticated === false)) {
		return null;
	}
	const raw = models.state === "ready" ? models.data : [];
	const shown = modelsForPicker(raw, visible);
	if (sameAgent(spec, choice) && !shown.some((item) => item.id === choice.model)) {
		const current = raw.find((item) => item.id === choice.model);
		if (current !== undefined) shown.push(current);
	}
	if (shown.length === 0) return null;
	const prefix = keyOf(spec);
	return (
		<>
			<MenuLabel>{agentDisplayName(spec)}</MenuLabel>
			{shown.map((item) => (
				<MenuRadioItem
					key={`${prefix}|${item.id}`}
					value={`${prefix}|${item.id}`}
					onSelect={() => onPick(item)}
				>
					{item.label}
				</MenuRadioItem>
			))}
		</>
	);
}

export function ReviewModelRow({ focusSettingKey }: { focusSettingKey: string | null }) {
	const def = getSettingDef(KEY);
	const saves = useSettingSaves();
	const { entries } = useLoadout();
	const fallback = entries.find((entry) => entry.isDefault)?.config;
	const storedAgent = useSetting<string>(AGENT_KEY).trim();
	const parsedAgent = storedAgent === "" ? null : parseAgentKey(storedAgent);
	const agent: AgentChoice = parsedAgent ?? {
		agent: fallback?.agent ?? "claude",
		acpAgent: fallback?.agent === "acp" ? fallback.acpAgent : undefined,
	};
	const storedModel = useSetting<string>(KEY).trim();
	const storedEffort = useSetting<string>(effortKeyFor(agent.agent)).trim();
	const fastMode = useSetting<boolean>("review_fast_mode") === true;
	const visible = useSetting<string>("visible_provider_models");
	const selected = useModels(agent.agent, agent.acpAgent);
	const list = selected.state === "ready" ? selected.data : [];
	if (def === undefined) return null;

	const choice: Choice = {
		agent: agent.agent,
		...(agent.agent === "acp" ? { acpAgent: agent.acpAgent } : {}),
		model: storedModel !== "" ? storedModel : (fallback?.model ?? NEW_CHAT_MODEL_FALLBACK),
		effort:
			storedEffort !== ""
				? (storedEffort as Effort)
				: (fallback?.effort ?? NEW_CHAT_EFFORT_FALLBACK),
		fastMode,
	};
	const model = list.find((item) => item.id === choice.model);
	const label = model?.label ?? choice.model;
	const effort = model?.effortLabels?.[choice.effort] ?? EFFORT_LABELS[choice.effort];
	const selectedValue = `${keyOf(choice)}|${choice.model}`;

	const change = async (next: Choice) => {
		const agentChanged = !sameAgent(next, choice);
		// The agent goes with the model, so a review chat starts with the agent that offers it.
		if (agentChanged && !(await saves.save(AGENT_KEY, keyOf(next)))) return;
		if (next.model !== choice.model && !(await saves.save(KEY, next.model))) return;
		// A new agent always stores its effort, so the review reads the same level the row shows.
		if (agentChanged || next.effort !== choice.effort) {
			if (!(await saves.save(effortKeyFor(next.agent), next.effort))) return;
		}
		if (next.fastMode !== fastMode) await saves.save("review_fast_mode", next.fastMode);
	};

	return (
		<SettingRow
			settingKey={KEY}
			title={def.title}
			description={pageDescriptionOf(def)}
			disabledReason={null}
			highlighted={
				focusSettingKey !== null &&
				(focusSettingKey === KEY || IN_REVIEW_PICKER.includes(focusSettingKey))
			}
			saveError={
				saves.errorOf(KEY) ??
				saves.errorOf(AGENT_KEY) ??
				saves.errorOf("review_claude_effort_level") ??
				saves.errorOf("review_codex_thinking_level") ??
				saves.errorOf("review_effort") ??
				saves.errorOf("review_fast_mode")
			}
		>
			<Menu>
				<MenuTrigger asChild>
					<Button
						variant="outline"
						size="sm"
						aria-label={`Review model: ${label}, ${effort}${fastMode ? ", fast mode" : ""}, ${agentDisplayName(agent)}`}
						className="w-[180px] justify-between"
					>
						<span className="flex min-w-0 items-baseline gap-1.5 truncate">
							<span className="truncate font-medium">{label}</span>
							<span className="text-fg-muted">{effort}</span>
						</span>
						<ChevronDownIcon className="size-3.5 shrink-0 text-fg-muted" />
					</Button>
				</MenuTrigger>
				<MenuContent align="end" className="w-56" aria-label="Review model">
					<MenuLabel>Model</MenuLabel>
					<MenuRadioGroup value={selectedValue}>
						{AGENT_CHOICES.map((spec) => (
							<ReviewAgentModels
								key={keyOf(spec)}
								spec={spec}
								choice={choice}
								visible={visible}
								onPick={(item) => void change(choiceFor(spec, item, choice))}
							/>
						))}
					</MenuRadioGroup>
					{model === undefined ? null : (
						<ModelEffortItems
							model={model}
							choice={choice}
							onChange={(next) => void change(next)}
						/>
					)}
				</MenuContent>
			</Menu>
		</SettingRow>
	);
}
