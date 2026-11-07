/**
 * @feature SET-02 Connections settings page
 * @feature CLOUD-07 Pair the desktop app with the user's Worker
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * Owns: the Connections page of Settings: the port range workspaces draw from, the deploy of the
 * Worker to the user's own Cloudflare account, and the pairing with that Worker.
 * Behaviour: ui-map.md 3.7 and 6 ("Connections": in Conductor this page covers cloud port
 * forwarding, which is left out) and backlog RUN-03 (one port per workspace, detection, preview
 * URLs). CLOUD-07: the Worker URL and token are checked with the Worker and then kept in the
 * Keychain; the page shows which Worker this Mac is paired with and can remove the pairing.
 * CLOUD-08: the deploy runs `wrangler` with the user's own login from the Worker and image inputs
 * the app carries, pairs this Mac, and can delete the Worker, its container application and its
 * bucket with Remove deployment.
 * Our design choice: the range is validated here, and port 22 is always refused because SSH
 * uses it. The pairing form sits on Connections because it connects this Mac to a Worker; it is
 * ours, since Conductor has no self-hosted Worker (D098, D106).
 * Must handle: a range whose first port is above its last, ports below 1024 or above 65535, and
 * port 22 inside the range (rejected). The range is stored under two registry keys; while the
 * settings registry has no such keys, the page says so instead of writing an unknown key. A
 * Worker URL or token the Worker refused shows its message and leaves any earlier pairing alone;
 * an unpaired Mac shows the form, and a paired one shows the Worker and Unpair. A deploy or
 * uninstall that fails shows the shell's own message and changes no pairing on failure.
 * Test first: a range of 3000 to 2000 shows an error and does not call settings.set.
 */
import { useState } from "react";
import { useActions, useCloudPairing } from "../../../core/hooks.ts";
import { getSettingDef } from "../../../core/registries/settings.ts";
import { Button } from "../../../ui/Button.tsx";
import { Input, Label } from "../../../ui/Input.tsx";
import { toast } from "../../../ui/Toast.tsx";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";

const MIN_PORT = 1024;
const MAX_PORT = 65_535;
const SSH_PORT = 22;

interface RangeError {
	message: string;
}

function validateRange(first: number, last: number): RangeError | null {
	if (!Number.isInteger(first) || !Number.isInteger(last)) {
		return { message: "Enter whole port numbers." };
	}
	// Port 22 is checked before the bounds: it sits below them, so the bounds message would hide it.
	if (first <= SSH_PORT && last >= SSH_PORT) {
		return { message: "Port 22 is reserved for SSH. Choose a range that does not include it." };
	}
	if (first < MIN_PORT || last > MAX_PORT) {
		return { message: `Ports must be between ${MIN_PORT} and ${MAX_PORT}.` };
	}
	if (first > last) {
		return { message: "The first port must be lower than or equal to the last port." };
	}
	return null;
}

export function ConnectionsPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	const actions = useActions();
	const pairing = useCloudPairing();
	const [first, setFirst] = useState("55000");
	const [last, setLast] = useState("55010");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [workerUrl, setWorkerUrl] = useState("");
	const [pairingToken, setPairingToken] = useState("");
	const [pairingError, setPairingError] = useState<string | null>(null);
	const [pairingBusy, setPairingBusy] = useState(false);
	const [deployBusy, setDeployBusy] = useState(false);
	const [deployError, setDeployError] = useState<string | null>(null);
	const [deployNote, setDeployNote] = useState<string | null>(null);

	const pairWorker = async () => {
		setPairingError(null);
		setPairingBusy(true);
		const result = await actions.cloud.pair({ url: workerUrl, token: pairingToken });
		setPairingBusy(false);
		if (!result.ok) {
			setPairingError(result.error.message);
			return;
		}
		setWorkerUrl("");
		setPairingToken("");
		toast("Paired with the Worker");
	};

	const unpairWorker = async () => {
		setPairingError(null);
		setPairingBusy(true);
		const result = await actions.cloud.unpair();
		setPairingBusy(false);
		if (!result.ok) {
			setPairingError(result.error.message);
			return;
		}
		toast("Unpaired from the Worker");
	};

	const deployWorker = async () => {
		setDeployError(null);
		setDeployNote(null);
		setDeployBusy(true);
		const result = await actions.cloud.deploy();
		setDeployBusy(false);
		if (!result.ok) {
			setDeployError(result.error.message);
			return;
		}
		setDeployNote(`Deployed and paired with ${result.value.url}.`);
		toast("Deployed the Worker and paired this Mac");
	};

	const removeDeployment = async () => {
		setDeployError(null);
		setDeployNote(null);
		setDeployBusy(true);
		const result = await actions.cloud.uninstall();
		setDeployBusy(false);
		if (!result.ok) {
			setDeployError(result.error.message);
			return;
		}
		setDeployNote("Removed the Worker, its container application and its bucket.");
		toast("Removed the deployment from your Cloudflare account");
	};

	const save = async () => {
		const problem = validateRange(Number(first), Number(last));
		if (problem !== null) {
			setError(problem.message);
			return;
		}
		if (
			getSettingDef("workspace_port_range_start") === undefined ||
			getSettingDef("workspace_port_range_end") === undefined
		) {
			setError(
				"The port range settings are not in the settings registry yet, so this range cannot be saved.",
			);
			return;
		}
		setError(null);
		setSaving(true);
		const savedFirst = await actions.settings.set("workspace_port_range_start", Number(first));
		const savedLast = await actions.settings.set("workspace_port_range_end", Number(last));
		setSaving(false);
		const failure = !savedFirst.ok ? savedFirst.error : !savedLast.ok ? savedLast.error : null;
		if (failure !== null) {
			setError(failure.message);
			return;
		}
		toast("Workspace port range saved");
	};

	return (
		<SettingsPageFrame
			title="Connections"
			description={null}
			{...load}
			focusSettingKey={focusSettingKey}
		>
			<div className="flex flex-col gap-3 border-t border-border py-4 first:border-t-0 first:pt-0">
				<div className="flex flex-col gap-1">
					<p className="text-sm font-medium text-fg">Workspace port range</p>
					<p className="max-w-prose text-sm text-fg-muted">
						New workspaces receive a block of ports inside this range. Existing workspaces keep the
						ports they were given.
					</p>
				</div>
				<div className="flex items-end gap-3">
					<div className="flex flex-col gap-1">
						<Label htmlFor="port-range-first">First port</Label>
						<Input
							id="port-range-first"
							type="number"
							value={first}
							min={MIN_PORT}
							max={MAX_PORT}
							className="w-28"
							onChange={(event) => {
								setFirst(event.target.value);
								setError(null);
							}}
						/>
					</div>
					<div className="flex flex-col gap-1">
						<Label htmlFor="port-range-last">Last port</Label>
						<Input
							id="port-range-last"
							type="number"
							value={last}
							min={MIN_PORT}
							max={MAX_PORT}
							className="w-28"
							onChange={(event) => {
								setLast(event.target.value);
								setError(null);
							}}
						/>
					</div>
					<Button variant="secondary" loading={saving} onClick={() => void save()}>
						Save port range
					</Button>
				</div>
				{error ? (
					<p role="alert" className="text-xs text-danger">
						{error}
					</p>
				) : null}
				<p className="text-xs text-fg-subtle">Ranges cannot include port 22, which SSH uses.</p>
			</div>

			<div className="flex flex-col gap-3 border-t border-border py-4">
				<div className="flex flex-col gap-1">
					<p className="text-sm font-medium text-fg">Cloud Workspaces</p>
					<p className="max-w-prose text-sm text-fg-muted">
						Deploy the Worker to your Cloudflare account, or pair this Mac with one you deployed
						already. The token is kept in the Keychain and is never shown again.
					</p>
				</div>
				{pairing.state === "loading" ? (
					<p role="status" className="text-xs text-fg-muted">
						Checking the saved pairing…
					</p>
				) : null}
				{pairing.state === "error" ? (
					<p role="alert" className="text-xs text-danger">
						{pairing.error.message}
					</p>
				) : null}
				{pairing.state === "ready" && pairing.data.paired ? (
					<div className="flex flex-col gap-2">
						<div className="flex items-end gap-3">
							<p className="text-sm text-fg">Paired with {pairing.data.url ?? "a Worker"}.</p>
							<Button
								variant="outlineDestructive"
								loading={pairingBusy}
								onClick={() => void unpairWorker()}
							>
								Unpair
							</Button>
						</div>
						<p className="max-w-prose text-sm text-fg-muted">
							Remove deployment deletes the Worker, its container application and its R2 bucket from
							your Cloudflare account. It also unpairs this Mac.
						</p>
						<div className="flex items-end gap-3">
							<Button variant="secondary" loading={deployBusy} onClick={() => void deployWorker()}>
								Deploy to Cloudflare
							</Button>
							<Button
								variant="outlineDestructive"
								loading={deployBusy}
								onClick={() => void removeDeployment()}
							>
								Remove deployment
							</Button>
						</div>
						{deployNote ? (
							<p role="status" className="text-xs text-fg-muted">
								{deployNote}
							</p>
						) : null}
						{deployError ? (
							<p role="alert" className="text-xs text-danger">
								{deployError}
							</p>
						) : null}
					</div>
				) : null}
				{pairing.state === "ready" && !pairing.data.paired ? (
					<div className="flex flex-col gap-2">
						<p className="text-sm text-fg-muted">Not paired</p>
						<p className="max-w-prose text-sm text-fg-muted">
							Deploy the Worker yourself with your own Cloudflare login. Install{" "}
							<code>wrangler</code> and run <code>wrangler login</code> once, then choose this
							project's <code>apps/cloud</code> folder, prepared once with{" "}
							<code>bun apps/cloud/sandbox/build.ts</code>. The deploy makes the Worker, its
							container application and its R2 bucket in your account, sets the pairing token as a
							Worker secret, and pairs this Mac.
						</p>
						<div className="flex items-end gap-3">
							<Button loading={deployBusy} onClick={() => void deployWorker()}>
								Deploy to Cloudflare
							</Button>
						</div>
						{deployNote ? (
							<p role="status" className="text-xs text-fg-muted">
								{deployNote}
							</p>
						) : null}
						{deployError ? (
							<p role="alert" className="text-xs text-danger">
								{deployError}
							</p>
						) : null}
						<p className="text-xs text-fg-subtle">
							Already deployed? Deploying again updates it, and Remove deployment deletes it.
						</p>
						<p className="text-sm font-medium text-fg">Pair a Worker you deployed already</p>
						<div className="flex flex-col gap-1">
							<Label htmlFor="cloud-worker-url">Worker URL</Label>
							<Input
								id="cloud-worker-url"
								value={workerUrl}
								placeholder="https://conducted.example.workers.dev"
								autoComplete="off"
								className="w-96"
								onChange={(event) => {
									setWorkerUrl(event.target.value);
									setPairingError(null);
								}}
							/>
						</div>
						<div className="flex items-end gap-3">
							<div className="flex flex-col gap-1">
								<Label htmlFor="cloud-pairing-token">Pairing token</Label>
								<Input
									id="cloud-pairing-token"
									type="password"
									value={pairingToken}
									autoComplete="off"
									className="w-96"
									onChange={(event) => {
										setPairingToken(event.target.value);
										setPairingError(null);
									}}
								/>
							</div>
							<Button loading={pairingBusy} onClick={() => void pairWorker()}>
								Pair
							</Button>
						</div>
					</div>
				) : null}
				{pairingError ? (
					<p role="alert" className="text-xs text-danger">
						{pairingError}
					</p>
				) : null}
			</div>
		</SettingsPageFrame>
	);
}
