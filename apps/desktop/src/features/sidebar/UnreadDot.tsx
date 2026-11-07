/**
 * @feature NAV-11 Unread dot
 * Owns: the small dot that marks a chat tab with something new. A workspace row shows unread by its
 * name's weight instead, as Conductor's row does.
 * Behaviour: ui-map.md 3.2 (chat tab: unread dot).
 * The dot uses the `unread` colour token named by ui-map.md section 8. It is named for screen
 * readers; the count of unread chats is the caller's business.
 * Must handle: used in tabs without extra spacing; hidden when `unread` is false.
 * Test first: renders an element named "Unread" when unread is true and nothing otherwise.
 */
export function UnreadDot({ unread }: { unread: boolean }) {
	if (!unread) return null;
	return (
		<span
			role="img"
			aria-label="Unread"
			className="inline-block size-2 shrink-0 rounded-full bg-unread"
		/>
	);
}
