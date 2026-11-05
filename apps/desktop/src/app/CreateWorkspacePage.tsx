/**
 * @feature WS-01 Create-workspace page
 * Owns: the full-page "new workspace" flow at /create: repository picker, "create from" (default branch or
 * branch), first message editor with a model field and plan mode, section picker, and the "Create workspace"
 * button.
 * Behaviour: ui-map.md 3.9 (New workspace flow; "Draft the first message, then create and send it.").
 * Our design choice: the page keeps the first message in a plain textarea until the composer editor can be
 * reused outside a chat; attachments wait for COMP-07. Pull request and issue bases wait for WS-02.
 * Must handle: no project yet (point to "Add a project"); a failed create keeps the draft ("Recover prompt");
 * creating shows progress and then opens the new workspace; an empty prompt creates the workspace without a chat.
 * Test first: submitting with a repository and a prompt calls workspaces.create with that input and navigates to
 * the new workspace.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { RepoId, SectionId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { NewWorkspaceInput } from "../core/api.ts";
import { useServices } from "../core/context.tsx";
import { useActions, useRepos, useSetting } from "../core/hooks.ts";
import type { Section } from "../core/model.ts";
import { AddProjectButton } from "../features/sidebar/AddProjectButton.tsx";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Input, Label, Textarea } from "../ui/Input.tsx";
import { Select } from "../ui/Select.tsx";
import { toast, toastError } from "../ui/Toast.tsx";

type FromKind = "default" | "branch";

export function CreateWorkspacePage(_props: Record<string, never>) {
	const actions = useActions();
	const repos = useRepos();
	const services = useServices();
	const navigate = useNavigate();

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
	const [branchName, setBranchName] = useState("");
	const [prompt, setPrompt] = useState("");
	const [model, setModel] = useState(defaultModel);
	const [planMode, setPlanMode] = useState(defaultPlanMode);
	const [sectionId, setSectionId] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const readyRepos = repos.state === "ready" ? repos.data : [];
	const selectedRepo = readyRepos.find((repo) => repo.id === repoId) ?? readyRepos[0];

	useEffect(() => {
		if (repoId === null && readyRepos[0] !== undefined) setRepoId(readyRepos[0].id);
	}, [repoId, readyRepos]);

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

	const submit = async () => {
		if (busy || selectedRepo === undefined) return;
		setError(null);
		setBusy(true);
		toast("Creating workspace…");
		const config: SessionConfig = {
			agent: "claude",
			model: model.trim() === "" ? "default" : model.trim(),
			effort: (defaultEffort === "" ? "high" : defaultEffort) as SessionConfig["effort"],
			fastMode: defaultFastMode,
			planMode,
			requireToolApproval: toolApprovals,
			additionalDirectories: [],
			appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
		};
		const input: NewWorkspaceInput = {
			repoId: selectedRepo.id,
			from: fromKind === "branch" ? { kind: "branch", name: branchName } : { kind: "default" },
			prompt,
			attachmentPaths: [],
			config,
			sectionId: sectionId === "" ? null : (sectionId as SectionId),
		};
		const result = await actions.workspaces.create(input);
		setBusy(false);
		if (!result.ok) {
			setError(result.error.message);
			toastError("Failed to create workspace", result.error);
			return;
		}
		void navigate({
			to: "/repository/$repositoryId/workspace/$workspaceId",
			params: {
				repositoryId: result.value.repoId,
				workspaceId: result.value.id,
			},
		});
	};

	const sectionOptions = [
		{ value: "", label: sections.length === 0 ? "No sections yet" : "No section" },
		...sections.map((section) => ({ value: section.id, label: section.name })),
	];

	return (
		<div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-6 overflow-y-auto p-8">
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
						onValueChange={(value) => setRepoId(value as RepoId)}
						disabled={busy}
					/>
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="create-workspace-from">Create from</Label>
					<Select<FromKind>
						id="create-workspace-from"
						value={fromKind}
						options={[
							{ value: "default", label: `Default branch (${selectedRepo.defaultBranch})` },
							{ value: "branch", label: "Branch" },
						]}
						onValueChange={setFromKind}
						disabled={busy}
					/>
				</div>

				{fromKind === "branch" ? (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="create-workspace-branch">Branch name</Label>
						<Input
							id="create-workspace-branch"
							value={branchName}
							onChange={(event) => setBranchName(event.target.value)}
							placeholder={selectedRepo.defaultBranch}
							disabled={busy}
						/>
					</div>
				) : null}

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="create-workspace-prompt">First message</Label>
					<Textarea
						id="create-workspace-prompt"
						aria-label="First message"
						value={prompt}
						onChange={(event) => setPrompt(event.target.value)}
						placeholder="What do you want to work on?"
						rows={5}
						disabled={busy}
					/>
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

				{error === null ? null : (
					<p role="alert" className="text-sm text-danger">
						{error}
					</p>
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
