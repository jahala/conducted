/**
 * @feature WS-08 Open-in menu item
 * Owns: one app in the Open in menu: its category icon, label, a mark when it is the default, and
 * the "Set as default" secondary action.
 * Behaviour: ui-map.md 3.10.
 * Our design choice: the menu uses our own line icons, not the apps' icons. An app without an
 * icon of its own therefore still has a clear mark.
 * Must handle: a long label (truncated by the shared menu row), and the default app offering no
 * "Set as default" action.
 * Test first: choosing the item calls onOpen with the app, and "Set as default" calls onSetDefault.
 */
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

export function OpenInAppIcon({ category }: { category: OpenInCategory }) {
	const Icon = iconFor(category);
	return <Icon />;
}

export function OpenInItem({ app, isDefault, onOpen, onSetDefault }: OpenInItemProps) {
	return (
		<div className="group flex items-center gap-1">
			<MenuItem
				className="flex-1"
				icon={<OpenInAppIcon category={app.category} />}
				onSelect={() => onOpen(app)}
			>
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
