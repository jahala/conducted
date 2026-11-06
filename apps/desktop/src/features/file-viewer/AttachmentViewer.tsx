/**
 * @feature CHAT-29 Attachment and image viewer: copy, save, open
 * Owns: the viewer a chat image or video opens, with Copy image, Download file and Open in
 * default app.
 * Behaviour: inventory label rows 343 and 462 (attachment viewer actions).
 * Must handle: a video shows its player and no Copy image, because the clipboard holds images; a
 * button's failure shows the same toast as the chat image menu; Escape and the overlay close the
 * viewer.
 * Test first: an image viewer offers Copy image, Download file and Open in default app, and each
 * calls its action.
 */
import { useServices } from "../../core/context.tsx";
import { Button } from "../../ui/Button.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import { VideoPreview } from "./preview/VideoPreview.tsx";
import { type AttachmentKind, useAttachmentActions } from "./use-attachment-actions.ts";

export interface AttachmentViewerProps {
	/** The absolute path of the file. */
	path: string;
	fileName: string;
	kind: AttachmentKind;
	onClose: () => void;
}

export function AttachmentViewer({ path, fileName, kind, onClose }: AttachmentViewerProps) {
	const { platform } = useServices();
	const attachmentActions = useAttachmentActions();
	const url = platform.fs.assetUrl(path);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent title={fileName} size="4xl" className="max-h-[92vh]">
				<div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-md bg-black">
					{kind === "image" ? (
						<img src={url} alt={fileName} className="max-h-[65vh] max-w-full object-contain" />
					) : (
						<div className="h-[65vh] w-full">
							<VideoPreview
								url={url}
								fileName={fileName}
								onOpenExternally={() => attachmentActions.openExternally(path)}
							/>
						</div>
					)}
				</div>
				<DialogFooter>
					{kind === "image" ? (
						<Button variant="secondary" onClick={() => attachmentActions.copyImage(path)}>
							Copy image
						</Button>
					) : null}
					<Button variant="secondary" onClick={() => attachmentActions.saveFile(path, kind)}>
						Download file
					</Button>
					<Button variant="secondary" onClick={() => attachmentActions.openExternally(path)}>
						Open in default app
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
