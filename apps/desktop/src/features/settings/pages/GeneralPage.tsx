/**
 * @feature SET-02 General settings page
 * Owns: the General page of Settings: how messages are sent, follow-up behaviour, notifications,
 * sound, and the other everyday app settings the registry places on this page.
 * Behaviour: ui-map.md 6, "General" table and "Control values" (send key, follow-up behaviour,
 * completion sound). Rows come from the settings registry (SET-01), so the page and search read
 * one table.
 * Must handle: a save that fails (the failure is shown under the row and the stored value stays).
 * Test first: changing "Send key" calls settings.set with the new value once.
 */
import { RegistrySettingRows } from "../SettingRow.tsx";
import { SettingsPageFrame } from "../SettingsPageFrame.tsx";

export function GeneralPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	return (
		<SettingsPageFrame
			title="General"
			description="Everyday behaviour for messages, notifications and the app window."
			state="ready"
			errorMessage={null}
			onRetry={() => undefined}
			focusSettingKey={focusSettingKey}
		>
			<RegistrySettingRows page="general" focusSettingKey={focusSettingKey} />
		</SettingsPageFrame>
	);
}
