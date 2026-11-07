/**
 * @feature CLOUD-04 Sandbox image with git, gh, the agent programs and our sidecar
 * Owns: the exact host names a setup script may reach to fetch packages, as data for the Worker's
 * outbound handler (CLOUD-05).
 * Behaviour: cloud-and-remote.md Part 1, "Network is closed by default. The outbound allow-list
 * holds GitHub, the model gateway and the package registries the setup script needs", and the
 * spike's finding that npm got 403 inside the sandbox. D102 records this list as our choice: the
 * research names no registries, and Conductor's cloud is not in it.
 * Must handle: a look-alike suffix (`registry.npmjs.org.example.com` is not npm's registry), a
 * mixed-case host, a trailing root dot, and an empty host. Only an exact host name passes; there is
 * no suffix or subdomain match.
 * Our design choice: one flat, sorted list of the official hosts of the common package managers.
 * The Worker still decides which protocols and ports it allows; this module only says which names.
 * Test first: `isPackageRegistryHost("registry.npmjs.org")` is true and
 * `isPackageRegistryHost("registry.npmjs.org.example.com")` is false.
 */

/** The official package hosts, grouped by the manager a setup script would use. */
export interface PackageRegistry {
	name: string;
	hosts: readonly string[];
}

export const PACKAGE_REGISTRIES: readonly PackageRegistry[] = [
	{ name: "npm", hosts: ["registry.npmjs.org", "registry.yarnpkg.com"] },
	{ name: "PyPI", hosts: ["pypi.org", "files.pythonhosted.org"] },
	{ name: "crates.io", hosts: ["index.crates.io", "static.crates.io"] },
	{ name: "RubyGems", hosts: ["rubygems.org"] },
	{ name: "Go modules", hosts: ["proxy.golang.org", "sum.golang.org"] },
	{ name: "Maven Central", hosts: ["repo.maven.apache.org", "repo1.maven.org"] },
	{ name: "NuGet", hosts: ["api.nuget.org"] },
	{ name: "Composer", hosts: ["repo.packagist.org"] },
	{ name: "Debian apt", hosts: ["deb.debian.org", "security.debian.org"] },
];

/** Every allowed host, once, sorted so a new host has one place to go. */
export const PACKAGE_REGISTRY_HOSTS: readonly string[] = [
	...new Set(PACKAGE_REGISTRIES.flatMap((registry) => registry.hosts)),
].sort();

/**
 * True when `host` is exactly one of the allowed package hosts. Case is ignored and one trailing
 * root dot is accepted; a scheme, port, path or subdomain is not.
 */
export function isPackageRegistryHost(host: string): boolean {
	const normalized = host.trim().toLowerCase().replace(/\.$/, "");
	return (
		normalized !== "" &&
		!normalized.includes("/") &&
		!normalized.includes(":") &&
		PACKAGE_REGISTRY_HOSTS.includes(normalized)
	);
}
