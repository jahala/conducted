/**
 * The CI release's credential edge (PLAT-37): every secret comes from the environment, and a
 * missing or empty one stops the run with its name. All missing names are reported together, so
 * one run says every secret to set, and CI never makes a signed-but-not-notarised build.
 */

/** Every secret the release workflow reads, in the order the workflow names them. */
export const RELEASE_SECRETS = [
	"APPLE_CERTIFICATE_P12",
	"APPLE_CERTIFICATE_PASSWORD",
	"APPLE_SIGNING_IDENTITY",
	"APPLE_API_KEY_P8",
	"APPLE_API_KEY_ID",
	"APPLE_API_ISSUER",
	"TAURI_SIGNING_PRIVATE_KEY",
	"TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
] as const;

export type ReleaseSecret = (typeof RELEASE_SECRETS)[number];

/**
 * The secrets the build step itself reads. The certificate and its password are read only by the
 * workflow's keychain step, and the API key's `.p8` reaches the build as the `APPLE_API_KEY` file.
 */
export const BUILD_SECRETS: readonly ReleaseSecret[] = [
	"APPLE_SIGNING_IDENTITY",
	"APPLE_API_KEY_ID",
	"APPLE_API_ISSUER",
	"TAURI_SIGNING_PRIVATE_KEY",
	"TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
];

/** The secrets an environment does not provide, in the order given. */
export function missingReleaseSecrets(
	env: Readonly<Record<string, string | undefined>>,
	needed: readonly ReleaseSecret[] = RELEASE_SECRETS,
): ReleaseSecret[] {
	return needed.filter((name) => (env[name] ?? "").trim() === "");
}

if (import.meta.main) {
	const missing = missingReleaseSecrets(process.env);
	for (const name of missing) console.error(`Missing release credential: ${name}.`);
	if (missing.length > 0) process.exit(1);
}
