/**
 * @feature SET-02 Connections settings page
 * Owns: the Connections page of Settings, local ports only: the port range workspaces draw from.
 * Behaviour: ui-map.md 3.7 and 6 ("Connections": in Conductor this page covers cloud port
 * forwarding, which is left out) and backlog RUN-03 (one port per workspace, detection, preview
 * URLs). Our design choice: the range is validated here, and port 22 is always refused because SSH
 * uses it.
 * Must handle: a range whose first port is above its last, ports below 1024 or above 65535, and
 * port 22 inside the range (rejected). The range is stored under two registry keys; while the
 * settings registry has no such keys, the page says so instead of writing an unknown key.
 * Test first: a range of 3000 to 2000 shows an error and does not call settings.set.
 */
import { useState } from "react";
import { useActions } from "../../../core/hooks.ts";
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
	const [first, setFirst] = useState("55000");
	const [last, setLast] = useState("55010");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

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
		</SettingsPageFrame>
	);
}
