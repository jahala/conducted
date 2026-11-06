/**
 * @feature SET-12 Claude settings and Codex config editors
 * Owns: the dialog that edits one agent's own settings file on the Agents page: the file's path,
 * its text in a monospace text field, a save that refuses to overwrite a change made elsewhere,
 * and the state of a file that does not exist yet.
 * Behaviour: ui-map.md 6, "Agents page" ("Claude settings JSON", "Codex config"). The research
 * gives no further behaviour for the editors, so this is our design choice: a plain text editor
 * over the file the agent itself reads.
 * Data: useAgentConfigFile(agent) and Actions.agents.saveConfigFile.
 * Must handle: loading, a read that fails (with Try again), a missing file (saving creates it), a
 * save in flight, a file that changed on disk (the draft stays and the reason shows), text that is
 * not valid JSON or TOML (the service refuses it; the draft stays and the parse error shows), and
 * a save that fails.
 * Test first: editing Claude's settings and saving writes the new text to ~/.claude/settings.json.
 */

import { useEffect, useState } from "react";
import { useServices } from "../../../core/context.tsx";
import { useActions, useAgentConfigFile } from "../../../core/hooks.ts";
import type { AgentConfigFile } from "../../../core/model.ts";
import { Button } from "../../../ui/Button.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../../ui/Dialog.tsx";
import { Textarea } from "../../../ui/Input.tsx";
import { LoadableView } from "../../../ui/LoadableView.tsx";
import { toast, toastError } from "../../../ui/Toast.tsx";

export interface AgentConfigDialogProps {
	agent: AgentConfigFile["agent"];
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

const copyFor = (agent: AgentConfigFile["agent"]) =>
	agent === "claude"
		? {
				title: "Claude settings",
				description: "The JSON settings file Claude Code reads from this Mac.",
			}
		: {
				title: "Codex config",
				description: "The TOML config file Codex reads from this Mac.",
			};

export function AgentConfigDialog({ agent, open, onOpenChange }: AgentConfigDialogProps) {
	const value = useAgentConfigFile(agent);
	const actions = useActions();
	const services = useServices();
	const { title, description } = copyFor(agent);
	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (value.state !== "ready") return;
		setText(value.data.text);
		setError(null);
	}, [value]);

	const file = value.state === "ready" ? value.data : null;

	const save = async () => {
		if (file === null || saving) return;
		setSaving(true);
		setError(null);
		const saved = await actions.agents.saveConfigFile(agent, text, file.modifiedAt);
		setSaving(false);
		if (!saved.ok) {
			setError(saved.error.message);
			toastError(`Couldn't save ${title.toLowerCase()}`, saved.error);
			return;
		}
		toast(`${title} saved`);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title={title}
				description={description}
				size="2xl"
				onConfirm={() => void save()}
			>
				<LoadableView
					value={value}
					loadingLabel={`Loading ${title.toLowerCase()}`}
					errorTitle={`Couldn't load ${title.toLowerCase()}`}
					onRetry={() => void services.services.agentCatalog.loadConfigFile(agent)}
				>
					{(loaded) => (
						<div className="flex flex-col gap-3">
							<div className="flex flex-col gap-1">
								<code className="break-all font-mono text-xs text-fg-muted">{loaded.path}</code>
								{loaded.exists ? null : (
									<p className="text-xs text-fg-subtle">
										This file does not exist yet. Saving creates it.
									</p>
								)}
							</div>
							<Textarea
								aria-label={title}
								spellCheck={false}
								value={text}
								error={error ?? undefined}
								onChange={(event) => setText(event.target.value)}
								className="min-h-72 w-full font-mono text-code"
							/>
						</div>
					)}
				</LoadableView>
				<DialogFooter>
					<Button variant="secondary" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button loading={saving} disabled={file === null} onClick={() => void save()}>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
