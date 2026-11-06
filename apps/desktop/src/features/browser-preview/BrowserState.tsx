/**
 * @feature RUN-04 Browser tab states
 * Owns: the designed full-tab states: starting, failed to load, server not running, preview turned
 * off, and archived.
 * Behaviour: ui-map.md 3.2 ("Starting preview..."), 3.2 archived text, and 7.2 ("No local servers
 * running. Start your dev server and it'll show up here.").
 * Must handle: one action per state (Retry, Open preview in browser, Unarchive), and the refused
 * connection wording naming the port.
 * Test first: kind "server_not_running" shows an action that calls onAction.
 */
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Spinner } from "../../ui/Spinner.tsx";

export type BrowserStateKind =
	| "starting"
	| "load_failed"
	| "server_not_running"
	| "preview_off"
	| "archived";

export interface BrowserStateProps {
	kind: BrowserStateKind;
	detail: string | null;
	onAction: () => void;
}

interface StateCopy {
	title: string;
	body: string;
	action: string | null;
}

const COPY: Record<BrowserStateKind, StateCopy> = {
	starting: {
		title: "Starting preview...",
		body: "Waiting for the dev server to answer.",
		action: null,
	},
	load_failed: {
		title: "Couldn't load the preview",
		body: "The page could not be shown inside the app.",
		action: "Retry",
	},
	server_not_running: {
		title: "No local servers running.",
		body: "Start your dev server and it'll show up here.",
		action: "Retry",
	},
	preview_off: {
		title: "In-app browser preview is off.",
		body: "Previews open in your browser. Turn on In-app browser preview in Settings to see them here.",
		action: "Open preview in browser",
	},
	archived: {
		title: "Workspace archived.",
		body: "Unarchive this workspace to view files, terminals, and browser previews.",
		action: "Unarchive",
	},
};

export function BrowserState({ kind, detail, onAction }: BrowserStateProps) {
	const copy = COPY[kind];
	return (
		<EmptyState
			title={copy.title}
			body={detail ?? copy.body}
			icon={kind === "starting" ? <Spinner label="Starting preview" size="lg" /> : undefined}
			action={
				copy.action === null ? undefined : (
					<Button variant="secondary" onClick={onAction}>
						{copy.action}
					</Button>
				)
			}
		/>
	);
}
