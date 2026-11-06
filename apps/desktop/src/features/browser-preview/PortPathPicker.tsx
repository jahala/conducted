/**
 * @feature RUN-04 Port and path picker
 * Owns: the control that picks which local port and path the preview shows.
 * Behaviour: ui-map.md 3.2, "Tab content: Browser" ("Port and path" picker); ports come from the
 * workspace port and detected ports (ui-map.md 3.7).
 * Must handle: no detected ports (only the workspace port, marked "not listening" when it is not),
 * a path without a leading slash, and a port outside the valid range (rejected).
 * Test first: choosing port 5173 with path "docs" calls onChange with "http://localhost:5173/docs".
 */
import { useEffect, useId, useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { Input, Label } from "../../ui/Input.tsx";
import { Select } from "../../ui/Select.tsx";

const MIN_PORT = 1;
const MAX_PORT = 65_535;

function isValidPort(port: number): boolean {
	return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

/** A path always starts with one slash; an empty path means the root. */
function normalizePath(path: string): string {
	const trimmed = path.trim();
	if (trimmed === "" || trimmed === "/") return "/";
	return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function previewUrl(port: number, path: string): string {
	return `http://localhost:${port}${normalizePath(path)}`;
}

function selectablePorts(
	workspacePort: number,
	detectedPorts: readonly number[],
	currentPort: number,
): number[] {
	const ports: number[] = [];
	for (const port of [workspacePort, currentPort, ...detectedPorts]) {
		if (!isValidPort(port) || ports.includes(port)) continue;
		ports.push(port);
	}
	return ports;
}

export interface PortPathPickerProps {
	workspacePort: number;
	detectedPorts: number[];
	current: { port: number; path: string };
	onChange: (url: string) => void;
}

export function PortPathPicker({
	workspacePort,
	detectedPorts,
	current,
	onChange,
}: PortPathPickerProps) {
	const portId = useId();
	const pathId = useId();
	const [chosen, setChosen] = useState<{ from: number; value: number } | null>(null);
	const [path, setPath] = useState(current.path);

	useEffect(() => {
		setPath(current.path);
	}, [current.path]);

	const ports = selectablePorts(workspacePort, detectedPorts, current.port);
	const selectedPort =
		chosen !== null && chosen.from === current.port && ports.includes(chosen.value)
			? chosen.value
			: ports.includes(current.port)
				? current.port
				: (ports[0] ?? 0);

	if (ports.length === 0) {
		return <p className="text-xs text-danger">No valid port to preview.</p>;
	}

	const emit = (port: number, nextPath: string) => {
		if (!isValidPort(port)) return;
		onChange(previewUrl(port, nextPath));
	};

	return (
		<div className="flex items-end gap-2">
			<div className="flex flex-col gap-1">
				<Label htmlFor={portId}>Port</Label>
				<Select
					id={portId}
					aria-label="Port"
					size="sm"
					value={String(selectedPort)}
					options={ports.map((port) => ({
						value: String(port),
						label: portLabel(port, workspacePort, detectedPorts),
					}))}
					onValueChange={(value) => {
						const port = Number(value);
						setChosen({ from: current.port, value: port });
						emit(port, path);
					}}
				/>
			</div>
			<div className="flex flex-col gap-1">
				<Label htmlFor={pathId}>Path</Label>
				<Input
					id={pathId}
					aria-label="Path"
					className="w-40"
					value={path}
					onChange={(event) => setPath(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Enter") return;
						event.preventDefault();
						emit(selectedPort, path);
					}}
				/>
			</div>
			<Button size="sm" onClick={() => emit(selectedPort, path)}>
				Go
			</Button>
		</div>
	);
}

function portLabel(port: number, workspacePort: number, detectedPorts: readonly number[]): string {
	const marks: string[] = [];
	if (port === workspacePort) marks.push("workspace port");
	if (!detectedPorts.includes(port)) marks.push("not listening");
	return marks.length === 0 ? String(port) : `${port} (${marks.join(", ")})`;
}
