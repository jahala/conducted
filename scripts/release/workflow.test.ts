/**
 * The release workflow is the only place a release is built. It runs on a version tag, asks for the
 * permissions attestations need, always deletes the temporary keychain, and attests every file it
 * publishes.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workflow = readFileSync(join(import.meta.dir, "../../.github/workflows/release.yml"), "utf8");

test("runs when a version tag is pushed", () => {
	expect(workflow).toContain("push:");
	expect(workflow).toContain('tags: ["v*"]');
	expect(workflow).toContain("runs-on: macos-latest");
	expect(workflow).toMatch(/timeout-minutes:\s*\d+/);
});

test("asks for the permissions the release and its attestations need", () => {
	expect(workflow).toContain("contents: write");
	expect(workflow).toContain("id-token: write");
	expect(workflow).toContain("attestations: write");
});

test("installs the locked packages and checks the tag against every version file", () => {
	expect(workflow).toContain("pnpm install --frozen-lockfile");
	expect(workflow).toContain("scripts/release/tag-check.ts");
});

test("imports a temporary keychain and deletes it even when a step failed", () => {
	const cleanup = workflow.slice(workflow.indexOf("if: always()"));
	expect(workflow).toContain("security create-keychain");
	expect(workflow).toContain("security import");
	expect(cleanup).toContain("security delete-keychain");
});

test("attests every release file", () => {
	expect(workflow).toContain("uses: actions/attest-build-provenance@");
	expect(workflow).toContain("subject-path:");
	expect(workflow).toMatch(/subject-path:\s*\|/);
});

test("creates the release from the changelog section", () => {
	expect(workflow).toContain("scripts/release/notes.ts");
	expect(workflow).toContain("scripts/release/publish.ts");
});

test("never writes a credential to the log", () => {
	expect(workflow).not.toContain("echo $APPLE_CERTIFICATE_P12");
	expect(workflow).not.toContain("echo $APPLE_API_KEY_P8");
	expect(workflow).not.toContain("echo $TAURI_SIGNING_PRIVATE_KEY");
});
