/**
 * @feature CLOUD-04 Sandbox image with git, gh, the agent programs and our sidecar
 * Tests the package allow-list the sandbox's network handler uses for setup scripts.
 */
import { describe, expect, test } from "bun:test";
import {
	isPackageRegistryHost,
	PACKAGE_REGISTRY_HOSTS,
} from "../../apps/cloud/sandbox/package-allow-list.ts";

describe("CLOUD-04 the setup-script package allow-list", () => {
	test("CLOUD-04 the list is lowercase host names with no scheme, port or path", () => {
		for (const host of PACKAGE_REGISTRY_HOSTS) {
			expect(host).toBe(host.toLowerCase());
			expect(host).not.toContain("://");
			expect(host).not.toContain("/");
			expect(host).not.toContain(":");
		}
		expect(new Set(PACKAGE_REGISTRY_HOSTS).size).toBe(PACKAGE_REGISTRY_HOSTS.length);
	});

	test("CLOUD-04 the list is sorted, so a new host has one place to go", () => {
		expect([...PACKAGE_REGISTRY_HOSTS].sort()).toEqual([...PACKAGE_REGISTRY_HOSTS]);
	});

	test("CLOUD-04 the common package managers' official hosts are allowed", () => {
		for (const host of [
			"registry.npmjs.org",
			"pypi.org",
			"files.pythonhosted.org",
			"index.crates.io",
			"static.crates.io",
			"rubygems.org",
			"proxy.golang.org",
			"sum.golang.org",
			"repo.maven.apache.org",
			"api.nuget.org",
			"repo.packagist.org",
			"deb.debian.org",
			"security.debian.org",
		]) {
			expect(isPackageRegistryHost(host)).toBe(true);
		}
	});

	test("CLOUD-04 any other host is refused, including a look-alike suffix", () => {
		for (const host of [
			"example.com",
			"registry.npmjs.org.example.com",
			"evil-registry.npmjs.org",
			"",
		]) {
			expect(isPackageRegistryHost(host)).toBe(false);
		}
	});

	test("CLOUD-04 matching ignores case and a trailing root dot", () => {
		expect(isPackageRegistryHost("REGISTRY.NPMJS.ORG")).toBe(true);
		expect(isPackageRegistryHost("registry.npmjs.org.")).toBe(true);
	});
});
