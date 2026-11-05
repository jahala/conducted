/**
 * @feature CHAT-11 Interaction cards
 * Owns: the one timer that marks a Codex permission grant or MCP form as timed out.
 * Behaviour: packages/protocol/src/interactions.ts (CODEX_INTERACTION_TIMEOUT_MS, expiresAt).
 * Our design choice: the clock is a parameter so a test can drive it. The timer rechecks the clock
 * when it fires, so a wait longer than the largest browser timeout still ends at the right moment.
 * Must handle: no expiry (never times out), an expiry already in the past (timed out at once), and
 * a timer released when the card unmounts or the expiry changes.
 * Test first: a card open with a future expiresAt shows the timed-out state after the clock and
 * the timer pass that moment.
 */
import { CODEX_INTERACTION_TIMEOUT_MS } from "@conducted/protocol";
import { type Clock, systemClock } from "@conducted/shared";
import { useEffect, useState } from "react";

const MAX_TIMER_MS = 2_147_483_647;

export const TIMED_OUT_TEXT = `This request timed out after ${Math.round(
	CODEX_INTERACTION_TIMEOUT_MS / 60_000,
)} minutes. The agent stopped waiting.`;

/** True once `expiresAt` has passed. A missing expiry never passes. */
export function useExpiry(expiresAt: number | null = null, clock: Clock = systemClock): boolean {
	const [expired, setExpired] = useState(() => expiresAt !== null && clock.now() >= expiresAt);

	useEffect(() => {
		if (expiresAt === null) {
			setExpired(false);
			return;
		}
		let timer: ReturnType<typeof setTimeout> | null = null;
		const check = (): void => {
			const remaining = expiresAt - clock.now();
			if (remaining <= 0) {
				setExpired(true);
				return;
			}
			setExpired(false);
			timer = setTimeout(check, Math.min(remaining, MAX_TIMER_MS));
		};
		check();
		return () => {
			if (timer !== null) clearTimeout(timer);
		};
	}, [expiresAt, clock]);

	return expired;
}
