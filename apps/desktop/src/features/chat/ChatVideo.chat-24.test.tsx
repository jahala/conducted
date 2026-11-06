import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { ChatVideo } from "./ChatVideo.tsx";

const WORKSPACE_PATH = "/code/workspaces/video-demo";

let test: ReturnType<typeof createTestContainer> | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

describe("CHAT-24 video in replies", () => {
	it("moves forward by 10 seconds with l, and not past the end", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container, { path: WORKSPACE_PATH });
		render(
			<ServicesProvider container={test.container}>
				<ChatVideo
					workspaceId={workspace.id}
					src="clip.mp4"
					alt="Clip"
					onOpenExternally={() => {}}
				/>
			</ServicesProvider>,
		);

		const video = screen.getByLabelText("Clip") as HTMLVideoElement;
		Object.defineProperty(video, "duration", { value: 25, configurable: true });
		video.currentTime = 20;
		fireEvent.keyDown(video, { key: "l" });
		expect(video.currentTime).toBe(25);
	});

	it("loads a workspace path through the platform's asset URL", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container, { path: WORKSPACE_PATH });
		render(
			<ServicesProvider container={test.container}>
				<ChatVideo
					workspaceId={workspace.id}
					src="media/clip.mp4"
					alt="Clip"
					onOpenExternally={() => {}}
				/>
			</ServicesProvider>,
		);

		const video = screen.getByLabelText("Clip");
		expect(video.getAttribute("src")).toBe(
			`asset://localhost/${encodeURIComponent(`${WORKSPACE_PATH}/media/clip.mp4`)}`,
		);
	});

	it("does not load a file outside the workspace and offers to open it elsewhere", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container, { path: WORKSPACE_PATH });
		const open = vi.fn();
		render(
			<ServicesProvider container={test.container}>
				<ChatVideo
					workspaceId={workspace.id}
					src="/Users/someone/private/clip.mp4"
					alt="Clip"
					onOpenExternally={open}
				/>
			</ServicesProvider>,
		);

		expect(screen.queryByLabelText("Clip")).toBeNull();
		expect(
			screen.getByText("This video is outside the workspace, so it is not loaded."),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Open in another app" }));
		expect(open).toHaveBeenCalledTimes(1);
	});
});
