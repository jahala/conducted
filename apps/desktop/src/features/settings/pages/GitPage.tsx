/**
 * @feature SET-02 Git settings page
 * Owns: the Git page of Settings: user-wide defaults for branches, pull requests and archiving.
 * Per-repository overrides are on the repository Misc page (RepoMiscPage).
 * Behaviour: ui-map.md 6, "Git" table. Rows come from the settings registry (SET-01). The branch
 * prefix rows show the branch name they produce so the user sees the effect before a workspace
 * exists.
 * Must handle: a GitHub username prefix while `gh` is signed out (the preview names the missing
 * username instead of inventing one).
 * Test first: choosing "Custom text" with the text "feature/" shows the preview "feature/<name>".
 */
import { useGitHubAccess, useSetting } from "../../../core/hooks.ts";
import { RegistrySettingRows } from "../SettingRow.tsx";
import { SettingsPageFrame } from "../SettingsPageFrame.tsx";

export function GitPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const prefixType = useSetting<string>("branch_prefix_type");
	const access = useGitHubAccess();
	const login =
		access.state === "ready" && access.data.state === "signed_in" ? access.data.login : null;

	const preview = (defKey: string, value: unknown): string | null => {
		if (defKey === "branch_prefix_type" && prefixType === "github_username") {
			return login === null ? "Sign in with gh to use your GitHub username." : `${login}/<name>`;
		}
		if (defKey === "branch_prefix_custom" && prefixType === "custom") {
			const text = typeof value === "string" ? value : "";
			return `${text}<name>`;
		}
		return null;
	};

	return (
		<SettingsPageFrame
			title="Git"
			description="Defaults for branches, pull requests and archiving. Each project can override them."
			state="ready"
			errorMessage={null}
			onRetry={() => undefined}
			focusSettingKey={focusSettingKey}
		>
			<RegistrySettingRows
				page="git"
				focusSettingKey={focusSettingKey}
				extraFor={(def, value) => {
					const text = preview(def.key, value);
					if (text === null) return null;
					return (
						<p className="font-mono text-xs text-fg-muted">
							Preview: <span data-testid="branch-prefix-preview">{text}</span>
						</p>
					);
				}}
			/>
		</SettingsPageFrame>
	);
}
