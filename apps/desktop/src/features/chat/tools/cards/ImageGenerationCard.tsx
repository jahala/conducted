/**
 * @feature CHAT-20 Image generation card
 * Owns: The card for an image the agent generated.
 * Behaviour: ui-map.md 3.3 ('Preview image', 'Loading image'); other-runners.md 3 (Codex copies
 * generated images into the workspace).
 * Must handle: Generation still running ('Loading image'); a copy into the workspace that failed
 * (the result text is shown); a finished image with its prompt.
 * Test first: A finished image_generation call shows the image preview.
 */
import { useState } from "react";
import { useServices } from "../../../../core/context.tsx";
import { EyeIcon } from "../../../../ui/icons.tsx";
import {
	asRecord,
	fileNameOf,
	ToolCardFrame,
	ToolOutput,
	textField,
	toolStatus,
} from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";
import { imagePathOf } from "./ImageViewCard.tsx";

export function ImageGenerationCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const prompt = textField(input, "prompt", "revisedPrompt", "revised_prompt", "description");
	const path =
		imagePathOf(call.result?.output ?? null) ??
		imagePathOf(textField(input, "path", "savedPath", "saved_path", "file_path"));
	const name = path === null ? null : fileNameOf(path);
	const status = toolStatus(call);
	const { platform } = useServices();
	const [failedPath, setFailedPath] = useState<string | null>(null);
	const failed = path !== null && failedPath === path;
	const output = call.result?.output.trim() ?? "";
	return (
		<ToolCardFrame
			title={status === "running" ? "Loading image" : "Preview image"}
			summary={prompt ?? name ?? undefined}
			status={status}
			icon={<EyeIcon />}
			expandAll={defaultExpanded}
			body={
				<div className="flex flex-col gap-2">
					{path !== null && !failed ? (
						<img
							src={platform.fs.assetUrl(path)}
							alt={name ?? "Generated image"}
							onError={() => setFailedPath(path)}
							className="max-h-80 max-w-full rounded-sm object-contain"
						/>
					) : null}
					{failed ? <p className="text-xs text-danger">Image could not be loaded: {path}</p> : null}
					{path === null && output.length > 0 ? <ToolOutput muted>{output}</ToolOutput> : null}
					{path === null && output.length === 0 ? (
						<p className="text-xs text-fg-subtle">No generated image was returned.</p>
					) : null}
					{status === "running" ? <p className="text-xs text-fg-subtle">Loading image.</p> : null}
				</div>
			}
		/>
	);
}
