// @vitest-environment node
import { ok } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { configSyncKey } from "./agent-catalog.ts";
import { tomlCodec } from "./toml-codec.ts";

let test: TestContainer | undefined;

afterEach(() => {
	test?.close();
	test = undefined;
});

async function seedFile(mounted: TestContainer, path: string, text: string): Promise<void> {
	mounted.memory.controls.files.set(path, text);
}

async function seedFolder(mounted: TestContainer, path: string): Promise<void> {
	mounted.memory.controls.addFolder(path);
}

const homeOf = (mounted: TestContainer): string => mounted.container.platform.fs.paths.home;

describe("SET-08 config sync preview and copy", () => {
	it("SET-08 copies MCP servers, slash commands and skills from Claude Code to Codex", async () => {
		test = createTestContainer();
		const mounted = test;
		const home = homeOf(mounted);
		await seedFile(
			mounted,
			`${home}/.claude.json`,
			JSON.stringify({
				theme: "dark",
				mcpServers: { docs: { command: "npx", args: ["-y", "docs"] } },
			}),
		);
		await seedFolder(mounted, `${home}/.claude/commands`);
		await seedFile(mounted, `${home}/.claude/commands/review.md`, "Review the changes\n");
		await seedFolder(mounted, `${home}/.claude/skills/writer`);
		await seedFile(mounted, `${home}/.claude/skills/writer/SKILL.md`, "# Writer\nWrite well.\n");
		await seedFile(mounted, `${home}/.codex/config.toml`, '# keep me\napproval_policy = "never"\n');

		const service = mounted.container.services.agentCatalog;
		const categories = ["mcp_servers", "slash_commands", "skills"] as const;
		const preview = await service.loadConfigSyncPreview("claude", [...categories]);

		expect(preview.ok).toBe(true);
		if (!preview.ok) throw new Error(preview.error.message);
		expect(preview.value.map((change) => [change.category, change.name, change.change])).toEqual([
			["mcp_servers", "docs", "add"],
			["slash_commands", "review", "add"],
			["skills", "writer", "add"],
		]);
		expect(preview.value[0]?.diff).toContain('"command": "npx"');

		const result = await service.syncConfigs("claude", [...categories]);

		expect(result).toEqual(ok({ applied: 3, failures: [] }));
		const codex = await mounted.container.platform.fs.readText(`${home}/.codex/config.toml`);
		expect(codex.ok).toBe(true);
		if (!codex.ok) throw new Error(codex.error.message);
		expect(codex.value).toContain("# keep me");
		const parsed = tomlCodec.parse(codex.value);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) throw new Error(parsed.error.message);
		expect(parsed.value).toMatchObject({
			approval_policy: "never",
			mcp_servers: { docs: { command: "npx", args: ["-y", "docs"] } },
		});
		const command = await mounted.container.platform.fs.readText(
			`${home}/.codex/prompts/review.md`,
		);
		expect(command).toEqual(ok("Review the changes\n"));
		const skill = await mounted.container.platform.fs.readText(
			`${home}/.codex/skills/writer/SKILL.md`,
		);
		expect(skill).toEqual(ok("# Writer\nWrite well.\n"));
	});

	it("SET-08 copies Codex config into Claude's files and keeps Claude's other keys", async () => {
		test = createTestContainer();
		const mounted = test;
		const home = homeOf(mounted);
		await seedFile(
			mounted,
			`${home}/.codex/config.toml`,
			[
				"[mcp_servers.search]",
				'url = "https://search.example/mcp"',
				"",
				"[mcp_servers.docs]",
				'command = "npx"',
				'args = ["-y", "docs"]',
				"",
			].join("\n"),
		);
		await seedFolder(mounted, `${home}/.codex/prompts`);
		await seedFile(mounted, `${home}/.codex/prompts/review.md`, "Review from Codex\n");
		await seedFolder(mounted, `${home}/.codex/skills/writer`);
		await seedFile(mounted, `${home}/.codex/skills/writer/SKILL.md`, "# Writer\nCodex skill.\n");
		await seedFile(mounted, `${home}/.claude.json`, JSON.stringify({ theme: "light" }));

		const service = mounted.container.services.agentCatalog;
		const result = await service.syncConfigs("codex", ["mcp_servers", "slash_commands", "skills"]);

		expect(result).toEqual(ok({ applied: 4, failures: [] }));
		const claude = await mounted.container.platform.fs.readText(`${home}/.claude.json`);
		expect(claude.ok).toBe(true);
		if (!claude.ok) throw new Error(claude.error.message);
		expect(JSON.parse(claude.value)).toMatchObject({
			theme: "light",
			mcpServers: {
				search: { url: "https://search.example/mcp" },
				docs: { command: "npx", args: ["-y", "docs"] },
			},
		});
		expect(
			await mounted.container.platform.fs.readText(`${home}/.claude/commands/review.md`),
		).toEqual(ok("Review from Codex\n"));
		expect(
			await mounted.container.platform.fs.readText(`${home}/.claude/skills/writer/SKILL.md`),
		).toEqual(ok("# Writer\nCodex skill.\n"));
	});

	it("SET-08 keeps the newer preview when two reads answer out of order", async () => {
		test = createTestContainer();
		const mounted = test;
		const home = homeOf(mounted);
		const file = `${home}/.claude/commands/review.md`;
		await seedFolder(mounted, `${home}/.claude/commands`);
		await seedFile(mounted, file, "Old review\n");
		const service = mounted.container.services.agentCatalog;

		let releaseFirst = () => {};
		const gate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		vi.spyOn(mounted.container.platform.fs, "readText").mockImplementationOnce(async () => {
			await gate;
			return ok("Old review\n");
		});

		const first = service.loadConfigSyncPreview("claude", ["slash_commands"]);
		await vi.waitFor(() => expect(mounted.container.platform.fs.readText).toHaveBeenCalledTimes(1));
		await mounted.container.platform.fs.writeTextAtomic(file, "New review\n");
		const second = await service.loadConfigSyncPreview("claude", ["slash_commands"]);
		releaseFirst();
		const older = await first;

		expect(second.ok).toBe(true);
		if (!second.ok) throw new Error(second.error.message);
		expect(second.value[0]?.diff).toContain("+ New review");
		expect(older.ok).toBe(true);
		if (!older.ok) throw new Error(older.error.message);
		expect(older.value[0]?.diff).toContain("+ Old review");
		const stored =
			service.store.getState().configSyncPreview?.[configSyncKey("claude", ["slash_commands"])];
		expect(stored?.state).toBe("ready");
		expect(stored?.state === "ready" ? stored.data[0]?.diff : "").toContain("+ New review");
	});

	it("SET-08 reaches the Codex folder the file commands refuse before it is registered", async () => {
		test = createTestContainer({ enforceFileScope: true });
		const mounted = test;
		const home = homeOf(mounted);
		await seedFile(
			mounted,
			`${home}/.claude.json`,
			JSON.stringify({ mcpServers: { docs: { command: "npx" } } }),
		);
		await seedFolder(mounted, `${home}/.claude/commands`);
		await seedFile(mounted, `${home}/.claude/commands/review.md`, "Review the changes\n");

		const service = mounted.container.services.agentCatalog;
		const result = await service.syncConfigs("claude", ["mcp_servers", "slash_commands"]);

		expect(result).toEqual(ok({ applied: 2, failures: [] }));
		expect(
			await mounted.container.platform.fs.readText(`${home}/.codex/prompts/review.md`),
		).toEqual(ok("Review the changes\n"));
	});

	it("SET-08 reports the entries it could not write and copies the rest", async () => {
		test = createTestContainer();
		const mounted = test;
		const home = homeOf(mounted);
		await seedFolder(mounted, `${home}/.claude/commands`);
		await seedFile(mounted, `${home}/.claude/commands/blocked.md`, "Blocked command\n");
		await seedFile(mounted, `${home}/.claude/commands/good.md`, "Good command\n");
		await seedFolder(mounted, `${home}/.codex/prompts/blocked.md`);

		const service = mounted.container.services.agentCatalog;
		const result = await service.syncConfigs("claude", ["slash_commands"]);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.error.message);
		expect(result.value.applied).toBe(1);
		expect(result.value.failures).toHaveLength(1);
		expect(result.value.failures[0]?.name).toBe("blocked");
		expect(await mounted.container.platform.fs.readText(`${home}/.codex/prompts/good.md`)).toEqual(
			ok("Good command\n"),
		);
	});

	it("SET-08 maps a Claude HTTP server and a stdio server to Codex's keys", async () => {
		test = createTestContainer();
		const mounted = test;
		const home = homeOf(mounted);
		await seedFile(
			mounted,
			`${home}/.claude.json`,
			JSON.stringify({
				mcpServers: {
					search: {
						type: "http",
						url: "https://search.example/mcp",
						headers: { Authorization: "Bearer abc" },
					},
					docs: { type: "stdio", command: "npx", args: ["-y", "docs"], env: { LEVEL: "1" } },
				},
			}),
		);

		const service = mounted.container.services.agentCatalog;
		const result = await service.syncConfigs("claude", ["mcp_servers"]);

		expect(result).toEqual(ok({ applied: 2, failures: [] }));
		const codex = await mounted.container.platform.fs.readText(`${home}/.codex/config.toml`);
		if (!codex.ok) throw new Error(codex.error.message);
		const parsed = tomlCodec.parse(codex.value);
		if (!parsed.ok) throw new Error(parsed.error.message);
		expect(parsed.value).toEqual({
			mcp_servers: {
				search: {
					url: "https://search.example/mcp",
					http_headers: { Authorization: "Bearer abc" },
				},
				docs: { command: "npx", args: ["-y", "docs"], env: { LEVEL: "1" } },
			},
		});
	});

	it("SET-08 lists a server the other agent cannot run as a failure, in the preview too", async () => {
		test = createTestContainer();
		const mounted = test;
		const home = homeOf(mounted);
		await seedFile(
			mounted,
			`${home}/.claude.json`,
			JSON.stringify({
				mcpServers: {
					events: { type: "sse", url: "https://events.example/sse" },
					docs: { command: "npx" },
				},
			}),
		);

		const service = mounted.container.services.agentCatalog;
		const preview = await service.loadConfigSyncPreview("claude", ["mcp_servers"]);
		if (!preview.ok) throw new Error(preview.error.message);
		expect(preview.value.map((change) => change.name)).toEqual(["docs", "events"]);
		expect(preview.value[1]?.diff).toContain("Not copied: Codex has no SSE transport.");

		const result = await service.syncConfigs("claude", ["mcp_servers"]);

		expect(result).toEqual(
			ok({
				applied: 1,
				failures: [
					{ category: "mcp_servers", name: "events", message: "Codex has no SSE transport." },
				],
			}),
		);
		const codex = await mounted.container.platform.fs.readText(`${home}/.codex/config.toml`);
		if (!codex.ok) throw new Error(codex.error.message);
		expect(codex.value).not.toContain("events");
	});

	it("SET-08 maps Codex servers to Claude's keys and refuses the keys Claude has no place for", async () => {
		test = createTestContainer();
		const mounted = test;
		const home = homeOf(mounted);
		await seedFile(
			mounted,
			`${home}/.codex/config.toml`,
			[
				"[mcp_servers.search]",
				'url = "https://search.example/mcp"',
				'bearer_token_env_var = "SEARCH_TOKEN"',
				"",
				"[mcp_servers.docs]",
				'command = "npx"',
				'args = ["-y", "docs"]',
				"",
				"[mcp_servers.web]",
				'url = "https://web.example/mcp"',
				"",
			].join("\n"),
		);
		await seedFile(mounted, `${home}/.claude.json`, JSON.stringify({ theme: "light" }));

		const service = mounted.container.services.agentCatalog;
		const result = await service.syncConfigs("codex", ["mcp_servers"]);

		expect(result).toEqual(
			ok({
				applied: 2,
				failures: [
					{
						category: "mcp_servers",
						name: "search",
						message: "Claude Code has no setting for bearer_token_env_var.",
					},
				],
			}),
		);
		const claude = await mounted.container.platform.fs.readText(`${home}/.claude.json`);
		if (!claude.ok) throw new Error(claude.error.message);
		expect(JSON.parse(claude.value)).toEqual({
			theme: "light",
			mcpServers: {
				docs: { type: "stdio", command: "npx", args: ["-y", "docs"] },
				web: { type: "http", url: "https://web.example/mcp" },
			},
		});
	});

	it("SET-08 refuses a skill whose folder holds other files, and copies none of it", async () => {
		test = createTestContainer();
		const mounted = test;
		const home = homeOf(mounted);
		await seedFolder(mounted, `${home}/.claude/skills/tool/scripts`);
		await seedFile(mounted, `${home}/.claude/skills/tool/SKILL.md`, "# Tool\nRun scripts/go.sh\n");
		await seedFile(mounted, `${home}/.claude/skills/tool/scripts/go.sh`, "echo go\n");
		await seedFolder(mounted, `${home}/.claude/skills/plain`);
		await seedFile(mounted, `${home}/.claude/skills/plain/SKILL.md`, "# Plain\n");

		const service = mounted.container.services.agentCatalog;
		const preview = await service.loadConfigSyncPreview("claude", ["skills"]);
		if (!preview.ok) throw new Error(preview.error.message);
		expect(preview.value.map((change) => change.name)).toEqual(["plain", "tool"]);
		expect(preview.value[1]?.diff).toContain("Not copied: ");

		const result = await service.syncConfigs("claude", ["skills"]);

		expect(result).toEqual(
			ok({
				applied: 1,
				failures: [
					{
						category: "skills",
						name: "tool",
						message: "The skill folder holds more than SKILL.md (scripts), so copy it by hand.",
					},
				],
			}),
		);
		expect(await mounted.container.platform.fs.exists(`${home}/.codex/skills/tool`)).toBe(false);
		expect(
			await mounted.container.platform.fs.readText(`${home}/.codex/skills/plain/SKILL.md`),
		).toEqual(ok("# Plain\n"));
	});

	it("SET-08 refuses to write ~/.claude.json when Claude Code changed it during the sync", async () => {
		let now = 1_000;
		test = createTestContainer({ clock: { now: () => (now += 1_000) } });
		const mounted = test;
		const home = homeOf(mounted);
		const fs = mounted.container.platform.fs;
		const claudeJson = `${home}/.claude.json`;
		await fs.writeTextAtomic(claudeJson, JSON.stringify({ projects: { a: 1 } }));
		await seedFile(mounted, `${home}/.codex/config.toml`, '[mcp_servers.docs]\ncommand = "npx"\n');
		const read = fs.readText.bind(fs);
		const write = fs.writeTextAtomic.bind(fs);
		let claudeReads = 0;
		const concurrent = JSON.stringify({ projects: { a: 1, b: 2 } });
		vi.spyOn(fs, "readText").mockImplementation(async (path) => {
			const result = await read(path);
			// Claude Code rewrites its file just after the sync read it for the write.
			if (path === claudeJson && ++claudeReads === 2) await write(claudeJson, concurrent);
			return result;
		});

		const service = mounted.container.services.agentCatalog;
		const result = await service.syncConfigs("codex", ["mcp_servers"]);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.error.message);
		expect(result.value.applied).toBe(0);
		expect(result.value.failures).toEqual([
			{
				category: "mcp_servers",
				name: "docs",
				message: `${claudeJson} changed while the sync was writing it. Nothing was written; run the sync again.`,
			},
		]);
		expect(await read(claudeJson)).toEqual(ok(concurrent));
	});

	it("SET-08 keeps the indentation of ~/.claude.json and changes only its MCP table", async () => {
		test = createTestContainer();
		const mounted = test;
		const home = homeOf(mounted);
		const original = `${JSON.stringify({ theme: "dark", numStartups: 3 }, null, "\t")}\n`;
		await seedFile(mounted, `${home}/.claude.json`, original);
		await seedFile(mounted, `${home}/.codex/config.toml`, '[mcp_servers.docs]\ncommand = "npx"\n');

		const service = mounted.container.services.agentCatalog;
		expect(await service.syncConfigs("codex", ["mcp_servers"])).toEqual(
			ok({ applied: 1, failures: [] }),
		);

		const claude = await mounted.container.platform.fs.readText(`${home}/.claude.json`);
		expect(claude).toEqual(
			ok(
				`${JSON.stringify(
					{
						theme: "dark",
						numStartups: 3,
						mcpServers: { docs: { type: "stdio", command: "npx" } },
					},
					null,
					"\t",
				)}\n`,
			),
		);
	});
});
