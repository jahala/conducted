/**
 * @feature SET-02 Settings page frame
 * Owns: the common frame of every settings page: title, description, sections, and the designed
 * loading and error states for the page's data.
 * Behaviour: ui-map.md 6 and 7.3 to 7.4 (loading skeletons with role status, error cards).
 * Must handle: loading (skeleton rows), error with Retry, a long page scrolling under a fixed
 * title, and a section anchor being scrolled into view when the page opens from search.
 * Test first: with state "error" the frame shows the message and a Retry button that calls onRetry.
 */
import { notImplemented } from "@conducted/shared";
import type { ReactNode } from "react";

export interface SettingsPageFrameProps {
	title: string;
	description: string | null;
	state: "loading" | "error" | "ready";
	errorMessage: string | null;
	onRetry: () => void;
	/** The setting to scroll to and highlight, when the page opened from search. */
	focusSettingKey: string | null;
	children: ReactNode;
}

export function SettingsPageFrame(_props: SettingsPageFrameProps): never {
	return notImplemented("SET-02");
}
