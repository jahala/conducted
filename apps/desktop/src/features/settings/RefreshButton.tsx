/**
 * @feature SET-02 Settings Refresh button
 * Owns: the small Refresh button settings rows put beside their status: a ghost button with a
 * turning-arrows icon that spins, and waits, while the check runs.
 * Behaviour: Conductor's Refresh on the Agents page (renderApp Mci) and on Account's Linear row
 * (renderApp YVe): a 28 px ghost button with 8 px sides and a 12 px icon.
 * Must handle: a refresh in flight (the icon spins and a second press is ignored).
 * Test first: AgentCard.test.tsx, Refresh spins and is disabled while a refresh runs.
 */
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import { RefreshIcon } from "../../ui/icons.tsx";

export function RefreshButton({
	refreshing,
	onRefresh,
}: {
	refreshing: boolean;
	onRefresh: () => void;
}) {
	return (
		<Button
			size="sm"
			variant="ghost"
			className="h-7 px-2"
			disabled={refreshing}
			onClick={onRefresh}
		>
			<RefreshIcon className={cn("mr-1 size-3", refreshing && "animate-spin")} />
			Refresh
		</Button>
	);
}
