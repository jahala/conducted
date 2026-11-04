import { describe, expect, it } from "vitest";
import { type KeyPress, resolveSendKey } from "./send-key.ts";

const press = (over: Partial<KeyPress>): KeyPress => ({
	key: "Enter",
	shiftKey: false,
	metaKey: false,
	altKey: false,
	ctrlKey: false,
	isComposing: false,
	...over,
});

describe("resolveSendKey in Enter mode", () => {
	it("sends on Enter", () => {
		expect(resolveSendKey(press({}), "enter")).toBe("submit");
	});
	it("inserts a new line on Shift+Enter", () => {
		expect(resolveSendKey(press({ shiftKey: true }), "enter")).toBe("newline");
	});
	it("sends the opposite way on Cmd+Enter", () => {
		expect(resolveSendKey(press({ metaKey: true }), "enter")).toBe("submit_opposite");
	});
});

describe("resolveSendKey in Cmd+Enter mode", () => {
	it("sends on Cmd+Enter", () => {
		expect(resolveSendKey(press({ metaKey: true }), "mod_enter")).toBe("submit");
	});
	it("inserts a new line on Enter and on Shift+Enter", () => {
		expect(resolveSendKey(press({}), "mod_enter")).toBe("newline");
		expect(resolveSendKey(press({ shiftKey: true }), "mod_enter")).toBe("newline");
	});
	it("sends the opposite way on Alt+Enter", () => {
		expect(resolveSendKey(press({ altKey: true }), "mod_enter")).toBe("submit_opposite");
	});
});

describe("resolveSendKey ignores", () => {
	it("keys other than Enter", () => {
		expect(resolveSendKey(press({ key: "a" }), "enter")).toBeNull();
	});
	it("an Enter that confirms text composition", () => {
		expect(resolveSendKey(press({ isComposing: true }), "enter")).toBeNull();
	});
	it("Ctrl+Enter", () => {
		expect(resolveSendKey(press({ ctrlKey: true }), "enter")).toBeNull();
	});
});
