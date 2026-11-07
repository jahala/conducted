/**
 * @feature SET-02 Account settings page
 * Owns: the Account page of Settings, local parts only: GitHub access through the `gh` command, a
 * personal access token, the Linear API key, data privacy, and tool approval modes.
 * Behaviour: ui-map.md 6, "Account" table. Left out: the Conductor account, billing, sign out and
 * every hosted sign-in (D004, D025, D035: they need a service we do not have).
 * Measured from Conductor 0.92.1 (renderApp @11052485-11098059 and the owner's capture): a profile
 * header (a 64px round avatar, the name in 18px medium, muted lines under it) over a rule, then one row
 * per connection: a 40px bordered tile with the service's mark, the name and a muted description, and
 * the actions at the right ("Manage" with a check when connected, "Connect" when not); then the
 * setting rows (data privacy, tool approvals).
 * Our design choice: the header shows the GitHub sign-in: its avatar and login, with the letter when
 * the avatar cannot load. Conductor's "Edit photo" and "Display name" are not built: there is nowhere
 * to keep them yet. As in Conductor (renderApp $Ba @11051777), the GitHub row has one button,
 * "Manage" with a check or "Connect", that opens the "GitHub" dialog ("Choose how Conducted
 * authenticates GitHub operations on your machine."); ours holds the sign-in state with Check again,
 * the sign-in method, the token field and Disconnect there. The Linear key field opens under the
 * Linear row from "Connect"; the service marks are our own glyphs (D002).
 * Data: useGitHubAccess() for the `gh` status, useLinearAccess() for the Linear connection, the
 * GitHub store for the failure class,
 * RegistrySettingRowByKey for stored values, Actions.accounts for the token and Linear key.
 * Our design choice: the page never starts `gh auth login`, because it is interactive. It shows the
 * command with a copy button and a "Check again" action. A token that does not look like a GitHub
 * token is saved only after the user confirms the warning.
 * Must handle: `gh` not installed (install help and no sign-in command), signed out, the
 * saml-sso-required and missing-scope failure classes, a token warning before saving, the Keychain
 * refusing a write (message, nothing shown as saved), and disconnecting GitHub or Linear after a
 * confirmation.
 * Test first: with `gh` not installed the page shows the install help and no sign-in command.
 */
import { type ReactNode, useState } from "react";
import { useStore } from "zustand";
import { useServices } from "../../../core/context.tsx";
import { useActions, useGitHubAccess, useLinearAccess } from "../../../core/hooks.ts";
import { githubFailureMessage, githubTokenWarning } from "../../../core/services/github.ts";
import { AlertDialog, AlertDialogContent } from "../../../ui/AlertDialog.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../../ui/Dialog.tsx";
import { Input, Label } from "../../../ui/Input.tsx";
import { CheckIcon, GitBranchIcon, ListTodoIcon, RefreshIcon } from "../../../ui/icons.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { toast, toastError } from "../../../ui/Toast.tsx";
import { RegistrySettingRowByKey } from "../SettingRow.tsx";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";

export function AccountPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	const actions = useActions();
	const services = useServices().services;
	const access = useGitHubAccess();
	const linearAccess = useLinearAccess();
	const raw = useStore(services.github.store, (state) => state.access);
	const [githubOpen, setGithubOpen] = useState(false);
	const [token, setToken] = useState("");
	const [pendingWarning, setPendingWarning] = useState<string | null>(null);
	const [tokenError, setTokenError] = useState<string | null>(null);
	const [disconnectGithub, setDisconnectGithub] = useState(false);
	const [linearKey, setLinearKey] = useState("");
	const [linearError, setLinearError] = useState<string | null>(null);
	const [disconnectLinear, setDisconnectLinear] = useState(false);
	const [savingLinear, setSavingLinear] = useState(false);
	const [linearFormOpen, setLinearFormOpen] = useState(false);
	const [avatarFailed, setAvatarFailed] = useState(false);

	const failure = raw.status === "signed_out" ? raw.failure : undefined;
	const failureMessage = failure === undefined ? null : githubFailureMessage(failure, "");

	const checkAgain = async () => {
		const result = await actions.app.recheckGitHubAccess();
		if (!result.ok) toastError("Couldn't check GitHub access", result.error);
	};

	const copy = async (text: string, message: string) => {
		const result = await actions.app.copyText(text);
		if (!result.ok) toastError("Couldn't copy to the clipboard", result.error);
		else toast(message);
	};

	const commitToken = async (value: string) => {
		const saved = await actions.accounts.setGitHubToken(value);
		if (!saved.ok) {
			setTokenError(saved.error.message);
			return;
		}
		setToken("");
		setTokenError(null);
		toast("GitHub token saved");
	};

	const saveToken = async () => {
		const value = token.trim();
		if (value === "") return;
		const warning = githubTokenWarning(value);
		if (warning !== null) {
			setPendingWarning(warning);
			return;
		}
		await commitToken(value);
	};

	const saveLinearKey = async () => {
		const value = linearKey.trim();
		if (value === "") return;
		setSavingLinear(true);
		const saved = await actions.accounts.setLinearKey(value);
		setSavingLinear(false);
		if (!saved.ok) {
			setLinearError(saved.error.message);
			return;
		}
		setLinearKey("");
		setLinearError(null);
		setLinearFormOpen(false);
		toast("Linear key saved");
	};

	const signedIn = access.state === "ready" && access.data.state === "signed_in";

	return (
		<SettingsPageFrame
			title="Account"
			description={null}
			{...load}
			focusSettingKey={focusSettingKey}
		>
			<ProfileHeader
				login={
					signedIn && access.state === "ready" && access.data.state === "signed_in"
						? access.data.login
						: null
				}
				detail={
					access.state === "ready" && access.data.state === "signed_in"
						? access.data.usesToken
							? `Signed in to ${access.data.host} with a personal access token`
							: `Signed in to ${access.data.host} with gh`
						: "Not signed in to GitHub"
				}
				avatarFailed={avatarFailed}
				onAvatarError={() => setAvatarFailed(true)}
			/>

			<ConnectionRow
				icon={<GitBranchIcon className="size-5" />}
				title="GitHub"
				description="Connect GitHub to clone repos, create PRs, load comments and more."
				actions={
					// Conductor's one button: Manage with a check when connected, else Connect; both open
					// the GitHub dialog that holds the sign-in, the token and the method.
					<Button variant="outline" onClick={() => setGithubOpen(true)}>
						{signedIn ? "Manage" : "Connect"}
						{signedIn ? <CheckIcon aria-hidden="true" className="size-3.5 text-success" /> : null}
					</Button>
				}
			/>

			<ConnectionRow
				icon={<ListTodoIcon className="size-5" />}
				title="Linear"
				description="Connect Linear so Conducted can use issue context from your account."
				actions={
					linearAccess.state === "ready" &&
					(linearAccess.data.state === "signed_in" ||
						linearAccess.data.state === "key_rejected") ? (
						<Button
							variant="outlineDestructive"
							size="sm"
							onClick={() => setDisconnectLinear(true)}
						>
							Disconnect Linear
						</Button>
					) : (
						<Button
							variant="outline"
							aria-expanded={linearFormOpen}
							aria-controls="linear-key-form"
							onClick={() => setLinearFormOpen((open) => !open)}
						>
							Connect
						</Button>
					)
				}
			>
				{linearAccess.state === "loading" ? <Skeleton className="h-5 w-56" /> : null}
				{linearAccess.state === "error" ? (
					<p role="alert" className="text-xs text-danger">
						{linearAccess.error.message}
					</p>
				) : null}
				{linearAccess.state === "ready" ? (
					linearAccess.data.state === "signed_in" ? (
						<p className="text-sm text-fg">
							Connected as {linearAccess.data.name}
							{linearAccess.data.organization === null
								? ""
								: ` (${linearAccess.data.organization})`}
						</p>
					) : linearAccess.data.state === "key_rejected" ? (
						<p role="alert" className="text-xs text-danger">
							Linear rejected the API key. Enter a new key.
						</p>
					) : (
						<p className="text-sm text-fg-muted">Not connected</p>
					)
				) : null}
				{linearFormOpen ||
				(linearAccess.state === "ready" && linearAccess.data.state === "key_rejected") ? (
					<div id="linear-key-form" className="flex flex-col gap-2 pt-2">
						<Label htmlFor="linear-key">Linear API key</Label>
						<p className="text-sm text-fg-muted">
							A personal Linear API key, stored in the Keychain. It is never shown again.
						</p>
						<div className="flex items-end gap-2">
							<Input
								id="linear-key"
								type="password"
								value={linearKey}
								autoComplete="off"
								className="w-72"
								onChange={(event) => {
									setLinearKey(event.target.value);
									setLinearError(null);
								}}
							/>
							<Button variant="outline" loading={savingLinear} onClick={() => void saveLinearKey()}>
								Save key
							</Button>
						</div>
						{linearError ? (
							<p role="alert" className="text-xs text-danger">
								{linearError}
							</p>
						) : null}
					</div>
				) : null}
			</ConnectionRow>

			<RegistrySettingRowByKey
				settingKey="enterprise_data_privacy"
				focusSettingKey={focusSettingKey}
			/>
			<RegistrySettingRowByKey
				settingKey="tool_approvals_enabled"
				focusSettingKey={focusSettingKey}
			/>
			<RegistrySettingRowByKey
				settingKey="codex_tool_approval_policy"
				focusSettingKey={focusSettingKey}
			/>

			<Dialog open={githubOpen} onOpenChange={setGithubOpen}>
				<DialogContent
					title="GitHub"
					description="Choose how Conducted authenticates GitHub operations on your machine."
				>
					<div className="flex flex-col gap-3">
						{access.state === "loading" ? <Skeleton className="h-5 w-64" /> : null}
						{access.state === "error" ? (
							<p role="alert" className="text-xs text-danger">
								{access.error.message}
							</p>
						) : null}
						{access.state === "ready" && access.data.state === "gh_missing" ? (
							<div className="flex flex-col gap-1">
								<p className="text-sm text-fg-muted">
									The GitHub CLI (gh) is not installed. Pull requests and GitHub features need it.
								</p>
								<p className="text-sm text-fg-muted">
									Install the GitHub CLI from https://cli.github.com, then choose Check again.
								</p>
							</div>
						) : null}
						{access.state === "ready" && access.data.state === "signed_out" ? (
							<div className="flex flex-col gap-1">
								<p className="text-sm text-fg-muted">
									GitHub is not signed in. Run this command in a terminal, finish the browser
									sign-in, then choose Check again.
								</p>
								<div className="flex items-center gap-2">
									<pre className="rounded-md bg-muted px-3 py-2 font-mono text-xs text-fg">
										gh auth login
									</pre>
									<Button
										variant="secondary"
										size="sm"
										onClick={() => void copy("gh auth login", "Copied the sign-in command")}
									>
										Copy command
									</Button>
								</div>
								{failureMessage ? (
									<p role="alert" className="text-xs text-danger">
										{failureMessage}
									</p>
								) : null}
							</div>
						) : null}
						{access.state === "ready" && access.data.state === "unknown" ? (
							<p className="text-sm text-fg-muted">
								GitHub's status could not be read. Check your connection, then choose Check again.
							</p>
						) : null}
						{signedIn && access.state === "ready" && access.data.state === "signed_in" ? (
							<p className="text-sm text-fg-muted">
								Signed in as {access.data.login} on {access.data.host}
								{access.data.scopes.length > 0 ? ` (${access.data.scopes.join(", ")})` : ""}.
							</p>
						) : null}
						<div className="flex">
							<Button variant="ghost" size="sm" onClick={() => void checkAgain()}>
								<RefreshIcon className="size-3.5" />
								Check again
							</Button>
						</div>
						<RegistrySettingRowByKey
							settingKey="gh_auth_method"
							focusSettingKey={focusSettingKey}
						/>
						<div className="flex flex-col gap-2 pt-2">
							<Label htmlFor="github-token">Personal access token</Label>
							<p className="text-sm text-fg-muted">
								Optional. Stored in the Keychain and given to gh as GH_TOKEN. It is never shown
								again.
							</p>
							<div className="flex items-end gap-2">
								<Input
									id="github-token"
									type="password"
									value={token}
									autoComplete="off"
									placeholder="ghp_..."
									className="w-72"
									onChange={(event) => {
										setToken(event.target.value);
										setTokenError(null);
									}}
								/>
								<Button variant="outline" onClick={() => void saveToken()}>
									Save token
								</Button>
							</div>
							{tokenError ? (
								<p role="alert" className="text-xs text-danger">
									{tokenError}
								</p>
							) : null}
						</div>
					</div>
					<DialogFooter>
						{signedIn &&
						access.state === "ready" &&
						access.data.state === "signed_in" &&
						access.data.usesToken ? (
							<Button
								variant="outlineDestructive"
								onClick={() => {
									setGithubOpen(false);
									setDisconnectGithub(true);
								}}
							>
								Disconnect GitHub
							</Button>
						) : null}
						<Button variant="secondary" onClick={() => setGithubOpen(false)}>
							Close
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={pendingWarning !== null}
				onOpenChange={(open) => {
					if (!open) setPendingWarning(null);
				}}
			>
				<AlertDialogContent
					title="That doesn't look like a GitHub token"
					description={pendingWarning ?? undefined}
					confirmLabel="Save anyway"
					onConfirm={() => {
						const value = token.trim();
						setPendingWarning(null);
						void commitToken(value);
					}}
				/>
			</AlertDialog>

			<AlertDialog open={disconnectGithub} onOpenChange={setDisconnectGithub}>
				<AlertDialogContent
					title="Disconnect GitHub?"
					description="The saved personal access token is removed from the Keychain. Your gh sign-in is left alone."
					tone="destructive"
					confirmLabel="Disconnect"
					onConfirm={() => {
						setDisconnectGithub(false);
						void actions.accounts.setGitHubToken(null).then((result) => {
							if (!result.ok) toastError("Couldn't disconnect GitHub", result.error);
							else toast("GitHub token removed");
						});
					}}
				/>
			</AlertDialog>

			<AlertDialog open={disconnectLinear} onOpenChange={setDisconnectLinear}>
				<AlertDialogContent
					title="Disconnect Linear?"
					description="The saved Linear API key is removed from the Keychain."
					tone="destructive"
					confirmLabel="Disconnect"
					onConfirm={() => {
						setDisconnectLinear(false);
						void actions.accounts.setLinearKey(null).then((result) => {
							if (!result.ok) toastError("Couldn't disconnect Linear", result.error);
							else toast("Linear key removed");
						});
					}}
				/>
			</AlertDialog>
		</SettingsPageFrame>
	);
}

/**
 * Conductor's profile block: a 64px round avatar with a hairline outline, the name in 18px medium and a
 * muted line under it. Ours names the GitHub sign-in; the avatar falls back to the login's letter.
 */
function ProfileHeader({
	login,
	detail,
	avatarFailed,
	onAvatarError,
}: {
	login: string | null;
	detail: string;
	avatarFailed: boolean;
	onAvatarError: () => void;
}) {
	const letter = login === null ? "?" : (login.trim()[0] ?? "?").toUpperCase();
	return (
		<div className="flex items-center gap-4 border-b border-border pb-6">
			<span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-lg font-medium text-fg-muted outline outline-1 outline-border">
				{letter}
				{login !== null && !avatarFailed ? (
					<img
						src={`https://github.com/${encodeURIComponent(login)}.png?size=128`}
						alt=""
						className="absolute inset-0 size-full object-cover"
						onError={onAvatarError}
					/>
				) : null}
			</span>
			<div className="flex min-w-0 flex-col">
				<p className="truncate text-lg font-medium text-fg">{login ?? "GitHub not connected"}</p>
				<p className="truncate text-sm text-fg-muted">{detail}</p>
			</div>
		</div>
	);
}

/** One connection: a 40px bordered tile, the name over a muted description, actions at the right. */
function ConnectionRow({
	icon,
	title,
	description,
	actions,
	children,
}: {
	icon: ReactNode;
	title: string;
	description: string;
	actions: ReactNode;
	children?: ReactNode;
}) {
	return (
		<section aria-label={title} className="flex flex-col gap-2 border-b border-border py-5">
			<div className="flex items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-3">
					<span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-fg">
						{icon}
					</span>
					<div className="min-w-0">
						<p className="text-sm font-medium text-fg">{title}</p>
						<p className="text-sm text-fg-muted">{description}</p>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2">{actions}</div>
			</div>
			{children === undefined ? null : <div className="flex flex-col gap-1 pl-13">{children}</div>}
		</section>
	);
}
