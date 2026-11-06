/**
 * @feature NAV-17 Enabled-setting notice
 * Owns: the notice shown after a deep link turned on an experimental setting: "Enabled setting: <name>"
 * with a "Go to setting" button.
 * Behaviour: coverage/inventory-controls.md (a link that turns on an experimental setting shows the toast
 * "Enabled setting: <name>" with "Go to setting"); native-and-sidecar-map.md A8 (`settings-enable?key=`).
 * Data: `settingTitle` is the title the settings registry (core/registries/settings.ts) gives for
 * `settingKey`. The caller turns the setting on through `Actions.settings.set` and then shows this notice.
 * Must handle: a title that is very long (cut, full text in a tooltip); "Go to setting" opening the page
 * that holds the setting; the notice staying until dismissed or until the user acts, not on a short timer,
 * because it names a changed setting; two links in a row showing two notices, not one that hides the first.
 * Test first: clicking "Go to setting" calls onGoToSetting once.
 */
import { Button } from "../ui/Button.tsx";
import { CloseIcon } from "../ui/icons.tsx";

export interface EnabledSettingNoticeProps {
	settingKey: string;
	/** The setting's title, as the settings page shows it. */
	settingTitle: string;
	onGoToSetting: () => void;
	onDismiss: () => void;
}

export function EnabledSettingNotice({
	settingTitle,
	onGoToSetting,
	onDismiss,
}: EnabledSettingNoticeProps) {
	const text = `Enabled setting: ${settingTitle}`;
	return (
		<div
			role="status"
			className="flex w-[356px] max-w-full items-start gap-3 rounded-lg border border-border bg-raised p-4 text-code text-fg shadow-toast"
		>
			<p className="min-w-0 flex-1 truncate font-medium" title={text}>
				{text}
			</p>
			<div className="flex shrink-0 items-center gap-1">
				<Button variant="outline" size="xs" onClick={onGoToSetting}>
					Go to setting
				</Button>
				<Button
					variant="ghost"
					size="xs"
					aria-label="Dismiss enabled setting notice"
					onClick={onDismiss}
				>
					<CloseIcon className="size-3.5" />
				</Button>
			</div>
		</div>
	);
}
