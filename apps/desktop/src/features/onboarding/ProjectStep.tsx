/**
 * @feature APP-02 Onboarding: first project
 * @feature APP-17 Import from Conductor on first run
 * Owns: the step where the user adds a first project from a folder, imports from Conductor when
 * its data is on this Mac, or skips it.
 * Behaviour: ui-map.md 3.9 and 7.1 (add a project), 7.2 ("Add a project to get started.").
 * Must handle: a cancelled folder dialog (no message and no change); a folder that is not a git
 * repository or cannot be added (the action's message stays on the step); adding succeeds (the
 * caller finishes onboarding); skipping is allowed.
 * Test first: Adding a folder calls projects.addLocal and then finishes onboarding.
 */
import { useRef, useState } from "react";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useActions } from "../../core/hooks.ts";
import { Alert, AlertDescription } from "../../ui/Alert.tsx";
import { Button } from "../../ui/Button.tsx";
import { ConductorImportOffer } from "../conductor-import/ConductorImportDialog.tsx";

export interface ProjectStepProps {
	onFinish: () => void;
}

export function ProjectStep({ onFinish }: ProjectStepProps) {
	const actions = useActions();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const flight = useRef(createSingleFlight()).current;

	const addProject = () =>
		flight.run("add-project", async () => {
			setBusy(true);
			setError(null);
			try {
				const picked = await actions.app.pickFolder("Select project directory");
				if (!picked.ok) {
					setError(picked.error.message);
					return;
				}
				if (picked.value === null) return;
				const added = await actions.projects.addLocal(picked.value);
				if (!added.ok) {
					setError(added.error.message);
					return;
				}
				onFinish();
			} finally {
				setBusy(false);
			}
		});

	return (
		<div className="flex flex-col gap-3">
			<p className="text-sm text-fg-muted">Add a project to get started.</p>
			{error ? (
				<Alert tone="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}
			<div className="flex flex-wrap items-center gap-2">
				<Button loading={busy} onClick={() => void addProject()}>
					Add a project
				</Button>
				{/* Ours (D098, APP-17): a user arriving from Conductor brings their projects over here. */}
				<ConductorImportOffer onImported={onFinish} />
				<Button variant="ghost" onClick={onFinish}>
					Skip for now
				</Button>
			</div>
		</div>
	);
}
