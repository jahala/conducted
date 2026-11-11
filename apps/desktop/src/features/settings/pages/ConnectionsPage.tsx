/**
 * @feature SET-02 Connections settings page
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * Owns: the Connections page of Settings: exactly Conductor's four port-forwarding controls.
 * Behaviour: ui-map.md 3.7 and 6 ("Connections": Exclusive port forwarding, Forwarding strategies,
 * Local port range, Manual overrides). services-map.md 5A.3.3 gives the two strategies, the range
 * defaults (20000 to 29999) and the override shape (remote to local, port 22 refused). Conductor
 * has no Worker to deploy or pair, so those controls live on the Cloud page instead (D106, D109,
 * issue #489).
 * Our design choice: Conductor keeps the forwarding keys as org-personal server settings; this app
 * has no server, so they are ordinary local settings (D110). Port 22 is always refused.
 * Must handle: a range whose first port is above its last, ports below 1024 or above 65535, and
 * port 22 inside the range (rejected); an override line that is not remote:local or uses port 22
 * (rejected before saving).
 * Test first: a range of 3000 to 2000 shows an error and does not call settings.set.
 */
import { useState } from "react";
import { useActions, useSetting } from "../../../core/hooks.ts";
import { Button } from "../../../ui/Button.tsx";
import { Input, Label, Textarea } from "../../../ui/Input.tsx";
import { Select } from "../../../ui/Select.tsx";
import { Switch } from "../../../ui/Switch.tsx";
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

/** Rejects a manual override that is not remote:local, or that uses port 22. */
function validateMappings(text: string): string | null {
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		const match = /^(\d{1,5})\s*:\s*(\d{1,5})$/.exec(trimmed);
		if (match === null) return `"${trimmed}" is not remote:local.`;
		const remote = Number(match[1]);
		const local = Number(match[2]);
		if (remote === SSH_PORT) return "Port 22 is reserved for SSH and cannot be forwarded here.";
		if (
			remote < 1 ||
			remote > MAX_PORT ||
			local < MIN_PORT ||
			local > MAX_PORT ||
			local === SSH_PORT
		) {
			return `"${trimmed}" uses a port outside 1024 to 65535.`;
		}
	}
	return null;
}

export function ConnectionsPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	const actions = useActions();
	const strategy = useSetting<string>("port_forwarding_strategy");
	const exclusive = useSetting<boolean>("exclusive_port_forwarding_enabled");
	const savedFirst = useSetting<number>("local_port_range_start");
	const savedLast = useSetting<number>("local_port_range_end");
	const savedMappings = useSetting<string[]>("port_mappings");
	const [first, setFirst] = useState(String(savedFirst));
	const [last, setLast] = useState(String(savedLast));
	const [mappings, setMappings] = useState((savedMappings ?? []).join("\n"));
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const save = async () => {
		const problem = validateRange(Number(first), Number(last));
		if (problem !== null) {
			setError(problem.message);
			return;
		}
		const mappingProblem = validateMappings(mappings);
		if (mappingProblem !== null) {
			setError(mappingProblem);
			return;
		}
		setError(null);
		setSaving(true);
		const savedStart = await actions.settings.set("local_port_range_start", Number(first));
		const savedEnd = await actions.settings.set("local_port_range_end", Number(last));
		const savedOverrides = await actions.settings.set(
			"port_mappings",
			mappings
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line !== ""),
		);
		setSaving(false);
		const failure = !savedStart.ok
			? savedStart.error
			: !savedEnd.ok
				? savedEnd.error
				: !savedOverrides.ok
					? savedOverrides.error
					: null;
		if (failure !== null) {
			setError(failure.message);
			return;
		}
		toast("Port forwarding settings saved");
	};

	const setStrategy = async (value: string) => {
		const result = await actions.settings.set("port_forwarding_strategy", value);
		if (!result.ok) setError(result.error.message);
	};

	const setExclusive = async (checked: boolean) => {
		const result = await actions.settings.set("exclusive_port_forwarding_enabled", checked);
		if (!result.ok) setError(result.error.message);
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
					<p className="text-sm font-medium text-fg">Exclusive port forwarding</p>
					<p className="max-w-prose text-sm text-fg-muted">
						Turning on port forwarding in one workspace turns it off everywhere else.
					</p>
				</div>
				<Switch
					checked={exclusive === true}
					aria-label="Exclusive port forwarding"
					onCheckedChange={(checked) => void setExclusive(checked)}
				/>
			</div>

			<div className="flex flex-col gap-3 border-t border-border py-4">
				<div className="flex flex-col gap-1">
					<p className="text-sm font-medium text-fg">Forwarding strategies</p>
					<p className="max-w-prose text-sm text-fg-muted">
						How new forwards choose their local port. Existing forwards keep their ports.
					</p>
				</div>
				<Select
					value={strategy}
					aria-label="Forwarding strategy"
					options={[
						{ value: "match", label: "Match the remote port" },
						{ value: "range", label: "Use the local range" },
					]}
					onValueChange={(value) => void setStrategy(value)}
					className="w-64"
				/>
			</div>

			<div className="flex flex-col gap-3 border-t border-border py-4">
				<div className="flex flex-col gap-1">
					<p className="text-sm font-medium text-fg">Local port range</p>
					<p className="max-w-prose text-sm text-fg-muted">
						Used for forwards that don't match their remote port number.
					</p>
				</div>
				<div className="flex flex-col gap-1">
					<Label htmlFor="local-port-range-first">First port</Label>
					<Input
						id="local-port-range-first"
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
					<Label htmlFor="local-port-range-last">Last port</Label>
					<Input
						id="local-port-range-last"
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
				<p className="text-xs text-fg-subtle">Ranges cannot include port 22, which SSH uses.</p>
			</div>

			<div className="flex flex-col gap-3 border-t border-border py-4">
				<div className="flex flex-col gap-1">
					<p className="text-sm font-medium text-fg">Manual overrides</p>
					<p className="max-w-prose text-sm text-fg-muted">
						Map a remote port to a local port, one per line as remote:local.
					</p>
				</div>
				<Textarea
					aria-label="Manual overrides"
					value={mappings}
					placeholder={"3000:4000"}
					className="w-64 font-mono"
					onChange={(event) => {
						setMappings(event.target.value);
						setError(null);
					}}
				/>
				<div>
					<Button variant="secondary" loading={saving} onClick={() => void save()}>
						Save port forwarding settings
					</Button>
				</div>
				{error ? (
					<p role="alert" className="text-xs text-danger">
						{error}
					</p>
				) : null}
			</div>
		</SettingsPageFrame>
	);
}
