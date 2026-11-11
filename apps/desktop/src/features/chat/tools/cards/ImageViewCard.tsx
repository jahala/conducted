/**
 * @feature CHAT-20 Image view card
 * Owns: The card for the agent looking at an image file, and the image path reader the image
 * generation card shares.
 * Behaviour: ui-map.md 3.3 ('Preview image', 'Loading image').
 * Must handle: An image still loading ('Loading image'); an image that cannot be shown, such as a
 * file that is gone ('Failed to load image'); a result that names the path instead
 * of the input; a result that is not a path at all ("No image path was given").
 * The preview loads the file through `Platform.fs.assetUrl`. The Rust shell serves files of the
 * registered project and workspace folders and the attachment folder; any other file fails to load
 * and the card says so.
 * Test first: An image_view call renders 'Preview image' with the file name.
 */
import { useState } from "react";
import { useServices } from "../../../../core/context.tsx";
import { IMAGE_EXTENSIONS } from "../../../../core/media-files.ts";
import { asRecord, fileNameOf, ToolCardFrame, textField, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

/** A path-like run ending in an image extension; longer ones first, so "tiff" beats "tif". */
const IMAGE_PATH = new RegExp(
	`[^\\s"'\`]+\\.(?:${[...IMAGE_EXTENSIONS].sort((a, b) => b.length - a.length).join("|")})`,
	"i",
);

/**
 * The image path in a value that may be a bare path, a line of text or a markdown image. A value
 * counts only when it names a file with an image extension, or when its last line is an absolute
 * path. Any other text ("done", an error) is not a path, so null.
 */
export function imagePathOf(value: string | null): string | null {
	if (value === null) return null;
	const trimmed = value.trim();
	if (trimmed === "") return null;
	const found = IMAGE_PATH.exec(trimmed);
	if (found) return found[0];
	const last = trimmed.split(/\r?\n/).at(-1)?.trim() ?? trimmed;
	if (!last.startsWith("/") || /\s/.test(last)) return null;
	return last;
}

export function ImageViewCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const path =
		imagePathOf(textField(input, "path", "file_path", "filePath")) ??
		imagePathOf(call.result?.output ?? null);
	const name = path === null ? null : fileNameOf(path);
	const { platform } = useServices();
	const [failedPath, setFailedPath] = useState<string | null>(null);
	const failed = path !== null && failedPath === path;
	return (
		<ToolCardFrame
			title="Preview image"
			summary={name ?? undefined}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				<div className="flex flex-col gap-2">
					{path !== null && !failed ? (
						<img
							src={platform.fs.assetUrl(path)}
							alt={name ?? "Image"}
							onError={() => setFailedPath(path)}
							className="max-h-80 max-w-full rounded-sm object-contain"
						/>
					) : null}
					{failed ? <p className="text-xs text-danger">Failed to load image</p> : null}
					{path === null ? (
						<p className="text-xs text-fg-subtle">No image path was given.</p>
					) : null}
					{call.result === null ? <p className="text-xs text-fg-subtle">Loading image</p> : null}
				</div>
			}
		/>
	);
}
