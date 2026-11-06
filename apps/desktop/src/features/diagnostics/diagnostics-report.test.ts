import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { DiagnosticsCapture } from "../../core/model.ts";
import { createTestContainer } from "../../test/container.ts";
import {
	MAX_REPORT_VALUE_LENGTH,
	redactCapture,
	redactHome,
	renderReport,
	SAFE_ENV_NAMES,
	shortSha256,
	writeRedactedReport,
} from "./diagnostics-report.ts";

const capture = (changes: Partial<DiagnosticsCapture> = {}): DiagnosticsCapture => ({
	app: { version: "0.1.0", channel: "dev" },
	os: { name: "macOS", version: "15.4.1", arch: "arm64" },
	shell: "/bin/zsh",
	path: "/Users/me/bin:/usr/bin:/bin",
	env: { LANG: "en_AU.UTF-8", API_TOKEN: "super-secret", PATH: "/Users/me/bin" },
	agents: [{ name: "claude", installed: true, version: "2.1.0", path: "/bin/claude" }],
	sidecar: { running: true, logPath: "/logs/sidecar.log" },
	capturedAt: 1_700_000_000_000,
	...changes,
});

const hash = (value: string): string => `hashed(${value})`;

describe("APP-03 diagnostics report redaction", () => {
	it("hashes a variable named API_TOKEN even when the safe list names it and keeps LANG", () => {
		const redacted = redactCapture(capture(), {
			safeEnvNames: new Set([...SAFE_ENV_NAMES, "API_TOKEN"]),
			hash,
			homeDir: "/Users/me",
		});

		expect(redacted.env.API_TOKEN).toBe("hashed(super-secret)");
		expect(redacted.env.LANG).toBe("en_AU.UTF-8");
		expect(redacted.env.PATH).toBe("hashed(/Users/me/bin)");
	});

	it("keeps the home folder out of the redacted PATH", () => {
		const redacted = redactCapture(capture(), {
			safeEnvNames: SAFE_ENV_NAMES,
			hash,
			homeDir: "/Users/me",
		});
		expect(redacted.path).toBe("~/bin:/usr/bin:/bin");
		expect(redactHome("/Users/me/project", "/Users/me")).toBe("~/project");
	});

	it("leaves a value alone when a safe name does not look secret", () => {
		const redacted = redactCapture(capture({ env: { TERM: "xterm-256color" } }), {
			safeEnvNames: SAFE_ENV_NAMES,
			hash,
			homeDir: "/Users/me",
		});
		expect(redacted.env.TERM).toBe("xterm-256color");
	});

	it("is stable for the same value and different for another", () => {
		expect(shortSha256("super-secret")).toBe(shortSha256("super-secret"));
		expect(shortSha256("super-secret")).not.toBe(shortSha256("another-secret"));
		expect(shortSha256("super-secret")).toHaveLength(8);
	});
});

describe("APP-03 diagnostics report rendering", () => {
	it("names every section and makes a long value say what it left out", () => {
		const long = "x".repeat(MAX_REPORT_VALUE_LENGTH + 5);
		const text = renderReport(capture({ env: { LANG: "en_AU.UTF-8", LONG: long } }));

		expect(text).toContain("Conducted diagnostics");
		expect(text).toContain("App");
		expect(text).toContain("System");
		expect(text).toContain("PATH");
		expect(text).toContain("Environment");
		expect(text).toContain("Agents");
		expect(text).toContain("Sidecar");
		expect(text).toContain("LANG=en_AU.UTF-8");
		expect(text).toContain("truncated");
		expect(text).not.toContain(long);
	});

	it("keeps one value on one line and says when the environment is empty", () => {
		const text = renderReport(capture({ env: { MULTI: "one\ntwo" } }));
		expect(text).toContain("MULTI=one\\ntwo");
		expect(text).not.toContain("\none\ntwo");

		expect(renderReport(capture({ env: {}, path: "" }))).toContain("(empty)");
	});
});

describe("APP-03 diagnostics report file", () => {
	it("writes the redacted report and never the secret", async () => {
		const test = createTestContainer();
		try {
			const result = await writeRedactedReport(test.container.platform, capture(), "report-1");

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			const written = await test.container.platform.fs.readText(result.value);
			expect(written.ok).toBe(true);
			if (!written.ok) return;
			expect(written.value).toContain("API_TOKEN=");
			expect(written.value).not.toContain("super-secret");
			expect(written.value).toContain("LANG=en_AU.UTF-8");
		} finally {
			test.close();
		}
	});

	it("returns the write failure instead of an empty path", async () => {
		const test = createTestContainer();
		try {
			// A folder at the report's path makes the write fail.
			test.memory.controls.addFolder(
				`${test.container.platform.fs.paths.temp}/conducted-diagnostics-bad.txt`,
			);

			const result = await writeRedactedReport(test.container.platform, capture(), "bad");
			expect(result.ok).toBe(false);
		} finally {
			test.close();
		}
	});

	it("writes to the platform's temp folder", async () => {
		const test = createTestContainer();
		try {
			const result = await writeRedactedReport(test.container.platform, capture(), "where");
			expect(result).toEqual(
				ok(`${test.container.platform.fs.paths.temp}/conducted-diagnostics-where.txt`),
			);
		} finally {
			test.close();
		}
	});
});
