/**
 * @feature SET-04 Add environment variable form
 * Owns: the inline form that adds one variable: name and value.
 * Behaviour: ui-map.md 6, "Environment page".
 * Must handle: an invalid name (letters, digits and underscore, not starting with a digit), a name
 * already present in this scope (the user edits it in the table instead), a reserved name that the
 * app sets itself (refused with the reason), an empty value (allowed, means set to empty), pasting
 * a "NAME=value" line into the name field (splits it), and a failed save (form keeps its text).
 * Test first: pasting "TOKEN=abc" into the name field fills name "TOKEN" and value "abc".
 */
import { useState } from "react";
import { isReservedEnvVarName, validateEnvVarName } from "../../../core/services/settings.ts";
import { Button } from "../../../ui/Button.tsx";
import { Input, Label } from "../../../ui/Input.tsx";

const splitAssignment = (text: string): { name: string; value: string } | null => {
	const at = text.indexOf("=");
	if (at < 0) return null;
	return { name: text.slice(0, at).trim(), value: text.slice(at + 1) };
};

export interface AddEnvVarFormProps {
	existingNames: readonly string[];
	reservedNames: readonly string[];
	onAdd: (name: string, value: string) => Promise<boolean>;
}

export function AddEnvVarForm({ existingNames, reservedNames, onAdd }: AddEnvVarFormProps) {
	const [name, setName] = useState("");
	const [value, setValue] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const changeName = (text: string) => {
		const assignment = splitAssignment(text);
		if (assignment === null) {
			setName(text);
			return;
		}
		setName(assignment.name);
		setValue(assignment.value);
	};

	const submit = async () => {
		const trimmed = name.trim();
		const valid = validateEnvVarName(trimmed);
		if (!valid.ok) {
			setError(valid.error.message);
			return;
		}
		if (reservedNames.includes(trimmed) || isReservedEnvVarName(trimmed)) {
			setError(`The app sets ${trimmed} itself. Choose another name.`);
			return;
		}
		if (existingNames.includes(trimmed)) {
			setError("This variable is already set here. Edit it in the table below.");
			return;
		}
		setSaving(true);
		const saved = await onAdd(trimmed, value);
		setSaving(false);
		if (!saved) {
			setError("Couldn't save the variable. Its name and value are still here.");
			return;
		}
		setName("");
		setValue("");
		setError(null);
	};

	return (
		<form
			className="flex flex-col gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<div className="flex items-end gap-2">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<Label htmlFor="env-var-name">Name</Label>
					<Input
						id="env-var-name"
						value={name}
						autoComplete="off"
						autoCapitalize="off"
						spellCheck={false}
						placeholder="TOKEN"
						className="font-mono"
						onChange={(event) => changeName(event.target.value)}
					/>
				</div>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<Label htmlFor="env-var-value">Value</Label>
					<Input
						id="env-var-value"
						type="password"
						value={value}
						autoComplete="off"
						placeholder="Value, kept in the Keychain"
						onChange={(event) => setValue(event.target.value)}
					/>
				</div>
				<Button type="submit" loading={saving}>
					Add variable
				</Button>
			</div>
			{error === null ? null : (
				<p role="alert" className="text-xs text-danger">
					{error}
				</p>
			)}
		</form>
	);
}
