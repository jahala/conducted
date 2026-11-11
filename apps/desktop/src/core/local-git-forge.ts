/**
 * @feature GIT-14 Local-git forge: pull request state for repositories without GitHub
 * Owns: the capabilities that tell the screens a local-git repository has no remote actions. The
 * local-git forge service and the Git header share them.
 * Behaviour: services-map.md 3.1 (local git instead of GitHub).
 */
export interface ForgeCapabilities {
	remoteRequests: boolean;
	markReady: boolean;
	merge: boolean;
	autoMerge: boolean;
}

export const GITHUB_FORGE_CAPABILITIES: ForgeCapabilities = {
	remoteRequests: true,
	markReady: true,
	merge: true,
	autoMerge: true,
};

export const LOCAL_GIT_FORGE_CAPABILITIES: ForgeCapabilities = {
	remoteRequests: false,
	markReady: false,
	merge: false,
	autoMerge: false,
};

/** The capabilities of one forge. Only GitHub can act on the remote. */
export function capabilitiesFor(forge: "github" | "local"): ForgeCapabilities {
	return forge === "github" ? GITHUB_FORGE_CAPABILITIES : LOCAL_GIT_FORGE_CAPABILITIES;
}
