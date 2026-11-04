import { expect, test } from "bun:test";
import { NotImplemented, notImplemented } from "./not-implemented.ts";

test("notImplemented throws a NotImplemented error carrying the feature id", () => {
	expect(() => notImplemented("CHAT-03")).toThrow(NotImplemented);
	try {
		notImplemented("CHAT-03");
	} catch (error) {
		expect((error as NotImplemented).featureId).toBe("CHAT-03");
		expect((error as Error).message).toBe("Not implemented: CHAT-03");
	}
});
