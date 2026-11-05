/**
 * @feature CHAT-06 Link that opens outside the app
 * Owns: a link whose target comes from the agent. A web or mail address opens in the default app through the
 * opener; anything else is shown as plain text.
 * Behaviour: ui-map.md 3.3 (links in assistant text open outside the app).
 * Must handle: the link never navigates the app window (the click and the middle click are cancelled and the
 * opener does the work); only http, https and mailto addresses become links, so a `javascript:` or `file:`
 * address from the agent has no `href`; an open that fails shows a toast.
 * Test first: clicking a web link calls the opener with its address; a file address renders no link.
 */
import type { ReactNode } from "react";
import { useActions } from "../../core/hooks.ts";
import { reportFailure } from "./report-failure.ts";

const OPENABLE = /^(?:https?|mailto):/i;

export function isOpenableUrl(url: string): boolean {
	return OPENABLE.test(url);
}

export function ExternalLink({
	url,
	className,
	title,
	children,
}: {
	url: string;
	className?: string;
	title?: string;
	children: ReactNode;
}) {
	const actions = useActions();
	if (!isOpenableUrl(url)) return <span className={className}>{children}</span>;
	return (
		<a
			href={url}
			title={title ?? url}
			onClick={(event) => {
				event.preventDefault();
				void reportFailure(actions.app.openUrl(url), "Couldn't open the link");
			}}
			onAuxClick={(event) => event.preventDefault()}
			className={className}
		>
			{children}
		</a>
	);
}
