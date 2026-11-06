/**
 * @feature CHAT-28 Account and rate-limit rows in the usage popover
 * Owns: tests of the account and plan-usage rows: which fields show, the middle-cut email with its
 * full value, the limit bars, reset text, window names and the Codex waiting note.
 * Behaviour: docs/research/conductor/claude-runner.md 7 and coverage/inventory-controls.md
 * ("Account details in the plan usage popover").
 * Test first: login method "Claude subscription" and plan "Max" show two rows and no Organization
 * or Email row.
 */
import type { RateLimit } from "@conducted/protocol";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UsageAccountRows, type UsageAccount } from "./UsageAccountRows.tsx";

const NOW = 1_800_000_000_000;

afterEach(cleanup);

function account(over: Partial<UsageAccount> = {}): UsageAccount {
	return { loginMethod: "Claude subscription", plan: "Max", ...over };
}

function limit(over: Partial<RateLimit> = {}): RateLimit {
	return { label: "5-hour limit", usedPercent: 42, windowMinutes: 300, ...over };
}

function renderRows(
	over: {
		account?: UsageAccount | null;
		rateLimits?: RateLimit[];
		limitsPending?: boolean;
		now?: number;
	} = {},
) {
	return render(
		<UsageAccountRows
			account={over.account === undefined ? account() : over.account}
			rateLimits={over.rateLimits ?? []}
			limitsPending={over.limitsPending ?? false}
			now={over.now ?? NOW}
		/>,
	);
}

describe("CHAT-28 account rows", () => {
	it("shows login method and plan only when the account has just those two", () => {
		renderRows({ account: account({ loginMethod: "Claude subscription", plan: "Max" }) });

		expect(screen.getByText("Login method")).toBeTruthy();
		expect(screen.getByText("Claude subscription")).toBeTruthy();
		expect(screen.getByText("Plan")).toBeTruthy();
		expect(screen.getByText("Max")).toBeTruthy();
		expect(screen.queryByText("Organization")).toBeNull();
		expect(screen.queryByText("Email")).toBeNull();
	});

	it("shows organization and email when the account carries them", () => {
		renderRows({
			account: account({
				organization: "Anthropic",
				email: "person@example.com",
			}),
		});

		expect(screen.getByText("Organization")).toBeTruthy();
		expect(screen.getByText("Anthropic")).toBeTruthy();
		expect(screen.getByText("Email")).toBeTruthy();
		expect(screen.getByText("person@example.com")).toBeTruthy();
	});

	it("leaves a fieldless account with no rows at all", () => {
		const { container } = renderRows({ account: {} });
		expect(container.textContent).toBe("");
	});

	it("cuts a long email in the middle and keeps the full text in the tooltip", () => {
		const email = "a.very.long.email.address.for.testing@example.com";
		renderRows({ account: account({ email }) });

		expect(screen.getByText("Email")).toBeTruthy();
		const full = screen.getByTitle(email);
		expect(full.textContent).toContain("…");
		expect(full.textContent).not.toBe(email);
	});
});

describe("CHAT-28 plan usage rows", () => {
	it("renders nothing when there is no account and no limit", () => {
		const { container } = renderRows({ account: null });
		expect(container.textContent).toBe("");
	});

	it("shows a plan usage heading with the reported percentage and window name", () => {
		renderRows({ account: null, rateLimits: [limit({ usedPercent: 42 })] });

		expect(screen.getByText("Plan usage")).toBeTruthy();
		expect(screen.getByText("5-hour limit")).toBeTruthy();
		expect(screen.getByText("42%")).toBeTruthy();
		expect(screen.getByText("5 hours")).toBeTruthy();
	});

	it("names the seven-day window Weekly and any other window from its minutes", () => {
		renderRows({
			account: null,
			rateLimits: [
				limit({ label: "Weekly limit", usedPercent: 10, windowMinutes: 10_080 }),
				limit({ label: "Short limit", usedPercent: 20, windowMinutes: 90 }),
			],
		});

		expect(screen.getByText("Weekly")).toBeTruthy();
		expect(screen.getByText("90 minutes")).toBeTruthy();
	});

	it("clamps the bar at 100 percent but shows the percentage as reported", () => {
		renderRows({ account: null, rateLimits: [limit({ usedPercent: 140 })] });

		expect(screen.getByText("140%")).toBeTruthy();
		const bar = screen.getByRole("progressbar", { name: "5-hour limit" });
		expect(bar.getAttribute("aria-valuenow")).toBe("100");
		const fill = bar.firstElementChild as HTMLElement | null;
		expect(fill?.style.width).toBe("100%");
	});

	it("says Resetting when the reset time has passed", () => {
		renderRows({
			account: null,
			rateLimits: [limit({ resetsAt: NOW - 60_000 })],
			now: NOW,
		});

		expect(screen.getByText("Resetting")).toBeTruthy();
	});

	it("counts down to a future reset time", () => {
		renderRows({
			account: null,
			rateLimits: [limit({ resetsAt: NOW + 2 * 60 * 60 * 1000 + 30 * 60 * 1000 })],
			now: NOW,
		});

		expect(screen.getByText("Resets in 2h 30m")).toBeTruthy();
	});

	it("says usage data is not available yet for Codex instead of zero percent", () => {
		renderRows({ account: null, rateLimits: [], limitsPending: true });

		expect(screen.getByText("Usage data is not available yet.")).toBeTruthy();
		expect(screen.queryByRole("progressbar")).toBeNull();
		expect(screen.queryByText("0%")).toBeNull();
	});
});
