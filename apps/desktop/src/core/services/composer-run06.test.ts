/**
 * @feature RUN-06 Attach a terminal selection to the chat
 * Owns: tests for turning a terminal selection into a text attachment.
 * Test first: addText writes the text under a safe file name and adds a draft attachment row.
 */
import { type AttachmentId, appError, err, ok, type SessionId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { Platform } from "../../platform/platform.ts";
import { attachmentFileName } from "../composer-files.ts";
import type { Attachment } from "../model.ts";
import { ComposerService } from "./composer.ts";

const sessionId = "s1" as SessionId;

describe("RUN-06 attach terminal text", () => {
	it("keeps a file name inside the staging folder", () => {
		expect(attachmentFileName("terminal-selection 12:00")).toBe("terminal-selection 12:00.txt");
		expect(attachmentFileName("../../etc/passwd")).toBe("----etc-passwd.txt");
		expect(attachmentFileName("")).toBe("terminal-selection.txt");
	});

	it("writes the selection and adds it as a text attachment", async () => {
		const written: { path: string; text: string }[] = [];
		const added: unknown[] = [];
		const platform = {
			fs: {
				paths: {
					home: "/Users/me",
					appData: "/app",
					temp: "/tmp",
					resources: "/resources",
				},
				mkdirp: async () => ok(undefined),
				exists: async () => false,
				readText: async () => err(appError("fs_not_found", "missing")),
				writeTextAtomic: async (path: string, text: string) => {
					written.push({ path, text });
					return ok(undefined);
				},
			},
			dialogs: {},
			clipboard: {},
		} as unknown as Platform;
		const service = new ComposerService({
			platform,
			repos: {
				attachments: {
					addDraft: async (input: { path: string }) => {
						added.push(input);
						return ok({
							id: "a1" as AttachmentId,
							sessionId,
							kind: "text",
							originalName: "terminal-selection.txt",
							path: input.path,
							isDraft: true,
							commentId: null,
						} satisfies Attachment);
					},
				},
			} as never,
			setDebounce: () => () => {},
		});

		const result = await service.addText(sessionId, "terminal-selection.txt", "hello");
		expect(result.ok).toBe(true);
		expect(written).toEqual([
			{ path: "/app/draft-attachments/s1/terminal-selection.txt", text: "hello" },
		]);
		expect(added[0]).toMatchObject({ sessionId, kind: "text", path: written[0]?.path });
		expect(service.store.getState().drafts[sessionId]).toEqual({
			text: "",
			attachmentPaths: [written[0]?.path],
		});
	});
});
