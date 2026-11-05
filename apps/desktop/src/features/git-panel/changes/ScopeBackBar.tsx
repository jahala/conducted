/**
 * @feature REV-01 Scope back bar
 * Owns: the thin bar with a back button that shows while the Changes tab is not on its default
 * scope (a single commit or turn). Back returns to all changes.
 * Behaviour: ui-map.md 3.6 ("A back button returns to All changes").
 * Must handle: showing what the scope is (the commit subject, or "One turn"), and hiding itself on the
 * default scope.
 * Test first: with a commit scope the bar shows the subject and clicking Back calls onBack.
 */
import { ArrowLeftIcon } from "../../../ui/icons.tsx";

export interface ScopeBackBarProps {
	/** Short text naming the narrowed scope, e.g. a commit subject. */
	label: string;
	onBack: () => void;
}

export function ScopeBackBar({ label, onBack }: ScopeBackBarProps) {
	return (
		<div className="flex h-8 shrink-0 items-center gap-2 border-b border-separator px-2">
			<button
				type="button"
				onClick={onBack}
				className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-xs text-fg-muted hover:bg-hover hover:text-fg"
			>
				<ArrowLeftIcon className="size-3.5" />
				All changes
			</button>
			<span className="min-w-0 flex-1 truncate text-xs text-fg-subtle" title={label}>
				{label}
			</span>
		</div>
	);
}
