/**
 * @feature PR-01 GitHub access
 * Owns: the notification Conductor shows when GitHub refuses the saved sign-in, with the one
 * action that fixes it.
 * Behaviour: main @948377 and @952355 (an error toast that stays until dismissed; the `gh` login
 * says "GitHub sign-in expired" with Reconnect, a personal access token says "GitHub token
 * rejected" with Open account settings); D029 keeps both sign-in ways and no token broker.
 * Data: the GitHub service's health store (reason, authMethod, lastFailureAtMs); the router for the
 * Account page.
 * Must handle: the same failure reported again (one toast per failed call), a failure other than
 * unauthorized (no notice), and a notice dismissed by the user.
 * Test first: an unauthorized `pat` sign-in answers the token title and its action.
 */
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import { githubUnauthorizedNotice } from "../../core/github-text.ts";
import { toast } from "../../ui/Toast.tsx";

/** Watches GitHub access and raises Conductor's expired-sign-in notice once per failed call. */
export function GitHubSignInNotice() {
	const services = useServices();
	const navigate = useNavigate();
	const health = useStore(services.services.github.store, (state) => state.health);
	const shown = useRef<string | null>(null);

	useEffect(() => {
		if (health.reason !== "unauthorized") return;
		const key = `${health.authMethod}:${health.lastFailureAtMs ?? "startup"}`;
		if (shown.current === key) return;
		shown.current = key;
		const notice = githubUnauthorizedNotice(health.authMethod);
		toast.error(notice.title, {
			description: notice.description,
			duration: Number.POSITIVE_INFINITY,
			action: {
				label: notice.action,
				onClick: () => {
					void navigate({ to: "/settings/user/$page", params: { page: "account" } });
				},
			},
		});
	}, [health, navigate]);

	return null;
}
