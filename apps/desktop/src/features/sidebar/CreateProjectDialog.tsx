/**
 * @feature PRJ-03 Quick start a new project from a template
 * Owns: the Create project dialog, the Create a private GitHub repo? dialog, the Quick start button
 * and the flow that runs the two in order.
 * Behaviour: ui-map.md 2 (landing "Quick start"), 3.9 ("Create project": Project name, Parent
 * folder, Template; "Create a private GitHub repo?"), 5.2 (the dialog titles), services-map.md 3.2
 * (the GitHub repository steps) and 3.9 (name availability).
 * Measured from Conductor 0.92.1 (renderApp @2035595): a 525px dialog; fields 24px apart, each label 8px
 * above its control; "Creates folder and repo <name>" under the name with the name in a muted chip; the
 * parent folder's field beside an outlined Browse; three template cards in a row (4px radius, a 40px
 * bordered icon tile on the canvas, the name in 14px medium, the description in 10px muted; the chosen card
 * outlined and tinted in the accent, the others on the muted fill; "New" on gstack); and one Create button
 * at the right with its Cmd+Enter keys, reading "Creating..." while it works.
 * Our design choice: Conductor's dialog also creates the GitHub repository and the first workspace in the
 * same run. Ours creates the folder and project, then offers the private repository in the next dialog,
 * so the description and the line under the name speak of the folder only. Conductor's logos for the
 * templates are its assets (D002); ours are drawn letter marks. Cancel stays beside Create.
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
import { Badge } from "../../ui/Badge.tsx";
import { Button, type ButtonProps } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import { Dialog, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import { Input, Label } from "../../ui/Input.tsx";
import { FileCodeIcon, FolderPlusIcon } from "../../ui/icons.tsx";
import { Select } from "../../ui/Select.tsx";
import { toast } from "../../ui/Toast.tsx";
import { useOpenAddedProject } from "./use-open-added-project.ts";

/** A drawn letter in a circle, our own mark for a template whose logo is someone else's. */
function LetterMark({ letter }: { letter: string }) {
	return (
		<span className="flex size-6 items-center justify-center rounded-full bg-fg text-sm font-semibold leading-none text-canvas">
			{letter}
		</span>
	);
}

const templateMarks = {
	empty: <FileCodeIcon className="size-6 text-fg" />,
	nextjs: <LetterMark letter="N" />,
	gstack: <LetterMark letter="g" />,
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

	// Conductor fills the folder with the last one used, or <root>/repos, as the clone dialog does.
	// Only this opening's answer lands, and a folder the user typed meanwhile is kept.
	useEffect(() => {
		if (!open) return;
		let current = true;
		void actions.projects.defaultCloneDirectory().then((suggested) => {
			if (current && suggested.ok) setParent((typed) => (typed === "" ? suggested.value : typed));
		});
		return () => {
			current = false;
		};
	}, [open, actions]);

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
				className="max-w-[525px]"
				onConfirm={() => {
					if (canCreate) void submit();
				}}
			>
				<div className="mt-2 flex flex-col gap-6">
					<div className="flex flex-col gap-2">
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
								Creates folder{" "}
								<code className="rounded-sm bg-muted px-1 py-0.5 font-mono">{folder}</code>
							</p>
						) : null}
					</div>

					<div className="flex flex-col gap-2">
						<Label htmlFor={parentId}>Parent folder</Label>
						<div className="flex items-center gap-2">
							<Input
								id={parentId}
								value={parent}
								placeholder="Enter path or click to select"
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

					<fieldset className="flex flex-col gap-2">
						<legend className="mb-2 text-sm font-medium leading-none text-fg">Template</legend>
						<div className="grid grid-cols-3 gap-2">
							{PROJECT_TEMPLATES.map((choice) => {
								const selected = template === choice.value;
								return (
									<button
										key={choice.value}
										type="button"
										aria-pressed={selected}
										onClick={() => setTemplate(choice.value)}
										className={cn(
											"relative flex flex-col items-center gap-2 rounded-sm border px-2 py-4 text-center transition-colors",
											selected
												? "border-accent bg-accent/20"
												: "border-transparent bg-muted hover:bg-hover",
										)}
									>
										{choice.value === "gstack" ? (
											<span className="absolute top-1.5 right-1.5">
												<Badge>New</Badge>
											</span>
										) : null}
										<span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-canvas">
											{templateMarks[choice.value]}
										</span>
										<span className="flex min-w-0 flex-col text-center">
											<span className="truncate text-sm font-medium text-fg">{choice.label}</span>
											<span className="text-[10px] text-fg-muted">{choice.description}</span>
										</span>
									</button>
								);
							})}
						</div>
					</fieldset>

					{error !== null ? (
						<div className="rounded-sm border border-danger/50 bg-danger/10 p-3">
							<p role="alert" className="whitespace-pre-wrap break-words text-sm text-danger">
								{error}
							</p>
						</div>
					) : null}
				</div>

				<DialogFooter>
					<Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button disabled={!canCreate} onClick={() => void submit()}>
						{busy ? (
							"Creating..."
						) : (
							<>
								Create
								<span aria-hidden="true" className="ml-1 opacity-60">
									⌘↵
								</span>
							</>
						)}
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
						<div className="rounded-sm border border-danger/50 bg-danger/10 p-3">
							<p role="alert" className="whitespace-pre-wrap break-words text-sm text-danger">
								{error}
							</p>
						</div>
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
	/** What the place that started Quick start does with the new project. */
	onAdded: (repo: Repo) => void;
}

/** Runs Create project, then offers to create the private GitHub repository for the new project. */
export function QuickStartFlow({ open, onOpenChange, onAdded }: QuickStartFlowProps) {
	const [repo, setRepo] = useState<Repo | null>(null);

	useEffect(() => {
		if (open) setRepo(null);
	}, [open]);

	const created = (newRepo: Repo) => {
		setRepo(newRepo);
		onOpenChange(false);
		onAdded(newRepo);
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
	const openAdded = useOpenAddedProject();
	return (
		<>
			<Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
				<FolderPlusIcon />
				Quick start
			</Button>
			<QuickStartFlow open={open} onOpenChange={setOpen} onAdded={(repo) => void openAdded(repo)} />
		</>
	);
}
