/**
 * @feature PLAT-33 Platform doors for dropped files, attachments and menu shortcuts
 * Owns: the Tauri attachment door: copying a dropped file into the draft folder and resizing a
 * large image, both through the Rust commands.
 * Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (attachments.rs) and
 * docs/plans/tauri-commands.md (`attachment_materialize`, `image_resize`).
 */

import { describe, expect, it } from "vitest";
import type { MaterializedFile } from "./platform.ts";
import { COMMANDS, createTauriAttachments, type TauriBindings } from "./tauri.ts";

function bindings(invoke: TauriBindings["invoke"]): TauriBindings {
	return { invoke, listen: async () => () => {} };
}

const copied: MaterializedFile = {
	path: "/app-data/draft-attachments/work/1/notes.txt",
	sizeBytes: 12,
	isImage: false,
	width: null,
	height: null,
	resized: false,
};

describe("PLAT-33 Tauri attachments", () => {
	it("PLAT-33 materialize passes the real paths and the resize flag to Rust", async () => {
		const calls: { command: string; args?: Record<string, unknown> }[] = [];
		const attachments = createTauriAttachments(
			bindings(async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
				calls.push({ command, args });
				return copied as T;
			}),
		);

		const result = await attachments.materialize("/Users/me/notes.txt", copied.path, {
			resizeImage: true,
		});

		expect(result).toEqual({ ok: true, value: copied });
		expect(calls).toEqual([
			{
				command: COMMANDS.attachmentMaterialize,
				args: {
					sourcePath: "/Users/me/notes.txt",
					destinationPath: copied.path,
					resizeImage: true,
				},
			},
		]);
	});

	it("PLAT-33 resizeImage calls image_resize with the source and destination", async () => {
		const calls: { command: string; args?: Record<string, unknown> }[] = [];
		const attachments = createTauriAttachments(
			bindings(async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
				calls.push({ command, args });
				return copied as T;
			}),
		);

		await attachments.resizeImage("/Users/me/photo.png", copied.path);

		expect(calls).toEqual([
			{
				command: COMMANDS.imageResize,
				args: { sourcePath: "/Users/me/photo.png", destinationPath: copied.path },
			},
		]);
	});

	it("PLAT-33 returns a refused attachment as an Err instead of throwing", async () => {
		const attachments = createTauriAttachments(
			bindings(async () => {
				throw { code: "attachment_too_large", message: "The image is too large." };
			}),
		);

		const result = await attachments.materialize("/Users/me/big.png", copied.path, {
			resizeImage: true,
		});

		expect(result).toEqual({
			ok: false,
			error: { code: "attachment_too_large", message: "The image is too large." },
		});
	});
});
