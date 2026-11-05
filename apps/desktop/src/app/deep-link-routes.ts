/**
 * @feature NAV-17 Deep-link routes: settings, browser tab, create with a prompt
 * Owns: the pure step from a `conducted://` URL to a typed route the app can open. The Rust side only
 * checks the scheme and passes the string on (PLAT-16); this file owns the route table.
 * Behaviour: native-and-sidecar-map.md A8 (the URL host selects the route: `workspace?id&session`,
 * `settings/...`, `settings-enable?key`, `browser?url&workspace-id&navigate`, `async?repo&plan=<base64>`;
 * any other host is split on `&` into `key=value` and creates a workspace with a prefilled prompt:
 * `path`, `branch`, `prompt`); services-map.md 5B.2.5 (several links on a cold start: only the newest is
 * used); coverage/inventory-controls.md (toasts "Invalid browser URL", "Couldn't open browser tab",
 * "Setting cannot be enabled by link", "Failed to enable setting").
 * Left out on purpose: `auth`, `gh-auth` (GitHub App sign-in, D025), `automation`, `loadout`, the cloud
 * onboarding hosts and the dev hosts. They return an error result, so the caller can say the link is not
 * supported.
 * Reuse: the `workspace` host is already parsed by `parseDeepLink` in core/services/notifications.ts; this
 * file calls it rather than parsing the host a second time. The scheme name is `DEEP_LINK_SCHEME` there.
 * Must handle: a scheme other than `conducted`; a missing or empty parameter; a percent-encoded value; a
 * `url` that is not http or https (refused); a `plan` that is not valid base64 or decodes to empty text; a
 * `settings` page that does not exist (error, never a default page, see settings-pages.ts); a
 * `settings-enable` key that is not an experimental setting (refused, so a link can never switch on a
 * stored secret or a safety setting); a prompt of unlimited length (the Rust side drops links over its
 * size limit); a link for a workspace or repository that does not exist (the caller shows the error).
 * Our design choice: the parse result is data. The caller opens the route, so this file has no side effect.
 * Test first: "conducted://settings-enable?key=big_terminal_mode" gives kind "enable-setting" with that key;
 * "https://example.com" is an error.
 */
import { notImplemented, type Result, type SessionId, type WorkspaceId } from "@conducted/shared";
import type { SettingsTarget } from "../features/settings/settings-pages.ts";

export type DeepLinkRoute =
	| { kind: "open-workspace"; workspaceId: WorkspaceId; sessionId: SessionId | null }
	| { kind: "open-settings"; target: SettingsTarget }
	| { kind: "enable-setting"; key: string }
	| {
			kind: "open-browser";
			url: string;
			workspaceId: WorkspaceId | null;
			/** Go to the address now, instead of only filling the address bar. */
			navigate: boolean;
	  }
	| { kind: "create-from-plan"; repoName: string; plan: string }
	| {
			kind: "create-with-prompt";
			path: string | null;
			branch: string | null;
			prompt: string | null;
	  };

export function parseDeepLinkRoute(_url: string): Result<DeepLinkRoute> {
	return notImplemented("NAV-17");
}
