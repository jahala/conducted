import { describe, expect, it } from "vitest";
import { statusText } from "./status-text.ts";

describe("statusText", () => {
	it("asks for attention when the agent needs permission", () => {
		expect(statusText({ kind: "agent", label: "needs_permission" })).toEqual({
			text: "Need permission",
			tone: "attention",
		});
	});

	it("marks failing checks as danger", () => {
		expect(statusText({ kind: "git", label: "checks_failing" }).tone).toBe("danger");
	});

	it("shows nothing while the status is unknown", () => {
		expect(statusText(null)).toEqual({ text: "", tone: "neutral" });
	});
});
