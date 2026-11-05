/**
 * @feature CHAT-20 Image view card
 * Owns: The card for the agent looking at an image file, and the image path reader the image
 * generation card shares.
 * Behaviour: ui-map.md 3.3 ('Preview image', 'Loading image').
 * Must handle: An image still loading; a path outside the workspace or a file that is gone (the
 * name and a clear message stay, the preview does not); a result that names the path instead of
 * the input.
 * Test first: An image_view call renders 'Preview image' with the file name.
 */
import { useState } from "react";
import { EyeIcon } from "../../../../ui/icons.tsx";
import { asRecord, ToolCardFrame, textField, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

const IMAGE_PATH = /[^\s"'`]+\.(?:png|jpe?g|gif|webp|avif|svg)/i;

export function fileNameOf(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts.at(-1) ?? path;
}

/** The image path in a value that may be a bare path, a line of text or a markdown image. */
export function imagePathOf(value: string | null): string | null {
	if (value === null) return null;
	const trimmed = value.trim();
	if (trimmed === "") return null;
	const found = IMAGE_PATH.exec(trimmed);
	if (found) return found[0];
	const last = trimmed.split(/\r?\n/).at(-1)?.trim() ?? trimmed;
	if (last === "" || /\s/.test(last)) return null;
	return last;
}

export function ImageViewCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const path =
		imagePathOf(textField(input, "path", "file_path", "filePath")) ??
		imagePathOf(call.result?.output ?? null);
	const name = path === null ? null : fileNameOf(path);
	const [failedPath, setFailedPath] = useState<string | null>(null);
	const failed = path !== null && failedPath === path;
	return (
		<ToolCardFrame
			title="Preview image"
			summary={name ?? undefined}
			status={toolStatus(call)}
			icon={<EyeIcon />}
			expandAll={defaultExpanded}
			body={
				<div className="flex flex-col gap-2">
					{path !== null && !failed ? (
						<img
							src={path}
							alt={name ?? "Image"}
							onError={() => setFailedPath(path)}
							className="max-h-80 max-w-full rounded-sm object-contain"
						/>
					) : null}
					{failed ? <p className="text-xs text-danger">Image could not be loaded: {path}</p> : null}
					{path === null ? (
						<p className="text-xs text-fg-subtle">No image path was given.</p>
					) : null}
					{call.result === null ? <p className="text-xs text-fg-subtle">Loading image.</p> : null}
				</div>
			}
		/>
	);
}
