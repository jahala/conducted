import { describe, expect, test } from "bun:test";
import { parseSidecarConfig } from "./config.ts";

const good = {
	CONDUCTED_BIN_DIR: "/app/bin",
	CONDUCTED_OUTBOX_ROOT: "/data/outbox",
	CONDUCTED_LOG_DIR: "/data/logs",
	CONDUCTED_APP_VERSION: "1.2.3",
	CONDUCTED_LOG_LEVEL: "info",
};

describe("SIDE-01 sidecar settings", () => {
	test("SIDE-01 a complete environment parses", () => {
		const result = parseSidecarConfig(good);
		expect(result).toEqual({
			ok: true,
			value: {
				binDir: "/app/bin",
				outboxRoot: "/data/outbox",
				logDir: "/data/logs",
				appVersion: "1.2.3",
				logLevel: "info",
			},
		});
	});

	test("SIDE-01 a missing variable is named in the error", () => {
		const { CONDUCTED_BIN_DIR: _omit, ...rest } = good;
		const result = parseSidecarConfig(rest);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toContain("CONDUCTED_BIN_DIR");
	});

	test("SIDE-01 an empty environment is refused instead of using a ~/.conductor default", () => {
		const result = parseSidecarConfig({ HOME: "/Users/someone" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain("CONDUCTED_BIN_DIR");
			expect(result.error.message).toContain("CONDUCTED_OUTBOX_ROOT");
			expect(result.error.message).toContain("CONDUCTED_LOG_DIR");
		}
	});

	test("SIDE-01 a relative path is refused", () => {
		const result = parseSidecarConfig({ ...good, CONDUCTED_LOG_DIR: "logs" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toContain("absolute");
	});

	test("SIDE-01 unknown variables are ignored", () => {
		const result = parseSidecarConfig({ ...good, CONDUCTED_SOMETHING_ELSE: "x" });
		expect(result.ok).toBe(true);
	});
});

describe("SIDE-18 sidecar log settings", () => {
	test("SIDE-18 the log level and app version are read from the launcher's environment", () => {
		const result = parseSidecarConfig({
			...good,
			CONDUCTED_LOG_LEVEL: "debug",
			CONDUCTED_APP_VERSION: "0.4.0",
		});
		expect(result).toEqual({
			ok: true,
			value: {
				binDir: "/app/bin",
				outboxRoot: "/data/outbox",
				logDir: "/data/logs",
				appVersion: "0.4.0",
				logLevel: "debug",
			},
		});
	});

	test("SIDE-18 an unknown log level is refused by the variable's name", () => {
		const result = parseSidecarConfig({ ...good, CONDUCTED_LOG_LEVEL: "loud" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toContain("CONDUCTED_LOG_LEVEL");
	});

	test("SIDE-18 a missing app version is refused by the variable's name", () => {
		const { CONDUCTED_APP_VERSION: _omit, ...rest } = good;
		const result = parseSidecarConfig(rest);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toContain("CONDUCTED_APP_VERSION");
	});
});
