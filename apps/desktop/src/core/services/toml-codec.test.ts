import { describe, expect, it } from "vitest";
import { tomlCodec } from "./toml-codec.ts";

describe("DATA-05 TOML codec", () => {
	it("round-trips a settings document with a schema, nested tables and arrays", () => {
		const document = {
			$schema: "https://conducted.app/schemas/settings.schema.json",
			git: { delete_branch_on_archive: true },
			models: { default: "model-a" },
			scripts: { run: { test: { command: "pnpm test", args: ["--watch"] } } },
			environment_variables: { local: { API_URL: "http://localhost" } },
		};
		const text = tomlCodec.stringify(document);
		expect(text).toContain('"$schema"');
		const parsed = tomlCodec.parse(text);
		expect(parsed.ok && parsed.value).toEqual(document);
	});

	it("returns an error for text that is not TOML", () => {
		const parsed = tomlCodec.parse("{ not toml");
		expect(parsed.ok).toBe(false);
		expect(!parsed.ok && parsed.error.code).toBe("toml_invalid");
	});
});
