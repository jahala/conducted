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
});
