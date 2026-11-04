/**
 * @feature NAV-11 Unread dot
 * Owns: the small dot that marks a workspace or chat with something new.
 * Behaviour: ui-map.md 3.2 (chat tab: unread dot), 4 (workspace row: unread dot).
 * Our design choice: unread is "the one thing to look at" in a row, so it is the accent colour. The dot is
 * named for screen readers; the count of unread chats is the caller's business.
 * Must handle: used in rows and tabs without extra spacing; hidden when `unread` is false.
 * Test first: renders an element named "Unread" when unread is true and nothing otherwise.
 */
export function UnreadDot({ unread }: { unread: boolean }) {
	if (!unread) return null;
	return (
		<span
			role="img"
			aria-label="Unread"
			className="inline-block size-2 shrink-0 rounded-full bg-accent"
		/>
	);
}
