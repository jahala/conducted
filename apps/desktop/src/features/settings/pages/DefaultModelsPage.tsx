/**
 * @feature SET-02 Default models settings page
 * Owns: the Default models page of Settings, laid out as Conductor's models tab (renderApp, the
 * "models" settings and their page): the "Loadout" with "Choose which models you want to use" and
 * its editor, then Codex personality, Claude output style, Review model and "Default to plan mode in
 * new chats".
 * Behaviour: ui-map.md 6, "Default models" table; services-map.md 4.2.3 (models and providers).
 * The loadout's first slot is the default model: its model, effort and fast mode are the settings
 * `default_model`, `default_claude_effort_level` and `default_fast_mode`, so they have no rows of
 * their own, as in Conductor, where they live in the slot's picker.
 * Review model is Conductor's picker, which holds the review effort and fast mode
 * (models/ReviewModelPicker.tsx).
 * Our design choice (D098, ours placed in Conductor's layout): the rows Conductor keeps inside its
 * pickers and ours cannot reach sit beside the row they belong to. The Codex thinking level for
 * reviews follows Review model; the default Codex thinking level follows Codex personality;
 * "Models shown in the picker" comes last.
 * Data: LoadoutEditor (the loadout and the agents' models); registry rows for the rest, in the
 * registry's order for this page, which follows the list above.
 * Must handle: the settings store loading or failing (the shared frame); an agent that is not
 * installed (its column offers Configure); a chosen model without fast mode (the slot says so).
 * Test first: Enter on a model row puts it into the next empty loadout slot.
 */

import { settingsForPage } from "../../../core/registries/settings.ts";
import { LoadoutEditor } from "../models/LoadoutEditor.tsx";
import { IN_REVIEW_PICKER, ReviewModelRow } from "../models/ReviewModelPicker.tsx";
import { RegistrySettingRows } from "../SettingRow.tsx";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";

/** The default model's settings, which the Loadout's first slot edits. */
const LOADOUT_DEFAULT_KEYS: readonly string[] = [
	"default_model",
	"default_fast_mode",
	"default_claude_effort_level",
];

const MODEL_KEYS = settingsForPage("models").map((def) => def.key);
const REVIEW_AT = MODEL_KEYS.indexOf("review_model");
const UP_TO_REVIEW_MODEL = MODEL_KEYS.slice(0, REVIEW_AT + 1);
const FROM_REVIEW_MODEL = MODEL_KEYS.slice(REVIEW_AT);

export function DefaultModelsPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	const loadoutFocused = focusSettingKey !== null && LOADOUT_DEFAULT_KEYS.includes(focusSettingKey);

	return (
		<SettingsPageFrame
			title="Default models"
			description={null}
			{...load}
			focusSettingKey={focusSettingKey}
		>
			<section
				id="setting-default_model"
				data-setting-key="default_model"
				data-highlighted={loadoutFocused ? "true" : undefined}
				aria-labelledby="loadout-title"
				className="flex flex-col gap-3 pb-5"
			>
				<div className="flex flex-col">
					<h2 id="loadout-title" className="text-sm font-medium text-fg">
						Loadout
					</h2>
					<p className="mt-0.5 text-sm text-fg-muted">Choose which models you want to use</p>
				</div>
				<LoadoutEditor />
			</section>
			{/* The registry lists the models page in this order (core/registries/settings.ts). */}
			<RegistrySettingRows
				page="models"
				focusSettingKey={focusSettingKey}
				exclude={[...LOADOUT_DEFAULT_KEYS, ...FROM_REVIEW_MODEL]}
			/>
			<ReviewModelRow focusSettingKey={focusSettingKey} />
			<RegistrySettingRows
				page="models"
				focusSettingKey={focusSettingKey}
				exclude={[...LOADOUT_DEFAULT_KEYS, ...UP_TO_REVIEW_MODEL, ...IN_REVIEW_PICKER]}
			/>
		</SettingsPageFrame>
	);
}
