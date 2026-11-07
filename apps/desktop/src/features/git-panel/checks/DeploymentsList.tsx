/**
 * @feature PR-04 Deployments list
 * Owns: the Deployments section of the Checks tab. One row per deployment with environment,
 * state, provider mark and an "Open externally" button for the deployed URL (Conductor's name,
 * renderApp @2269203).
 * Behaviour: ui-map.md 3.6, "Checks" paragraph (states Deployed, Failed, Deploying, Pending,
 * Inactive; providers Vercel, Cloudflare, Netlify, Render, Railway, Fly.io, AWS Amplify, Heroku,
 * GitHub Pages); services-map.md 3.7.2 (deployments(first:20), newest first).
 * Must handle: no deployments (section hidden), an unknown provider (generic mark), a failed
 * deployment (its URL opens the deployment), and an inactive deployment (muted).
 * Test first: three deployments render newest first and an unknown provider shows the generic mark.
 */
import type { DeploymentProvider, DeploymentState, DeploymentView } from "../../../core/model.ts";
import { Badge, type BadgeTone } from "../../../ui/Badge.tsx";
import { IconButton } from "../../../ui/IconButton.tsx";
import { ArrowUpRightIcon, GlobeIcon } from "../../../ui/icons.tsx";

export interface DeploymentsListProps {
	deployments: DeploymentView[];
	onOpenUrl: (url: string) => void;
}

const PROVIDER_LABEL: Readonly<Record<DeploymentProvider, string>> = {
	vercel: "Vercel",
	cloudflare: "Cloudflare",
	netlify: "Netlify",
	render: "Render",
	railway: "Railway",
	fly: "Fly.io",
	amplify: "AWS Amplify",
	heroku: "Heroku",
	github_pages: "GitHub Pages",
	other: "Other",
};

const STATE_LABEL: Readonly<Record<DeploymentState, string>> = {
	pending: "Pending",
	deploying: "Deploying",
	deployed: "Deployed",
	failed: "Failed",
	inactive: "Inactive",
};

const STATE_TONE: Readonly<Record<DeploymentState, BadgeTone>> = {
	pending: "warning",
	deploying: "warning",
	deployed: "success",
	failed: "danger",
	inactive: "neutral",
};

export function deploymentProviderLabel(provider: DeploymentProvider): string {
	return PROVIDER_LABEL[provider];
}

function ProviderMark({ provider }: { provider: DeploymentProvider }) {
	if (provider === "other") {
		return (
			<span
				role="img"
				aria-label="Other deployment provider"
				className="flex size-4 shrink-0 items-center justify-center text-fg-subtle"
			>
				<GlobeIcon className="size-4" />
			</span>
		);
	}
	const label = PROVIDER_LABEL[provider];
	return (
		<span
			role="img"
			aria-label={`${label} deployment`}
			title={label}
			className="flex size-4 shrink-0 items-center justify-center rounded-xs bg-surface text-2xs font-medium text-fg-muted"
		>
			{label.slice(0, 1)}
		</span>
	);
}

export function DeploymentsList({ deployments, onOpenUrl }: DeploymentsListProps) {
	if (deployments.length === 0) return null;
	const newestFirst = [...deployments].sort((left, right) => right.updatedAt - left.updatedAt);

	return (
		<section aria-label="Deployments" className="border-b border-separator">
			<h3 className="px-[18px] py-2 text-xs font-medium text-fg-muted">Deployments</h3>
			<ul className="m-0 list-none p-0">
				{newestFirst.map((deployment) => {
					const inactive = deployment.state === "inactive";
					const url = deployment.url;
					return (
						<li
							key={`${deployment.environment}-${deployment.updatedAt}`}
							data-testid="deployment-row"
							className="flex items-center gap-2 px-2 py-1.5"
						>
							<ProviderMark provider={deployment.provider} />
							<span
								className={
									inactive
										? "min-w-0 flex-1 truncate text-sm text-fg-subtle"
										: "min-w-0 flex-1 truncate text-sm text-fg"
								}
							>
								{deployment.environment}
							</span>
							<Badge tone={STATE_TONE[deployment.state]}>{STATE_LABEL[deployment.state]}</Badge>
							{url === null ? null : (
								<IconButton
									label="Open externally"
									icon={<ArrowUpRightIcon className="size-3.5" />}
									size="xs"
									className="text-fg-muted hover:text-fg"
									onClick={() => onOpenUrl(url)}
								/>
							)}
						</li>
					);
				})}
			</ul>
		</section>
	);
}
