/**
 * @feature SET-04 Environment variable table
 * Owns: the table of variables for one scope: name, hidden value with reveal, override markers,
 * edit and remove.
 * Behaviour: ui-map.md 6, "Environment page" (Name, Value, "Locally overwritten", "Not set"; empty
 * state "No variables set. Add a variable to make it available in this environment.").
 * Must handle: no variables (designed empty state), a value revealed for a short time only (hides
 * again on blur or after 10 seconds, Our design choice), reveal failing (Keychain error shown in
 * the row), remove asking first, sorting by name, and keyboard access to every action.
 * Test first: clicking reveal asks for the value once and hides it again after blur.
 */
import { notImplemented } from "@conducted/shared";
import type { EnvVarView } from "../../../core/model.ts";

export interface EnvVarTableProps {
	vars: EnvVarView[];
	onReveal: (name: string) => Promise<string | null>;
	onEdit: (name: string, value: string) => Promise<boolean>;
	onRemove: (name: string) => Promise<boolean>;
}

export function EnvVarTable(_props: EnvVarTableProps): never {
	return notImplemented("SET-04");
}
