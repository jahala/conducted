/**
 * @feature CLOUD-17 Cloud settings page
 * Tests the personal cloud settings: the shape a save accepts, the names a user may not set, and
 * the environment an identity and the variables become in a sandbox start.
 * Test first: a reserved name is refused, and an identity becomes git's four names.
 */
import { describe, expect, it } from "vitest";
import {
	CLOUD_PROVIDER_KEY_NAMES,
	cloudEnvVarNameProblem,
	cloudSettingsEnv,
	emptyCloudSettings,
	MAX_CLOUD_ENV_VARS,
	parseCloudSettings,
	RESERVED_CLOUD_ENV_NAMES,
} from "./settings.ts";

describe("CLOUD-17 cloud settings", () => {
	it("takes a git identity and personal variables", () => {
		const parsed = parseCloudSettings({
			gitIdentity: { name: "Sam Rivera", email: "sam@example.com" },
			envVars: { NODE_ENV: "development", API_URL: "https://api.example.com" },
		});
		expect(parsed).toEqual({
			gitIdentity: { name: "Sam Rivera", email: "sam@example.com" },
			envVars: { NODE_ENV: "development", API_URL: "https://api.example.com" },
		});
	});

	it("takes no identity at all", () => {
		expect(parseCloudSettings({ gitIdentity: null, envVars: {} })).toEqual(emptyCloudSettings());
	});

	it("refuses a name the sandbox sets itself", () => {
		expect(RESERVED_CLOUD_ENV_NAMES.has("PATH")).toBe(true);
		expect(parseCloudSettings({ gitIdentity: null, envVars: { PATH: "/tmp" } })).toBeNull();
		expect(parseCloudSettings({ gitIdentity: null, envVars: { GIT_AUTHOR_NAME: "x" } })).toBeNull();
		expect(parseCloudSettings({ gitIdentity: null, envVars: { CONDUCTED_LOG_DIR: "/tmp" } })).toBe(
			null,
		);
	});

	it("refuses a provider key, because the Worker holds it and never gives it to the sandbox", () => {
		expect(CLOUD_PROVIDER_KEY_NAMES.has("ANTHROPIC_API_KEY")).toBe(true);
		expect(parseCloudSettings({ gitIdentity: null, envVars: { ANTHROPIC_API_KEY: "sk-x" } })).toBe(
			null,
		);
	});

	it("refuses a name that is not a shell name, and too many variables", () => {
		expect(cloudEnvVarNameProblem("not a name")).toBe(
			"Variable names may only contain letters, numbers, and underscores.",
		);
		const many = Object.fromEntries(
			Array.from({ length: MAX_CLOUD_ENV_VARS + 1 }, (_, index) => [`VAR_${index}`, "x"]),
		);
		expect(parseCloudSettings({ gitIdentity: null, envVars: many })).toBeNull();
	});

	it("turns an identity into git's author and committer environment", () => {
		expect(
			cloudSettingsEnv({
				gitIdentity: { name: "Sam Rivera", email: "sam@example.com" },
				envVars: { NODE_ENV: "test" },
			}),
		).toEqual({
			NODE_ENV: "test",
			GIT_AUTHOR_NAME: "Sam Rivera",
			GIT_AUTHOR_EMAIL: "sam@example.com",
			GIT_COMMITTER_NAME: "Sam Rivera",
			GIT_COMMITTER_EMAIL: "sam@example.com",
		});
	});

	it("never hands over a name it would refuse on save", () => {
		expect(
			cloudSettingsEnv({ gitIdentity: null, envVars: { PATH: "/tmp", NODE_ENV: "test" } }),
		).toEqual({ NODE_ENV: "test" });
	});
});
