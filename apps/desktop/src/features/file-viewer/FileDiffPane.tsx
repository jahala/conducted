/**
 * @feature REV-08 File diff pane
 * Owns: the diff mode of the File tab. It loads the file's diff and comments through hooks and
 * hands them to DiffView.
 * Behaviour: ui-map.md 3.2 (File tab, diff mode); services-map.md 3.4 (diff sources per scope).
 * Data: useFileDiff, useDiffComments, useActions().comments.
 * Children: diff/DiffView, FileTabState (loading and error).
 * Must handle: loading, error with retry, an unchanged file in this scope ("No changes in this
 * scope"), the diff reloading while the agent writes (keep the old diff on screen with an
 * "Updating diff" notice, never blank it), and a renderer failure (DiffView's own warning).
 * Test first: while a second request is in flight the previous diff stays rendered.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { DiffScope, FileDiff } from "../../core/api.ts";
import { useActions, useDiffComments, useFileDiff } from "../../core/hooks.ts";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { DiffView } from "../diff/DiffView.tsx";
import type { CommentHandlers, DiffPreferences, DiffTheme } from "../diff/diff-types.ts";
import { FileTabState } from "./FileTabState.tsx";

export interface FileDiffPaneProps {
	workspaceId: WorkspaceId;
	path: string;
	scope: DiffScope;
	preferences: DiffPreferences;
}

function currentTheme(): DiffTheme {
	const explicit = document.documentElement.dataset.theme;
	const type =
		explicit === "dark" || explicit === "light"
			? explicit
			: window.matchMedia?.("(prefers-color-scheme: dark)").matches === true
				? "dark"
				: "light";
	return { name: "", type };
}

export function FileDiffPane({ workspaceId, path, scope, preferences }: FileDiffPaneProps) {
	const diff = useFileDiff(workspaceId, path, scope);
	const comments = useDiffComments(workspaceId);
	const actions = useActions();
	const queryClient = useQueryClient();
	const [previous, setPrevious] = useState<FileDiff | null>(null);
	const [forceRender, setForceRender] = useState(false);

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
					onAdd: async (target, body) => {
						const result = await actions.comments.add(
							workspaceId,
							target.filePath,
							target.line,
							target.endLine,
							body,
						);
						if (!result.ok) toastError("Couldn't add the comment", result.error);
						return result.ok;
					},
					onEdit: async (id, body) => {
						const result = await actions.comments.edit(id, body);
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
		<div className="h-full overflow-auto" data-diff>
			<DiffView
				diff={shown}
				preferences={preferences}
				comments={comments.state === "ready" ? comments.data : undefined}
				commentHandlers={handlers}
				forceRender={forceRender}
				onForceRender={() => setForceRender(true)}
				theme={currentTheme()}
				updating={diff.state === "loading" && previous !== null}
			/>
		</div>
	);
}
