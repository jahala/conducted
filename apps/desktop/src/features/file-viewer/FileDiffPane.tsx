/**
 * @feature REV-08 File diff pane
 * @feature REV-11 Resolve conflicts inline: current, incoming or both
 * Owns: the diff mode of the File tab. It loads the file's diff and comments through hooks and
 * hands them to DiffView. When the working file still holds conflict markers it puts the conflict
 * rows above the diff, so each conflict can be resolved without leaving the tab. The rows read the
 * working file, whatever side the diff's scope compares.
 * Behaviour: ui-map.md 3.2 (File tab, diff mode); services-map.md 3.4 (diff sources per scope);
 * inventory-messages-sidecar.md "Merge conflicts in the editor".
 * Data: useFileDiff, useDiffComments, useFileContent (the working file the conflict rows read),
 * useActions().comments and files.resolveConflicts.
 * Children: diff/DiffView, ConflictResolver, FileTabState (loading and error).
 * Must handle: loading, error with retry, an unchanged file in this scope ("No changes in this
 * scope"), the diff reloading while the agent writes (keep the old diff on screen with an
 * "Updating diff" notice, never blank it), a renderer failure (DiffView's own warning), and a
 * conflicted file whose markers the conflict rows resolve.
 * Test first: while a second request is in flight the previous diff stays rendered.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { DiffScope, FileDiff } from "../../core/api.ts";
import { useActions, useDiffComments, useFileContent, useFileDiff } from "../../core/hooks.ts";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { useThemeType } from "../../ui/use-theme-type.ts";
import { DiffView } from "../diff/DiffView.tsx";
import type { CommentHandlers, DiffPreferences } from "../diff/diff-types.ts";
import { ConflictResolver } from "./ConflictResolver.tsx";
import { FileTabState } from "./FileTabState.tsx";

export interface FileDiffPaneProps {
	workspaceId: WorkspaceId;
	path: string;
	scope: DiffScope;
	preferences: DiffPreferences;
}

export function FileDiffPane({ workspaceId, path, scope, preferences }: FileDiffPaneProps) {
	const diff = useFileDiff(workspaceId, path, scope);
	// The conflict rows act on the working file. The diff's new side can be a commit or a
	// checkpoint, so its text is not what a save would change.
	const working = useFileContent(workspaceId, path);
	const workingText =
		working.state === "ready" && working.data.kind === "text" ? working.data.text : "";
	const comments = useDiffComments(workspaceId);
	const actions = useActions();
	const queryClient = useQueryClient();
	const [previous, setPrevious] = useState<FileDiff | null>(null);
	const [forceRender, setForceRender] = useState(false);
	const themeType = useThemeType();

	useEffect(() => {
		if (diff.state === "ready") setPrevious(diff.data);
	}, [diff]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new file or scope starts unforced.
	useEffect(() => {
		setForceRender(false);
	}, [path, scope]);

	const retry = (): void => {
		void queryClient.invalidateQueries({
			queryKey: ["git", "workspace", workspaceId, "file-diff", path],
		});
	};

	if (diff.state === "error") {
		return <FileTabState kind="error" detail={diff.error.message} onAction={retry} />;
	}
	if (diff.state === "loading" && previous === null) {
		return <FileTabState kind="loading" detail={null} onAction={retry} />;
	}

	const shown = diff.state === "ready" ? diff.data : previous;
	if (shown === null) {
		return <FileTabState kind="loading" detail={null} onAction={retry} />;
	}

	const handlers: CommentHandlers | undefined =
		comments.state !== "ready"
			? undefined
			: {
					onAdd: async (target, body, details) => {
						const result = await actions.comments.add(
							workspaceId,
							target.filePath,
							target.line,
							target.endLine,
							body,
							details,
						);
						if (!result.ok) toastError("Couldn't add the comment", result.error);
						return result.ok;
					},
					onEdit: async (id, body, details) => {
						const result = await actions.comments.edit(id, body, details);
						if (!result.ok) toastError("Couldn't edit the comment", result.error);
						return result.ok;
					},
					onDelete: async (id) => {
						const result = await actions.comments.remove(id);
						if (!result.ok) toastError("Couldn't delete the comment", result.error);
						return result.ok;
					},
					onSetResolved: async (id, resolved) => {
						const result = await actions.comments.setResolved(id, resolved);
						if (!result.ok) toastError("Couldn't update the comment", result.error);
						return result.ok;
					},
					onSendToChat: (ids) => {
						void actions.comments.sendToChat(workspaceId, ids);
					},
				};

	const unchanged = !shown.binary && !shown.tooLarge && shown.oldText === shown.newText;
	if (unchanged) {
		return (
			<EmptyState
				title="No changes in this scope"
				body="This file is the same here as in the version you are comparing against."
			/>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden">
			<ConflictResolver workspaceId={workspaceId} path={path} text={workingText} />
			<div className="min-h-0 flex-1 overflow-auto" data-diff>
				<DiffView
					diff={shown}
					preferences={preferences}
					comments={comments.state === "ready" ? comments.data : undefined}
					commentHandlers={handlers}
					forceRender={forceRender}
					onForceRender={() => setForceRender(true)}
					theme={{ name: "", type: themeType }}
					updating={diff.state === "loading" && previous !== null}
				/>
			</div>
		</div>
	);
}
