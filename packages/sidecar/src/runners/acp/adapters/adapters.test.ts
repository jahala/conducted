import { expect, test } from "bun:test";
import { ACP_AGENTS } from "@conducted/shared";
import { ACP_ADAPTERS } from "./registry.ts";

test("there is one adapter per ACP agent id, and each carries its own id", () => {
	for (const id of ACP_AGENTS) expect(ACP_ADAPTERS[id].id).toBe(id);
});

test("OpenCode runs `opencode acp` from version 1.16.2", () => {
	const adapter = ACP_ADAPTERS.opencode;
	expect(adapter.command).toEqual({ executable: "opencode", args: ["acp"] });
	expect(adapter.minimumVersion).toBe("1.16.2");
	expect(adapter.waitForModelCatalogMs).toBe(15_000);
});

test("Pi maps its find tool to glob", () => {
	expect(ACP_ADAPTERS.pi.command.executable).toBe("pi-acp");
	expect(ACP_ADAPTERS.pi.toolNameHints.find).toBe("glob");
});
