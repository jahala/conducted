/**
 * @feature GIT-16 Explain a blocked git (Xcode licence) and offer the fix
 * Owns: the one check at app start that asks whether the Xcode licence blocks command-line tools,
 * and the notice it shows: "Xcode license is not accepted" for 15 seconds with "Run for me".
 * Behaviour: services-map.md 5A.8.1 (the "Run for me" action), ui-map.md 7.4 (toasts), inventory
 * toast row 531 (title, description, 15 seconds, action), coverage/inventory-controls.md.
 * Must handle: an accepted licence (no notice); a probe that cannot run (one log line, no notice);
 * a toast closed by the user and a later start (the stable id replaces it rather than stacking);
 * the fix failing (a plain error toast, never silence).
 * Our design choice: the check runs once when the app shell mounts, as Conductor does at start,
 * and the action opens Terminal through the system service.
 * Test first: a blocked probe shows the toast with "Run for me", and the action runs the accept
 * command in Terminal.
 */
import { useEffect } from "react";
import { useServices } from "../core/context.tsx";
import { xcodeLicenseToast } from "../core/git/runner.ts";
import { checkXcodeLicense, xcodeLicenseToastOptions } from "../core/git/xcode-license.ts";
import { toast, toastError } from "../ui/Toast.tsx";

const FIX_FAILED_TITLE = "Couldn't open Terminal to accept the Xcode license";

/** Mount once at the app root. Renders nothing; the notice is a toast. */
export function XcodeLicenseNotice(): null {
	const { platform, actions } = useServices();

	useEffect(() => {
		let current = true;

		const logProbeFailure = (cause: unknown): void => {
			const message = cause instanceof Error ? cause.message : String(cause);
			platform.app.writeLog("warn", "Could not check the Xcode license", { message });
		};

		const runFix = async (): Promise<void> => {
			try {
				const fixed = await actions.app.runXcodeLicenseFix();
				if (!fixed.ok) toastError(FIX_FAILED_TITLE, fixed.error);
			} catch (cause) {
				const message = cause instanceof Error ? cause.message : String(cause);
				toastError(FIX_FAILED_TITLE, { message });
			}
		};

		const probe = async (): Promise<void> => {
			try {
				const blocked = await checkXcodeLicense(platform.shell, platform.fs.paths.home);
				if (!current) return;
				if (!blocked.ok) {
					logProbeFailure(blocked.error);
					return;
				}
				if (!blocked.value) return;
				toast.error(
					xcodeLicenseToast().message,
					xcodeLicenseToastOptions(() => {
						void runFix();
					}),
				);
			} catch (cause) {
				logProbeFailure(cause);
			}
		};

		void probe();
		return () => {
			current = false;
		};
	}, [platform, actions]);

	return null;
}
