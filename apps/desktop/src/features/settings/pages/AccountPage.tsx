/**
 * @feature SET-02 Account settings page
 * Owns: the Account page of Settings, local parts only: GitHub access through the `gh` command, a
 * personal access token, the Linear API key, data privacy, and tool approval modes.
 * Behaviour: ui-map.md 6, "Account" table. Left out: the Conductor account, billing, display name
 * and photo, sign out and every hosted sign-in (they need a service we do not have).
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
import { useState } from "react";
import { useStore } from "zustand";
import { useServices } from "../../../core/context.tsx";
import { useActions, useGitHubAccess, useLinearAccess } from "../../../core/hooks.ts";
import { githubFailureMessage, githubTokenWarning } from "../../../core/services/github.ts";
import { AlertDialog, AlertDialogContent } from "../../../ui/AlertDialog.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../../ui/Dialog.tsx";
import { Input, Label } from "../../../ui/Input.tsx";
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
	const [accountOpen, setAccountOpen] = useState(false);
	const [connectOpen, setConnectOpen] = useState(false);
	const [token, setToken] = useState("");
	const [pendingWarning, setPendingWarning] = useState<string | null>(null);
	const [tokenError, setTokenError] = useState<string | null>(null);
	const [disconnectGithub, setDisconnectGithub] = useState(false);
	const [linearKey, setLinearKey] = useState("");
	const [linearError, setLinearError] = useState<string | null>(null);
	const [disconnectLinear, setDisconnectLinear] = useState(false);
	const [savingLinear, setSavingLinear] = useState(false);

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
		toast("Linear key saved");
	};

	const signedIn = access.state === "ready" && access.data.state === "signed_in";

	return (
		<SettingsPageFrame
			title="Account"
			description="Local sign-ins and connections. There is no Conducted account or billing."
			{...load}
			focusSettingKey={focusSettingKey}
		>
			<div className="flex flex-col gap-2 border-t border-border py-4 first:border-t-0 first:pt-0">
				<div className="flex items-center justify-between gap-3">
					<p className="text-sm font-medium text-fg">GitHub access</p>
					<Button variant="secondary" size="sm" onClick={() => void checkAgain()}>
						Check again
					</Button>
				</div>
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
					<div className="flex flex-col gap-2">
						<p className="text-sm text-fg-muted">GitHub is not signed in.</p>
						{failureMessage ? (
							<p role="alert" className="text-xs text-danger">
								{failureMessage}
							</p>
						) : null}
						<Button variant="secondary" size="sm" onClick={() => setConnectOpen(true)}>
							Connect GitHub
						</Button>
					</div>
				) : null}
				{access.state === "ready" && access.data.state === "unknown" ? (
					<p className="text-sm text-fg-muted">
						GitHub's status could not be read. Check your connection, then choose Check again.
					</p>
				) : null}
				{signedIn && access.state === "ready" && access.data.state === "signed_in" ? (
					<div className="flex flex-wrap items-center justify-between gap-3">
						<p className="text-sm text-fg-muted">
							Signed in as {access.data.login} on {access.data.host}
							{access.data.scopes.length > 0 ? ` (${access.data.scopes.join(", ")})` : ""}.
						</p>
						<Button variant="secondary" size="sm" onClick={() => setAccountOpen(true)}>
							GitHub account
						</Button>
					</div>
				) : null}
			</div>

			<div className="flex flex-col gap-2 border-t border-border py-4">
				<Label htmlFor="github-token">Personal access token</Label>
				<p className="text-sm text-fg-muted">
					Optional. Stored in the Keychain and given to gh as GH_TOKEN. It is never shown again.
				</p>
				<div className="flex items-end gap-2">
					<Input
						id="github-token"
						type="password"
						value={token}
						autoComplete="off"
						className="w-72"
						onChange={(event) => {
							setToken(event.target.value);
							setTokenError(null);
						}}
					/>
					<Button variant="secondary" onClick={() => void saveToken()}>
						Save token
					</Button>
				</div>
				{tokenError ? (
					<p role="alert" className="text-xs text-danger">
						{tokenError}
					</p>
				) : null}
			</div>

			<div className="flex flex-col gap-2 border-t border-border py-4">
				<Label htmlFor="linear-key">Linear API key</Label>
				<p className="text-sm text-fg-muted">
					A personal Linear API key, stored in the Keychain. It is never shown again.
				</p>
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
					<Button variant="secondary" loading={savingLinear} onClick={() => void saveLinearKey()}>
						Save key
					</Button>
					<Button variant="outlineDestructive" onClick={() => setDisconnectLinear(true)}>
						Disconnect Linear
					</Button>
				</div>
				{linearError ? (
					<p role="alert" className="text-xs text-danger">
						{linearError}
					</p>
				) : null}
			</div>

			<RegistrySettingRowByKey
				settingKey="enterprise_data_privacy"
				focusSettingKey={focusSettingKey}
				extraFor={() => (
					<ul className="list-disc pl-5 text-xs text-fg-muted">
						<li>Generated chat titles are turned off.</li>
						<li>Custom MCP servers are turned off.</li>
					</ul>
				)}
			/>
			<RegistrySettingRowByKey
				settingKey="tool_approvals_enabled"
				focusSettingKey={focusSettingKey}
			/>
			<RegistrySettingRowByKey
				settingKey="codex_tool_approval_policy"
				focusSettingKey={focusSettingKey}
			/>

			<div className="flex flex-col gap-2 border-t border-border py-4">
				<RegistrySettingRowByKey settingKey="gh_auth_method" focusSettingKey={focusSettingKey} />
			</div>

			<Dialog open={connectOpen} onOpenChange={setConnectOpen}>
				<DialogContent
					title="Connect GitHub"
					description="Run this command in a terminal, finish the browser sign-in, then choose Check again on this page."
				>
					<pre className="rounded-md bg-muted px-3 py-2 font-mono text-xs text-fg">
						gh auth login
					</pre>
					<DialogFooter>
						<Button
							variant="secondary"
							onClick={() => void copy("gh auth login", "Copied the sign-in command")}
						>
							Copy command
						</Button>
						<Button onClick={() => setConnectOpen(false)}>Done</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={accountOpen} onOpenChange={setAccountOpen}>
				<DialogContent title="GitHub account">
					{access.state === "ready" && access.data.state === "signed_in" ? (
						<div className="flex flex-col gap-1 text-sm text-fg-muted">
							<p>Signed in as {access.data.login}.</p>
							<p>Host: {access.data.host}</p>
							<p>
								Scopes:{" "}
								{access.data.scopes.length === 0 ? "none reported" : access.data.scopes.join(", ")}
							</p>
						</div>
					) : (
						<p className="text-sm text-fg-muted">GitHub is not signed in.</p>
					)}
					<DialogFooter>
						<Button variant="secondary" onClick={() => setAccountOpen(false)}>
							Close
						</Button>
						{signedIn &&
						access.state === "ready" &&
						access.data.state === "signed_in" &&
						access.data.usesToken ? (
							<Button
								variant="outlineDestructive"
								onClick={() => {
									setAccountOpen(false);
									setDisconnectGithub(true);
								}}
							>
								Disconnect GitHub
							</Button>
						) : null}
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
