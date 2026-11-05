/**
 * @feature CHAT-24 Video in replies
 * Owns: the video player that a reply shows when its Markdown points at a video file.
 * Behaviour: ui-map.md 3.3 (Assistant text: "video player"), 5.4 (Video keys, not rebindable: k or space
 * play or pause, j back 10 seconds, l forward 10 seconds, left arrow or comma previous frame, right arrow or
 * period next frame, "<" slower, ">" faster, m mute, f fullscreen).
 * Our design choice: the keys apply while the player has focus, so they never fight chat shortcuts. The
 * player and the File tab's VideoPreview (REV-08) may share one key handler; the builder of the second one
 * checks the first before writing another.
 * Must handle: a codec the webview cannot play (a card with "Open in another app", no blank box); a file
 * path outside the workspace (not loaded); a file still being written; no autoplay and no sound until the
 * user starts it; several videos in one reply (starting one pauses the others); a video taller than the chat
 * (capped height, keeps its aspect ratio); keyboard focus visible on the player.
 * Test first: pressing "l" on a focused player moves the time forward by 10 seconds, and not past the end.
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface ChatVideoProps {
	workspaceId: WorkspaceId;
	/** The Markdown target: a path in the workspace or a web address. */
	src: string;
	alt: string;
	onOpenExternally: () => void;
}

export function ChatVideo(_props: ChatVideoProps): never {
	return notImplemented("CHAT-24");
}
