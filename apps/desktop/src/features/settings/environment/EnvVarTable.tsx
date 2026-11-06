/**
 * @feature SET-04 Environment variable table
 * Owns: the table of variables for one scope: name, hidden value with reveal, override markers,
 * edit and remove.
 * Behaviour: ui-map.md 6, "Environment page" (Name, Value, "Locally overwritten", "Not set"; empty
 * state "No variables set. Add a variable to make it available in this environment.").
 * Must handle: no variables (designed empty state), a value revealed for a short time only (hides
 * again on blur or after 10 seconds, Our design choice), reveal failing (the row keeps a short
 * message), an edit that changed nothing (Save stays off, so the stored value is never replaced by
 * an empty field; Cancel keeps it), remove asking first, sorting by name, and keyboard access to
 * every action.
 * Test first: clicking reveal asks for the value once and hides it again after blur.
 */
import { useEffect, useState } from "react";
import type { EnvVarView } from "../../../core/model.ts";
import { AlertDialog, AlertDialogContent } from "../../../ui/AlertDialog.tsx";
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { Input } from "../../../ui/Input.tsx";

const REVEAL_MS = 10_000;

export interface EnvVarTableProps {
	vars: EnvVarView[];
	onReveal: (name: string) => Promise<string | null>;
	onEdit: (name: string, value: string) => Promise<boolean>;
	onRemove: (name: string) => Promise<boolean>;
}

interface Editing {
	name: string;
	value: string;
	/** What the field held when Edit opened: the revealed value, or empty when it was hidden. */
	initial: string;
}

export function EnvVarTable({ vars, onReveal, onEdit, onRemove }: EnvVarTableProps) {
	const [revealed, setRevealed] = useState<{ name: string; value: string } | null>(null);
	const [rowError, setRowError] = useState<{ name: string; message: string } | null>(null);
	const [editing, setEditing] = useState<Editing | null>(null);
	const [saving, setSaving] = useState(false);
	const [pendingRemove, setPendingRemove] = useState<string | null>(null);
	const sorted = [...vars].sort((left, right) => left.name.localeCompare(right.name));

	useEffect(() => {
		if (revealed === null) return;
		const timer = setTimeout(() => setRevealed(null), REVEAL_MS);
		return () => clearTimeout(timer);
	}, [revealed]);

	const reveal = async (name: string) => {
		if (revealed?.name === name) {
			setRevealed(null);
			return;
		}
		setRowError(null);
		const value = await onReveal(name);
		if (value === null) {
			setRowError({ name, message: "No value is stored for this variable." });
			return;
		}
		setRevealed({ name, value });
	};

	const saveEdit = async () => {
		if (editing === null || editing.value === editing.initial) return;
		setSaving(true);
		const saved = await onEdit(editing.name, editing.value);
		setSaving(false);
		if (!saved) {
			setRowError({ name: editing.name, message: "Couldn't save the value." });
			return;
		}
		setEditing(null);
		setRowError(null);
	};

	const remove = async () => {
		const name = pendingRemove;
		setPendingRemove(null);
		if (name === null) return;
		const removed = await onRemove(name);
		if (!removed) setRowError({ name, message: "Couldn't remove the variable." });
		else if (revealed?.name === name) setRevealed(null);
	};

	if (sorted.length === 0) {
		return (
			<EmptyState
				compact
				title="No variables set"
				body="Add a variable to make it available in this environment."
			/>
		);
	}

	return (
		<>
			<table className="w-full border-collapse text-sm">
				<thead>
					<tr className="border-b border-border text-left text-xs text-fg-muted">
						<th className="py-2 pr-3 font-medium">Name</th>
						<th className="py-2 pr-3 font-medium">Value</th>
						<th className="py-2 pr-3 font-medium" />
						<th className="py-2 font-medium">
							<span className="sr-only">Actions</span>
						</th>
					</tr>
				</thead>
				<tbody>
					{sorted.map((variable) => {
						const isRevealed = revealed?.name === variable.name;
						const error = rowError?.name === variable.name ? rowError.message : null;
						return (
							<tr key={variable.name} className="border-b border-border align-middle">
								<td className="py-2 pr-3 font-mono text-code text-fg">{variable.name}</td>
								<td className="py-2 pr-3">
									{editing?.name === variable.name ? (
										<div className="flex flex-col gap-1">
											<div className="flex items-center gap-2">
												<Input
													aria-label={`New value for ${variable.name}`}
													aria-describedby={`env-edit-${variable.name}`}
													type="password"
													value={editing.value}
													placeholder="Enter a new value"
													autoComplete="off"
													onChange={(event) =>
														setEditing({ ...editing, value: event.target.value })
													}
												/>
												<Button
													size="sm"
													loading={saving}
													disabled={editing.value === editing.initial}
													onClick={() => void saveEdit()}
												>
													Save
												</Button>
												<Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
													Cancel
												</Button>
											</div>
											<p id={`env-edit-${variable.name}`} className="text-xs text-fg-muted">
												The saved value stays until you save a new one.
											</p>
										</div>
									) : !variable.hasValue ? (
										<span className="text-fg-muted">Not set</span>
									) : isRevealed ? (
										<Input
											aria-label={`Value of ${variable.name}`}
											readOnly
											autoFocus
											className="font-mono"
											value={revealed.value}
											onBlur={() => setRevealed(null)}
										/>
									) : (
										<span className="text-fg-muted">••••••••</span>
									)}
								</td>
								<td className="py-2 pr-3 text-xs text-fg-muted">
									{variable.overridesGlobal ? "Locally overwritten" : null}
									{variable.overriddenInRepos > 0
										? `Overridden in ${variable.overriddenInRepos} ${
												variable.overriddenInRepos === 1 ? "repository" : "repositories"
											}`
										: null}
								</td>
								<td className="py-2">
									<div className="flex items-center justify-end gap-1">
										<Button
											size="sm"
											variant="ghost"
											disabled={!variable.hasValue}
											onClick={() => void reveal(variable.name)}
										>
											{isRevealed ? "Hide" : "Reveal"}
										</Button>
										<Button
											size="sm"
											variant="ghost"
											onClick={() => {
												const initial = isRevealed ? revealed.value : "";
												setEditing({ name: variable.name, value: initial, initial });
											}}
										>
											Edit
										</Button>
										<Button
											size="sm"
											variant="outlineDestructive"
											onClick={() => setPendingRemove(variable.name)}
										>
											Remove
										</Button>
									</div>
									{error === null ? null : (
										<p role="alert" className="mt-1 text-right text-xs text-danger">
											{error}
										</p>
									)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			<AlertDialog
				open={pendingRemove !== null}
				onOpenChange={(open) => {
					if (!open) setPendingRemove(null);
				}}
			>
				<AlertDialogContent
					title="Remove variable?"
					description={
						pendingRemove === null
							? ""
							: `This removes ${pendingRemove} and its value from the Keychain.`
					}
					confirmLabel="Remove variable"
					tone="destructive"
					onConfirm={() => void remove()}
				/>
			</AlertDialog>
		</>
	);
}
