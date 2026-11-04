/**
 * @feature NAV-11 Next unread button
 * Owns: The 'Next unread' button in the chat that jumps to the next chat needing attention.
 * Behaviour: ui-map.md 3.3 ('Next unread' button), 5.4 (Cmd+Alt+L).
 * Must handle: Nothing unread (hidden); the target is in another workspace (navigates there); the
 * target is the current chat (skipped, see next-unread.ts).
 * Test first: With one other chat unread the button shows and click navigates to that chat.
 */
import { notImplemented } from "@conducted/shared";

export interface NextUnreadButtonProps {
	currentSessionId: import("@conducted/shared").SessionId;
}

export function NextUnreadButton(_props: NextUnreadButtonProps): never {
	return notImplemented("NAV-11");
}
