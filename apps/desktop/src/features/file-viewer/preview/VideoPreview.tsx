/**
 * @feature REV-08 Video preview
 * Owns: playing a video file in the File tab with native controls.
 * Behaviour: ui-map.md 3.2 (previews include video; error text "Failed to load video"), 5.4
 * (Space or K play and pause; J and L jump 10 seconds; comma and period step a frame; less-than
 * and greater-than change speed; M mutes and F goes fullscreen).
 * Must handle: a codec the webview cannot play (error card with "Open in another app"), no
 * autoplay, and a file that is still being written.
 * Test first: a load error shows the error card with an Open in another app action.
 */
import { type KeyboardEvent, useRef, useState } from "react";
import { PreviewUnavailable } from "./PreviewUnavailable.tsx";

export interface VideoPreviewProps {
	url: string;
	fileName: string;
	onOpenExternally: () => void;
}

const SPEEDS = [0.25, 0.5, 1, 1.25, 1.5, 2, 3, 4];
const FRAME_SECONDS = 1 / 30;

export function VideoPreview({ url, fileName, onOpenExternally }: VideoPreviewProps) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const [failed, setFailed] = useState(false);
	const [playFailed, setPlayFailed] = useState(false);

	if (failed) {
		return (
			<PreviewUnavailable
				fileName={fileName}
				sizeBytes={null}
				reason="Failed to load video."
				onOpenExternally={onOpenExternally}
			/>
		);
	}

	const changeSpeed = (direction: -1 | 1): void => {
		const video = videoRef.current;
		if (video === null) return;
		const index = SPEEDS.indexOf(video.playbackRate);
		const next = SPEEDS[Math.min(Math.max(index + direction, 0), SPEEDS.length - 1)];
		if (next !== undefined) video.playbackRate = next;
	};

	const onKeyDown = (event: KeyboardEvent<HTMLVideoElement>): void => {
		const video = videoRef.current;
		if (video === null || event.metaKey || event.ctrlKey || event.altKey) return;
		switch (event.key) {
			case " ":
			case "k":
			case "K":
				event.preventDefault();
				if (video.paused) {
					void video.play().then(
						() => setPlayFailed(false),
						() => setPlayFailed(true),
					);
				} else {
					video.pause();
				}
				return;
			case "j":
			case "J":
				event.preventDefault();
				video.currentTime = Math.max(0, video.currentTime - 10);
				return;
			case "l":
			case "L":
				event.preventDefault();
				video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
				return;
			case "ArrowLeft":
			case ",":
				event.preventDefault();
				video.currentTime = Math.max(0, video.currentTime - FRAME_SECONDS);
				return;
			case "ArrowRight":
			case ".":
				event.preventDefault();
				video.currentTime = Math.min(video.duration || Infinity, video.currentTime + FRAME_SECONDS);
				return;
			case "<":
				event.preventDefault();
				changeSpeed(-1);
				return;
			case ">":
				event.preventDefault();
				changeSpeed(1);
				return;
			case "m":
			case "M":
				event.preventDefault();
				video.muted = !video.muted;
				return;
			case "f":
			case "F":
				event.preventDefault();
				if (document.fullscreenElement === null) void video.requestFullscreen?.();
				else void document.exitFullscreen?.();
				return;
		}
	};

	return (
		<div className="flex h-full items-center justify-center bg-black p-3">
			<video
				ref={videoRef}
				src={url}
				controls
				preload="metadata"
				aria-label={fileName}
				className="max-h-full max-w-full"
				onError={() => setFailed(true)}
				onKeyDown={onKeyDown}
			>
				<track kind="captions" />
			</video>
			{playFailed ? (
				<p role="alert" className="absolute bottom-4 text-xs text-white">
					The video could not play. Open it in another app.
				</p>
			) : null}
		</div>
	);
}
