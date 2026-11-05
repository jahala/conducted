/**
 * @feature SET-07 Repository Prompts page
 * Owns: the per-repository Prompts page: custom instructions added to the agent's task for the
 * Review, Create PR, Fix errors, Resolve conflicts and Rename branch buttons, and general
 * instructions for every new chat.
 * Behaviour: ui-map.md 6, "Actions page" (prompts for Review, Create PR, Fix errors, Resolve
 * conflicts; each "Add custom instructions sent to the agent when you click the X button"; "General
 * preferences") and "Actions (repo)" table; services-map.md 3.7.6 and 4.2.3 (custom_prompt_*).
 * Data: useRepoConfig(repoId).prompts, useActions().projects.updateConfig.
 * Rows (our wording), RepoConfig.prompts field:
 *   General instructions          general
 *   Review                        codeReview
 *   Create PR                     createPr
 *   Fix errors                    fixErrors
 *   Resolve conflicts             resolveConflicts
 *   Rename branch                 renameBranch
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
import { Label, Textarea } from "../../../ui/Input.tsx";
import { LoadableView } from "../../../ui/LoadableView.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { toastError } from "../../../ui/Toast.tsx";

/** Warn above this many characters; our design choice, not a product limit. */
export const PROMPT_LENGTH_WARNING = 4_000;

type PromptKey = keyof RepoConfig["prompts"];

const PROMPT_FIELDS: readonly {
	key: PromptKey;
	label: string;
	description: string;
}[] = [
	{
		key: "general",
		label: "General instructions",
		description: "Sent to the agent at the start of every new chat in this repository.",
	},
	{
		key: "codeReview",
		label: "Review",
		description: "Sent when you start an AI code review.",
	},
	{
		key: "createPr",
		label: "Create PR",
		description: "Sent when you ask the agent to create a pull request.",
	},
	{
		key: "fixErrors",
		label: "Fix errors",
		description: "Sent when you send failing checks to the agent.",
	},
	{
		key: "resolveConflicts",
		label: "Resolve conflicts",
		description: "Sent when you ask the agent to resolve merge conflicts.",
	},
	{
		key: "renameBranch",
		label: "Rename branch",
		description: "Sent when the agent names the branch.",
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

export function RepoPromptsPage({ repoId }: { repoId: RepoId }) {
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

	const savePrompt = async (key: PromptKey, text: string | null) => {
		if (value.state !== "ready") return;
		const next: RepoConfig = {
			...value.data,
			prompts: { ...value.data.prompts, [key]: text },
		};
		const saved = await actions.projects.updateConfig(repoId, next);
		if (!saved.ok) {
			setErrors((current) => ({ ...current, [key]: saved.error.message }));
			toastError("Couldn't save the instructions", saved.error);
			return;
		}
		setErrors((current) => {
			const nextErrors = { ...current };
			delete nextErrors[key];
			return nextErrors;
		});
	};

	const commit = (key: PromptKey) => {
		const text = drafts[key].trim() === "" ? null : drafts[key];
		const current = value.state === "ready" ? value.data.prompts[key] : null;
		if (text === current) return;
		void savePrompt(key, text);
	};

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-medium text-fg">Prompts</h1>
				<p className="text-sm text-fg-muted">
					Custom instructions for the buttons that send work to the agent, and for every new chat.
				</p>
			</div>

			<LoadableView
				value={value}
				loadingLabel="Loading prompts"
				errorTitle="Couldn't load the prompts"
				loading={
					<div className="flex flex-col gap-4">
						{[0, 1, 2].map((index) => (
							<Skeleton key={index} className="h-24 w-full" />
						))}
					</div>
				}
			>
				{() => (
					<div className="flex flex-col gap-6">
						{PROMPT_FIELDS.map((field) => {
							const text = drafts[field.key];
							return (
								<div key={field.key} className="flex flex-col gap-1.5 border-t border-border pt-4">
									<div className="flex items-center justify-between gap-3">
										<Label htmlFor={`repo-prompt-${field.key}`}>{field.label}</Label>
										<Button
											size="xs"
											variant="ghost"
											onClick={() => {
												setDrafts((current) => ({ ...current, [field.key]: "" }));
												void savePrompt(field.key, null);
											}}
										>
											Reset
										</Button>
									</div>
									<p className="text-sm text-fg-muted">{field.description}</p>
									<Textarea
										id={`repo-prompt-${field.key}`}
										value={text}
										placeholder="Uses only the built-in instructions."
										onChange={(event) =>
											setDrafts((current) => ({ ...current, [field.key]: event.target.value }))
										}
										onBlur={() => commit(field.key)}
									/>
									{text.length > PROMPT_LENGTH_WARNING ? (
										<p className="text-xs text-warning">
											These instructions are long. Very long prompts cost more and can crowd out
											the task.
										</p>
									) : null}
									{errors[field.key] !== undefined ? (
										<p role="alert" className="text-sm text-danger">
											{errors[field.key]}
										</p>
									) : null}
								</div>
							);
						})}
					</div>
				)}
			</LoadableView>
		</div>
	);
}
