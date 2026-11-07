/**
 * @feature SET-02 Experimental settings page
 * Owns: the Experimental page of Settings: switches for features that are still changing.
 * Behaviour: ui-map.md 6, "Experimental" table; services-map.md 4.1.5 and 4.2.3 (experimental
 * keys). Rows come from the settings registry (SET-01). "Auto-run after setup" is on this page as a user
 * setting, as Conductor has it (services-map.md 4.2.3); a repository's own value is set on its
 * Scripts page.
 * Must handle: a setting that needs a restart (says so after it is turned on).
 * Test first: turning on "Sidebar transparency" shows the restart note.
 */
import { useSetting } from "../../../core/hooks.ts";
import { RegistrySettingRows } from "../SettingRow.tsx";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";

export function ExperimentalPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	const transparency = useSetting<boolean>("experimental_sidebar_transparency");

	return (
		<SettingsPageFrame
			title="Experimental"
			description="Features that are still changing. They may move or behave differently."
			{...load}
			focusSettingKey={focusSettingKey}
		>
			<RegistrySettingRows
				page="experimental"
				focusSettingKey={focusSettingKey}
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
