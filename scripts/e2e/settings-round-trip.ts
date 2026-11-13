/**
 * @feature End-to-end tests in the real app (issue #564)
 * Owns: the check that every setting and stored choice the user can change survives a restart:
 * change each in the real window, quit the app, start it again over the same folder, and read each
 * back in the window.
 * Behaviour: issue #564 ("change every setting, switch and stored choice, restart, read each back");
 * #549 and #561 (a cloud workspace's Sync files switch fell back to the Advanced setting after a
 * restart, because it lived only in memory). The Sync files step fails on the commit before
 * #561's fix and passes after it.
 * Must handle: settings are listed from the registry (core/registries/settings.ts), so a new
 * setting is covered with no change here: each page's rows are found by `data-setting-key`, and a
 * key no page shows fails the check unless `CONTROLS` says where its control is or `NOT_COVERED`
 * says why it cannot be reached here. A row a change reveals (a choice that shows a field) is
 * changed in a later pass over the same page. A project's settings are stored apart from the
 * user's, so a project's pages are changed as well as the user pages. A control the app disables
 * here (a program it needs is missing) is reported with its reason, not changed.
 * Our design choice: stored choices that live on a workspace, not in the registry, are listed in
 * `workspaceChoices`; the cloud workspace's Sync files switch is the one there today. Not part of
 * this check yet: the registry's hidden `state` settings, which no settings page shows (each is
 * set by its own gesture, such as resizing the sidebar), and the page's browser storage (panel
 * sizes, the open workspace).
 */
import { getSettingDef, SETTINGS } from "../../apps/desktop/src/core/registries/settings.ts";
import {
	REPO_SETTINGS_PAGES,
	USER_SETTINGS_PAGES,
} from "../../apps/desktop/src/features/settings/settings-pages.ts";
import { changeControl, readControl } from "./controls.ts";
import {
	type Browser,
	type Check,
	type CheckContext,
	type RunningApp,
	restart,
	until,
} from "./harness.ts";
import { openRepoSettings, openUserSettings, openWorkspaceByLink } from "./screens.ts";
import { startInWorld, type World } from "./world.ts";

/** How long a row may take to load before a disabled control counts as not changeable. */
const ROW_LOAD_MS = 5_000;

/** Where a change was made and what the window showed after it. */
interface Expected {
	/** For the report: "general: theme" or "atlas/git: remote_name". */
	name: string;
	open(browser: Browser): Promise<void>;
	scope: string;
	value: string;
}

/**
 * Registry settings whose control sits outside a `data-setting-key` row: the page (as `Page.label`
 * names it), the control, and the button that saves it when the page saves on a button rather
 * than on the change. A key here is changed and read back like any row.
 */
export const CONTROLS: Readonly<Record<string, { page: string; scope: string; save?: string }>> = {
	branch_prefix_custom: { page: "git", scope: 'input[aria-label="Custom branch prefix"]' },
	big_terminal_preset: { page: "experimental", scope: '[aria-label="Big terminal settings"]' },
	exclusive_port_forwarding_enabled: {
		page: "connections",
		scope: '[role="switch"][aria-label="Exclusive port forwarding"]',
		save: "button=Save port forwarding settings",
	},
	port_forwarding_strategy: {
		page: "connections",
		scope: '[role="combobox"][aria-label="Forwarding strategy"]',
		save: "button=Save port forwarding settings",
	},
	local_port_range_start: {
		page: "connections",
		scope: "#local-port-range-first",
		save: "button=Save port forwarding settings",
	},
	local_port_range_end: {
		page: "connections",
		scope: "#local-port-range-last",
		save: "button=Save port forwarding settings",
	},
	port_mappings: {
		page: "connections",
		scope: 'textarea[aria-label="Manual overrides"]',
		save: "button=Save port forwarding settings",
	},
	setup_script: { page: "atlas/scripts", scope: "#repo-setup-script" },
	archive_script: { page: "atlas/scripts", scope: "#repo-archive-script" },
	run_script_mode: { page: "atlas/scripts", scope: '[role="combobox"][aria-label="Run mode"]' },
	auto_run_after_setup: {
		page: "atlas/scripts",
		scope: '[role="switch"][aria-label="Start the default action after setup"]',
	},
	spotlight_testing: {
		page: "atlas/actions",
		scope: '[role="switch"][aria-label="Use spotlight testing"]',
	},
};

const NO_MODELS =
	"chosen from the agents' model lists, which stay empty in a fresh folder: Claude Code and Codex are not installed and the sandbox has no network";
const NOT_DRIVEN_YET = "edited in a dialog or list editor this check does not drive yet";

/**
 * Registry settings this check does not change, each with the reason. Each is a gap the report
 * lists; none is a pass.
 */
export const NOT_COVERED: Readonly<Record<string, string>> = {
	default_model: NO_MODELS,
	default_fast_mode: NO_MODELS,
	default_claude_effort_level: NO_MODELS,
	review_model: NO_MODELS,
	review_agent: NO_MODELS,
	review_effort: NO_MODELS,
	review_claude_effort_level: NO_MODELS,
	review_codex_thinking_level: NO_MODELS,
	review_fast_mode: NO_MODELS,
	conductor_root_path: "chosen with the system folder picker, which WebDriver cannot reach",
	environment_variable_files: "added with the system file picker, which WebDriver cannot reach",
	gh_auth_method: `its row is inside the Account page's GitHub sign-in panel; ${NOT_DRIVEN_YET}`,
	claude_provider: `set in the Claude Code provider dialog; ${NOT_DRIVEN_YET}`,
	codex_provider: `set in the Codex provider dialog; ${NOT_DRIVEN_YET}`,
	bedrock_region: `set in the Claude Code provider dialog; ${NOT_DRIVEN_YET}`,
	vertex_project_id: `set in the Claude Code provider dialog; ${NOT_DRIVEN_YET}`,
	big_terminal_custom_commands: `added one command at a time; ${NOT_DRIVEN_YET}`,
	mono_font: `its one other option, "Custom...", asks for a font name; ${NOT_DRIVEN_YET}`,
	run_script: `a named action on the project's Actions page; ${NOT_DRIVEN_YET}`,
	custom_prompt_general: NOT_DRIVEN_YET,
	custom_prompt_code_review: NOT_DRIVEN_YET,
	custom_prompt_create_pr: NOT_DRIVEN_YET,
	custom_prompt_fix_errors: NOT_DRIVEN_YET,
	custom_prompt_resolve_merge_conflicts: NOT_DRIVEN_YET,
	custom_prompt_rename_branch: NOT_DRIVEN_YET,
	open_url_template: `the project's preview URL list; ${NOT_DRIVEN_YET}`,
	file_include_globs: `the project's files-to-copy list; ${NOT_DRIVEN_YET}`,
};

/** Text a field gets when the app checks its value; any other text field gets `e2e-<key>`. */
export function textValues(world: World): Readonly<Record<string, string>> {
	return {
		claude_executable_path: "/bin/echo",
		codex_executable_path: "/bin/echo",
		opencode_executable_path: "/bin/echo",
		ssh_key_path: world.sshKey,
		port_mappings: "3000:4100",
	};
}

const rowScope = (key: string): string => `[data-setting-key="${key}"]`;

/** The registry keys of the rows the page shows now. */
async function rowKeys(browser: Browser): Promise<string[]> {
	const keys = await browser.execute(() =>
		[...document.querySelectorAll("[data-setting-key]")].map(
			(row) => row.getAttribute("data-setting-key") ?? "",
		),
	);
	return keys.filter((key) => getSettingDef(key) !== undefined);
}

interface Page {
	/** "general" for a user page, "<project>/<page>" for a project's. */
	label: string;
	/** "user" or the project's id: a key is one stored value per scope. */
	scope: string;
	open(browser: Browser): Promise<void>;
}

function pagesOf(world: World): Page[] {
	const user = USER_SETTINGS_PAGES.map((page) => ({
		label: page.id,
		scope: "user",
		open: (browser: Browser) => openUserSettings(browser, page.id, page.title),
	}));
	const project = world.projects[0];
	if (project === undefined) throw new Error("The world has no project.");
	const repo = REPO_SETTINGS_PAGES.map((page) => ({
		label: `${project.name}/${page.id}`,
		scope: project.id,
		open: (browser: Browser) => openRepoSettings(browser, project, page),
	}));
	return [...user, ...repo];
}

/** The cloud workspace's status popover, where its Sync files switch is. */
async function openCloudStatus(browser: Browser, world: World): Promise<void> {
	await openWorkspaceByLink(browser, world.cloud.id);
	const open = async () => (await browser.$$('[data-testid="remote-file-sync-button"]')).length > 0;
	if (await open()) return;
	const trigger = await until("the cloud workspace's status button", async () => {
		for (const button of await browser.$$('button[aria-haspopup="dialog"]')) {
			if (((await button.getAttribute("aria-label")) ?? "").includes(" · ")) return button;
		}
		return undefined;
	});
	await trigger.click();
	await until("the Sync files switch", async () => ((await open()) ? true : undefined));
}

/** Stored choices kept on a workspace rather than in the registry. */
function workspaceChoices(world: World): Omit<Expected, "value">[] {
	return [
		{
			name: "cloud workspace: Sync files",
			open: (browser) => openCloudStatus(browser, world),
			scope: '[data-testid="remote-file-sync-button"]',
		},
	];
}

async function change(
	browser: Browser,
	target: Omit<Expected, "value">,
	text: string,
	failures: string[],
	save?: string,
): Promise<Expected | null> {
	try {
		const after = await changeControl(browser, target.scope, text);
		if (save !== undefined) await (await browser.$(save)).click();
		return { ...target, value: after.value };
	} catch (cause) {
		failures.push(`${target.name}: could not change it (${(cause as Error).message})`);
		return null;
	}
}

/**
 * Opens the item's screen and reads what its control shows once it can be used. A control is
 * disabled while its value loads and shows a placeholder value meanwhile (a project's switch shows
 * the setting's default, as Conductor's does), so a read before then would see the placeholder,
 * not the stored value (issue #615). Every item here was changed through its control, so it can be
 * used; one that stays disabled fails with its row's reason.
 */
async function readAgain(browser: Browser, item: Expected): Promise<string> {
	await item.open(browser);
	const reading = await until(`${item.name} usable on its screen`, async () => {
		const found = await readControl(browser, item.scope);
		return found === null || found.disabled ? undefined : found;
	});
	return reading.value;
}

/**
 * Reads each changed value once more, restarts the app, and reads each again. A save that fails
 * can put the old value back without a word after the control showed the new one, so the read
 * before the restart tells a change the app did not keep apart from one the restart lost.
 */
async function restartAndCompare(
	app: RunningApp,
	context: CheckContext,
	expected: readonly Expected[],
	failures: string[],
): Promise<RunningApp> {
	const kept: Expected[] = [];
	for (const item of expected) {
		const reading = await readAgain(app.browser, item);
		if (reading === item.value) kept.push(item);
		else
			failures.push(
				`${item.name}: showed "${item.value}", then "${reading}" before any restart: the app did not keep the change`,
			);
	}
	context.log(`  changed ${kept.length} values; restarting`);
	const restarted = await restart(app, context.tracker);
	for (const item of kept) {
		try {
			const reading = await readAgain(restarted.browser, item);
			if (reading !== item.value) {
				failures.push(
					`${item.name}: showed "${item.value}" before the restart and "${reading}" after it`,
				);
			}
		} catch (cause) {
			failures.push(
				`${item.name}: could not read it after the restart (${(cause as Error).message})`,
			);
		}
	}
	return restarted;
}

export const settingsRoundTrip: Check = {
	name: "every setting and stored choice survives a restart",
	async run(context) {
		const failures: string[] = [];
		const { app: started, world } = await startInWorld(context);
		let app: RunningApp = started;

		// Workspace choices go first, in their own restart, while every setting holds its default.
		// A choice that fell back to a setting after a restart (#549: Sync files fell back to the
		// Advanced setting) would match that setting by chance if the setting had been flipped too.
		const choices: Expected[] = [];
		for (const choice of workspaceChoices(world)) {
			await choice.open(app.browser);
			const done = await change(app.browser, choice, "", failures);
			if (done !== null) choices.push(done);
		}
		app = await restartAndCompare(app, context, choices, failures);

		const expected: Expected[] = [];
		const handled = new Set<string>();
		const reached = new Set<string>();
		const disabled: string[] = [];
		const texts = textValues(world);
		for (const page of pagesOf(world)) {
			await page.open(app.browser);
			// A change can show another row (a choice that reveals its field), so the page is read
			// again until a pass finds nothing new. Three passes is a hang guard, not a limit on rows.
			for (let pass = 0; pass < 3; pass++) {
				const rows = (await rowKeys(app.browser))
					.filter((key) => !handled.has(`${page.scope}:${key}`))
					.map((key) => ({ key, scope: rowScope(key), save: undefined as string | undefined }));
				const custom = Object.entries(CONTROLS)
					.filter(([key, at]) => at.page === page.label && !handled.has(`${page.scope}:${key}`))
					.map(([key, at]) => ({ key, scope: at.scope, save: at.save }));
				if (rows.length === 0 && custom.length === 0) break;
				for (const { key, scope, save } of [...rows, ...custom]) {
					handled.add(`${page.scope}:${key}`);
					reached.add(key);
					if (key in NOT_COVERED) continue;
					// A row is disabled while its value loads; it counts as not changeable only if it is
					// still disabled once the page has had time to load (issue #658).
					const reading = await until(
						`${page.label}: ${key} usable`,
						async () => {
							const found = await readControl(app.browser, scope);
							return found === null || found.disabled ? undefined : found;
						},
						ROW_LOAD_MS,
					).catch(async () => await readControl(app.browser, scope));
					if (reading?.disabled === true) {
						disabled.push(`${page.label}: ${key} (${reading.note})`);
						continue;
					}
					const done = await change(
						app.browser,
						{ name: `${page.label}: ${key}`, open: page.open, scope },
						texts[key] ?? `e2e-${key}`,
						failures,
						save,
					);
					if (done !== null) expected.push(done);
				}
			}
		}
		const unreached = SETTINGS.filter(
			(def) => def.page !== "state" && !reached.has(def.key) && !(def.key in NOT_COVERED),
		).map((def) => def.key);
		for (const key of unreached) {
			failures.push(`${key}: no settings page shows it, and CONTROLS does not say where it is`);
		}
		for (const line of disabled) context.log(`  not changeable here: ${line}`);
		const gaps = Object.keys(NOT_COVERED).length;
		context.log(`  not covered: ${gaps} settings (NOT_COVERED in settings-round-trip.ts says why)`);
		await restartAndCompare(app, context, expected, failures);
		return failures;
	},
};
