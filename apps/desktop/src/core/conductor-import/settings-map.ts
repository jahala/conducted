/**
 * @feature APP-17 Which of Conductor's database settings come over, by a written key map
 * Owns: `CONDUCTOR_SETTING_KEYS`, the Conductor `settings` keys whose meaning matches one of ours,
 * `CONDUCTOR_SETTINGS_KEPT_BACK`, the matching keys the import still leaves behind with the reason,
 * and `mapConductorSetting`, which turns one row into our key and value or the reason it stays.
 * Behaviour: docs/research/conductor/services-map.md 4.2.1 (after Conductor's file migration it
 * reads only keys that are not file-backed from its database), 4.2.3 (the registry of keys) and
 * 4.2.4 (the file-backed keys). Our registry is apps/desktop/src/core/registries/settings.ts, which
 * took Conductor's key names where it matches Conductor.
 * Must handle: a row Conductor marked deprecated; a key Conductor reads from its settings.toml, so
 * its database row is stale; a key we keep in our settings.toml, so our table would ignore it; a
 * value our registry refuses; the follow-up mode's other words (`steering`, `queued`).
 * Our design choice: the map lists only keys that both apps keep in their database. A key that is
 * file-backed on either side stays behind, with its reason, because moving it would write a
 * settings file the plan does not name (D124).
 * Test first: default_message_send_mode "queued" maps to our "queue".
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import {
	coerceSettingValue,
	getSettingDef,
	type SettingKey,
	type SettingValue,
} from "../registries/settings.ts";

export interface SettingMapping {
	key: SettingKey;
	/** Conductor's stored word to ours, where the two differ. */
	values?: Readonly<Record<string, string>>;
}

const same = (key: SettingKey): SettingMapping => ({ key });

/**
 * Conductor keys that both apps keep in their database, with the same meaning. Each one has the
 * same name in our registry.
 */
export const CONDUCTOR_SETTING_KEYS: Readonly<Record<string, SettingMapping>> = {
	always_allow_local_execution: same("always_allow_local_execution"),
	always_show_context_wheel: same("always_show_context_wheel"),
	artifacts_tab_enabled: same("artifacts_tab_enabled"),
	auto_convert_long_text: same("auto_convert_long_text"),
	auto_rename_new_branches: same("auto_rename_new_branches"),
	auto_rename_workspace_on_branch_name_set: same("auto_rename_workspace_on_branch_name_set"),
	auto_restart_on_update_when_idle: same("auto_restart_on_update_when_idle"),
	auto_sync_files_in_new_cloud_workspaces: same("auto_sync_files_in_new_cloud_workspaces"),
	automerge_enabled: same("automerge_enabled"),
	big_terminal_custom_commands: same("big_terminal_custom_commands"),
	big_terminal_preset: same("big_terminal_preset"),
	caffeinate_while_agents_running: same("caffeinate_while_agents_running"),
	chrome_mode_enabled: same("chrome_mode_enabled"),
	code_theme: same("code_theme"),
	color_vision: same("color_vision"),
	colored_sidebar_diffs: same("colored_sidebar_diffs"),
	dashboard_enabled: same("dashboard_enabled"),
	// The registry's design choice: our words are steer and queue.
	default_message_send_mode: {
		key: "default_message_send_mode",
		values: { steering: "steer", queued: "queue" },
	},
	default_open_in: same("default_open_in"),
	experimental_auto_permission_mode: same("experimental_auto_permission_mode"),
	experimental_big_terminal_mode: same("experimental_big_terminal_mode"),
	experimental_configurable_center_panel: same("experimental_configurable_center_panel"),
	experimental_fork_to_new_tab: same("experimental_fork_to_new_tab"),
	experimental_in_app_browser_preview: same("experimental_in_app_browser_preview"),
	experimental_new_workspace_page: same("experimental_new_workspace_page"),
	experimental_show_agent_cost: same("experimental_show_agent_cost"),
	experimental_sidebar_transparency: same("experimental_sidebar_transparency"),
	experimental_tab_freak_mode: same("experimental_tab_freak_mode"),
	file_ligatures_enabled: same("file_ligatures_enabled"),
	garry_mode: same("garry_mode"),
	gh_auth_method: same("gh_auth_method"),
	github_stacked_prs_enabled: same("github_stacked_prs_enabled"),
	graphite_disabled: same("graphite_disabled"),
	hide_whitespace_changes: same("hide_whitespace_changes"),
	internal_remote_local_execution_mcp: same("internal_remote_local_execution_mcp"),
	internal_workspace_status_matrix: same("internal_workspace_status_matrix"),
	last_clone_directory: same("last_clone_directory"),
	left_panel_visible: same("left_panel_visible"),
	left_panel_width: same("left_panel_width"),
	local_env_vars_import_banner_dismissed: same("local_env_vars_import_banner_dismissed"),
	local_git_forge_enabled: same("local_git_forge_enabled"),
	low_contrast_dark_mode: same("low_contrast_dark_mode"),
	manual_workspace_order: same("manual_workspace_order"),
	markdown_style: same("markdown_style"),
	message_send_key: same("message_send_key"),
	mono_font: same("mono_font"),
	not_absolutely_right: same("not_absolutely_right"),
	notifications_enabled: same("notifications_enabled"),
	open_in_mru_order: same("open_in_mru_order"),
	pr_activity_sort_order: same("pr_activity_sort_order"),
	pull_request_open_target: same("pull_request_open_target"),
	remote_control_keep_awake: same("remote_control_keep_awake"),
	right_panel_visible: same("right_panel_visible"),
	sidebar_group_by: same("sidebar_group_by"),
	sidebar_resource_usage: same("sidebar_resource_usage"),
	sidebar_sort_by: same("sidebar_sort_by"),
	sound_type: same("sound_type"),
	terminal_font_family: same("terminal_font_family"),
	terminal_font_size: same("terminal_font_size"),
	terminal_scrollback_limit_bytes: same("terminal_scrollback_limit_bytes"),
	treat_optional_checks_as_blocking: same("treat_optional_checks_as_blocking"),
	unstarted_workspaces_enabled: same("unstarted_workspaces_enabled"),
	using_split_view: same("using_split_view"),
	voice_mode: same("voice_mode"),
	wrap_lines: same("wrap_lines"),
	zoom_level_v2: same("zoom_level_v2"),
};

/** Keys both apps have that the import still leaves behind, each with the reason. */
export const CONDUCTOR_SETTINGS_KEPT_BACK: Readonly<Record<string, string>> = {
	onboarding_step: "Where Conductor's first-run steps stopped; Conducted has its own steps.",
	last_seen_announcement: "Names Conductor's announcements, which Conducted does not show.",
	keybinding_overrides_v1:
		"Names Conductor's command ids, which are not checked against Conducted's yet.",
	sidebar_repo_filter: "Holds Conductor's project ids; set the filter again in the sidebar.",
	conductor_root_path:
		"Conducted keeps its own folder for repositories and workspaces (Settings, Advanced).",
};

/** Conductor's settings.toml keys (services-map.md 4.2.4), by their settings key. */
const CONDUCTOR_FILE_BACKED: ReadonlySet<string> = new Set([
	"default_model",
	"review_model",
	"default_fast_mode",
	"review_fast_mode",
	"default_plan_mode",
	"default_codex_thinking_level",
	"review_codex_thinking_level",
	"default_codex_personality",
	"codex_tool_approval_policy",
	"default_claude_personality",
	"default_claude_effort_level",
	"review_claude_effort_level",
	"visible_provider_models",
	"tool_approvals_enabled",
	"setup_script",
	"run_script",
	"archive_script",
	"run_script_mode",
	"auto_run_after_setup",
	"environment_variable_files",
	"enterprise_data_privacy",
	"file_include_globs",
	"spotlight_testing",
	"custom_prompt_code_review",
	"custom_prompt_create_pr",
	"custom_prompt_fix_errors",
	"custom_prompt_resolve_merge_conflicts",
	"custom_prompt_rename_branch",
	"custom_prompt_general",
	"claude_executable_path",
	"codex_executable_path",
	"opencode_executable_path",
	"claude_provider",
	"codex_provider",
	"bedrock_region",
	"vertex_project_id",
	"ssh_key_path",
	"delete_branch_on_archive",
	"archive_on_merge",
	"worktree_push_auto_setup_remote",
	"branch_prefix_type",
	"branch_prefix_custom",
	"open_url_template",
]);

export type MappedSetting =
	| { kind: "mapped"; key: SettingKey; value: SettingValue }
	| { kind: "left_out"; reason: string };

/** One Conductor `settings` row as our key and value, or the reason it stays behind. */
export function mapConductorSetting(row: {
	key: string;
	value: string | null;
	deprecated_at: string | null;
}): MappedSetting {
	if (row.deprecated_at !== null) {
		return { kind: "left_out", reason: "Conductor no longer reads this row." };
	}
	const keptBack = CONDUCTOR_SETTINGS_KEPT_BACK[row.key];
	if (keptBack !== undefined) return { kind: "left_out", reason: keptBack };
	if (CONDUCTOR_FILE_BACKED.has(row.key)) {
		return {
			kind: "left_out",
			reason:
				"Conductor reads this setting from ~/.conductor/settings.toml, so this database row is not the value it uses.",
		};
	}
	const mapping = CONDUCTOR_SETTING_KEYS[row.key];
	if (mapping === undefined) {
		return { kind: "left_out", reason: "Conducted has no setting with this meaning." };
	}
	const value = coerced(mapping, row.value);
	return value.ok
		? { kind: "mapped", key: mapping.key, value: value.value }
		: { kind: "left_out", reason: value.error.message };
}

function coerced(mapping: SettingMapping, raw: string | null): Result<SettingValue> {
	const def = getSettingDef(mapping.key);
	if (def === undefined || def.tomlKey !== undefined) {
		return err(
			appError(
				"conductor_setting_file_backed",
				"Conducted keeps this setting in its settings.toml, which the import does not write.",
			),
		);
	}
	if (raw === null) return err(appError("conductor_setting_empty", "Conductor stores no value."));
	const word = mapping.values?.[raw] ?? raw;
	const value = coerceSettingValue(def, word);
	return value.ok
		? ok(value.value)
		: err(appError("conductor_setting_value", "Conducted cannot use the value Conductor stores."));
}
