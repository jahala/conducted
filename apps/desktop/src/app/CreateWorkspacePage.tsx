/**
 * @feature WS-01 Create-workspace page
 * @feature WS-02 Create from a branch, PR or issue
 * @feature SIDE-22 Slash command cache that works before a chat starts
 * Owns: the full-page "new workspace" flow at /create: repository picker, the toggleable "create from"
 * picker (default branch, an existing local branch, a pull request or an issue), first message editor with a
 * model field and plan mode, section picker, and the "Create workspace" button. Typing '@' in the
 * first message offers the chosen repository's own files before any workspace exists (SIDE-22).
 * Behaviour: ui-map.md 3.9 (New workspace flow; "Draft the first message, then create and send it."), 5.4
 * (Cmd+I toggles the create-from picker).
 * Our design choice: the page keeps the first message in a plain textarea until the composer editor can be
 * reused outside a chat; attachments wait for COMP-07.
 * Must handle: no project yet (point to "Add a project"); a failed create keeps the draft with Retry setup
 * and Recover prompt; creation warnings are toasted; an empty prompt creates the workspace without a chat;
 * "Create from" a branch with no branch name is refused with a message under the field; a pull request that
 * was not loaded and an issue that was not picked are refused with a message; a second press while a create
 * or a retry runs does nothing.
 * Test first: submitting with a repository and a prompt calls workspaces.create with that input and navigates to
 * the new workspace; a failed create offers Retry setup and Recover prompt.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { RepoId, SectionId, WorkspaceId } from "@conducted/shared";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { NewWorkspaceInput } from "../core/api.ts";
import { createSingleFlight } from "../core/async/single-flight.ts";
import { useServices } from "../core/context.tsx";
import {
	useActions,
	useBranches,
	useIssues,
	usePreWorkspaceSlashCommands,
	usePullRequestList,
	useRepoFileSearch,
	useRepos,
	useSetting,
} from "../core/hooks.ts";
import type { IssueView, PullRequestSummary, Section } from "../core/model.ts";
import { FIRST_CHAT_APP_TOOLS } from "../core/services/workspace.ts";
import { SuggestionPopup } from "../features/composer/mentions/SuggestionPopup.tsx";
import { AddProjectButton } from "../features/sidebar/AddProjectButton.tsx";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Input, Label, Textarea } from "../ui/Input.tsx";
import { Select } from "../ui/Select.tsx";
import { toast, toastError } from "../ui/Toast.tsx";
import { useCommandHandler } from "./command-dispatcher.ts";

type FromKind = "default" | "branch" | "pull_request" | "issue";
type IssueProvider = IssueView["provider"];

/** The '@' query under the caret in the first-message field. */
interface FileMentionQuery {
	query: string;
	/** Document position of the typed '@'. */
	start: number;
	/** Document position just after the query. */
	end: number;
}

/** Reads a mention that ends at the caret, or null when the text has none. */
function mentionAt(text: string, caret: number, trigger: "@" | "/"): FileMentionQuery | null {
	const before = text.slice(0, caret);
	const escaped = trigger === "@" ? "@" : "/";
	const match = new RegExp(`(?:^|[\\s([{])${escaped}([^\\s${escaped}]*)$`).exec(before);
	if (match === null) return null;
	const query = match[1] ?? "";
	return { query, start: caret - query.length - 1, end: caret };
}

/** Reads an '@' mention that ends at the caret, or null when the text has none. */
export function fileMentionAt(text: string, caret: number): FileMentionQuery | null {
	return mentionAt(text, caret, "@");
}

/** Reads a '/' command mention that ends at the caret, or null when the text has none. */
export function slashMentionAt(text: string, caret: number): FileMentionQuery | null {
	return mentionAt(text, caret, "/");
}

/** The repository's saved slash commands and skills, before a workspace exists (SIDE-22). */
function RepoSlashSuggestions(props: {
	repoRootPath: string;
	query: string;
	onPick: (command: { name: string; kind: "command" | "skill" }) => void;
}) {
	const listed = usePreWorkspaceSlashCommands(props.repoRootPath, "claude");
	const query = props.query.toLowerCase();
	const rows =
		listed.state === "ready"
			? listed.data
					.filter((command) => command.name.toLowerCase().includes(query))
					.map((command) => ({
						id: `${command.kind}:${command.name}`,
						label: `/${command.name}`,
						detail: command.kind === "skill" ? "Skills" : "Commands",
					}))
			: [];
	return (
		<SuggestionPopup
			rows={rows}
			selectedIndex={0}
			state={listed.state}
			emptyText="No commands or skills found"
			label="Slash commands and skills"
			onPick={(row) => {
				const [kind, ...rest] = row.id.split(":");
				props.onPick({
					name: rest.join(":"),
					kind: kind === "skill" ? "skill" : "command",
				});
			}}
		/>
	);
}

/** The repository's files under an '@' query, before a workspace exists (SIDE-22). */
function RepoFileSuggestions(props: {
	repoId: RepoId;
	query: string;
	onPick: (path: string) => void;
}) {
	const files = useRepoFileSearch(props.repoId, props.query);
	const rows =
		files.state === "ready"
			? files.data.map((entry) => ({
					id: `file:${entry.path}`,
					label: entry.path,
					detail: entry.isDirectory ? "Directory" : undefined,
				}))
			: [];
	return (
		<SuggestionPopup
			rows={rows}
			selectedIndex={0}
			state={files.state}
			emptyText="No files found"
			label="Repository files"
			onPick={(row) => props.onPick(row.label)}
		/>
	);
}

export function CreateWorkspacePage(_props: Record<string, never>) {
	const actions = useActions();
	const repos = useRepos();
	const services = useServices();
	const navigate = useNavigate();
	const search = useSearch({ strict: false }) as { section?: string };

	const defaultModel = useSetting<string>("default_model");
	const defaultEffort = useSetting<string>("default_claude_effort_level");
	const defaultFastMode = useSetting<boolean>("default_fast_mode");
	const defaultPlanMode = useSetting<boolean>("default_plan_mode");
	const toolApprovals = useSetting<boolean>("tool_approvals_enabled");
	const sections: readonly Section[] = useStore(
		services.services.sections.store,
		(state) => state.sections,
	);

	const [repoId, setRepoId] = useState<RepoId | null>(null);
	const [fromKind, setFromKind] = useState<FromKind>("default");
	const [pickerOpen, setPickerOpen] = useState(true);
	const [branchName, setBranchName] = useState("");
	const [showBranchList, setShowBranchList] = useState(false);
	const [selectedPullRequest, setSelectedPullRequest] = useState<PullRequestSummary | null>(null);
	const [issueProvider, setIssueProvider] = useState<IssueProvider>("github");
	const [selectedIssue, setSelectedIssue] = useState<IssueView | null>(null);
	const [prompt, setPrompt] = useState("");
	const [mention, setMention] = useState<FileMentionQuery | null>(null);
	const [slashMention, setSlashMention] = useState<FileMentionQuery | null>(null);
	const [model, setModel] = useState(defaultModel);
	const [planMode, setPlanMode] = useState(defaultPlanMode);
	const [sectionId, setSectionId] = useState(() => search.section ?? "");
	const [busy, setBusy] = useState(false);
	const [failedId, setFailedId] = useState<WorkspaceId | null>(null);
	const [branchTouched, setBranchTouched] = useState(false);
	const flight = useRef(createSingleFlight()).current;

	const readyRepos = repos.state === "ready" ? repos.data : [];
	const selectedRepo = readyRepos.find((repo) => repo.id === repoId) ?? readyRepos[0];

	useEffect(() => {
		if (repoId === null && readyRepos[0] !== undefined) setRepoId(readyRepos[0].id);
	}, [repoId, readyRepos]);

	useCommandHandler("workspace.toggleCreateFromPicker", "modal", () => {
		setPickerOpen((open) => !open);
		return true;
	});

	// A "Create in section" link on the sidebar names the section in the URL.
	const sectionFromSearch = search.section ?? "";
	useEffect(() => {
		if (sectionFromSearch !== "") setSectionId(sectionFromSearch);
	}, [sectionFromSearch]);

	if (repos.state === "loading") {
		return (
			<div className="flex h-full items-center justify-center p-8 text-sm text-fg-muted">
				Loading projects…
			</div>
		);
	}

	if (repos.state === "error") {
		return (
			<div className="flex h-full items-center justify-center p-8 text-sm text-danger">
				{repos.error.message}
			</div>
		);
	}

	if (readyRepos.length === 0) {
		return (
			<div className="h-full p-8">
				<EmptyState
					title="Add a project to get started"
					body="A workspace is a git worktree of one of your projects. Add a project first."
					action={<AddProjectButton variant="default" size="lg" />}
				/>
			</div>
		);
	}

	if (selectedRepo === undefined) return null;

	const openWorkspace = (repoId: RepoId, workspaceId: WorkspaceId) => {
		void navigate({
			to: "/repository/$repositoryId/workspace/$workspaceId",
			params: { repositoryId: repoId, workspaceId },
		});
	};

	const toastWarnings = (workspaceId: WorkspaceId) => {
		const warnings = services.services.workspace.store.getState().warnings?.[workspaceId] ?? [];
		for (const warning of warnings) toast.warning(warning);
	};

	const branchMissing = fromKind === "branch" && branchName.trim() === "";

	const submit = async () => {
		if (selectedRepo === undefined) {
			toast.error("No repository selected");
			return;
		}
		if (branchMissing) {
			setBranchTouched(true);
			return;
		}
		let from: NewWorkspaceInput["from"] = { kind: "default" };
		if (fromKind === "branch") from = { kind: "branch", name: branchName.trim() };
		if (fromKind === "pull_request") {
			if (selectedPullRequest === null) {
				toast.error("Could not load that pull request");
				return;
			}
			from = { kind: "pull_request", number: selectedPullRequest.number };
		}
		if (fromKind === "issue") {
			if (selectedIssue === null) {
				toast.error("Could not load that issue");
				return;
			}
			from = { kind: "issue", provider: selectedIssue.provider, id: selectedIssue.id };
		}
		await flight.run("create", async () => {
			setFailedId(null);
			setBusy(true);
			const progress = toast("Creating workspace…");
			const config: SessionConfig = {
				agent: "claude",
				model: model.trim() === "" ? "default" : model.trim(),
				effort: (defaultEffort === "" ? "high" : defaultEffort) as SessionConfig["effort"],
				fastMode: defaultFastMode,
				planMode,
				requireToolApproval: toolApprovals,
				additionalDirectories: [],
				appTools: FIRST_CHAT_APP_TOOLS,
			};
			const input: NewWorkspaceInput = {
				repoId: selectedRepo.id,
				from,
				prompt,
				attachmentPaths: [],
				config,
				sectionId: sectionId === "" ? null : (sectionId as SectionId),
			};
			const result = await actions.workspaces.create(input);
			toast.dismiss(progress);
			setBusy(false);
			if (!result.ok) {
				const failed = services.services.workspace.store.getState().lastFailedCreate;
				if (failed !== null && failed !== undefined) setFailedId(failed.id);
				toastError("Failed to create workspace", result.error);
				return;
			}
			toastWarnings(result.value.id);
			openWorkspace(result.value.repoId, result.value.id);
		});
	};

	const retry = async () => {
		if (failedId === null || selectedRepo === undefined) return;
		const id = failedId;
		await flight.run("create", async () => {
			setBusy(true);
			const result = await actions.workspaces.retrySetup(id);
			setBusy(false);
			if (!result.ok) {
				toastError("Failed to create workspace", result.error);
				return;
			}
			setFailedId(null);
			toastWarnings(id);
			openWorkspace(selectedRepo.id, id);
		});
	};

	const recover = async () => {
		if (failedId === null) return;
		const result = await actions.workspaces.recoverPrompt(failedId);
		if (!result.ok) {
			toastError("Couldn't recover the prompt", result.error);
			return;
		}
		setPrompt(result.value.text);
		toast("Prompt recovered");
	};

	const sectionOptions = [
		{ value: "", label: sections.length === 0 ? "No sections yet" : "No section" },
		...sections.map((section) => ({ value: section.id, label: section.name })),
	];

	return (
		<div
			data-command-scope="dialog"
			className="mx-auto flex h-full w-full max-w-2xl flex-col gap-6 overflow-y-auto p-8"
		>
			<header className="flex flex-col gap-1">
				<h1 className="text-2xl font-medium text-fg">New workspace</h1>
				<p className="text-sm text-fg-muted">Draft the first message, then create and send it.</p>
			</header>

			<form
				className="flex flex-col gap-5"
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="create-workspace-repo">Repository</Label>
					<Select
						id="create-workspace-repo"
						value={selectedRepo.id}
						options={readyRepos.map((repo) => ({ value: repo.id, label: repo.name }))}
						onValueChange={(value) => {
							setRepoId(value as RepoId);
							setSelectedPullRequest(null);
							setSelectedIssue(null);
							setShowBranchList(false);
							setMention(null);
							setSlashMention(null);
						}}
						disabled={busy}
					/>
				</div>

				<div className="flex flex-col gap-3">
					<div className="flex items-center justify-between gap-3">
						{pickerOpen ? (
							<Label htmlFor="create-workspace-from">Create from</Label>
						) : (
							<span className="text-sm font-medium leading-none text-fg">Create from</span>
						)}
						<Button
							type="button"
							variant="ghost"
							size="sm"
							aria-label="Show or hide the create-from picker"
							aria-expanded={pickerOpen}
							aria-controls="create-from-picker"
							disabled={busy}
							onClick={() => setPickerOpen((open) => !open)}
						>
							{pickerOpen ? "Hide sources" : "Show sources"}
						</Button>
					</div>

					{pickerOpen ? (
						<div id="create-from-picker" className="flex flex-col gap-3">
							<Select<FromKind>
								id="create-workspace-from"
								value={fromKind}
								options={[
									{ value: "default", label: `Default branch (${selectedRepo.defaultBranch})` },
									{ value: "branch", label: "Branch" },
									{ value: "pull_request", label: "Pull request" },
									{ value: "issue", label: "Issue" },
								]}
								onValueChange={setFromKind}
								disabled={busy}
							/>

							{fromKind === "branch" ? (
								<div className="flex flex-col gap-2">
									<Label htmlFor="create-workspace-branch">Branch name</Label>
									<Input
										id="create-workspace-branch"
										value={branchName}
										onChange={(event) => setBranchName(event.target.value)}
										placeholder={selectedRepo.defaultBranch}
										disabled={busy}
										{...(branchTouched && branchMissing
											? { error: "Enter the branch to start from." }
											: {})}
									/>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										aria-expanded={showBranchList}
										aria-controls="create-branch-list"
										disabled={busy}
										onClick={() => setShowBranchList((shown) => !shown)}
									>
										Browse branches
									</Button>
									{showBranchList ? (
										<BranchList
											id="create-branch-list"
											repoId={selectedRepo.id}
											selected={branchName}
											onPick={setBranchName}
										/>
									) : null}
								</div>
							) : null}

							{fromKind === "pull_request" ? (
								<PullRequestPicker
									repoId={selectedRepo.id}
									selected={selectedPullRequest}
									onPick={setSelectedPullRequest}
								/>
							) : null}

							{fromKind === "issue" ? (
								<IssuePicker
									repoId={selectedRepo.id}
									provider={issueProvider}
									onProviderChange={(provider) => {
										setIssueProvider(provider);
										setSelectedIssue(null);
									}}
									selected={selectedIssue}
									onPick={setSelectedIssue}
								/>
							) : null}
						</div>
					) : null}
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="create-workspace-prompt">First message</Label>
					<Textarea
						id="create-workspace-prompt"
						aria-label="First message"
						value={prompt}
						onChange={(event) => {
							const caret = event.target.selectionStart ?? event.target.value.length;
							setPrompt(event.target.value);
							setMention(fileMentionAt(event.target.value, caret));
							setSlashMention(slashMentionAt(event.target.value, caret));
						}}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								setMention(null);
								setSlashMention(null);
							}
						}}
						placeholder="What do you want to work on?"
						rows={5}
						disabled={busy}
					/>
					{mention !== null && mention.query.length >= 2 ? (
						<RepoFileSuggestions
							repoId={selectedRepo.id}
							query={mention.query}
							onPick={(path) => {
								setPrompt(`${prompt.slice(0, mention.start)}@${path} ${prompt.slice(mention.end)}`);
								setMention(null);
							}}
						/>
					) : null}
					{slashMention !== null ? (
						<RepoSlashSuggestions
							repoRootPath={selectedRepo.rootPath}
							query={slashMention.query}
							onPick={(command) => {
								setPrompt(
									`${prompt.slice(0, slashMention.start)}/${command.name} ${prompt.slice(slashMention.end)}`,
								);
								setSlashMention(null);
							}}
						/>
					) : null}
				</div>

				<div className="grid grid-cols-2 gap-4">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="create-workspace-model">Model</Label>
						<Input
							id="create-workspace-model"
							value={model}
							onChange={(event) => setModel(event.target.value)}
							placeholder="default"
							disabled={busy}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="create-workspace-section">Create in section</Label>
						<Select
							id="create-workspace-section"
							value={sectionId}
							options={sectionOptions}
							onValueChange={setSectionId}
							disabled={busy || sections.length === 0}
						/>
					</div>
				</div>

				<label className="flex items-center gap-2 text-sm text-fg">
					<input
						type="checkbox"
						checked={planMode}
						onChange={(event) => setPlanMode(event.target.checked)}
						disabled={busy}
					/>
					Plan mode
				</label>

				{failedId === null ? null : (
					<div
						role="alert"
						className="flex flex-col gap-3 rounded-lg border border-border bg-raised p-4"
					>
						<div className="flex flex-col gap-1">
							<p className="text-sm font-medium text-fg">Workspace initialization failed</p>
							<p className="text-sm text-fg-muted">
								Retry the setup, or recover the first message and try again.
							</p>
						</div>
						<div className="flex gap-2">
							<Button
								type="button"
								variant="default"
								size="sm"
								disabled={busy}
								onClick={() => void retry()}
							>
								Retry setup
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={busy}
								onClick={() => void recover()}
							>
								Recover prompt
							</Button>
						</div>
					</div>
				)}

				<div className="flex justify-end">
					<Button type="submit" loading={busy}>
						Create workspace
					</Button>
				</div>
			</form>
		</div>
	);
}

const pickerRowClass =
	"flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm text-fg transition-colors hover:bg-hover aria-selected:bg-active";

function BranchList({
	id,
	repoId,
	selected,
	onPick,
}: {
	id: string;
	repoId: RepoId;
	selected: string;
	onPick: (branch: string) => void;
}) {
	const branches = useBranches(repoId);
	if (branches.state === "loading") {
		return <p className="px-2 py-1 text-xs text-fg-muted">Loading branches…</p>;
	}
	if (branches.state === "error") {
		return <p className="px-2 py-1 text-xs text-danger">{branches.error.message}</p>;
	}
	if (branches.data.length === 0) {
		return <p className="px-2 py-1 text-xs text-fg-muted">No branches found.</p>;
	}
	return (
		<div
			id={id}
			role="listbox"
			aria-label="Branches"
			className="flex max-h-48 flex-col overflow-y-auto rounded-md border border-border p-1"
		>
			{branches.data.map((branch) => (
				<button
					key={branch}
					type="button"
					role="option"
					aria-selected={branch === selected}
					className={pickerRowClass}
					onClick={() => onPick(branch)}
				>
					{branch}
				</button>
			))}
		</div>
	);
}

function PullRequestPicker({
	repoId,
	selected,
	onPick,
}: {
	repoId: RepoId;
	selected: PullRequestSummary | null;
	onPick: (pullRequest: PullRequestSummary) => void;
}) {
	const [query, setQuery] = useState("");
	const pullRequests = usePullRequestList(repoId, query);
	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor="create-workspace-pr-search">Search pull requests</Label>
			<Input
				id="create-workspace-pr-search"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder="Number, title, branch or author"
			/>
			{pullRequests.state === "loading" ? (
				<p className="px-2 py-1 text-xs text-fg-muted">Loading pull requests…</p>
			) : pullRequests.state === "error" ? (
				<p className="px-2 py-1 text-xs text-danger">{pullRequests.error.message}</p>
			) : pullRequests.data.length === 0 ? (
				<p className="px-2 py-1 text-xs text-fg-muted">No open pull requests found.</p>
			) : (
				<div
					role="listbox"
					aria-label="Pull requests"
					className="flex max-h-48 flex-col overflow-y-auto rounded-md border border-border p-1"
				>
					{pullRequests.data.map((pullRequest) => (
						<button
							key={pullRequest.number}
							type="button"
							role="option"
							aria-selected={selected?.number === pullRequest.number}
							className={pickerRowClass}
							onClick={() => onPick(pullRequest)}
						>
							<span className="font-medium">
								#{pullRequest.number} {pullRequest.title}
							</span>
							<span className="text-xs text-fg-muted">{pullRequest.branch}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function IssuePicker({
	repoId,
	provider,
	onProviderChange,
	selected,
	onPick,
}: {
	repoId: RepoId;
	provider: IssueProvider;
	onProviderChange: (provider: IssueProvider) => void;
	selected: IssueView | null;
	onPick: (issue: IssueView) => void;
}) {
	const [query, setQuery] = useState("");
	const issues = useIssues(repoId, provider, query);
	return (
		<div className="flex flex-col gap-2">
			<Select<IssueProvider>
				aria-label="Issue provider"
				value={provider}
				options={[
					{ value: "github", label: "GitHub" },
					{ value: "linear", label: "Linear" },
				]}
				onValueChange={onProviderChange}
			/>
			<Label htmlFor="create-workspace-issue-search">Search issues</Label>
			<Input
				id="create-workspace-issue-search"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder="Identifier or title"
			/>
			{issues.state === "loading" ? (
				<p className="px-2 py-1 text-xs text-fg-muted">Loading issues…</p>
			) : issues.state === "error" ? (
				<p className="px-2 py-1 text-xs text-danger">{issues.error.message}</p>
			) : issues.data.length === 0 ? (
				<p className="px-2 py-1 text-xs text-fg-muted">No open issues found.</p>
			) : (
				<div
					role="listbox"
					aria-label="Issues"
					className="flex max-h-48 flex-col overflow-y-auto rounded-md border border-border p-1"
				>
					{issues.data.map((issue) => (
						<button
							key={`${issue.provider}:${issue.id}`}
							type="button"
							role="option"
							aria-selected={selected?.id === issue.id && selected.provider === issue.provider}
							className={pickerRowClass}
							onClick={() => onPick(issue)}
						>
							<span className="font-medium">
								{issue.identifier} {issue.title}
							</span>
							<span className="text-xs text-fg-muted">{issue.state}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
