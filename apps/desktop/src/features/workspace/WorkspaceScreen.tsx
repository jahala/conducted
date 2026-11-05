/**
 * @feature NAV-10 Workspace screen
 * Owns: assembling the workspace route: header, tab strip, tab content, Git panel and Scripts panel inside the
 * workspace layout, and passing the URL search state down.
 * Behaviour: ui-map.md 3 (the workspace screen), 3.1 (header), 3.2 (tab strip and content), 3.6 (right panel
 * top), 3.7 (right panel bottom).
 * Our design choice: every region is its own <NotBuiltYet>, keyed by the workspace id, so a failing region
 * never takes down the others and a new workspace gets a fresh try. The centre is SplitPanes, which renders
 * the tab strip and content as one group, or two when Split tabs is on. Data comes from hooks inside each
 * region, not from this component.
 * Must handle: switching workspaces (all regions reset); the right panel closed (header shows the toggle, see
 * WorkspaceHeader); archived workspace (the gate shows the notice, panels explain themselves); search state
 * is the URL's, changes go through onSearchChange.
 * Test first: renders the header, tab strip, content, Git panel and Scripts panel regions for a workspace id.
 */
import type { RepoId, WorkspaceId } from "@conducted/shared";
import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { GitPanel } from "../git-panel/GitPanel.tsx";
import { ScriptsPanel } from "../scripts-panel/ScriptsPanel.tsx";
import { SplitPanes } from "./SplitPanes.tsx";
import { WorkspaceGate } from "./WorkspaceGate.tsx";
import { WorkspaceHeader } from "./WorkspaceHeader.tsx";
import { WorkspaceLayout } from "./WorkspaceLayout.tsx";
import type { WorkspaceSearch } from "./workspace-search.ts";

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
	return (
		<WorkspaceLayout
			workspaceId={workspaceId}
			header={(controls) => (
				<NotBuiltYet area="Workspace header" variant="inline" resetKey={workspaceId}>
					<WorkspaceHeader repoId={repoId} workspaceId={workspaceId} controls={controls} />
				</NotBuiltYet>
			)}
			tabStrip={null}
			content={
				<NotBuiltYet area="Workspace" resetKey={workspaceId}>
					<WorkspaceGate workspaceId={workspaceId}>
						<SplitPanes workspaceId={workspaceId} search={search} onSearchChange={onSearchChange} />
					</WorkspaceGate>
				</NotBuiltYet>
			}
			gitPanel={
				<NotBuiltYet area="Git panel" resetKey={workspaceId}>
					<GitPanel workspaceId={workspaceId} />
				</NotBuiltYet>
			}
			scriptsPanel={
				<NotBuiltYet area="Scripts" resetKey={workspaceId}>
					<ScriptsPanel workspaceId={workspaceId} />
				</NotBuiltYet>
			}
		/>
	);
}
