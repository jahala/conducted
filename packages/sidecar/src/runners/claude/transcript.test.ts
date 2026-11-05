import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SessionId } from "@conducted/shared";
import {
	claudeConfigDir,
	createTranscriptCheck,
	hasResumableTranscript,
	projectFolderName,
	transcriptPath,
} from "./transcript.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function tempDir(prefix: string): Promise<string> {
	const created = await mkdtemp(path.join(tmpdir(), `conducted-side.01-transcript-${prefix}-`));
	cleanups.push(() => rm(created, { recursive: true, force: true }));
	return created;
}

async function exists(target: string): Promise<boolean> {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
}

async function writeTranscript(file: string, lines: readonly unknown[]): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, lines.map((line) => JSON.stringify(line)).join("\n"), "utf8");
}

describe("SIDE-01 Claude transcript paths", () => {
	test("SIDE-01 the config folder honours CLAUDE_CONFIG_DIR and falls back to the home folder", () => {
		expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: "/custom/claude", HOME: "/home/me" })).toBe(
			"/custom/claude",
		);
		expect(claudeConfigDir({ HOME: "/home/me" })).toBe("/home/me/.claude");
		expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: "", HOME: "/home/me" })).toBe("/home/me/.claude");
	});

	test("SIDE-01 every non-alphanumeric character of the workspace path becomes a dash", () => {
		expect(projectFolderName("/Users/me/my project (v2)")).toBe("-Users-me-my-project--v2-");
	});

	test("SIDE-01 a short project folder has no hash suffix", () => {
		expect(projectFolderName("/tmp/work")).toBe("-tmp-work");
	});

	test("SIDE-01 a project folder past 200 characters takes a hash suffix", () => {
		const cwd = `/${"a".repeat(250)}`;
		const name = projectFolderName(cwd);
		const mangled = cwd.replace(/[^a-zA-Z0-9]/g, "-");
		expect(name.startsWith(mangled.slice(0, 200))).toBe(true);
		expect(name.slice(0, 200)).toBe(mangled.slice(0, 200));
		expect(name.length).toBeGreaterThan(201);
		expect(name.slice(201)).toMatch(/^[0-9a-z]+$/);
	});

	test("SIDE-01 the transcript sits under projects, keyed by the workspace path", () => {
		expect(transcriptPath("s1", "/Users/me/proj", "/cfg/.claude")).toBe(
			"/cfg/.claude/projects/-Users-me-proj/s1.jsonl",
		);
	});
});

describe("SIDE-01 resumable Claude transcripts", () => {
	test("SIDE-01 a non-sidechain assistant line makes the transcript resumable", async () => {
		const base = await tempDir("assistant");
		const configDir = path.join(base, ".claude");
		const cwd = path.join(base, "workspace");
		const file = transcriptPath("s1", cwd, configDir);
		await writeTranscript(file, [
			{ type: "system", subtype: "init" },
			{ type: "assistant", isSidechain: false, message: "hello" },
		]);
		expect(await hasResumableTranscript("s1", cwd, configDir)).toBe(true);
		expect(await exists(file)).toBe(true);
	});

	test("SIDE-01 a transcript with only a sidechain line is not resumable and is renamed", async () => {
		const base = await tempDir("sidechain");
		const configDir = path.join(base, ".claude");
		const cwd = path.join(base, "workspace");
		const file = transcriptPath("s2", cwd, configDir);
		await writeTranscript(file, [{ type: "user", isSidechain: true, message: "subagent" }]);
		expect(await hasResumableTranscript("s2", cwd, configDir)).toBe(false);
		expect(await exists(file)).toBe(false);
		expect(await exists(`${file}.stale`)).toBe(true);
	});

	test("SIDE-01 a malformed line is skipped, and a later user line still resumes", async () => {
		const base = await tempDir("malformed");
		const configDir = path.join(base, ".claude");
		const cwd = path.join(base, "workspace");
		const file = transcriptPath("s3", cwd, configDir);
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, `not json\n${JSON.stringify({ type: "user", message: "hi" })}\n`, "utf8");
		expect(await hasResumableTranscript("s3", cwd, configDir)).toBe(true);
	});

	test("SIDE-01 a missing transcript is not resumable and nothing is renamed", async () => {
		const base = await tempDir("missing");
		const configDir = path.join(base, ".claude");
		const cwd = path.join(base, "workspace");
		const file = transcriptPath("s4", cwd, configDir);
		expect(await hasResumableTranscript("s4", cwd, configDir)).toBe(false);
		expect(await exists(file)).toBe(false);
		expect(await exists(`${file}.stale`)).toBe(false);
	});

	test("SIDE-01 the config folder is pinned at start, so a later change does not move the path", async () => {
		const base = await tempDir("pinned");
		const first = path.join(base, "first");
		const second = path.join(base, "second");
		const env: Record<string, string> = { CLAUDE_CONFIG_DIR: first };
		const check = createTranscriptCheck(claudeConfigDir(env));
		env.CLAUDE_CONFIG_DIR = second;
		const cwd = path.join(base, "workspace");
		await writeTranscript(transcriptPath("s5", cwd, first), [{ type: "user", message: "hi" }]);
		expect(await check("s5" as SessionId, cwd)).toBe(true);
	});
});
