/**
 * @feature CHAT-24 Video in replies
 * Owns: the video player that a reply shows when its Markdown points at a video file.
 * Behaviour: ui-map.md 3.3 (Assistant text: "video player"), 5.4 (Video keys, not rebindable: k or space
 * play or pause, j back 10 seconds, l forward 10 seconds, left arrow or comma previous frame, right arrow or
 * period next frame, "<" slower, ">" faster, m mute, f fullscreen).
 * Our design choice: the player is the File tab's VideoPreview (REV-08), so the two places share one key
 * handler and one failure card. ChatVideo resolves the Markdown target inside the workspace and hands the
 * player a platform asset URL. The keys apply while the player has focus, so they never fight chat shortcuts.
 * A video in a reply opens with no autoplay and no sound until the user starts it, and starting one pauses
 * the other videos in the same reply.
 * Must handle: a codec the webview cannot play (a card with "Open in another app", no blank box); a file
 * path outside the workspace or a web address (not loaded, with a plain message); no autoplay and no sound
 * until the user starts it; several videos in one reply (starting one pauses the others); a video taller
 * than the chat (capped height, keeps its aspect ratio); keyboard focus visible on the player.
 * Test first: pressing "l" on a focused player moves the time forward by 10 seconds, and not past the end.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import { useActions } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { VideoPreview } from "../file-viewer/preview/VideoPreview.tsx";

export interface ChatVideoProps {
	workspaceId: WorkspaceId;
	/** The Markdown target: a path in the workspace or a web address. */
	src: string;
	alt: string;
	onOpenExternally: () => void;
}

const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm", "ogv", "avi", "mkv"]);
const REMOTE = /^(?:\/\/|[a-z][a-z0-9+.-]*:)/i;

/** The bare target, without a query string or fragment. */
const bareTarget = (src: string): string => src.split(/[?#]/)[0] ?? "";

function extensionOf(target: string): string {
	const name = target.slice(target.lastIndexOf("/") + 1);
	const dot = name.lastIndexOf(".");
	if (dot <= 0 || dot === name.length - 1) return "";
	return name.slice(dot + 1).toLowerCase();
}

/** True when a Markdown target names a video file. */
export function isVideoSource(src: string): boolean {
	return VIDEO_EXTENSIONS.has(extensionOf(bareTarget(src)));
}

function normalizePath(path: string): string {
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (part.length === 0 || part === ".") continue;
		if (part === "..") {
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	return `/${parts.join("/")}`;
}

/** The absolute path inside the workspace, or null when the target climbs out of it. */
export function videoPathInWorkspace(root: string, src: string): string | null {
	const target = bareTarget(src);
	if (target.length === 0) return null;
	const absolute = target.startsWith("/")
		? normalizePath(target)
		: normalizePath(`${root}/${target}`);
	const base = normalizePath(root);
	if (absolute === base) return null;
	return absolute.startsWith(`${base}/`) ? absolute : null;
}

const fileNameOf = (src: string, alt: string): string => {
	const trimmed = alt.trim();
	if (trimmed.length > 0) return trimmed;
	const name = bareTarget(src).slice(bareTarget(src).lastIndexOf("/") + 1);
	return name.length > 0 ? name : "Video";
};

export function ChatVideo({ workspaceId, src, alt, onOpenExternally }: ChatVideoProps) {
	const { services, platform } = useServices();
	const loaded = useStore(services.workspace.store, (state) => state.loaded);
	const workspace = useStore(
		services.workspace.store,
		(state) => state.workspacesById[workspaceId],
	);
	const actions = useActions();
	const container = useRef<HTMLDivElement>(null);
	const remote = REMOTE.test(src);
	const root = loaded && workspace !== undefined ? workspace.path : null;
	const path = root === null || remote ? null : videoPathInWorkspace(root, src);
	const url = path === null ? null : platform.fs.assetUrl(path);
	const fileName = fileNameOf(src, alt);

	useEffect(() => {
		const host = container.current;
		if (url === null || host === null) return;
		const video = host.querySelector("video");
		if (video === null) return;
		const pauseOthers = (): void => {
			const reply = host.closest("[data-conducted-reply]");
			for (const other of reply?.querySelectorAll("video") ?? []) {
				if (other !== video && !other.paused) other.pause();
			}
		};
		video.addEventListener("play", pauseOthers);
		return () => video.removeEventListener("play", pauseOthers);
	}, [url]);

	const outside = (
		<div className="my-3 flex flex-col gap-2 rounded-lg border border-border bg-surface px-3 py-2">
			<p className="text-sm text-fg-muted">
				{remote
					? "This video is from a web address, so it is not loaded here."
					: "This video is outside the workspace, so it is not loaded."}
			</p>
			<Button variant="secondary" size="sm" onClick={onOpenExternally}>
				Open in another app
			</Button>
		</div>
	);

	if (!loaded) return null;
	if (workspace === undefined) {
		return (
			<div className="my-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg-muted">
				This video is not available.
			</div>
		);
	}
	if (url === null || path === null) return outside;

	const openInAnotherApp = (): void => {
		void actions.attachments.openExternally(path).then((result) => {
			if (!result.ok) toastError("Couldn't open the video", result.error);
		});
	};

	return (
		<div
			ref={container}
			className="my-3 h-64 w-full overflow-hidden rounded-lg border border-border bg-black [&_video]:rounded-md [&_video]:focus-visible:outline-2 [&_video]:focus-visible:outline-offset-2 [&_video]:focus-visible:outline-accent"
		>
			<VideoPreview url={url} fileName={fileName} onOpenExternally={openInAnotherApp} />
		</div>
	);
}
