/**
 * @feature CHAT-06 Working line
 * Tests Conductor's timer format, the waiting words, and the line with a fixed clock.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatTurnDuration, formatTurnTime } from "./TurnFooter.tsx";
import { formatElapsed, WorkingLine, waitingWords } from "./WorkingLine.tsx";

afterEach(cleanup);

describe("CHAT-06 working line", () => {
	it("writes elapsed time with tenths, and minutes after a minute", () => {
		expect(formatElapsed(27_400)).toBe("27.4s");
		expect(formatElapsed(106_200)).toBe("1m, 46.2s");
		expect(formatElapsed(-5)).toBe("0.0s");
	});

	it("says what a waiting turn waits for", () => {
		const shell = { id: "a", kind: "shell" as const, description: "" };
		const agent = { id: "b", kind: "sub_agent" as const, description: "Explore" };
		expect(waitingWords([shell, { ...shell, id: "c" }])).toBe("Waiting for 2 background tasks");
		expect(waitingWords([agent, { ...agent, id: "d" }])).toBe("Waiting for 2 agents");
		expect(waitingWords([agent])).toBe("Waiting for subagent Explore");
		expect(waitingWords([shell])).toBe("Waiting for background task");
		expect(waitingWords([])).toBe("Waiting for background task");
	});

	it("shows the time since the turn's message was sent", () => {
		render(<WorkingLine since={1_000} read={() => 28_400} />);
		expect(screen.getByText("27.4s")).toBeTruthy();
		expect(screen.getByRole("status", { name: "The agent is working" })).toBeTruthy();
	});

	it("names the wait and times it from when it began", () => {
		render(
			<WorkingLine
				since={0}
				waiting={{ since: 10_000, tasks: [{ id: "a", kind: "shell", description: "" }] }}
				read={() => 12_500}
			/>,
		);
		expect(screen.getByText("Waiting for background task")).toBeTruthy();
		expect(screen.getByText("2.5s")).toBeTruthy();
	});
});

describe("CHAT-06 turn footer words", () => {
	it("writes a turn's duration without tenths", () => {
		expect(formatTurnDuration(3_900)).toBe("3s");
		expect(formatTurnDuration(124_000)).toBe("2m, 4s");
	});

	it("writes the end time alone today, with the weekday this week, else with the date", () => {
		const now = new Date(2026, 10, 6, 18, 0).getTime();
		const today = formatTurnTime(new Date(2026, 10, 6, 17, 20).getTime(), now);
		expect(today).toMatch(/^\d{1,2}:20/);
		const thisWeek = formatTurnTime(new Date(2026, 10, 4, 17, 20).getTime(), now);
		expect(thisWeek.endsWith(today)).toBe(true);
		expect(thisWeek.length).toBeGreaterThan(today.length);
		const older = formatTurnTime(new Date(2026, 9, 12, 17, 20).getTime(), now);
		expect(older).toContain(", ");
		const lastYear = formatTurnTime(new Date(2025, 9, 12, 17, 20).getTime(), now);
		expect(lastYear).toContain("2025");
	});
});
