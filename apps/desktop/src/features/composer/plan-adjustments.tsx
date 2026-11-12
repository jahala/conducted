/**
 * @feature CHAT-12 Plan adjustments between the composer and the plan bar
 * Owns: the link one chat pane gives its plan bar to its composer, so the bar's Approve can send
 * the composer's text as the plan's adjustments: `PlanAdjustmentsProvider`,
 * `useProvidePlanAdjustments` and `useSendPlanAdjustments`.
 * Behaviour: Conductor's Approve button and its "Approve plan" shortcut run one action. With text in
 * the composer it sends the text as the plan's adjustments; with none it approves (renderApp
 * @9313268, the bar's onApprovePlan at @9315041).
 * Our design choice: Conductor draws the plan bar inside its composer, so the action reads the
 * composer's text directly. Ours are two parts of the chat pane, so the pane holds this link. It is
 * per pane, so two chats side by side in a split pane each reach their own composer.
 * Must handle: no composer in the pane (an archived workspace): nothing is sent and the bar approves;
 * the composer unmounting (its sender is removed).
 * Test first: the plan bar's Approve sends the composer's text as the plan's adjustments.
 */
import {
	createContext,
	type MutableRefObject,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
} from "react";

/**
 * What the composer did with its text. "sent": the text went as the plan's adjustments. "busy":
 * an earlier send is still on its way, so approving now would answer the plan twice. "none": the
 * composer is empty or no plan waits, so approving is up to the caller.
 */
export type PlanAdjustmentsOutcome = "sent" | "busy" | "none";

type Sender = () => PlanAdjustmentsOutcome;

const PlanAdjustmentsContext = createContext<MutableRefObject<Sender | null> | null>(null);

/** One per chat pane: links the pane's plan bar to the pane's composer. */
export function PlanAdjustmentsProvider({ children }: { children?: ReactNode }) {
	const sender = useRef<Sender | null>(null);
	return (
		<PlanAdjustmentsContext.Provider value={sender}>{children}</PlanAdjustmentsContext.Provider>
	);
}

/** The composer hands the pane its sender while it is mounted. */
export function useProvidePlanAdjustments(send: Sender): void {
	const slot = useContext(PlanAdjustmentsContext);
	const latest = useRef(send);
	latest.current = send;
	useEffect(() => {
		if (slot === null) return;
		const own: Sender = () => latest.current();
		slot.current = own;
		return () => {
			if (slot.current === own) slot.current = null;
		};
	}, [slot]);
}

/** The plan bar asks the pane's composer to send its text. With no composer there is nothing to send. */
export function useSendPlanAdjustments(): Sender {
	const slot = useContext(PlanAdjustmentsContext);
	return useCallback(() => slot?.current?.() ?? "none", [slot]);
}
