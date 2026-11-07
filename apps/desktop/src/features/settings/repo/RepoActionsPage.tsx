/**
 * @feature SET-07 Repository Actions page
 * Owns: the per-repository Actions page: the list of run actions (dev server, tests), adding,
 * editing, deleting, resetting to the shared version, choosing the default, hiding for this user,
 * and the Spotlight switch.
 * Behaviour: ui-map.md 6, "Actions (repo)" and "Actions page" (custom actions list with Show or
 * Hide, Edit, Delete, Reset; empty "No custom actions yet. Add one to get started."; "Use spotlight
 * testing"); services-map.md 5A.1.6 (action fields; "Hide" for shared actions is per user and
 * stored locally, not in the file) and 5A.2 (Spotlight).
 * Data: useRepoConfig(repoId).runScripts, useActions().projects (updateConfig, setRunActionHidden,
 * resetRunAction). Hidden shared ids are read from local storage through the repo service.
 * Children: ActionList, run/AddActionDialog (scripts-panel).
 * Our design choice: prompts for Review, Create PR and the others are on RepoPromptsPage, not here.
 * Must handle: no actions (designed empty state), a shared action (hide for this user only, never
 * delete), a shared action changed on this Mac (Reset), the default action marked and changed,
 * and a save that fails (the user sees it and the list keeps its previous form; the Spotlight
 * switch says "Failed to update spotlight testing").
 * Test first: hiding a shared action stores it as hidden for the user and leaves the file unchanged.
 */
import type { RepoId } from "@conducted/shared";
import { useEffect, useState } from "react";
import { useServices } from "../../../core/context.tsx";
import { useActions, useRepoConfig } from "../../../core/hooks.ts";
import type { RepoConfig, RunAction } from "../../../core/model.ts";
import { readHiddenRunActions } from "../../../core/services/repo.ts";
import { actionIdsEqual, actionLabel, normalizeActionId } from "../../../core/services/settings.ts";
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { LoadableView } from "../../../ui/LoadableView.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { Switch } from "../../../ui/Switch.tsx";
import { toastError } from "../../../ui/Toast.tsx";
import {
	type ActionDraft,
	AddActionDialog,
	draftForAction,
} from "../../scripts-panel/run/AddActionDialog.tsx";
import { ActionList, type ActionListItem } from "./ActionList.tsx";

const EMPTY_DRAFT: ActionDraft = {
	id: null,
	name: "",
	command: "",
	cwd: "",
	icon: null,
	isDefault: false,
};

export function RepoActionsPage({ repoId }: { repoId: RepoId }) {
	const value = useRepoConfig(repoId);
	const actions = useActions();
	const container = useServices();
	const [hiddenIds, setHiddenIds] = useState<readonly string[]>([]);
	const [hiddenError, setHiddenError] = useState<string | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [draft, setDraft] = useState<ActionDraft>(EMPTY_DRAFT);

	useEffect(() => {
		const read = readHiddenRunActions(repoId);
		if (read.ok) {
			setHiddenIds(read.value);
			setHiddenError(null);
			return;
		}
		setHiddenIds([]);
		setHiddenError(read.error.message);
	}, [repoId]);

	const save = async (
		config: RepoConfig,
		failureTitle = "Couldn't save the actions",
	): Promise<boolean> => {
		const saved = await actions.projects.updateConfig(repoId, config);
		if (!saved.ok) {
			toastError(failureTitle, saved.error);
			return false;
		}
		return true;
	};

	const toggleHidden = async (id: string, hidden: boolean) => {
		if (value.state !== "ready") return;
		const action = value.data.runScripts.find((candidate) => actionIdsEqual(candidate.id, id));
		if (action === undefined) return;
		if (action.origin === "local") {
			const next = value.data.runScripts.map((candidate) =>
				actionIdsEqual(candidate.id, id) ? { ...candidate, hidden } : candidate,
			);
			await save({ ...value.data, runScripts: next });
			return;
		}
		const previous = hiddenIds;
		setHiddenIds(
			hidden
				? [...hiddenIds.filter((entry) => !actionIdsEqual(entry, id)), id]
				: hiddenIds.filter((entry) => !actionIdsEqual(entry, id)),
		);
		const result = await actions.projects.setRunActionHidden(repoId, id, hidden);
		if (!result.ok) {
			setHiddenIds(previous);
			toastError("Couldn't save the hidden action", result.error);
		}
	};

	const edit = (id: string) => {
		if (value.state !== "ready") return;
		const action = value.data.runScripts.find((candidate) => actionIdsEqual(candidate.id, id));
		if (action === undefined) return;
		setDraft(draftForAction(action));
		setDialogOpen(true);
	};

	const add = () => {
		setDraft({ ...EMPTY_DRAFT });
		setDialogOpen(true);
	};

	const saveDraft = async (nextDraft: ActionDraft): Promise<boolean> => {
		if (value.state !== "ready") return false;
		const config = value.data;
		const existing =
			nextDraft.id === null
				? undefined
				: config.runScripts.find((candidate) => actionIdsEqual(candidate.id, nextDraft.id ?? ""));
		const id = nextDraft.id ?? normalizeActionId(nextDraft.name);
		const origin: RunAction["origin"] =
			existing === undefined ? "local" : existing.origin === "local" ? "local" : "changed_locally";
		const typedName = nextDraft.name.trim();
		const action: RunAction = {
			id,
			label:
				nextDraft.id !== null && normalizeActionId(nextDraft.name) !== id
					? typedName
					: actionLabel(id),
			command: nextDraft.command.trim(),
			args: [],
			cwd: nextDraft.cwd.trim() === "" ? null : nextDraft.cwd.trim(),
			isDefault: nextDraft.isDefault,
			hidden: existing?.hidden ?? false,
			icon: nextDraft.icon,
			origin,
		};
		let runScripts =
			existing === undefined
				? [...config.runScripts, action]
				: config.runScripts.map((candidate) =>
						actionIdsEqual(candidate.id, existing.id) ? action : candidate,
					);
		if (action.isDefault) {
			runScripts = runScripts.map((candidate) => {
				if (actionIdsEqual(candidate.id, action.id) || !candidate.isDefault) return candidate;
				return {
					...candidate,
					isDefault: false,
					origin: candidate.origin === "shared" ? "changed_locally" : candidate.origin,
				};
			});
		}
		const saved = await save({ ...config, runScripts });
		if (saved) setDialogOpen(false);
		return saved;
	};

	const remove = async (id: string) => {
		if (value.state !== "ready") return;
		await save({
			...value.data,
			runScripts: value.data.runScripts.filter((candidate) => !actionIdsEqual(candidate.id, id)),
		});
	};

	const setDefault = async (id: string) => {
		if (value.state !== "ready") return;
		const runScripts = value.data.runScripts.map((candidate) => {
			const isDefault = actionIdsEqual(candidate.id, id);
			if (candidate.isDefault === isDefault) return candidate;
			return {
				...candidate,
				isDefault,
				origin: candidate.origin === "shared" ? "changed_locally" : candidate.origin,
			};
		});
		await save({ ...value.data, runScripts });
	};

	const reset = async (id: string) => {
		const result = await actions.projects.resetRunAction(repoId, id);
		if (!result.ok) {
			toastError("Couldn't reset the action", result.error);
			return;
		}
		setHiddenIds((current) => current.filter((entry) => !actionIdsEqual(entry, id)));
	};

	const setSpotlight = async (spotlightTesting: boolean) => {
		if (value.state !== "ready") return;
		// RUN-02: inventory toast row 903 names this failure on its own.
		await save({ ...value.data, spotlightTesting }, "Failed to update spotlight testing");
	};

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-medium text-fg">Actions</h1>
				<p className="text-sm text-fg-muted">
					Shortcuts for quick actions, like running your dev server or test suite.
				</p>
			</div>

			<LoadableView
				value={value}
				loadingLabel="Loading actions"
				errorTitle="Couldn't load the actions"
				onRetry={() => void container.services.repo.loadConfig(repoId)}
				loading={
					<div className="flex flex-col gap-2">
						{[0, 1, 2].map((index) => (
							<Skeleton key={index} className="h-14 w-full" />
						))}
					</div>
				}
			>
				{(config) => {
					const items: ActionListItem[] = config.runScripts.map((action) => {
						const shared = action.origin !== "local";
						const hidden =
							action.hidden || (shared && hiddenIds.some((id) => actionIdsEqual(id, action.id)));
						return {
							id: action.id,
							label: action.label,
							command: action.command,
							icon: action.icon,
							isDefault: action.isDefault,
							source: shared ? "shared" : "personal",
							hidden,
							canReset: action.origin === "changed_locally",
						};
					});

					return (
						<div className="flex flex-col gap-4">
							{hiddenError !== null ? (
								<p role="alert" className="text-sm text-danger">
									{hiddenError}
								</p>
							) : null}

							{items.length === 0 ? (
								<EmptyState
									compact
									title="No custom actions yet. Add one to get started."
									body="An action runs a command in a workspace, such as a dev server or your tests."
									action={
										<Button variant="default" onClick={add}>
											Add action
										</Button>
									}
								/>
							) : (
								<>
									<div className="flex justify-end">
										<Button variant="secondary" onClick={add}>
											Add action
										</Button>
									</div>
									<ActionList
										items={items}
										onEdit={edit}
										onDelete={(id) => void remove(id)}
										onToggleHidden={(id, hidden) => void toggleHidden(id, hidden)}
										onSetDefault={(id) => void setDefault(id)}
										onReset={(id) => void reset(id)}
									/>
								</>
							)}

							<div className="flex items-center justify-between gap-4 border-t border-border pt-4">
								<div>
									<p className="text-sm font-medium text-fg">Use spotlight testing</p>
									<p className="text-sm text-fg-muted">
										Replace Run with Spotlight for this repository so workspace changes are tested
										in the repository root.
									</p>
								</div>
								<Switch
									checked={config.spotlightTesting}
									aria-label="Use spotlight testing"
									onCheckedChange={(checked) => void setSpotlight(checked)}
								/>
							</div>
						</div>
					);
				}}
			</LoadableView>

			<AddActionDialog
				open={dialogOpen}
				initial={draft}
				existingIds={value.state === "ready" ? value.data.runScripts.map((item) => item.id) : []}
				onOpenChange={setDialogOpen}
				onSave={saveDraft}
			/>
		</div>
	);
}
