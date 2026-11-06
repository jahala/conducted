/**
 * @feature CHAT-29 Attachment and image viewer: copy, save, open
 * Tests a chat image's menu (Save image, Copy image, and both failure texts) and the attachment
 * viewer opened from an image or video attachment.
 * Test first: choosing Save image saves a copy and shows "Image saved".
 */
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { ChatTurn } from "../../core/model.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { renderWithRouter } from "../../test/render-with-router.tsx";
import { Toaster, toast } from "../../ui/Toast.tsx";
import { UserMessage } from "./UserMessage.tsx";

const sessionId = "s1" as Parameters<typeof UserMessage>[0]["sessionId"];

function turn(attachmentPaths: string[]): ChatTurn {
	return {
		turnId: "t1" as ChatTurn["turnId"],
		startedBy: "user",
		userMessage: {
			messageId: "m1" as never,
			text: "Look at this",
			attachmentPaths,
			at: 10,
			sender: null,
		},
		steers: [],
		blocks: [],
		startCheckpointId: null,
		endCheckpointId: null,
		changes: [],
		outcome: "success",
		error: null,
		startedAt: 10,
		endedAt: 20,
		usage: null,
		reverted: false,
	};
}

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	toast.dismiss();
	test?.close();
	test = undefined;
});

function renderMessage(attachmentPaths: string[]): TestContainer {
	const opened = createTestContainer();
	test = opened;
	renderWithRouter(
		<ServicesProvider container={opened.container}>
			<UserMessage turn={turn(attachmentPaths)} sessionId={sessionId} />
			<Toaster />
		</ServicesProvider>,
	);
	return opened;
}

describe("CHAT-29 chat image menu", () => {
	it("saves an image through the save dialog and says Image saved", async () => {
		const opened = renderMessage(["/tmp/my shot.png"]);
		const pick = vi
			.spyOn(opened.container.platform.dialogs, "pickSavePath")
			.mockResolvedValue("/tmp/saved.png");
		const shell = vi
			.spyOn(opened.container.platform.shell, "run")
			.mockResolvedValue(ok({ exitCode: 0, stdout: "", stderr: "" }));

		fireEvent.contextMenu(await screen.findByRole("img", { name: "my shot.png" }));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Save image" }));

		expect(await screen.findByText("Image saved")).toBeTruthy();
		expect(pick).toHaveBeenCalledWith({ title: "Save image", defaultPath: "my shot.png" });
		expect(shell).toHaveBeenCalledWith(
			expect.objectContaining({
				program: "cp",
				args: ["-p", "/tmp/my shot.png", "/tmp/saved.png"],
			}),
		);
	});

	it("copies an image and says Copied image to clipboard", async () => {
		const opened = renderMessage(["/tmp/my shot.png"]);
		vi.spyOn(opened.container.platform.shell, "run").mockResolvedValue(
			ok({ exitCode: 0, stdout: btoa("png"), stderr: "" }),
		);
		const writeImage = vi
			.spyOn(opened.container.platform.clipboard, "writeImage")
			.mockResolvedValue(undefined);

		fireEvent.contextMenu(await screen.findByRole("img", { name: "my shot.png" }));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Copy image" }));

		expect(await screen.findByText("Copied image to clipboard")).toBeTruthy();
		expect(writeImage).toHaveBeenCalledTimes(1);
	});

	it("says Failed to save image when the copy fails", async () => {
		const opened = renderMessage(["/tmp/my shot.png"]);
		vi.spyOn(opened.container.platform.dialogs, "pickSavePath").mockResolvedValue("/tmp/saved.png");
		vi.spyOn(opened.container.platform.shell, "run").mockResolvedValue(
			ok({ exitCode: 1, stdout: "", stderr: "No space left on device" }),
		);

		fireEvent.contextMenu(await screen.findByRole("img", { name: "my shot.png" }));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Save image" }));

		expect(await screen.findByText("Failed to save image")).toBeTruthy();
		expect(screen.getByText("No space left on device")).toBeTruthy();
	});

	it("says Failed to copy to clipboard when the image cannot be read", async () => {
		const opened = renderMessage(["/tmp/my shot.png"]);
		vi.spyOn(opened.container.platform.shell, "run").mockResolvedValue(
			ok({ exitCode: 1, stdout: "", stderr: "not an image" }),
		);
		const writeImage = vi.spyOn(opened.container.platform.clipboard, "writeImage");

		fireEvent.contextMenu(await screen.findByRole("img", { name: "my shot.png" }));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Copy image" }));

		expect(await screen.findByText("Failed to copy to clipboard")).toBeTruthy();
		expect(writeImage).not.toHaveBeenCalled();
	});
});

describe("CHAT-29 attachment viewer", () => {
	it("opens an image with Copy image, Download file and Open in default app", async () => {
		renderMessage(["/tmp/my shot.png"]);

		fireEvent.click(await screen.findByRole("button", { name: "Open my shot.png" }));

		expect(await screen.findByRole("heading", { name: "my shot.png" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Copy image" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Download file" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Open in default app" })).toBeTruthy();
	});

	it("opens a video in the viewer with Download file and Open in default app", async () => {
		const opened = renderMessage(["/tmp/clip.mp4"]);
		const shell = vi
			.spyOn(opened.container.platform.shell, "run")
			.mockResolvedValue(ok({ exitCode: 0, stdout: "", stderr: "" }));

		fireEvent.click(await screen.findByRole("button", { name: "Open clip.mp4" }));

		const dialog = await screen.findByRole("dialog");
		expect(dialog.querySelector("video")?.getAttribute("aria-label")).toBe("clip.mp4");
		expect(screen.getByRole("button", { name: "Download file" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Copy image" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Open in default app" }));
		await waitFor(() =>
			expect(shell).toHaveBeenCalledWith(
				expect.objectContaining({ program: "open", args: ["/tmp/clip.mp4"] }),
			),
		);
	});
});
