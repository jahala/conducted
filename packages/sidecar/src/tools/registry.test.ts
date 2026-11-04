import { expect, test } from "bun:test";
import { APP_TOOLS } from "@conducted/protocol";
import { APP_TOOL_DEFINITIONS, enabledTools } from "./registry.ts";

test("every protocol tool name has a definition under its own name", () => {
	for (const name of APP_TOOLS) expect(APP_TOOL_DEFINITIONS[name].name).toBe(name);
});

test("switches remove tools, and the bridge list leaves out AskUserQuestion", () => {
	const off = enabledTools(
		{ diffComments: false, progressUpdates: false },
		{ includeAskUserQuestion: true },
	);
	expect(off.map((tool) => tool.name)).not.toContain("UpdateProgress");
	expect(off.map((tool) => tool.name)).not.toContain("GetDiffComments");
	const all = enabledTools(
		{ diffComments: true, progressUpdates: true },
		{ includeAskUserQuestion: true },
	);
	expect(all.map((tool) => tool.name)).toEqual([...APP_TOOLS]);
	const bridged = enabledTools(
		{ diffComments: true, progressUpdates: true },
		{ includeAskUserQuestion: false },
	);
	expect(bridged.map((tool) => tool.name)).not.toContain("AskUserQuestion");
});
