/**
 * @feature CHAT-20 Image view card
 * Owns: The card for the agent looking at an image file.
 * Behaviour: ui-map.md 3.3 ('Preview image', 'Loading image').
 * Must handle: An image still loading; a path outside the workspace; a file that is gone.
 * Test first: An image_view call renders 'Preview image' with the file name.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function ImageViewCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-20");
}
