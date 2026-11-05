/**
 * @feature CHAT-06 Open a file or pull request from the chat
 * Owns: the one place that turns "open this file" or "open this pull request" into the workspace URL state.
 * Behaviour: ui-map.md 3.2 (tabs are URL state); features/workspace/workspace-search.ts (`tab`, `path`,
 * `fileMode`, `pr`, `gitTab`, `scope`).
 * Must handle: a file opens in the mode asked for; a pull request with a number opens that pull request; a diff
 * scope opens in the Git panel's Changes tab; the rest of the URL state (chat) is kept.
 * Test first: opening a pull request with number 12 sets `tab=pr` and `pr=12`.
 */
import { useNavigate } from "@tanstack/react-router";
import type { DiffScope } from "../../core/api.ts";
import { formatDiffScope } from "../workspace/workspace-search.ts";

export interface WorkspaceLinks {
	openFile(path: string, mode: "diff" | "edit"): void;
	/** Opens the PR tab on pull request `number`. */
	openPullRequest(number: number): void;
	/** Shows the Git panel's Changes tab for a diff scope, for example one turn. */
	openDiffScope(scope: DiffScope): void;
}

export function useWorkspaceLinks(): WorkspaceLinks {
	const navigate = useNavigate();
	return {
		openFile(path, mode) {
			void navigate({
				search: ((previous: Record<string, unknown>) => ({
					...previous,
					tab: "file",
					path,
					fileMode: mode,
				})) as never,
			});
		},
		openDiffScope(scope) {
			void navigate({
				search: ((previous: Record<string, unknown>) => ({
					...previous,
					gitTab: "changes",
					scope: formatDiffScope(scope),
				})) as never,
			});
		},
		openPullRequest(number) {
			void navigate({
				search: ((previous: Record<string, unknown>) => ({
					...previous,
					tab: "pr",
					pr: number,
				})) as never,
			});
		},
	};
}
