/**
 * @feature SET-13 Chosen program paths reach terminals and scripts
 * Owns: tests for the PATH prefix built from the executable paths chosen in settings.
 * Test first: a chosen Claude path reaches the shim command, and its folder is returned.
 */
import { appError, err, ok } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createTestContainer } from "../../test/container.ts";
import { programsBinDir } from "../app-paths.ts";
import { SystemService } from "./system.ts";

function serviceWith(
	platform: ReturnType<typeof createTestContainer>["container"]["platform"],
	settings: Readonly<Record<string, string>>,
): SystemService {
	return new SystemService({
		platform,
		setting: <T>(key: string) => (settings[key] ?? "") as T,
	});
}

describe("SET-13 SystemService path prefix", () => {
	it("sends the trimmed chosen executable paths and returns the shim folder", async () => {
		const test = createTestContainer();
		try {
			const synced = vi
				.spyOn(test.container.platform.programs, "syncPathOverrides")
				.mockResolvedValue(ok("/data/bin-overrides/abc"));
			const service = serviceWith(test.container.platform, {
				claude_executable_path: "  /opt/claude  ",
				codex_executable_path: "/opt/codex",
			});

			const result = await service.pathPrefix();

			expect(result).toEqual({
				ok: true,
				value: `/data/bin-overrides/abc:${programsBinDir(test.container.platform.fs.paths)}`,
			});
			expect(synced).toHaveBeenCalledWith({
				claude: "/opt/claude",
				codex: "/opt/codex",
			});
		} finally {
			test.close();
		}
	});

	it("leaves empty chosen paths out of the command", async () => {
		const test = createTestContainer();
		try {
			const synced = vi.spyOn(test.container.platform.programs, "syncPathOverrides");
			const service = serviceWith(test.container.platform, {
				claude_executable_path: "   ",
				codex_executable_path: "",
			});

			const result = await service.pathPrefix();

			expect(result).toEqual({
				ok: true,
				value: programsBinDir(test.container.platform.fs.paths),
			});
			expect(synced).not.toHaveBeenCalled();
		} finally {
			test.close();
		}
	});

	it("logs a staging failure, records it for the notice and uses the bundled bin folder", async () => {
		const test = createTestContainer();
		try {
			vi.spyOn(test.container.platform.programs, "syncPathOverrides").mockResolvedValue(
				err(appError("path_override_invalid", "The chosen Claude path cannot be used.")),
			);
			const service = serviceWith(test.container.platform, {
				claude_executable_path: "/opt/missing",
			});

			const result = await service.pathPrefix();

			expect(result).toEqual({
				ok: true,
				value: programsBinDir(test.container.platform.fs.paths),
			});
			expect(test.memory.controls.logs).toContainEqual(
				expect.objectContaining({
					level: "warn",
					message: expect.stringContaining("Failed to stage agent PATH override shims"),
				}),
			);
			expect(service.store.getState().pathOverrideProblem).toEqual({
				serial: 1,
				message: "The chosen Claude path cannot be used.",
			});
		} finally {
			test.close();
		}
	});
});
