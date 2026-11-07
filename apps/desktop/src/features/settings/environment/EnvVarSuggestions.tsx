/**
 * @feature SET-11 Documented variables on the Environment page
 * Owns: the list of well-known variable names the Environment table documents, each with a
 * one-line meaning, and which of them are still unset in a scope.
 * Behaviour: Conductor's documented variables (renderApp lSt @10708808, ADa): a set one is a row
 * of the table with its meaning, listed before the other variables in this list's order; an unset
 * one waits behind "Show documented variables (N)" with "Not set" and a Set action. The names and
 * meanings are Conductor's, in its order. Four more are ours, after them (the AWS access key pair,
 * CODEX_ACCESS_TOKEN and OPENAI_API_KEY), with meanings of ours; they name keys our provider forms
 * store.
 * Data: the provider key, base URL and routing names have one home, the agent-provider table
 * (packages/protocol), so a rename there reaches this list. A new provider key in the table is not
 * added here by itself, and the names the table lacks stay literal.
 * Must handle: a name already set in the scope (it is a set row, never a documented one, whatever
 * its case); a name the app sets itself (never documented, held by a test rather than filtered at
 * run time).
 * Test first: with HTTPS_PROXY already set, the unset list does not hold it and still holds
 * HTTP_PROXY and NO_PROXY.
 */
import { AGENT_PROVIDER_TABLE, BEDROCK_ENV, type SignInId } from "@conducted/protocol";
import { keyEnvVarFor } from "../agents/provider-forms.ts";

export interface DocumentedEnvVar {
	name: string;
	/** One short sentence. */
	meaning: string;
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

/** Conductor's documented variables in its order, then ours. */
export const DOCUMENTED_ENV_VARS: readonly DocumentedEnvVar[] = [
	{ name: "HTTP_PROXY", meaning: "Routes HTTP requests through a proxy." },
	{ name: "HTTPS_PROXY", meaning: "Routes HTTPS requests through a proxy." },
	{ name: "NO_PROXY", meaning: "Skips the proxy for matching hosts and domains." },
	{
		name: tableName(keyEnvVarFor("claude", "anthropic"), "Anthropic key"),
		meaning: "Authenticates Claude Code with the Anthropic API.",
	},
	{
		name: tableName(AGENT_PROVIDER_TABLE.claude.baseUrlEnvVar, "Claude base URL"),
		meaning: "Overrides the Anthropic API base URL.",
	},
	{
		name: "ANTHROPIC_AUTH_TOKEN",
		meaning: "Sets the Anthropic auth token used by Claude Code.",
	},
	{
		name: claudeRouting("bedrock"),
		meaning: "Switches Claude Code to Amazon Bedrock credentials.",
	},
	{ name: "AWS_REGION", meaning: "Selects the AWS region for Bedrock requests." },
	{ name: "AWS_PROFILE", meaning: "Uses a named AWS profile for Bedrock credentials." },
	{
		name: claudeRouting("vertex"),
		meaning: "Switches Claude Code to Vertex AI credentials.",
	},
	{
		name: "ANTHROPIC_VERTEX_PROJECT_ID",
		meaning: "Selects the GCP project for Vertex AI requests.",
	},
	{
		name: tableName(keyEnvVarFor("claude", "vertex"), "Vertex credentials file"),
		meaning: "Points Claude Code at a Google service account file for Vertex AI.",
	},
	{
		name: "CODEX_API_KEY",
		meaning: "Authenticates Codex with an API key instead of the local CLI login.",
	},
	{
		name: tableName(keyEnvVarFor("cursor", "cursor"), "Cursor key"),
		meaning: "Authenticates Cursor with a Cursor API key.",
	},
	{
		name: tableName(AGENT_PROVIDER_TABLE.codex.baseUrlEnvVar, "Codex base URL"),
		meaning: "Overrides the base URL used for Codex API requests.",
	},
	{ name: "AI_GATEWAY_API_KEY", meaning: "Authenticates Codex with the Vercel AI Gateway." },
	{ name: "OPENAI_ORG", meaning: "Associates Codex API requests with an OpenAI organization." },
	{ name: "OPENAI_PROJECT", meaning: "Associates Codex API requests with an OpenAI project." },
	// Ours: keys our provider forms store.
	{
		name: BEDROCK_ENV.accessKeyId,
		meaning: "AWS access key ID for Bedrock, kept in the Keychain.",
	},
	{
		name: BEDROCK_ENV.secretAccessKey,
		meaning: "AWS secret access key for Bedrock, kept in the Keychain.",
	},
	{ name: "CODEX_ACCESS_TOKEN", meaning: "Access token for Codex, kept in the Keychain." },
	{
		name: tableName(keyEnvVarFor("codex", "openai"), "OpenAI key"),
		meaning: "OpenAI API key, kept in the Keychain.",
	},
];

const sameName = (left: string, right: string): boolean =>
	left.toUpperCase() === right.toUpperCase();

/** The meaning of a documented name, or undefined for any other name. */
export function documentedMeaning(name: string): string | undefined {
	return DOCUMENTED_ENV_VARS.find((entry) => sameName(entry.name, name))?.meaning;
}

/** The documented names not set in a scope, in the list's order. */
export function unsetDocumentedEnvVars(setNames: readonly string[]): DocumentedEnvVar[] {
	return DOCUMENTED_ENV_VARS.filter(
		(entry) => !setNames.some((name) => sameName(name, entry.name)),
	);
}

/**
 * Orders a scope's set names as Conductor does (renderApp dci): the documented ones first, in the
 * list's order, then the others by name.
 */
export function orderSetNames(names: readonly string[]): string[] {
	const documented = DOCUMENTED_ENV_VARS.flatMap((entry) =>
		names.filter((name) => sameName(name, entry.name)),
	);
	const others = names
		.filter((name) => documentedMeaning(name) === undefined)
		.sort((left, right) => left.localeCompare(right));
	return [...documented, ...others];
}
