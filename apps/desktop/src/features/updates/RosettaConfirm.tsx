/**
 * @feature APP-08 Wrong-CPU build confirm
 * Owns: the confirm dialog that warns when the Intel build runs on an Apple silicon Mac (under Rosetta) and
 * points to the right build.
 * Behaviour: ui-map.md 5.2 (the "<x> Conductor?" app-update and Rosetta confirms), 7.4 (the full-screen
 * "Wrong version of Conductor for this Mac"); coverage/shell-and-navigation.md (fold the Rosetta confirm
 * into APP-08).
 * Data: `SystemInfo` (machineArch, buildArch) from useSystemInfo. The download goes through
 * `Actions.app.openUrl` with the release page; the page address is passed in.
 * Our design choice: this dialog is the softer sibling of the full-screen blocker in app/StartupFailure.tsx.
 * It is for a window that is already open, and for the wrong-CPU screen's "Continue anyway" path. It renders
 * nothing when the two CPU values agree.
 * Must handle: the Mac and the build agree (the dialog never opens); no release page known (the dialog
 * explains the mismatch without a download button); Escape and outside click closing the dialog (the caller
 * treats that as continue); a download page that will not open (a plain error toast); focus returning to the
 * previous control when it closes.
 * Test first: with machineArch "arm64" and buildArch "x86_64" the dialog opens and offers the download;
 * with equal values it renders nothing.
 */
import { useState } from "react";
import { useServices } from "../../core/context.tsx";
import type { SystemInfo } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import type { OverlayProps } from "../../ui/overlay-props.ts";
import { toastError } from "../../ui/Toast.tsx";

export interface RosettaConfirmProps extends Pick<OverlayProps, "open" | "onOpenChange"> {
	system: SystemInfo;
	/** Where the build for this Mac can be downloaded. Null when unknown. */
	downloadUrl: string | null;
}

/** True only for an Intel build running on an Apple silicon Mac. */
export function isWrongCpuBuild(system: SystemInfo): boolean {
	return system.machineArch === "arm64" && system.buildArch === "x86_64";
}

export function RosettaConfirm({ open, onOpenChange, system, downloadUrl }: RosettaConfirmProps) {
	const { actions } = useServices();
	const [opening, setOpening] = useState(false);

	if (!isWrongCpuBuild(system)) return null;

	const openDownload = async (): Promise<void> => {
		if (downloadUrl === null) return;
		setOpening(true);
		try {
			const opened = await actions.app.openUrl(downloadUrl);
			if (!opened.ok) {
				toastError("Couldn't open the download page", opened.error);
				return;
			}
			onOpenChange(false);
		} catch (cause) {
			toastError("Couldn't open the download page", {
				message: cause instanceof Error ? cause.message : String(cause),
			});
		} finally {
			setOpening(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="Wrong version of Conducted for this Mac"
				description="This Mac has Apple silicon. The Intel build runs under Rosetta, which is slower and misses some features."
			>
				<p className="text-sm text-fg-muted">
					{downloadUrl === null
						? "Download the Apple silicon build from the Conducted releases page to use the right version."
						: "Download the Apple silicon build to use the right version."}
				</p>
				<DialogFooter>
					{downloadUrl === null ? null : (
						<Button onClick={() => void openDownload()} loading={opening}>
							Download for Apple silicon
						</Button>
					)}
					<Button
						variant={downloadUrl === null ? "default" : "secondary"}
						onClick={() => onOpenChange(false)}
					>
						Continue anyway
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
