/**
 * @feature APP-04 Route error and not-found screens
 * Owns: the two full-region screens for a route that fails to render and for an address that matches no route.
 * Behaviour: ui-map.md 7.4 ("Something went wrong!", "Not Found", "Try again").
 * Must handle: the error message is shown in plain words, never a stack; "Try again" re-runs the route;
 * "Go to Home" is a router link and works while the router is alive; "Reload the app" is the fallback that
 * gets the user home when the router itself failed; both keep the window draggable.
 * Test first: the not-found screen offers a link to /all-workspaces.
 */
import { Link } from "@tanstack/react-router";
import { Button, buttonClassName } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { FullPage } from "./FullPage.tsx";

export function NotFoundScreen() {
	return (
		<FullPage>
			<EmptyState
				title="Not Found"
				body="The address may be old, or the workspace may have been removed."
				action={
					<Link to="/all-workspaces" className={buttonClassName({ variant: "default" })}>
						Go to Home
					</Link>
				}
			/>
		</FullPage>
	);
}

export function RouteErrorScreen({
	error,
	reset,
	reload = () => window.location.assign("/"),
}: {
	error: Error;
	reset: () => void;
	/** Side effect at the edge: the caller passes the reload, tests can stand one in. */
	reload?: () => void;
}) {
	return (
		<FullPage>
			<EmptyState
				title="Something went wrong!"
				tone="failed"
				body={error.message}
				action={
					<div className="flex gap-2">
						<Button variant="default" onClick={reset}>
							Try again
						</Button>
						<Link to="/all-workspaces" className={buttonClassName({ variant: "secondary" })}>
							Go to Home
						</Link>
						<Button variant="secondary" onClick={reload}>
							Reload the app
						</Button>
					</div>
				}
			/>
		</FullPage>
	);
}
