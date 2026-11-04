/**
 * @feature APP-05 Toast
 * Owns: the one toast host, built on sonner, themed with our tokens. Screens call `toast` for short feedback.
 * Behaviour: ui-map.md 7.4 (toasts such as "Failed to create workspace"; success, error and warning kinds).
 * Our design choice: toasts report an outcome. Anything the user must act on gets a designed state or a card.
 * Must handle: error toasts stay long enough to read, success toasts are short, the host sits at the bottom
 * right and never covers the composer's send button, `role="status"` for screen readers (sonner).
 * Test first: toast.error("x") shows "x" in the host.
 */
import { Toaster as Sonner } from "sonner";

export { toast } from "sonner";

export function Toaster() {
	return (
		<Sonner
			position="bottom-right"
			toastOptions={{
				unstyled: true,
				classNames: {
					toast:
						"flex w-80 items-start gap-2 rounded-lg bg-raised p-3 text-sm text-fg shadow-popover",
					title: "font-medium",
					description: "text-fg-muted",
					error: "text-danger",
					warning: "text-warning",
					success: "text-success",
				},
			}}
		/>
	);
}
