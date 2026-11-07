/**
 * @feature SET-02 Git settings page
 * Owns: the Git page of Settings: user-wide defaults for branches, pull requests and archiving.
 * Per-repository settings (the remote, overrides) are on the repository Misc page (RepoMiscPage).
 * Behaviour: ui-map.md 6, "Git" table. The page follows Conductor's git tab (renderApp): "Open pull
 * requests in", "Include link to workspace in PR description", "Branch name prefix" as three radios
 * ("GitHub username (<login>)", "Custom" with its field, placeholder "e.g. feature/ or myname-", and
 * "Preview: <prefix>tokyo", and "None"), then the rename, archive, merge and stack rows. Rows come
 * from the settings registry (SET-01). Conductor's "Remote origin" is a repository setting, so it is
 * not on this page.
 * "Open pull requests in" has its 180 px picker under the title; "Delete branch on archive" links
 * "configure it on GitHub" to GitHub's page and warns in red while it is on.
 * Must handle: a GitHub username prefix while `gh` is signed out (the radio names no login); a save
 * that fails (the row shows the message and the stored value stays).
 * Test first: previews a custom branch prefix ("feature/" previews "feature/tokyo").
 */
import { type ReactNode, useEffect, useState } from "react";
import { useGitHubAccess, useSetting } from "../../../core/hooks.ts";
import { getSettingDef } from "../../../core/registries/settings.ts";
import { Input } from "../../../ui/Input.tsx";
import { ExternalLink } from "../../chat/ExternalLink.tsx";
import { RegistrySettingRowByKey, type RowLayout, useSettingSaves } from "../SettingRow.tsx";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";

/** The registry rows of the page, in Conductor's order, around the branch prefix radios. */
const BEFORE_PREFIX = ["pull_request_open_target", "include_workspace_link_in_pr"] as const;
const AFTER_PREFIX = [
	"auto_rename_new_branches",
	"auto_rename_workspace_on_branch_name_set",
	"delete_branch_on_archive",
	"archive_on_merge",
	"automerge_enabled",
	"treat_optional_checks_as_blocking",
	"github_stacked_prs_enabled",
] as const;

/** GitHub's page on deleting a pull request's branch after its merge, which Conductor links to. */
const GITHUB_BRANCH_DELETION_URL =
	"https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches";

/** Rows laid out as Conductor's git tab has them, where its page component differs. */
const LAYOUTS: Readonly<Record<string, RowLayout>> = {
	// The picker sits under its title, 180 px wide.
	pull_request_open_target: { stacked: true, selectClassName: "w-[180px]" },
	// Two lines, the second linking to GitHub's own branch deletion setting.
	delete_branch_on_archive: {
		description: (
			<>
				<p>Delete the local branch when archiving a workspace.</p>
				<p>
					To delete the remote branch,{" "}
					<ExternalLink
						url={GITHUB_BRANCH_DELETION_URL}
						title="configure it on GitHub"
						className="underline hover:text-fg"
					>
						configure it on GitHub
					</ExternalLink>
					.
				</p>
			</>
		),
	},
};

/** Conductor warns under the switch while archiving deletes the branch. */
const extraFor = (key: string, value: unknown): ReactNode =>
	key === "delete_branch_on_archive" && value === true ? (
		<p className="mt-1 text-xs text-danger">Warning: archived workspaces will be unrecoverable</p>
	) : null;

function BranchPrefixRow({ focusSettingKey }: { focusSettingKey: string | null }) {
	const key = "branch_prefix_type";
	const def = getSettingDef(key);
	const saves = useSettingSaves();
	const type = useSetting<string>(key);
	const custom = useSetting<string>("branch_prefix_custom");
	const access = useGitHubAccess();
	const login =
		access.state === "ready" && access.data.state === "signed_in" ? access.data.login : null;
	const [draft, setDraft] = useState(custom);
	useEffect(() => setDraft(custom), [custom]);

	const commit = () => {
		if (draft === custom) return;
		void saves.save("branch_prefix_custom", draft).then((saved) => {
			if (!saved) setDraft(custom);
		});
	};
	const radio = (value: string, label: string) => (
		<label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
			<input
				type="radio"
				name="branch-prefix"
				value={value}
				checked={type === value}
				onChange={() => void saves.save(key, value)}
				className="size-4 accent-fg focus-visible:outline-2 focus-visible:outline-focus"
			/>
			{label}
		</label>
	);

	return (
		<div
			id={`setting-${key}`}
			data-setting-key={key}
			data-highlighted={focusSettingKey === key ? "true" : undefined}
			className="flex flex-col gap-3 border-t border-border py-5"
		>
			<div className="flex flex-col">
				<p className="text-sm font-medium text-fg">{def?.title ?? "Branch name prefix"}</p>
				<p className="mt-0.5 text-sm text-fg-muted">{def?.description}</p>
			</div>
			<fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
				<legend className="sr-only">{def?.title ?? "Branch name prefix"}</legend>
				{radio(
					"github_username",
					login === null ? "GitHub username" : `GitHub username (${login})`,
				)}
				{radio("custom", "Custom")}
				{type === "custom" ? (
					<div className="flex flex-col gap-1 pl-6">
						<Input
							aria-label="Custom branch prefix"
							value={draft}
							placeholder="e.g. feature/ or myname-"
							className="w-64"
							onChange={(event) => setDraft(event.target.value)}
							onBlur={commit}
							onKeyDown={(event) => {
								if (event.key === "Enter") commit();
							}}
						/>
						{custom === "" ? null : <p className="text-xs text-fg-muted">Preview: {custom}tokyo</p>}
					</div>
				) : null}
				{radio("none", "None")}
			</fieldset>
			{(saves.errorOf(key) ?? saves.errorOf("branch_prefix_custom")) ? (
				<p role="alert" className="text-xs text-danger">
					{saves.errorOf(key) ?? saves.errorOf("branch_prefix_custom")}
				</p>
			) : null}
		</div>
	);
}

export function GitPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	const row = (key: string) => (
		<RegistrySettingRowByKey
			key={key}
			settingKey={key}
			focusSettingKey={focusSettingKey}
			extraFor={(def, value) => extraFor(def.key, value)}
			{...(LAYOUTS[key] === undefined ? {} : { layout: LAYOUTS[key] })}
		/>
	);
	return (
		<SettingsPageFrame title="Git" description={null} {...load} focusSettingKey={focusSettingKey}>
			{BEFORE_PREFIX.map(row)}
			<BranchPrefixRow focusSettingKey={focusSettingKey} />
			{AFTER_PREFIX.map(row)}
		</SettingsPageFrame>
	);
}
