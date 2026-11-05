/**
 * @feature RUN-01 Run toolbar
 * Owns: the row above the run output. The action select, the Run or Stop button, and the split
 * Open button whose menu lists every preview URL.
 * Behaviour: ui-map.md 3.7, "Run" paragraph and "Preview and open buttons"; the button text comes
 * from run-button-label.ts and the URL list from PreviewUrlMenu.
 * Must handle: one action only (the select is hidden), many actions (the select lists them), the
 * Open button disabled until a URL is known (with the reason as its title), several URLs opening
 * from the menu, and the button text changing without the layout jumping (fixed minimum width).
 * Test first: with a detected localhost URL the Open button is enabled and opens it.
 */
import { Button } from "../../../ui/Button.tsx";
import { Select } from "../../../ui/Select.tsx";
import { PreviewUrlMenu } from "./PreviewUrlMenu.tsx";
import type { RunButtonModel } from "./run-button-label.ts";

export interface RunToolbarProps {
	actions: { id: string; label: string }[];
	selectedActionId: string;
	onSelectAction: (id: string) => void;
	button: RunButtonModel;
	onButtonClick: () => void;
	urls: { label: string; url: string; source?: "run_output" | "detected_port" | "template" }[];
	onOpenUrl: (url: string) => void;
	defaultUrl?: string | null;
	onSetDefault?: (url: string) => void;
}

export function RunToolbar({
	actions,
	selectedActionId,
	onSelectAction,
	button,
	onButtonClick,
	urls,
	onOpenUrl,
	defaultUrl,
	onSetDefault,
}: RunToolbarProps) {
	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-separator px-3 py-2">
			{actions.length > 1 ? (
				<Select
					aria-label="Select task"
					value={selectedActionId}
					options={actions.map((action) => ({ value: action.id, label: action.label }))}
					onValueChange={onSelectAction}
					size="sm"
				/>
			) : null}
			<Button
				variant={
					button.click === "stop" || button.click === "stop_spotlight" ? "outline" : "default"
				}
				size="sm"
				disabled={button.disabled}
				className="min-w-[8rem]"
				onClick={onButtonClick}
			>
				{button.label}
			</Button>
			<PreviewUrlMenu
				urls={urls.map((entry) => ({
					label: entry.label,
					url: entry.url,
					source: entry.source ?? "run_output",
				}))}
				defaultUrl={defaultUrl ?? null}
				onOpen={onOpenUrl}
				onSetDefault={onSetDefault}
			/>
		</div>
	);
}
