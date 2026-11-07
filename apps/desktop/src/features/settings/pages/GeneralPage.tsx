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
 * Test first: changing "Send messages with" calls settings.set with the new value once.
 */
import { useState } from "react";
import { useActions, useFullDiskAccess, useSetting } from "../../../core/hooks.ts";
import { settingsForPage } from "../../../core/registries/settings.ts";
import { Button } from "../../../ui/Button.tsx";
import { Callout } from "../../../ui/Callout.tsx";
import { toastError } from "../../../ui/Toast.tsx";
import { ResetCalloutDismissals } from "../ResetCalloutDismissals.tsx";
import { RegistrySettingRows } from "../SettingRow.tsx";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";
import { SyncAgentConfigsRow } from "../SyncAgentConfigsDialog.tsx";

const DISMISSED_CALLOUTS_KEY = "dismissed_callouts";
const CALLOUT_DISMISSALS_HINT_ID = "callout-dismissals-hint";

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
		<div className="flex items-center justify-between gap-8 border-t border-border py-5">
			<div className="flex min-w-0 flex-col">
				<p className="flex min-h-7 items-center text-sm font-medium text-fg">
					Full disk access permissions
				</p>
				<p className="mt-0.5 text-sm text-fg-muted">
					To let agents work without repeated folder permission prompts.
				</p>
				{failure === null ? null : (
					<p role="alert" className="mt-1 text-xs text-danger">
						{failure}
					</p>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-4">
				<p role="status" className="text-sm text-fg-muted">
					{status}
				</p>
				<Button variant="outline" loading={opening} onClick={() => void openSettings()}>
					Open System Settings
				</Button>
			</div>
		</div>
	);
}

const GENERAL_KEYS = settingsForPage("general").map((def) => def.key);
const SOUND_AT = GENERAL_KEYS.indexOf("sound_type") + 1;
const GENERAL_UP_TO_SOUND = GENERAL_KEYS.slice(0, SOUND_AT);
const GENERAL_AFTER_SOUND = GENERAL_KEYS.slice(SOUND_AT);

export function GeneralPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	const actions = useActions();
	const storedDismissals = useSetting<string[]>(DISMISSED_CALLOUTS_KEY);
	const dismissedIds = Array.isArray(storedDismissals) ? storedDismissals : [];

	const dismissCallout = (id: string) => {
		if (dismissedIds.includes(id)) return;
		void actions.settings.set(DISMISSED_CALLOUTS_KEY, [...dismissedIds, id]).then((result) => {
			if (!result.ok) toastError("Couldn't remember that you dismissed the hint", result.error);
		});
	};

	const resetCallouts = async (): Promise<boolean> => {
		const result = await actions.settings.set(DISMISSED_CALLOUTS_KEY, []);
		if (!result.ok) {
			toastError("Couldn't reset callout dismissals", result.error);
			return false;
		}
		return true;
	};

	return (
		<SettingsPageFrame
			title="General"
			description={null}
			{...load}
			focusSettingKey={focusSettingKey}
		>
			{/* Conductor's order: full disk access sits right after the completion sound. */}
			<RegistrySettingRows
				page="general"
				focusSettingKey={focusSettingKey}
				exclude={GENERAL_AFTER_SOUND}
			/>
			<FullDiskAccessRow />
			<RegistrySettingRows
				page="general"
				focusSettingKey={focusSettingKey}
				exclude={GENERAL_UP_TO_SOUND}
			/>
			{/* Conductor lists Sync agent configs last on General, after the registry rows. */}
			<SyncAgentConfigsRow />
			<Callout
				id={CALLOUT_DISMISSALS_HINT_ID}
				dismissed={dismissedIds.includes(CALLOUT_DISMISSALS_HINT_ID)}
				onDismiss={dismissCallout}
				title="Dismissible hints"
			>
				Hints explain a control once. Dismiss this one, then choose Reset callout dismissals to
				bring it back.
			</Callout>
			<ResetCalloutDismissals dismissedIds={dismissedIds} onReset={resetCallouts} />
		</SettingsPageFrame>
	);
}
