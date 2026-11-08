/**
 * @feature PR-09 Linear issues: list, link, attach as context
 * Owns: the Link issue dialog: it lists the user's open Linear issues and the repository's GitHub
 * issues, searches them, and links the chosen one to the chat's draft.
 * Behaviour: ui-map.md 3.10 (Link issue: 'Connect Linear', 'Search issues...', 'No open issues
 * found'), 3.5 and 5.4 (opened by the '+' menu's 'Link issue' and Cmd+I); services-map.md 5B.8.1
 * (my active issues when the search is empty, a search 300 ms after the typing stops), 5B.8.2
 * (GitHub's open issues). Where the research is silent, Conductor's renderApp: the headings
 * 'Recent issues' and 'Search results', the 'Loading your issues...' and 'Searching issues...'
 * rows, 'No issues found' for a search with no match, a 'Setup' group with 'Connect Linear'
 * (opens the Account settings) and 'Run "gh auth login" to connect GitHub' (closes the dialog), a
 * 'Link' hint on each row; a chosen issue becomes a `[LINEAR]-<identifier>.md` or
 * `[GITHUB]-<n>.md` text attachment of the draft, the dialog closes and the editor takes focus;
 * a Linear issue with a branch name renames a workspace branch that still has its placeholder name
 * ('Branch renamed to <name>', 'Failed to rename branch: <reason>'); a GitHub issue that cannot be
 * linked says 'Failed to link GitHub issue: <reason>'.
 * Our design choice: the linked issue shows as the draft's attachment chip, and removing the chip
 * unlinks it (COMP-07's attachment bar); Conductor puts a mention of the same file in the text.
 * Rows show the identifier, title and state in text, as the app ships no Linear or GitHub marks.
 * Must handle: Linear or GitHub not connected (the Setup row instead of their issues); a rejected
 * Linear key (Connect Linear); a Linear key not checked yet (Linear is asked, and its answer
 * settles the connection); a repository without a GitHub remote (no GitHub rows); a provider
 * whose list fails (its message is shown); an issue that cannot be read (a message, nothing
 * linked); a second choice while one is linking (ignored); a close by Escape or a click outside
 * (the editor takes focus, as after a choice).
 * Our design choice: a Linear issue Conductor cannot fail to link (it builds the file from the
 * list) can fail here, because ours reads the issue first; that says 'Failed to link Linear
 * issue: <reason>', the GitHub message's form.
 * Test first: with Linear connected, Cmd+I opens 'Search issues...', and choosing ENG-12 adds
 * `[LINEAR]-ENG-12.md` to the chat's draft.
 */
import type { RepoId, SessionId, WorkspaceId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { Dialog as Radix } from "radix-ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useServices } from "../../core/context.tsx";
import {
	useActions,
	useGitHubAccess,
	useIssues,
	useLinearAccess,
	useWorkspace,
} from "../../core/hooks.ts";
import type { IssueView } from "../../core/model.ts";
import { githubSetupNeeded } from "../../core/services/mention-search.ts";
import { Kbd } from "../../ui/Kbd.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { toast } from "../../ui/Toast.tsx";

/** Linear's search waits this long after the last key (services-map.md 5B.8.1). */
export const LINEAR_SEARCH_DEBOUNCE_MS = 300;

export interface LinkIssueDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspaceId: WorkspaceId;
	sessionId: SessionId;
	/** Adds a staged attachment to the composer's list. */
	onAttached: (path: string) => void;
	/** Gives the editor focus again, with the caret at the end. */
	onFocusEditor: () => void;
}

const itemClass =
	"group flex h-9 cursor-default items-center gap-2 rounded-md px-3 text-sm text-fg outline-none data-[selected=true]:bg-active";

const groupClass =
	"[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle";

export function LinkIssueDialog(props: LinkIssueDialogProps) {
	const { open, onOpenChange, onFocusEditor } = props;
	return (
		<Radix.Root open={open} onOpenChange={onOpenChange}>
			<Radix.Portal>
				<Radix.Overlay className="fixed inset-0 z-40 bg-overlay" />
				<Radix.Content
					aria-label="Link issue"
					aria-describedby={undefined}
					className="fixed left-1/2 top-[max(2rem,calc(50%-250px))] z-50 flex w-(--palette-width) max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-md border border-border bg-raised text-fg shadow-palette"
					// However the dialog closes (a choice, Escape, a click outside), the editor takes
					// focus. It is done in the dialog's own close event, after its focus restore, so a
					// busy main thread cannot leave the editor unfocused.
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						onFocusEditor();
					}}
				>
					<h2 className="sr-only">Link issue</h2>
					<Command label="Link issue" shouldFilter={false}>
						{open ? <LinkIssueContent {...props} onOpenChange={onOpenChange} /> : null}
					</Command>
				</Radix.Content>
			</Radix.Portal>
		</Radix.Root>
	);
}

/** The text after the user has stopped typing for `delayMs`. */
function useSettledText(text: string, delayMs: number): string {
	const [settled, setSettled] = useState(text);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(text), delayMs);
		return () => clearTimeout(timer);
	}, [text, delayMs]);
	return settled;
}

/** Waits for the workspace row, whose project the GitHub issues come from. */
function LinkIssueContent(props: LinkIssueDialogProps) {
	const workspace = useWorkspace(props.workspaceId);
	if (workspace.state === "ready")
		return <LinkIssueBody {...props} repoId={workspace.data.repoId} />;
	return (
		<p
			role={workspace.state === "error" ? "alert" : undefined}
			className="px-3 py-6 text-sm text-fg-muted"
		>
			{workspace.state === "error" ? workspace.error.message : "Loading your issues..."}
		</p>
	);
}

function LinkIssueBody({
	onOpenChange,
	workspaceId,
	sessionId,
	onAttached,
	repoId,
}: LinkIssueDialogProps & { repoId: RepoId }) {
	const { services } = useServices();
	const actions = useActions();
	const navigate = useNavigate();
	const linearAccess = useLinearAccess();
	const githubAccess = useGitHubAccess();
	const [query, setQuery] = useState("");
	const linearQuery = useSettledText(query, LINEAR_SEARCH_DEBOUNCE_MS);
	const linearIssues = useIssues(repoId, "linear", linearQuery);
	const githubIssues = useIssues(repoId, "github", query);
	const linking = useRef(false);

	const searching = query.trim() !== "";
	const linearConnected = linearAccess.state === "ready" && linearAccess.data.state === "signed_in";
	const linearMissing =
		linearAccess.state === "ready" &&
		(linearAccess.data.state === "signed_out" || linearAccess.data.state === "key_rejected");
	const githubConnected = githubAccess.state === "ready" && githubAccess.data.state === "signed_in";
	// Conductor's Setup row covers no `gh` and a signed-out `gh` alike (the '#' menu's rule, COMP-05).
	const githubSetup = githubAccess.state === "ready" ? githubSetupNeeded(githubAccess.data) : null;
	const githubMissing = githubSetup === "signed_out" || githubSetup === "gh_missing";
	// A repository without a GitHub remote has no GitHub issues to offer; that is not a failure.
	const githubListed =
		githubIssues.state !== "error" || githubIssues.error.code !== "github_issues_unavailable";

	// Until the key has been checked, Linear is asked anyway: the answer settles the connection.
	const linearAsked = linearAccess.state === "loading" || linearConnected;
	const linearLoading = linearAsked && (linearIssues.state === "loading" || linearQuery !== query);
	const githubLoading = githubConnected && githubListed && githubIssues.state === "loading";
	const loading = linearLoading || githubLoading;

	const rows: IssueView[] = [];
	if (linearAsked && linearIssues.state === "ready") rows.push(...linearIssues.data);
	if (githubConnected && githubIssues.state === "ready") rows.push(...githubIssues.data);
	const errors: string[] = [];
	if (linearAsked && linearIssues.state === "error") errors.push(linearIssues.error.message);
	if (githubConnected && githubListed && githubIssues.state === "error") {
		errors.push(githubIssues.error.message);
	}

	const close = () => onOpenChange(false);

	const link = async (issue: IssueView) => {
		if (linking.current) return;
		linking.current = true;
		try {
			const provider = issue.provider === "linear" ? "Linear" : "GitHub";
			const attachment =
				issue.provider === "linear"
					? await services.linear.issueAttachment(issue.id)
					: await services.github.issueAttachment(workspaceId, issue.id);
			const staged = attachment.ok
				? await services.composer.addText(
						sessionId,
						attachment.value.fileName,
						attachment.value.text,
					)
				: attachment;
			if (!staged.ok) {
				toast.error(`Failed to link ${provider} issue: ${staged.error.message}`);
				return;
			}
			onAttached(staged.value);
			close();
			const branchName = attachment.ok ? attachment.value.branchName : null;
			const current = services.workspace.store.getState().workspacesById[workspaceId];
			if (branchName === null || current?.branchIsPlaceholder !== true) return;
			const renamed = await actions.git.renameBranch(workspaceId, branchName);
			if (renamed.ok) toast.success(`Branch renamed to ${branchName}`);
			else toast.error(`Failed to rename branch: ${renamed.error.message}`);
		} finally {
			linking.current = false;
		}
	};

	let list: ReactNode;
	if (loading) {
		list = (
			<div className="flex items-center justify-center gap-2 py-6 text-sm text-fg-muted">
				<Spinner size="sm" label={searching ? "Searching issues" : "Loading issues"} />
				{searching ? "Searching issues..." : "Loading your issues..."}
			</div>
		);
	} else {
		list = (
			<>
				{rows.length > 0 ? (
					<Command.Group
						heading={searching ? "Search results" : "Recent issues"}
						className={groupClass}
					>
						{rows.map((issue) => (
							<Command.Item
								key={`${issue.provider}-${issue.id}`}
								value={`${issue.provider === "linear" ? "linear" : "github-issue"}-${issue.id}`}
								onSelect={() => void link(issue)}
								className={itemClass}
							>
								<span className="sr-only">{issue.provider === "linear" ? "Linear" : "GitHub"}</span>
								<span className="inline-block min-w-16 shrink-0 font-mono text-xs text-fg-muted">
									{issue.identifier}
								</span>
								<span className="min-w-0 flex-1 truncate">{issue.title}</span>
								<span className="shrink-0 text-xs text-fg-subtle">{issue.state}</span>
								<RowHint>Link</RowHint>
							</Command.Item>
						))}
					</Command.Group>
				) : null}
				{rows.length === 0 && !searching && (linearConnected || githubConnected) ? (
					<p className="px-3 py-6 text-center text-sm text-fg-muted">No open issues found</p>
				) : null}
				{rows.length === 0 && searching ? (
					<p className="px-3 py-6 text-center text-sm text-fg-muted">No issues found</p>
				) : null}
				{!searching && (linearMissing || githubMissing) ? (
					<Command.Group heading="Setup" className={groupClass}>
						{linearMissing ? (
							<Command.Item
								value="link-linear"
								onSelect={() => {
									void navigate({ to: "/settings/user/$page", params: { page: "account" } });
									close();
								}}
								className={itemClass}
							>
								<span className="min-w-0 flex-1 truncate">Connect Linear</span>
								<RowHint>Setup</RowHint>
							</Command.Item>
						) : null}
						{githubMissing ? (
							<Command.Item value="setup-github" onSelect={close} className={itemClass}>
								<span className="min-w-0 flex-1 truncate">
									Run "gh auth login" to connect GitHub
								</span>
								<RowHint>Dismiss</RowHint>
							</Command.Item>
						) : null}
					</Command.Group>
				) : null}
			</>
		);
	}

	return (
		<>
			<div className="flex h-11 items-center border-b border-border px-3">
				<Command.Input
					value={query}
					onValueChange={setQuery}
					placeholder="Search issues..."
					aria-label="Search issues"
					className="h-full min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
				/>
			</div>
			{errors.map((message) => (
				<p key={message} role="alert" className="px-3 py-2 text-xs text-danger">
					{message}
				</p>
			))}
			<Command.List className="max-h-(--palette-max-height) overflow-y-auto p-2">
				{list}
			</Command.List>
		</>
	);
}

/** The action a row takes, shown on the row under the pointer or keyboard. */
function RowHint({ children }: { children: ReactNode }) {
	return (
		<span className="invisible inline-flex shrink-0 items-center gap-1 text-xs text-fg-subtle group-data-[selected=true]:visible">
			{children}
			<Kbd>↵</Kbd>
		</span>
	);
}
