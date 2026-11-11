/**
 * @feature SET-03 Agent card
 * Owns: one agent program's tab panel on the Agents page. Whether it is installed, its version and
 * path, the sign-in state with its action, and the way into its provider forms.
 * Measured from Conductor 0.92.1 (the owner's capture of Settings > Agents, renderApp
 * @10925048-11010000): an "Authentication" heading over two 124px choice cards, "CLI" with a terminal
 * icon and "API key" with a key icon, the one in use filled and checked; a status line with a dot and
 * "Connected" and a small ghost "Refresh" with a turning-arrows icon at the right, which spins and
 * waits while the check runs (renderApp Mci); a bordered fixed table of facts with a 128 px label
 * column on a faint muted fill and 8 by 12 px cells (renderApp uFa); and an outlined sign-in button.
 * Our design choice: the table lists the facts the install check returns (version, path, login method,
 * source); Conductor's Provider, Organization and Email rows need account data the install check does
 * not return. Choosing "CLI" starts the sign-in, and "API key" opens the provider forms, where keys are
 * entered.
 * Behaviour: ui-map.md 6, "Agents page" (one card per provider; states "Loaded from env", "API key
 * configured", "Validation failed"). The app's own copy gets no badge (D098).
 * Data: the parent passes one AgentInstall from useAgentInstalls().
 * The program manager downloads, updates and removes programs (PLAT-28, D021); this card shows
 * what the catalogue reports. A missing program shows how to install it and a Refresh action; a
 * missing Cursor points to the Advanced page, where the app installs its SDK (AGENT-09).
 * The parent may also pass one action that opens the agent's own config editor (SET-12).
 * Must handle: not installed, installed but not signed in, signed in, signed in status unknown,
 * version check failed, a custom path in use (marked), a long path (middle truncation, copyable),
 * sign-in in flight, and the ACP agents OpenCode and Pi sharing one agent kind (the card shows the
 * ACP name, not "acp").
 * Test first: an installed, unauthenticated Claude card shows a Sign in button and an
 * authenticated one shows the signed-in state without it.
 */
import type { AgentInstall } from "@conducted/protocol";
import type { ReactNode } from "react";
import { agentDisplayName } from "../../../core/agent-catalog.ts";
import { Badge, type BadgeTone } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";
import { cn } from "../../../ui/cn.ts";
import { CheckIcon, KeyIcon, PlayIcon, TerminalIcon } from "../../../ui/icons.tsx";
import { truncateMiddle } from "../../../ui/TruncatedText.tsx";
import { RefreshButton } from "../RefreshButton.tsx";

/** Characters of a program path shown before the middle is cut. */
const PATH_LENGTH = 52;

export interface AgentCardProps {
	install: AgentInstall;
	signInBusy: boolean;
	onSignIn: () => void;
	onRefresh: () => void;
	/** True while a refresh runs: the Refresh icon spins and the button waits. */
	refreshing?: boolean;
	/** Opens the agent's Providers dialog. Left out when the page has no provider forms. */
	onProviders?: () => void;
	/** Copies the program path. Left out when the page has no clipboard action. */
	onCopyPath?: (path: string) => void;
	/** Opens the agent's own config file, when the agent has one (SET-12). */
	configAction?: { label: string; onClick: () => void };
	/**
	 * Offered beside a warning when the page passes it. The Agents page passes none: the research
	 * shows no update action on an agent card (an open PLAT-28 item).
	 */
	onUpdate?: () => void;
	/** Agent-specific settings shown under the sign-in, such as Claude's Chrome switch. */
	children?: ReactNode;
}

/** What the card calls the program's source, in Conductor's words (ui-map.md 6). */
/**
 * How to get a missing agent. Cursor runs through its SDK, which the app installs on the Advanced
 * page and never bundles (AGENT-09, D083); every other agent is a program on this Mac.
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
	// The app's own copy is the normal case; Conductor's card marks it with no badge (D098).
	if (install.source === "managed") return null;
	if (install.source === "user") return { label: "Custom path", tone: "neutral" };
	return null;
}

const authMethodLabel = (method: string): string => {
	if (method === "chatgpt") return "ChatGPT plan";
	if (method === "api_key") return "API key";
	if (method === "bedrock") return "Amazon Bedrock";
	return method;
};

function statusLine(install: AgentInstall): { label: string; dot: string } {
	if (!install.installed) return { label: "Not installed", dot: "bg-fg-muted" };
	if (install.authenticated === true) return { label: "Connected", dot: "bg-success" };
	if (install.authenticated === false) return { label: "Not signed in", dot: "bg-warning" };
	return { label: "Sign-in status unknown", dot: "bg-fg-muted" };
}

function AuthChoice({
	label,
	icon,
	selected,
	disabled,
	onClick,
}: {
	label: string;
	icon: ReactNode;
	selected: boolean;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			disabled={disabled}
			onClick={onClick}
			className={cn(
				"relative flex h-23 flex-col items-center justify-center gap-2 rounded-md border text-sm font-medium text-fg outline-none transition-colors",
				"focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50",
				selected ? "border-transparent bg-active" : "border-border hover:bg-hover",
			)}
		>
			{selected ? <CheckIcon className="absolute top-4 right-4 size-4 text-fg-muted" /> : null}
			<span className="text-fg-muted">{icon}</span>
			{label}
		</button>
	);
}

/** One row of Conductor's facts table (renderApp dFa): a 128 px muted label cell, then the value. */
function FactRow({ label, children }: { label: string; children: ReactNode }) {
	return (
		<tr className="border-b border-border last:border-0">
			<th
				scope="row"
				className="w-32 bg-muted/40 px-3 py-2 text-left align-top font-normal text-fg-muted"
			>
				{label}
			</th>
			<td className="min-w-0 truncate px-3 py-2 text-fg">{children}</td>
		</tr>
	);
}

/**
 * The command Conductor's CLI sign-in button names, "Run claude /login" (renderApp @10941717). It
 * shows while the CLI is the sign-in in use, signed in or not, as in the owner's capture.
 */
const LOGIN_COMMANDS: Readonly<Partial<Record<string, string>>> = {
	claude: "claude /login",
	codex: "codex login",
};

export function AgentCard({
	install,
	signInBusy,
	onSignIn,
	onRefresh,
	refreshing = false,
	onProviders,
	onCopyPath,
	onUpdate,
	configAction,
	children,
}: AgentCardProps) {
	const name = agentDisplayName(install);
	const state = agentState(install);
	const notInstalled = !install.installed;
	const status = statusLine(install);
	const usesKey = install.authMethod === "api_key";
	const loginCommand = LOGIN_COMMANDS[install.agent];

	return (
		<section aria-label={name} className="flex flex-col gap-6">
			<h3 className="sr-only">{name}</h3>
			<div className="flex flex-col gap-3">
				<h4 className="text-sm font-medium text-fg">Authentication</h4>
				<div className="grid grid-cols-2 gap-3">
					<AuthChoice
						label="CLI"
						icon={<TerminalIcon className="size-6" />}
						selected={!notInstalled && !usesKey}
						disabled={notInstalled || signInBusy}
						onClick={() => {
							if (install.authenticated !== true || usesKey) onSignIn();
						}}
					/>
					<AuthChoice
						label="API key"
						icon={<KeyIcon className="size-6" />}
						selected={!notInstalled && usesKey}
						disabled={notInstalled || onProviders === undefined}
						onClick={() => onProviders?.()}
					/>
				</div>
			</div>

			<div className="flex flex-col gap-3">
				<div className="flex items-center gap-2">
					<span aria-hidden="true" className={cn("size-2 rounded-full", status.dot)} />
					<span className="text-sm text-fg">{status.label}</span>
					{state ? <Badge tone={state.tone}>{state.label}</Badge> : null}
					<span className="flex-1" />
					<RefreshButton refreshing={refreshing} onRefresh={onRefresh} />
				</div>

				{notInstalled ? (
					<p className={cn("text-sm", install.warning ? "text-danger" : "text-fg-muted")}>
						{install.warning ?? installHelp(install, name)}
					</p>
				) : (
					<div className="w-full overflow-hidden rounded-md border border-border">
						<table className="w-full table-fixed text-sm">
							<tbody>
								<FactRow label="Version">{install.version ?? "Unknown"}</FactRow>
								{install.path !== undefined ? (
									<FactRow label="Path">
										<span className="flex min-w-0 items-center gap-2">
											<code
												className="min-w-0 flex-1 truncate font-mono text-xs"
												title={install.path}
											>
												{truncateMiddle(install.path, PATH_LENGTH)}
											</code>
											{onCopyPath ? (
												<Button
													size="xs"
													variant="ghost"
													onClick={() => onCopyPath(install.path ?? "")}
												>
													Copy
												</Button>
											) : null}
										</span>
									</FactRow>
								) : null}
								<FactRow label="Login method">
									{install.authenticated === true
										? install.authMethod === undefined
											? "Signed in"
											: authMethodLabel(install.authMethod)
										: install.authenticated === false
											? "Not signed in"
											: "Unknown"}
								</FactRow>
							</tbody>
						</table>
					</div>
				)}

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

				{notInstalled ? null : (
					<div className="flex flex-wrap items-center gap-2">
						{loginCommand !== undefined && !usesKey ? (
							<Button size="sm" variant="outline" loading={signInBusy} onClick={onSignIn}>
								<PlayIcon className="size-3" />
								Run {loginCommand}
							</Button>
						) : install.authenticated !== true ? (
							<Button size="sm" variant="outline" loading={signInBusy} onClick={onSignIn}>
								Sign in
							</Button>
						) : null}
						{onProviders ? (
							<Button size="sm" variant="outline" onClick={onProviders}>
								Providers
							</Button>
						) : null}
					</div>
				)}
			</div>

			{children === undefined ? null : (
				<div className="border-t border-border pt-2">{children}</div>
			)}

			{configAction ? (
				<div className="flex items-center justify-between gap-3 rounded-md border border-border px-5 py-4">
					<span className="text-sm font-medium text-fg">{configAction.label}</span>
					<Button
						size="sm"
						variant="outline"
						aria-label={configAction.label}
						onClick={configAction.onClick}
					>
						Edit
					</Button>
				</div>
			) : null}
		</section>
	);
}
