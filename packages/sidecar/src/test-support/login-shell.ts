/**
 * @feature test support A real login-shell capture over a scripted shell
 * Owns: `loginShellOver`, the real `LoginShellEnvProvider` whose login shell is scripted to print
 * the given variables. Only the process is replaced, so a test gets the real parsing, the real
 * removal of provider keys into `providerSecrets` and the real cache.
 * Behaviour: not applicable, test support only.
 * Must handle: a provider key among the variables (kept apart, as the real capture does).
 * Test first: login-shell.test.ts, "keeps a provider key out of the environment".
 */
import { ok } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import { LoginShellEnvProvider, type ShellEnvProvider } from "../shell-env/capture.ts";

/** The login-shell capture of a shell whose environment is `variables`. */
export function loginShellOver(
	variables: Readonly<Record<string, string>>,
	logger: Logger,
): ShellEnvProvider {
	let markers = 0;
	return new LoginShellEnvProvider({
		spawnText: async (command) => {
			const marker = /printf '%s' '([^']+)'/.exec(command.args.join(" "))?.[1] ?? "";
			const body = Object.entries(variables)
				.map(([name, value]) => `${name}=${value}`)
				.join("\0");
			return ok(`${marker}${body}\0${marker}`);
		},
		shellPath: "/bin/zsh",
		newMarker: () => `marker-${++markers}`,
		logger,
	});
}
