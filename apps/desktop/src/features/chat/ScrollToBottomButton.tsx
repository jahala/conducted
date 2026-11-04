/**
 * @feature CHAT-06 Scroll to bottom button
 * Owns: The floating button that appears when the list is not at the bottom.
 * Behaviour: frontend.md 5 ('Scroll to bottom' button portalled into an overlay), ui-map.md 3.3
 * (sticky 'Scroll to bottom').
 * Must handle: Hidden at the bottom; new content arrived while away (a small 'New' marker);
 * keyboard reachable; does not cover the last line of text.
 * Test first: Visible only when atBottom is false; click calls onClick.
 */
import { notImplemented } from "@conducted/shared";

export interface ScrollToBottomButtonProps {
	visible: boolean;
	hasNew: boolean;
	onClick: () => void;
}

export function ScrollToBottomButton(_props: ScrollToBottomButtonProps): never {
	return notImplemented("CHAT-06");
}
