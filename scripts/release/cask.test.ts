/**
 * @feature PLAT-42 Homebrew cask that follows the latest release
 * The cask text is a pure function of the release version, the disk image's sha256 and the app's
 * minimum macOS version, so the release writes the same file every time.
 * Test first: writes the whole cask for a version and its sha256.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	caskText,
	caskVersion,
	homebrewMacosName,
	minimumSystemVersion,
	sha256File,
} from "./cask.ts";

const SHA = "ef453d802286b5f47fb090ce48f7159cb2dc075092f87796623746c63069767b";

test("writes the whole cask for a version and its sha256", () => {
	expect(caskText({ version: "0.3.2", sha256: SHA, minimumMacos: "10.13" })).toBe(
		`cask "conducted" do
  version "0.3.2"
  sha256 "${SHA}"

  url "https://github.com/jahala/conducted/releases/download/v#{version}/Conducted.dmg"
  name "Conducted"
  desc "Run coding agents in parallel, each in its own git worktree"
  homepage "https://jahala.github.io/conducted/"

  depends_on arch: :arm64
  depends_on macos: ">= :high_sierra"

  app "Conducted.app"

  auto_updates true

  zap trash: [
    "~/Library/Application Support/build.conducted.app",
    "~/Library/Caches/build.conducted.app",
    "~/Library/Preferences/build.conducted.app.plist",
    "~/Library/WebKit/build.conducted.app",
    "~/.conducted",
  ]
end
`,
	);
});

test("names the minimum macOS version the way Homebrew does", () => {
	expect(homebrewMacosName("10.13")).toBe("high_sierra");
	expect(homebrewMacosName("11")).toBe("big_sur");
	expect(homebrewMacosName("14.1")).toBe("sonoma");
	expect(homebrewMacosName("26.0")).toBe("tahoe");
	expect(homebrewMacosName("10.12")).toBeNull();
});

test("reads the config's minimum macOS version, else Tauri's 10.13 default", () => {
	expect(minimumSystemVersion({ bundle: { macOS: { minimumSystemVersion: "14.0" } } })).toBe(
		"14.0",
	);
	expect(minimumSystemVersion({ bundle: { macOS: {} } })).toBe("10.13");
	expect(minimumSystemVersion({})).toBe("10.13");
});

test("hashes the disk image the release published", () => {
	const folder = mkdtempSync(join(tmpdir(), "conducted-cask-"));
	try {
		const file = join(folder, "Conducted.dmg");
		writeFileSync(file, "conducted\n");
		expect(sha256File(file)).toBe(SHA);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("accepts a stable tag or version and refuses a pre-release", () => {
	expect(caskVersion("v0.3.2")).toBe("0.3.2");
	expect(caskVersion("0.3.2")).toBe("0.3.2");
	expect(caskVersion("v0.3.3-rc.1")).toBeNull();
	expect(caskVersion("release")).toBeNull();
});
