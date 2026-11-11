/**
 * @feature WS-01 Create-workspace page
 * @feature WS-02 Create from a branch, PR or issue
 * @feature SIDE-22 Slash command cache that works before a chat starts
 * @feature WS-11 Backlog workspaces: save now, start later
 * @feature NAV-16 Draft markers on the Create row and on workspaces
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Owns: the "new workspace" dialog at /create: the project picker (with Open project, Open GitHub project,
 * Quick start and the projects under Recents), the "···" options (section, Backlog), the toggleable
 * "create from" picker (default branch, an existing local branch, a pull request or an issue), the first
 * message with the composer's model menu, the "+" menu (plan mode), and the "Create ↵" button with its
 * "Create in section" dropdown. The first message is kept as the
 * new-workspace draft in the composer store, so the Create row can mark it and the dialog restores it
 * (NAV-16). Typing '@' in the first message offers the chosen repository's own files before any
 * workspace exists (SIDE-22).
 * A draft can be saved to the backlog, and a saved backlog workspace opens with a Start button. A deep
 * link may open the page with its project, branch and first message already filled; a project it names
 * that is not loaded gives "Repository not found", and the page keeps its usual first project.
 * Behaviour: measured from Conductor 0.92.1 and the owner's captures: a modal over the blurred screen,
 * 768px wide with a 12px radius in the muted fill; a 48px top row with the project name and its chevron, a
 * "···" button and, at the right, the create-from control (two round marks and a chevron, or the chosen
 * branch, pull request or issue); a borderless text area with "What do you want to work on?"; a bottom
 * row with the model menu at the left, then "+", the outlined "Add to backlog ⌥↵" and the 24px "Create ↵"
 * split button whose chevron lists the sections under "Create in section" (renderApp @10145385). Escape or a
 * click outside closes it and returns to the screen it opened over. ui-map.md 3.9 (New workspace flow), 5.4
 * (Cmd+I toggles the create-from picker, Alt+Enter adds the draft to the backlog, and Cmd+Enter
 * starts a backlog workspace).
 * Our design choice: the page marks itself as a dialog scope, so inside it Cmd+Enter arrives as
 * "Confirm the open dialog"; in start mode Start answers that command as well as its own.
 * Our design choice: the dialog keeps the first message in a plain textarea until the composer editor can be
 * reused outside a chat. Conductor's "+" also adds attachments; ours offers plan mode only, because an
 * attachment is staged into a chat and none exists yet. Conductor shows "Add to backlog" for cloud
 * organisations only; ours shows it whenever unstarted workspaces are on.
 * Must handle: no project yet (point to "Add a project"); a failed create keeps the draft with Retry setup
 * and Recover prompt; creation warnings are toasted; an empty prompt creates the workspace without a chat;
 * "Create from" a branch with no branch name is refused with a message under the field; a pull request that
 * was not loaded and an issue that was not picked are refused with a message; a second press while a create,
 * a backlog save or a start runs does nothing; "Add to backlog" is hidden when unstarted workspaces are off;
 * in start mode every field shows the saved row and is locked, because Start creates from that row, and
 * Alt+Enter does not save a second copy.
 * CLOUD-19, cloud mode: while the cloud entry is the active organisation, the page works out its
 * hosting target as Conductor's `BXa` does (renderApp @11497335): the Worker, once it is ready and
 * data privacy is off. In the cloud the top row's project picker becomes the repository picker
 * ("Repository", "Select repo", "Repository on <Worker>", "Add repository"), listing the projects
 * the Worker can clone; until the Worker is ready the row shows the status line of Conductor's
 * `AYa` in the warning tone, the create-from control is hidden, and Create is off with Conductor's
 * reason as its tooltip ("Checking organization...", the data-privacy text, or `OYa`'s readiness
 * reason). Data privacy adds "Cloud disabled" at the right. The create call names the Worker
 * (`cloudUrl`) and goes through the same action as a local one.
 * Our design choice: Conductor's "Connect GitHub" and "Set up an agent" actions open its own
 * GitHub and providers flows, which set its service's credentials; a Worker's GitHub token and
 * model key are Worker secrets the app cannot set, so those two lines carry no action. "View
 * computer" opens the Connections page, where the Worker is paired, and "Add one" and "Add
 * repository" open Open GitHub project. Conductor's restricted-access toggle and its cloud backlog
 * are team and service features, so in cloud mode the page has neither (D127).
 * Test first: submitting with a repository and a prompt calls workspaces.create with that input and navigates to
 * the new workspace; a failed create offers Retry setup and Recover prompt; Alt+Enter saves the draft to
 * the backlog.
 */
import type { RepoId, SectionId, WorkspaceId } from "@conducted/shared";
import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { NewWorkspaceInput } from "../core/api.ts";
import { createSingleFlight } from "../core/async/single-flight.ts";
import { useServices } from "../core/context.tsx";
import {
	useActions,
	useBacklogWorkspaces,
	useBranches,
	useCloudReadiness,
	useIssues,
	useOrganizations,
	usePreWorkspaceSlashCommands,
	usePullRequestList,
	useRepoFileSearch,
	useRepos,
	useSetting,
} from "../core/hooks.ts";
import type { IssueView, PullRequestSummary, Section } from "../core/model.ts";
import {
	CHECKING_ORGANIZATION,
	CLOUD_UNAVAILABLE_WITH_DATA_PRIVACY,
	type CloudLaunchState,
	type CloudRepository,
	cloudLaunchDisabledReason,
	cloudLaunchState,
	cloudLaunchStatusLine,
	cloudRepositories,
} from "../core/organization.ts";
import { newWorkspaceSessionConfig } from "../core/services/workspace.ts";
import { useNewWorkspaceDraft } from "../features/composer/draft-sources.ts";
import { type ModelChoice, ModelMenu } from "../features/composer/ModelPicker.tsx";
import { SuggestionPopup } from "../features/composer/mentions/SuggestionPopup.tsx";
import { AddProjectActions } from "../features/sidebar/AddProjectActions.tsx";
import { AddProjectItems, useAddProject } from "../features/sidebar/AddProjectButton.tsx";
import { Button } from "../ui/Button.tsx";
import { cn } from "../ui/cn.ts";
import { Dialog, DialogContent } from "../ui/Dialog.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Input, Label } from "../ui/Input.tsx";
import {
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	CircleIcon,
	FolderIcon,
	GitBranchIcon,
	MoreHorizontalIcon,
	PlusIcon,
	PullRequestIcon,
} from "../ui/icons.tsx";
import {
	Menu,
	MenuCheckboxItem,
	MenuContent,
	MenuItem,
	MenuLabel,
	MenuTrigger,
} from "../ui/Menu.tsx";
import { Select } from "../ui/Select.tsx";
import { Spinner } from "../ui/Spinner.tsx";
import { toast, toastError } from "../ui/Toast.tsx";
import { ToggleGroup, ToggleGroupItem } from "../ui/Toggle.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import { useCommandHandler } from "./command-dispatcher.ts";

type FromKind = "default" | "branch" | "pull_request" | "issue";

/** Conductor's "Create from" tabs, in its order (renderApp @11459154). None chosen means the default branch. */
const FROM_TABS: readonly { value: Exclude<FromKind, "default">; label: string }[] = [
	{ value: "pull_request", label: "PRs" },
	{ value: "branch", label: "Branches" },
	{ value: "issue", label: "Issues" },
];
type IssueProvider = IssueView["provider"];

/** The loaded project a link names, by id or by name. */
function namedRepo<T extends { id: RepoId; name: string }>(
	repos: readonly T[],
	named: string,
): T | undefined {
	return repos.find((repo) => repo.id === named || repo.name === named);
}

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
	const router = useRouter();
	// Closing the dialog returns to the screen it opened over, or Home when it was opened directly.
	const close = () => {
		if (window.history.length > 1) router.history.back();
		else void navigate({ to: "/" });
	};
	const search = useSearch({ strict: false }) as {
		section?: string;
		backlog?: string;
		repo?: string;
		branch?: string;
		prompt?: string;
	};

	const defaultModel = useSetting<string>("default_model");
	const defaultEffort = useSetting<string>("default_claude_effort_level");
	const defaultFastMode = useSetting<boolean>("default_fast_mode");
	const defaultPlanMode = useSetting<boolean>("default_plan_mode");
	const toolApprovals = useSetting<boolean>("tool_approvals_enabled");
	// Conductor gates the backlog behind its unstarted-workspaces switch (the settings registry).
	const backlogEnabled = useSetting<boolean>("unstarted_workspaces_enabled");
	const sections: readonly Section[] = useStore(
		services.services.sections.store,
		(state) => state.sections,
	);
	const backlog = useBacklogWorkspaces();
	const startMode = search.backlog !== undefined;
	const backlogEntry =
		search.backlog === undefined || backlog.state !== "ready"
			? undefined
			: backlog.data.find((entry) => entry.id === search.backlog);

	// The project a link names is looked up in the loaded list, never taken from the URL as is.
	const [repoId, setRepoId] = useState<RepoId | null>(() =>
		repos.state === "ready" && search.repo !== undefined
			? (namedRepo(repos.data, search.repo)?.id ?? null)
			: null,
	);
	const [fromKind, setFromKind] = useState<FromKind>(
		search.branch === undefined ? "default" : "branch",
	);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [optionsOpen, setOptionsOpen] = useState(false);
	const [branchName, setBranchName] = useState(search.branch ?? "");
	const [showBranchList, setShowBranchList] = useState(false);
	const [selectedPullRequest, setSelectedPullRequest] = useState<PullRequestSummary | null>(null);
	const [issueProvider, setIssueProvider] = useState<IssueProvider>("github");
	const [selectedIssue, setSelectedIssue] = useState<IssueView | null>(null);
	const [prompt, setPrompt] = useState(search.prompt ?? "");
	const [mention, setMention] = useState<FileMentionQuery | null>(null);
	const [slashMention, setSlashMention] = useState<FileMentionQuery | null>(null);
	// The first chat's agent, model, effort and fast mode, chosen in the same menu as the composer's.
	const [choice, setChoice] = useState<ModelChoice>(() => {
		const config = newWorkspaceSessionConfig({
			model: defaultModel,
			effort: defaultEffort,
			fastMode: defaultFastMode,
			planMode: false,
			requireToolApproval: false,
		});
		return {
			agent: config.agent,
			acpAgent: config.acpAgent,
			model: config.model,
			effort: config.effort,
			fastMode: config.fastMode,
		};
	});
	const [planMode, setPlanMode] = useState(defaultPlanMode);
	const [sectionId, setSectionId] = useState(() => search.section ?? "");
	const [busy, setBusy] = useState(false);
	const [failedId, setFailedId] = useState<WorkspaceId | null>(null);
	const [branchTouched, setBranchTouched] = useState(false);
	const flight = useRef(createSingleFlight()).current;
	const backfilled = useRef<string | null>(null);
	const newWorkspaceDraft = useNewWorkspaceDraft();
	const draftRestored = useRef(false);
	const promptTouched = useRef(false);

	const readyRepos = repos.state === "ready" ? repos.data : [];
	const localRepo = readyRepos.find((repo) => repo.id === repoId) ?? readyRepos[0];

	// CLOUD-19: where the workspace runs, as Conductor's BXa works it out. The cloud is the target
	// only once the Worker is ready and data privacy is off; until then Create says why it is off.
	const organizations = useOrganizations();
	const dataPrivacy = useSetting<boolean>("enterprise_data_privacy");
	const activeOrganization = organizations.state === "ready" ? organizations.data.active : null;
	const cloudUrl = activeOrganization?.isCloud === true ? activeOrganization.url : null;
	const isCloudOrg = cloudUrl !== null;
	const cloudRepos = useMemo(() => cloudRepositories(readyRepos), [readyRepos]);
	const readiness = useCloudReadiness(cloudUrl);
	const launch: CloudLaunchState | null =
		cloudUrl === null
			? null
			: cloudLaunchState({ url: cloudUrl, readiness, repositoryCount: cloudRepos.length });
	const cloudTarget = launch?.kind === "ready" && !dataPrivacy ? launch.url : null;
	const cloudMode = cloudTarget !== null;
	const launchDisabledReason =
		organizations.state === "loading"
			? CHECKING_ORGANIZATION
			: launch === null
				? undefined
				: dataPrivacy
					? CLOUD_UNAVAILABLE_WITH_DATA_PRIVACY
					: cloudLaunchDisabledReason(launch);
	const [cloudRepoId, setCloudRepoId] = useState<RepoId | null>(null);
	const cloudRepo = cloudRepos.find((entry) => entry.repo.id === cloudRepoId) ?? cloudRepos[0];
	// In the cloud the page works on the repository the Worker will clone.
	const selectedRepo = cloudMode && cloudRepo !== undefined ? cloudRepo.repo : localRepo;
	const addRepository = useAddProject({ onAdded: (repo) => setCloudRepoId(repo.id) });

	useEffect(() => {
		if (repoId === null && readyRepos[0] !== undefined) setRepoId(readyRepos[0].id);
	}, [repoId, readyRepos]);

	// A link to /create names its project in the URL. Resolve it once the list has loaded, and again
	// when a later link names another project while this page stays open. A project that is not
	// loaded is reported once per link, so the user knows the page did not open on it.
	const repoFromSearch = search.repo;
	const reportedMissingRepo = useRef<string | null>(null);
	const reposReady = repos.state === "ready";
	useEffect(() => {
		if (repoFromSearch === undefined || !reposReady) return;
		const named = namedRepo(readyRepos, repoFromSearch);
		if (named !== undefined) {
			setRepoId(named.id);
			return;
		}
		if (reportedMissingRepo.current === repoFromSearch) return;
		reportedMissingRepo.current = repoFromSearch;
		toastError("Repository not found", {
			message: `There is no project called "${repoFromSearch}".`,
		});
	}, [readyRepos, repoFromSearch, reposReady]);

	const promptFromSearch = search.prompt;
	useEffect(() => {
		if (promptFromSearch !== undefined) setPrompt(promptFromSearch);
	}, [promptFromSearch]);

	// Restore the new-workspace draft once, unless a link already filled the field or the user typed
	// before the saved draft arrived. Then keep every edit in the composer store, so the Create row
	// marks it. A backlog workspace starts from its saved row, so it never touches this draft.
	useEffect(() => {
		if (!newWorkspaceDraft.loaded || draftRestored.current) return;
		draftRestored.current = true;
		if (startMode || promptTouched.current || promptFromSearch !== undefined) return;
		setPrompt(newWorkspaceDraft.draft.text);
	}, [newWorkspaceDraft.loaded, newWorkspaceDraft.draft.text, promptFromSearch, startMode]);
	useEffect(() => {
		if (startMode || !newWorkspaceDraft.loaded || !draftRestored.current) return;
		// Do not clear a saved draft with the first render's empty field before it is restored.
		if (!promptTouched.current && prompt === "" && newWorkspaceDraft.draft.text !== "") return;
		newWorkspaceDraft.save({ text: prompt, attachmentPaths: [] });
	}, [
		prompt,
		startMode,
		newWorkspaceDraft.loaded,
		newWorkspaceDraft.draft.text,
		newWorkspaceDraft.save,
	]);

	const branchFromSearch = search.branch;
	useEffect(() => {
		if (branchFromSearch === undefined) return;
		setBranchName(branchFromSearch);
		setFromKind("branch");
		setPickerOpen(true);
	}, [branchFromSearch]);

	useCommandHandler("workspace.toggleCreateFromPicker", "modal", () => {
		setPickerOpen((open) => !open);
		return true;
	});

	// A "Create in section" link on the sidebar names the section in the URL.
	const sectionFromSearch = search.section ?? "";
	useEffect(() => {
		if (sectionFromSearch !== "") setSectionId(sectionFromSearch);
	}, [sectionFromSearch]);

	// A backlog workspace opens this page with its saved draft, once.
	useEffect(() => {
		if (backlogEntry === undefined || backfilled.current === backlogEntry.id) return;
		backfilled.current = backlogEntry.id;
		setRepoId(backlogEntry.repoId);
		setFromKind("default");
		setPrompt(backlogEntry.prompt);
		setChoice({
			agent: backlogEntry.config.agent,
			acpAgent: backlogEntry.config.acpAgent,
			model: backlogEntry.config.model,
			effort: backlogEntry.config.effort,
			fastMode: backlogEntry.config.fastMode,
		});
		setPlanMode(backlogEntry.config.planMode);
		setSectionId(backlogEntry.sectionId ?? "");
	}, [backlogEntry]);

	useCommandHandler("workspace.addToBacklog", "modal", () => {
		if (!backlogEnabled || busy || startMode) return false;
		void saveToBacklog();
		return true;
	});
	// The page is a dialog scope, where Cmd+Enter is "Confirm the open dialog" before it is the
	// global "Start the backlog workspace". In start mode, Start is this page's confirm, so it
	// answers both: the first from a field on the page, the second from anywhere else.
	const startFromKey = () => {
		if (!startMode || backlogEntry === undefined || busy) return false;
		void submit();
		return true;
	};
	useCommandHandler("workspace.startFromBacklog", "modal", startFromKey);
	useCommandHandler("dialog.confirm", "modal", startFromKey);

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
					action={<AddProjectActions />}
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
	// A backlog workspace starts from its saved row, so the fields show it and cannot be edited.
	// The text fields are read-only rather than disabled, so focus and Cmd+Enter still work.
	const fieldsLocked = busy || startMode;

	function makeInput(
		repo: typeof selectedRepo,
		section: string = sectionId,
	): NewWorkspaceInput | null {
		if (repo === undefined) {
			toast.error("No repository selected");
			return null;
		}
		if (branchMissing) {
			setBranchTouched(true);
			return null;
		}
		let from: NewWorkspaceInput["from"] = { kind: "default" };
		if (fromKind === "branch") from = { kind: "branch", name: branchName.trim() };
		if (fromKind === "pull_request") {
			if (selectedPullRequest === null) {
				toast.error("Could not load that pull request");
				return null;
			}
			from = { kind: "pull_request", number: selectedPullRequest.number };
		}
		if (fromKind === "issue") {
			if (selectedIssue === null) {
				toast.error("Could not load that issue");
				return null;
			}
			from = { kind: "issue", provider: selectedIssue.provider, id: selectedIssue.id };
		}
		const config = {
			...newWorkspaceSessionConfig({
				model: choice.model,
				effort: choice.effort,
				fastMode: choice.fastMode,
				planMode,
				requireToolApproval: toolApprovals,
			}),
			agent: choice.agent,
			acpAgent: choice.acpAgent,
		};
		return {
			repoId: repo.id,
			from,
			prompt,
			attachmentPaths: [],
			config,
			sectionId: section === "" ? null : (section as SectionId),
			...(cloudTarget === null ? {} : { cloudUrl: cloudTarget }),
		};
	}

	async function saveToBacklog() {
		const input = makeInput(selectedRepo);
		if (input === null) return;
		await flight.run("backlog", async () => {
			setBusy(true);
			const result = await actions.workspaces.addToBacklog(input);
			setBusy(false);
			if (!result.ok) {
				toastError("Couldn't add to backlog", result.error);
				return;
			}
			toast.success("Added to backlog");
			newWorkspaceDraft.clear();
			void navigate({ to: "/backlog" });
		});
	}

	async function submit(section: string = sectionId) {
		if (startMode) {
			if (backlogEntry === undefined) {
				toast.error("That backlog workspace no longer exists");
				return;
			}
			await flight.run("start", async () => {
				setBusy(true);
				const progress = toast("Starting workspace…");
				const result = await actions.workspaces.startFromBacklog(backlogEntry.id);
				toast.dismiss(progress);
				setBusy(false);
				if (!result.ok) {
					toastError("Failed to start workspace", result.error);
					return;
				}
				toastWarnings(result.value.id);
				openWorkspace(result.value.repoId, result.value.id);
			});
			return;
		}
		// Create is off while the page says why; Enter in a field must not get past it.
		if (launchDisabledReason !== undefined) return;
		const input = makeInput(selectedRepo, section);
		if (input === null) return;
		await flight.run("create", async () => {
			setFailedId(null);
			setBusy(true);
			const progress = toast("Creating workspace…");
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
			newWorkspaceDraft.clear();
			openWorkspace(result.value.repoId, result.value.id);
		});
	}

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
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) close();
			}}
		>
			<DialogContent
				title="New workspace"
				hideTitle
				size="3xl"
				className="gap-0! rounded-xl! bg-muted! p-0!"
			>
				<form
					data-command-scope="dialog"
					className="flex flex-col"
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<header
						className={cn(
							"flex h-12 items-center gap-1 border-b border-border px-3",
							isCloudOrg && !cloudMode && launch?.kind !== "loading" && "bg-warning-surface",
						)}
					>
						{cloudMode && cloudRepo !== undefined ? (
							<CloudRepositoryMenu
								repositories={cloudRepos}
								selected={cloudRepo}
								machineName={activeOrganization?.label ?? ""}
								disabled={fieldsLocked}
								onPick={(value) => {
									setCloudRepoId(value);
									setSelectedPullRequest(null);
									setSelectedIssue(null);
									setShowBranchList(false);
									setMention(null);
									setSlashMention(null);
								}}
								onAddRepository={addRepository.openClone}
							/>
						) : isCloudOrg && launch !== null ? (
							<CloudLaunchStatus
								launch={launch}
								onViewComputer={() =>
									void navigate({
										to: "/settings/user/$page",
										params: { page: "connections" },
									})
								}
								onAddRepository={addRepository.openClone}
							/>
						) : isCloudOrg ? null : (
							<ProjectMenu
								repos={readyRepos}
								selected={selectedRepo}
								disabled={fieldsLocked}
								onPick={(value) => {
									setRepoId(value);
									setSelectedPullRequest(null);
									setSelectedIssue(null);
									setShowBranchList(false);
									setMention(null);
									setSlashMention(null);
								}}
							/>
						)}
						{addRepository.dialogs}
						<Button
							type="button"
							variant="ghost"
							size="xs"
							aria-label="More options"
							aria-expanded={optionsOpen}
							aria-controls="create-options"
							onClick={() => setOptionsOpen((open) => !open)}
						>
							<MoreHorizontalIcon className="size-3.5" />
						</Button>
						<span className="flex-1" />
						{isCloudOrg && dataPrivacy ? (
							<Tooltip content={CLOUD_UNAVAILABLE_WITH_DATA_PRIVACY}>
								<span className="flex shrink-0 items-center text-sm font-medium text-fg-muted">
									Cloud disabled
								</span>
							</Tooltip>
						) : null}
						{isCloudOrg && !cloudMode ? null : (
							<button
								type="button"
								aria-label="Show or hide the create-from picker"
								aria-expanded={pickerOpen}
								aria-controls="create-from-picker"
								disabled={fieldsLocked}
								title="Create from"
								className="-mr-1.5 flex h-7 min-w-0 max-w-72 items-center gap-1.5 rounded-md px-1.5 text-fg outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-focus aria-expanded:bg-hover disabled:opacity-50"
								onClick={() => setPickerOpen((open) => !open)}
							>
								<FromSource
									kind={fromKind}
									branch={branchName.trim()}
									pullRequest={selectedPullRequest}
									issue={selectedIssue}
								/>
								<ChevronDownIcon className="size-3.5 shrink-0 text-fg-muted" />
							</button>
						)}
					</header>

					{startMode ? (
						<p className="px-4 pt-3 text-xs text-fg-muted">
							This workspace starts as it was saved to the backlog.
						</p>
					) : null}

					{pickerOpen && (!isCloudOrg || cloudMode) ? (
						<div
							id="create-from-picker"
							className="flex flex-col gap-3 border-b border-border px-4 py-3"
						>
							<div className="flex items-center justify-between gap-2">
								<span id="create-workspace-from" className="text-sm font-medium text-fg">
									Create from
								</span>
								{fromKind === "default" ? (
									<span className="truncate text-xs text-fg-muted">
										Starts from {selectedRepo.defaultBranch}
									</span>
								) : null}
							</div>
							<ToggleGroup
								type="single"
								aria-labelledby="create-workspace-from"
								value={fromKind === "default" ? "" : fromKind}
								onValueChange={(value) =>
									setFromKind(value === "" ? "default" : (value as FromKind))
								}
								disabled={fieldsLocked}
								className="gap-1"
							>
								{FROM_TABS.map((tab) => (
									<ToggleGroupItem
										key={tab.value}
										value={tab.value}
										size="sm"
										className="h-7 px-2.5 text-fg-muted hover:text-fg data-[state=on]:bg-muted data-[state=on]:text-fg"
									>
										{tab.label}
									</ToggleGroupItem>
								))}
							</ToggleGroup>

							{fromKind === "branch" ? (
								<div className="flex flex-col gap-2">
									<Label htmlFor="create-workspace-branch">Branch name</Label>
									<Input
										id="create-workspace-branch"
										value={branchName}
										onChange={(event) => setBranchName(event.target.value)}
										placeholder={selectedRepo.defaultBranch}
										disabled={fieldsLocked}
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
										disabled={fieldsLocked}
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

					{optionsOpen ? (
						<div
							id="create-options"
							className="flex flex-wrap items-end gap-4 border-b border-border px-4 py-3"
						>
							<div className="flex w-60 flex-col gap-1.5">
								<Label htmlFor="create-workspace-section">Create in section</Label>
								<Select
									id="create-workspace-section"
									value={sectionId}
									options={sectionOptions}
									onValueChange={setSectionId}
									disabled={fieldsLocked || sections.length === 0}
								/>
							</div>
							{backlogEnabled ? (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => void navigate({ to: "/backlog" })}
								>
									Backlog
								</Button>
							) : null}
						</div>
					) : null}

					<div className="relative px-4 pt-4">
						<label htmlFor="create-workspace-prompt" className="sr-only">
							First message
						</label>
						<textarea
							id="create-workspace-prompt"
							aria-label="First message"
							value={prompt}
							onChange={(event) => {
								const caret = event.target.selectionStart ?? event.target.value.length;
								promptTouched.current = true;
								setPrompt(event.target.value);
								setMention(fileMentionAt(event.target.value, caret));
								setSlashMention(slashMentionAt(event.target.value, caret));
							}}
							onKeyDown={(event) => {
								if (event.key === "Escape" && (mention !== null || slashMention !== null)) {
									event.stopPropagation();
									setMention(null);
									setSlashMention(null);
								}
							}}
							placeholder="What do you want to work on?"
							disabled={busy}
							readOnly={startMode}
							autoFocus
							className="block min-h-40 w-full resize-none bg-transparent text-sm font-light text-fg outline-none placeholder:text-fg-subtle"
						/>
						{mention !== null && mention.query.length >= 2 && (!isCloudOrg || cloudMode) ? (
							<RepoFileSuggestions
								repoId={selectedRepo.id}
								query={mention.query}
								onPick={(path) => {
									setPrompt(
										`${prompt.slice(0, mention.start)}@${path} ${prompt.slice(mention.end)}`,
									);
									setMention(null);
								}}
							/>
						) : null}
						{slashMention !== null && (!isCloudOrg || cloudMode) ? (
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

					{failedId === null ? null : (
						<div
							role="alert"
							className="mx-4 mt-3 flex flex-col gap-3 rounded-lg border border-border bg-raised p-4"
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

					<footer className="flex items-center gap-2 px-3 pt-2 pb-3">
						<ModelMenu
							config={choice}
							started={false}
							onApply={setChoice}
							scope="new-workspace"
							disabled={fieldsLocked}
						/>
						<span className="flex-1" />
						<Menu>
							<MenuTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="xs"
									aria-label="Add"
									title="Plan mode and more"
									disabled={fieldsLocked}
									className="w-6 px-0 text-fg-muted"
								>
									<PlusIcon className="size-4" />
								</Button>
							</MenuTrigger>
							<MenuContent side="top" align="end">
								<MenuCheckboxItem
									checked={planMode}
									disabled={fieldsLocked}
									onCheckedChange={(checked) => setPlanMode(checked === true)}
								>
									Plan mode
								</MenuCheckboxItem>
							</MenuContent>
						</Menu>
						{startMode ? (
							<Button
								type="button"
								variant="outline"
								size="xs"
								onClick={() => void navigate({ to: "/backlog" })}
							>
								Cancel
							</Button>
						) : backlogEnabled && !isCloudOrg ? (
							<Button
								type="button"
								variant="outline"
								size="xs"
								aria-label="Add to backlog"
								title="Add to backlog ⌥↵"
								disabled={busy}
								onClick={() => void saveToBacklog()}
							>
								Add to backlog
								<span aria-hidden="true" className="text-xs">
									⌥↵
								</span>
							</Button>
						) : null}
						<div className="flex items-center">
							<LaunchReason reason={startMode ? undefined : launchDisabledReason}>
								<Button
									type="submit"
									size="xs"
									loading={busy}
									disabled={!startMode && launchDisabledReason !== undefined}
									aria-label={startMode ? "Start" : "Create workspace"}
									title={startMode ? "Start workspace ↵" : "Create workspace ↵"}
									className={cn("text-sm", !startMode && sections.length > 0 && "rounded-r-none")}
								>
									{startMode ? "Start" : "Create"}
									<span aria-hidden="true" className="text-xs">
										↵
									</span>
								</Button>
							</LaunchReason>
							{!startMode && sections.length > 0 ? (
								<Menu>
									<MenuTrigger asChild>
										<Button
											type="button"
											size="xs"
											aria-label="Create in section"
											title="Create in section"
											disabled={busy || launchDisabledReason !== undefined}
											className="w-6 rounded-l-none border-l border-canvas/20 px-0"
										>
											<ChevronDownIcon className="size-3.5" />
										</Button>
									</MenuTrigger>
									<MenuContent side="top" align="end" className="w-56">
										<MenuLabel>Create in section</MenuLabel>
										{sections.map((section) => (
											<MenuItem
												key={section.id}
												onSelect={() => {
													setSectionId(section.id);
													void submit(section.id);
												}}
											>
												<span className="min-w-0 truncate">{section.name}</span>
											</MenuItem>
										))}
									</MenuContent>
								</Menu>
							) : null}
						</div>
					</footer>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Create with the reason it is off, as Conductor wraps its launch button (renderApp `Xxa`
 * @10147045): a focusable span that carries the reason as its tooltip and its accessible name.
 */
function LaunchReason({
	reason,
	children,
}: {
	reason: string | undefined;
	children: ReactElement;
}) {
	if (reason === undefined) return children;
	return (
		<Tooltip content={reason}>
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex lint/a11y/useSemanticElements: the disabled button cannot take focus, so its reason needs a named stop of its own, as Conductor's does; a fieldset would change the button's layout and form semantics. */}
			<span role="group" tabIndex={0} aria-label={reason} className="inline-flex cursor-help">
				{children}
			</span>
		</Tooltip>
	);
}

/**
 * The top row's line while the cloud is not ready, in Conductor's words and warning tone
 * (renderApp `AYa` and `uL` @11438719): a spinner while the Worker is checked, else the reason with
 * the action that applies to our Worker.
 */
function CloudLaunchStatus({
	launch,
	onViewComputer,
	onAddRepository,
}: {
	launch: CloudLaunchState;
	onViewComputer: () => void;
	onAddRepository: () => void;
}) {
	const line = cloudLaunchStatusLine(launch);
	const action =
		launch.kind === "machine-not-ready"
			? { label: "View computer", onClick: onViewComputer }
			: launch.kind === "no-repos"
				? { label: "Add one", onClick: onAddRepository }
				: null;
	return (
		<div className="-ml-1.5 flex h-7 min-w-0 items-center gap-1.5 px-1.5 text-sm">
			{launch.kind === "loading" ? (
				<Spinner size="sm" label="Checking machine availability" />
			) : null}
			{line === undefined ? null : <span className="min-w-0 truncate text-warning-fg">{line}</span>}
			{action === null ? null : (
				<button
					type="button"
					onClick={action.onClick}
					className="flex shrink-0 items-center gap-1 rounded-sm font-medium text-warning hover:text-warning-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus"
				>
					{action.label}
					<ChevronRightIcon className="size-3.5" />
				</button>
			)}
		</div>
	);
}

/**
 * The cloud repository picker (renderApp `zZi` @10190788): the chosen repository's name and a
 * chevron, the tooltip "Repository on <Worker>", and a menu of the repositories the Worker can clone
 * with "Add repository" after them.
 */
function CloudRepositoryMenu({
	repositories,
	selected,
	machineName,
	disabled,
	onPick,
	onAddRepository,
}: {
	repositories: readonly CloudRepository[];
	selected: CloudRepository;
	machineName: string;
	disabled: boolean;
	onPick: (id: RepoId) => void;
	onAddRepository: () => void;
}) {
	return (
		<Menu>
			<Tooltip content={`Repository on ${machineName}`}>
				<MenuTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={disabled}
						aria-label="Repository"
						className="max-w-80 gap-1.5 px-2 text-sm font-medium text-fg"
					>
						<span className="min-w-0 truncate">{selected.label}</span>
						<ChevronDownIcon className="size-3.5 shrink-0 text-fg-muted" />
					</Button>
				</MenuTrigger>
			</Tooltip>
			<MenuContent align="start" className="w-72">
				{repositories.map((entry) => (
					<MenuItem
						key={entry.repo.id}
						icon={entry.repo.id === selected.repo.id ? <CheckIcon /> : <span />}
						onSelect={() => onPick(entry.repo.id)}
					>
						{entry.label}
					</MenuItem>
				))}
				<MenuItem icon={<PlusIcon />} onSelect={onAddRepository}>
					Add repository
				</MenuItem>
			</MenuContent>
		</Menu>
	);
}

/**
 * What the create-from control shows, as Conductor draws it (renderApp @11449595): two overlapping round
 * marks while the workspace starts from the default branch, the branch icon and name for a branch, a
 * "PR #n" chip and the title for a pull request, and the identifier and title for an issue.
 * Our design choice: the two marks are our own pull-request and issue glyphs; Conductor's are the
 * Linear and GitHub logos, which are not ours to copy (D002).
 */
function FromSource({
	kind,
	branch,
	pullRequest,
	issue,
}: {
	kind: FromKind;
	branch: string;
	pullRequest: PullRequestSummary | null;
	issue: IssueView | null;
}) {
	if (kind === "branch" && branch !== "") {
		return (
			<>
				<GitBranchIcon className="size-4 shrink-0 text-fg-muted" />
				<span className="truncate text-sm font-medium">{branch}</span>
			</>
		);
	}
	if (kind === "pull_request" && pullRequest !== null) {
		return (
			<>
				<span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-xs font-medium">
					PR #{pullRequest.number}
				</span>
				<span className="truncate text-sm">{pullRequest.title}</span>
			</>
		);
	}
	if (kind === "issue" && issue !== null) {
		return (
			<>
				<span className="shrink-0 font-mono text-xs text-fg-muted">{issue.identifier}</span>
				<span className="truncate text-sm">{issue.title}</span>
			</>
		);
	}
	return (
		<span aria-hidden="true" className="flex shrink-0 -space-x-1">
			<span className="flex size-4 items-center justify-center rounded-full border border-canvas bg-raised text-fg">
				<CircleIcon className="size-2.5" />
			</span>
			<span className="flex size-4 items-center justify-center rounded-full border border-canvas bg-fg text-canvas">
				<PullRequestIcon className="size-2.5" />
			</span>
		</span>
	);
}

/** "~/code/project" for a folder under the home folder. */
function shortPath(path: string): string {
	const home = /^\/Users\/[^/]+/.exec(path)?.[0];
	return home === undefined ? path : `~${path.slice(home.length)}`;
}

/**
 * The project picker at the top of the new-workspace dialog: the chosen project's name; its menu adds a
 * project (Open project, Open GitHub project, Quick start) or picks one of the projects under "Recents".
 */
function ProjectMenu({
	repos,
	selected,
	disabled,
	onPick,
}: {
	repos: readonly { id: RepoId; name: string; rootPath: string }[];
	selected: { id: RepoId; name: string };
	disabled: boolean;
	onPick: (id: RepoId) => void;
}) {
	// Added from here, a project becomes this page's choice rather than opening a workspace, as
	// Conductor's new-workspace dialog keeps it (renderApp @1713146, the consume() branch).
	const add = useAddProject({ onAdded: (repo) => onPick(repo.id) });
	return (
		<>
			<Menu>
				<MenuTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={disabled}
						aria-label={`Project: ${selected.name}`}
						className="gap-1.5 px-2 text-sm font-medium text-fg"
					>
						<span className="max-w-60 truncate">{selected.name}</span>
						<ChevronDownIcon className="size-3 shrink-0 text-fg-muted" />
					</Button>
				</MenuTrigger>
				<MenuContent align="start" className="w-80">
					<AddProjectItems add={add} />
					<MenuLabel>Recents</MenuLabel>
					{repos.map((repo) => (
						<MenuItem
							key={repo.id}
							icon={<FolderIcon />}
							onSelect={() => onPick(repo.id)}
							className="text-xs"
						>
							<span className="truncate" title={repo.name}>
								{shortPath(repo.rootPath)}
							</span>
						</MenuItem>
					))}
				</MenuContent>
			</Menu>
			{add.dialogs}
		</>
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
