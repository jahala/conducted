import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPullRequestStub, writePullRequestStubFile } from "./pull-request-stub.ts";

describe("SIDE-09 pull-request stub", () => {
	test("a stub has a heading and, when known, its GitHub URL", () => {
		expect(buildPullRequestStub(12)).toBe("# Pull request #12\n");
		expect(buildPullRequestStub(12, "acme/app")).toBe(
			"# Pull request #12\n\nGitHub URL: https://github.com/acme/app/pull/12\n",
		);
	});

	test("a stub is written once and an existing file is kept", async () => {
		const dir = mkdtempSync(join(tmpdir(), "conducted-side-09-"));
		try {
			const first = await writePullRequestStubFile(dir, 12, "acme/app");
			expect(first.ok).toBe(true);
			const target = join(dir, ".context/pull-requests/12.md");
			const content = readFileSync(target, "utf8");
			expect(content).toContain("# Pull request #12");
			expect(content).toContain("https://github.com/acme/app/pull/12");

			writeFileSync(target, "notes from the agent\n");
			const second = await writePullRequestStubFile(dir, 12, "acme/app");
			expect(second.ok).toBe(true);
			expect(readFileSync(target, "utf8")).toBe("notes from the agent\n");

			const withoutRepository = await writePullRequestStubFile(dir, 13);
			expect(withoutRepository.ok).toBe(true);
			expect(readFileSync(join(dir, ".context/pull-requests/13.md"), "utf8")).toBe(
				"# Pull request #13\n",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
