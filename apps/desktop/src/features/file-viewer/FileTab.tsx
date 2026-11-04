/**
 * @feature REV-08 FileTab
 * Owns: A center tab showing one file: its diff, or an editor, or a preview.
 * Behaviour: ui-map.md 3.2
 * Entry point embedded by another part of the app. Keep the name and props stable.
 */

import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { DiffScope } from "../../core/api.ts";

export function FileTab(_props: {
	workspaceId: WorkspaceId;
	path: string;
	mode: "diff" | "edit";
	scope: DiffScope;
}): never {
	return notImplemented("REV-08");
}
