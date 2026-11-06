/**
 * @feature CHAT-29 Attachment and image viewer: copy, save, open
 * Tests the service behind the chat image menu and the attachment viewer: reading an image into
 * the clipboard, saving a copy where the user picks, and opening the file in its default app.
 * Test first: copying an image writes the decoded PNG bytes through the clipboard writer.
 */
import { ok } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createTestContainer } from "../../test/container.ts";

describe("CHAT-29 attachment actions", () => {
	it("copies a file as PNG bytes through the clipboard writer", async () => {
		const test = createTestContainer();
		try {
			const encoded = btoa(String.fromCharCode(137, 80, 78, 71));
			const shell = vi
				.spyOn(test.container.platform.shell, "run")
				.mockResolvedValue(ok({ exitCode: 0, stdout: `${encoded}\n`, stderr: "" }));
			let written: Uint8Array | null = null;
			vi.spyOn(test.container.platform.clipboard, "writeImage").mockImplementation(
				async (bytes) => {
					written = bytes;
				},
			);

			const result = await test.container.actions.attachments.copyImage("/tmp/photo.png");

			expect(result.ok).toBe(true);
			expect(shell).toHaveBeenCalledWith(
				expect.objectContaining({
					program: "sh",
					args: expect.arrayContaining(["/tmp/photo.png"]),
				}),
			);
			expect(written).not.toBeNull();
			expect(Array.from(written ?? [])).toEqual([137, 80, 78, 71]);
		} finally {
			test.close();
		}
	});

	it("reports an image the shell cannot read, and writes nothing", async () => {
		const test = createTestContainer();
		try {
			vi.spyOn(test.container.platform.shell, "run").mockResolvedValue(
				ok({ exitCode: 1, stdout: "", stderr: "not an image" }),
			);
			const writeImage = vi.spyOn(test.container.platform.clipboard, "writeImage");

			const result = await test.container.actions.attachments.copyImage("/tmp/notes.txt");

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("image_read_failed");
				expect(result.error.message).toBe("not an image");
			}
			expect(writeImage).not.toHaveBeenCalled();
		} finally {
			test.close();
		}
	});

	it("saves a copy at the dialog's path and hands the path back", async () => {
		const test = createTestContainer();
		try {
			const pick = vi
				.spyOn(test.container.platform.dialogs, "pickSavePath")
				.mockResolvedValue("/tmp/saved.png");
			const shell = vi
				.spyOn(test.container.platform.shell, "run")
				.mockResolvedValue(ok({ exitCode: 0, stdout: "", stderr: "" }));

			const result = await test.container.actions.attachments.saveAs("/tmp/photo.png");

			expect(result).toEqual(ok("/tmp/saved.png"));
			expect(pick).toHaveBeenCalledWith({ title: "Save image", defaultPath: "photo.png" });
			expect(shell).toHaveBeenCalledWith(
				expect.objectContaining({
					program: "cp",
					args: ["-p", "/tmp/photo.png", "/tmp/saved.png"],
				}),
			);
		} finally {
			test.close();
		}
	});

	it("saves nothing when the user cancels the dialog", async () => {
		const test = createTestContainer();
		try {
			vi.spyOn(test.container.platform.dialogs, "pickSavePath").mockResolvedValue(null);
			const shell = vi.spyOn(test.container.platform.shell, "run");

			const result = await test.container.actions.attachments.saveAs("/tmp/photo.png");

			expect(result).toEqual(ok(null));
			expect(shell).not.toHaveBeenCalled();
		} finally {
			test.close();
		}
	});

	it("reports a copy that failed to write", async () => {
		const test = createTestContainer();
		try {
			vi.spyOn(test.container.platform.dialogs, "pickSavePath").mockResolvedValue("/tmp/saved.png");
			vi.spyOn(test.container.platform.shell, "run").mockResolvedValue(
				ok({ exitCode: 1, stdout: "", stderr: "No space left on device" }),
			);

			const result = await test.container.actions.attachments.saveAs("/tmp/photo.png");

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("file_copy_failed");
				expect(result.error.message).toBe("No space left on device");
			}
		} finally {
			test.close();
		}
	});

	it("opens the file in its default app", async () => {
		const test = createTestContainer();
		try {
			const shell = vi
				.spyOn(test.container.platform.shell, "run")
				.mockResolvedValue(ok({ exitCode: 0, stdout: "", stderr: "" }));

			const result = await test.container.actions.attachments.openExternally("/tmp/photo.png");

			expect(result.ok).toBe(true);
			expect(shell).toHaveBeenCalledWith(
				expect.objectContaining({ program: "open", args: ["/tmp/photo.png"] }),
			);
		} finally {
			test.close();
		}
	});
});
