/**
 * @feature CLOUD-07 Pair the desktop app with the user's Worker
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * Owns: the Cloud Workspaces block at the top of the Cloud settings page: deploy the app's Worker
 * to the user's own Cloudflare account, remove that deployment, pair this Mac with a Worker and
 * unpair it.
 * Behaviour: D106 and D109, as issue #489 placed them: the block lives on the Cloud page, where
 * the cloud variables also live, so an unpaired Mac deploys or pairs without leaving the page.
 * CLOUD-07: the Worker URL and token are checked with the Worker and then kept in the Keychain; the
 * block shows which Worker this Mac is paired with and can remove the pairing. CLOUD-08: the deploy
 * runs `wrangler` with the user's own login from the Worker and image inputs the app carries, pairs
 * this Mac, and can delete the Worker, its container application and its bucket with Remove
 * deployment. Conductor has no self-hosted Worker, so these controls have no Conductor home and
 * their form is ours (D098, D106, D109).
 * Must handle: a Worker URL or token the Worker refused (its message, earlier pairing left alone);
 * an unpaired Mac shows Deploy and the pair form, and a paired one shows the Worker and Unpair; a
 * deploy or uninstall that fails shows the shell's own message and changes no pairing.
 * CLOUD-08 issue #490: the deploy's state is the deploy service's, read through useCloudDeploy, so
 * arriving while a deploy runs shows its spinner and step, and arriving after it shows the URL or
 * the shell's failure. Remove deployment is disabled while a deploy runs.
 * Children: uses useCloudPairing, useCloudDeploy and the cloud actions.
 * Test first: a Worker URL the Worker refused leaves the Mac unpaired and shows the Worker's message.
 */
import { useState } from "react";
import { useActions, useCloudDeploy, useCloudPairing } from "../../../core/hooks.ts";
import { Button } from "../../../ui/Button.tsx";
import { Input, Label } from "../../../ui/Input.tsx";
import { toast } from "../../../ui/Toast.tsx";

export function CloudWorkerBlock() {
	const actions = useActions();
	const pairing = useCloudPairing();
	const deploy = useCloudDeploy();
	const running = deploy.state === "running";
	const [workerUrl, setWorkerUrl] = useState("");
	const [pairingToken, setPairingToken] = useState("");
	const [pairingError, setPairingError] = useState<string | null>(null);
	const [pairingBusy, setPairingBusy] = useState(false);
	const [removeError, setRemoveError] = useState<string | null>(null);

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

	// The deploy's state lives in the deploy service, so leaving the page does not lose it. The
	// service joins a second call to the running one; the button only follows its state.
	const deployWorker = async () => {
		const result = await actions.cloud.deploy();
		if (result.ok) toast("Deployed the Worker and paired this Mac");
	};

	const removeDeployment = async () => {
		setRemoveError(null);
		const result = await actions.cloud.uninstall();
		if (!result.ok) {
			setRemoveError(result.error.message);
			return;
		}
		toast("Removed the deployment from your Cloudflare account");
	};

	/** What the deploy is doing, from the shell's own steps; never guessed. */
	const deployProgress =
		deploy.state === "running"
			? deploy.step === null
				? "Starting the deploy…"
				: `Deploying… ${deploy.step}`
			: deploy.state === "done"
				? `Deployed and paired with ${deploy.url}.`
				: null;

	return (
		<div className="flex flex-col gap-3 border-b border-border pb-4">
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
						<Button variant="secondary" loading={running} onClick={() => void deployWorker()}>
							Deploy to Cloudflare
						</Button>
						<Button
							variant="outlineDestructive"
							disabled={running}
							onClick={() => void removeDeployment()}
						>
							Remove deployment
						</Button>
					</div>
					{deployProgress ? (
						<p role="status" className="text-xs text-fg-muted">
							{deployProgress}
						</p>
					) : null}
					{deploy.state === "failed" ? (
						<p role="alert" className="text-xs text-danger">
							{deploy.error.message}
						</p>
					) : null}
					{removeError ? (
						<p role="alert" className="text-xs text-danger">
							{removeError}
						</p>
					) : null}
				</div>
			) : null}
			{pairing.state === "ready" && !pairing.data.paired ? (
				<div className="flex flex-col gap-2">
					<p className="text-sm text-fg-muted">Not paired</p>
					<div className="flex items-end gap-3">
						<Button loading={running} onClick={() => void deployWorker()}>
							Deploy to Cloudflare
						</Button>
					</div>
					{deployProgress ? (
						<p role="status" className="text-xs text-fg-muted">
							{deployProgress}
						</p>
					) : null}
					{deploy.state === "failed" ? (
						<p role="alert" className="text-xs text-danger">
							{deploy.error.message}
						</p>
					) : null}
					{removeError ? (
						<p role="alert" className="text-xs text-danger">
							{removeError}
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
	);
}
