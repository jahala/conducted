/**
 * @feature CHAT-29 Attachment and image viewer: copy, save, open
 * Owns: the tests of the one image and video file rule the chat, the attachment actions and the
 * Feedback dialog share.
 * Test first: "shot.PNG" is an image, "clip.mov?t=2" is a video, and a narrower list refuses "a.svg".
 */
import { describe, expect, it } from "vitest";
import { IMAGE_EXTENSIONS, isImagePath, isVideoPath } from "./media-files.ts";

describe("CHAT-29 media file kinds", () => {
	it("CHAT-29 names an image by its extension, in any case", () => {
		expect(isImagePath("/Users/me/shot.PNG")).toBe(true);
		expect(isImagePath("/Users/me/photo.heic")).toBe(true);
		expect(isImagePath("/Users/me/scan.tiff")).toBe(true);
		expect(isImagePath("/Users/me/notes.txt")).toBe(false);
		expect(isImagePath("/Users/me/png")).toBe(false);
		expect(isImagePath("/Users/me/.png")).toBe(false);
	});

	it("CHAT-29 names a video by its extension, ignoring a query string or fragment", () => {
		expect(isVideoPath("demo/clip.mov?t=2")).toBe(true);
		expect(isVideoPath("demo/clip.webm#start")).toBe(true);
		expect(isVideoPath("demo/clip.png")).toBe(false);
		expect(isImagePath("demo/clip.mov")).toBe(false);
	});

	it("CHAT-29 a narrower list of image kinds refuses the rest", () => {
		expect(isImagePath("/Users/me/logo.svg", ["png", "jpg"])).toBe(false);
		expect(isImagePath("/Users/me/logo.JPG", ["png", "jpg"])).toBe(true);
		expect(IMAGE_EXTENSIONS).toContain("svg");
	});
});
