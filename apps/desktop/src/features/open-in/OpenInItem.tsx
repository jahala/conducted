/**
 * @feature WS-08 Open-in menu item
 * Owns: one app in the Open in menu: its icon, label, a mark when it is the default, and the
 * "Set as default" secondary action; and `OpenInAppIcon`, the app's own icon that the Open in
 * buttons share.
 * Behaviour: ui-map.md 3.10. Conductor draws the app's own icon, read from its bundle, in a thin
 * ring (renderApp cU, @2498830); an app without one, or while its icon is read, shows a line icon
 * of its kind (folder, terminal, code).
 * Must handle: a long label (truncated by the shared menu row), and the default app offering no
 * "Set as default" action.
 * Test first: choosing the item calls onOpen with the app, and "Set as default" calls onSetDefault.
 */

import { useAppIcon } from "../../core/hooks.ts";
import { cn } from "../../ui/cn.ts";
import {
	CheckIcon,
	FileTextIcon,
	FolderPlusIcon,
	GitBranchIcon,
	TerminalIcon,
} from "../../ui/icons.tsx";
import { MenuItem } from "../../ui/Menu.tsx";
import type { OpenInApp, OpenInCategory } from "./open-in-apps.ts";

export interface OpenInItemProps {
	app: OpenInApp;
	isDefault: boolean;
	onOpen: (app: OpenInApp) => void;
	onSetDefault: (app: OpenInApp) => void;
}

const iconFor = (category: OpenInCategory) => {
	switch (category) {
		case "finder":
			return FolderPlusIcon;
		case "terminal":
			return TerminalIcon;
		case "git_tool":
			return GitBranchIcon;
		case "editor":
		case "ide":
			return FileTextIcon;
	}
};

/**
 * The app's own icon from its bundle, or its kind's line icon when it has none (yet). A
 * `decorative` picture sits beside text that already names the action, so it has no alt text.
 */
export function OpenInAppIcon({
	app,
	className = "size-4",
	decorative = false,
}: {
	app: OpenInApp;
	className?: string;
	decorative?: boolean;
}) {
	const icon = useAppIcon(app.appName);
	if (icon.state === "ready" && icon.data !== null) {
		return (
			<span className={cn("relative shrink-0 rounded-xs", className)}>
				<img
					src={icon.data}
					alt={decorative ? "" : `${app.label} icon`}
					className="size-full rounded-xs"
				/>
				<span
					aria-hidden="true"
					className="pointer-events-none absolute inset-0 rounded-xs border border-border mix-blend-darken dark:mix-blend-lighten"
				/>
			</span>
		);
	}
	const Icon = iconFor(app.category);
	// The line icons are always aria-hidden; the row or button names the app.
	return <Icon className={className} />;
}

export function OpenInItem({ app, isDefault, onOpen, onSetDefault }: OpenInItemProps) {
	return (
		<div className="group flex items-center gap-1">
			<MenuItem className="flex-1" icon={<OpenInAppIcon app={app} />} onSelect={() => onOpen(app)}>
				{app.label}
			</MenuItem>
			{isDefault ? (
				<span className="flex size-4 shrink-0 items-center justify-center text-fg-muted">
					<CheckIcon />
				</span>
			) : (
				<button
					type="button"
					className="shrink-0 rounded-sm px-2 py-1 text-xs text-fg-subtle opacity-0 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
					onClick={() => onSetDefault(app)}
				>
					Set as default
				</button>
			)}
		</div>
	);
}
