/**
 * @feature CHAT-06 A limit's reset time, as Conductor writes it
 * Owns: the one format for when a usage limit resets: a short date, then the hour and minutes.
 * Behaviour: Conductor's iC (renderApp @360589), used by the plan usage card and by the session
 * limit banner.
 * Test first: a reset time reads as a short date, a comma and the time.
 */

/** For example "Jan 1, 2026, 12:00 AM" in an English locale. */
export function formatResetTime(at: number): string {
	const time = new Date(at);
	const date = time.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
	const clock = time.toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	});
	return `${date}, ${clock}`;
}
