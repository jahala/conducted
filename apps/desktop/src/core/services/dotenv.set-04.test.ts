/**
 * @feature SET-04 Environment variables, stored in the Keychain
 * Owns: the dotenv reader and the path resolution an env file's setting uses, as Conductor does
 * them (services-map.md 4.2.4).
 * Behaviour: an `export ` prefix is allowed; `#` starts a comment; single quotes are literal;
 * double quotes take `\n \r \t` and any other escaped character as itself; an unquoted value ends
 * at whitespace before `#`; a path is absolute, `~`, or relative to the settings folder first and
 * the repository root second.
 * Test first: reads names, export prefixes, quotes and comments.
 */
import { describe, expect, it } from "vitest";
import { parseDotenv, resolveEnvFilePath } from "./dotenv.ts";

describe("SET-04 dotenv", () => {
	it("reads names, export prefixes, quotes and comments", () => {
		expect(
			parseDotenv("A=1\nexport B=\"two\"\n# skip\nC=\nD='three'\nE=five # trailing\n"),
		).toEqual([
			{ name: "A", value: "1" },
			{ name: "B", value: "two" },
			{ name: "C", value: "" },
			{ name: "D", value: "three" },
			{ name: "E", value: "five" },
		]);
	});

	it("takes the escapes Conductor takes and leaves single quotes literal", () => {
		expect(parseDotenv('A="one\\ntwo\\tthree\\"four"\nB=\'one\\ntwo\'\n')).toEqual([
			{ name: "A", value: 'one\ntwo\tthree"four' },
			{ name: "B", value: "one\\ntwo" },
		]);
	});

	it("skips a line with no name or an invalid name", () => {
		expect(parseDotenv("=value\n1BAD=x\nGOOD=yes\n")).toEqual([{ name: "GOOD", value: "yes" }]);
	});

	it("resolves a path against the settings folder first, then the repository", async () => {
		const seen: string[] = [];
		const input = {
			home: "/Users/me",
			settingsDir: "/repo/.conducted",
			sourceRoot: "/repo",
			exists: async (path: string) => {
				seen.push(path);
				return path === "/repo/.conducted/.env";
			},
		};
		expect(await resolveEnvFilePath({ ...input, path: ".env" })).toBe("/repo/.conducted/.env");
		expect(seen).toEqual(["/repo/.conducted/.env"]);

		seen.length = 0;
		expect(await resolveEnvFilePath({ ...input, path: "config/.env" })).toBe("/repo/config/.env");
		expect(seen).toEqual(["/repo/.conducted/config/.env"]);
	});

	it("resolves an absolute path and a home path as written", async () => {
		const input = {
			settingsDir: "/repo/.conducted",
			sourceRoot: "/repo",
			exists: async () => false,
		};
		expect(await resolveEnvFilePath({ ...input, home: "/Users/me", path: "/etc/.env" })).toBe(
			"/etc/.env",
		);
		expect(await resolveEnvFilePath({ ...input, home: "/Users/me", path: "~/.env" })).toBe(
			"/Users/me/.env",
		);
	});
});
