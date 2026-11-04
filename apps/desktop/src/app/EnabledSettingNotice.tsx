/**
 * @feature NAV-17 Enabled-setting notice
 * Owns: the notice shown after a deep link turned on an experimental setting: "Enabled setting: <name>"
 * with a "Go to setting" button.
 * Behaviour: coverage/inventory-controls.md (a link that turns on an experimental setting shows the toast
 * "Enabled setting: <name>" with "Go to setting"); native-and-sidecar-map.md A8 (`settings-enable?key=`).
 * Data: the title comes from the settings registry (core/registries/settings.ts) for `settingKey`. The
 * caller turns the setting on through `Actions.settings.set` and then shows this notice.
 * Must handle: a title that is very long (cut, full text in a tooltip); "Go to setting" opening the page
 * that holds the setting and selecting it (settings-pages.ts); the notice staying until dismissed or until
 * the user acts, not on a short timer, because it names a changed setting; two links in a row showing
 * two notices, not one that hides the first.
 * Test first: clicking "Go to setting" calls onGoToSetting once.
 */
import { notImplemented } from "@conducted/shared";

export interface EnabledSettingNoticeProps {
	settingKey: string;
	/** The setting's title, as the settings page shows it. */
	settingTitle: string;
	onGoToSetting: () => void;
	onDismiss: () => void;
}

export function EnabledSettingNotice(_props: EnabledSettingNoticeProps): never {
	return notImplemented("NAV-17");
}
