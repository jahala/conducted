import { expect, test } from "bun:test";
import { createMirrorStore } from "./session-mirror.ts";

test("append reports the uuids of consumed user messages and load returns nothing", async () => {
	const seen: string[] = [];
	const store = createMirrorStore((uuid) => seen.push(uuid));
	const key = { projectKey: "p", sessionId: "s" };
	await store.append(key, [
		{ type: "user", uuid: "u1" },
		{ type: "assistant", uuid: "a1" },
	]);
	expect(seen).toEqual(["u1"]);
	expect(await store.load(key)).toBeNull();
});
