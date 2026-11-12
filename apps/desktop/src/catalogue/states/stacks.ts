/**
 * @feature catalogue States of a stack of pull requests in the Changes tab
 * Owns: arbor's pull request as the top of a GitHub stack of three open pull requests on a merged
 * one, when one in the middle needs a rebase, when the bottom one is not ready (with Graphite
 * asking for a restack of its branch), when the whole stack can merge, the "Switch branch?" ask
 * when a checkout would move the files under a working agent, and arbor's branch in a Graphite
 * stack.
 * Behaviour: ui-map.md 3.6 ("Stack view: Stack PRs, Current, (trunk), gt restack, Checkout this
 * branch, Ready for review"), 5.2 ("Switch branch?"); services-map.md 3.8.1 (Graphite) and 3.8.2
 * (GitHub stacks and their readiness, whose rules live in core/status/stack-readiness.ts).
 * Test first: not applicable; the screenshot run opens every state.
 */

import type { Cast, GitWorld } from "../cast.ts";
import { click, has, shows } from "../dom.ts";
import type { ScriptedStack, ScriptedStackMember } from "../github.ts";
import { setLiveState } from "../live.ts";
import { setSetting } from "../seeds.ts";
import type { AfterContext, CatalogueState } from "../state.ts";
import type { World } from "../world.ts";
import { arborScene, prOf } from "./git.ts";

const SHA = {
	signInPage: "0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c",
	sessionStore: "2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d",
	sessionStoreOld: "7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e",
	safeNext: "4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f",
	/** arbor's head commit, as the scripted pull request reports it. */
	loginFix: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
	main: "8c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d",
};

const member = (fields: ScriptedStackMember): ScriptedStackMember => fields;

/** The stack, from trunk up, with each open member's merge state and the base it sits on. */
export function loginStack(options: {
	sessionStore?: string;
	/** The commit #230 was built on: #229's head, unless #229 moved on since. */
	safeNextBase?: string;
}): ScriptedStack {
	return {
		number: 12,
		baseRefName: "main",
		members: [
			member({
				number: 228,
				title: "Add the sign-in page",
				branch: "sam/sign-in-page",
				state: "merged",
				headSha: SHA.signInPage,
				baseSha: SHA.main,
				base: "main",
				mergeState: "UNKNOWN",
			}),
			member({
				number: 229,
				title: "Store sessions in Redis",
				branch: "sam/session-store",
				state: "open",
				headSha: SHA.sessionStore,
				baseSha: SHA.main,
				base: "main",
				mergeState: options.sessionStore ?? "CLEAN",
			}),
			member({
				number: 230,
				title: "Add safeNext with tests",
				branch: "sam/safe-next",
				state: "open",
				headSha: SHA.safeNext,
				baseSha: options.safeNextBase ?? SHA.sessionStore,
				base: "sam/session-store",
				mergeState: "CLEAN",
			}),
			member({
				number: 231,
				title: "Keep the requested page after sign-in",
				branch: "sam/fix-login-redirect",
				state: "open",
				headSha: SHA.loginFix,
				baseSha: SHA.safeNext,
				base: "sam/safe-next",
				mergeState: "CLEAN",
			}),
		],
	};
}

/** arbor's pull request, approved with its checks passed, at the top of `stack`. */
export const stacked = (stack: ScriptedStack, extra: Partial<GitWorld> = {}): GitWorld => ({
	...prOf("ready"),
	stacks: [stack],
	...extra,
});

/** A stack state: arbor open on its chat with the Changes tab beside it. */
const stackState = (
	id: string,
	title: string,
	git: GitWorld,
	text: string,
	options: {
		before?: (world: World) => Promise<void>;
		after?: (context: AfterContext, cast: Cast) => Promise<void>;
	} = {},
): CatalogueState => ({
	id,
	group: "Stacked pull requests",
	title,
	seed: async (world) => {
		await options.before?.(world);
		return arborScene({
			git,
			after: options.after,
			ready: (document) => shows(document, text),
		})(world);
	},
});

/** Graphite knows the bottom branch of the stack and says it needs a restack. */
const GRAPHITE_SESSION_STORE = {
	main: { trunk: true },
	"sam/session-store": { needs_restack: true, parents: [{ ref: "main", sha: SHA.main }] },
};

/** arbor's branch in a Graphite stack of three on main; the bottom one needs a restack. */
const GRAPHITE_LOGIN_STACK = {
	main: { trunk: true },
	"sam/session-store": { needs_restack: true, parents: [{ ref: "main", sha: SHA.main }] },
	"sam/fix-login-redirect": {
		parents: [{ ref: "sam/session-store", sha: SHA.sessionStore }],
	},
	"sam/redirect-docs": {
		parents: [{ ref: "sam/fix-login-redirect", sha: SHA.loginFix }],
	},
};

const turnOnGraphite = (world: World) => setSetting(world, "graphite_disabled", false);

export const STACK_STATES: CatalogueState[] = [
	stackState(
		"stack-needs-rebase",
		"GitHub stack: the middle pull request no longer sits on the one below it",
		stacked(loginStack({ safeNextBase: SHA.sessionStoreOld })),
		"Needs rebase",
	),
	stackState(
		"stack-not-ready",
		"GitHub stack: the bottom pull request is not ready, and Graphite asks for a restack",
		stacked(loginStack({ sessionStore: "BLOCKED" }), { graphiteState: GRAPHITE_SESSION_STORE }),
		"Blocked downstack",
		{ before: turnOnGraphite },
	),
	stackState(
		"stack-ready",
		"GitHub stack: every pull request can merge, Merge stack in the header",
		stacked(loginStack({})),
		"Merge stack",
	),
	stackState(
		"stack-switch-branch",
		"GitHub stack: checking out another branch while the agent works asks first",
		stacked(loginStack({ sessionStore: "BLOCKED" })),
		"Switch anyway",
		{
			after: async ({ world, document }, cast) => {
				// arbor's agent is working on a turn, so moving its files asks first.
				setLiveState(world, cast.chats.arbor.id, {});
				// #229's row: the trunk's row comes first, then the merged #228.
				await click(
					document,
					"li[data-testid=stack-entry]:nth-of-type(3) button",
					"Checkout this branch",
				);
			},
		},
	),
	{
		id: "graphite-stack",
		group: "Stacked pull requests",
		title: "Graphite stack: arbor's branch between its parent and a branch built on it",
		seed: async (world) => {
			await turnOnGraphite(world);
			return arborScene({
				git: { ...prOf("ready"), graphiteState: GRAPHITE_LOGIN_STACK },
				ready: (document) =>
					has(document, "[role=img]", "This branch needs to be restacked. Use gt restack"),
			})(world);
		},
	},
];
