import { ok } from "@conducted/shared";
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
		const written = tomlCodec.stringify(document);
		if (!written.ok) throw new Error(written.error.message);
		const text = written.value;
		expect(text).toContain('"$schema"');
		const parsed = tomlCodec.parse(text);
		expect(parsed.ok && parsed.value).toEqual(document);
	});

	it("returns an error for a value TOML cannot hold, instead of throwing", () => {
		const written = tomlCodec.stringify({ hook: () => undefined });
		expect(written.ok).toBe(false);
		expect(!written.ok && written.error.code).toBe("toml_invalid");
	});

	it("returns an error for text that is not TOML", () => {
		const parsed = tomlCodec.parse("{ not toml");
		expect(parsed.ok).toBe(false);
		expect(!parsed.ok && parsed.error.code).toBe("toml_invalid");
	});
});

describe("SET-14 TOML codec keeps the user's text", () => {
	const handWritten = [
		"# My settings, written by hand",
		"",
		"[models]",
		"# The model I like",
		'default = "model-a" # chosen in May',
		'review = "model-b"',
		"",
		"[scripts]",
		'setup = """',
		"pnpm install # not a comment",
		'"""',
		"",
	].join("\n");

	it("changes only the value that differs and keeps every comment and blank line", () => {
		const parsed = tomlCodec.parse(handWritten);
		expect(parsed.ok).toBe(true);
		const document = parsed.ok ? parsed.value : {};
		const models = document["models"] as Record<string, unknown>;
		const patched = tomlCodec.patch(handWritten, {
			...document,
			models: { ...models, review: "model-c" },
		});
		expect(patched).toEqual(ok(handWritten.replace('review = "model-b"', 'review = "model-c"')));
	});

	it("returns an error for existing text that is not TOML", () => {
		const patched = tomlCodec.patch("{ not toml", { a: 1 });
		expect(patched.ok).toBe(false);
		expect(!patched.ok && patched.error.code).toBe("toml_invalid");
	});

	it("lists comments and skips a # inside any kind of string", () => {
		const text = [
			"# first",
			'a = "x # y" # second',
			"b = 'x # y'",
			'c = """',
			'# in a basic block \\""" still inside',
			'"""  # third',
			"d = '''",
			"# in a literal block",
			"'''",
			'"e # key" = 1 #fourth  ',
			"",
		].join("\n");
		expect(tomlCodec.comments(text)).toEqual(["# first", "# second", "# third", "#fourth"]);
	});
});
