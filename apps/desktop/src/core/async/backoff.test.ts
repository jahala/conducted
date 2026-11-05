import { describe, expect, it } from "vitest";
import {
	type BackoffPolicy,
	type BackoffState,
	createBackoff,
	INITIAL_BACKOFF,
	nextBackoff,
} from "./backoff.ts";

const policy = (over: Partial<BackoffPolicy> = {}): BackoffPolicy => ({
	baseMs: 1000,
	factor: 2,
	capMs: 8000,
	jitter: 0,
	resetAfterMs: 60_000,
	...over,
});

const clockAt = (start = 0) => {
	let now = start;
	return {
		clock: { now: () => now },
		advance: (ms: number) => {
			now += ms;
		},
	};
};

describe("APP-11 backoff", () => {
	it("spaces five failures 1, 2, 4, 8 and 8 seconds apart", () => {
		const { clock } = clockAt();
		let state = INITIAL_BACKOFF;
		const delays: number[] = [];
		for (let failure = 0; failure < 5; failure += 1) {
			const next = nextBackoff(state, policy(), clock, () => 0);
			state = next.state;
			delays.push(next.delayMs);
		}
		expect(delays).toEqual([1000, 2000, 4000, 8000, 8000]);
		expect(state.attempt).toBe(5);
	});

	it("keeps counting attempts after the delay reaches the cap", () => {
		const { clock } = clockAt();
		let state: BackoffState = { attempt: 5, lastFailureAt: 0 };
		const next = nextBackoff(state, policy(), clock, () => 0);
		state = next.state;
		expect(next.delayMs).toBe(8000);
		expect(state.attempt).toBe(6);
	});

	it("starts over after a quiet period", () => {
		const { clock, advance } = clockAt();
		let state = nextBackoff(INITIAL_BACKOFF, policy(), clock, () => 0).state;
		state = nextBackoff(state, policy(), clock, () => 0).state;
		expect(state.attempt).toBe(2);
		advance(60_000);
		const next = nextBackoff(state, policy(), clock, () => 0);
		expect(next.delayMs).toBe(1000);
		expect(next.state.attempt).toBe(1);
	});

	it("treats a quiet time shorter than the reset window as a continuing failure", () => {
		const { clock, advance } = clockAt();
		const state = nextBackoff(INITIAL_BACKOFF, policy(), clock, () => 0).state;
		advance(59_999);
		const next = nextBackoff(state, policy(), clock, () => 0);
		expect(next.delayMs).toBe(2000);
		expect(next.state.attempt).toBe(2);
	});

	it("adds jitter between zero and the fraction", () => {
		const { clock } = clockAt();
		expect(nextBackoff(INITIAL_BACKOFF, policy({ jitter: 0.5 }), clock, () => 0).delayMs).toBe(
			1000,
		);
		expect(nextBackoff(INITIAL_BACKOFF, policy({ jitter: 0.5 }), clock, () => 1).delayMs).toBe(
			1500,
		);
	});

	it("clamps a random sample and never goes past the cap", () => {
		const { clock } = clockAt();
		expect(nextBackoff(INITIAL_BACKOFF, policy({ jitter: 0.5 }), clock, () => -1).delayMs).toBe(
			1000,
		);
		expect(nextBackoff(INITIAL_BACKOFF, policy({ jitter: 0.5 }), clock, () => 2).delayMs).toBe(
			1500,
		);
		const capped = nextBackoff(
			{ attempt: 4, lastFailureAt: null },
			policy({ jitter: 1 }),
			clock,
			() => 1,
		);
		expect(capped.delayMs).toBe(8000);
	});

	it("refuses a base of zero or a cap below the base", () => {
		const { clock } = clockAt();
		expect(() => nextBackoff(INITIAL_BACKOFF, policy({ baseMs: 0 }), clock, () => 0)).toThrow(
			RangeError,
		);
		expect(() => nextBackoff(INITIAL_BACKOFF, policy({ capMs: 500 }), clock, () => 0)).toThrow(
			RangeError,
		);
		expect(() => createBackoff(policy({ baseMs: -1 }), clock, () => 0)).toThrow(RangeError);
	});

	it("starts over after a success", () => {
		const { clock } = clockAt();
		const counter = createBackoff(policy(), clock, () => 0);
		expect(counter.fail()).toBe(1000);
		expect(counter.fail()).toBe(2000);
		counter.succeed();
		expect(counter.state().attempt).toBe(0);
		expect(counter.fail()).toBe(1000);
		expect(counter.state().attempt).toBe(1);
	});
});
