/**
 * @feature SET-04 Add environment variable form
 * Owns: the inline form that adds one variable: name and value.
 * Behaviour: ui-map.md 6, "Environment page".
 * Must handle: an invalid name (letters, digits and underscore, not starting with a digit), a name
 * already present in this scope (edit instead), a reserved name that the app sets itself (refused
 * with the reason), an empty value (allowed, means set to empty), pasting a "NAME=value" line into
 * the name field (splits it), and a failed save (form keeps its text).
 * Test first: pasting "TOKEN=abc" into the name field fills name "TOKEN" and value "abc".
 */
import { notImplemented } from "@conducted/shared";

export interface AddEnvVarFormProps {
	existingNames: readonly string[];
	reservedNames: readonly string[];
	onAdd: (name: string, value: string) => Promise<boolean>;
}

export function AddEnvVarForm(_props: AddEnvVarFormProps): never {
	return notImplemented("SET-04");
}
