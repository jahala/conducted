import { expect, test } from "bun:test";
import { parseLoggerConfig, parseSidecarConfig } from "./config.ts";

const good = {
	CONDUCTED_BIN_DIR: "/app/bin",
	CONDUCTED_OUTBOX_ROOT: "/data/outbox",
	CONDUCTED_LOG_DIR: "/data/logs",
};

test("a complete environment parses", () => {
	const result = parseSidecarConfig(good);
	expect(result).toEqual({
		ok: true,
		value: { binDir: "/app/bin", outboxRoot: "/data/outbox", logDir: "/data/logs" },
	});
});

test("a missing variable is named in the error", () => {
	const { CONDUCTED_BIN_DIR: _omit, ...rest } = good;
	const result = parseSidecarConfig(rest);
	expect(result.ok).toBe(false);
	if (!result.ok) expect(result.error.message).toContain("CONDUCTED_BIN_DIR");
});

test("a relative path is refused", () => {
	const result = parseSidecarConfig({ ...good, CONDUCTED_LOG_DIR: "logs" });
	expect(result.ok).toBe(false);
	if (!result.ok) expect(result.error.message).toContain("absolute");
});

test("the logger needs a token, and its folder is optional but absolute", () => {
	expect(parseLoggerConfig({}).ok).toBe(false);
	expect(parseLoggerConfig({ CONDUCTED_LOGGER_TOKEN: "t" })).toEqual({
		ok: true,
		value: { token: "t", persistDir: null },
	});
	expect(parseLoggerConfig({ CONDUCTED_LOGGER_TOKEN: "t", CONDUCTED_LOGGER_DIR: "rel" }).ok).toBe(
		false,
	);
	expect(
		parseLoggerConfig({ CONDUCTED_LOGGER_TOKEN: "t", CONDUCTED_LOGGER_DIR: "/var/logs" }),
	).toEqual({ ok: true, value: { token: "t", persistDir: "/var/logs" } });
});
