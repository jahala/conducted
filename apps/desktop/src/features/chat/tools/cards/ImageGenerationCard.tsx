/**
 * @feature CHAT-20 Image generation card
 * Owns: The card for an image the agent generated.
 * Behaviour: ui-map.md 3.3 ('Preview image', 'Loading image'); other-runners.md 3 (Codex copies generated images into the workspace).
 * Must handle: Generation still running ('Loading image'); a copy into the workspace that failed.
 * Test first: A finished image_generation call shows the image preview.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function ImageGenerationCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-20");
}
