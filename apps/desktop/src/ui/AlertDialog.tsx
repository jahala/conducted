/**
 * @feature APP-13 AlertDialog
 * Owns: the modal that asks for confirmation and the destructive-action dialog, built on the radix AlertDialog.
 * Behaviour: ui-map.md 8 (AlertDialog and its parts); ui-dimensions.md 4 (max width 512px, 24px padding,
 * 16px gap, 12px radius, title text-lg medium) and 1.7 (dialog fade 200ms, scale from 0.95).
 * Our design choice: the content carries the title, the optional text and the Cancel and confirm buttons,
 * because every confirm dialog in the app has that shape. The confirm button is the destructive variant when
 * the caller says so. Escape and Cancel close; the confirm hands back to `onConfirm` and closes.
 * Must handle: a title is required (radix needs it for screen readers); no description; a destructive tone;
 * the keyboard focus that radix traps and returns; a controlled and an uncontrolled dialog.
 * Test first: the action calls onConfirm and closes, Cancel closes, and Escape closes.
 */
import { AlertDialog as Radix } from "radix-ui";
import type { ReactNode } from "react";
import { Button } from "./Button.tsx";
import { cn } from "./cn.ts";
import { letShortcutsThroughProps } from "./dialog-shortcuts.ts";

export const AlertDialog = Radix.Root;
export const AlertDialogTrigger = Radix.Trigger;
export const AlertDialogCancel = Radix.Cancel;
export const AlertDialogAction = Radix.Action;

export type AlertDialogTone = "default" | "destructive";

export interface AlertDialogContentProps {
	title: string;
	description?: string;
	/** The body between the description and the buttons. */
	children?: ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	tone?: AlertDialogTone;
	onConfirm?: () => void;
	className?: string;
	/**
	 * App shortcuts keep running while this is open, as under the dialogs Conductor keeps off its
	 * dialog store (ui-map.md 5.4). Off by default: a dialog holds them.
	 */
	letShortcutsThrough?: boolean;
}

export function AlertDialogContent({
	title,
	description,
	children,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	tone = "default",
	onConfirm,
	className,
	letShortcutsThrough = false,
}: AlertDialogContentProps) {
	return (
		<Radix.Portal>
			<Radix.Overlay className="fixed inset-0 z-40 bg-overlay" />
			<Radix.Content
				className={cn(
					"fixed left-1/2 top-[max(2rem,calc(50%-250px))] z-50 flex max-h-[calc(100%-4rem)] w-[calc(100%-2rem)]",
					"-translate-x-1/2 flex-col gap-4 rounded-xl border border-border bg-raised p-6 text-fg shadow-dialog",
					"max-w-lg",
					className,
				)}
				{...(description ? {} : { "aria-describedby": undefined })}
				{...letShortcutsThroughProps(letShortcutsThrough)}
			>
				<AlertDialogHeader>
					<Radix.Title className="text-lg leading-none font-medium tracking-tight text-fg">
						{title}
					</Radix.Title>
					{description ? (
						<Radix.Description className="text-sm text-fg-muted">{description}</Radix.Description>
					) : null}
				</AlertDialogHeader>
				{children}
				<AlertDialogFooter>
					<Radix.Cancel asChild>
						<Button variant="outline">{cancelLabel}</Button>
					</Radix.Cancel>
					<Radix.Action asChild>
						<Button
							variant={tone === "destructive" ? "destructive" : "default"}
							onClick={onConfirm}
						>
							{confirmLabel}
						</Button>
					</Radix.Action>
				</AlertDialogFooter>
			</Radix.Content>
		</Radix.Portal>
	);
}

export function AlertDialogHeader({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return <div className={cn("flex flex-col gap-1.5", className)}>{children}</div>;
}

export function AlertDialogFooter({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return <div className={cn("flex justify-end gap-2", className)}>{children}</div>;
}
