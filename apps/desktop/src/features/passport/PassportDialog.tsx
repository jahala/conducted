/**
 * @feature NAV-13 Passport
 * Owns: the dialog with a world map of workspace place names: visited places, archived places, and
 * a way to open a workspace.
 * Behaviour: ui-map.md 4 (Passport: dialog with a world map, 'CITIES VISITED', '[NOT VISITED]',
 * '[ARCHIVED]', '[CLICK TO OPEN]'; each workspace is named after a place, so the map plots them),
 * 5.2 (the dialog is titled 'Conducted Passport').
 * Our design choice: the palette command `app.openPassport` opens it, and the overlay host mounts it.
 * A place with several workspaces opens the first one that is not archived. An archived place is
 * listed and labelled, and says where to unarchive it because this dialog cannot open it.
 * Must handle: no workspaces yet (an empty state with the reason); a place that is not in the
 * gazetteer (listed under the map, not plotted); archived places drawn differently and labelled in
 * text too; keyboard access to every marker; Escape closes.
 * Test first: a workspace named 'Lisbon' appears as a marker; an archived one is marked archived in
 * text.
 */
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useWorkspaces } from "../../core/hooks.ts";
import { canOpenWorkspace } from "../../core/workspace-open.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog, DialogContent } from "../../ui/Dialog.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import type { OverlayProps } from "../../ui/overlay-props.ts";
import { Spinner } from "../../ui/Spinner.tsx";
import { buildPassportPlaces, type PassportPlace, unvisitedPlaces } from "./passport-places.ts";
import { WorldMap } from "./WorldMap.tsx";

export function PassportDialog({ open, onOpenChange }: OverlayProps) {
	const workspaces = useWorkspaces();
	const navigate = useNavigate();
	const [notice, setNotice] = useState<string | null>(null);

	const places = useMemo(
		() => (workspaces.state === "ready" ? buildPassportPlaces(workspaces.data) : []),
		[workspaces],
	);
	const unvisited = useMemo(() => unvisitedPlaces(places), [places]);

	const openPlace = (place: PassportPlace) => {
		const workspace = place.workspaces.find(canOpenWorkspace) ?? null;
		if (workspace === null) {
			setNotice(`${place.name} is archived. Unarchive it from Home to open it.`);
			return;
		}
		setNotice(null);
		void navigate({
			to: "/repository/$repositoryId/workspace/$workspaceId",
			params: { repositoryId: workspace.repoId, workspaceId: workspace.id },
		});
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="Conducted Passport"
				description="Every place a workspace has visited on this Mac."
				size="3xl"
			>
				{workspaces.state === "loading" ? (
					<div className="flex min-h-40 items-center justify-center">
						<Spinner label="Loading places" />
					</div>
				) : workspaces.state === "error" ? (
					<p role="alert" className="text-sm text-danger">
						{workspaces.error.message}
					</p>
				) : places.length === 0 ? (
					<EmptyState
						compact
						title="No workspaces yet"
						body="Create a workspace and its place name will appear here."
					/>
				) : (
					<>
						<WorldMap places={places} unvisited={unvisited} onOpen={openPlace} />
						<div className="flex flex-wrap items-center gap-x-4 gap-y-1">
							<h3 className="text-2xs font-medium tracking-wide text-fg">CITIES VISITED</h3>
							<ul
								aria-label="Map legend"
								className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-fg-muted"
							>
								<li>[CLICK TO OPEN]</li>
								<li>[ARCHIVED]</li>
								<li>[NOT VISITED]</li>
							</ul>
						</div>
						{notice === null ? null : (
							<p role="status" className="text-xs text-fg-muted">
								{notice}
							</p>
						)}
						<PlaceList places={places} onOpen={openPlace} />
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

function PlaceList({
	places,
	onOpen,
}: {
	places: readonly PassportPlace[];
	onOpen: (place: PassportPlace) => void;
}) {
	return (
		<ul
			aria-label="Places"
			className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border"
		>
			{places.map((place) => {
				const openable = place.workspaces.some(canOpenWorkspace);
				const count = place.workspaces.length;
				return (
					<li key={place.name} className="flex items-center justify-between gap-3 px-3 py-2">
						<div className="min-w-0">
							<p className="flex items-baseline gap-2 text-sm text-fg">
								<span className="truncate">{place.name}</span>
								{place.archived ? (
									<span className="shrink-0 text-2xs text-fg-subtle">[ARCHIVED]</span>
								) : null}
							</p>
							<p className="text-xs text-fg-muted">
								{place.country ?? "Not on the map"}
								{count > 1 ? ` · ${count} workspaces` : ""}
							</p>
						</div>
						{openable ? (
							<Button variant="outline" size="xs" onClick={() => onOpen(place)}>
								Open
							</Button>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}
