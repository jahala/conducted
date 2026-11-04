/**
 * @feature APP-05 Dialog
 * Owns: modal dialogs (reset chat, rename, quick open, shortcuts), built on the radix Dialog.
 * Behaviour: ui-map.md 8 (Dialog parts), 5.2 (dialog titles).
 * Must handle: a title is required (radix needs it for screen readers; `hideTitle` keeps it off screen),
 * focus is trapped and returns to the trigger, Escape and the overlay close it, `Cmd+Enter` confirm is the
 * caller's job, long content scrolls inside the dialog.
 * Test first: opening shows the title and description; Escape calls onOpenChange(false).
 */
import { Dialog as Radix, VisuallyHidden } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export const Dialog = Radix.Root;
export const DialogTrigger = Radix.Trigger;
export const DialogClose = Radix.Close;

export interface DialogContentProps {
	title: string;
	description?: string;
	hideTitle?: boolean;
	size?: "sm" | "md" | "lg";
	className?: string;
	children: ReactNode;
}

const sizeClass = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-3xl" } as const;

export function DialogContent({
	title,
	description,
	hideTitle = false,
	size = "md",
	className,
	children,
}: DialogContentProps) {
	const heading = <Radix.Title className="text-lg font-semibold text-fg">{title}</Radix.Title>;
	return (
		<Radix.Portal>
			<Radix.Overlay className="fixed inset-0 z-40 bg-overlay" />
			<Radix.Content
				className={cn(
					"fixed left-1/2 top-[18%] z-50 flex max-h-[70vh] w-[calc(100%-2rem)] -translate-x-1/2 flex-col gap-4",
					"rounded-lg bg-raised p-5 text-fg shadow-popover",
					sizeClass[size],
					className,
				)}
				{...(description ? {} : { "aria-describedby": undefined })}
			>
				{hideTitle ? <VisuallyHidden.Root>{heading}</VisuallyHidden.Root> : heading}
				{description ? (
					<Radix.Description className="-mt-2 text-sm text-fg-muted">
						{description}
					</Radix.Description>
				) : null}
				{children}
			</Radix.Content>
		</Radix.Portal>
	);
}

export function DialogFooter({ children }: { children: ReactNode }) {
	return <div className="flex justify-end gap-2">{children}</div>;
}
