/**
 * @feature RC-04 Remote Control settings
 * Owns: the Remote control page of Settings: Remote Control for new chats, and keeping the Mac
 * awake while a Remote Control session is connected.
 * Behaviour: ui-map.md 6 "Remote control" (Conductor's page has "Keep this Mac awake"; its pairing
 * rows belong to its phone relay, which D004 and D019 leave out). Rows come from the settings
 * registry (SET-01). Each chat's own switch is in its composer (RC-02).
 * Must handle: settings still loading or failing to load (SettingsPageFrame shows the state); a
 * search result that opens the page highlights its row.
 * Test first: the page shows both switches, and turning "Remote Control for new chats" on stores it.
 */
import { RegistrySettingRows } from "../SettingRow.tsx";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";

export function RemoteControlPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	return (
		<SettingsPageFrame
			title="Remote control"
			description="Follow and steer Claude chats from claude.ai/code or the Claude app while they run on this Mac."
			{...load}
			focusSettingKey={focusSettingKey}
		>
			<RegistrySettingRows page="remote-control" focusSettingKey={focusSettingKey} />
		</SettingsPageFrame>
	);
}
