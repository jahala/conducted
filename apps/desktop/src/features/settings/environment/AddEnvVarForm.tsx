/**
 * @feature SET-04 Add environment variable panel
 * Owns: the side panel that the "Add environment variable" button opens, and the checks a variable
 * passes before it is saved (`envDraftProblem`, `envEditProblem`).
 * Behaviour: Conductor's add panel (renderApp NDa and ODa @10711500): a 520 px side panel titled
 * "Add environment variable" with "Paste a block of KEY=VALUE lines into the name field to add
 * several at once."; a Name field (placeholder MY_VARIABLE) and a tall mono Value field; pasting
 * one KEY=VALUE line fills both fields, pasting several lists them under "Variables" with Clear,
 * and the title and text become "Add environment variables" and "Detected N variables from your
 * pasted text."; Cancel and Save, which Cmd+Enter presses. The checks and their words are
 * Conductor's (renderApp RDa): a name is required, a name starts with a letter or underscore and
 * holds only letters, numbers and underscores, and a name already set is refused.
 * The edit panel's check (`envEditProblem`) is Conductor's too (renderApp Cnr).
 * Our design choice: a name the app sets itself is refused too ("The app sets X itself. Choose
 * another name."), since the app would replace it.
 * Must handle: an empty value (allowed, means set to empty), a paste with no KEY=VALUE line (pasted
 * as text), a pasted block holding names already set or invalid (each named, nothing saved), and a
 * save that fails (the panel stays open with its text, and the page names the failure).
 * Test first: pasting "TOKEN=abc" into the name field fills name "TOKEN" and value "abc".
 */
import { type ClipboardEvent, useState } from "react";
import { parseDotenv } from "../../../core/dotenv.ts";
import { isReservedEnvVarName } from "../../../core/settings-helpers.ts";
import { Button } from "../../../ui/Button.tsx";
import { Input, Label, Textarea } from "../../../ui/Input.tsx";
import { Sheet, SheetContent } from "../../../ui/Sheet.tsx";

export interface EnvDraft {
	name: string;
	value: string;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NAME_RULE =
	"Names must start with a letter or underscore and contain only letters, numbers, and underscores.";

const reservedProblem = (names: readonly string[]): string | null => {
	const reserved = names.find(isReservedEnvVarName);
	return reserved === undefined ? null : `The app sets ${reserved} itself. Choose another name.`;
};

/**
 * What stops the add panel's variables from being saved, in Conductor's words (renderApp RDa), or
 * null when nothing does. `existingNames` are the names already set in the scope.
 */
export function envDraftProblem(
	entries: readonly EnvDraft[],
	existingNames: readonly string[],
): string | null {
	const names = entries.map((entry) => entry.name);
	if (names.some((name) => name === "")) return "Variable name is required.";
	const invalid = names.filter((name) => !NAME.test(name));
	if (invalid.length > 0) {
		return `Invalid variable ${invalid.length === 1 ? "name" : "names"} ${invalid.join(", ")}. ${NAME_RULE}`;
	}
	const reserved = reservedProblem(names);
	if (reserved !== null) return reserved;
	const taken = names.filter((name) => existingNames.includes(name));
	if (taken.length === 0) return null;
	return entries.length === 1
		? "That variable already exists."
		: `These variables already exist: ${taken.join(", ")}. Remove them from your pasted text and try again.`;
}

/**
 * What stops the edit panel's variable from being saved, in Conductor's words (renderApp Cnr), or
 * null. A renamed variable may not take a name already set; keeping its own name is fine.
 */
export function envEditProblem(
	name: string,
	existingNames: readonly string[],
	previousName: string | null,
): string | null {
	if (name === "") return "Variable name is required.";
	if (!NAME.test(name)) {
		return "Variable names must start with a letter or underscore and contain only letters, numbers, and underscores.";
	}
	const reserved = reservedProblem([name]);
	if (reserved !== null) return reserved;
	if (name !== previousName && existingNames.includes(name)) return "That variable already exists.";
	return null;
}

/** Cmd+Enter's hint after Save, as Conductor draws it. */
export function SaveHint() {
	return (
		<span aria-hidden="true" className="ml-2 inline-flex items-center opacity-60">
			⌘↵
		</span>
	);
}

export interface AddEnvVarFormProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	existingNames: readonly string[];
	/** Saves every variable; false when a save failed, so the panel keeps its text. */
	onAdd: (entries: readonly EnvDraft[]) => Promise<boolean>;
}

export function AddEnvVarForm({ open, onOpenChange, existingNames, onAdd }: AddEnvVarFormProps) {
	const [draft, setDraft] = useState<EnvDraft>({ name: "", value: "" });
	const [pasted, setPasted] = useState<EnvDraft[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const close = (next: boolean) => {
		if (!next) {
			setDraft({ name: "", value: "" });
			setPasted(null);
			setError(null);
		}
		onOpenChange(next);
	};

	const paste = (event: ClipboardEvent<HTMLInputElement>) => {
		const found = parseDotenv(event.clipboardData.getData("text"));
		if (found.length === 0) return;
		event.preventDefault();
		setError(null);
		const [only] = found;
		if (found.length === 1 && only !== undefined) {
			setDraft(only);
			setPasted(null);
			return;
		}
		setDraft({ name: "", value: "" });
		setPasted(found);
	};

	const save = async () => {
		const entries = pasted ?? [{ name: draft.name.trim(), value: draft.value }];
		const problem = envDraftProblem(entries, existingNames);
		if (problem !== null) {
			setError(problem);
			return;
		}
		setSaving(true);
		const saved = await onAdd(entries);
		setSaving(false);
		if (saved) close(false);
	};

	return (
		<Sheet open={open} onOpenChange={close}>
			<SheetContent
				title={pasted === null ? "Add environment variable" : "Add environment variables"}
				description={
					pasted === null
						? "Paste a block of KEY=VALUE lines into the name field to add several at once."
						: `Detected ${pasted.length} variables from your pasted text.`
				}
				footer={
					<>
						<Button variant="ghost" onClick={() => close(false)}>
							Cancel
						</Button>
						<Button data-primary-action loading={saving} onClick={() => void save()}>
							Save
							<SaveHint />
						</Button>
					</>
				}
			>
				<div className="mt-8 flex flex-1 flex-col gap-6">
					{pasted === null ? (
						<>
							<div className="flex flex-col gap-2">
								<Label htmlFor="env-add-name">Name</Label>
								<Input
									id="env-add-name"
									value={draft.name}
									placeholder="MY_VARIABLE"
									autoFocus
									autoComplete="off"
									autoCapitalize="off"
									spellCheck={false}
									onPaste={paste}
									onChange={(event) => setDraft({ ...draft, name: event.target.value })}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<Label htmlFor="env-add-value">Value</Label>
								<Textarea
									id="env-add-value"
									value={draft.value}
									autoComplete="off"
									autoCapitalize="off"
									spellCheck={false}
									className="block min-h-[280px] w-full font-mono text-sm"
									onChange={(event) => setDraft({ ...draft, value: event.target.value })}
								/>
							</div>
						</>
					) : (
						<div className="flex flex-col gap-2">
							<div className="flex items-center justify-between">
								<Label>Variables</Label>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => {
										setPasted(null);
										setError(null);
									}}
								>
									Clear
								</Button>
							</div>
							<ul
								aria-label="Variables"
								className="divide-y divide-border rounded-md border border-border"
							>
								{pasted.map((entry) => (
									<li key={entry.name} className="flex items-center gap-3 px-3 py-2">
										<span className="shrink-0 font-mono text-sm font-medium">{entry.name}</span>
										<span className="truncate font-mono text-sm text-fg-muted">{entry.value}</span>
									</li>
								))}
							</ul>
						</div>
					)}
					{error === null ? null : (
						<p role="alert" className="text-sm text-danger">
							{error}
						</p>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}
