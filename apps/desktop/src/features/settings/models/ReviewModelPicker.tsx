/**
 * @feature SET-02 Review model picker on the Default models page
 * Owns: the "Review model" row: a picker that names the model AI code reviews use with its effort,
 * and whose menu chooses the model, the effort and fast mode together.
 * Behaviour: Conductor's review_model row (renderApp mWa, @11260749) holds its model picker, which
 * writes the review model, the review effort or thinking level and review fast mode in one choice;
 * those have no rows of their own there.
 * Data: useLoadout (the default model, which an empty review model means), useModels("claude"),
 * useSetting for review_model, review_claude_effort_level and review_fast_mode, useSettingSaves.
 * Our design choice: the picker lists Claude Code's models only. A review chat starts from the
 * default chat config, whose agent is Claude Code (core/services/sessions.ts, reviewConfigFrom), so
 * another agent's model could not run there; Conductor's picker lists every agent. The Codex
 * thinking level for reviews keeps its own row, since this picker cannot reach it.
 * Must handle: a search for the review effort or fast mode (this row is highlighted), an empty review model (the default model's name and effort are shown), an empty
 * effort (the default's), the models still loading (the trigger names the stored id), and a save
 * that fails (the row's error line).
 * Test first: picks the review model, its effort and fast mode in one picker, as Conductor does.
 */
import type { Effort } from "@conducted/protocol";
import { useModels, useSetting } from "../../../core/hooks.ts";
import { getSettingDef, pageDescriptionOf } from "../../../core/registries/settings.ts";
import type { FavoriteModel } from "../../../core/services/favorite-models.ts";
import { Button } from "../../../ui/Button.tsx";
import { ChevronDownIcon } from "../../../ui/icons.tsx";
import { Menu, MenuContent, MenuTrigger } from "../../../ui/Menu.tsx";
import { EFFORT_LABELS } from "../../composer/ModelPicker.tsx";
import { useLoadout } from "../../composer/use-loadout.ts";
import { SettingRow, useSettingSaves } from "../SettingRow.tsx";
import { ModelChoiceItems } from "./LoadoutEditor.tsx";

const KEY = "review_model";
/** The settings the picker holds besides the model; a search for one highlights this row. */
export const IN_REVIEW_PICKER: readonly string[] = [
	"review_claude_effort_level",
	"review_fast_mode",
];

export function ReviewModelRow({ focusSettingKey }: { focusSettingKey: string | null }) {
	const def = getSettingDef(KEY);
	const saves = useSettingSaves();
	const { entries } = useLoadout();
	const fallback = entries.find((entry) => entry.isDefault)?.config;
	const storedModel = useSetting<string>(KEY).trim();
	const storedEffort = useSetting<string>("review_claude_effort_level").trim();
	const fastMode = useSetting<boolean>("review_fast_mode") === true;
	const models = useModels("claude");
	const list = models.state === "ready" ? models.data : [];
	if (def === undefined) return null;

	const choice: FavoriteModel["config"] = {
		agent: "claude",
		model: storedModel !== "" ? storedModel : (fallback?.model ?? ""),
		effort: storedEffort !== "" ? (storedEffort as Effort) : (fallback?.effort ?? "high"),
		fastMode,
	};
	const model = list.find((item) => item.id === choice.model);
	const label = model?.label ?? choice.model;
	const effort = model?.effortLabels?.[choice.effort] ?? EFFORT_LABELS[choice.effort];

	const change = async (next: FavoriteModel["config"]) => {
		if (next.model !== choice.model && !(await saves.save(KEY, next.model))) return;
		if (next.effort !== choice.effort) {
			if (!(await saves.save("review_claude_effort_level", next.effort))) return;
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
				saves.errorOf("review_claude_effort_level") ??
				saves.errorOf("review_fast_mode")
			}
		>
			<Menu>
				<MenuTrigger asChild>
					<Button
						variant="outline"
						size="sm"
						aria-label={`Review model: ${label}, ${effort}${fastMode ? ", fast mode" : ""}`}
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
					<ModelChoiceItems models={list} choice={choice} onChange={(next) => void change(next)} />
				</MenuContent>
			</Menu>
		</SettingRow>
	);
}
