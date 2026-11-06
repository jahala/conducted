/**
 * @feature NAV-10 Workspace screen
 * Owns: assembling the workspace route: header, centre content, Git panel and Scripts panel inside the
 * workspace layout, and passing the URL search state down. It also opens PR-10's "Link pull request"
 * dialog from the `pr.link` command while a workspace is open.
 * Behaviour: ui-map.md 3 (the workspace screen), 3.1 (header), 3.2 (tab strip and content), 3.6 (right panel
 * top), 3.7 (right panel bottom).
 * Our design choice: every region is its own <NotBuiltYet>, keyed by the workspace id, so a failing region
 * never takes down the others and a new workspace gets a fresh try. The centre is SplitPanes, which renders
 * the tab strip and content as one group, or two when Split tabs is on. Data comes from hooks inside each
 * region, not from this component.
 * Must handle: switching workspaces (all regions reset); the right panel closed (header shows the toggle, see
 * WorkspaceHeader); archived workspace (the gate shows the notice, panels explain themselves); search state
 * is the URL's, changes go through onSearchChange; the Git panel's tab and diff scope follow the URL's `gitTab`
 * and `scope`, so a chat's "Open diff" shows its turn in the Changes tab; a file opened from the Git panel
 * (All files or Changes) becomes the URL's file tab (`tab=file`, `path`, `fileMode`).
 * Test first: renders the header, centre content, Git panel and Scripts panel regions for a workspace id.
 */
import type { RepoId, WorkspaceId } from "@conducted/shared";
import { useEffect, useState } from "react";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useServices } from "../../core/context.tsx";
import { useActions } from "../../core/hooks.ts";
import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { GitPanel } from "../git-panel/GitPanel.tsx";
import { LinkPullRequestDialog } from "../pr/LinkPullRequestDialog.tsx";
import { ScriptsPanel } from "../scripts-panel/ScriptsPanel.tsx";
import { SplitPanes } from "./SplitPanes.tsx";
import { WorkspaceGate } from "./WorkspaceGate.tsx";
import { WorkspaceHeader } from "./WorkspaceHeader.tsx";
import { WorkspaceLayout } from "./WorkspaceLayout.tsx";
import { formatDiffScope, parseDiffScope, type WorkspaceSearch } from "./workspace-search.ts";

export interface WorkspaceScreenProps {
	repoId: RepoId;
	workspaceId: WorkspaceId;
	search: WorkspaceSearch;
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void;
}

export function WorkspaceScreen({
	repoId,
	workspaceId,
	search,
	onSearchChange,
}: WorkspaceScreenProps) {
	const workspaceFiles = useServices().services.workspaceFiles;
	const actions = useActions();
	const [linkingPullRequest, setLinkingPullRequest] = useState(false);
	useCommandHandler("pr.link", "area", () => {
		setLinkingPullRequest(true);
	});
	useEffect(
		() =>
			workspaceFiles.onOpen((request) => {
				if (request.workspaceId !== workspaceId) return;
				onSearchChange({
					tab: "file",
					path: request.path,
					fileMode: request.mode,
					scope: formatDiffScope(request.scope),
				});
			}),
		[workspaceFiles, workspaceId, onSearchChange],
	);
	// The Git panel's tab and diff scope are URL state, so "Open diff" under a turn can show a turn.
	const gitScope =
		search.scope === undefined ? undefined : (parseDiffScope(search.scope) ?? undefined);
	return (
		<>
			<WorkspaceLayout
				workspaceId={workspaceId}
				header={(controls) => (
					<NotBuiltYet area="Workspace header" variant="inline" resetKey={workspaceId}>
						<WorkspaceHeader repoId={repoId} workspaceId={workspaceId} controls={controls} />
					</NotBuiltYet>
				)}
				content={
					<NotBuiltYet area="Workspace" resetKey={workspaceId}>
						<WorkspaceGate workspaceId={workspaceId}>
							<SplitPanes
								workspaceId={workspaceId}
								search={search}
								onSearchChange={onSearchChange}
							/>
						</WorkspaceGate>
					</NotBuiltYet>
				}
				gitPanel={
					<NotBuiltYet area="Git panel" resetKey={workspaceId}>
						<GitPanel
							workspaceId={workspaceId}
							tab={search.gitTab}
							onTabChange={(gitTab) => onSearchChange({ gitTab })}
							scope={gitScope}
							onScopeChange={(scope) => onSearchChange({ scope: formatDiffScope(scope) })}
							onOpenFile={(path, fileMode) => onSearchChange({ tab: "file", path, fileMode })}
						/>
					</NotBuiltYet>
				}
				scriptsPanel={
					<NotBuiltYet area="Scripts" resetKey={workspaceId}>
						<ScriptsPanel workspaceId={workspaceId} />
					</NotBuiltYet>
				}
			/>
			<LinkPullRequestDialog
				open={linkingPullRequest}
				onOpenChange={setLinkingPullRequest}
				onSubmit={(urlOrNumber) => actions.pullRequests.link(workspaceId, urlOrNumber)}
			/>
		</>
	);
}
