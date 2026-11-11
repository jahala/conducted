/**
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Owns: the pure rules of the organisation switcher and the new-workspace page's cloud mode: the
 * entries (this Mac and, on a paired Mac, the Worker), which one is active, which workspaces an
 * entry lists, which projects a cloud workspace can be made from and their labels, the page's
 * launch state, and the words Conductor shows for each state.
 * Behaviour: Conductor 0.92.1. The switcher's entries and their marks (renderApp `TLo` @8102659,
 * `U9a` @10381031: the personal entry is "<name>'s Mac", or "My Mac" with no name, and a cloud
 * organisation carries "Cloud organization"). The active organisation is the stored choice when it
 * is still listed, else the personal one (main `$st` @922796). A local organisation lists the
 * workspaces with no cloud host and a cloud one lists that organisation's cloud workspaces (main
 * `Nst` @922363). The page's launch state and its reasons (renderApp `RYa` @11441691, `OYa`,
 * `AYa` @11439687, `BXa` @11497335) and the cloud repository picker's labels (renderApp `Hpi`
 * @96073: the repository name, with the owner when two share a name).
 * Must handle: an unpaired Mac (one entry, a stored "cloud" choice reads as local); a pairing not
 * read yet (still checking); a project with no remote or a non-GitHub remote (not offered for the
 * cloud, because the Worker clones from GitHub only, D104); two projects whose repositories share a
 * name.
 * Our design choice: our cloud has no shared computer, so each of Conductor's readiness checks maps
 * to the Worker: the Worker answering is the computer being ready, the Worker holding a GitHub
 * token is GitHub access, and the Worker holding a model key is an agent key. Conductor's
 * "Couldn't check agent setup" has no state of its own, because one call answers all three. The
 * cloud entry's label is the Worker's host name, since a Worker has no organisation name. D127
 * records both.
 * Test first: a paired Mac lists this Mac and its Worker, and a stored cloud choice on an unpaired
 * Mac is this Mac.
 */
import type { Host } from "@conducted/protocol";
import type { Loadable } from "./api.ts";
import { githubRepositoryFromRemote } from "./github-text.ts";
import type { Repo } from "./model.ts";

/** The two organisations this app has: this Mac, and the Worker it is paired with. */
export type OrganizationId = "local" | "cloud";

/** One entry of the organisation switcher. */
export interface Organization {
	id: OrganizationId;
	label: string;
	isCloud: boolean;
	/** The Worker a cloud entry creates workspaces in; null for this Mac. */
	url: string | null;
}

/** The pairing as the switcher reads it: whether a Worker is paired and its URL. */
export interface PairingView {
	paired: boolean;
	url: string | null;
}

/** Conductor's personal organisation label when the account has no name (renderApp `tUi`). */
export const LOCAL_ORGANIZATION_LABEL = "My Mac";
/** The cloud mark's tooltip and screen-reader text (renderApp @10377244). */
export const CLOUD_ORGANIZATION_TEXT = "Cloud organization";
/** The page's launch reason while the active organisation is not known yet (renderApp `BXa`). */
export const CHECKING_ORGANIZATION = "Checking organization...";
/** The page's launch reason while data privacy keeps cloud work off (renderApp `BXa`). */
export const CLOUD_UNAVAILABLE_WITH_DATA_PRIVACY =
	"Cloud workspaces are unavailable when enterprise data privacy is enabled.";
/** The switcher menu's line while data privacy keeps cloud work off (renderApp `U9a`). */
export const ORGANIZATIONS_UNAVAILABLE_WITH_DATA_PRIVACY =
	"Organizations are unavailable when enterprise data privacy is enabled.";

/** The cloud entry's label: the Worker's host name, or the URL as written when it has none. */
export function workerLabel(url: string): string {
	try {
		const host = new URL(url).hostname;
		return host === "" ? url : host;
	} catch {
		return url;
	}
}

/** This Mac's entry, which every Mac has. */
export const LOCAL_ORGANIZATION: Organization = {
	id: "local",
	label: LOCAL_ORGANIZATION_LABEL,
	isCloud: false,
	url: null,
};

/** The switcher's entries: this Mac, and the paired Worker when there is one. */
export function organizationsFor(pairing: PairingView): Organization[] {
	if (!pairing.paired || pairing.url === null) return [LOCAL_ORGANIZATION];
	return [
		LOCAL_ORGANIZATION,
		{ id: "cloud", label: workerLabel(pairing.url), isCloud: true, url: pairing.url },
	];
}

/** The active entry: the stored choice when it is listed, else this Mac. */
export function activeOrganization(
	choice: string,
	organizations: readonly Organization[],
): Organization {
	return organizations.find((organization) => organization.id === choice) ?? LOCAL_ORGANIZATION;
}

/** True when `workspace` belongs to `organization`: this Mac's, or that Worker's. */
export function workspaceInOrganization(
	workspace: { host: Host },
	organization: Organization,
): boolean {
	if (workspace.host.kind === "local") return organization.id === "local";
	return organization.id === "cloud" && workspace.host.url === organization.url;
}

/** One project a cloud workspace can be made from, with the label the picker shows. */
export interface CloudRepository {
	repo: Repo;
	label: string;
	/** The HTTPS address the sandbox clones. */
	cloneUrl: string;
}

/**
 * The projects the Worker can clone, which are those with a GitHub remote, labelled by the
 * repository's name, or `owner/name` when two share a name, and sorted by label.
 */
export function cloudRepositories(repos: readonly Repo[]): CloudRepository[] {
	const github: { repo: Repo; owner: string; name: string }[] = [];
	for (const repo of repos) {
		if (repo.remoteUrl === null) continue;
		const parsed = githubRepositoryFromRemote(repo.remoteUrl);
		if (parsed.ok) github.push({ repo, owner: parsed.value.owner, name: parsed.value.name });
	}
	const seen = new Map<string, number>();
	for (const entry of github) {
		const key = entry.name.toLowerCase();
		seen.set(key, (seen.get(key) ?? 0) + 1);
	}
	return github
		.map((entry) => ({
			repo: entry.repo,
			label:
				(seen.get(entry.name.toLowerCase()) ?? 0) > 1 ? `${entry.owner}/${entry.name}` : entry.name,
			cloneUrl: `https://github.com/${entry.owner}/${entry.name}.git`,
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
}

/** What the Worker holds, as its readiness route answers (CLOUD-19). */
export interface CloudReadiness {
	github: boolean;
	agents: { anthropic: boolean; openai: boolean; cursor: boolean };
}

/** Where the new-workspace page stands with a cloud organisation active. */
export type CloudLaunchState =
	| { kind: "loading" }
	| { kind: "machine-not-ready" }
	| { kind: "github-access-required" }
	| { kind: "agent-credentials-required" }
	| { kind: "no-repos" }
	| { kind: "ready"; url: string };

/**
 * The launch state, in Conductor's order, mapped to the Worker: a check still running is loading; a
 * Worker that did not answer is a computer that is not ready; then GitHub, then an agent key, then
 * whether any project can be cloned.
 */
export function cloudLaunchState(input: {
	url: string;
	readiness: Loadable<CloudReadiness>;
	repositoryCount: number;
}): CloudLaunchState {
	const { readiness } = input;
	if (readiness.state === "loading") return { kind: "loading" };
	if (readiness.state === "error") return { kind: "machine-not-ready" };
	if (!readiness.data.github) return { kind: "github-access-required" };
	const agents = readiness.data.agents;
	if (!agents.anthropic && !agents.openai && !agents.cursor) {
		return { kind: "agent-credentials-required" };
	}
	if (input.repositoryCount === 0) return { kind: "no-repos" };
	return { kind: "ready", url: input.url };
}

/** Conductor's launch-disabled reason for a launch state (renderApp `OYa`); none when ready. */
export function cloudLaunchDisabledReason(state: CloudLaunchState): string | undefined {
	switch (state.kind) {
		case "loading":
			return "Checking machine availability...";
		case "github-access-required":
			return "Connect GitHub to create a cloud workspace.";
		case "agent-credentials-required":
			return "Set up an agent to create a cloud workspace.";
		case "machine-not-ready":
			return "Computer isn't ready yet.";
		case "no-repos":
			return "Add a repo to the computer to create a workspace.";
		case "ready":
			return undefined;
	}
}

/**
 * The line the page's top row shows in place of the repository picker (renderApp `AYa`). A ready
 * state reaches the line only while data privacy keeps the cloud off.
 */
export function cloudLaunchStatusLine(state: CloudLaunchState): string | undefined {
	switch (state.kind) {
		case "loading":
			return undefined;
		case "github-access-required":
			return "GitHub isn't connected.";
		case "agent-credentials-required":
			return "No agent set up yet.";
		case "machine-not-ready":
			return "Computer isn't ready yet.";
		case "no-repos":
			return "No repositories yet.";
		case "ready":
			return "Cloud unavailable with enterprise data privacy.";
	}
}
