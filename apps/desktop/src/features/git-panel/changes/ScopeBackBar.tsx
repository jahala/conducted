/**
 * @feature REV-01 Scope back bar
 * Owns: the thin bar with a back button that shows while the Changes tab is not on its default
 * scope (a single commit or turn). Back returns to all changes.
 * Behaviour: ui-map.md 3.6 ("A back button returns to All changes").
 * Must handle: showing what the scope is (commit subject or turn number), and hiding itself on the
 * default scope.
 * Test first: with a commit scope the bar shows the subject and clicking Back calls onBack.
 */
import { notImplemented } from "@conducted/shared";

export interface ScopeBackBarProps {
	/** Short text naming the narrowed scope, e.g. a commit subject. */
	label: string;
	onBack: () => void;
}

export function ScopeBackBar(_props: ScopeBackBarProps): never {
	return notImplemented("REV-01");
}
