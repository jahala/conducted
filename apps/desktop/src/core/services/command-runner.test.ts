import { describe, expect, it } from "vitest";
import { CommandRunner } from "./command-runner.ts";

describe("CommandRunner.run", () => {
	const context = () => ({ hasWorkspace: true, hasOpenPr: true, hasOpenChat: true });

	it("returns an error value for an id the registry does not know", async () => {
		const runner = new CommandRunner({ handlers: () => ({}), context });
		const result = await runner.run("nope.nothing");
		expect(result).toMatchObject({ ok: false, error: { code: "command_unknown" } });
	});

	it("returns command_unavailable for a known id with no handler", async () => {
		const runner = new CommandRunner({ handlers: () => ({}), context });
		const result = await runner.run("workspace.create");
		expect(result).toMatchObject({ ok: false, error: { code: "command_unavailable" } });
	});
});
