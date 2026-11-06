/**
 * @feature REV-08 Video preview
 * Tests the error card and the player's keyboard shortcuts.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoPreview } from "./VideoPreview.tsx";

afterEach(cleanup);

describe("REV-08 VideoPreview", () => {
	it("shows the error card with an Open in another app action", () => {
		const onOpenExternally = vi.fn();
		const { container } = render(
			<VideoPreview url="broken.mp4" fileName="clip.mp4" onOpenExternally={onOpenExternally} />,
		);
		const video = container.querySelector("video");
		expect(video).not.toBeNull();
		if (video !== null) fireEvent.error(video);
		fireEvent.click(screen.getByRole("button", { name: "Open in another app" }));
		expect(onOpenExternally).toHaveBeenCalledTimes(1);
		expect(screen.getByText(/Failed to load video/)).toBeTruthy();
	});

	it("jumps back and forward with J and L", () => {
		render(<VideoPreview url="clip.mp4" fileName="clip.mp4" onOpenExternally={() => {}} />);
		const video = screen.getByLabelText("clip.mp4") as HTMLVideoElement;
		Object.defineProperty(video, "duration", { value: 100, configurable: true });
		video.currentTime = 50;
		fireEvent.keyDown(video, { key: "j" });
		expect(video.currentTime).toBe(40);
		fireEvent.keyDown(video, { key: "L" });
		expect(video.currentTime).toBe(50);
	});

	it("mutes with M", () => {
		render(<VideoPreview url="clip.mp4" fileName="clip.mp4" onOpenExternally={() => {}} />);
		const video = screen.getByLabelText("clip.mp4") as HTMLVideoElement;
		fireEvent.keyDown(video, { key: "m" });
		expect(video.muted).toBe(true);
	});
});
