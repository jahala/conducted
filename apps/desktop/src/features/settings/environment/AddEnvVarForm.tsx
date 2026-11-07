/**
 * @feature SET-04 Add environment variable form
 * Owns: the inline form that adds one variable: name and value.
 * Behaviour: ui-map.md 6, "Environment page".
 * Must handle: an invalid name (letters, digits and underscore, not starting with a digit), a name
 * already present in this scope (the user edits it in the table instead), a reserved name that the
 * app sets itself (refused with the reason), an empty value (allowed, means set to empty), pasting
 * a "NAME=value" line into the name field (splits it), and a failed save (form keeps its text).
 * Children: EnvVarSuggestions (SET-11) under the fields; its arrow keys, Enter and Escape work
 * while the name field has focus.
 * Test first: pasting "TOKEN=abc" into the name field fills name "TOKEN" and value "abc".
 */
import { type KeyboardEvent, useMemo, useState } from "react";
import { isReservedEnvVarName, validateEnvVarName } from "../../../core/services/settings.ts";
import { Button } from "../../../ui/Button.tsx";
import { Input, Label } from "../../../ui/Input.tsx";
import { EnvVarSuggestions, suggestEnvVars } from "./EnvVarSuggestions.tsx";

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
	const [activeSuggestion, setActiveSuggestion] = useState(-1);
	const [suggestionsHidden, setSuggestionsHidden] = useState(false);
	const suggestions = useMemo(
		() => (suggestionsHidden ? [] : suggestEnvVars(name, existingNames)),
		[name, existingNames, suggestionsHidden],
	);

	const changeName = (text: string) => {
		setSuggestionsHidden(false);
		setActiveSuggestion(-1);
		const assignment = splitAssignment(text);
		if (assignment === null) {
			setName(text);
			return;
		}
		setName(assignment.name);
		setValue(assignment.value);
	};

	const pickSuggestion = (picked: string) => {
		setName(picked);
		setSuggestionsHidden(true);
		setActiveSuggestion(-1);
	};

	const onNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (suggestions.length === 0) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveSuggestion((current) => (current + 1) % suggestions.length);
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveSuggestion((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
			return;
		}
		if (event.key === "Enter" && activeSuggestion >= 0) {
			const chosen = suggestions[activeSuggestion];
			if (chosen !== undefined) {
				event.preventDefault();
				pickSuggestion(chosen.name);
			}
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			setSuggestionsHidden(true);
			setActiveSuggestion(-1);
		}
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
						placeholder="MY_VARIABLE"
						className="font-mono"
						onKeyDown={onNameKeyDown}
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
						placeholder="Use an empty value to set this variable to an empty string."
						onChange={(event) => setValue(event.target.value)}
					/>
				</div>
				<Button type="submit" loading={saving}>
					Add variable
				</Button>
			</div>
			{suggestionsHidden ? null : (
				<EnvVarSuggestions
					query={name}
					existingNames={existingNames}
					activeIndex={activeSuggestion}
					onHighlight={setActiveSuggestion}
					onPick={pickSuggestion}
				/>
			)}
			{error === null ? null : (
				<p role="alert" className="text-xs text-danger">
					{error}
				</p>
			)}
		</form>
	);
}
