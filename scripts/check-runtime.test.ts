/**
 * The runtime check must stop a run on another Node major or Bun minor, and pass a matching one.
 */
import { expect, test } from "bun:test";
import { checkRuntime } from "./check-runtime.ts";

test("matching versions pass", () => {
	expect(checkRuntime({ node: "26", bun: "1.3.14" }, { node: "v26.8.1", bun: "1.3.9" })).toEqual(
		[],
	);
});

test("another Node major or Bun minor is reported with a fix", () => {
	const problems = checkRuntime({ node: "26", bun: "1.3.14" }, { node: "v24.1.0", bun: "1.4.0" });
	expect(problems.map((p) => p.runtime)).toEqual(["node", "bun"]);
	expect(problems[0]?.fix).toContain("Node 26");
	expect(problems[1]?.fix).toBe("bun upgrade --version 1.3.14");
});
