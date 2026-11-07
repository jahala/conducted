/**
 * Named rules the seeder uses to write decisions into the parity map. A rule names its decision and
 * matches on what an entry is for, never on one odd string; a one-off decision is written by hand in
 * the map instead.
 * Behaviour: docs/plans/parity-harness.md section 2.
 * Must handle: an entry two rules match takes the first, so the order below is the precedence; a
 * rule never sees an entry the seeder matched to a state or a name of ours.
 */
import type { Inventory, SpecEntry } from "./lib.ts";

export interface Rule {
	name: string;
	decision: string;
	note: string;
	applies(entry: SpecEntry, inventory: Inventory, context: RuleContext): boolean;
}

export interface RuleContext {
	/** The names of the places our own gazetteer lists (core/services/place-gazetteer.ts). */
	places: Set<string>;
}

const UI_WORDING: readonly Inventory[] = [
	"text",
	"label",
	"aria_label",
	"placeholder",
	"title",
	"tooltip",
	"description",
	"toast",
	"literal",
];

/** Words that name a team feature: organisations, teammates and what they share (D004, D018). */
const TEAM =
	/\borgani[sz]ations?\b|\borganization's\b|\bteammates?\b|\byour team\b|\bsingle sign-on\b|\bPokes?\b|\bpoked\b|\bPeople with access\b|(?<!cloud )\bworkspace access\b|\bworkspace admin\b|\bwrite access\b|\bedit access\b/i;

/**
 * Wording that uses the word for someone else's organisation: the agent login's "Organization" row,
 * the OpenAI organization header, and a third-party service's own settings path. Not team features.
 */
const NOT_TEAM = /^Organization$|\bOpenAI organization\b|^Organization Settings → /;

/** Words that name Conductor's own service, account, billing or telemetry (D025). */
const CONDUCTOR_SERVICE =
	/\bConductor (?:Pro|account|API|Cloud|captured)\b|\bRoundhouse\b|\bSign in to Conductor\b|\bconductor\.build\b|\bUpgrade to Pro\b|\bbilling\b|\bpricing\b|\bPostHog\b|\bSentry\b|\bHoneycomb\b/i;

/** Conductor's hosted computers: the organisation's cloud computer and its sandbox (D025). */
const HOSTED_COMPUTER = /\bcloud computers?\b|\bsandbox (?:id|SHA|hash|version|\/version)\b/i;

/** A key name a keyboard event reports, which code compares against and nobody reads. */
const KEY_NAMES = new Set([
	"Alt",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"ArrowUp",
	"Backspace",
	"CapsLock",
	"Cmd",
	"ContextMenu",
	"Control",
	"Ctrl",
	"End",
	"Escape",
	"Meta",
	"NumpadAdd",
	"Option",
	"PageDown",
	"PageUp",
	"Shift",
	"Space",
]);

const backendNamed = (pattern: RegExp) => (entry: SpecEntry, inventory: Inventory) =>
	!UI_WORDING.includes(inventory) && inventory !== "route" && inventory !== "test_id"
		? pattern.test(entry.text)
		: false;

export const RULES: Rule[] = [
	{
		name: "place-name",
		decision: "D086",
		note: "A city name both apps can give a workspace. It is sample data, not wording; our list is our own (D002).",
		applies: (entry, inventory, context) =>
			inventory === "literal" && context.places.has(entry.text),
	},
	{
		name: "key-name",
		decision: "D086",
		note: "A key name that keyboard handling compares against. Nobody reads it as wording.",
		applies: (entry, inventory) => inventory === "literal" && KEY_NAMES.has(entry.text),
	},
	{
		name: "bundled-asset",
		decision: "D002",
		note: "The path of a sound or logo file Conductor bundles. Its assets never enter our product.",
		applies: (entry, inventory) =>
			inventory === "route" && /\.(?:mp3|wav|svg|png|jpe?g|webp)$/i.test(entry.text),
	},
	{
		name: "team-route",
		decision: "D004",
		note: "A page of Conductor's organisations, members, profiles, routines or team onboarding. Team features stay out (D004, kept by D018).",
		applies: (entry, inventory) =>
			inventory === "route" &&
			/organization|\$orgSlug|^\/(?:members|computer|routines|automations)\b|\/(?:routines|automations)(?:\/|$)|member-onboarding|collab-onboarding/.test(
				entry.text,
			),
	},
	{
		name: "hosted-backend-route",
		decision: "D025",
		note: "An HTTP route of the sandbox server behind Conductor's hosted workspaces, not a page. Our cloud is D018's.",
		applies: (entry, inventory) =>
			inventory === "route" && /^\/(?:files|shell)\/|^\/version$/.test(entry.text),
	},
	{
		name: "team-wording",
		decision: "D004",
		note: "Wording of a team feature: organisations, teammates, shared access, pokes or single sign-on. Team features stay out (D004, kept by D018).",
		applies: (entry, inventory) =>
			UI_WORDING.includes(inventory) && TEAM.test(entry.text) && !NOT_TEAM.test(entry.text),
	},
	{
		name: "conductor-service",
		decision: "D025",
		note: "Wording about Conductor's own service: its account, plan, billing, hosted backend or telemetry. Each needs a service we do not have.",
		applies: (entry, inventory) =>
			UI_WORDING.includes(inventory) && CONDUCTOR_SERVICE.test(entry.text),
	},
	{
		name: "hosted-computer",
		decision: "D025",
		note: "Conductor's hosted cloud computer and its sandbox details. Our cloud is D018's, on the user's own account.",
		applies: (entry, inventory) =>
			UI_WORDING.includes(inventory) && HOSTED_COMPUTER.test(entry.text),
	},
	{
		name: "telemetry-backend",
		decision: "D025",
		note: "A backend name for Conductor's analytics, crash reporting, app logger or staff tools.",
		applies: backendNamed(
			/posthog|sentry|crash|app_?logger|AppLogger|external_?logging|ExternalLogging|internal_?user|InternalUser|^internal_|react_profiler|roundhouse|kill_switch|developer_metrics|app_action|sidecar_inspect|configure_sidecar_inspect|client_instance_id|deepgram/i,
		),
	},
	{
		name: "phone-relay-backend",
		decision: "D025",
		note: "A backend name of the phone relay: pairing a device and the paired device list. Remote control is D019's claude.ai route.",
		applies: backendNamed(/Pairing|PairedDevice/),
	},
	{
		name: "hosted-computer-backend",
		decision: "D025",
		note: "A backend name of Conductor's hosted computers or its cloud sign-in. Our cloud is D018's.",
		applies: backendNamed(
			/Computer|CloudAuth|^gh_cloud_|cloud_in_data_privacy|RunLocalCommand|UpdateRepositorySetupScript/,
		),
	},
];

export function ruleFor(
	entry: SpecEntry,
	inventory: Inventory,
	context: RuleContext,
): Rule | undefined {
	return RULES.find((rule) => rule.applies(entry, inventory, context));
}
