/**
 * @feature REV-02 Diff toolbar
 * Owns: the controls for how a diff is drawn. Unified or split layout, entire file, hide
 * whitespace changes, wrap lines.
 * Behaviour: ui-map.md 3.2 (File tab: "Unified view", "Split view", "Entire file", "View options"
 * with "Hide whitespace changes" and "Wrap lines"). Preferences are user settings (keys
 * using_split_view, hide_whitespace_changes, wrap_lines in services-map.md 4.2.3).
 * Must handle: a narrow tab (split layout disabled below a width threshold, Our design choice), a
 * binary file (controls disabled), and changing a preference while a diff is loading.
 * Our design choice: the parent measures the tab or pane and passes its width in. The toolbar is
 * only as wide as its buttons, so measuring it would think every tab is narrow.
 * Test first: toggling "Wrap lines" calls onChange with wrapLines flipped and nothing else changed.
 */
import { useId } from "react";
import { Button } from "../../ui/Button.tsx";
import { Checkbox } from "../../ui/Checkbox.tsx";
import { Popover } from "../../ui/Popover.tsx";
import type { DiffPreferences } from "./diff-types.ts";

/** Below this width the two columns of a split diff no longer fit. Our design choice. */
export const SPLIT_MIN_WIDTH = 560;

export interface DiffToolbarProps {
	preferences: DiffPreferences;
	onChange: (next: DiffPreferences) => void;
	disabled: boolean;
	/** Width of the tab or pane in pixels. Null or absent means it has not been measured yet. */
	width?: number | null;
}

export function DiffToolbar({ preferences, onChange, disabled, width = null }: DiffToolbarProps) {
	const splitDisabled = disabled || (width !== null && width < SPLIT_MIN_WIDTH);
	// Two diff tabs can be on screen at once (split panes), so the ids cannot be fixed strings.
	const idPrefix = useId();
	const update = (patch: Partial<DiffPreferences>) => onChange({ ...preferences, ...patch });

	return (
		<div className="flex min-w-0 items-center gap-1">
			<div className="flex items-center gap-0.5">
				<Button
					variant={preferences.layout === "unified" ? "secondary" : "ghost"}
					size="xs"
					aria-pressed={preferences.layout === "unified"}
					disabled={disabled}
					onClick={() => update({ layout: "unified" })}
				>
					Unified view
				</Button>
				<Button
					variant={preferences.layout === "split" ? "secondary" : "ghost"}
					size="xs"
					aria-pressed={preferences.layout === "split"}
					disabled={splitDisabled}
					title={splitDisabled && !disabled ? "Split view needs a wider tab" : undefined}
					onClick={() => update({ layout: "split" })}
				>
					Split view
				</Button>
			</div>
			<Button
				variant={preferences.entireFile ? "secondary" : "ghost"}
				size="xs"
				aria-pressed={preferences.entireFile}
				disabled={disabled}
				onClick={() => update({ entireFile: !preferences.entireFile })}
			>
				Entire file
			</Button>
			<Popover
				trigger={
					<Button variant="ghost" size="xs" disabled={disabled}>
						View options
					</Button>
				}
				align="start"
			>
				<div className="flex w-56 flex-col gap-2">
					<label
						className="flex items-center gap-2 text-sm"
						htmlFor={`${idPrefix}-hide-whitespace`}
					>
						<Checkbox
							id={`${idPrefix}-hide-whitespace`}
							aria-label="Hide whitespace changes"
							checked={preferences.hideWhitespaceChanges}
							disabled={disabled}
							onCheckedChange={(checked) => update({ hideWhitespaceChanges: checked })}
						/>
						<span>Hide whitespace changes</span>
					</label>
					<label className="flex items-center gap-2 text-sm" htmlFor={`${idPrefix}-wrap-lines`}>
						<Checkbox
							id={`${idPrefix}-wrap-lines`}
							aria-label="Wrap lines"
							checked={preferences.wrapLines}
							disabled={disabled}
							onCheckedChange={(checked) => update({ wrapLines: checked })}
						/>
						<span>Wrap lines</span>
					</label>
				</div>
			</Popover>
		</div>
	);
}
