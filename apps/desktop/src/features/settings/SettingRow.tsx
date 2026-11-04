/**
 * @feature SET-02 Setting row
 * Owns: the layout of one setting: title, description, scope marker, and the control on the right.
 * Behaviour: ui-map.md 6 (each setting has a title, a description and scopes user or repository;
 * per-repository settings offer a reset to the shared file's value).
 * Our design choice: the control is passed in as children, so one row serves toggles, selects,
 * text fields and custom blocks.
 * Must handle: a long description (wraps, no truncation), a disabled setting with a reason (for
 * example locked by the repository file), a setting that is highlighted after a search jump, a
 * value saved with a spinner and an error line when saving fails, and keyboard focus ring on the
 * control.
 * Test first: with a disabledReason the control is disabled and the reason is shown.
 */
import { notImplemented } from "@conducted/shared";
import type { ReactNode } from "react";

export interface SettingRowProps {
	settingKey: string;
	title: string;
	description: string | null;
	scope: "user" | "repo";
	disabledReason: string | null;
	highlighted: boolean;
	saveError: string | null;
	/** Shown when a repository value overrides the user value, with a way back. */
	onResetToShared?: () => void;
	children: ReactNode;
}

export function SettingRow(_props: SettingRowProps): never {
	return notImplemented("SET-02");
}
