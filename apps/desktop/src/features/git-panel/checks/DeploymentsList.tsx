/**
 * @feature PR-04 Deployments list
 * Owns: the Deployments section of the Checks tab. One row per deployment with environment,
 * state, provider mark and a link to the deployed URL.
 * Behaviour: ui-map.md 3.6, "Checks" paragraph (states Deployed, Failed, Deploying, Pending,
 * Inactive; providers Vercel, Cloudflare, Netlify, Render, Railway, Fly.io, AWS Amplify, Heroku,
 * GitHub Pages); services-map.md 3.7.2 (deployments(first:20), newest first).
 * Must handle: no deployments (section hidden), an unknown provider (generic mark), a failed
 * deployment (link to its log if one exists), and an inactive deployment (muted).
 * Test first: three deployments render newest first and an unknown provider shows the generic mark.
 */
import { notImplemented } from "@conducted/shared";
import type { DeploymentView } from "../../../core/model.ts";

export interface DeploymentsListProps {
	deployments: DeploymentView[];
	onOpenUrl: (url: string) => void;
}

export function DeploymentsList(_props: DeploymentsListProps): never {
	return notImplemented("PR-04");
}
