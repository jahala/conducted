import { expect, test } from "bun:test";
import { processKey } from "./process-manager.ts";

test("the key includes the ACP adapter when there is one", () => {
	expect(processKey("claude", undefined, "s1")).toBe("claude:s1");
	expect(processKey("acp", "opencode", "s1")).toBe("acp:opencode:s1");
});
