/**
 * @feature APP-04 Route error and not-found screens
 * Owns: the two full-region screens for a route that fails to render and for an address that matches no route.
 * Behaviour: ui-map.md 7.4 ("Something went wrong!", "Not Found", "Try again").
 * Must handle: the error message is shown in plain words, never a stack; "Try again" re-runs the route;
 * "Go to Home" always works, also when the error came from the router; both keep the window draggable.
 * Test first: the not-found screen offers a link to /all-workspaces.
 */
import { Link } from "@tanstack/react-router";
import { Button, buttonClassName } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";

export function NotFoundScreen() {
	return (
		<div className="flex h-full flex-col bg-canvas">
			<div data-tauri-drag-region className="h-(--titlebar-height) shrink-0" />
			<EmptyState
				title="That page does not exist"
				body="The address may be old, or the workspace may have been removed."
				action={
					<Link to="/all-workspaces" className={buttonClassName({ variant: "default" })}>
						Go to Home
					</Link>
				}
			/>
		</div>
	);
}

export function RouteErrorScreen({ error, reset }: { error: Error; reset: () => void }) {
	return (
		<div className="flex h-full flex-col bg-canvas">
			<div data-tauri-drag-region className="h-(--titlebar-height) shrink-0" />
			<EmptyState
				title="Something went wrong"
				body={error.message}
				action={
					<div className="flex gap-2">
						<Button variant="default" onClick={reset}>
							Try again
						</Button>
						<Button variant="secondary" onClick={() => window.location.assign("/")}>
							Reload the app
						</Button>
					</div>
				}
			/>
		</div>
	);
}
