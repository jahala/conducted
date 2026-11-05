/**
 * @feature CHAT-06 Scroll to bottom button
 * Owns: The floating button that appears when the list is not at the bottom.
 * Behaviour: frontend.md 5 ('Scroll to bottom' button portalled into an overlay), ui-map.md 3.3
 * (sticky 'Scroll to bottom').
 * Must handle: Hidden at the bottom; new content arrived while away (a small 'New' marker);
 * keyboard reachable; does not cover the last line of text.
 * Test first: Visible only when atBottom is false; click calls onClick.
 */

import { IconButton } from "../../ui/IconButton.tsx";
import { ChevronDownIcon } from "../../ui/icons.tsx";

export interface ScrollToBottomButtonProps {
	visible: boolean;
	hasNew: boolean;
	onClick: () => void;
}

export function ScrollToBottomButton({ visible, hasNew, onClick }: ScrollToBottomButtonProps) {
	if (!visible) return null;
	return (
		<div className="pointer-events-none sticky bottom-3 z-10 flex justify-center">
			<div className="pointer-events-auto relative">
				<IconButton
					label={hasNew ? "Scroll to bottom, new messages" : "Scroll to bottom"}
					icon={<ChevronDownIcon />}
					variant="secondary"
					className="border border-border-strong bg-raised shadow-popover"
					onClick={onClick}
				/>
				{hasNew ? (
					<span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-accent px-1.5 text-3xs font-medium text-canvas">
						New
					</span>
				) : null}
			</div>
		</div>
	);
}
