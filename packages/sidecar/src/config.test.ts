import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseSidecarConfig, SIDECAR_ENV } from "./config.ts";

/** The sidecar source files, other than tests. */
function sourceFiles(folder: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(folder, { withFileTypes: true })) {
		const full = path.join(folder, entry.name);
		if (entry.isDirectory()) out.push(...sourceFiles(full));
		else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
	}
	return out;
}

/** The launcher variable names a source text spells as a string of its own. */
function spelledNames(text: string): string[] {
	return Object.values(SIDECAR_ENV).filter((name) => text.includes(`"${name}"`));
}

const good = {
	CONDUCTED_BIN_DIR: "/app/bin",
	CONDUCTED_OUTBOX_ROOT: "/data/outbox",
	CONDUCTED_COMPLETIONS_DIR: "/data/completions",
	CONDUCTED_CURSOR_STORE_DIR: "/data/cursor-sdk-store",
	CONDUCTED_AGENT_BINARIES_DIR: "/data/agent-binaries",
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
				completionsDir: "/data/completions",
				cursorStoreDir: "/data/cursor-sdk-store",
				agentBinariesDir: "/data/agent-binaries",
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
			expect(result.error.message).toContain("CONDUCTED_COMPLETIONS_DIR");
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
				completionsDir: "/data/completions",
				cursorStoreDir: "/data/cursor-sdk-store",
				agentBinariesDir: "/data/agent-binaries",
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

describe("SIDE-22 slash-command cache folder setting", () => {
	test("SIDE-22 reads the completions folder from its own variable", () => {
		const result = parseSidecarConfig(good);
		expect(result.ok && result.value.completionsDir).toBe("/data/completions");
	});

	test("SIDE-22 a relative completions folder is refused", () => {
		const result = parseSidecarConfig({ ...good, CONDUCTED_COMPLETIONS_DIR: "completions" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toContain("CONDUCTED_COMPLETIONS_DIR");
	});
});

describe("AGENT-09 Cursor run store folder setting", () => {
	test("AGENT-09 reads the Cursor run store folder from its own variable", () => {
		const result = parseSidecarConfig(good);
		expect(result.ok && result.value.cursorStoreDir).toBe("/data/cursor-sdk-store");
	});

	test("AGENT-09 a missing or relative Cursor run store folder is refused by its name", () => {
		const { CONDUCTED_CURSOR_STORE_DIR: _omit, ...rest } = good;
		const missing = parseSidecarConfig(rest);
		expect(missing.ok).toBe(false);
		if (!missing.ok) expect(missing.error.message).toContain("CONDUCTED_CURSOR_STORE_DIR");
		const relative = parseSidecarConfig({ ...good, CONDUCTED_CURSOR_STORE_DIR: "cursor" });
		expect(relative.ok).toBe(false);
		if (!relative.ok) expect(relative.error.message).toContain("CONDUCTED_CURSOR_STORE_DIR");
	});
});

describe("AGENT-18 SIDE-22 one home for the launcher's variable names", () => {
	test("AGENT-18 SIDE-22 only config.ts spells a launcher variable name", () => {
		expect(spelledNames('export const SKILL_PLUGIN_ENV = "CONDUCTED_SKILL_PLUGIN_DIR";')).toEqual([
			"CONDUCTED_SKILL_PLUGIN_DIR",
		]);
		const own = path.join(import.meta.dir, "config.ts");
		const copies = sourceFiles(import.meta.dir)
			.filter((file) => file !== own)
			.flatMap((file) =>
				spelledNames(readFileSync(file, "utf8")).map(
					(name) => `${path.relative(import.meta.dir, file)}: ${name}`,
				),
			);
		expect(copies).toEqual([]);
	});
});

describe("PLAT-28 managed programs folder setting", () => {
	test("PLAT-28 reads the managed programs folder from its own variable", () => {
		const result = parseSidecarConfig(good);
		expect(result.ok && result.value.agentBinariesDir).toBe("/data/agent-binaries");
	});

	test("PLAT-28 a missing or relative managed programs folder is refused by its name", () => {
		const { CONDUCTED_AGENT_BINARIES_DIR: _omit, ...rest } = good;
		const missing = parseSidecarConfig(rest);
		expect(missing.ok).toBe(false);
		if (!missing.ok) expect(missing.error.message).toContain("CONDUCTED_AGENT_BINARIES_DIR");
		const relative = parseSidecarConfig({ ...good, CONDUCTED_AGENT_BINARIES_DIR: "programs" });
		expect(relative.ok).toBe(false);
		if (!relative.ok) expect(relative.error.message).toContain("CONDUCTED_AGENT_BINARIES_DIR");
	});
});
