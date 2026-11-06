/**
 * The release writes Tauri's static update feed for the signed archive, names the keychain items
 * that hold the updater key without reading them, and lists every step with its undo line, so the
 * dry run says what --go would do (D079).
 */
import { expect, test } from "bun:test";
import { releasePlan } from "./plan.ts";
import {
	ghReleaseCommand,
	releaseAssetUrl,
	UPDATER_KEY_ITEMS,
	updaterArchivePath,
	updaterFeed,
	updaterKeyLookup,
} from "./updater.ts";

const APP =
	"/repo/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Conducted.app";

test("names the update archive the way Tauri does, beside the app", () => {
	expect(updaterArchivePath(APP)).toBe(`${APP}.tar.gz`);
});

test("points each asset at the version's GitHub release download", () => {
	expect(releaseAssetUrl("0.2.0", "Conducted.app.tar.gz")).toBe(
		"https://github.com/jahala/conducted/releases/download/v0.2.0/Conducted.app.tar.gz",
	);
	expect(releaseAssetUrl("0.2.0", "Conducted 2.app.tar.gz")).toBe(
		"https://github.com/jahala/conducted/releases/download/v0.2.0/Conducted%202.app.tar.gz",
	);
});

test("writes the feed in Tauri's static format with the signature text for Apple silicon", () => {
	const feed = updaterFeed({
		version: "0.2.0",
		notes: "v0.2.0",
		pubDate: new Date("2026-11-07T08:00:00.000Z"),
		archiveName: "Conducted.app.tar.gz",
		signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQo=\n",
	});

	expect(feed).toEqual({
		version: "0.2.0",
		notes: "v0.2.0",
		pub_date: "2026-11-07T08:00:00.000Z",
		platforms: {
			"darwin-aarch64": {
				signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQo=",
				url: "https://github.com/jahala/conducted/releases/download/v0.2.0/Conducted.app.tar.gz",
			},
		},
	});
});

test("looks each updater key item up in the keychain by service and account, printing nothing", () => {
	const lookups = Object.entries(UPDATER_KEY_ITEMS).map(([variable, service]) => [
		variable,
		updaterKeyLookup(service),
	]);

	expect(lookups).toEqual([
		[
			"TAURI_SIGNING_PRIVATE_KEY",
			["security", "find-generic-password", "-s", "conducted-updater-key", "-a", "conducted", "-w"],
		],
		[
			"TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
			[
				"security",
				"find-generic-password",
				"-s",
				"conducted-updater-key-password",
				"-a",
				"conducted",
				"-w",
			],
		],
	]);
});

test("builds the gh release command that uploads the disk image, the archive and the feed", () => {
	expect(
		ghReleaseCommand("0.2.0", [
			"/out/Conducted.dmg",
			"/out/Conducted.app.tar.gz",
			"/out/latest.json",
		]),
	).toBe(
		"gh release create v0.2.0 --repo jahala/conducted --verify-tag --title v0.2.0 --notes v0.2.0 '/out/Conducted.dmg' '/out/Conducted.app.tar.gz' '/out/latest.json'",
	);
	expect(ghReleaseCommand("0.2.0", ["/it's here/latest.json"])).toContain(
		"'/it'\\''s here/latest.json'",
	);
});

test("lists every release step in order, each with its undo line", () => {
	const plan = releasePlan("0.2.0");

	expect(plan.map((step) => step.id)).toEqual([
		"check",
		"bump",
		"build",
		"updaterArchive",
		"updaterFeed",
		"commit",
	]);
	for (const step of plan) expect(step.undo.length).toBeGreaterThan(0);
	expect(plan.filter((step) => step.readOnly).map((step) => step.id)).toEqual(["check"]);
	const archive = plan.find((step) => step.id === "updaterArchive");
	expect(archive?.say).toContain("signed");
	expect(archive?.undo).toContain("trash");
	const feed = plan.find((step) => step.id === "updaterFeed");
	expect(feed?.say).toContain("latest.json");
	expect(feed?.undo).toContain("trash");
	expect(plan.find((step) => step.id === "build")?.say).toContain("updater key");
});
