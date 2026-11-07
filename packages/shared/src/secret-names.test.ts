import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isSecretName } from "./secret-names.ts";

interface SecretNameCase {
	name: string;
	secret: boolean;
}

const fixture = JSON.parse(
	readFileSync(join(import.meta.dir, "../fixtures/secret-names.json"), "utf8"),
) as { cases: SecretNameCase[] };

describe("shared secret-name rule", () => {
	test("answers every case in the shared fixture the same way", () => {
		expect(fixture.cases.length).toBeGreaterThan(0);
		for (const entry of fixture.cases) {
			expect({ name: entry.name, secret: isSecretName(entry.name) }).toEqual({
				name: entry.name,
				secret: entry.secret,
			});
		}
	});
});
