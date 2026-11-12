/**
 * @feature SET-04 Environment variable table
 * @feature SET-11 Documented variables on the Environment page
 * Owns: one scope's variables as Conductor's table, with the documented variables behind their
 * link and the side panel that edits, sets or shows one variable.
 * Behaviour: Conductor's variables section (renderApp Cnr and lci @10697720-10708700): a heading
 * ("Variables" when the table has no title of its own); a fixed table in a rounded border with no
 * header row (Conductor's table holds only its body), whose empty state sits inside it ("No variables
 * set" / "Add a variable to make it available in this environment."); each row has a lock (its
 * tooltip "Securely saved by Conducted") beside the name in mono with the meaning of a documented
 * name under it; the value as an eye button ("Reveal NAME" / "Hide NAME") and dots, or the value,
 * that copy it when clicked ("Copied NAME"), or a "Not set" pill; and at the right Edit (pencil) and
 * Delete (bin), or Set (plus) on an unset documented name. Under the table, "Show documented
 * variables (N)" or "Hide documented variables". Edit and Set open a 520 px side panel: "Edit
 * shared variable" (or "View inherited variable" for a row that cannot change) with the meaning or
 * "Variable names may only contain letters, numbers, and underscores.", Name (fixed for a documented
 * name), Value ("Use an empty value to set this variable to an empty string."), Cancel and Save.
 * Data: the page passes the rows and the documented names still unset, and the reveal, save and
 * delete calls; values stay in the Keychain until a row asks for one.
 * Our design choice: Delete asks first ("Remove variable?"), since the value leaves the Keychain
 * for good; Conductor deletes at once.
 * Must handle: no variables (the empty row; none at all when `hideEmptyState` and nothing to show),
 * a value that cannot be read (a toast, the dots stay), a rename (the old name goes once the new one
 * is saved), the panel's value read before it can be saved, a row that cannot change (the panel only
 * shows it), a dimmed row (an inherited value this scope replaces), and keyboard access to every
 * action.
 * Test first: clicking Reveal asks for the value once and shows it until Hide.
 */
import { type ReactNode, useState } from "react";
import { AlertDialog, AlertDialogContent } from "../../../ui/AlertDialog.tsx";
import { Button } from "../../../ui/Button.tsx";
import { cn } from "../../../ui/cn.ts";
import { Input, Label, Textarea } from "../../../ui/Input.tsx";
import {
	EyeIcon,
	EyeOffIcon,
	LockIcon,
	PencilIcon,
	PlusIcon,
	TrashIcon,
} from "../../../ui/icons.tsx";
import { Sheet, SheetContent } from "../../../ui/Sheet.tsx";
import { Tooltip } from "../../../ui/Tooltip.tsx";
import { type EnvDraft, envEditProblem, SaveHint } from "./AddEnvVarForm.tsx";
import type { DocumentedEnvVar } from "./EnvVarSuggestions.tsx";

/** Conductor's mask for a hidden value. */
const MASK = "••••••••";

export interface EnvTableRow {
	name: string;
	/** The meaning of a documented name. */
	description?: string;
	/** False when the Keychain holds nothing for it: the row says "Not set". */
	hasValue: boolean;
	/** False for a row of another scope: the panel only shows it, and there is no Delete. */
	editable: boolean;
	/** A documented name keeps its name; any other variable can be renamed in the panel. */
	canRename: boolean;
	/** An inherited value that this scope replaces. */
	dimmed?: boolean;
}

export interface EnvVarTableProps {
	/** A muted heading over the table, such as "Inherited from User". */
	title?: string;
	/** The word the panel's title uses: "Edit shared variable", "View inherited variable". */
	scopeLabel: string;
	rows: readonly EnvTableRow[];
	/** Documented names not set in this scope, behind "Show documented variables (N)". */
	documented?: readonly DocumentedEnvVar[];
	/** No table at all while there is nothing to show. */
	hideEmptyState?: boolean;
	/** The stored value, or null when it could not be read (the caller has said why). */
	onReveal: (name: string) => Promise<string | null>;
	onCopy: (name: string, value: string) => void;
	/** Saves one variable; `previousName` is set when it was renamed. False when the save failed. */
	onSave: (entry: EnvDraft & { previousName: string | null }) => Promise<boolean>;
	onDelete: (name: string) => Promise<boolean>;
}

interface Editing {
	/** The name the row had, or null for a documented name being set. */
	previousName: string | null;
	draft: EnvDraft;
	description: string | undefined;
	editable: boolean;
	canRename: boolean;
	/** The stored value is still being read. */
	loading: boolean;
}

export function EnvVarTable({
	title,
	scopeLabel,
	rows,
	documented = [],
	hideEmptyState = false,
	onReveal,
	onCopy,
	onSave,
	onDelete,
}: EnvVarTableProps) {
	const [showDocumented, setShowDocumented] = useState(false);
	const [revealed, setRevealed] = useState<Readonly<Record<string, string>>>({});
	const [editing, setEditing] = useState<Editing | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<string | null>(null);

	const names = rows.map((row) => row.name);
	const documentedShown = showDocumented ? documented : [];
	const empty = rows.length === 0 && documentedShown.length === 0;

	const storedValue = async (name: string): Promise<string | null> =>
		revealed[name] ?? (await onReveal(name));

	const toggleReveal = async (name: string) => {
		if (revealed[name] !== undefined) {
			const { [name]: _hidden, ...rest } = revealed;
			setRevealed(rest);
			return;
		}
		const value = await onReveal(name);
		if (value !== null) setRevealed({ ...revealed, [name]: value });
	};

	const copy = async (name: string) => {
		const value = await storedValue(name);
		if (value !== null) onCopy(name, value);
	};

	const openEditor = async (row: EnvTableRow) => {
		setError(null);
		const known = revealed[row.name];
		const base: Editing = {
			previousName: row.name,
			draft: { name: row.name, value: known ?? "" },
			description: row.description,
			editable: row.editable,
			canRename: row.canRename,
			loading: row.hasValue && known === undefined,
		};
		setEditing(base);
		if (!base.loading) return;
		const value = await onReveal(row.name);
		setEditing((current) =>
			current === null || current.previousName !== row.name
				? current
				: { ...current, loading: false, draft: { ...current.draft, value: value ?? "" } },
		);
		// A value that could not be read keeps the panel from saving an empty one in its place.
		if (value === null) setError("The saved value could not be read, so it cannot be edited here.");
	};

	const openSetter = (entry: DocumentedEnvVar) => {
		setError(null);
		setEditing({
			previousName: null,
			draft: { name: entry.name, value: "" },
			description: entry.meaning,
			editable: true,
			canRename: false,
			loading: false,
		});
	};

	const save = async () => {
		if (editing === null || !editing.editable || editing.loading) return;
		const name = editing.canRename ? editing.draft.name.trim() : editing.draft.name;
		const problem = envEditProblem(name, names, editing.previousName);
		if (problem !== null) {
			setError(problem);
			return;
		}
		setSaving(true);
		const saved = await onSave({
			name,
			value: editing.draft.value,
			previousName: editing.previousName,
		});
		setSaving(false);
		if (!saved) return;
		const { [editing.previousName ?? name]: _old, ...rest } = revealed;
		setRevealed(rest);
		setEditing(null);
	};

	const confirmDelete = async () => {
		const name = pendingDelete;
		setPendingDelete(null);
		if (name === null) return;
		if (await onDelete(name)) {
			const { [name]: _gone, ...rest } = revealed;
			setRevealed(rest);
		}
	};

	const panelTitle =
		editing === null
			? ""
			: !editing.editable
				? `View ${scopeLabel} variable`
				: `Edit ${scopeLabel} variable`;

	return (
		<section className="flex flex-col gap-4">
			<h3 className="text-sm font-medium text-fg-muted">{title ?? "Variables"}</h3>
			{hideEmptyState && empty ? null : (
				<div className="overflow-hidden rounded-md border border-border">
					<table className="w-full table-fixed text-sm">
						<tbody>
							{empty ? (
								<tr>
									<td colSpan={3} className="py-10 text-center">
										<div className="mx-auto flex max-w-sm flex-col gap-2">
											<p className="text-sm font-medium text-fg">No variables set</p>
											<p className="text-sm text-fg-muted">
												Add a variable to make it available in this environment.
											</p>
										</div>
									</td>
								</tr>
							) : null}
							{rows.map((row) => (
								<VariableRow
									key={row.name}
									name={row.name}
									description={row.description}
									dimmed={row.dimmed === true}
									value={row.hasValue ? (revealed[row.name] ?? null) : undefined}
									onToggleReveal={() => void toggleReveal(row.name)}
									onCopy={() => void copy(row.name)}
									actions={
										<>
											<RowAction
												label={`${row.editable ? "Edit" : "View"} ${row.name}`}
												icon={<PencilIcon className="size-4" />}
												onClick={() => void openEditor(row)}
											/>
											{row.editable ? (
												<RowAction
													label={`Delete ${row.name}`}
													icon={<TrashIcon className="size-4" />}
													onClick={() => setPendingDelete(row.name)}
												/>
											) : null}
										</>
									}
								/>
							))}
							{documentedShown.map((entry) => (
								<VariableRow
									key={entry.name}
									name={entry.name}
									description={entry.meaning}
									dimmed={false}
									unset
									value={undefined}
									onToggleReveal={() => undefined}
									onCopy={() => undefined}
									actions={
										<RowAction
											label={`Set ${entry.name}`}
											icon={<PlusIcon className="size-4" />}
											onClick={() => openSetter(entry)}
										/>
									}
								/>
							))}
						</tbody>
					</table>
				</div>
			)}
			{documented.length > 0 ? (
				<div>
					<Button
						variant="link"
						size="sm"
						className="h-auto px-0 font-book text-fg-muted no-underline hover:text-fg"
						onClick={() => setShowDocumented((shown) => !shown)}
					>
						{showDocumented
							? "Hide documented variables"
							: `Show documented variables (${documented.length})`}
					</Button>
				</div>
			) : null}

			<Sheet
				open={editing !== null}
				onOpenChange={(open) => {
					if (!open) setEditing(null);
				}}
			>
				{editing === null ? null : (
					<SheetContent
						title={panelTitle}
						description={
							editing.description ??
							"Variable names may only contain letters, numbers, and underscores."
						}
						footer={
							<>
								<Button variant="ghost" onClick={() => setEditing(null)}>
									{editing.editable ? "Cancel" : "Close"}
								</Button>
								{editing.editable ? (
									<Button
										data-primary-action
										loading={saving}
										disabled={editing.loading}
										onClick={() => void save()}
									>
										Save
										<SaveHint />
									</Button>
								) : null}
							</>
						}
					>
						<div className="mt-8 flex flex-1 flex-col gap-6">
							<div className="flex flex-col gap-2">
								<Label htmlFor="env-edit-name">Name</Label>
								<Input
									id="env-edit-name"
									value={editing.draft.name}
									placeholder="MY_VARIABLE"
									disabled={editing.editable && !editing.canRename}
									readOnly={!editing.editable}
									autoFocus
									autoComplete="off"
									autoCapitalize="off"
									spellCheck={false}
									onChange={(event) =>
										setEditing({
											...editing,
											draft: { ...editing.draft, name: event.target.value },
										})
									}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<Label htmlFor="env-edit-value">Value</Label>
								<Textarea
									id="env-edit-value"
									value={editing.draft.value}
									placeholder="Use an empty value to set this variable to an empty string."
									readOnly={!editing.editable}
									disabled={editing.loading}
									autoComplete="off"
									autoCapitalize="off"
									spellCheck={false}
									className="block min-h-[280px] w-full font-mono text-sm"
									onChange={(event) =>
										setEditing({
											...editing,
											draft: { ...editing.draft, value: event.target.value },
										})
									}
								/>
							</div>
							{error === null ? null : (
								<p role="alert" className="text-sm text-danger">
									{error}
								</p>
							)}
						</div>
					</SheetContent>
				)}
			</Sheet>

			<AlertDialog
				open={pendingDelete !== null}
				onOpenChange={(open) => {
					if (!open) setPendingDelete(null);
				}}
			>
				<AlertDialogContent
					title="Remove variable?"
					description={
						pendingDelete === null
							? ""
							: `This removes ${pendingDelete} and its value from the Keychain.`
					}
					confirmLabel="Remove variable"
					tone="destructive"
					onConfirm={() => void confirmDelete()}
				/>
			</AlertDialog>
		</section>
	);
}

/** One of a row's square ghost actions at the right. */
function RowAction({
	label,
	icon,
	onClick,
}: {
	label: string;
	icon: ReactNode;
	onClick: () => void;
}) {
	return (
		<Button variant="ghost" size="sm" aria-label={label} className="w-7 px-0" onClick={onClick}>
			{icon}
		</Button>
	);
}

/**
 * Conductor's row (renderApp lci): 42% for the lock and the name with its meaning, 30% for the
 * value, and 88 px of actions that brighten on hover.
 */
function VariableRow({
	name,
	description,
	dimmed,
	unset = false,
	value,
	onToggleReveal,
	onCopy,
	actions,
}: {
	name: string;
	description: string | undefined;
	dimmed: boolean;
	/** A documented name with no value in this scope. */
	unset?: boolean;
	/** The revealed value, null while hidden, undefined when nothing is stored. */
	value: string | null | undefined;
	onToggleReveal: () => void;
	onCopy: () => void;
	actions: ReactNode;
}) {
	const shown = value !== undefined && value !== null;
	return (
		<tr className={cn("group border-b border-border last:border-0", dimmed && "opacity-50")}>
			<td className="w-[42%] py-3 pr-2 pl-3 align-middle">
				<div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
					<div className="flex h-5 items-center">
						<Tooltip content="Securely saved by Conducted" side="right">
							<span tabIndex={-1} className="inline-flex">
								<LockIcon aria-hidden="true" className="size-3.5 shrink-0 text-fg-muted" />
							</span>
						</Tooltip>
					</div>
					<div className="flex min-w-0 max-w-[360px] flex-col gap-1">
						<div className={cn("truncate font-mono text-sm leading-5", unset && "text-fg-muted")}>
							{name}
						</div>
						{description === undefined ? null : (
							<div className="max-w-full truncate text-xs text-fg-muted">{description}</div>
						)}
						{dimmed ? (
							<div className="max-w-full truncate text-xs text-fg-muted">Locally overwritten</div>
						) : null}
					</div>
				</div>
			</td>
			<td className="w-[30%] px-2 py-2 align-top">
				{value === undefined ? (
					<span className="inline-flex rounded-sm bg-muted px-2 py-1 text-xs text-fg-muted">
						Not set
					</span>
				) : (
					<div className="flex min-w-0 items-center gap-2">
						<Button
							variant="ghost"
							size="xs"
							className="w-6 px-0"
							aria-label={shown ? `Hide ${name}` : `Reveal ${name}`}
							onClick={onToggleReveal}
						>
							{shown ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
						</Button>
						<button
							type="button"
							className="min-w-0 max-w-full flex-1 truncate rounded-sm px-1 py-0.5 text-left font-mono text-xs text-fg-muted hover:bg-hover hover:text-fg"
							title={shown ? value : undefined}
							onClick={onCopy}
						>
							{shown ? value : MASK}
						</button>
					</div>
				)}
			</td>
			<td className="w-[88px] py-2 pr-2 text-right align-top whitespace-nowrap">
				<div className="flex items-center justify-end gap-0.5 opacity-70 group-focus-within:opacity-100 group-hover:opacity-100">
					{actions}
				</div>
			</td>
		</tr>
	);
}
