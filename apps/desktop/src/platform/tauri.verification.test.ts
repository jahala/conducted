import { describe, expect, it } from "vitest";
import { COMMANDS, createTauriPrograms, type TauriBindings } from "./tauri.ts";

function bindings(
	invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
): TauriBindings {
	return {
		invoke: invoke as TauriBindings["invoke"],
		listen: async () => () => {},
	};
}

describe("PLAT-34 programs.verificationErrors", () => {
	it("asks the verification command and returns the failed programs", async () => {
		const calls: { command: string; args: Record<string, unknown> | undefined }[] = [];
		const programs = createTauriPrograms(
			bindings(async (command, args) => {
				calls.push({ command, args });
				return [{ program: "gh", message: "The bundled gh program could not be verified." }];
			}),
		);

		const errors = await programs.verificationErrors();

		expect(errors).toEqual([
			{ program: "gh", message: "The bundled gh program could not be verified." },
		]);
		expect(calls).toEqual([{ command: COMMANDS.programsVerificationErrors, args: undefined }]);
	});

	it("throws the Rust error instead of inventing an empty list", async () => {
		const programs = createTauriPrograms(
			bindings(async () => {
				throw { code: "binary_copy_failed", message: "Could not copy the bundled programs." };
			}),
		);

		await expect(programs.verificationErrors()).rejects.toEqual({
			code: "binary_copy_failed",
			message: "Could not copy the bundled programs.",
		});
	});
});
