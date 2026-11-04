import { describe, expect, it } from "vitest";
import { COMMANDS, checkHealth, invokeResult, toAppError } from "./tauri.ts";

describe("toAppError", () => {
	it("keeps the code and message of a Rust command error", () => {
		expect(toAppError({ code: "io", message: "no such file" })).toEqual({
			code: "io",
			message: "no such file",
		});
	});
	it("wraps a plain string from a plugin", () => {
		expect(toAppError("dialog closed")).toEqual({ code: "tauri_error", message: "dialog closed" });
	});
	it("wraps an Error and keeps it as the cause", () => {
		const error = new Error("boom");
		expect(toAppError(error)).toEqual({ code: "tauri_error", message: "boom", cause: error });
	});
	it("does not trust an object with the wrong field types", () => {
		expect(toAppError({ code: 5, message: "x" }).code).toBe("tauri_error");
		expect(toAppError(undefined).code).toBe("tauri_error");
	});
});

describe("invokeResult", () => {
	it("returns Ok with the value", async () => {
		const result = await invokeResult({ invoke: async () => "x" as never }, "any");
		expect(result).toEqual({ ok: true, value: "x" });
	});
	it("returns Err instead of throwing", async () => {
		const result = await invokeResult(
			{
				invoke: async () => {
					throw { code: "not_implemented", message: "Not implemented: PLAT-03" };
				},
			},
			"shell_run",
		);
		expect(result).toEqual({
			ok: false,
			error: { code: "not_implemented", message: "Not implemented: PLAT-03" },
		});
	});
});

describe("checkHealth", () => {
	it("asks the health command and accepts 'ok'", async () => {
		const calls: string[] = [];
		const result = await checkHealth({
			invoke: async (command) => {
				calls.push(command);
				return "ok" as never;
			},
		});
		expect(result.ok).toBe(true);
		expect(calls).toEqual([COMMANDS.health]);
	});
	it("rejects any other answer", async () => {
		const result = await checkHealth({ invoke: async () => "nope" as never });
		expect(result).toMatchObject({ ok: false, error: { code: "health_unexpected" } });
	});
});
