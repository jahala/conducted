import { describe, expect, it } from "vitest";
import { turnErrorView } from "./turn-error-view.ts";

// Each case is a branch of Conductor's IQi @9538488, in its order.
describe("CHAT-06 the view of a failed turn's error (Conductor's IQi)", () => {
	it("reads a user's abort as Interrupted by user", () => {
		expect(turnErrorView("Request was aborted by user", "claude")).toEqual({ kind: "interrupted" });
		expect(turnErrorView("Interrupted by user", "codex")).toEqual({ kind: "interrupted" });
	});

	it("rewords a cancelled session before it reads it", () => {
		expect(turnErrorView("Session cancelled: gone", "claude")).toEqual({
			kind: "error",
			text: "Session interrupted: gone",
		});
	});

	it("offers sign-in for a Claude chat's sign-in error, and not for another agent's", () => {
		expect(turnErrorView("Please run /login", "claude")).toEqual({
			kind: "sign_in",
			text: "Please run /login",
		});
		expect(turnErrorView("Please run /login", "codex")).toEqual({
			kind: "error",
			text: "Please run /login",
		});
	});

	it("names a prompt that is too long as the context window", () => {
		expect(turnErrorView("Prompt is too long: 210000 tokens", "claude")).toEqual({
			kind: "context_window",
		});
	});

	it("reads the session limit and its reset time", () => {
		expect(turnErrorView("Claude AI usage limit reached|1767225600", "claude")).toEqual({
			kind: "session_limit",
			resetsAt: 1_767_225_600_000,
		});
		expect(turnErrorView("Claude AI usage limit reached|soon", "claude")).toEqual({
			kind: "session_limit",
			resetsAt: null,
		});
	});

	it("reads an overloaded server", () => {
		expect(turnErrorView("API Error: 529 Overloaded", "claude")).toEqual({ kind: "overloaded" });
	});

	it("reads an image over Claude Code's size limit", () => {
		expect(turnErrorView("image exceeds 5 MB maximum", "claude")).toEqual({
			kind: "image_too_large",
		});
	});

	it("shows any other error, and Unknown error when there are no words", () => {
		expect(turnErrorView("Claude Code process exited with code 1", "claude")).toEqual({
			kind: "error",
			text: "Claude Code process exited with code 1",
		});
		expect(turnErrorView(null, "claude")).toEqual({ kind: "error", text: "Unknown error" });
	});

	it("takes the earlier branch when two match, as IQi does", () => {
		expect(turnErrorView("Overloaded; Interrupted by user", "claude")).toEqual({
			kind: "interrupted",
		});
		expect(turnErrorView("Prompt is too long and the server is overloaded", "claude")).toEqual({
			kind: "context_window",
		});
	});
});
