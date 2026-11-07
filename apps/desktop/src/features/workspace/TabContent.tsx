/**
 * @feature NAV-10 Tab content
 * Owns: showing the content of the open tab: chat, terminal, file, review comment, pull request or browser
 * preview, each from its own feature.
 * Behaviour: ui-map.md 3.2 (tab content by type; empty group shows New chat, Browser, Local terminal; error
 * cards "This chat tab failed to render").
 * Our design choice: each tab is mounted under its own identity and sits in its own boundary, so a
 * crash in one tab clears when the user opens another and no state carries from one chat to the next.
 * A terminal tab renders only an empty slot: the app shell's surface layer draws the terminal over it and
 * keeps it mounted while another tab is open (NAV-15, app/surface-registry.tsx, ui-map.md 8). A browser
 * tab is RUN-04's own view, with its toolbar and designed states.
 * An archived workspace keeps its chat, comment and pull request tabs; a file, terminal or browser tab shows
 * the archived notice instead, because those are gone until it is restored (renderApp @10062129).
 * Must handle: no tab open (EmptyTabGroup); a file tab without a path (treated as no tab, see active-tab.ts);
 * a terminal that has exited; a browser tab with an unreachable URL (BrowserTab's own state).
 * Test first: search { tab: "pr" } renders the PR tab area; {} renders the empty tab group.
 */
import type { WorkspaceId } from "@conducted/shared";
import { TerminalTabSlot } from "../../app/surface-registry.tsx";
import { useWorkspace } from "../../core/hooks.ts";
import { ErrorBoundary } from "../../ui/ErrorBoundary.tsx";
import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { BrowserTab } from "../browser-preview/BrowserTab.tsx";
import { ChatPane } from "../chat/ChatPane.tsx";
import { FileTab } from "../file-viewer/FileTab.tsx";
import { PrTab } from "../pr/PrTab.tsx";
import { ArchivedTabNotice } from "./ArchivedNotice.tsx";
import { type ActiveTab, activeTabKey, resolveActiveTab } from "./active-tab.ts";
import { CommentTab } from "./CommentTab.tsx";
import { EmptyTabGroup } from "./EmptyTabGroup.tsx";
import type { WorkspaceSearch } from "./workspace-search.ts";

export interface TabContentProps {
	workspaceId: WorkspaceId;
	search: WorkspaceSearch;
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void;
	/** A split pane shows its own tab; the main pane follows the URL (see SplitPanes). */
	tab?: ActiveTab;
}

/**
 * Each tab is mounted under its own identity, so switching from one chat to another starts it fresh and
 * nothing typed or scrolled in the first one shows in the second. A terminal keeps its own view in the
 * shell's surface layer, so its slot here is all that remounts.
 */
export function TabContent({
	workspaceId,
	search,
	onSearchChange,
	tab: override,
}: TabContentProps) {
	const tab = override ?? resolveActiveTab(search);
	return (
		<TabBody
			key={activeTabKey(tab)}
			workspaceId={workspaceId}
			tab={tab}
			onSearchChange={onSearchChange}
		/>
	);
}

function TabBody({
	workspaceId,
	tab,
	onSearchChange,
}: {
	workspaceId: WorkspaceId;
	tab: ActiveTab;
	onSearchChange: TabContentProps["onSearchChange"];
}) {
	const key = activeTabKey(tab);
	const workspace = useWorkspace(workspaceId);
	const archived = workspace.state === "ready" && workspace.data.state === "archived";
	if (archived && (tab.kind === "terminal" || tab.kind === "file" || tab.kind === "browser")) {
		return <ArchivedTabNotice workspaceId={workspaceId} />;
	}
	switch (tab.kind) {
		case "session":
			return (
				<NotBuiltYet area="Chat" resetKey={key}>
					<ErrorBoundary
						resetKey={key}
						fallback={() => (
							<div
								role="alert"
								className="flex h-full items-center justify-center p-6 text-sm text-danger"
							>
								This chat tab failed to render. Open another tab and come back.
							</div>
						)}
					>
						<ChatPane workspaceId={workspaceId} sessionId={tab.sessionId} />
					</ErrorBoundary>
				</NotBuiltYet>
			);
		case "terminal":
			return (
				<NotBuiltYet area="Terminal" resetKey={key}>
					<TerminalTabSlot terminalId={tab.terminalId} workspaceId={workspaceId} />
				</NotBuiltYet>
			);
		case "file":
			return (
				<NotBuiltYet area="File" resetKey={key}>
					<FileTab
						workspaceId={workspaceId}
						path={tab.path}
						mode={tab.mode}
						scope={tab.scope}
						onOpenFile={(path, fileMode) => onSearchChange({ tab: "file", path, fileMode })}
					/>
				</NotBuiltYet>
			);
		case "comment":
			return (
				<NotBuiltYet area="Review comment" resetKey={key}>
					<CommentTab
						workspaceId={workspaceId}
						commentId={tab.commentId}
						onOpenComment={(commentId) => onSearchChange({ tab: "comment", commentId })}
					/>
				</NotBuiltYet>
			);
		case "pr":
			return (
				<NotBuiltYet area="Pull request" resetKey={key}>
					<PrTab workspaceId={workspaceId} />
				</NotBuiltYet>
			);
		case "browser":
			return (
				<NotBuiltYet area="Browser" resetKey={key}>
					<BrowserTab workspaceId={workspaceId} url={tab.url} />
				</NotBuiltYet>
			);
		case "none":
			return (
				<NotBuiltYet area="Tabs" resetKey={key}>
					<EmptyTabGroup workspaceId={workspaceId} onSearchChange={onSearchChange} />
				</NotBuiltYet>
			);
	}
}
