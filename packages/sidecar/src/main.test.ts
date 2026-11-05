import { describe, expect, test } from "bun:test";
import { dispatchMode, EXIT_USAGE, MODES, type Mode, type ModeRunner, parseMode } from "./main.ts";

function runners(calls: string[]): Record<Mode, ModeRunner> {
	const make =
		(name: Mode): ModeRunner =>
		async (_env, args) => {
			calls.push(`${name}:${args.join(",")}`);
			return 0;
		};
	return {
		sidecar: make("sidecar"),
		logger: make("logger"),
		"app-tools-mcp": make("app-tools-mcp"),
	};
}

describe("SIDE-01 entry point and modes", () => {
	test("SIDE-01 parseMode reads the third argv entry", () => {
		expect(parseMode(["bun", "main.ts", "logger"])).toBe("logger");
		expect(parseMode(["bun", "main.ts", "cli"])).toBeNull();
		expect(parseMode(["bun", "main.ts"])).toBeNull();
	});

	test("SIDE-01 every mode runs through the one program, with the mode as an argument", async () => {
		for (const mode of MODES) {
			const calls: string[] = [];
			const code = await dispatchMode(["bun", "main.ts", mode], {}, runners(calls), () => {});
			expect(code).toBe(0);
			expect(calls).toEqual([`${mode}:`]);
		}
	});

	test("SIDE-01 an unknown mode prints usage, exits 64 and runs nothing", async () => {
		const calls: string[] = [];
		const errors: string[] = [];
		const code = await dispatchMode(["bun", "main.ts", "nope"], {}, runners(calls), (t) =>
			errors.push(t),
		);
		expect(code).toBe(EXIT_USAGE);
		expect(calls).toEqual([]);
		expect(errors.join("")).toContain("Usage");
	});

	test("SIDE-01 a known mode gets the arguments after the mode name", async () => {
		const calls: string[] = [];
		const code = await dispatchMode(
			["bun", "main.ts", "app-tools-mcp", "--session-id", "s1"],
			{},
			runners(calls),
			() => {},
		);
		expect(code).toBe(0);
		expect(calls).toEqual(["app-tools-mcp:--session-id,s1"]);
	});

	test("SIDE-01 a mode that throws exits 1 with its message on the error channel", async () => {
		const errors: string[] = [];
		const boom: ModeRunner = async () => {
			throw new Error("kaboom");
		};
		const code = await dispatchMode(
			["bun", "main.ts", "sidecar"],
			{},
			{ sidecar: boom, logger: boom, "app-tools-mcp": boom },
			(t) => errors.push(t),
		);
		expect(code).toBe(1);
		expect(errors.join("")).toContain("kaboom");
	});
});
