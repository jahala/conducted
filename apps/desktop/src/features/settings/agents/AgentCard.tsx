/**
 * @feature SET-03 Agent card
 * Owns: one agent program on the Agents page. Name, whether it is installed, version, path, the
 * sign-in state with its action, and the way into its provider forms.
 * Behaviour: ui-map.md 6, "Agents page" (one card per provider; states "Loaded from env", "API key
 * configured", "Validation failed", "Recommended").
 * Data: the parent passes one AgentInstall from useAgentInstalls().
 * The program manager downloads, updates and removes programs (PLAT-28, D021); this card shows
 * what the catalogue reports. A missing program shows how to install it and a Refresh action; a
 * missing Cursor points to the Advanced page, where the app installs its SDK (AGENT-09).
 * Must handle: not installed, installed but not signed in, signed in, signed in status unknown,
 * version check failed, a custom path in use (marked), a long path (middle truncation, copyable),
 * sign-in in flight, and the ACP agents OpenCode and Pi sharing one agent kind (the card shows the
 * ACP name, not "acp").
 * Test first: an installed, unauthenticated Claude card shows a Sign in button and an
 * authenticated one shows the signed-in state without it.
 */
import type { AgentInstall } from "@conducted/protocol";
import { agentDisplayName } from "../../../core/services/agent-catalog.ts";
import { Badge, type BadgeTone } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";
import { truncateMiddle } from "../../../ui/TruncatedText.tsx";

/** Characters of a program path shown before the middle is cut. */
const PATH_LENGTH = 52;

export interface AgentCardProps {
	install: AgentInstall;
	signInBusy: boolean;
	onSignIn: () => void;
	onRefresh: () => void;
	/** Opens the agent's Providers dialog. Left out when the page has no provider forms. */
	onProviders?: () => void;
	/** Copies the program path. Left out when the page has no clipboard action. */
	onCopyPath?: (path: string) => void;
	/**
	 * Offered beside a warning when the page passes it. The Agents page passes none: the research
	 * shows no update action on an agent card (an open PLAT-28 item).
	 */
	onUpdate?: () => void;
}

/** What the card calls the program's source, in Conductor's words (ui-map.md 6). */
/**
 * How to get a missing agent. Cursor runs through its SDK, which the app installs on the Advanced
 * page and never bundles (AGENT-09, D078); every other agent is a program on this Mac.
 */
function installHelp(install: AgentInstall, name: string): string {
	if (install.agent === "cursor") {
		return "Install the Cursor SDK on the Advanced page, then choose Refresh.";
	}
	return `Install ${name} on this Mac, then choose Refresh.`;
}

export function agentState(install: AgentInstall): { label: string; tone: BadgeTone } | null {
	if (install.warning !== undefined) return { label: "Validation failed", tone: "danger" };
	if (!install.installed) return null;
	if (install.authMethod === "api_key") return { label: "API key configured", tone: "neutral" };
	if (install.source === "login_path") return { label: "Loaded from env", tone: "neutral" };
	if (install.source === "managed") return { label: "Recommended", tone: "success" };
	if (install.source === "user") return { label: "Custom path", tone: "neutral" };
	return null;
}

const authMethodLabel = (method: string): string => {
	if (method === "chatgpt") return "ChatGPT plan";
	if (method === "api_key") return "API key";
	if (method === "bedrock") return "Amazon Bedrock";
	return method;
};

export function AgentCard({
	install,
	signInBusy,
	onSignIn,
	onRefresh,
	onProviders,
	onCopyPath,
	onUpdate,
}: AgentCardProps) {
	const name = agentDisplayName(install);
	const state = agentState(install);
	const notInstalled = !install.installed;

	return (
		<section
			aria-label={name}
			className="flex flex-col gap-3 rounded-md border border-border bg-raised p-4"
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="text-sm font-medium text-fg">{name}</h3>
						{state ? <Badge tone={state.tone}>{state.label}</Badge> : null}
					</div>
					{notInstalled ? (
						<p className={`mt-1 text-sm ${install.warning ? "text-danger" : "text-fg-muted"}`}>
							{install.warning ?? installHelp(install, name)}
						</p>
					) : (
						<p className="mt-1 text-xs text-fg-muted">
							{install.version === undefined ? "Version unknown" : `Version ${install.version}`}
						</p>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{!notInstalled && onProviders ? (
						<Button size="sm" variant="secondary" onClick={onProviders}>
							Providers
						</Button>
					) : null}
					{!notInstalled && install.authenticated !== true ? (
						<Button size="sm" variant="default" loading={signInBusy} onClick={onSignIn}>
							Sign in
						</Button>
					) : null}
					{notInstalled ? (
						<Button size="sm" variant="secondary" onClick={onRefresh}>
							Refresh
						</Button>
					) : null}
				</div>
			</div>

			{!notInstalled && install.path !== undefined ? (
				<div className="flex items-center gap-2">
					<code
						className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted"
						title={install.path}
					>
						{truncateMiddle(install.path, PATH_LENGTH)}
					</code>
					{onCopyPath ? (
						<Button size="xs" variant="ghost" onClick={() => onCopyPath(install.path ?? "")}>
							Copy
						</Button>
					) : null}
				</div>
			) : null}

			{!notInstalled ? (
				<div className="flex flex-wrap items-center gap-2 text-xs">
					{install.authenticated === true ? (
						<span className="text-success">Signed in</span>
					) : install.authenticated === false ? (
						<span className="text-fg-muted">Not signed in</span>
					) : (
						<span className="text-fg-muted">Sign-in status unknown</span>
					)}
					{install.authenticated === true && install.authMethod !== undefined ? (
						<span className="text-fg-muted">· {authMethodLabel(install.authMethod)}</span>
					) : null}
				</div>
			) : null}

			{install.warning !== undefined && install.installed ? (
				<div className="flex items-start justify-between gap-3">
					<p className="text-sm text-danger">{install.warning}</p>
					{onUpdate ? (
						<Button size="sm" variant="secondary" onClick={onUpdate}>
							Update
						</Button>
					) : null}
				</div>
			) : null}
		</section>
	);
}
