/**
 * Web UI entry. Mounts the app root: providers, then the router.
 * The ordered startup (database check, settings, services, sidecar) is app/startup.ts (APP-01) and is not
 * wired in yet, so the shell opens straight to the router and each unbuilt part says what is missing.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProviders, createQueryClient } from "./app/providers.tsx";
import { AppRoutes, createAppRouter } from "./app/router.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

const queryClient = createQueryClient();
const router = createAppRouter();

createRoot(root).render(
	<StrictMode>
		<AppProviders client={queryClient}>
			<AppRoutes router={router} />
		</AppProviders>
	</StrictMode>,
);
