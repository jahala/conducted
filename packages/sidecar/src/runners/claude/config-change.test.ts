import { expect, test } from "bun:test";
import type { SessionConfig } from "@conducted/protocol";
import { classifyConfigChange } from "./config-change.ts";

const base: SessionConfig = {
	agent: "claude",
	model: "m1",
	effort: "medium",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: ["/a"],
	appTools: { diffComments: true, progressUpdates: false },
};

test("no change, live change and restart change", () => {
	expect(classifyConfigChange(base, base).kind).toBe("none");
	expect(classifyConfigChange(base, { ...base, model: "m2" })).toMatchObject({
		kind: "live",
		live: { model: true, effort: false, permissionMode: false },
	});
	expect(classifyConfigChange(base, { ...base, planMode: true }).live.permissionMode).toBe(true);
	expect(classifyConfigChange(base, { ...base, fastMode: true }).kind).toBe("restart");
});

test("a restart change wins over live changes and still reports them", () => {
	const change = classifyConfigChange(base, {
		...base,
		model: "m2",
		additionalDirectories: ["/a", "/b"],
	});
	expect(change.kind).toBe("restart");
	expect(change.live.model).toBe(true);
});

test("tool switches need a restart", () => {
	expect(
		classifyConfigChange(base, { ...base, appTools: { diffComments: true, progressUpdates: true } })
			.kind,
	).toBe("restart");
});
