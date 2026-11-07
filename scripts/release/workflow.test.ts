/**
 * The release workflow is the only place a release is built. It runs on a version tag, asks for the
 * permissions attestations need, always deletes the temporary keychain and the deploy key, attests
 * every file it publishes, and updates the Homebrew cask from the released disk image.
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

interface Step {
	name?: string;
	uses?: string;
	run?: string;
	env?: Record<string, string>;
	with?: Record<string, string>;
}
const parsed = Bun.YAML.parse(workflow) as {
	jobs: { release: { env?: Record<string, string>; steps: Step[] } };
};
const job = parsed.jobs.release;
const readsSecret = (values: Record<string, string> | undefined): boolean =>
	Object.values(values ?? {}).some((value) => String(value).includes("secrets."));

test("gives each secret only to the steps that need it, never to third-party code", () => {
	// The job's env reaches every step, including `pnpm install` and the actions.
	expect(readsSecret(job.env)).toBe(false);
	const install = job.steps.find((step) => step.run?.includes("pnpm install"));
	expect(install).toBeDefined();
	expect(readsSecret(install?.env)).toBe(false);
	const actions = job.steps.filter((each) => each.uses !== undefined);
	expect(actions.length).toBeGreaterThan(0);
	for (const step of actions) {
		expect({ step: step.uses, secret: readsSecret(step.env) || readsSecret(step.with) }).toEqual({
			step: step.uses,
			secret: false,
		});
	}
});

test("makes no update archive in the build, so the build never needs the updater key", () => {
	const config = JSON.parse(
		readFileSync(
			join(import.meta.dir, "../../apps/desktop/src-tauri/tauri.release.conf.json"),
			"utf8",
		),
	) as { bundle: { createUpdaterArtifacts?: boolean } };
	expect(config.bundle.createUpdaterArtifacts).toBe(false);
});

test("asks the Pages workflow to rebuild the product page after the release, from a job of its own", () => {
	const jobs = (Bun.YAML.parse(workflow) as { jobs: Record<string, unknown> }).jobs as Record<
		string,
		{ needs?: string; permissions?: Record<string, string>; steps: Step[] }
	>;
	const pages = jobs.pages;
	expect(pages?.needs).toBe("release");
	// Only this job's token may start a workflow; the release job's steps run third-party code.
	expect(pages?.permissions).toEqual({ actions: "write" });
	expect(pages?.steps.some((step) => step.run?.includes("gh workflow run pages.yml"))).toBe(true);
});

const readsTapSecret = (values: Record<string, string> | undefined): boolean =>
	Object.values(values ?? {}).some((value) => String(value).includes("HOMEBREW_TAP_DEPLOY_KEY"));

test("publishes the cask from the released disk image with the tap deploy key", () => {
	const release = job.steps.findIndex((step) => step.name === "Create the GitHub release");
	const cask = job.steps.findIndex((step) => step.run?.includes("scripts/release/cask.ts"));
	expect(release).toBeGreaterThan(-1);
	expect(cask).toBeGreaterThan(release);
	const step = job.steps[cask];
	expect(step?.env?.HOMEBREW_TAP_DEPLOY_KEY).toBe("$" + "{{ secrets.HOMEBREW_TAP_DEPLOY_KEY }}");
	expect(step?.run).toContain("Casks/conducted.rb");
	expect(step?.run).toContain("push origin HEAD:main");
	// A pre-release is the dry run; the cask follows only stable releases.
	expect(step?.run).toContain("*-*");
	// The key lives in RUNNER_TEMP, readable only by this runner user.
	expect(step?.run).toContain("homebrew-tap-deploy-key");
	expect(step?.run).toContain("chmod 600");
	// ssh checks GitHub's host key, fetched from GitHub's API over HTTPS.
	expect(step?.run).toContain("gh api meta");
	expect(step?.run).toContain("StrictHostKeyChecking=yes");
	expect(step?.run).not.toContain("StrictHostKeyChecking=no");
});

test("gives the tap deploy key to the cask step only, and removes it with the other credentials", () => {
	expect(readsTapSecret(job.env)).toBe(false);
	const readers = job.steps.filter((each) => readsTapSecret(each.env) || readsTapSecret(each.with));
	expect(readers.map((each) => each.name)).toEqual(["Update the Homebrew cask"]);
	const cleanup = job.steps.find((each) => each.run?.includes("security delete-keychain"));
	expect(cleanup?.run).toContain("homebrew-tap-deploy-key");
});
