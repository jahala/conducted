/**
 * @feature SET-02 Experimental settings page
 * Owns: the Experimental page of Settings: switches for features that are still changing.
 * Behaviour: ui-map.md 6, "Experimental" table; services-map.md 4.1.5 and 4.2.3 (experimental
 * keys). Rows come from the settings registry (SET-01); repository-scoped rows belong to the
 * repository pages.
 * Must handle: a setting that needs a restart (says so after it is turned on).
 * Test first: turning on "Transparent sidebar" shows the restart note.
 */
import { useSetting } from "../../../core/hooks.ts";
import { RegistrySettingRows } from "../SettingRow.tsx";
import { SettingsPageFrame } from "../SettingsPageFrame.tsx";

export function ExperimentalPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const transparency = useSetting<boolean>("experimental_sidebar_transparency");

	return (
		<SettingsPageFrame
			title="Experimental"
			description="Features that are still changing. They may move or behave differently."
			state="ready"
			errorMessage={null}
			onRetry={() => undefined}
			focusSettingKey={focusSettingKey}
		>
			<RegistrySettingRows
				page="experimental"
				focusSettingKey={focusSettingKey}
				exclude={["auto_run_after_setup"]}
				extraFor={(def) =>
					def.key === "experimental_sidebar_transparency" && transparency ? (
						<p role="status" className="text-xs text-fg-muted">
							Quit and reopen the app to apply sidebar transparency.
						</p>
					) : null
				}
			/>
		</SettingsPageFrame>
	);
}
