/**
 * @feature RUN-04 Port and path picker
 * Owns: the control that picks which local port and path the preview shows.
 * Behaviour: ui-map.md 3.2, "Tab content: Browser" ("Port and path" picker); ports come from the
 * workspace port and detected ports (ui-map.md 3.7).
 * Must handle: no detected ports (only the workspace port, marked "not listening" when it is not),
 * a path without a leading slash, and a port outside the valid range (rejected).
 * Test first: choosing port 5173 with path "docs" calls onChange with "http://localhost:5173/docs".
 */
import { notImplemented } from "@conducted/shared";

export interface PortPathPickerProps {
	workspacePort: number;
	detectedPorts: number[];
	current: { port: number; path: string };
	onChange: (url: string) => void;
}

export function PortPathPicker(_props: PortPathPickerProps): never {
	return notImplemented("RUN-04");
}
