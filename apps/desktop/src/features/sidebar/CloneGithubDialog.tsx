/**
 * @feature PRJ-02 Clone a project from GitHub
 * Owns: the "Clone GitHub repo" dialog and the buttons that open it: Repository URL, Location with
 * Browse, the owner and repository pickers, the user's recent repositories, and the clone's progress.
 * Behaviour: ui-map.md 3.9 and 5.2 ("Clone GitHub repo": Repository URL, Location, Browse, Recent
 * repos), ui-map.md 2 (landing "Open GitHub project"), services-map.md 3.2 (clone with
 * `git clone --progress` or `gh repo clone`, then check out the default branch).
 * Our design choice: the owner picker lists the signed-in account and its organisations through
 * useGitHubOwners, and choosing one refreshes the repository list through useGitHubRepos. "Recent
 * repos" is the user's most recently updated GitHub repositories, read through recentRepos().
 * Must handle: GitHub not signed in (the pickers explain it and the URL field still works); an empty
 * URL or location (Clone stays disabled); the folder dialog cancelled (nothing changes) or failing
 * (a message under the fields); a failed clone (its message stays visible and the dialog stays open);
 * a second Clone press while one runs (does nothing); the repository or recent list failing.
 * Test first: choosing a repository fills the URL, Browse fills the location, and Clone calls
 * projects.clone with both.
 */
import { type AppError, appError } from "@conducted/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "zustand";
import type { Loadable } from "../../core/api.ts";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useServices } from "../../core/context.tsx";
import { useActions, useGitHubOwners, useGitHubRepos } from "../../core/hooks.ts";
import type { GitHubRepoSummary } from "../../core/model.ts";
import { Button, type ButtonProps } from "../../ui/Button.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import { Input, Label } from "../../ui/Input.tsx";
import { GitBranchIcon } from "../../ui/icons.tsx";
import { Select } from "../../ui/Select.tsx";
import { Spinner } from "../../ui/Spinner.tsx";

/** The user's most recently updated repositories, for the dialog's "Recent repos" list. */
function useRecentGithubRepos(): Loadable<GitHubRepoSummary[]> {
	const { services } = useServices();
	const access = useStore(services.github.store, (state) => state.access);
	const loading = access.status === "unknown" && access.reason === undefined;
	const available = access.status === "ok";
	const login = access.status === "ok" ? access.login : null;
	const result = useQuery<GitHubRepoSummary[], AppError>({
		queryKey: ["github", "recent-repos", login],
		enabled: available,
		queryFn: async () => {
			const found = await services.github.recentRepos();
			if (!found.ok) throw found.error;
			return found.value;
		},
		staleTime: 60_000,
	});
	if (loading) return { state: "loading" };
	if (!available) {
		return {
			state: "error",
			error: appError("github_repos_unavailable", "Sign in to GitHub to choose a repository."),
		};
	}
	if (result.isError && result.error !== null) return { state: "error", error: result.error };
	if (result.data === undefined) return { state: "loading" };
	return { state: "ready", data: result.data };
}

function RepositoryList({
	label,
	repositories,
	empty,
	onChoose,
}: {
	label: string;
	repositories: readonly GitHubRepoSummary[];
	empty: string;
	onChoose: (repository: GitHubRepoSummary) => void;
}) {
	if (repositories.length === 0) {
		return <p className="text-xs text-fg-subtle">{empty}</p>;
	}
	return (
		<ul aria-label={label} className="flex max-h-40 flex-col gap-1 overflow-y-auto">
			{repositories.slice(0, 20).map((repository) => (
				<li key={`${repository.owner}/${repository.name}`}>
					<button
						type="button"
						onClick={() => onChoose(repository)}
						className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-hover"
					>
						<span className="flex items-center gap-2 text-sm text-fg">
							{repository.owner}/{repository.name}
							{repository.isPrivate ? (
								<span className="text-xs text-fg-subtle">Private</span>
							) : null}
						</span>
						{repository.description !== null ? (
							<span className="line-clamp-1 text-xs text-fg-muted">{repository.description}</span>
						) : null}
					</button>
				</li>
			))}
		</ul>
	);
}

export interface CloneGithubDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function CloneGithubDialog({ open, onOpenChange }: CloneGithubDialogProps) {
	const actions = useActions();
	const repoStore = useServices().services.repo.store;
	const cloneProgress = useStore(repoStore, (state) => state.cloneProgress);
	const owners = useGitHubOwners();
	const urlId = useId();
	const locationId = useId();
	const ownerId = useId();
	const searchId = useId();
	const [url, setUrl] = useState("");
	const [location, setLocation] = useState("");
	const [owner, setOwner] = useState("");
	const [query, setQuery] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const flight = useRef(createSingleFlight()).current;

	const effectiveOwner =
		owner !== "" ? owner : owners.state === "ready" ? (owners.data[0]?.login ?? null) : null;
	const repositories = useGitHubRepos(effectiveOwner, query);
	const recent = useRecentGithubRepos();

	useEffect(() => {
		if (!open) return;
		setUrl("");
		setLocation("");
		setOwner("");
		setQuery("");
		setError(null);
	}, [open]);

	const choose = (repository: GitHubRepoSummary) => {
		setUrl(repository.cloneUrl);
		setError(null);
	};

	const browse = async () => {
		const picked = await actions.app.pickFolder("Choose a folder to clone into");
		if (!picked.ok) {
			setError(picked.error.message);
			return;
		}
		if (picked.value === null) return;
		setLocation(picked.value);
		setError(null);
	};

	const submit = () =>
		flight.run("clone", async () => {
			const trimmedUrl = url.trim();
			const trimmedLocation = location.trim();
			if (trimmedUrl === "" || trimmedLocation === "") return;
			setBusy(true);
			setError(null);
			try {
				const result = await actions.projects.clone(trimmedUrl, trimmedLocation);
				if (!result.ok) {
					setError(result.error.message);
					return;
				}
				onOpenChange(false);
			} finally {
				setBusy(false);
			}
		});

	const canClone = url.trim() !== "" && location.trim() !== "";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="Clone GitHub repo"
				description="Clone a repository from GitHub and add it as a project."
				size="xl"
				onConfirm={() => {
					if (canClone) void submit();
				}}
			>
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={urlId}>Repository URL</Label>
						<Input
							id={urlId}
							value={url}
							placeholder="https://github.com/owner/repository.git"
							onChange={(event) => {
								setUrl(event.target.value);
								setError(null);
							}}
						/>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor={ownerId}>Account</Label>
							{owners.state === "ready" ? (
								owners.data.length === 0 ? (
									<p className="text-xs text-fg-subtle">No GitHub accounts or organisations.</p>
								) : (
									<Select
										id={ownerId}
										aria-label="Account"
										value={effectiveOwner ?? ""}
										options={owners.data.map((candidate) => ({
											value: candidate.login,
											label:
												candidate.kind === "organization"
													? `${candidate.login} (organisation)`
													: candidate.login,
										}))}
										onValueChange={(next) => {
											setOwner(next);
											setQuery("");
										}}
									/>
								)
							) : (
								<p className="text-xs text-fg-subtle">
									{owners.state === "error" ? owners.error.message : "Loading GitHub accounts…"}
								</p>
							)}
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor={searchId}>Search repositories</Label>
							<Input
								id={searchId}
								value={query}
								placeholder="Filter by name or description"
								onChange={(event) => setQuery(event.target.value)}
							/>
						</div>
					</div>

					<div className="flex flex-col gap-1.5">
						<span className="text-sm font-medium text-fg">Repositories</span>
						{repositories.state === "loading" ? (
							<p className="text-xs text-fg-subtle">Loading repositories…</p>
						) : null}
						{repositories.state === "error" ? (
							<p role="alert" className="text-xs text-danger">
								{repositories.error.message}
							</p>
						) : null}
						{repositories.state === "ready" ? (
							<RepositoryList
								label="Repositories"
								repositories={repositories.data}
								empty="No repositories found."
								onChoose={choose}
							/>
						) : null}
					</div>

					<div className="flex flex-col gap-1.5">
						<span className="text-sm font-medium text-fg">Recent repos</span>
						{recent.state === "loading" ? (
							<p className="text-xs text-fg-subtle">Loading recent repositories…</p>
						) : null}
						{recent.state === "error" ? (
							<p className="text-xs text-fg-subtle">{recent.error.message}</p>
						) : null}
						{recent.state === "ready" ? (
							<RepositoryList
								label="Recent repos"
								repositories={recent.data}
								empty="No recent repositories."
								onChoose={choose}
							/>
						) : null}
					</div>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor={locationId}>Location</Label>
						<div className="flex gap-2">
							<Input
								id={locationId}
								value={location}
								placeholder="Choose a folder"
								className="flex-1"
								onChange={(event) => {
									setLocation(event.target.value);
									setError(null);
								}}
							/>
							<Button variant="outline" onClick={() => void browse()}>
								Browse
							</Button>
						</div>
					</div>

					{cloneProgress !== null && cloneProgress !== undefined ? (
						<div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-fg-muted">
							{cloneProgress.state === "cloning" ? (
								<span className="flex items-center gap-2">
									<Spinner size="sm" label="Cloning" />
									Cloning {cloneProgress.url}…
								</span>
							) : null}
							{cloneProgress.state === "failed" ? (
								<p role="alert" className="text-danger">
									{cloneProgress.output}
								</p>
							) : null}
							{cloneProgress.state === "done" ? (
								<p>Cloned into {cloneProgress.destination}.</p>
							) : null}
						</div>
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
					<Button loading={busy} disabled={!canClone} onClick={() => void submit()}>
						Clone repository
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export interface CloneGithubButtonProps {
	variant?: ButtonProps["variant"];
	size?: ButtonProps["size"];
	className?: string;
}

/** The landing and empty-state button that opens the clone dialog. */
export function CloneGithubButton({
	variant = "secondary",
	size = "md",
	className,
}: CloneGithubButtonProps) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
				<GitBranchIcon />
				Open GitHub project
			</Button>
			{open ? <CloneGithubDialog open onOpenChange={setOpen} /> : null}
		</>
	);
}
