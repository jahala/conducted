/**
 * @feature REV-03 Discard comment dialog
 * Owns: the confirm dialog shown when the user cancels a comment that has text.
 * Behaviour: ui-map.md 3.6 ("Discard comment?" dialog, buttons Keep editing and Discard).
 * Must handle: Escape and Keep editing both call onKeep; Discard calls onDiscard once and not
 * onKeep.
 * Test first: pressing Discard calls onDiscard once and Keep editing calls onKeep.
 */
import { AlertDialog as Radix } from "radix-ui";
import { useRef } from "react";
import { Button } from "../../ui/Button.tsx";

export interface DiscardCommentDialogProps {
	open: boolean;
	onKeep: () => void;
	onDiscard: () => void;
}

export function DiscardCommentDialog({ open, onKeep, onDiscard }: DiscardCommentDialogProps) {
	const discarding = useRef(false);

	return (
		<Radix.Root
			open={open}
			onOpenChange={(next) => {
				if (next) return;
				if (discarding.current) {
					discarding.current = false;
					return;
				}
				onKeep();
			}}
		>
			<Radix.Portal>
				<Radix.Overlay className="fixed inset-0 z-40 bg-overlay" />
				<Radix.Content className="fixed left-1/2 top-[max(2rem,calc(50%-250px))] z-50 flex max-h-[calc(100%-4rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 flex-col gap-4 rounded-xl border border-border bg-raised p-6 text-fg shadow-dialog">
					<Radix.Title className="text-lg leading-none font-medium tracking-tight text-fg">
						Discard comment?
					</Radix.Title>
					<Radix.Description className="text-sm text-fg-muted">
						Your text will be lost.
					</Radix.Description>
					<div className="flex justify-end gap-2">
						<Radix.Cancel asChild>
							<Button variant="outline">Keep editing</Button>
						</Radix.Cancel>
						<Radix.Action asChild>
							<Button
								variant="destructive"
								onClick={() => {
									discarding.current = true;
									onDiscard();
								}}
							>
								Discard
							</Button>
						</Radix.Action>
					</div>
				</Radix.Content>
			</Radix.Portal>
		</Radix.Root>
	);
}
