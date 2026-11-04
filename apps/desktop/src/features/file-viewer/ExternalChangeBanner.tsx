/**
 * @feature REV-08 External change banner
 * Owns: the banner shown when a file with unsaved edits changed on disk (an agent wrote it).
 * Behaviour: ui-map.md 3.2 ("File changed on disk": buttons "Discard my edits" and "Keep mine").
 * Must handle: Discard replacing the draft with the disk version, Keep mine keeping the draft and
 * making the next save overwrite deliberately, a second disk change while the banner is up, and
 * the file being deleted instead of changed (different text, Keep mine means recreate).
 * Test first: Keep mine calls onKeepMine once and the banner stays hidden until the next change.
 */
import { notImplemented } from "@conducted/shared";

export interface ExternalChangeBannerProps {
	kind: "changed" | "deleted";
	onDiscardMine: () => void;
	onKeepMine: () => void;
}

export function ExternalChangeBanner(_props: ExternalChangeBannerProps): never {
	return notImplemented("REV-08");
}
