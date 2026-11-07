/**
 * @feature catalogue More states of the Checks tab
 * Owns: arbor's pull request with a check in each state GitHub reports (passed, failed, cancelled,
 * waiting for an approval, skipped, and an outside service's status whose log the tab cannot
 * read), the deployments of a monorepo's previews, and a reviewer's comment to add to the chat;
 * and grove's pull request on relay, which deploys to the other providers the tab names.
 * Behaviour: ui-map.md 3.6, "Checks" paragraph (check states, Re-run, deployments by provider,
 * comments with "Add all to chat").
 * Test first: not applicable; the screenshot run opens every state.
 */
import { chatRoute, refreshGit, seedCast } from "../cast.ts";
import { click, shows } from "../dom.ts";
import type { ScriptedPr } from "../github.ts";
import type { CatalogueState, Scene } from "../state.ts";
import { CATALOGUE_NOW, DAY, HOUR, MINUTE } from "../time.ts";
import type { World } from "../world.ts";
import { COMMITTED_ONLY } from "./git.ts";

const openChecks = (document: Document): Promise<void> =>
	click(document, "button,[role=tab]", "Checks", { prefix: true });

/** arbor's pull request: the test job failed, e2e was cancelled, the preview deploy waits. */
const ARBOR_PR: ScriptedPr = {
	kind: "failing",
	number: 231,
	title: "Keep the requested page after sign-in",
	branch: "sam/fix-login-redirect",
	base: "main",
	createdAt: CATALOGUE_NOW - DAY,
	checks: [
		{
			kind: "run",
			name: "lint",
			workflow: "CI",
			status: "COMPLETED",
			conclusion: "SUCCESS",
			minutes: 1,
		},
		{
			kind: "run",
			name: "test",
			workflow: "CI",
			status: "COMPLETED",
			conclusion: "FAILURE",
			minutes: 4,
		},
		{
			kind: "run",
			name: "e2e",
			workflow: "CI",
			status: "COMPLETED",
			conclusion: "CANCELLED",
			minutes: 6,
		},
		{
			kind: "run",
			name: "docs",
			workflow: "Docs",
			status: "COMPLETED",
			conclusion: "SKIPPED",
			minutes: 0,
		},
		{
			kind: "run",
			name: "deploy-preview",
			workflow: "Deploy",
			status: "WAITING",
			conclusion: null,
			minutes: 0,
		},
		{
			kind: "status",
			context: "codecov/patch",
			state: "PENDING",
			url: "https://app.codecov.io/gh/acme/atlas/pull/231",
		},
	],
	deployments: [
		{
			environment: "Preview – web",
			state: "SUCCESS",
			url: "https://atlas-git-sam-fix-login-redirect-acme.vercel.app",
			at: CATALOGUE_NOW - 40 * MINUTE,
		},
		{
			environment: "preview (worker)",
			state: "IN_PROGRESS",
			url: "https://sam-fix-login-redirect.atlas-edge.workers.dev",
			at: CATALOGUE_NOW - 30 * MINUTE,
		},
		{
			environment: "api-pr-231",
			state: "FAILURE",
			url: "https://atlas-api-pr-231.fly.dev",
			at: CATALOGUE_NOW - 35 * MINUTE,
		},
		{
			environment: "deploy-preview-231 (docs)",
			state: "PENDING",
			url: "https://deploy-preview-231--atlas-docs.netlify.app",
			at: CATALOGUE_NOW - 20 * MINUTE,
		},
		{
			environment: "Preview – web",
			state: "INACTIVE",
			url: "https://atlas-1b2c3d-acme.vercel.app",
			at: CATALOGUE_NOW - 3 * HOUR,
		},
	],
	reviewComments: [
		{
			path: "src/auth/sign-in.ts",
			line: 7,
			body: "Should a refused next value be logged, so we can see if someone is trying it?",
			author: "lee",
			at: CATALOGUE_NOW - 2 * HOUR,
		},
	],
};

/** grove's Node 24 upgrade on relay: the service moved from Heroku to Railway and Render. */
const GROVE_PR: ScriptedPr = {
	kind: "ready",
	number: 218,
	title: "Upgrade to Node 24",
	branch: "sam/upgrade-node-24",
	base: "main",
	createdAt: CATALOGUE_NOW - 6 * HOUR,
	deployments: [
		{
			environment: "relay-api / pr-218",
			state: "SUCCESS",
			url: "https://relay-api-pr-218.up.railway.app",
			at: CATALOGUE_NOW - 3 * HOUR,
		},
		{
			environment: "relay-worker-pr-218",
			state: "SUCCESS",
			url: "https://relay-worker-pr-218.onrender.com",
			at: CATALOGUE_NOW - 3 * HOUR - 5 * MINUTE,
		},
		{
			environment: "dashboard (pr-218)",
			state: "IN_PROGRESS",
			url: "https://pr-218.d2k9relay.amplifyapp.com",
			at: CATALOGUE_NOW - 2 * HOUR,
		},
		{
			environment: "github-pages",
			state: "SUCCESS",
			url: "https://acme.github.io/relay/",
			at: CATALOGUE_NOW - 4 * HOUR,
		},
		{
			environment: "relay-staging",
			state: "INACTIVE",
			url: "https://relay-staging.herokuapp.com",
			at: CATALOGUE_NOW - 9 * DAY,
		},
	],
};

async function arborChecks(world: World): Promise<Scene> {
	const cast = await seedCast(world, { arborFiles: COMMITTED_ONLY, prs: [ARBOR_PR] });
	return {
		route: chatRoute(cast.arbor, cast.chats.arbor),
		after: async ({ app, document }) => {
			await refreshGit(app, cast.arbor);
			await openChecks(document);
			// An outside service's status has no job log for the tab to read.
			await click(document, "button", "codecov/patch", { prefix: true });
		},
		ready: (document) =>
			shows(document, "Add all to chat") && shows(document, "No logs available."),
	};
}

async function groveChecks(world: World): Promise<Scene> {
	const cast = await seedCast(world, { prs: [GROVE_PR] });
	return {
		route: chatRoute(cast.grove, cast.chats.grove),
		after: async ({ app, document }) => {
			await refreshGit(app, cast.grove);
			await openChecks(document);
		},
		ready: (document) => shows(document, "Deployments"),
	};
}

export const CHECKS_STATES: CatalogueState[] = [
	{
		id: "git-checks-mixed",
		group: "Git panel",
		title: "Checks tab: a check in every state, preview deployments and a review comment",
		seed: arborChecks,
	},
	{
		id: "git-checks-deployments",
		group: "Git panel",
		title: "Checks tab on relay: deployments on Railway, Render, Amplify, GitHub Pages and Heroku",
		seed: groveChecks,
	},
];
