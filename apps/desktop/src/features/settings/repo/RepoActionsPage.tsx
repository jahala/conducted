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
 * Children: ActionList, run/AddActionDialog (scripts-panel), RepoPromptSettings (the instruction
 * rows after Use spotlight testing, as Conductor's actions tab has them).
 * Measured from Conductor's actions tab (renderApp Enl and tBa): the title "Actions" with
 * "Configure action-specific behavior and instructions for this repository."; then the "Custom
 * actions" row ("Shortcuts for quick actions, like running your dev server or test suite") with an
 * outlined "Add" at its right and "No custom actions yet. Add one to get started." when empty.
 * Must handle: no actions (designed empty state), a shared action (hide for this user only, never
 * delete), a shared action changed on this Mac (Reset), the default action marked and changed,
 * two quick edits of different actions (each save names only its actions, by id, as Conductor's
 * updateTask does, main @405635), a rename (the name is the id, so the action moves to its new id
 * in its place, Conductor's `replaceId`, renderApp @11014363),
 * and a save or Reset that fails (the settings writer's toast, with "Overwrite file" for an
 * invalid file, as Conductor's writer does, main @389730; the list keeps its previous form).
 * Test first: hiding a shared action stores it as hidden for the user and leaves the file unchanged.
 */
import type { RepoId } from "@conducted/shared";
import { useEffect, useState } from "react";
import { useServices } from "../../../core/context.tsx";
import { useActions, useHiddenRunActions, useRepoConfig } from "../../../core/hooks.ts";
import type { RepoConfigPatch, RunAction, RunActionChange } from "../../../core/model.ts";
import { actionIdsEqual, actionLabel, normalizeActionId } from "../../../core/settings-helpers.ts";
import { Button } from "../../../ui/Button.tsx";
import { PlusIcon } from "../../../ui/icons.tsx";
import { LoadableView } from "../../../ui/LoadableView.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { Switch } from "../../../ui/Switch.tsx";
import { toastError } from "../../../ui/Toast.tsx";
import {
	type ActionDraft,
	AddActionDialog,
	draftForAction,
} from "../../scripts-panel/run/AddActionDialog.tsx";
import { toastSettingSaveFailed } from "../SettingRow.tsx";
import { ActionList, type ActionListItem } from "./ActionList.tsx";
import { RepoPromptSettings } from "./RepoPromptsPage.tsx";

/** A shared action this Mac changes becomes a local change of it. */
const asChanged = (action: RunAction): RunAction => ({
	...action,
	origin: action.origin === "shared" ? "changed_locally" : action.origin,
});

const notDefault = (action: RunAction): RunAction => asChanged({ ...action, isDefault: false });

const EMPTY_DRAFT: ActionDraft = {
	id: null,
	name: "",
	command: "",
	cwd: "",
	icon: null,
	isDefault: false,
	availableIn: ["local", "cloud"],
};

export function RepoActionsPage({ repoId }: { repoId: RepoId }) {
	const value = useRepoConfig(repoId);
	const actions = useActions();
	const container = useServices();
	const [hiddenIds, setHiddenIds] = useState<readonly string[]>([]);
	const [hiddenError, setHiddenError] = useState<string | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [draft, setDraft] = useState<ActionDraft>(EMPTY_DRAFT);

	const hiddenRunActions = useHiddenRunActions(repoId);
	useEffect(() => {
		if (hiddenRunActions.ok) {
			setHiddenIds(hiddenRunActions.value);
			setHiddenError(null);
			return;
		}
		setHiddenIds([]);
		setHiddenError(hiddenRunActions.error.message);
	}, [hiddenRunActions]);

	const save = async (patch: RepoConfigPatch): Promise<boolean> => {
		const saved = await actions.projects.updateConfig(repoId, patch);
		if (!saved.ok) {
			toastSettingSaveFailed(saved.error, () =>
				actions.projects.updateConfig(repoId, patch, { overwrite: true }),
			);
			return false;
		}
		return true;
	};

	const toggleHidden = async (id: string, hidden: boolean) => {
		if (value.state !== "ready") return;
		const action = value.data.runScripts.find((candidate) => actionIdsEqual(candidate.id, id));
		if (action === undefined) return;
		if (action.origin === "local") {
			await save({ runActions: [{ kind: "set", action: { ...action, hidden } }] });
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
		// An action's name is its id, as in Conductor, so a typed name is saved as the id.
		const id = normalizeActionId(nextDraft.name);
		const renamed = existing !== undefined && !actionIdsEqual(existing.id, id);
		const origin: RunAction["origin"] =
			existing === undefined || renamed || existing.origin === "local"
				? "local"
				: "changed_locally";
		const action: RunAction = {
			id,
			label: actionLabel(id),
			command: nextDraft.command.trim(),
			args: [],
			cwd: nextDraft.cwd.trim() === "" ? null : nextDraft.cwd.trim(),
			isDefault: nextDraft.isDefault,
			hidden: existing?.hidden ?? false,
			icon: nextDraft.icon,
			origin,
			availableIn: nextDraft.availableIn,
		};
		const changes: RunActionChange[] = [
			// A rename takes the old id's place, as Conductor's `replaceId` does (renderApp @11014363).
			renamed ? { kind: "set", action, replaceId: existing.id } : { kind: "set", action },
		];
		if (action.isDefault) {
			for (const candidate of config.runScripts) {
				if (existing !== undefined && actionIdsEqual(candidate.id, existing.id)) continue;
				if (!candidate.isDefault) continue;
				changes.push({ kind: "set", action: notDefault(candidate) });
			}
		}
		const saved = await save({ runActions: changes });
		if (saved) setDialogOpen(false);
		return saved;
	};

	const remove = async (id: string) => {
		await save({ runActions: [{ kind: "delete", id }] });
	};

	const setDefault = async (id: string) => {
		if (value.state !== "ready") return;
		const changes: RunActionChange[] = [];
		for (const candidate of value.data.runScripts) {
			const isDefault = actionIdsEqual(candidate.id, id);
			if (candidate.isDefault === isDefault) continue;
			changes.push({
				kind: "set",
				action: isDefault ? asChanged({ ...candidate, isDefault }) : notDefault(candidate),
			});
		}
		await save({ runActions: changes });
	};

	const reset = async (id: string) => {
		const forget = () =>
			setHiddenIds((current) => current.filter((entry) => !actionIdsEqual(entry, id)));
		const result = await actions.projects.resetRunAction(repoId, id);
		if (!result.ok) {
			toastSettingSaveFailed(result.error, async () => {
				const forced = await actions.projects.resetRunAction(repoId, id, { overwrite: true });
				if (forced.ok) forget();
				return forced;
			});
			return;
		}
		forget();
	};

	const setSpotlight = async (spotlightTesting: boolean) => {
		if (value.state !== "ready") return;
		await save({ spotlightTesting });
	};

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-medium text-fg">Actions</h1>
				<p className="text-sm text-fg-muted">
					Configure action-specific behavior and instructions for this repository.
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

							<div className="flex flex-col gap-3">
								<div className="flex items-center justify-between gap-8">
									<div className="min-w-0">
										<p className="text-sm font-medium text-fg">Custom actions</p>
										<p className="mt-0.5 text-sm text-fg-muted">
											Shortcuts for quick actions, like running your dev server or test suite
										</p>
									</div>
									<Button variant="outline" size="sm" onClick={add}>
										<PlusIcon className="size-4" />
										Add
									</Button>
								</div>
								{items.length === 0 ? (
									<p className="text-sm text-fg-muted">
										No custom actions yet. Add one to get started.
									</p>
								) : (
									<ActionList
										items={items}
										onEdit={edit}
										onDelete={(id) => void remove(id)}
										onToggleHidden={(id, hidden) => void toggleHidden(id, hidden)}
										onSetDefault={(id) => void setDefault(id)}
										onReset={(id) => void reset(id)}
									/>
								)}
							</div>

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

			<RepoPromptSettings repoId={repoId} />

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
