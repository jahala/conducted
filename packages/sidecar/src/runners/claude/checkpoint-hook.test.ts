import { expect, test } from "bun:test";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { createCheckpointHook } from "./checkpoint-hook.ts";

const preToolUse = (tool_name: string) =>
	({
		hook_event_name: "PreToolUse",
		tool_name,
		tool_input: {},
		tool_use_id: "t",
	}) as unknown as HookInput;
const options = { signal: new AbortController().signal };

test("a writing tool waits for the gate and a read does not", async () => {
	let release!: () => void;
	const gatePromise = new Promise<void>((resolve) => {
		release = resolve;
	});
	let calls = 0;
	const hook = createCheckpointHook({
		current: () => () => {
			calls += 1;
			return gatePromise;
		},
	});
	const callback = hook.hooks[0];
	if (!callback) throw new Error("hook missing");

	expect(await callback(preToolUse("Read"), "t", options)).toEqual({});
	expect(calls).toBe(0);

	let finished = false;
	const pending = callback(preToolUse("Bash"), "t", options).then(() => {
		finished = true;
	});
	await Promise.resolve();
	expect(finished).toBe(false);
	release();
	await pending;
	expect(calls).toBe(1);
	expect(finished).toBe(true);
});

test("a rejecting gate does not block the tool", async () => {
	const hook = createCheckpointHook({ current: () => () => Promise.reject(new Error("x")) });
	const callback = hook.hooks[0];
	if (!callback) throw new Error("hook missing");
	expect(await callback(preToolUse("Edit"), "t", options)).toEqual({});
});
