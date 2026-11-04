/**
 * @feature RUN-01 Scripts panel tab strip
 * Owns: the tab buttons of the scripts panel and the collapse button. Fixed tabs Setup, Run and
 * Ports; one tab per terminal; a "new terminal" button.
 * Behaviour: ui-map.md 3.7 (tabs; "New terminal", "Close terminal", "Maximum N terminals
 * allowed"; Cmd+J "Toggle terminal panel").
 * Must handle: a status dot on Setup (running, failed) and Run (running), the limit disabling "new
 * terminal" with the reason as a tooltip, many terminals (the strip scrolls), middle-click closing
 * a terminal tab, and the Ports tab being hidden until a port is detected (Our design choice).
 * Test first: at the terminal limit the new-terminal button is disabled and says why.
 */

import type { TerminalId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export type ScriptsPanelTabId =
	| { kind: "setup" }
	| { kind: "run" }
	| { kind: "ports" }
	| { kind: "terminal"; terminalId: TerminalId };

export interface ScriptsPanelTabsProps {
	active: ScriptsPanelTabId;
	terminals: { id: TerminalId; title: string; ended: boolean }[];
	setupStatus: "idle" | "running" | "failed" | "completed";
	runActive: boolean;
	showPorts: boolean;
	terminalLimit: number;
	collapsed: boolean;
	onSelect: (tab: ScriptsPanelTabId) => void;
	onNewTerminal: () => void;
	onCloseTerminal: (id: TerminalId) => void;
	onToggleCollapsed: () => void;
}

export function ScriptsPanelTabs(_props: ScriptsPanelTabsProps): never {
	return notImplemented("RUN-01");
}
