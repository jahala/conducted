/**
 * @feature PRJ-03 Quick start a new project from a template
 * Owns: the Create project dialog, the Create a private GitHub repo? dialog, the Quick start button
 * and the flow that runs the two in order.
 * Behaviour: ui-map.md 2 (landing "Quick start"), 3.9 ("Create project": Project name, Parent
 * folder, Template; "Create a private GitHub repo?"), 5.2 (the dialog titles), services-map.md 3.2
 * (the GitHub repository steps) and 3.9 (name availability).
 * Must handle: an empty or unusable project name (Create stays disabled), a cancelled or failing
 * folder dialog, a template command that fails (its message stays in the dialog), a failed GitHub
 * repository (its message stays in the dialog), no GitHub sign-in (the repository dialog explains
 * it), a name already taken, and a second Create press while one runs.
 * Test first: Quick start creates the chosen folder and template through projects.createFromTemplate,
 * then asks about the private GitHub repository.
 */
import { useEffect, useId, useRef, useState } from "react";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useActions, useGitHubOwners, useRepoNameCheck } from "../../core/hooks.ts";
import type { Repo } from "../../core/model.ts";
import {
	PROJECT_TEMPLATES,
	type ProjectTemplate,
	projectFolderName,
} from "../../core/services/project-templates.ts";
import { Button, type ButtonProps } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import { Dialog, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import { Input, Label } from "../../ui/Input.tsx";
import { FileIcon, FolderPlusIcon, GitBranchIcon } from "../../ui/icons.tsx";
import { Select } from "../../ui/Select.tsx";
import { toast } from "../../ui/Toast.tsx";

const templateIcons = {
	empty: FolderPlusIcon,
	nextjs: FileIcon,
	gstack: GitBranchIcon,
} as const;

export interface CreateProjectDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated: (repo: Repo) => void;
}

/** The Create project dialog: a project name, its parent folder and one of three templates. */
export function CreateProjectDialog({ open, onOpenChange, onCreated }: CreateProjectDialogProps) {
	const actions = useActions();
	const nameId = useId();
	const parentId = useId();
	const [name, setName] = useState("");
	const [parent, setParent] = useState("");
	const [template, setTemplate] = useState<ProjectTemplate>("empty");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const flight = useRef(createSingleFlight()).current;

	const folder = projectFolderName(name);
	const nameInvalid = name.trim() !== "" && folder === "";
	const canCreate = name.trim() !== "" && !nameInvalid && parent.trim() !== "" && !busy;

	useEffect(() => {
		if (open) return;
		setName("");
		setParent("");
		setTemplate("empty");
		setError(null);
	}, [open]);

	const browse = async () => {
		const picked = await actions.app.pickFolder("Choose where to create the project");
		if (!picked.ok) {
			setError(picked.error.message);
			return;
		}
		if (picked.value === null) return;
		setParent(picked.value);
		setError(null);
	};

	const submit = () =>
		flight.run("create-project", async () => {
			if (!canCreate) return;
			setBusy(true);
			setError(null);
			try {
				const result = await actions.projects.createFromTemplate(
					name.trim(),
					parent.trim(),
					template,
				);
				if (!result.ok) {
					setError(result.error.message);
					return;
				}
				toast.success("Project created.");
				onCreated(result.value);
				onOpenChange(false);
			} finally {
				setBusy(false);
			}
		});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="Create project"
				description="Create a local folder from a template and add it as a project."
				size="xl"
				onConfirm={() => {
					if (canCreate) void submit();
				}}
			>
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={nameId}>Project name</Label>
						<Input
							id={nameId}
							value={name}
							placeholder="my-awesome-project"
							autoCorrect="off"
							autoCapitalize="off"
							spellCheck={false}
							autoFocus
							onChange={(event) => {
								setName(event.target.value);
								setError(null);
							}}
						/>
						{nameInvalid ? (
							<p className="text-xs text-danger">Name must include letters or numbers.</p>
						) : folder !== "" ? (
							<p className="text-xs text-fg-muted">
								Creates folder <code className="font-mono">{folder}</code>
							</p>
						) : null}
					</div>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor={parentId}>Parent folder</Label>
						<div className="flex gap-2">
							<Input
								id={parentId}
								value={parent}
								placeholder="Enter a path or click Browse"
								className="flex-1"
								onChange={(event) => {
									setParent(event.target.value);
									setError(null);
								}}
							/>
							<Button variant="outline" onClick={() => void browse()}>
								Browse
							</Button>
						</div>
					</div>

					<div className="flex flex-col gap-2">
						<span className="text-sm font-medium text-fg">Template</span>
						<div className="grid grid-cols-3 gap-2">
							{PROJECT_TEMPLATES.map((choice) => {
								const Icon = templateIcons[choice.value];
								const selected = template === choice.value;
								return (
									<button
										key={choice.value}
										type="button"
										aria-pressed={selected}
										onClick={() => setTemplate(choice.value)}
										className={cn(
											"flex flex-col items-center gap-2 rounded-md border px-2 py-4 text-center transition-colors",
											selected
												? "border-accent bg-accent/10"
												: "border-transparent bg-surface hover:bg-hover",
										)}
									>
										<span className="flex size-10 items-center justify-center rounded border border-border bg-raised">
											<Icon className="size-5 text-fg-muted" />
										</span>
										<span className="text-sm font-medium text-fg">{choice.label}</span>
										<span className="text-[10px] text-fg-muted">{choice.description}</span>
									</button>
								);
							})}
						</div>
					</div>

					{error !== null ? (
						<p role="alert" className="text-sm text-danger">
							{error}
						</p>
					) : null}
				</div>

				<DialogFooter>
					<Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button loading={busy} disabled={!canCreate} onClick={() => void submit()}>
						Create
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export interface CreateGithubRepoDialogProps {
	open: boolean;
	repo: Repo;
	onOpenChange: (open: boolean) => void;
	onCreated: (url: string) => void;
}

/** The dialog that creates a private GitHub repository for an existing local project. */
export function CreateGithubRepoDialog({
	open,
	repo,
	onOpenChange,
	onCreated,
}: CreateGithubRepoDialogProps) {
	const actions = useActions();
	const owners = useGitHubOwners();
	const ownerId = useId();
	const nameId = useId();
	const [owner, setOwner] = useState("");
	const [name, setName] = useState(repo.name);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const flight = useRef(createSingleFlight()).current;

	const effectiveOwner =
		owner !== "" ? owner : owners.state === "ready" ? (owners.data[0]?.login ?? null) : null;
	const check = useRepoNameCheck(effectiveOwner ?? "", name);
	const folder = projectFolderName(name);
	const canCreate =
		effectiveOwner !== null &&
		folder !== "" &&
		check.state === "ready" &&
		check.data === "available" &&
		!busy;

	useEffect(() => {
		if (open) return;
		setName(repo.name);
		setError(null);
	}, [open, repo.name]);

	const availability = (() => {
		if (name.trim() === "") return null;
		if (folder === "")
			return { message: "Repository name must include letters or numbers.", bad: true };
		if (check.state === "loading")
			return { message: "Checking repository availability...", bad: false };
		if (check.state === "error") {
			return { message: "Couldn't check repository availability.", bad: true };
		}
		if (check.data === "taken") return { message: "This repository already exists.", bad: true };
		if (check.data === "available") {
			return { message: "Repository name is available.", bad: false };
		}
		return { message: "Repository name must include letters or numbers.", bad: true };
	})();

	const submit = () =>
		flight.run("create-github-repo", async () => {
			if (!canCreate || effectiveOwner === null) return;
			setBusy(true);
			setError(null);
			try {
				const result = await actions.projects.createGitHubRepo(repo.id, {
					owner: effectiveOwner,
					name: folder,
					isPrivate: true,
				});
				if (!result.ok) {
					setError(result.error.message);
					return;
				}
				toast.success("GitHub repository created.");
				onCreated(result.value);
				onOpenChange(false);
			} finally {
				setBusy(false);
			}
		});

	const description =
		repo.remoteUrl === null
			? "The app will run git init if needed, create a private GitHub repository, add it as origin, and push the current branch."
			: "The existing origin remote will be renamed to upstream. The app will create a private GitHub repository, add it as origin, and push the current branch.";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="Create a private GitHub repo?"
				description={description}
				size="xl"
				onConfirm={() => {
					if (canCreate) void submit();
				}}
			>
				<div className="flex flex-col gap-4">
					<div className="grid grid-cols-2 gap-3">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor={ownerId}>Owner</Label>
							{owners.state === "ready" ? (
								owners.data.length === 0 ? (
									<p className="text-xs text-fg-subtle">No GitHub accounts or organisations.</p>
								) : (
									<Select
										id={ownerId}
										aria-label="Owner"
										value={effectiveOwner ?? ""}
										options={owners.data.map((candidate) => ({
											value: candidate.login,
											label:
												candidate.kind === "organization"
													? `${candidate.login} (organisation)`
													: candidate.login,
										}))}
										onValueChange={setOwner}
									/>
								)
							) : (
								<p className="text-xs text-fg-subtle">
									{owners.state === "error" ? owners.error.message : "Loading GitHub owners…"}
								</p>
							)}
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor={nameId}>Repository name</Label>
							<Input
								id={nameId}
								value={name}
								onChange={(event) => {
									setName(event.target.value);
									setError(null);
								}}
							/>
						</div>
					</div>
					{effectiveOwner !== null && folder !== "" ? (
						<p className="text-xs text-fg-muted">
							Will create{" "}
							<code className="font-mono">
								{effectiveOwner}/{folder}
							</code>
						</p>
					) : null}
					{availability !== null ? (
						<p className={cn("text-xs", availability.bad ? "text-danger" : "text-fg-muted")}>
							{availability.message}
						</p>
					) : null}
					{error !== null ? (
						<p role="alert" className="text-sm text-danger">
							{error}
						</p>
					) : null}
				</div>

				<DialogFooter>
					<Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button loading={busy} disabled={!canCreate} onClick={() => void submit()}>
						Create repository
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export interface QuickStartFlowProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/** Runs Create project, then offers to create the private GitHub repository for the new project. */
export function QuickStartFlow({ open, onOpenChange }: QuickStartFlowProps) {
	const [repo, setRepo] = useState<Repo | null>(null);

	useEffect(() => {
		if (open) setRepo(null);
	}, [open]);

	const created = (newRepo: Repo) => {
		setRepo(newRepo);
		onOpenChange(false);
	};

	return (
		<>
			{open ? <CreateProjectDialog open onOpenChange={onOpenChange} onCreated={created} /> : null}
			{repo !== null ? (
				<CreateGithubRepoDialog
					open
					repo={repo}
					onOpenChange={(next) => {
						if (!next) setRepo(null);
					}}
					onCreated={() => setRepo(null)}
				/>
			) : null}
		</>
	);
}

export interface QuickStartButtonProps {
	variant?: ButtonProps["variant"];
	size?: ButtonProps["size"];
	className?: string;
}

/** The landing and empty-state button that starts Quick start. */
export function QuickStartButton({
	variant = "secondary",
	size = "md",
	className,
}: QuickStartButtonProps) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
				<FolderPlusIcon />
				Quick start
			</Button>
			<QuickStartFlow open={open} onOpenChange={setOpen} />
		</>
	);
}
