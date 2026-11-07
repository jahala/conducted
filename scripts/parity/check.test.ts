import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseArgs } from "./check.ts";

describe("parseArgs", () => {
	test("--live names the live run's log, which check e reads beside the lists", () => {
		const options = parseArgs(["--no-dump", "--live", "live.json"], {});
		expect(options.live).toBe(resolve("live.json"));
		expect(options.dump).toBeNull();
	});

	test("without --live there is no live log", () => {
		expect(parseArgs(["dump.json"], {}).live).toBeNull();
	});
});
