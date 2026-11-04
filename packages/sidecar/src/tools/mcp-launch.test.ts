import { expect, test } from "bun:test";
import type { SessionId } from "@conducted/shared";
import { appToolsMcpEntry, BRIDGE_TOKEN_ENV, parseAppToolsMcpArgs } from "./mcp-launch.ts";

const entryInput = {
	sidecarExecutable: "/Applications/Conducted.app/bin/sidecar bin",
	sessionId: "s1" as SessionId,
	socketPath: "/tmp/x/s",
	token: "secret-token",
	appTools: { diffComments: true, progressUpdates: false },
};

test("the token goes in the environment and never in the arguments", () => {
	const entry = appToolsMcpEntry(entryInput);
	expect(entry.args.join(" ")).not.toContain("secret-token");
	expect(entry.env[BRIDGE_TOKEN_ENV]).toBe("secret-token");
	expect(entry.command).toBe("/Applications/Conducted.app/bin/sidecar bin");
	expect(entry.name).toBe("conducted");
});

test("the arguments written for the helper parse back to the same values", () => {
	const entry = appToolsMcpEntry(entryInput);
	const parsed = parseAppToolsMcpArgs(entry.args.slice(1));
	expect(parsed).toEqual({
		ok: true,
		value: {
			sessionId: "s1" as SessionId,
			socketPath: "/tmp/x/s",
			appTools: { diffComments: true, progressUpdates: false },
		},
	});
});

test("missing and unknown arguments are reported", () => {
	expect(parseAppToolsMcpArgs(["--socket", "/s"])).toEqual({
		ok: false,
		message: "Missing --session-id",
	});
	expect(parseAppToolsMcpArgs(["--wat"]).ok).toBe(false);
});
