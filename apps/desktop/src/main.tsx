/**
 * Web UI entry. Mounts the app root. The startup order (database check, sidecar, stores,
 * router) lives in app/startup.ts (APP-01).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

createRoot(root).render(
	<StrictMode>
		<p>Conducted</p>
	</StrictMode>,
);
