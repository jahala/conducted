/**
 * @feature NAV-03 Help menu
 * Owns: the "?" button at the bottom of the sidebar and its menu: Keyboard shortcuts, Send feedback,
 * Diagnostics and Open debug tools.
 * Behaviour: ui-map.md 5.4 (Cmd+Alt+/ shortcuts help, Cmd+Alt+F send feedback, Cmd+Alt+I debug tools).
 * Measured from Conductor 0.92.1 (renderApp @10177048, @10375068): the sidebar footer is one row, 16px by
 * 12px padding over a top rule, with the plan badge at the left and, at the right 20px apart, a 16px help
 * icon and a 16px settings gear in the muted sidebar colour. The help icon opens a 340px menu upward with
 * Keyboard shortcuts, Docs, Best practices, Changelog, Send feedback, Discord, Submit a prompt, Diagnostics,
 * Open debug tools and a version line.
 * Our design choice: the menu holds the items this app can run. Docs, Best practices, Changelog, Discord and
 * Submit a prompt open Conductor's own web pages and services, and the version line names Conductor's agents'
 * versions, so they are left out. Each item runs its command the way its shortcut does: a screen's handler
 * first, then the command service.
 * Must handle: a command that fails (a toast naming it); the menu closing after a choice; keyboard focus on
 * the icon button.
 * Test first: choosing Keyboard shortcuts runs app.showShortcuts.
 */
import { useRunCommandHandlers } from "../../app/command-dispatcher.ts";
import { useServices } from "../../core/context.tsx";
import { useLiveShortcut } from "../../core/hooks.ts";
import {
	CpuIcon,
	HelpCircleIcon,
	KeyboardIcon,
	MessageSquareIcon,
	WrenchIcon,
} from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/Menu.tsx";
import { toastError } from "../../ui/Toast.tsx";

const ITEMS = [
	{ commandId: "app.showShortcuts", label: "Keyboard shortcuts", icon: <KeyboardIcon /> },
	{ commandId: "app.sendFeedback", label: "Send feedback", icon: <MessageSquareIcon /> },
	{ commandId: "app.openDiagnostics", label: "Diagnostics", icon: <CpuIcon /> },
	{ commandId: "app.openDebugTools", label: "Open debug tools", icon: <WrenchIcon /> },
] as const;

function HelpItem({ item }: { item: (typeof ITEMS)[number] }) {
	const runHandlers = useRunCommandHandlers();
	const { services } = useServices();
	const shortcut = useLiveShortcut(item.commandId);
	const run = () => {
		if (runHandlers(item.commandId)) return;
		void services.commands.run(item.commandId).then((result) => {
			if (!result.ok) toastError(`Couldn't open ${item.label.toLowerCase()}`, result.error);
		});
	};
	return (
		<MenuItem icon={item.icon} shortcut={shortcut ?? undefined} onSelect={run}>
			{item.label}
		</MenuItem>
	);
}

export function HelpMenu() {
	return (
		<Menu>
			<MenuTrigger
				aria-label="Help"
				title="Help"
				className="flex size-4 shrink-0 items-center justify-center rounded-sm text-sidebar-fg-muted transition-colors hover:text-fg"
			>
				<HelpCircleIcon />
			</MenuTrigger>
			<MenuContent side="top" align="start" sideOffset={4} className="w-[340px]">
				{ITEMS.map((item) => (
					<HelpItem key={item.commandId} item={item} />
				))}
			</MenuContent>
		</Menu>
	);
}
