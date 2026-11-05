/**
 * @feature SIDE-02 JSON-RPC over a Unix socket
 * Owns: the check that the sidecar's shared stand-ins (FakeApp, FakePublisher, FakeInteractions,
 * FakeProcesses, FakeChild, MemoryStorage) have one home, this folder. A test file that declares
 * its own class of the same name is a second copy, and a second copy is not checked against the
 * real thing.
 * Test first: "the sample with a second FakeApp is flagged".
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dir, "..");
const STAND_INS = [
	"FakeApp",
	"NotifyingApp",
	"FakePublisher",
	"FakeInteractions",
	"FakeProcesses",
	"FakeChild",
	"MemoryStorage",
	"InMemoryOutboxStorage",
];
const DECLARATION = new RegExp(`\\bclass\\s+(${STAND_INS.join("|")})\\b`);

interface SourceFile {
	path: string;
	text: string;
}

/** The files outside test-support that declare a class named like a shared stand-in. */
export function secondCopies(files: readonly SourceFile[]): string[] {
	return files
		.filter((file) => !file.path.split("/").includes("test-support"))
		.filter((file) => DECLARATION.test(file.text))
		.map((file) => `${file.path}: ${DECLARATION.exec(file.text)?.[1] ?? ""}`);
}

function testFiles(folder: string): SourceFile[] {
	const out: SourceFile[] = [];
	for (const entry of readdirSync(folder, { withFileTypes: true })) {
		const full = path.join(folder, entry.name);
		if (entry.isDirectory()) out.push(...testFiles(full));
		else if (entry.name.endsWith(".ts")) {
			out.push({ path: path.relative(SRC, full), text: readFileSync(full, "utf8") });
		}
	}
	return out;
}

describe("SIDE-02 the shared stand-ins have one home", () => {
	test("the sample with a second FakeApp is flagged", () => {
		const flagged = secondCopies([
			{ path: "session/new.test.ts", text: "class FakeApp implements SidecarToApp {}" },
			{ path: "test-support/fake-app.ts", text: "export class FakeApp implements SidecarToApp {}" },
			{
				path: "session/fine.test.ts",
				text: 'import { FakeApp } from "../test-support/fake-app.ts";',
			},
		]);

		expect(flagged).toEqual(["session/new.test.ts: FakeApp"]);
	});

	test("no sidecar file outside test-support declares its own copy", () => {
		expect(secondCopies(testFiles(SRC))).toEqual([]);
	});
});
