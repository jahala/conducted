/**
 * @feature SET-07 Repository prompt instructions on the Actions page
 * Owns: the rows of a repository's Actions page that add custom instructions to the agent's task
 * for the Review, Create PR, Fix errors, Resolve conflicts and branch rename buttons, and general
 * instructions for every new chat.
 * Behaviour: Conductor's actions tab (renderApp v2e and Cir @11266334-11268000, eqo): after Custom
 * actions and Use spotlight testing, one row each, closed until opened: "Code review preferences",
 * "Create PR preferences", "Fix errors preferences", "Resolve conflicts preferences", "Branch rename
 * preferences" and "General preferences", with Conductor's descriptions, a "Customized" badge while
 * the row holds text, and a 120 px mono field ("<title> prompt") with Conductor's placeholder.
 * services-map.md 3.7.6 and 4.2.3 (custom_prompt_*).
 * Data: useRepoConfig(repoId).prompts, useActions().projects.updateConfig.
 * Left out: Conductor's "Preview" of the whole prompt; the app has no preview of the built-in
 * instructions to show.
 * Must handle: an empty field meaning "use only the built-in instructions" (not stored as an
 * empty string), very long text (a warning above 4,000 characters, Our design choice), save on
 * blur, a failed save (text kept and the failure shown), and a reset per field.
 * Test first: clearing the Review field stores null, not an empty string.
 */
import type { RepoId } from "@conducted/shared";
import { useEffect, useState } from "react";
import { useActions, useRepoConfig } from "../../../core/hooks.ts";
import type { RepoConfig } from "../../../core/model.ts";
import { Button } from "../../../ui/Button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../ui/Collapsible.tsx";
import { Textarea } from "../../../ui/Input.tsx";
import { ChevronDownIcon } from "../../../ui/icons.tsx";
import { LoadableView } from "../../../ui/LoadableView.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { toastSettingSaveFailed } from "../SettingRow.tsx";

/** Conductor's placeholder for a button's instructions. */
const PREFERENCES_PLACEHOLDER =
	"Add your preferences here. The agent will be told to prioritize these instructions over its default instructions.";

/** Warn above this many characters; our design choice, not a product limit. */
export const PROMPT_LENGTH_WARNING = 4_000;

type PromptKey = keyof RepoConfig["prompts"];

/** Conductor's rows, in its order, with its titles and descriptions. */
const PROMPT_FIELDS: readonly {
	key: PromptKey;
	label: string;
	description: string;
	placeholder: string;
}[] = [
	{
		key: "codeReview",
		label: "Code review preferences",
		description: "Add custom instructions sent to the agent when you click the Review button.",
		placeholder: PREFERENCES_PLACEHOLDER,
	},
	{
		key: "createPr",
		label: "Create PR preferences",
		description: "Add custom instructions sent to the agent when you click the Create PR button.",
		placeholder: PREFERENCES_PLACEHOLDER,
	},
	{
		key: "fixErrors",
		label: "Fix errors preferences",
		description: "Add custom instructions sent to the agent when you click the Fix errors button.",
		placeholder: PREFERENCES_PLACEHOLDER,
	},
	{
		key: "resolveConflicts",
		label: "Resolve conflicts preferences",
		description:
			"Add custom instructions sent to the agent when you click the Resolve conflicts button.",
		placeholder: PREFERENCES_PLACEHOLDER,
	},
	{
		key: "renameBranch",
		label: "Branch rename preferences",
		description: "Add custom instructions for generating branch names from your messages.",
		placeholder: PREFERENCES_PLACEHOLDER,
	},
	{
		key: "general",
		label: "General preferences",
		description: "Add custom instructions sent to the agent at the start of every new chat.",
		placeholder: "Add custom instructions for all agents working in this repo.",
	},
];

const blankPrompts = (): Record<PromptKey, string> => ({
	general: "",
	codeReview: "",
	createPr: "",
	fixErrors: "",
	resolveConflicts: "",
	renameBranch: "",
});

export function RepoPromptSettings({ repoId }: { repoId: RepoId }) {
	const value = useRepoConfig(repoId);
	const actions = useActions();
	const [drafts, setDrafts] = useState<Record<PromptKey, string>>(blankPrompts);
	const [errors, setErrors] = useState<Partial<Record<PromptKey, string>>>({});
	const ready = value.state === "ready" ? value.data : null;

	useEffect(() => {
		if (ready === null) return;
		setDrafts({
			general: ready.prompts.general ?? "",
			codeReview: ready.prompts.codeReview ?? "",
			createPr: ready.prompts.createPr ?? "",
			fixErrors: ready.prompts.fixErrors ?? "",
			resolveConflicts: ready.prompts.resolveConflicts ?? "",
			renameBranch: ready.prompts.renameBranch ?? "",
		});
	}, [ready]);

	const textOrNull = (text: string): string | null => (text.trim() === "" ? null : text);

	/** Every prompt as the fields show it, so saving one never drops text typed in another. */
	const promptsFromDrafts = (): RepoConfig["prompts"] => ({
		general: textOrNull(drafts.general),
		codeReview: textOrNull(drafts.codeReview),
		createPr: textOrNull(drafts.createPr),
		fixErrors: textOrNull(drafts.fixErrors),
		resolveConflicts: textOrNull(drafts.resolveConflicts),
		renameBranch: textOrNull(drafts.renameBranch),
	});

	const savePrompt = async (key: PromptKey, text: string | null) => {
		if (value.state !== "ready") return;
		const prompts = promptsFromDrafts();
		prompts[key] = text;
		const next: RepoConfig = {
			...value.data,
			prompts,
		};
		const clearError = () =>
			setErrors((current) => {
				const nextErrors = { ...current };
				delete nextErrors[key];
				return nextErrors;
			});
		const saved = await actions.projects.updateConfig(repoId, next);
		if (!saved.ok) {
			setErrors((current) => ({ ...current, [key]: saved.error.message }));
			toastSettingSaveFailed(saved.error, async () => {
				const forced = await actions.projects.updateConfig(repoId, next, { overwrite: true });
				if (forced.ok) clearError();
				return forced;
			});
			return;
		}
		clearError();
	};

	const commit = (key: PromptKey) => {
		const text = drafts[key].trim() === "" ? null : drafts[key];
		const current = value.state === "ready" ? value.data.prompts[key] : null;
		if (text === current) return;
		void savePrompt(key, text);
	};

	return (
		<LoadableView
			value={value}
			loadingLabel="Loading prompts"
			errorTitle="Couldn't load the prompts"
			loading={
				<div className="flex flex-col gap-4">
					{[0, 1, 2].map((index) => (
						<Skeleton key={index} className="h-14 w-full" />
					))}
				</div>
			}
		>
			{(config) => (
				<div className="flex flex-col">
					{PROMPT_FIELDS.map((field) => {
						const text = drafts[field.key];
						return (
							<Collapsible
								key={field.key}
								className="border-t border-border py-5"
								data-setting-key={`prompt-${field.key}`}
							>
								<CollapsibleTrigger className="flex w-full items-center justify-between gap-4 rounded-none px-0 py-0 text-left font-normal hover:bg-transparent [&[data-state=open]>svg]:rotate-180">
									<span className="flex min-w-0 flex-col gap-0.5">
										<span className="flex items-center gap-2">
											<span className="text-sm font-medium text-fg">{field.label}</span>
											{config.prompts[field.key] !== null ? (
												<span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-fg-muted">
													Customized
												</span>
											) : null}
										</span>
										<span className="text-sm text-fg-muted">{field.description}</span>
									</span>
									<ChevronDownIcon className="size-4 shrink-0 text-fg-muted transition-transform" />
								</CollapsibleTrigger>
								<CollapsibleContent className="flex flex-col gap-3 pt-3">
									<Textarea
										aria-label={`${field.label} prompt`}
										value={text}
										placeholder={field.placeholder}
										className="min-h-[120px] w-full font-mono text-xs"
										onChange={(event) =>
											setDrafts((current) => ({ ...current, [field.key]: event.target.value }))
										}
										onBlur={() => commit(field.key)}
									/>
									{config.prompts[field.key] !== null ? (
										<Button
											size="xs"
											variant="ghost"
											className="self-start"
											onClick={() => {
												setDrafts((current) => ({ ...current, [field.key]: "" }));
												void savePrompt(field.key, null);
											}}
										>
											Reset
										</Button>
									) : null}
									{text.length > PROMPT_LENGTH_WARNING ? (
										<p className="text-xs text-warning">
											These instructions are long. Very long prompts cost more and can crowd out the
											task.
										</p>
									) : null}
									{errors[field.key] !== undefined ? (
										<p role="alert" className="text-sm text-danger">
											{errors[field.key]}
										</p>
									) : null}
								</CollapsibleContent>
							</Collapsible>
						);
					})}
				</div>
			)}
		</LoadableView>
	);
}
