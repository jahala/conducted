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
 * Our design choice (D098, ours placed in Conductor's layout): the rows Conductor keeps inside its
 * pickers sit beside the row they belong to. The review effort, thinking and fast mode follow Review
 * model; the default Codex thinking level follows Codex personality; "Models shown in the picker"
 * comes last.
 * Data: LoadoutEditor (the loadout and the agents' models); registry rows for the rest.
 * Must handle: the settings store loading or failing (the shared frame); an agent that is not
 * installed (its column offers Configure); a chosen model without fast mode (the slot says so).
 * Test first: Enter on a model row puts it into the next empty loadout slot.
 */

import { LoadoutEditor } from "../models/LoadoutEditor.tsx";
import { RegistrySettingRowByKey } from "../SettingRow.tsx";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";

/** The rows after the Loadout, in Conductor's order with ours beside the row they belong to. */
const ROWS: readonly string[] = [
	"default_codex_personality",
	"default_codex_thinking_level",
	"default_claude_personality",
	"review_model",
	"review_claude_effort_level",
	"review_codex_thinking_level",
	"review_fast_mode",
	"default_plan_mode",
	"visible_provider_models",
];

export function DefaultModelsPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	const loadoutFocused =
		focusSettingKey === "default_model" ||
		focusSettingKey === "default_fast_mode" ||
		focusSettingKey === "default_claude_effort_level";

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
			{ROWS.map((key) => (
				<RegistrySettingRowByKey key={key} settingKey={key} focusSettingKey={focusSettingKey} />
			))}
		</SettingsPageFrame>
	);
}
