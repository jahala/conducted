import { describe, expect, it } from "vitest";
import { formatResetTime } from "./reset-time.ts";

describe("CHAT-06 a limit's reset time", () => {
	it("a reset time reads as a short date, a comma and the time", () => {
		const at = new Date(2026, 0, 1, 15, 5).getTime();
		const date = new Date(at).toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
		expect(formatResetTime(at)).toMatch(new RegExp(`^${date}, 3:05\\s?PM$`));
	});
});
