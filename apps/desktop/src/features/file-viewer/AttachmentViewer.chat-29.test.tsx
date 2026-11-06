/**
 * @feature CHAT-29 Attachment and image viewer: copy, save, open
 * Tests the viewer's own buttons for an image and a video, over the real container.
 * Test first: Download file saves a copy and shows "Image saved".
 */
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { Toaster, toast } from "../../ui/Toast.tsx";
import { AttachmentViewer } from "./AttachmentViewer.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	toast.dismiss();
	test?.close();
	test = undefined;
});

function renderViewer(kind: "image" | "video", path = "/tmp/photo.png"): TestContainer {
	const opened = createTestContainer();
	test = opened;
	render(
		<ServicesProvider container={opened.container}>
			<AttachmentViewer path={path} fileName="photo.png" kind={kind} onClose={() => {}} />
			<Toaster />
		</ServicesProvider>,
	);
	return opened;
}

describe("CHAT-29 AttachmentViewer", () => {
	it("copies the image with Copy image", async () => {
		const opened = renderViewer("image");
		vi.spyOn(opened.container.platform.shell, "run").mockResolvedValue(
			ok({ exitCode: 0, stdout: btoa("png"), stderr: "" }),
		);
		const writeImage = vi
			.spyOn(opened.container.platform.clipboard, "writeImage")
			.mockResolvedValue(undefined);

		fireEvent.click(screen.getByRole("button", { name: "Copy image" }));

		expect(await screen.findByText("Copied image to clipboard")).toBeTruthy();
		expect(writeImage).toHaveBeenCalledTimes(1);
	});

	it("saves the image with Download file", async () => {
		const opened = renderViewer("image");
		vi.spyOn(opened.container.platform.dialogs, "pickSavePath").mockResolvedValue("/tmp/saved.png");
		vi.spyOn(opened.container.platform.shell, "run").mockResolvedValue(
			ok({ exitCode: 0, stdout: "", stderr: "" }),
		);

		fireEvent.click(screen.getByRole("button", { name: "Download file" }));

		expect(await screen.findByText("Image saved")).toBeTruthy();
	});

	it("opens the image in its default app", async () => {
		const opened = renderViewer("image");
		const shell = vi
			.spyOn(opened.container.platform.shell, "run")
			.mockResolvedValue(ok({ exitCode: 0, stdout: "", stderr: "" }));

		fireEvent.click(screen.getByRole("button", { name: "Open in default app" }));

		expect(shell).toHaveBeenCalledWith(
			expect.objectContaining({ program: "open", args: ["/tmp/photo.png"] }),
		);
	});

	it("has no Copy image for a video and saves it as a file", async () => {
		const opened = renderViewer("video", "/tmp/clip.mp4");
		expect(screen.queryByRole("button", { name: "Copy image" })).toBeNull();
		vi.spyOn(opened.container.platform.dialogs, "pickSavePath").mockResolvedValue(
			"/tmp/clip-copy.mp4",
		);
		vi.spyOn(opened.container.platform.shell, "run").mockResolvedValue(
			ok({ exitCode: 0, stdout: "", stderr: "" }),
		);

		fireEvent.click(screen.getByRole("button", { name: "Download file" }));

		expect(await screen.findByText("File saved")).toBeTruthy();
	});
});
