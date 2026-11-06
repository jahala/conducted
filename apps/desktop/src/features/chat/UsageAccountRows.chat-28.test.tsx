/**
 * @feature CHAT-28 Account and rate-limit rows in the usage popover
 * Owns: tests of the usage section of the context card: the heading, each limit window with what
 * is left and when it resets, the warning, the loading and empty notes, and the account rows.
 * Behaviour: Conductor's popover (renderApp `TGi`, `SXo`, `yXo`, `xXo` for the windows; `BXo` and
 * `EGi` for the rows); coverage/inventory-controls.md ("Account details in the plan usage
 * popover").
 * Test first: a Claude account with plan "Max" and login method "Claude account" shows those rows
 * and no Organization row.
 */
import type { RateLimit } from "@conducted/protocol";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type UsageAccount, UsageAccountRows, type UsageAnswer } from "./UsageAccountRows.tsx";

const NOW = 1_800_000_000_000;

afterEach(cleanup);

function limit(over: Partial<RateLimit> = {}): RateLimit {
	return { label: "5-hour limit", usedPercent: 42, windowMinutes: 300, ...over };
}

function renderRows(
	over: {
		agent?: "claude" | "codex";
		account?: UsageAccount;
		rateLimits?: RateLimit[];
		answer?: UsageAnswer | null;
		loading?: boolean;
	} = {},
) {
	const answer: UsageAnswer | null =
		over.answer !== undefined
			? over.answer
			: { rateLimits: over.rateLimits ?? [], ...(over.account ? { account: over.account } : {}) };
	return render(
		<UsageAccountRows
			agent={over.agent ?? "claude"}
			answer={answer}
			loading={over.loading ?? false}
			now={NOW}
		/>,
	);
}

/** The label and value of each account row, in order. */
function rows(): [string, string][] {
	const list = screen.queryByRole("list", { name: "Account" });
	if (list === null) return [];
	return within(list)
		.getAllByRole("listitem")
		.map((item) => {
			const [label, value] = Array.from(item.children).map((child) => child.textContent ?? "");
			return [label ?? "", value ?? ""];
		});
}

describe("CHAT-28 usage section of the context card", () => {
	it("shows a Claude account's provider, plan, login method and email, and no organization", () => {
		renderRows({
			account: {
				provider: "Anthropic API",
				plan: "Max",
				loginMethod: "Claude account",
				organization: "Anthropic",
				email: "person@example.com",
			},
		});

		expect(screen.getByText("Claude usage")).toBeTruthy();
		expect(rows()).toEqual([
			["Provider", "Anthropic API"],
			["Plan", "Max"],
			["Login method", "Claude account"],
			["Email", "person@example.com"],
		]);
		expect(screen.queryByText("Organization")).toBeNull();
	});

	it("shows only the rows the account has", () => {
		renderRows({ account: { plan: "Max", loginMethod: "Claude account" } });

		expect(rows()).toEqual([
			["Plan", "Max"],
			["Login method", "Claude account"],
		]);
	});

	it("labels a key sign-in Auth", () => {
		renderRows({ account: { auth: "API key" } });

		expect(rows()).toEqual([["Auth", "API key"]]);
	});

	it("labels a Codex email Account and heads the section Codex usage", () => {
		renderRows({
			agent: "codex",
			account: { provider: "OpenAI", plan: "Plus", auth: "ChatGPT login", email: "me@x.com" },
		});

		expect(screen.getByText("Codex usage")).toBeTruthy();
		expect(rows()).toEqual([
			["Provider", "OpenAI"],
			["Plan", "Plus"],
			["Auth", "ChatGPT login"],
			["Account", "me@x.com"],
		]);
	});

	it("keeps a long email whole in its title while the row cuts it", () => {
		const email = "a.very.long.address.for.someone@an-example-company.example.com";
		renderRows({ account: { email } });

		const value = screen.getByText(email);
		expect(value.getAttribute("title")).toBe(email);
		expect(value.className).toContain("truncate");
	});

	it("names each window from its length and shows what is left", () => {
		renderRows({
			rateLimits: [
				limit({ usedPercent: 42, windowMinutes: 300 }),
				limit({ label: "7-day limit", usedPercent: 10, windowMinutes: 10_080 }),
				limit({ label: "Short", usedPercent: 0, windowMinutes: 90 }),
			],
		});

		expect(screen.getByText("5h limit")).toBeTruthy();
		expect(screen.getByText("58% left")).toBeTruthy();
		expect(screen.getByText("7d limit")).toBeTruthy();
		expect(screen.getByText("90% left")).toBeTruthy();
		expect(screen.getByText("90m limit")).toBeTruthy();
		expect(
			screen.getByRole("progressbar", { name: "5h limit" }).getAttribute("aria-valuenow"),
		).toBe("58");
	});

	it("uses the window's own label when its length is not known", () => {
		renderRows({ rateLimits: [limit({ label: "Primary limit", windowMinutes: undefined })] });

		expect(screen.getByText("Primary limit")).toBeTruthy();
	});

	it("never shows less than nothing left", () => {
		renderRows({ rateLimits: [limit({ usedPercent: 140 })] });

		expect(screen.getByText("0% left")).toBeTruthy();
		expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
	});

	it("warns at 20 percent left or less", () => {
		renderRows({ rateLimits: [limit({ usedPercent: 81 })] });
		expect(screen.getByText("You're approaching your Claude usage limit.")).toBeTruthy();
		cleanup();

		renderRows({ rateLimits: [limit({ usedPercent: 79 })] });
		expect(screen.queryByText("You're approaching your Claude usage limit.")).toBeNull();
	});

	it("drops a window whose reset time has passed and says when the others reset", () => {
		renderRows({
			rateLimits: [
				limit({ usedPercent: 99, resetsAt: NOW - 60_000 }),
				limit({ label: "7-day limit", windowMinutes: 10_080, resetsAt: NOW + 3_600_000 }),
				limit({ label: "Short", windowMinutes: 90 }),
			],
		});

		expect(screen.queryByText("5h limit")).toBeNull();
		expect(screen.getByText(/^Resets \w{3} \d{1,2}, \d{4}, /)).toBeTruthy();
		expect(screen.getByText("Resets reset time unavailable")).toBeTruthy();
	});

	it("says Loading usage while the answer is on its way", () => {
		renderRows({ answer: null, loading: true });

		expect(screen.getByText("Loading usage…")).toBeTruthy();
	});

	it("says the provider gave no usage data when there is no window", () => {
		renderRows({ answer: null });
		expect(
			screen.getByText("Usage data unavailable from provider. It refreshes after Claude responds."),
		).toBeTruthy();
		cleanup();

		renderRows({ agent: "codex", rateLimits: [] });
		expect(
			screen.getByText("Usage data unavailable from provider. It refreshes after Codex responds."),
		).toBeTruthy();
		expect(screen.queryByRole("list", { name: "Account" })).toBeNull();
	});
});
