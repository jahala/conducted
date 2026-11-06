/**
 * @feature SET-02 General settings page
 * @feature PLAT-24 Full Disk Access row
 * Owns: the General page of Settings: how messages are sent, follow-up behaviour, notifications,
 * sound, the other everyday app settings the registry places on this page, and the Full Disk
 * Access row with its status and the button that opens the macOS Privacy & Security pane.
 * Behaviour: ui-map.md 6, "General" table and "Control values" (send key, follow-up behaviour,
 * completion sound, "Full disk access permissions"). Registry rows come from SET-01, so the page
 * and search read one table.
 * Must handle: a save that fails (the failure is shown under the row and the stored value stays);
 * a Full Disk Access check that is loading, says no access, or fails; System Settings that cannot
 * open (the row tells the user to grant the permission by hand).
 * Test first: changing "Send key" calls settings.set with the new value once.
 */
import { useState } from "react";
import { useActions, useFullDiskAccess } from "../../../core/hooks.ts";
import { Button } from "../../../ui/Button.tsx";
import { RegistrySettingRows } from "../SettingRow.tsx";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";

/** PLAT-24: the permission status and the button that opens System Settings at the right pane. */
function FullDiskAccessRow() {
	const access = useFullDiskAccess();
	const actions = useActions();
	const [opening, setOpening] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);

	const openSettings = async () => {
		setOpening(true);
		setFailure(null);
		const result = await actions.app.openFullDiskAccessSettings();
		setOpening(false);
		if (!result.ok) setFailure(result.error.message);
	};

	const status =
		access.state === "loading"
			? "Checking…"
			: access.state === "error"
				? access.error.message
				: access.data
					? "Granted"
					: "Not granted";

	return (
		<div className="flex items-start justify-between gap-6 border-t border-border py-4">
			<div className="flex min-w-0 flex-col gap-1">
				<p className="text-sm font-medium text-fg">Full disk access permissions</p>
				<p className="max-w-prose text-sm text-fg-muted">
					To let agents work without repeated folder permission prompts.
				</p>
				<p role="status" className="text-xs text-fg-subtle">
					{status}
				</p>
				{failure === null ? null : (
					<p role="alert" className="text-xs text-danger">
						{failure}
					</p>
				)}
			</div>
			<Button variant="secondary" loading={opening} onClick={() => void openSettings()}>
				Open System Settings
			</Button>
		</div>
	);
}

export function GeneralPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	return (
		<SettingsPageFrame
			title="General"
			description="Everyday behaviour for messages, notifications and the app window."
			{...load}
			focusSettingKey={focusSettingKey}
		>
			<RegistrySettingRows page="general" focusSettingKey={focusSettingKey} />
			<FullDiskAccessRow />
		</SettingsPageFrame>
	);
}
