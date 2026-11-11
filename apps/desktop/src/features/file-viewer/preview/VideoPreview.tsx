/**
 * @feature REV-08 Video preview
 * Owns: playing a video file in the File tab with Conductor's own controls.
 * Behaviour: ui-map.md 3.2 (previews include video; error text "Failed to load video"), 5.4
 * (Space or K play and pause; J and L jump 10 seconds; comma and period step a frame; less-than
 * and greater-than change speed; M mutes and F goes fullscreen). The control bar is Conductor's:
 * a Seek slider, play and pause, back and forward 10 seconds, previous and next frame, playback
 * speed, volume, mute and fullscreen, each with the title Conductor's command registry gives it
 * (main @3801366 to @3802657).
 * Must handle: a codec the webview cannot play (error card with Retry, and "Open in another app"
 * when the caller passes a handler; the file viewer does), no autoplay, and the
 * file changing on disk (the URL carries the modified time, so the player loads again and an
 * earlier failure clears).
 * Test first: a load error shows the error card with an Open in another app action.
 */
import { type KeyboardEvent, useRef, useState } from "react";
import { PreviewUnavailable } from "./PreviewUnavailable.tsx";

export interface VideoPreviewProps {
	url: string;
	fileName: string;
	/** Opens the file in its own app. Without it the error card offers no such button. */
	onOpenExternally?: () => void;
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const FRAME_SECONDS = 1 / 30;

/** Seconds as "m:ss". */
function clock(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
	const whole = Math.floor(seconds);
	const minutes = Math.floor(whole / 60);
	return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

export function VideoPreview({ url, fileName, onOpenExternally }: VideoPreviewProps) {
	const videoRef = useRef<HTMLVideoElement>(null);
	// The failure belongs to one URL and one attempt: a new URL or Retry loads the video again.
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [playFailed, setPlayFailed] = useState(false);
	const [playing, setPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [volume, setVolume] = useState(1);
	const [muted, setMuted] = useState(false);
	const [rate, setRate] = useState(1);

	if (failedUrl === url) {
		return (
			<PreviewUnavailable
				fileName={fileName}
				sizeBytes={null}
				reason="Failed to load video"
				onRetry={() => {
					setFailedUrl(null);
					setAttempt((value) => value + 1);
				}}
				onOpenExternally={onOpenExternally}
			/>
		);
	}

	const togglePlay = (): void => {
		const video = videoRef.current;
		if (video === null) return;
		if (video.paused) {
			void video.play().then(
				() => setPlayFailed(false),
				() => setPlayFailed(true),
			);
		} else {
			video.pause();
		}
	};

	const seekTo = (seconds: number): void => {
		const video = videoRef.current;
		if (video === null) return;
		const next = Math.min(Math.max(seconds, 0), video.duration || Infinity);
		video.currentTime = next;
		setCurrentTime(next);
	};

	const changeSpeed = (direction: -1 | 1): void => {
		const video = videoRef.current;
		if (video === null) return;
		const index = SPEEDS.indexOf(video.playbackRate);
		const next = SPEEDS[Math.min(Math.max(index + direction, 0), SPEEDS.length - 1)];
		if (next !== undefined) {
			video.playbackRate = next;
			setRate(next);
		}
	};

	const toggleMute = (): void => {
		const video = videoRef.current;
		if (video === null) return;
		video.muted = !video.muted;
		setMuted(video.muted);
	};

	const changeVolume = (next: number): void => {
		const video = videoRef.current;
		if (video === null) return;
		video.volume = next;
		setVolume(next);
	};

	const toggleFullscreen = (): void => {
		const video = videoRef.current;
		if (video === null) return;
		if (document.fullscreenElement === null) void video.requestFullscreen?.();
		else void document.exitFullscreen?.();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLVideoElement>): void => {
		const video = videoRef.current;
		if (video === null || event.metaKey || event.ctrlKey || event.altKey) return;
		switch (event.key) {
			case " ":
			case "k":
			case "K":
				event.preventDefault();
				togglePlay();
				return;
			case "j":
			case "J":
				event.preventDefault();
				seekTo(video.currentTime - 10);
				return;
			case "l":
			case "L":
				event.preventDefault();
				seekTo(video.currentTime + 10);
				return;
			case "ArrowLeft":
			case ",":
				event.preventDefault();
				seekTo(video.currentTime - FRAME_SECONDS);
				return;
			case "ArrowRight":
			case ".":
				event.preventDefault();
				seekTo(video.currentTime + FRAME_SECONDS);
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
				toggleMute();
				return;
			case "f":
			case "F":
				event.preventDefault();
				toggleFullscreen();
				return;
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col items-center justify-center bg-media p-3">
			<section
				aria-label="Video player"
				className="flex max-h-full max-w-full flex-col overflow-hidden rounded-md"
			>
				<video
					key={attempt}
					ref={videoRef}
					src={url}
					preload="metadata"
					aria-label={fileName}
					className="max-h-full max-w-full"
					onError={() => setFailedUrl(url)}
					onKeyDown={onKeyDown}
					onPlay={() => setPlaying(true)}
					onPause={() => setPlaying(false)}
					onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
					onDurationChange={(event) => setDuration(event.currentTarget.duration)}
					onVolumeChange={(event) => {
						setVolume(event.currentTarget.volume);
						setMuted(event.currentTarget.muted);
					}}
				>
					<track kind="captions" />
				</video>
				<div className="flex items-center gap-2 bg-black/60 px-2 py-1 text-xs text-white">
					<input
						type="range"
						min={0}
						max={Math.max(duration, 0)}
						step="any"
						value={currentTime}
						aria-label="Seek"
						onChange={(event) => seekTo(Number(event.target.value))}
						className="min-w-24 flex-1"
					/>
					<span className="tabular-nums">
						{clock(currentTime)} / {clock(duration)}
					</span>
					<button type="button" title="Play or pause" onClick={togglePlay}>
						{playing ? "Pause" : "Play"}
					</button>
					<button type="button" title="Back 10 seconds" onClick={() => seekTo(currentTime - 10)}>
						-10s
					</button>
					<button type="button" title="Forward 10 seconds" onClick={() => seekTo(currentTime + 10)}>
						+10s
					</button>
					<button
						type="button"
						title="Previous frame"
						onClick={() => seekTo(currentTime - FRAME_SECONDS)}
					>
						Prev
					</button>
					<button
						type="button"
						title="Next frame"
						onClick={() => seekTo(currentTime + FRAME_SECONDS)}
					>
						Next
					</button>
					<button type="button" title="Decrease playback speed" onClick={() => changeSpeed(-1)}>
						-
					</button>
					<select
						aria-label="Playback speed"
						value={rate}
						onChange={(event) => {
							const next = Number(event.target.value);
							if (videoRef.current !== null) videoRef.current.playbackRate = next;
							setRate(next);
						}}
					>
						{SPEEDS.map((speed) => (
							<option key={speed} value={speed}>
								{speed}x
							</option>
						))}
					</select>
					<button type="button" title="Increase playback speed" onClick={() => changeSpeed(1)}>
						+
					</button>
					<input
						type="range"
						min={0}
						max={1}
						step={0.05}
						value={volume}
						aria-label="Volume"
						onChange={(event) => changeVolume(Number(event.target.value))}
						className="w-16"
					/>
					<button type="button" title="Mute or unmute" onClick={toggleMute}>
						{muted ? "Unmute" : "Mute"}
					</button>
					<button type="button" title="Toggle fullscreen" onClick={toggleFullscreen}>
						Fullscreen
					</button>
				</div>
				{playFailed ? (
					<p role="alert" className="px-2 py-1 text-xs text-white">
						The video could not play.
					</p>
				) : null}
			</section>
		</div>
	);
}
