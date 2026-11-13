/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Owns: the notice, anywhere in the app, that a cloud MCP server's sign-in needs renewing: one
 * toast per server that stays until it is reconnected, with Reconnect opening the MCP page.
 * Behaviour: Conductor's `stl` and `ntl` (renderApp-DeUrsznk.js @11666530, @11665941): the list is
 * read every 5 minutes and when the window gains focus; a server whose credential turns
 * `needs_reauth` gets "<Name> MCP server needs re-authentication" with its mark, no timeout and a
 * "Reconnect" action (`otl`, the MCP settings page); the toast goes when the server is active
 * again or gone, and each server is told once until then.
 * Data: useCloudMcpOAuth (read while paired) and Actions.cloud.loadMcpOAuth.
 * Must handle: an unpaired Mac (nothing); a server that recovers (its toast is dismissed); many
 * servers at once (one toast each); the notice leaving the screen (its toasts go too).
 * Test first: McpServersSection.test.tsx shows the notice for a server that needs re-auth.
 */
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { mcpDisplayName } from "../../../core/cloud-mcp.ts";
import { useActions, useCloudMcpOAuth, useCloudPairing } from "../../../core/hooks.ts";
import { toast } from "../../../ui/Toast.tsx";
import { McpServerIcon } from "./McpServerIcon.tsx";

/** Conductor reads the list every 5 minutes while the app runs (`itl`). */
const REFRESH_MS = 300_000;

export function McpReauthNotice() {
	const actions = useActions();
	const pairing = useCloudPairing();
	const paired = pairing.state === "ready" && pairing.data.paired;
	const oauth = useCloudMcpOAuth();
	const navigate = useNavigate();
	const toasts = useRef(new Map<string, string | number>());

	useEffect(() => {
		if (!paired) return;
		const read = () => void actions.cloud.loadMcpOAuth();
		const timer = setInterval(read, REFRESH_MS);
		window.addEventListener("focus", read);
		return () => {
			clearInterval(timer);
			window.removeEventListener("focus", read);
		};
	}, [actions, paired]);

	const credentials = oauth.state === "ready" && paired ? oauth.data.credentials : {};
	const needing = Object.entries(credentials)
		.filter(([, credential]) => credential.status === "needs_reauth")
		.map(([name]) => name)
		.sort()
		.join("\n");

	useEffect(() => {
		const shown = toasts.current;
		const wanted = new Set(needing === "" ? [] : needing.split("\n"));
		for (const [name, id] of shown) {
			if (wanted.has(name)) continue;
			toast.dismiss(id);
			shown.delete(name);
		}
		for (const name of wanted) {
			if (shown.has(name)) continue;
			const id = toast(`${mcpDisplayName(name)} MCP server needs re-authentication`, {
				icon: <McpServerIcon name={name} />,
				duration: Number.POSITIVE_INFINITY,
				action: {
					label: "Reconnect",
					onClick: () => {
						void navigate({ to: "/settings/user/$page", params: { page: "mcp" } });
					},
				},
			});
			shown.set(name, id);
		}
	}, [needing, navigate]);

	useEffect(() => {
		const shown = toasts.current;
		return () => {
			for (const id of shown.values()) toast.dismiss(id);
			shown.clear();
		};
	}, []);

	return null;
}
