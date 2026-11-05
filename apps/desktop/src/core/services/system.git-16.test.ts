import { appError, err, ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer } from "../../test/container.ts";
import { XCODE_LICENSE_ACCEPT_COMMAND } from "../git/xcode-license.ts";

describe("GIT-16 SystemService runXcodeLicenseFix", () => {
	it("runs the licence command in a terminal for the user", async () => {
		const test = createTestContainer();
		try {
			test.memory.controls.scriptShell((command) =>
				command.program === "osascript" ? ok({ exitCode: 0, stdout: "", stderr: "" }) : null,
			);

			const result = await test.container.services.system.runXcodeLicenseFix();

			expect(result.ok).toBe(true);
			const call = test.memory.controls.shellCalls.at(-1);
			expect(call?.program).toBe("osascript");
			expect(call?.args).toContain(`do script "${XCODE_LICENSE_ACCEPT_COMMAND}"`);
		} finally {
			test.close();
		}
	});

	it("reports a terminal that cannot be opened", async () => {
		const test = createTestContainer();
		try {
			test.memory.controls.scriptShell((command) =>
				command.program === "osascript"
					? ok({ exitCode: 1, stdout: "", stderr: "Not authorized" })
					: null,
			);

			const result = await test.container.services.system.runXcodeLicenseFix();

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("xcode_license_fix_failed");
				expect(result.error.message).toBe("Couldn't open Terminal to accept the Xcode license.");
			}
		} finally {
			test.close();
		}
	});

	it("reports a shell that cannot start osascript", async () => {
		const test = createTestContainer();
		try {
			test.memory.controls.scriptShell((command) =>
				command.program === "osascript"
					? err(appError("process_spawn", "osascript is not installed"))
					: null,
			);

			const result = await test.container.services.system.runXcodeLicenseFix();

			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.code).toBe("xcode_license_fix_failed");
		} finally {
			test.close();
		}
	});
});
