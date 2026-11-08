/**
 * @feature NAV-17 Deep-link routes: settings, browser tab, create with a prompt
 * Owns: the pure step from a `conducted://` URL to a typed route the app can open, and the one
 * opener that turns that route into navigation, a setting change or a notice. The Rust side only
 * checks the length and passes every link on, whatever its scheme (PLAT-16); this file owns the scheme
 * rule and the route table. Platform deep links (through the command dispatcher) and notification
 * clicks (through the app entry) both open through `createDeepLinkOpener` ("Notification clicks reuse
 * the same router", A8).
 * Behaviour: native-and-sidecar-map.md A8 (the URL host selects the route: `workspace?id&session`,
 * `settings/...`, `settings-enable?key`, `browser?url&workspace-id&navigate`, `async?repo&plan=<base64>`;
 * a host made of `key=value` text, or an empty host with a query, creates a workspace with a prefilled
 * prompt: `path`, `branch`, `prompt`); services-map.md 5B.2.5 (the Platform delivers cold-start links and later
 * events; PLAT-16 owns their delivery); coverage/inventory-controls.md (toasts "Invalid browser URL",
 * "Couldn't open browser tab",
 * "Setting cannot be enabled by link", "Failed to enable setting").
 * Left out on purpose: `auth`, `gh-auth` (GitHub App sign-in, D025), `automation`, `loadout`, the cloud
 * onboarding hosts (`cloud-collab-onboarding`, `join-organization-onboarding`, `github-connected`,
 * `__onboarding_add_repository`), the dev hosts (`dev`) and `session` (A8: "reported as unsupported").
 * They return `deep_link_unsupported`, so the caller says the link is not supported. A host that is
 * neither listed nor `key=value` text is an invalid link.
 * Not read: the browser link's `navigate` parameter. A8 lists it without saying what it does, and the
 * browser tab it would steer is RUN-04's and not built, so the link opens the tab at its URL.
 * Reuse: the `workspace` host is already parsed by `parseDeepLink` in core/services/notifications.ts; this
 * file calls it rather than parsing the host a second time. The scheme name is `DEEP_LINK_SCHEME` there.
 * Must handle: a scheme other than `conducted`; a missing or empty parameter; a percent-encoded value; a
 * `url` that is not http or https (refused); a `plan` that is not valid base64 or decodes to empty text; a
 * `settings` page that does not exist (error, never a default page, see settings-pages.ts); a
 * `settings-enable` key that is not an experimental setting (refused, so a link can never switch on a
 * stored secret or a safety setting); a prompt of unlimited length (the Rust side drops links over its
 * size limit); a link for a workspace or repository that does not exist (the error is shown, and a plan
 * link starts nothing rather than starting in another project; a create link whose `path` matches no
 * project says so and opens the create page with no project chosen from the link).
 * Our design choice: the parse result is data. `openDeepLink` takes the navigation, setting and notice
 * edges as parameters, so the parser stays pure and the caller decides how a route is drawn.
 * Test first: "conducted://settings-enable?key=experimental_big_terminal_mode" gives kind "enable-setting"
 * with that key; "https://example.com" is an error.
 */
import {
	type AppError,
	appError,
	err,
	ok,
	type RepoId,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import { type NavigateFn, useNavigate } from "@tanstack/react-router";
import { createElement, useMemo } from "react";
import type { Container } from "../core/container.ts";
import { useServices } from "../core/context.tsx";
import { getSettingDef } from "../core/registries/settings.ts";
import { DEEP_LINK_SCHEME, parseDeepLink } from "../core/services/notifications.ts";
import { newWorkspaceConfigFromSettings } from "../core/services/workspace.ts";
import { parseSettingsPage, type SettingsTarget } from "../features/settings/settings-pages.ts";
import { toast, toastError } from "../ui/Toast.tsx";
import { EnabledSettingNotice } from "./EnabledSettingNotice.tsx";

export type DeepLinkRoute =
	| { kind: "open-workspace"; workspaceId: WorkspaceId; sessionId: SessionId | null }
	| { kind: "open-settings"; target: SettingsTarget }
	| { kind: "enable-setting"; key: string }
	| { kind: "open-browser"; url: string; workspaceId: WorkspaceId | null }
	| { kind: "create-from-plan"; repoName: string; plan: string }
	| {
			kind: "create-with-prompt";
			path: string | null;
			branch: string | null;
			prompt: string | null;
	  };

/** The search the create page reads for a link's project, branch and first message. */
export interface DeepLinkCreateSearch {
	repo?: RepoId;
	branch?: string;
	prompt?: string;
}

/** How a parsed route is opened. The app supplies the router; the tests supply recorders. */
export interface DeepLinkNavigator {
	workspace(workspaceId: WorkspaceId, repositoryId: RepoId, sessionId: SessionId | null): void;
	settings(target: SettingsTarget): void;
	browser(workspaceId: WorkspaceId, repositoryId: RepoId, url: string): void;
	create(search: DeepLinkCreateSearch): void;
}

/** The user-facing edges an opened route needs. */
export interface DeepLinkNotifications {
	error(title: string, error: AppError): void;
	enabledSetting(settingKey: string, settingTitle: string, onGoToSetting: () => void): void;
	log(message: string): void;
}

/** The state and edges `openDeepLink` needs, passed in so the parser and opener stay testable. */
export interface DeepLinkDeps {
	workspaceRepoId(workspaceId: WorkspaceId): RepoId | undefined;
	repoByName(name: string): RepoId | undefined;
	repoByPath(path: string): RepoId | undefined;
	setSetting(key: string, value: unknown): Promise<Result<void>>;
	/** Starts the workspace a plan link names. The composition root passes the workspace action. */
	createFromPlan(repositoryId: RepoId, plan: string): Promise<Result<void>>;
	navigate: DeepLinkNavigator;
	notify: DeepLinkNotifications;
}

const invalid = (code: string, message: string): Result<never> => err(appError(code, message));

/** Hosts Conductor routes that Conducted leaves out on purpose (see the header). */
const UNSUPPORTED_HOSTS: ReadonlySet<string> = new Set([
	"auth",
	"gh-auth",
	"automation",
	"loadout",
	"cloud-collab-onboarding",
	"join-organization-onboarding",
	"github-connected",
	"__onboarding_add_repository",
	"dev",
	"session",
]);

function readParam(params: URLSearchParams, key: string): string | null {
	const value = params.get(key);
	return value === null || value.length === 0 ? null : value;
}

function readSettingsSegments(parsed: URL): Result<string[]> {
	try {
		return ok(
			parsed.pathname
				.split("/")
				.filter((segment) => segment.length > 0)
				.map((segment) => decodeURIComponent(segment)),
		);
	} catch {
		return invalid("deep_link_settings_invalid", "The settings page cannot be read.");
	}
}

function readSettingsPage(parsed: URL): Result<SettingsTarget> {
	const segments = readSettingsSegments(parsed);
	if (!segments.ok) return segments;

	let page: string;
	if (segments.value.length === 0) {
		page = parsed.searchParams.get("page") ?? "general";
	} else if (
		(segments.value[0] === "repos" || segments.value[0] === "repo") &&
		segments.value.length === 3
	) {
		page = `repo:${segments.value[1]}:${segments.value[2]}`;
	} else if (segments.value[0] === "user" && segments.value.length === 2) {
		page = segments.value[1] ?? "";
	} else {
		page = segments.value.join(":");
	}

	const target = parseSettingsPage(page);
	return target.ok ? ok(target.value) : invalid(target.error.code, target.error.message);
}

function decodePlan(encoded: string): Result<string> {
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
		return invalid("deep_link_plan_invalid", "Invalid plan data.");
	}
	const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
	let text: string;
	try {
		const binary = atob(padded);
		text = new TextDecoder().decode(
			Uint8Array.from(binary, (character) => character.charCodeAt(0)),
		);
	} catch {
		return invalid("deep_link_plan_invalid", "Invalid plan data.");
	}
	if (text.trim() === "") return invalid("deep_link_plan_empty", "Empty plan.");
	return ok(text);
}

function parseCreateWithPrompt(url: string): Result<DeepLinkRoute> {
	const schemeEnd = url.indexOf("://");
	if (schemeEnd < 0) return invalid("deep_link_invalid", "That is not a valid link.");
	let params: URLSearchParams;
	try {
		params = new URLSearchParams(url.slice(schemeEnd + 3));
	} catch {
		return invalid("deep_link_invalid", "That is not a valid link.");
	}
	const path = readParam(params, "path");
	const branch = readParam(params, "branch");
	const prompt = readParam(params, "prompt");
	if (path === null && branch === null && prompt === null) {
		return invalid("deep_link_create_empty", "The link does not name a workspace to create.");
	}
	return ok({ kind: "create-with-prompt", path, branch, prompt });
}

export function parseDeepLinkRoute(url: string): Result<DeepLinkRoute> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return invalid("deep_link_invalid", "That is not a valid link.");
	}
	if (parsed.protocol !== `${DEEP_LINK_SCHEME}:`) {
		return invalid("deep_link_scheme", "That link does not use the conducted scheme.");
	}

	const host = parsed.hostname.toLowerCase();
	switch (host) {
		case "workspace": {
			const link = parseDeepLink(url);
			if (link === null)
				return invalid("deep_link_workspace", "The link does not name a workspace.");
			return ok({
				kind: "open-workspace",
				workspaceId: link.workspaceId,
				sessionId: link.sessionId,
			});
		}
		case "settings": {
			const target = readSettingsPage(parsed);
			return target.ok ? ok({ kind: "open-settings", target: target.value }) : target;
		}
		case "settings-enable": {
			const key = readParam(parsed.searchParams, "key");
			if (key === null) {
				return invalid("deep_link_setting_missing", "The link does not name a setting.");
			}
			const def = getSettingDef(key);
			if (def === undefined || def.page !== "experimental" || def.type !== "bool") {
				return invalid(
					"deep_link_setting_not_allowed",
					`The setting "${key}" cannot be enabled by a link.`,
				);
			}
			return ok({ kind: "enable-setting", key });
		}
		case "browser": {
			const urlText = readParam(parsed.searchParams, "url");
			if (urlText === null) {
				return invalid("deep_link_browser_url_missing", "The link has no browser URL.");
			}
			let target: URL;
			try {
				target = new URL(urlText);
			} catch {
				return invalid("deep_link_browser_url_invalid", "Invalid browser URL.");
			}
			if (target.protocol !== "http:" && target.protocol !== "https:") {
				return invalid("deep_link_browser_url_invalid", "Invalid browser URL.");
			}
			const workspaceId = readParam(parsed.searchParams, "workspace-id");
			if (workspaceId === null) {
				return invalid("deep_link_workspace_missing", "The link does not name a workspace.");
			}
			return ok({ kind: "open-browser", url: urlText, workspaceId: workspaceId as WorkspaceId });
		}
		case "async": {
			const repoName = readParam(parsed.searchParams, "repo");
			if (repoName === null) {
				return invalid("deep_link_repo_missing", "The link does not name a repository.");
			}
			const encoded = readParam(parsed.searchParams, "plan");
			if (encoded === null) {
				return invalid("deep_link_plan_missing", "The link has no plan.");
			}
			const plan = decodePlan(encoded);
			return plan.ok ? ok({ kind: "create-from-plan", repoName, plan: plan.value }) : plan;
		}
		default: {
			if (UNSUPPORTED_HOSTS.has(host)) {
				return invalid("deep_link_unsupported", `Conducted does not open "${host}" links.`);
			}
			// Only `key=value` text after the scheme is a create link; any other host is unknown.
			if (host === "" || host.includes("=")) return parseCreateWithPrompt(url);
			return invalid("deep_link_invalid", "That is not a valid link.");
		}
	}
}

/** The message title for a parse error, in Conductor's words. */
export function deepLinkErrorTitle(error: AppError): string {
	switch (error.code) {
		case "deep_link_setting_not_allowed":
			return "Setting cannot be enabled by link";
		case "deep_link_browser_url_invalid":
			return "Invalid browser URL";
		case "deep_link_plan_invalid":
			return "Invalid plan data";
		case "deep_link_plan_empty":
			return "Empty plan";
		case "deep_link_repo_missing":
		case "deep_link_repo_not_found":
			return "Repository not found";
		default:
			return "Invalid deep link";
	}
}

/** Opens one parsed route through the app's navigation and settings edges. */
export async function openDeepLink(url: string, deps: DeepLinkDeps): Promise<void> {
	const parsed = parseDeepLinkRoute(url);
	if (!parsed.ok) {
		deps.notify.log(`Deep link could not be opened: ${parsed.error.message} (${url})`);
		deps.notify.error(deepLinkErrorTitle(parsed.error), parsed.error);
		return;
	}

	const route = parsed.value;
	switch (route.kind) {
		case "open-workspace": {
			const repositoryId = deps.workspaceRepoId(route.workspaceId);
			if (repositoryId === undefined) {
				deps.notify.error(
					"Couldn't open workspace",
					appError("deep_link_workspace_not_found", "That workspace no longer exists."),
				);
				return;
			}
			deps.navigate.workspace(route.workspaceId, repositoryId, route.sessionId);
			return;
		}
		case "open-settings":
			deps.navigate.settings(route.target);
			return;
		case "enable-setting": {
			const def = getSettingDef(route.key);
			if (def === undefined) {
				deps.notify.error(
					"Setting cannot be enabled by link",
					appError("deep_link_setting_not_allowed", "That setting cannot be enabled by a link."),
				);
				return;
			}
			const written = await deps.setSetting(route.key, true);
			if (!written.ok) {
				deps.notify.error("Failed to enable setting", written.error);
				return;
			}
			deps.notify.enabledSetting(route.key, def.title, () => {
				deps.navigate.settings({ kind: "user", page: "experimental" });
			});
			return;
		}
		case "open-browser": {
			if (route.workspaceId === null) {
				deps.notify.error(
					"Couldn't open browser tab",
					appError("deep_link_workspace_missing", "The link does not name a workspace."),
				);
				return;
			}
			const repositoryId = deps.workspaceRepoId(route.workspaceId);
			if (repositoryId === undefined) {
				deps.notify.error(
					"Couldn't open browser tab",
					appError("deep_link_workspace_not_found", "That workspace no longer exists."),
				);
				return;
			}
			deps.navigate.browser(route.workspaceId, repositoryId, route.url);
			return;
		}
		case "create-from-plan": {
			// A plan is meant for the project it names, so a missing project starts nothing.
			const repositoryId = deps.repoByName(route.repoName);
			if (repositoryId === undefined) {
				deps.notify.error(
					"Repository not found",
					appError(
						"deep_link_repo_not_found",
						`There is no repository called "${route.repoName}".`,
					),
				);
				return;
			}
			const started = await deps.createFromPlan(repositoryId, route.plan);
			if (!started.ok) {
				deps.notify.error("Couldn't start workspace", started.error);
			}
			return;
		}
		case "create-with-prompt": {
			const repositoryId = route.path === null ? undefined : deps.repoByPath(route.path);
			if (route.path !== null && repositoryId === undefined) {
				deps.notify.error(
					"Repository not found",
					appError("deep_link_repo_not_found", `There is no project at "${route.path}".`),
				);
			}
			deps.navigate.create({
				...(repositoryId === undefined ? {} : { repo: repositoryId }),
				...(route.branch === null ? {} : { branch: route.branch }),
				...(route.prompt === null ? {} : { prompt: route.prompt }),
			});
			return;
		}
	}
}

/** What the app's opener reads: the services, the actions and the Platform log. */
type DeepLinkContainer = Pick<Container, "services" | "actions" | "platform">;

/**
 * The real app's opener: the router's navigate, the loaded projects and the settings service. The
 * command dispatcher's deep links and the entry's notification clicks both open through it.
 */
export function createDeepLinkOpener(
	container: DeepLinkContainer,
	navigate: NavigateFn,
): (url: string) => void {
	const { services, actions, platform } = container;
	const repos = () => Object.values(services.repo.store.getState().reposById);
	const deps: DeepLinkDeps = {
		workspaceRepoId: (workspaceId) =>
			services.workspace.store.getState().workspacesById[workspaceId]?.repoId,
		repoByName: (name) => repos().find((repo) => repo.name === name)?.id,
		repoByPath: (path) =>
			repos().find((repo) => repo.rootPath === path || repo.rootPath === path.replace(/\/+$/, ""))
				?.id,
		setSetting: (key, value) => actions.settings.set(key, value),
		createFromPlan: async (repositoryId, plan) => {
			const created = await actions.workspaces.create({
				repoId: repositoryId,
				from: { kind: "default" },
				prompt: plan,
				attachmentPaths: [],
				config: newWorkspaceConfigFromSettings((key) => services.settings.get(key)),
				sectionId: null,
			});
			return created.ok ? ok(undefined) : created;
		},
		navigate: {
			workspace: (workspaceId, repositoryId, sessionId) => {
				void navigate({
					to: "/repository/$repositoryId/workspace/$workspaceId",
					params: { repositoryId, workspaceId },
					search: sessionId === null ? {} : { sessionId },
				});
			},
			settings: (target) => {
				if (target.kind === "user") {
					void navigate({ to: "/settings/$page", params: { page: target.page } });
				} else {
					void navigate({
						to: "/settings/repos/$repoId/$page",
						params: { repoId: target.repoId, page: target.page },
					});
				}
			},
			browser: (workspaceId, repositoryId, url) => {
				void navigate({
					to: "/repository/$repositoryId/workspace/$workspaceId",
					params: { repositoryId, workspaceId },
					search: { tab: "browser", browserUrl: url },
				});
			},
			create: (search) => {
				void navigate({ to: "/create", search });
			},
		},
		notify: {
			error: (title, error) => {
				toastError(title, error);
			},
			enabledSetting: (settingKey, settingTitle, onGoToSetting) => {
				toast.custom(
					(id) =>
						createElement(EnabledSettingNotice, {
							settingKey,
							settingTitle,
							onGoToSetting: () => {
								toast.dismiss(id);
								onGoToSetting();
							},
							onDismiss: () => {
								toast.dismiss(id);
							},
						}),
					{ duration: Number.POSITIVE_INFINITY },
				);
			},
			log: (message) => platform.app.writeLog("warn", message),
		},
	};
	return (url) => {
		void openDeepLink(url, deps);
	};
}

/** The opener inside React, over the mounted container and router. */
export function useDeepLinkOpener(): (url: string) => void {
	const container = useServices();
	const navigate = useNavigate();
	return useMemo(() => createDeepLinkOpener(container, navigate), [container, navigate]);
}
