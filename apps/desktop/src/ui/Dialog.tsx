/**
 * @feature APP-05 Dialog
 * Owns: modal dialogs (reset chat, rename, quick open, shortcuts), built on the radix Dialog.
 * Behaviour: ui-map.md 8 (Dialog parts), 5.2 (dialog titles); ui-dimensions.md 4 (512px default, 24px padding,
 * 16px gap, 6px radius, 1px border, shadow-lg; top edge at the larger of 32px and 50% minus 250px; title text-xl
 * medium with line height 1 and tight tracking; description text-sm muted; footer buttons 8px apart). Sizes are
 * the widths Conductor uses: sm 384, md 448, lg 512 (the default), xl 576, 2xl 672, 3xl 768, 4xl 896.
 * Must handle: a title is required (radix needs it for screen readers; `hideTitle` keeps it off screen),
 * focus is trapped and returns to the trigger, Escape and the overlay close it, `Cmd+Enter` calls `onConfirm`
 * whenever the dialog is open, including while focus is in a child field such as a textarea (ui-map.md 5.4
 * lists it as one dialog-level shortcut and gives no input-focus exception), long content scrolls inside the
 * dialog.
 * Test first: opening shows the title and description; Escape calls onOpenChange(false); Cmd+Enter confirms.
 */
import { Dialog as Radix, VisuallyHidden } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "./cn.ts";
import { letShortcutsThroughProps } from "./dialog-shortcuts.ts";

export const Dialog = Radix.Root;
export const DialogTrigger = Radix.Trigger;
export const DialogClose = Radix.Close;

export interface DialogContentProps {
	title: string;
	description?: ReactNode;
	hideTitle?: boolean;
	/** Keeps the description for screen readers only, as Conductor's `sr-only` descriptions are. */
	hideDescription?: boolean;
	size?: DialogSize;
	className?: string;
	/** The action Cmd+Enter runs while the dialog is open. */
	onConfirm?: () => void;
	/**
	 * App shortcuts keep running while this is open, as under the dialogs Conductor keeps off its
	 * dialog store (ui-map.md 5.4). Off by default: a dialog holds them.
	 */
	letShortcutsThrough?: boolean;
	children: ReactNode;
}

export type DialogSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl";

const sizeClass: Record<DialogSize, string> = {
	sm: "max-w-sm",
	md: "max-w-md",
	lg: "max-w-lg",
	xl: "max-w-xl",
	"2xl": "max-w-2xl",
	"3xl": "max-w-3xl",
	"4xl": "max-w-4xl",
};

export function DialogContent({
	title,
	description,
	hideTitle = false,
	hideDescription = false,
	size = "lg",
	className,
	onConfirm,
	letShortcutsThrough = false,
	children,
}: DialogContentProps) {
	const heading = (
		<Radix.Title className="text-xl leading-none font-medium tracking-tight text-fg">
			{title}
		</Radix.Title>
	);
	return (
		<Radix.Portal>
			<Radix.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-xs" />
			{/* Conductor's positioner (renderApp @1846028): the dialog starts at the same height as
			    before and ends 2rem above the window's bottom; a taller dialog scrolls inside it. */}
			<div className="pointer-events-none fixed inset-x-0 top-[max(2rem,calc(50%-250px))] bottom-0 z-50 flex items-start justify-center px-4 pb-8">
				<Radix.Content
					className={cn(
						"pointer-events-auto relative flex max-h-full w-full flex-col gap-4 overflow-y-auto",
						"rounded-md border border-border bg-raised p-6 text-fg shadow-dialog",
						sizeClass[size],
						className,
					)}
					onKeyDown={(event) => {
						if (event.metaKey && event.key === "Enter" && onConfirm) {
							event.preventDefault();
							onConfirm();
						}
					}}
					{...(description ? {} : { "aria-describedby": undefined })}
					{...letShortcutsThroughProps(letShortcutsThrough)}
				>
					{hideTitle ? <VisuallyHidden.Root>{heading}</VisuallyHidden.Root> : heading}
					{description ? (
						hideDescription ? (
							<VisuallyHidden.Root>
								<Radix.Description>{description}</Radix.Description>
							</VisuallyHidden.Root>
						) : (
							<Radix.Description className="-mt-2 text-sm text-fg-muted">
								{description}
							</Radix.Description>
						)
					) : null}
					{children}
				</Radix.Content>
			</div>
		</Radix.Portal>
	);
}

export function DialogFooter({ children }: { children: ReactNode }) {
	return <div className="flex justify-end gap-2">{children}</div>;
}
