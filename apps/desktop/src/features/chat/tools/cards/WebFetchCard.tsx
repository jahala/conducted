/**
 * @feature CHAT-08 Web fetch card
 * Owns: The card for fetching a web page: the address and a short excerpt of what came back.
 * Behaviour: frontend.md 5 (registry key 'web'), ui-map.md 3.3 (approval title 'fetch this page').
 * Must handle: Blocked or failed fetch (error in the frame); the address opens outside the app only
 * on click; redirects (final address shown); a very long page (cut).
 * Test first: A web_fetch call shows the host prominently and the full address on hover.
 */
import { ExternalLink } from "../../ExternalLink.tsx";
import { asRecord, ToolCardFrame, textField, textLines, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

const EXCERPT_LINES = 20;

function hostOf(address: string): string {
	try {
		return new URL(address).host;
	} catch {
		return address;
	}
}

export function WebFetchCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const address = textField(input, "url", "address") ?? "";
	const host = hostOf(address);
	const excerpt = textLines(call.result?.output ?? "").slice(0, EXCERPT_LINES);
	return (
		<ToolCardFrame
			title="Web fetch"
			summary={host}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				excerpt.length === 0 ? null : (
					<pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs text-fg-muted">
						{excerpt.join("\n")}
					</pre>
				)
			}
			footer={
				address.length > 0 ? (
					<ExternalLink url={address} className="truncate text-link hover:underline">
						{address}
					</ExternalLink>
				) : undefined
			}
		/>
	);
}
