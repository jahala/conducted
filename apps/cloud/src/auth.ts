/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Owns: the pairing-token check every request runs before a Durable Object is touched.
 * Behaviour: docs/research/cloud-spike-2026-11-06.md, "The plan's questions 3, 4 and 7" question 4
 * (32 random bytes made at setup and stored as a Worker secret, checked in constant time on every
 * route; a request without it gets 401 and starts nothing).
 * Must handle: a missing or empty configured token refuses every request; the comparison does not
 * short-circuit on a matching prefix.
 * Test first: a request without the pairing token is refused with 401.
 */

/** The exact header form a client sends. The token is never logged. */
const BEARER = /^Bearer (.+)$/;

/**
 * Compares two strings without revealing where they first differ. The lengths are compared first,
 * which is the usual, accepted leak: it says nothing about the token's bytes.
 */
export function sameToken(given: string, expected: string): boolean {
	const a = new TextEncoder().encode(given);
	const b = new TextEncoder().encode(expected);
	if (a.byteLength !== b.byteLength) return false;
	return crypto.subtle.timingSafeEqual(a, b);
}

/** True when `request` carries the configured pairing token. */
export function isAuthorized(request: Request, expected: string | undefined): boolean {
	if (expected === undefined || expected === "") return false;
	const header = request.headers.get("authorization");
	if (header === null) return false;
	const match = BEARER.exec(header);
	return match?.[1] !== undefined && sameToken(match[1], expected);
}
