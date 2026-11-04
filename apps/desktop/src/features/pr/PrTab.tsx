/**
 * @feature PR-07 PrTab
 * Owns: A center tab for the workspace's pull request: title, description, activity, checks, merge.
 * Behaviour: ui-map.md 3.2
 * Entry point embedded by another part of the app. Keep the name and props stable.
 */

import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export function PrTab(_props: { workspaceId: WorkspaceId }): never {
	return notImplemented("PR-07");
}
