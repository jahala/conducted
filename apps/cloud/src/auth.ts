/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * @feature CLOUD-07 Pair the desktop app with the user's Worker
 * Owns: the pairing-token check every request runs before a Durable Object is touched, and the
 * answer the desktop reads when it checks a Worker URL and token before pairing.
 * Behaviour: docs/research/cloud-spike-2026-11-06.md, "The plan's questions 3, 4 and 7" question 4
 * (32 random bytes made at setup and stored as a Worker secret, checked in constant time on every
 * route; a request without it gets 401 and starts nothing). CLOUD-07: the desktop sends the URL
 * and token it was given to `/pair`, and an answer that names this Worker confirms both.
 * Must handle: a missing or empty configured token refuses every request; the comparison does not
 * short-circuit on a matching prefix; `/pair` starts no Durable Object, so it works before the
 * first workspace exists.
 * Our design choice: the answer names the service as `conducted-cloud`, so a URL that accepts any
 * token is not mistaken for a Worker. The Rust shell checks the same string (`cloud.rs`).
 * Test first: a request without the pairing token is refused with 401, and `/pair` answers with
 * the Worker's name.
 */

/** The route the desktop uses to check a Worker before it saves a pairing. */
export const PAIR_PATH = "/pair";
/** What `/pair` calls this Worker. The Rust shell refuses an answer with another name. */
export const PAIR_SERVICE = "conducted-cloud";

/** The answer `/pair` gives an authorized request. It names a fresh, working Worker. */
export function pairAnswer(): Response {
	return Response.json({ service: PAIR_SERVICE, paired: true });
}

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
