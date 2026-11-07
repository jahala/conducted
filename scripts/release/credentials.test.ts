/**
 * The CI release reads every credential from the environment. A missing or empty value names the
 * variable, and all missing names are reported together, so one run shows every secret to fix.
 */
import { expect, test } from "bun:test";
import { BUILD_SECRETS, missingReleaseSecrets, RELEASE_SECRETS } from "./credentials.ts";

const complete = Object.fromEntries(
	RELEASE_SECRETS.map((name) => [name, `value-of-${name}`]),
) as Record<string, string>;

test("reports nothing when every release credential is set", () => {
	expect(missingReleaseSecrets(complete)).toEqual([]);
});

test("reports each missing credential by name", () => {
	expect(RELEASE_SECRETS.length).toBeGreaterThan(0);
	for (const name of RELEASE_SECRETS) {
		const without = { ...complete };
		delete without[name];
		expect(missingReleaseSecrets(without)).toEqual([name]);
	}
});

test("reports every missing credential in one answer, in the list's order", () => {
	const without = { ...complete };
	delete without.APPLE_CERTIFICATE_P12;
	delete without.APPLE_API_KEY_ID;
	delete without.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;

	expect(missingReleaseSecrets(without)).toEqual([
		"APPLE_CERTIFICATE_P12",
		"APPLE_API_KEY_ID",
		"TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
	]);
});

test("an empty value counts as missing", () => {
	expect(missingReleaseSecrets({ ...complete, APPLE_SIGNING_IDENTITY: "  " })).toEqual([
		"APPLE_SIGNING_IDENTITY",
	]);
});

test("the build step does not need the certificate, which only the keychain step reads", () => {
	const withoutCertificate = { ...complete };
	delete withoutCertificate.APPLE_CERTIFICATE_P12;
	delete withoutCertificate.APPLE_CERTIFICATE_PASSWORD;

	expect(missingReleaseSecrets(withoutCertificate, BUILD_SECRETS)).toEqual([]);
	expect(missingReleaseSecrets(withoutCertificate)).toEqual([
		"APPLE_CERTIFICATE_P12",
		"APPLE_CERTIFICATE_PASSWORD",
	]);
});
