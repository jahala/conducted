import type { RepoId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { getSettingDef } from "../registries/settings.ts";
import {
	envVarKeychainKey,
	type LayerValue,
	resolveSetting,
	validateEnvVarName,
} from "./settings.ts";

// `delete_branch_on_archive` is file-backed and allowed in repo files; `default_model` is user-file only.
const repoAllowed = getSettingDef("delete_branch_on_archive");
const userOnly = getSettingDef("default_model");
const tableOnly = getSettingDef("default_message_send_mode");

const need = <T>(value: T | undefined): T => {
	if (value === undefined) throw new Error("missing setting in registry");
	return value;
};

describe("resolveSetting", () => {
	it("returns the registry default when no layer has a value", () => {
		const def = need(repoAllowed);
		expect(resolveSetting(def, [])).toEqual({ value: def.default, source: "default" });
	});

	it("lets a repo shared value beat the user file for a repo-scoped key", () => {
		const layers: LayerValue[] = [
			{ layer: "user-file", value: false },
			{ layer: "repo-shared", value: true },
		];
		expect(resolveSetting(need(repoAllowed), layers)).toEqual({
			value: true,
			source: "repo-shared",
		});
	});

	it("lets the repo local file beat the repo shared file regardless of input order", () => {
		const layers: LayerValue[] = [
			{ layer: "repo-local", value: "a" },
			{ layer: "repo-shared", value: "b" },
		];
		expect(resolveSetting(need(getSettingDef("setup_script")), layers).source).toBe("repo-local");
	});

	it("ignores repo layers for a user-only key", () => {
		const layers: LayerValue[] = [
			{ layer: "user-file", value: "model-a" },
			{ layer: "repo-shared", value: "model-b" },
		];
		expect(resolveSetting(need(userOnly), layers)).toEqual({
			value: "model-a",
			source: "user-file",
		});
	});

	it("reads non-file-backed keys only from the table", () => {
		const layers: LayerValue[] = [
			{ layer: "user-file", value: "queue" },
			{ layer: "table", value: "steer" },
		];
		expect(resolveSetting(need(tableOnly), layers)).toEqual({ value: "steer", source: "table" });
	});
});

describe("env vars", () => {
	it("accepts identifiers and rejects others", () => {
		expect(validateEnvVarName("API_KEY_2").ok).toBe(true);
		expect(validateEnvVarName("2BAD").ok).toBe(false);
		expect(validateEnvVarName("has-dash").ok).toBe(false);
	});
	it("builds distinct keychain keys per scope", () => {
		expect(envVarKeychainKey("global", "A")).toBe("env:global:A");
		expect(envVarKeychainKey({ repoId: "r1" as RepoId }, "A")).toBe("env:repo:r1:A");
	});
});
