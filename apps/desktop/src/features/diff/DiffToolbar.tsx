/**
 * @feature REV-02 Diff toolbar
 * Owns: the controls for how a diff is drawn: the Unified and Split layout toggles, and the "View
 * options" menu with Entire file, Hide whitespace changes and Wrap lines.
 * Behaviour: ui-map.md 3.2 (File tab: "Unified view", "Split view", "Entire file", "View options"
 * with "Hide whitespace changes" and "Wrap lines"). Preferences are user settings (keys
 * using_split_view, hide_whitespace_changes, wrap_lines in services-map.md 4.2.3). Measured from
 * Conductor 0.92.1 (renderApp @9643574, @9645000): the layouts are 28px icon toggles with 12px icons
 * inside the file header's segmented group, and "View options" is a 28px vertical-dots button whose
 * menu holds the checkboxes.
 * Must handle: a narrow tab (split layout disabled below a width threshold, Our design choice), a
 * binary file (controls disabled), and changing a preference while a diff is loading.
 * Our design choice: the parent measures the tab or pane and passes its width in. The toolbar is
 * only as wide as its buttons, so measuring it would think every tab is narrow. Conductor's "Entire
 * file" is a third view beside the layouts; ours widens the diff to the whole file, so it is a
 * checkbox under View options, and the file header's own toggle opens the whole file for editing.
 * Test first: toggling "Wrap lines" calls onChange with wrapLines flipped and nothing else changed.
 */
import { useId } from "react";
import { Checkbox } from "../../ui/Checkbox.tsx";
import { cn } from "../../ui/cn.ts";
import { ColumnsIcon, FileDiffIcon, MoreVerticalIcon } from "../../ui/icons.tsx";
import { Popover } from "../../ui/Popover.tsx";
import type { DiffPreferences } from "./diff-types.ts";

/** Below this width the two columns of a split diff no longer fit. Our design choice. */
export const SPLIT_MIN_WIDTH = 560;

/** A 28px icon button in the file header, filled while pressed. The one look every header toggle uses. */
export const headerIconButtonClass =
	"flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-active aria-pressed:text-fg";

export interface DiffToolbarProps {
	preferences: DiffPreferences;
	onChange: (next: DiffPreferences) => void;
	disabled: boolean;
	/** Width of the tab or pane in pixels. Null or absent means it has not been measured yet. */
	width?: number | null;
	/**
	 * True while the diff is the view on show, so the layout in use reads as pressed. Off when the
	 * header shows the file or its preview: the toggles then switch back to the diff.
	 */
	active?: boolean;
	/** Called with the layout when a toggle is pressed, so the header can switch back to the diff. */
	onShowDiff?: () => void;
}

/** Unified view and Split view, as icon toggles for the file header's segmented group. */
export function DiffLayoutToggles({
	preferences,
	onChange,
	disabled,
	width = null,
	active = true,
	onShowDiff,
}: DiffToolbarProps) {
	const splitDisabled = disabled || (width !== null && width < SPLIT_MIN_WIDTH);
	const choose = (layout: DiffPreferences["layout"]) => {
		if (layout !== preferences.layout) onChange({ ...preferences, layout });
		onShowDiff?.();
	};
	return (
		<>
			<button
				type="button"
				aria-label="Unified view"
				title="Unified view"
				aria-pressed={active && preferences.layout === "unified"}
				disabled={disabled}
				className={headerIconButtonClass}
				onClick={() => choose("unified")}
			>
				<FileDiffIcon className="size-3" />
			</button>
			<button
				type="button"
				aria-label="Split view"
				title={splitDisabled && !disabled ? "Split view needs a wider tab" : "Split view"}
				aria-pressed={active && preferences.layout === "split"}
				disabled={splitDisabled}
				className={headerIconButtonClass}
				onClick={() => choose("split")}
			>
				<ColumnsIcon className="size-3" />
			</button>
		</>
	);
}

/** The vertical-dots "View options" menu: Entire file, Hide whitespace changes, Wrap lines. */
export function DiffViewOptions({
	preferences,
	onChange,
	disabled,
}: Pick<DiffToolbarProps, "preferences" | "onChange" | "disabled">) {
	// Two diff tabs can be on screen at once (split panes), so the ids cannot be fixed strings.
	const idPrefix = useId();
	const update = (patch: Partial<DiffPreferences>) => onChange({ ...preferences, ...patch });
	const options = [
		{
			key: "entire-file",
			label: "Entire file",
			checked: preferences.entireFile,
			field: "entireFile",
		},
		{
			key: "hide-whitespace",
			label: "Hide whitespace changes",
			checked: preferences.hideWhitespaceChanges,
			field: "hideWhitespaceChanges",
		},
		{ key: "wrap-lines", label: "Wrap lines", checked: preferences.wrapLines, field: "wrapLines" },
	] as const;

	return (
		<Popover
			trigger={
				<button
					type="button"
					aria-label="View options"
					title="View options"
					disabled={disabled}
					className={cn(headerIconButtonClass)}
				>
					<MoreVerticalIcon className="size-3" />
				</button>
			}
			align="end"
		>
			<div className="flex w-56 flex-col gap-2">
				{options.map((option) => (
					<label
						key={option.key}
						className="flex items-center gap-2 text-sm"
						htmlFor={`${idPrefix}-${option.key}`}
					>
						<Checkbox
							id={`${idPrefix}-${option.key}`}
							aria-label={option.label}
							checked={option.checked}
							disabled={disabled}
							onCheckedChange={(checked) => update({ [option.field]: checked })}
						/>
						<span>{option.label}</span>
					</label>
				))}
			</div>
		</Popover>
	);
}
