/**
 * @feature SET-07 Add or edit action dialog
 * Owns: the dialog for creating or editing a run action: name, command, folder, icon and default
 * flag. Used by the repository Actions settings page; the Run tab's "Add action" route is RUN-01's.
 * Behaviour: ui-map.md 3.7 (Add-action dialog: "Action name", icon picker with search);
 * services-map.md 5A.1.6 (action fields; ids are normalised; labels come from the id; the shared
 * file is read-only, so a change to a shared action is written to the personal file).
 * Children: ActionIconPicker.
 * Must handle: an empty name or command (Save disabled), a name that normalises to an existing id
 * (error naming the clash, Save disabled), a folder with `$VARIABLES` (the known names are shown
 * as help), and a save failure (dialog stays open with the text kept).
 * Test first: two names that normalise to the same id show the clash and disable Save.
 */
import { useEffect, useId, useRef, useState } from "react";
import { actionIdsEqual, actionLabel, normalizeActionId } from "../../../core/services/settings.ts";
import { Button } from "../../../ui/Button.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../../ui/Dialog.tsx";
import { Input, Label, Textarea } from "../../../ui/Input.tsx";
import { Switch } from "../../../ui/Switch.tsx";
import { ActionIcon, ActionIconPicker } from "./ActionIconPicker.tsx";

export interface ActionDraft {
	/** Null while creating. */
	id: string | null;
	name: string;
	command: string;
	cwd: string;
	icon: string | null;
	isDefault: boolean;
}

export interface AddActionDialogProps {
	open: boolean;
	initial: ActionDraft;
	existingIds: readonly string[];
	onOpenChange: (open: boolean) => void;
	onSave: (draft: ActionDraft) => Promise<boolean>;
}

/** The variables the app passes to a run action; a folder may use any of them. */
export const RUN_FOLDER_VARIABLES: readonly string[] = [
	"CONDUCTED_WORKSPACE_NAME",
	"CONDUCTED_WORKSPACE_PATH",
	"CONDUCTED_WORKSPACE_ID",
	"CONDUCTED_ROOT_PATH",
	"CONDUCTED_DEFAULT_BRANCH",
	"CONDUCTED_PORT",
];

const EMPTY_DRAFT: ActionDraft = {
	id: null,
	name: "",
	command: "",
	cwd: "",
	icon: null,
	isDefault: false,
};

export function AddActionDialog({
	open,
	initial,
	existingIds,
	onOpenChange,
	onSave,
}: AddActionDialogProps) {
	const [draft, setDraft] = useState<ActionDraft>(initial);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const nameId = useId();
	const commandId = useId();
	const cwdId = useId();
	const initialKey = JSON.stringify(initial);
	const lastKey = useRef(initialKey);

	useEffect(() => {
		if (!open) return;
		if (lastKey.current === initialKey) return;
		lastKey.current = initialKey;
		setDraft(initial);
		setError(null);
	}, [open, initial, initialKey]);

	const id = normalizeActionId(draft.name);
	const clash =
		id !== "" &&
		existingIds.some(
			(existing) => actionIdsEqual(existing, id) && !(draft.id !== null && existing === draft.id),
		);
	const canSave = id !== "" && draft.command.trim() !== "" && !clash && !saving;

	const set = (patch: Partial<ActionDraft>) => {
		setDraft((current) => ({ ...current, ...patch }));
		setError(null);
	};

	const submit = async () => {
		if (!canSave) return;
		setSaving(true);
		setError(null);
		try {
			const saved = await onSave({
				...draft,
				id: draft.id ?? id,
				name: draft.name.trim(),
				command: draft.command.trim(),
				cwd: draft.cwd.trim(),
			});
			if (!saved) setError("The action could not be saved.");
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : "The action could not be saved.";
			setError(message);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					setDraft({ ...EMPTY_DRAFT });
					setError(null);
					lastKey.current = "";
				}
				onOpenChange(next);
			}}
		>
			<DialogContent
				title={draft.id === null ? "Add action" : "Edit action"}
				description="An action starts a command in a workspace."
				onConfirm={() => void submit()}
			>
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={nameId}>Action name</Label>
						<Input
							id={nameId}
							value={draft.name}
							autoFocus
							placeholder="My action"
							aria-invalid={clash || undefined}
							error={clash ? `An action called "${draft.name.trim()}" already exists.` : undefined}
							onChange={(event) => set({ name: event.target.value })}
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor={commandId}>Command</Label>
						<Textarea
							id={commandId}
							value={draft.command}
							placeholder="pnpm dev"
							className="font-mono"
							onChange={(event) => set({ command: event.target.value })}
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor={cwdId}>Working folder</Label>
						<Input
							id={cwdId}
							value={draft.cwd}
							placeholder="The workspace folder"
							onChange={(event) => set({ cwd: event.target.value })}
						/>
						<p className="text-xs text-fg-muted">
							May use {RUN_FOLDER_VARIABLES.map((name) => `$${name}`).join(", ")}.
						</p>
					</div>

					<div className="flex flex-col gap-1.5">
						<span className="text-sm font-medium leading-none text-fg">Icon</span>
						<div className="flex items-center gap-2">
							<span className="flex size-8 items-center justify-center rounded-md bg-muted text-fg-muted">
								<ActionIcon name={draft.icon} />
							</span>
							<span className="text-xs text-fg-muted">{draft.icon ?? "The default play icon"}</span>
						</div>
						<ActionIconPicker
							selected={draft.icon}
							onSelect={(iconName) => set({ icon: iconName })}
						/>
					</div>

					<div className="flex items-center justify-between gap-3">
						<div>
							<p className="text-sm font-medium text-fg">Default action</p>
							<p className="text-sm text-fg-muted">The Run button starts this action.</p>
						</div>
						<Switch
							checked={draft.isDefault}
							aria-label="Default action"
							onCheckedChange={(isDefault) => set({ isDefault })}
						/>
					</div>

					{error ? (
						<p role="alert" className="text-sm text-danger">
							{error}
						</p>
					) : null}
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						variant="default"
						loading={saving}
						disabled={!canSave}
						onClick={() => void submit()}
					>
						{draft.id === null ? "Save action" : "Save changes"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** The label an action id gives in the dialog, used by the page when it opens an edit. */
export function draftForAction(action: {
	id: string;
	label: string;
	command: string;
	args: readonly string[];
	cwd: string | null;
	icon: string | null;
	isDefault: boolean;
}): ActionDraft {
	return {
		id: action.id,
		name: action.label || actionLabel(action.id),
		command: [action.command, ...action.args].join(" ").trim(),
		cwd: action.cwd ?? "",
		icon: action.icon,
		isDefault: action.isDefault,
	};
}
