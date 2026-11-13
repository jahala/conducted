/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Owns: the MCP settings page: the cloud MCP servers of the paired Worker, with Conductor's
 * failure toasts for a save, a delete and an import.
 * Behaviour: Conductor's MCP page is its own settings entry, "MCP", listed under Agents &
 * environment only while a cloud organisation is active (renderApp `ZFt` @2960571, the nav's
 * `fY` list @11775268, the route `/settings/organization/mcp` @11786604, the page `BPa`
 * @10781453 with its header `NHe` @8717783: the title alone). Ours lists it while the switcher's
 * active entry is the paired Worker (D127), which is our cloud organisation.
 * Data: useCloudSettings for the servers; Actions.cloud.saveMcpServer, removeMcpServer and
 * importMcpServers.
 * Children: cloud/McpServersSection.
 * Must handle: an unpaired Mac (the title alone, as Conductor's page with no cloud organisation),
 * a Worker that cannot be reached (the Cloud page's own message and Try again), settings still
 * being read.
 * Test first: adds a bearer-token MCP server and never shows its token again.
 */
import { useEffect } from "react";
import {
	CLOUD_MCP_ADD_FAILED,
	CLOUD_MCP_DELETE_FAILED,
	CLOUD_MCP_UPDATE_FAILED,
	type CloudMcpServer,
} from "../../../core/cloud-mcp.ts";
import { CLOUD_SETTINGS_UNREACHABLE } from "../../../core/cloud-messages.ts";
import { useServices } from "../../../core/context.tsx";
import { useActions, useCloudPairing, useCloudSettings } from "../../../core/hooks.ts";
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { toastError } from "../../../ui/Toast.tsx";
import { CloudMcpServersSection } from "../cloud/McpServersSection.tsx";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";

export function McpPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	const { services } = useServices();
	const actions = useActions();
	const cloud = useCloudSettings();
	const pairing = useCloudPairing();
	const service = services.cloudSettings;
	const pairingPaired = pairing.state === "ready" ? pairing.data.paired : null;

	// A pair or an unpair changes whose servers these are, so the page reads them again.
	useEffect(() => {
		if (pairingPaired === null) return;
		void service.load();
	}, [service, pairingPaired]);

	const settings = cloud.state === "ready" ? cloud.data.settings : null;

	const saveMcpServer = async (name: string, server: CloudMcpServer): Promise<boolean> => {
		const isNew = settings?.mcpServers[name] === undefined;
		const saved = await actions.cloud.saveMcpServer(name, server);
		if (!saved.ok) {
			toastError(isNew ? CLOUD_MCP_ADD_FAILED : CLOUD_MCP_UPDATE_FAILED, saved.error);
			return false;
		}
		return true;
	};

	const removeMcpServer = async (name: string): Promise<boolean> => {
		const removed = await actions.cloud.removeMcpServer(name);
		if (!removed.ok) {
			toastError(CLOUD_MCP_DELETE_FAILED, removed.error);
			return false;
		}
		return true;
	};

	const importMcpServers = async (
		servers: Readonly<Record<string, CloudMcpServer>>,
	): Promise<boolean> => {
		const imported = await actions.cloud.importMcpServers(servers);
		if (!imported.ok) {
			const count = Object.keys(servers).length;
			toastError(
				count === 1 ? "Couldn't add 1 MCP server" : `Couldn't add ${count} MCP servers`,
				imported.error,
			);
			return false;
		}
		return true;
	};

	return (
		<SettingsPageFrame title="MCP" description={null} {...load} focusSettingKey={focusSettingKey}>
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
			) : cloud.data.paired ? (
				<CloudMcpServersSection
					servers={settings?.mcpServers ?? {}}
					onSave={saveMcpServer}
					onRemove={removeMcpServer}
					onImport={importMcpServers}
				/>
			) : null}
		</SettingsPageFrame>
	);
}
