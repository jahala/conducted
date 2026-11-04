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
import { notImplemented } from "@conducted/shared";

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

export function FileTabState(_props: FileTabStateProps): never {
	return notImplemented("APP-04");
}
