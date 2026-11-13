/**
 * @feature APP-05 Sheet
 * Owns: the side panel that slides over the window's right edge for an editor too tall for a
 * dialog, built on the radix Dialog.
 * Behaviour: Conductor's SheetContent (renderApp hQe @10685722) with the Environment page's
 * editors (renderApp NDa and Cnr): 520 px wide and the window's full height, a close cross at the
 * top right, a header with an 18 px medium title and a muted description, a scrolling body with
 * 24 px sides and 40 px above, and a footer over a rule with 24 by 16 px padding, its buttons at the
 * right. Cmd+Enter presses the footer's primary button, as Conductor's dialog.primaryAction does.
 * Must handle: a title for screen readers (required), Escape and the overlay closing it, focus kept
 * inside while open, Cmd+Enter from a field inside it, and a body taller than the window (it scrolls,
 * the footer stays).
 * Test first: Cmd+Enter in a field presses the primary button, and Escape asks to close.
 */
import { Dialog as Radix } from "radix-ui";
import type { ReactNode } from "react";
import { letShortcutsThroughProps } from "./dialog-shortcuts.ts";
import { CloseIcon } from "./icons.tsx";

export const Sheet = Radix.Root;

export interface SheetContentProps {
	title: string;
	description?: ReactNode;
	/** The footer's buttons; the primary one carries `data-primary-action`. */
	footer: ReactNode;
	/**
	 * App shortcuts keep running while this is open, as under the dialogs Conductor keeps off its
	 * dialog store (ui-map.md 5.4). Off by default: a dialog holds them.
	 */
	letShortcutsThrough?: boolean;
	children: ReactNode;
}

export function SheetContent({
	title,
	description,
	footer,
	letShortcutsThrough = false,
	children,
}: SheetContentProps) {
	return (
		<Radix.Portal>
			<Radix.Overlay className="fixed inset-0 z-40 bg-overlay" />
			<Radix.Content
				className="fixed inset-y-0 right-0 z-50 flex h-full w-[520px] max-w-[calc(100vw-2rem)] flex-col border-l border-border bg-raised text-fg shadow-dialog"
				onKeyDown={(event) => {
					if (!event.metaKey || event.key !== "Enter") return;
					const primary =
						event.currentTarget.querySelector<HTMLButtonElement>("[data-primary-action]");
					if (primary === null || primary.disabled) return;
					event.preventDefault();
					primary.click();
				}}
				{...(description === undefined ? { "aria-describedby": undefined } : {})}
				{...letShortcutsThroughProps(letShortcutsThrough)}
			>
				<Radix.Close
					aria-label="Close"
					className="absolute top-4 right-4 rounded-sm text-fg-muted opacity-70 transition-opacity hover:opacity-100"
				>
					<CloseIcon className="size-4" />
				</Radix.Close>
				<div className="flex-1 overflow-y-auto px-6 pt-10 pb-6">
					<div className="flex h-full w-full flex-col">
						<div className="flex flex-col gap-2 pr-8 text-left">
							<Radix.Title className="text-lg font-medium text-fg">{title}</Radix.Title>
							{description === undefined ? null : (
								<Radix.Description className="text-sm text-fg-muted">
									{description}
								</Radix.Description>
							)}
						</div>
						{children}
					</div>
				</div>
				<div className="flex justify-end gap-2 border-t border-border px-6 py-4">{footer}</div>
			</Radix.Content>
		</Radix.Portal>
	);
}
