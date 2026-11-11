/**
 * @feature CLOUD-17 Cloud settings page
 * @feature CLOUD-07 Pair the desktop app with the user's Worker
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * Owns: the Cloud page of Settings: the Cloud Workspaces block (deploy, remove and pair, at the
 * top), the personal environment variables every cloud workspace receives, and the note that data
 * privacy mode stops cloud workspaces running. The commit identity lives on the Git page, where
 * Conductor puts it.
 * Behaviour: D106, D109 and D113, as issue #489 placed them: an unpaired Mac deploys or pairs at
 * the top of this page and then sets its cloud variables on the same page. docs/research/conductor/
 * ui-map.md 6 Organization (Environment: personal cloud variables) and services-map.md 4.2.8
 * (`personalCloudEnvVars`); services-map.md 4.1.2 for the data-privacy rule. Conductor's page is an
 * organization page, which D004 and D018 keep out; the page is ours on the Mac's own Worker (D113).
 * Data: useCloudSettings for the saved variables, Actions.cloud.setCloudEnvVar and
 * removeCloudEnvVar for edits, useCloudPairing to reload when the pair changes,
 * useSetting("enterprise_data_privacy") for the privacy note.
 * Children: CloudWorkerBlock, environment/EnvVarTable and environment/AddEnvVarForm.
 * Must handle: a Mac with no Worker (the block offers Deploy and Pair, and no variables are shown),
 * a Worker that cannot be reached (the page's own "Conducted could not connect to cloud settings.
 * Try again."), no variables (the table's empty state), a name the Worker refuses (its message, the
 * panel stays open), and values never reaching a log.
 * Test first: an unpaired Mac deploys or pairs from this page, and a refused name keeps the add
 * panel open and shows the Worker's reason.
 */
import { useEffect, useMemo, useState } from "react";
import { CLOUD_ENV_SAVE_FAILED, CLOUD_SETTINGS_UNREACHABLE } from "../../../core/cloud-messages.ts";
import { useServices } from "../../../core/context.tsx";
import { useActions, useCloudPairing, useCloudSettings, useSetting } from "../../../core/hooks.ts";
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { PlusIcon } from "../../../ui/icons.tsx";
import { toast, toastError } from "../../../ui/Toast.tsx";
import type { EnvDraft } from "../environment/AddEnvVarForm.tsx";
import { AddEnvVarForm } from "../environment/AddEnvVarForm.tsx";
import { type EnvTableRow, EnvVarTable } from "../environment/EnvVarTable.tsx";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";
import { CloudWorkerBlock } from "./CloudWorkerBlock.tsx";

export function CloudPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	const { services } = useServices();
	const actions = useActions();
	const cloud = useCloudSettings();
	const pairing = useCloudPairing();
	const privacy = useSetting<boolean>("enterprise_data_privacy");
	const [adding, setAdding] = useState(false);

	const service = services.cloudSettings;
	const pairingPaired = pairing.state === "ready" ? pairing.data.paired : null;
	// A pair or an unpair changes whose variables these are, so the page reads them again.
	useEffect(() => {
		if (pairingPaired === null) return;
		void service.load().then((result) => {
			if (!result.ok) {
				toast.error(CLOUD_SETTINGS_UNREACHABLE);
			}
		});
	}, [service, pairingPaired]);

	const settings = cloud.state === "ready" ? cloud.data.settings : null;
	const showingVariables = cloud.state === "ready" && cloud.data.paired;
	const rows = useMemo<EnvTableRow[]>(
		() =>
			settings === null
				? []
				: Object.keys(settings.envVars)
						.sort((left, right) => left.localeCompare(right))
						.map((name) => ({
							name,
							hasValue: true,
							editable: true,
							canRename: true,
						})),
		[settings],
	);
	const existingNames = rows.map((row) => row.name);

	const saveVariable = async (
		entry: EnvDraft & { previousName: string | null },
	): Promise<boolean> => {
		const saved = await actions.cloud.setCloudEnvVar(entry.name, entry.value);
		if (!saved.ok) {
			toastError(CLOUD_ENV_SAVE_FAILED, saved.error);
			return false;
		}
		if (entry.previousName !== null && entry.previousName !== entry.name) {
			const removed = await actions.cloud.removeCloudEnvVar(entry.previousName);
			if (!removed.ok) {
				toastError(CLOUD_ENV_SAVE_FAILED, removed.error);
				return false;
			}
		}
		return true;
	};

	const addVariables = async (entries: readonly EnvDraft[]): Promise<boolean> => {
		for (const entry of entries) {
			const saved = await actions.cloud.setCloudEnvVar(entry.name, entry.value);
			if (!saved.ok) {
				toastError(CLOUD_ENV_SAVE_FAILED, saved.error);
				return false;
			}
		}
		return true;
	};

	const removeVariable = async (name: string): Promise<boolean> => {
		const removed = await actions.cloud.removeCloudEnvVar(name);
		if (!removed.ok) {
			toastError(CLOUD_ENV_SAVE_FAILED, removed.error);
			return false;
		}
		return true;
	};

	const copyVariable = async (name: string, value: string) => {
		const copied = await actions.app.copyText(value);
		if (!copied.ok) toastError(`Failed to copy ${name}`, copied.error);
		else toast(`Copied ${name}`);
	};

	return (
		<SettingsPageFrame
			title="Cloud"
			description="Cloud workspaces run on the Worker you deployed to your own Cloudflare account."
			{...load}
			focusSettingKey={focusSettingKey}
		>
			<CloudWorkerBlock />
			{cloud.state === "error" ? (
				<div className="py-4">
					<EmptyState
						tone="failed"
						title={CLOUD_SETTINGS_UNREACHABLE}
						body="The Worker did not answer. Check that it is deployed and that this Mac is paired with it."
						action={
							<Button variant="default" onClick={() => void service.load()}>
								Try again
							</Button>
						}
					/>
				</div>
			) : cloud.state !== "ready" ? (
				<p role="status" className="py-4 text-sm text-fg-muted">
					Reading cloud settings...
				</p>
			) : showingVariables ? (
				<div className="flex flex-col gap-3 border-t border-border py-4">
					<div className="flex items-start justify-between gap-4">
						<div className="flex flex-col gap-1">
							<p className="text-sm font-medium text-fg">Environment variables</p>
							<p className="max-w-prose text-sm text-fg-muted">
								These variables are given to every cloud workspace. They are kept in your Worker,
								never in the sandbox's image.
							</p>
						</div>
						<Button variant="default" onClick={() => setAdding(true)}>
							<PlusIcon className="size-4" />
							Add environment variable
						</Button>
					</div>
					<EnvVarTable
						scopeLabel="cloud variable"
						rows={rows}
						onReveal={async (name) => settings?.envVars[name] ?? null}
						onCopy={copyVariable}
						onSave={saveVariable}
						onDelete={removeVariable}
					/>
					<AddEnvVarForm
						open={adding}
						onOpenChange={setAdding}
						existingNames={existingNames}
						onAdd={addVariables}
					/>
				</div>
			) : null}
			{privacy === true ? (
				<p className="border-t border-border py-4 text-sm text-fg-muted">
					Data privacy mode is on. Cloud workspaces cannot run until it is turned off.
				</p>
			) : null}
		</SettingsPageFrame>
	);
}
