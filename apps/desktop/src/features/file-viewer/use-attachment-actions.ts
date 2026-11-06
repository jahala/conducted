/**
 * @feature CHAT-29 Attachment and image viewer: copy, save, open
 * Owns: the outcomes a chat image's menu and the attachment viewer show: copying an image, saving
 * a copy where the user picks, and opening the file in its default app.
 * Behaviour: ui-map.md 3.3 (chat images), inventory toast rows 535 to 537 and 698.
 * Must handle: a cancelled save shows nothing; a failure shows the exact text the inventory names
 * and keeps the file as it was; every action reports an outcome, never a silent failure.
 * Test first: copying an image shows "Copied image to clipboard", and a refused copy shows
 * "Failed to copy to clipboard".
 */
import { useActions } from "../../core/hooks.ts";
import { toast, toastError } from "../../ui/Toast.tsx";

export type AttachmentKind = "image" | "video";

export interface AttachmentActions {
	copyImage(path: string): void;
	saveFile(path: string, kind: AttachmentKind): void;
	openExternally(path: string): void;
}

/** Backs the chat image menu and the viewer's buttons. */
export function useAttachmentActions(): AttachmentActions {
	const actions = useActions();
	return {
		copyImage: (path) => {
			void actions.attachments.copyImage(path).then((result) => {
				if (result.ok) {
					toast.success("Copied image to clipboard");
					return;
				}
				toastError("Failed to copy to clipboard", result.error);
			});
		},
		saveFile: (path, kind) => {
			void actions.attachments.saveAs(path).then((result) => {
				if (!result.ok) {
					toastError(
						kind === "image" ? "Failed to save image" : "Failed to save file",
						result.error,
					);
					return;
				}
				// A cancelled save is not an outcome the user needs to hear about.
				if (result.value === null) return;
				toast.success(kind === "image" ? "Image saved" : "File saved");
			});
		},
		openExternally: (path) => {
			void actions.attachments.openExternally(path).then((result) => {
				if (!result.ok) toastError("Failed to open the file", result.error);
			});
		},
	};
}
