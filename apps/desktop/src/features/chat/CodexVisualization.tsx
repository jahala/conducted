/**
 * @feature CHAT-22 Codex visualizations in the chat
 * Owns: the frame that shows an HTML file Codex wrote as a "visualization", with an "Open" button that puts
 * the file in a tab.
 * Behaviour: coverage/inventory-ui-text.md ("Codex inline visualizations": a sandboxed frame that grows to
 * fit its content; "Open" opens the file in a tab; a path outside the workspace shows "Visualization is
 * outside the workspace:"; a load failure shows "Couldn't load visualization"); ui-map.md 3.3 (chat items).
 * Data: the file text comes from useFileContent (core/hooks.ts); the workspace root from useWorkspace.
 * Must handle: a path outside the workspace root, after resolving "..", symlinks and a leading "~" (the
 * notice shows the path and nothing is loaded); a file that is missing or still being written (the
 * "Couldn't load visualization" state with a retry on change); a page that runs scripts (it runs in a
 * frame with the sandbox attribute and no same-origin access, no network access to the app, and no
 * navigation of the parent window); a page whose height changes after load (the frame follows, up to a
 * maximum height, then scrolls inside); a very large file (shown as a file card with "Open" only); dark and
 * light theme (the frame does not inherit app styles); the file changing on disk (reloads).
 * Our design choice: the frame is isolated from the app by an opaque origin, so a visualization can never
 * read the app's storage or call Tauri commands.
 * Test first: a path outside the workspace root renders "Visualization is outside the workspace:" with the
 * path and loads no frame.
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface CodexVisualizationProps {
	workspaceId: WorkspaceId;
	/** The file path Codex reported. Absolute, or relative to the workspace root. */
	path: string;
	/** Opens the file in a tab of the workspace. */
	onOpen: (path: string) => void;
}

export function CodexVisualization(_props: CodexVisualizationProps): never {
	return notImplemented("CHAT-22");
}
