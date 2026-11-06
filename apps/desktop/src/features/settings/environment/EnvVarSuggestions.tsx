/**
 * @feature SET-11 Suggested variable names in the Environment form
 * Owns: the list under the add-variable form that suggests well-known variable names, each with a
 * one-line meaning. Picking one fills the name field. It never fills a value.
 * Behaviour: coverage/inventory-controls.md ("Suggested variables in the Environment form": proxy
 * settings HTTP_PROXY, HTTPS_PROXY and NO_PROXY; the Anthropic key, base URL and token; the Bedrock
 * and Vertex switches; the AWS region and profile; the Google credentials file; the Codex, Cursor
 * and OpenAI keys and base URL; descriptions #106 to #123); ui-map.md 6 (Environment page).
 * Data: names already set in the scope come from useEnvVars (core/hooks.ts) through the page; the
 * parent AddEnvVarForm owns the name field and the keyboard.
 * Our design choice: the one-line meanings are ours, one constant list of `EnvVarSuggestion` grouped
 * by `EnvSuggestionGroup`. A secret's meaning says its value stays in the Keychain, and its row
 * carries a Secret mark. The names the agent-provider table owns (provider keys, base URLs, the
 * Bedrock and Vertex switches) are read from it. The list stays the names Conductor suggests: a new
 * provider key in the table is not added here by itself, and the names the table lacks
 * (`ANTHROPIC_AUTH_TOKEN`, `CODEX_API_KEY`, `CODEX_ACCESS_TOKEN`, the AWS region and profile, the
 * proxy names) stay literal.
 * Must handle: a name that is already set in this scope (hidden); a name the app sets itself (never
 * in the list, held by a test rather than filtered at run time); typing in the name field (the list narrows with the shared rankFuzzy matcher, APP-15);
 * no match (the list is hidden, not an empty box); the list never shows any current value.
 * The parent form moves the highlight with the arrow keys, picks with Enter and hides the list with
 * Escape.
 * Test first: with HTTPS_PROXY already set, the list does not offer it; typing "prox" offers
 * HTTP_PROXY and NO_PROXY.
 */
import { AGENT_PROVIDER_TABLE, BEDROCK_ENV, type SignInId } from "@conducted/protocol";
import { rankFuzzy } from "../../../core/fuzzy.ts";
import { cn } from "../../../ui/cn.ts";
import { keyEnvVarFor } from "../agents/provider-forms.ts";

export type EnvSuggestionGroup =
	| "proxy"
	| "anthropic"
	| "bedrock"
	| "vertex"
	| "codex"
	| "cursor"
	| "openai";

export interface EnvVarSuggestion {
	name: string;
	/** One short sentence. */
	meaning: string;
	group: EnvSuggestionGroup;
	/** The value is a secret, so the form stores it in the Keychain. */
	secret: boolean;
}

/** A name the agent-provider table must hold. A missing one is a programmer error at load. */
function tableName(name: string | undefined, what: string): string {
	if (name === undefined || name === "") {
		throw new Error(`The agent-provider table has no ${what}.`);
	}
	return name;
}

const claudeRouting = (signIn: SignInId): string =>
	tableName(
		AGENT_PROVIDER_TABLE.claude.signIns.find((entry) => entry.id === signIn)?.routingEnvVar,
		`routing variable for Claude's ${signIn} sign-in`,
	);

// The provider key, base URL and routing names have one home, the agent-provider table
// (packages/protocol), so a rename there reaches this list. The other names are not the table's.
const ENV_VAR_SUGGESTIONS: readonly EnvVarSuggestion[] = [
	{
		name: "HTTP_PROXY",
		meaning: "Send plain HTTP requests through this proxy.",
		group: "proxy",
		secret: false,
	},
	{
		name: "HTTPS_PROXY",
		meaning: "Send HTTPS requests through this proxy.",
		group: "proxy",
		secret: false,
	},
	{
		name: "NO_PROXY",
		meaning: "Hosts that skip the proxy, separated by commas.",
		group: "proxy",
		secret: false,
	},
	{
		name: tableName(keyEnvVarFor("claude", "anthropic"), "Anthropic key"),
		meaning: "Anthropic API key, kept in the Keychain.",
		group: "anthropic",
		secret: true,
	},
	{
		name: tableName(AGENT_PROVIDER_TABLE.claude.baseUrlEnvVar, "Claude base URL"),
		meaning: "Send Anthropic requests to this base URL.",
		group: "anthropic",
		secret: false,
	},
	{
		name: "ANTHROPIC_AUTH_TOKEN",
		meaning: "Token for a custom Anthropic endpoint, kept in the Keychain.",
		group: "anthropic",
		secret: true,
	},
	{
		name: claudeRouting("bedrock"),
		meaning: "Run Claude through Amazon Bedrock.",
		group: "bedrock",
		secret: false,
	},
	{
		name: "AWS_REGION",
		meaning: "AWS region for Bedrock requests.",
		group: "bedrock",
		secret: false,
	},
	{
		name: "AWS_PROFILE",
		meaning: "AWS profile whose credentials Bedrock uses.",
		group: "bedrock",
		secret: false,
	},
	{
		name: BEDROCK_ENV.accessKeyId,
		meaning: "AWS access key ID for Bedrock, kept in the Keychain.",
		group: "bedrock",
		secret: true,
	},
	{
		name: BEDROCK_ENV.secretAccessKey,
		meaning: "AWS secret access key for Bedrock, kept in the Keychain.",
		group: "bedrock",
		secret: true,
	},
	{
		name: claudeRouting("vertex"),
		meaning: "Run Claude through Google Vertex AI.",
		group: "vertex",
		secret: false,
	},
	{
		name: tableName(keyEnvVarFor("claude", "vertex"), "Vertex credentials file"),
		meaning: "Path to a Google service account JSON file.",
		group: "vertex",
		secret: false,
	},
	{
		name: "CODEX_API_KEY",
		meaning: "OpenAI key that Codex uses, kept in the Keychain.",
		group: "codex",
		secret: true,
	},
	{
		name: "CODEX_ACCESS_TOKEN",
		meaning: "Access token for Codex, kept in the Keychain.",
		group: "codex",
		secret: true,
	},
	{
		name: tableName(keyEnvVarFor("cursor", "cursor"), "Cursor key"),
		meaning: "Cursor API key, kept in the Keychain.",
		group: "cursor",
		secret: true,
	},
	{
		name: tableName(keyEnvVarFor("codex", "openai"), "OpenAI key"),
		meaning: "OpenAI API key, kept in the Keychain.",
		group: "openai",
		secret: true,
	},
	{
		name: tableName(AGENT_PROVIDER_TABLE.codex.baseUrlEnvVar, "Codex base URL"),
		meaning: "Send OpenAI requests to this base URL.",
		group: "openai",
		secret: false,
	},
];

const alreadySet = (name: string, existingNames: readonly string[]): boolean => {
	const upper = name.toUpperCase();
	return existingNames.some((existing) => existing.toUpperCase() === upper);
};

const GROUP_ORDER: readonly EnvSuggestionGroup[] = [
	"proxy",
	"anthropic",
	"bedrock",
	"vertex",
	"codex",
	"cursor",
	"openai",
];

const GROUP_LABELS: Record<EnvSuggestionGroup, string> = {
	proxy: "Proxy",
	anthropic: "Anthropic",
	bedrock: "Amazon Bedrock",
	vertex: "Google Vertex AI",
	codex: "Codex",
	cursor: "Cursor",
	openai: "OpenAI",
};

/**
 * The suggestions that match a query, best match first within each group. Names already set in the
 * scope are left out. No suggestion is a name the app sets itself; a test holds the list to that.
 */
export function suggestEnvVars(
	query: string,
	existingNames: readonly string[],
): EnvVarSuggestion[] {
	const available = ENV_VAR_SUGGESTIONS.filter(
		(suggestion) => !alreadySet(suggestion.name, existingNames),
	);
	const ranked = rankFuzzy(
		available,
		query,
		[
			{ text: (suggestion) => suggestion.name, weight: 1 },
			{ text: (suggestion) => suggestion.meaning, weight: 0.4 },
		],
		available.length,
	).map((entry) => entry.item);
	return GROUP_ORDER.flatMap((group) => ranked.filter((suggestion) => suggestion.group === group));
}

export interface EnvVarSuggestionsProps {
	/** What the user has typed in the name field so far. */
	query: string;
	/** Names that already exist in the scope being edited. */
	existingNames: readonly string[];
	onPick: (name: string) => void;
	/** The row the arrow keys have reached, or -1 for none. */
	activeIndex?: number;
	/** Called when the pointer moves over a row, so the parent can move its highlight too. */
	onHighlight?: (index: number) => void;
}

export function EnvVarSuggestions({
	query,
	existingNames,
	onPick,
	activeIndex = -1,
	onHighlight,
}: EnvVarSuggestionsProps) {
	const suggestions = suggestEnvVars(query, existingNames);
	if (suggestions.length === 0) return null;
	const ranked = suggestions.map((suggestion, index) => ({ suggestion, index }));
	const groups = GROUP_ORDER.map((group) => ({
		group,
		rows: ranked.filter((row) => row.suggestion.group === group),
	})).filter((group) => group.rows.length > 0);
	return (
		<div className="flex flex-col gap-2">
			<p className="text-xs font-medium text-fg-muted">Suggested variables</p>
			<ul aria-label="Suggested variables" className="flex flex-col gap-2">
				{groups.map(({ group, rows }) => (
					<li key={group} className="flex flex-col gap-0.5">
						<p className="text-2xs font-medium uppercase tracking-wide text-fg-subtle">
							{GROUP_LABELS[group]}
						</p>
						<ul aria-label={GROUP_LABELS[group]} className="flex flex-col gap-0.5">
							{rows.map(({ suggestion, index }) => (
								<li key={suggestion.name}>
									<button
										type="button"
										onClick={() => onPick(suggestion.name)}
										onMouseEnter={() => onHighlight?.(index)}
										className={cn(
											"flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
											index === activeIndex ? "bg-active" : "hover:bg-hover",
										)}
									>
										<span className="shrink-0 font-mono text-code text-fg">{suggestion.name}</span>
										<span className="text-xs text-fg-muted">{suggestion.meaning}</span>
										{suggestion.secret ? (
											<span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 text-2xs text-fg-muted">
												Secret
											</span>
										) : null}
									</button>
								</li>
							))}
						</ul>
					</li>
				))}
			</ul>
		</div>
	);
}
