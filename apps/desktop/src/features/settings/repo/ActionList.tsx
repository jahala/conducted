/**
 * @feature SET-07 Action list
 * Owns: the list of actions on the Actions page with icon, name, command, source marker, default
 * marker and row actions.
 * Behaviour: ui-map.md 6, "Actions page"; services-map.md 5A.1.6.
 * Must handle: a long command (one line, truncated), the default action marked and changed,
 * source "shared" versus "personal", a shared action edited on this Mac offering Reset, hidden
 * actions shown muted, and no actions (the parent shows the empty state).
 * Test first: a shared action shows Hide but not Delete, and a personal one shows Delete.
 */
import { Badge } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";
import { cn } from "../../../ui/cn.ts";
import { ActionIcon } from "../../scripts-panel/run/ActionIconPicker.tsx";

export interface ActionListItem {
	id: string;
	label: string;
	command: string;
	icon: string | null;
	isDefault: boolean;
	source: "shared" | "personal";
	hidden: boolean;
	/** True when this Mac changed a shared action, so Reset is offered. */
	canReset?: boolean;
}

export interface ActionListProps {
	items: ActionListItem[];
	onEdit: (id: string) => void;
	onDelete: (id: string) => void;
	onToggleHidden: (id: string, hidden: boolean) => void;
	onSetDefault: (id: string) => void;
	onReset?: (id: string) => void;
}

export function ActionList({
	items,
	onEdit,
	onDelete,
	onToggleHidden,
	onSetDefault,
	onReset,
}: ActionListProps) {
	if (items.length === 0) return null;
	return (
		<ul aria-label="Actions" className="flex flex-col">
			{items.map((item) => (
				<li
					key={item.id}
					aria-label={item.label}
					className={cn(
						"flex items-center gap-3 border-t border-border py-3 first:border-t-0",
						item.hidden && "opacity-60",
					)}
				>
					<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-fg-muted">
						<ActionIcon name={item.icon} />
					</span>

					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<div className="flex min-w-0 flex-wrap items-center gap-2">
							<span className="truncate text-sm font-medium text-fg">{item.label}</span>
							{item.isDefault ? <Badge tone="success">Default</Badge> : null}
							<Badge>{item.source === "shared" ? "Shared" : "Personal"}</Badge>
							{item.canReset ? <Badge tone="warning">Edited here</Badge> : null}
							{item.hidden ? <Badge>Hidden</Badge> : null}
						</div>
						<code title={item.command} className="truncate font-mono text-xs text-fg-muted">
							{item.command}
						</code>
					</div>

					<div className="flex shrink-0 items-center gap-1">
						{!item.isDefault ? (
							<Button size="xs" variant="ghost" onClick={() => onSetDefault(item.id)}>
								Make default
							</Button>
						) : null}
						<Button
							size="xs"
							variant="ghost"
							aria-label={item.hidden ? "Show action" : "Hide action"}
							title={item.hidden ? "Show action" : "Hide action"}
							onClick={() => onToggleHidden(item.id, !item.hidden)}
						>
							{item.hidden ? "Show" : "Hide"}
						</Button>
						<Button size="xs" variant="ghost" onClick={() => onEdit(item.id)}>
							Edit
						</Button>
						{item.canReset && onReset ? (
							<Button
								size="xs"
								variant="ghost"
								title="Reset to your repo's settings.toml"
								onClick={() => onReset(item.id)}
							>
								Reset
							</Button>
						) : null}
						{item.source === "personal" ? (
							<Button
								size="xs"
								variant="outlineDestructive"
								aria-label="Delete action"
								onClick={() => onDelete(item.id)}
							>
								Delete
							</Button>
						) : null}
					</div>
				</li>
			))}
		</ul>
	);
}
