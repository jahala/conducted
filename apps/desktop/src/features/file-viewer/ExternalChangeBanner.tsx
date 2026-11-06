/**
 * @feature REV-08 External change banner
 * Owns: the banner shown when a file with unsaved edits changed on disk (an agent wrote it).
 * Behaviour: ui-map.md 3.2 ("File changed on disk": buttons "Discard my edits" and "Keep mine").
 * Must handle: Discard replacing the draft with the disk version, Keep mine keeping the draft and
 * making the next save overwrite deliberately, a second disk change while the banner is up, and
 * the file being deleted instead of changed (different text).
 * Test first: Keep mine calls onKeepMine once and the banner stays hidden until the next change.
 */
import { Alert, AlertDescription, AlertTitle } from "../../ui/Alert.tsx";
import { Button } from "../../ui/Button.tsx";

export interface ExternalChangeBannerProps {
	kind: "changed" | "deleted";
	onDiscardMine: () => void;
	onKeepMine: () => void;
}

export function ExternalChangeBanner({
	kind,
	onDiscardMine,
	onKeepMine,
}: ExternalChangeBannerProps) {
	const title = kind === "deleted" ? "File was deleted on disk" : "File changed on disk";
	return (
		<Alert tone="destructive" className="m-3">
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>
				{kind === "deleted"
					? "An agent or another app removed this file. Keep mine keeps your edits."
					: "An agent or another app wrote this file while you had unsaved edits."}
			</AlertDescription>
			<div className="mt-2 flex items-center gap-2">
				<Button variant="secondary" size="sm" onClick={onDiscardMine}>
					Discard my edits
				</Button>
				<Button variant="outline" size="sm" onClick={onKeepMine}>
					Keep mine
				</Button>
			</div>
		</Alert>
	);
}
