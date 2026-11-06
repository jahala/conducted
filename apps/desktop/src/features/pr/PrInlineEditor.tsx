/**
 * @feature PR-07 Inline PR title and description editor
 * Owns: the top of the git panel's Checks tab: the pull request's title and description as two
 * fields, with Save and Discard once either has changed.
 * Behaviour: ui-map.md 3.6 ("PR title and description are editable inline": "PR title", "PR
 * description", Save, Discard). As in Conductor's frontend bundle, Save and Discard show only
 * while a field differs from the pull request, Save needs a title, both fields are read-only
 * while a save runs, the saved text stays in place until GitHub's next answer, and a failed save
 * puts Save back with the typing kept (the caller's toast says why). A new title or description
 * from GitHub replaces a field that holds no unsaved edit.
 * Must handle: an empty title (Save disabled), a save in flight (read-only, no second save), a
 * failed save, and a change on GitHub while the user types. Conductor's read-only mode is for a
 * teammate's cloud workspace, which this app does not have, and an archived workspace shows no
 * git panel (NAV-10), so the fields are always editable.
 * Not here: Conductor also shows these fields before a pull request exists, keeping a draft
 * title and description on the workspace and filling the description from the repository's pull
 * request template. That needs an action that writes the workspace's draft, which `core/api.ts`
 * does not have, so the Checks tab shows the fields only with a pull request.
 * Test first: changing the description and pressing Save calls updateTitleAndBody once with the
 * title and the new description.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "../../ui/Button.tsx";

export interface PrInlineEditorProps {
	title: string;
	body: string;
	/** Writes both fields to GitHub. Resolves true when the pull request was changed. */
	onSave: (title: string, body: string) => Promise<boolean>;
}

interface Saved {
	title: string;
	body: string;
	/** The pull request's text when the save started. The saved text shows until it changes. */
	over: { title: string; body: string };
}

/** The description grows with its text up to this height, then scrolls. */
const DESCRIPTION_MAX_HEIGHT = 180;

export function PrInlineEditor({ title, body, onSave }: PrInlineEditorProps) {
	const [draftTitle, setDraftTitle] = useState(title);
	const [draftBody, setDraftBody] = useState(body);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState<Saved | null>(null);
	const previous = useRef({ title, body });
	const savedRef = useRef(saved);
	savedRef.current = saved;
	const description = useRef<HTMLTextAreaElement | null>(null);

	const savedShows = saved !== null && saved.over.title === title && saved.over.body === body;
	const baseTitle = savedShows ? saved.title : title;
	const baseBody = savedShows ? saved.body : body;
	const changed = draftTitle !== baseTitle || draftBody !== baseBody;
	const hasTitle = draftTitle.trim() !== "";

	// A new answer from GitHub replaces a field the user has not edited since the last answer or
	// the last save.
	useEffect(() => {
		const before = previous.current;
		if (before.title === title && before.body === body) return;
		previous.current = { title, body };
		const sent = savedRef.current;
		setDraftTitle((current) =>
			current === before.title || current === sent?.title ? title : current,
		);
		setDraftBody((current) => (current === before.body || current === sent?.body ? body : current));
	}, [title, body]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the height follows the text
	useEffect(() => {
		const field = description.current;
		if (field === null) return;
		field.style.height = "auto";
		field.style.height = `${field.scrollHeight}px`;
	}, [draftBody]);

	const discard = () => {
		setDraftTitle(baseTitle);
		setDraftBody(baseBody);
	};

	const save = async () => {
		if (saving || !changed || !hasTitle) return;
		const sent: Saved = { title: draftTitle, body: draftBody, over: { title, body } };
		setSaved(sent);
		setSaving(true);
		try {
			if (!(await onSave(sent.title, sent.body))) setSaved(null);
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="flex flex-col gap-1 border-b border-separator px-3 pt-2 pb-1">
			<input
				type="text"
				aria-label="PR title"
				placeholder="PR title"
				title={draftTitle}
				value={draftTitle}
				readOnly={saving}
				autoComplete="off"
				spellCheck={false}
				onChange={(event) => setDraftTitle(event.target.value)}
				className="w-full rounded-sm bg-transparent text-sm font-medium text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-focus"
			/>
			<textarea
				ref={description}
				aria-label="PR description"
				placeholder="PR description"
				rows={2}
				value={draftBody}
				readOnly={saving}
				spellCheck={false}
				onChange={(event) => setDraftBody(event.target.value)}
				style={{ maxHeight: DESCRIPTION_MAX_HEIGHT }}
				className="w-full resize-none overflow-auto rounded-sm bg-transparent text-xs text-fg-muted outline-none placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-focus"
			/>
			{changed ? (
				<div className="flex justify-end gap-2 pt-1">
					<Button variant="ghost" size="xs" disabled={saving} onClick={discard}>
						Discard
					</Button>
					<Button
						variant="default"
						size="xs"
						disabled={saving || !hasTitle}
						onClick={() => void save()}
					>
						Save
					</Button>
				</div>
			) : null}
		</div>
	);
}
