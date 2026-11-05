/**
 * @feature REV-01 Review button with the "edit before sending" option
 * Owns: the split button in the tab strip. The main part starts an AI review in a new chat. The
 * menu part opens the prompt for editing first.
 * Behaviour: ui-map.md 3.6 (tab strip: "Review" button, tooltip, split item "Edit before sending",
 * shortcut Cmd+Shift+R). The review prompt can be customised per repository (settings page
 * RepoPromptsPage).
 * Must handle: no changes to review (disabled with an explanation), a review already running
 * (disabled), the call failing (toast, button usable again), and the chosen review model coming
 * from settings, not from this component.
 * Test first: clicking the main part calls requestAiReview with null instructions, and the menu
 * item opens the prompt editor without calling it.
 */
import { formatShortcut, getCommand } from "../../core/registries/commands.ts";
import { Button } from "../../ui/Button.tsx";
import { ChevronDownIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/Menu.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";

export interface ReviewButtonProps {
	disabled: boolean;
	disabledReason: string | null;
	onReview: () => void;
	onReviewWithEdit: () => void;
}

const SHORTCUT = formatShortcut(getCommand("review.start")?.defaultShortcuts[0] ?? "");

export function ReviewButton({
	disabled,
	disabledReason,
	onReview,
	onReviewWithEdit,
}: ReviewButtonProps) {
	const tooltip = disabled && disabledReason !== null ? disabledReason : "Get an AI code review";
	return (
		<div className="flex items-center">
			<Tooltip content={tooltip} shortcut={disabled ? undefined : SHORTCUT}>
				<Button
					variant="secondary"
					size="sm"
					disabled={disabled}
					onClick={onReview}
					className="rounded-r-none"
				>
					Review
				</Button>
			</Tooltip>
			<Menu>
				<MenuTrigger asChild>
					<Button
						variant="secondary"
						size="sm"
						aria-label="Review options"
						disabled={disabled}
						className="rounded-l-none border-l border-separator px-1.5"
					>
						<ChevronDownIcon className="size-3" />
					</Button>
				</MenuTrigger>
				<MenuContent align="end">
					<MenuItem onSelect={onReviewWithEdit}>Edit before sending</MenuItem>
				</MenuContent>
			</Menu>
		</div>
	);
}
