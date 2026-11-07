/**
 * @feature CLOUD-05 Secrets stay outside the sandbox: the outbound handler swaps in the model key and GitHub token
 * Owns: the host tables the outbound handler reads: the model APIs and the Worker secret that
 * authenticates each one, GitHub's hosts and the header the GitHub token rides in, and the
 * package-registry check that lets CLOUD-04's list through.
 * Behaviour: services-map.md 3.9 (git and `gh` reach GitHub with a token the sandbox never holds),
 * cloud-and-remote.md Part 1 ("Secrets never enter the sandbox"; "Network is closed by default.
 * The outbound allow-list holds GitHub, the model gateway and the package registries the setup
 * script needs"), D101 (the desktop replaces every provider key with `provided-by-worker`) and
 * D102 (the package hosts live in `sandbox/package-allow-list.ts`).
 * Must handle: a missing Worker secret (the handler refuses that provider without making up a
 * value), a host that only looks like an allowed one (exact names, never a suffix), and a
 * provider key sent in either the `authorization` or the `x-api-key` header.
 * Our design choice: the request's hostname decides which Worker secret is swapped in, because
 * the sandbox names no agent in its HTTP calls. The research names Anthropic's and OpenAI's API
 * hosts; it names no Cursor host and the sandbox image has no Cursor SDK (CLOUD-04), so Cursor
 * has no row here until CLOUD-18 supplies the host.
 * Test first: replaces the sandbox's placeholder Anthropic key with the Worker's real key.
 */
import { isPackageRegistryHost } from "../sandbox/package-allow-list.ts";

/** The Worker secrets the outbound handler can swap in. */
export interface OutboundSecrets {
	/** Claude Code's Anthropic API key. */
	ANTHROPIC_API_KEY?: string;
	/** Codex's OpenAI API key. */
	OPENAI_API_KEY?: string;
	/** The GitHub token `git` and `gh` use without holding it. */
	GITHUB_TOKEN?: string;
}

/** One model API: who answers it, and where its key goes. */
export interface ModelProvider {
	/** The exact API hostname. */
	host: string;
	/** The Worker secret holding the real key. */
	secret: keyof OutboundSecrets;
	/** The header the key rides in. */
	header: string;
	/** Text before the key in that header. */
	prefix: string;
	/** Headers removed before the real key is set, so the placeholder cannot survive beside it. */
	clear: readonly string[];
}

/**
 * The model APIs the sandbox may reach. Anthropic's API reads `x-api-key`; OpenAI's reads a
 * bearer token. Both hosts are the vendors' public API names (services-map.md 4.2.8 names the
 * key variables; the hosts are in the agents' own documentation).
 */
export const MODEL_PROVIDERS: readonly ModelProvider[] = [
	{
		host: "api.anthropic.com",
		secret: "ANTHROPIC_API_KEY",
		header: "x-api-key",
		prefix: "",
		clear: ["authorization", "x-api-key"],
	},
	{
		host: "api.openai.com",
		secret: "OPENAI_API_KEY",
		header: "authorization",
		prefix: "Bearer ",
		clear: ["authorization", "x-api-key"],
	},
];

/** The model API at `host`, or undefined when the host is not a model API. */
export function modelProviderFor(host: string): ModelProvider | undefined {
	return MODEL_PROVIDERS.find((provider) => provider.host === host);
}

/** How GitHub accepts a token: as a bearer token, or as the password in HTTP basic auth. */
export type GitHubAuth = "basic" | "bearer";

/**
 * GitHub's hosts. `git` speaks to `github.com` and `codeload`, which take basic auth with an
 * access token as the password; the REST API and its file hosts take a bearer token.
 */
export const GITHUB_HOSTS: Readonly<Record<string, GitHubAuth>> = {
	"github.com": "basic",
	"codeload.github.com": "basic",
	"api.github.com": "bearer",
	"uploads.github.com": "bearer",
	"raw.githubusercontent.com": "bearer",
	"objects.githubusercontent.com": "bearer",
};

/** How GitHub at `host` accepts the token, or undefined when the host is not GitHub. */
export function gitHubAuthFor(host: string): GitHubAuth | undefined {
	return Object.hasOwn(GITHUB_HOSTS, host) ? GITHUB_HOSTS[host] : undefined;
}

/** The `authorization` value that carries `token` to a GitHub host. */
export function gitHubAuthorization(auth: GitHubAuth, token: string): string {
	return auth === "basic" ? `Basic ${btoa(`x-access-token:${token}`)}` : `Bearer ${token}`;
}

export { isPackageRegistryHost };
