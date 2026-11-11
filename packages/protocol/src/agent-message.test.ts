import { describe, expect, test } from "bun:test";
import { isClaudeSignInErrorText } from "./agent-message.ts";

describe("Claude sign-in error text (Conductor's JVt @9517358)", () => {
	test("reads each of the three signs Conductor reads", () => {
		expect(isClaudeSignInErrorText("Invalid API key · Please run /login")).toBe(true);
		expect(isClaudeSignInErrorText('{"type":"authentication_error"}')).toBe(true);
		expect(isClaudeSignInErrorText("API Error: 401 Invalid authentication credentials")).toBe(true);
	});

	test("does not read other errors, a 401 alone, or no text as a sign-in error", () => {
		expect(isClaudeSignInErrorText("API Error: 500 Internal server error")).toBe(false);
		expect(isClaudeSignInErrorText("API Error: 401 Unauthorized")).toBe(false);
		expect(isClaudeSignInErrorText("")).toBe(false);
		expect(isClaudeSignInErrorText(undefined)).toBe(false);
	});
});
