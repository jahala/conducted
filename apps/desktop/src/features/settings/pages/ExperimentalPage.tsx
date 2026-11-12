/**
 * @feature SET-02 Experimental settings page
 * Owns: the Experimental page of Settings: switches for features that are still changing, under
 * Conductor's subtitle and in its order (renderApp, the experimental tab): Auto permission mode
 * first, its text followed by "Learn more" (Claude's page on auto mode, the registry's learnMoreUrl), and Graphite stack support
 * last. Ours sit beside their kin (D098): the big terminal's
 * preset and command list after Big terminal mode, Unstarted workspaces after New workspace page.
 * Behaviour: ui-map.md 6, "Experimental" table; services-map.md 4.1.5 and 4.2.3 (experimental
 * keys). Rows come from the settings registry (SET-01). "Auto-run after setup" is on this page as a user
 * setting, as Conductor has it (services-map.md 4.2.3); a repository's own value is set on its
 * Scripts page.
 * Must handle: a setting that needs a restart (says so after it is turned on); "Graphite stack
 * support" without the `gt` program (the switch reads off and cannot change, and the row says
 * "Install gt to enable.", as Conductor's does, renderApp @11110873); a check for `gt` that could
 * not run (the row says why and the switch cannot change).
 * Our design choice: the `gt` check runs from the home folder, because no repository is in view on
 * this page. Conductor's own check takes no folder.
 * Test first: turning on "Sidebar transparency" shows the restart note.
 */
import { useEffect, useState } from "react";
import { useServices } from "../../../core/context.tsx";
import { useSetting } from "../../../core/hooks.ts";
import { BigTerminalSettings } from "../../terminal/BigTerminalSettings.tsx";
import { RegistrySettingRows } from "../SettingRow.tsx";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";

export function ExperimentalPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	const transparency = useSetting<boolean>("experimental_sidebar_transparency");
	const gt = useGtInstalled();

	return (
		<SettingsPageFrame
			title="Experimental"
			description={
				<>
					Experimental features that are under development.{" "}
					<span className="font-medium">Expect breaking changes.</span>
				</>
			}
			{...load}
			focusSettingKey={focusSettingKey}
		>
			<RegistrySettingRows
				page="experimental"
				focusSettingKey={focusSettingKey}
				exclude={["big_terminal_preset", "big_terminal_custom_commands"]}
				unavailableFor={(def) => (def.key === "graphite_disabled" ? gtUnavailable(gt) : null)}
				extraFor={(def) =>
					def.key === "experimental_sidebar_transparency" && transparency ? (
						<p role="status" className="text-xs text-fg-muted">
							Quit and reopen the app to apply sidebar transparency.
						</p>
					) : null
				}
			/>
			<BigTerminalSettings focusSettingKey={focusSettingKey} />
		</SettingsPageFrame>
	);
}

type GtCheck =
	| { state: "checking" }
	| { state: "done"; installed: boolean }
	| { state: "failed"; message: string };

/** Whether the `gt` program can run. Only the answer of the mounted page is kept. */
function useGtInstalled(): GtCheck {
	const { services, platform } = useServices();
	const [check, setCheck] = useState<GtCheck>({ state: "checking" });
	useEffect(() => {
		let current = true;
		void services.graphite.installed(platform.fs.paths.home).then((result) => {
			if (!current) return;
			setCheck(
				result.ok
					? { state: "done", installed: result.value }
					: { state: "failed", message: result.error.message },
			);
		});
		return () => {
			current = false;
		};
	}, [services, platform]);
	return check;
}

function gtUnavailable(check: GtCheck) {
	if (check.state === "failed") return `Couldn't check for gt: ${check.message}`;
	if (check.state === "done" && !check.installed) {
		return (
			<>
				Install <code className="font-mono">gt</code> to enable.
			</>
		);
	}
	return null;
}
