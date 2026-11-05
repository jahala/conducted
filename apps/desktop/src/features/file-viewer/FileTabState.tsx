/**
 * @feature APP-04 File tab states
 * Owns: the designed full-pane states of the File tab: loading, error, missing file, binary file,
 * too large, and archived workspace.
 * Behaviour: ui-map.md 3.2 ("Workspace archived. Unarchive this workspace to view files,
 * terminals, and browser previews."), 7.3 and 7.4 (loading and error states; "Preview
 * unavailable").
 * Must handle: each state has one clear action at most (Retry, Unarchive, Open in another app),
 * loading uses a skeleton with role "status", and the error text comes from the AppError message.
 * Test first: state "archived" shows an Unarchive action that calls onAction.
 */
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";

export type FileTabStateKind =
	| "loading"
	| "error"
	| "missing"
	| "binary"
	| "too_large"
	| "archived";

export interface FileTabStateProps {
	kind: FileTabStateKind;
	/** Plain-language detail, e.g. the error message or the file size. */
	detail: string | null;
	onAction: () => void;
}

export function FileTabState({ kind, detail, onAction }: FileTabStateProps) {
	if (kind === "loading") {
		return (
			<div role="status" aria-label="Loading file" className="flex h-full flex-col gap-2 p-6">
				<Skeleton className="h-4 w-1/3" />
				<Skeleton className="h-4 w-3/4" />
				<Skeleton className="h-4 w-2/3" />
				<Skeleton className="h-4 w-5/6" />
			</div>
		);
	}
	if (kind === "archived") {
		return (
			<EmptyState
				title="This workspace is archived"
				body="Workspace archived. Unarchive this workspace to view files, terminals and browser previews."
				action={
					<Button variant="default" onClick={onAction}>
						Unarchive
					</Button>
				}
			/>
		);
	}
	if (kind === "error") {
		return (
			<EmptyState
				tone="failed"
				title="Couldn't load this file"
				body={detail ?? "The file could not be read."}
				action={
					<Button variant="secondary" onClick={onAction}>
						Try again
					</Button>
				}
			/>
		);
	}
	if (kind === "missing") {
		return (
			<EmptyState title="File not found" body={detail ?? "It may have been renamed or deleted."} />
		);
	}
	if (kind === "binary") {
		return (
			<EmptyState
				title="Binary file"
				body="This file can't be shown as text."
				action={
					<Button variant="secondary" onClick={onAction}>
						Open in another app
					</Button>
				}
			/>
		);
	}
	return (
		<EmptyState
			title="File is too large"
			body={detail ?? "Open it in another app to view it."}
			action={
				<Button variant="secondary" onClick={onAction}>
					Open in another app
				</Button>
			}
		/>
	);
}
