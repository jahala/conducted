/**
 * @feature SET-11 Suggested variable names in the Environment form
 * Owns: the list under the add-variable form that suggests well-known variable names, each with a one-line
 * meaning. Picking one fills the name field. It never fills a value.
 * Behaviour: coverage/inventory-controls.md ("Suggested variables in the Environment form": proxy settings
 * HTTP_PROXY, HTTPS_PROXY and NO_PROXY; the Anthropic key, base URL and token; the Bedrock and Vertex
 * switches; the AWS region and profile; the Google credentials file; the Codex, Cursor and OpenAI keys and
 * base URL; 18 strings, descriptions #106 to #123); ui-map.md 6 (Environment page).
 * Data: names already set in the scope come from useEnvVars (core/hooks.ts) through the page; the parent
 * AddEnvVarForm owns the name field.
 * Our design choice: the 18 one-line meanings are not in the research files, only their subjects. The
 * builder writes them in the app's own words, one constant list typed as `EnvVarSuggestion[]`, grouped by
 * `EnvSuggestionGroup`. A suggestion for a key warns in its meaning that the value is a secret that goes to
 * the Keychain.
 * Must handle: a name that is already set in this scope (hidden, or marked "Already set"); a name the app
 * sets itself (never suggested); typing in the name field (the list narrows with the shared fuzzy matcher,
 * APP-15); no match (the list is hidden, not an empty box); keyboard use (arrow keys and Enter pick, Escape
 * returns to the field); the suggestion list never shows any current value.
 * Test first: with HTTPS_PROXY already set, the list does not offer it; typing "prox" offers HTTP_PROXY
 * and NO_PROXY.
 */
import { notImplemented } from "@conducted/shared";

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

export interface EnvVarSuggestionsProps {
	/** What the user has typed in the name field so far. */
	query: string;
	/** Names that already exist in the scope being edited. */
	existingNames: readonly string[];
	onPick: (name: string) => void;
}

export function EnvVarSuggestions(_props: EnvVarSuggestionsProps): never {
	return notImplemented("SET-11");
}
