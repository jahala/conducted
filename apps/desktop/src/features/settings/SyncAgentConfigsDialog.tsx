/**
 * @feature SET-08 Sync agent configs between Claude Code and Codex
 * Owns: the General settings row and the dialog that copies MCP servers, slash commands and skills
 * from one agent's config to the other's. The dialog shows the changes first, then the entries that
 * could not be copied.
 * Behaviour: ui-map.md 5.2 (the "Sync agent configs" dialog), 6 "General" (the row and its
 * description), inventory-controls.md (three categories, a diff step and a list of failures).
 * Must handle: no selected category, no change to copy, a preview that fails, a sync that copies
 * some entries and fails others, and a source switch while a preview loads.
 * Test first: the dialog lists a change before copying it, and the copied entry appears in the
 * other agent's config.
 */
import { useState } from "react";
import { CONFIG_SYNC_CATEGORIES } from "../../core/agent-catalog.ts";
import { useActions, useConfigSyncPreview } from "../../core/hooks.ts";
import type { ConfigSyncCategory, ConfigSyncResult } from "../../core/model.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { Checkbox } from "../../ui/Checkbox.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import { Label } from "../../ui/Input.tsx";
import { ArrowLeftRightIcon } from "../../ui/icons.tsx";
import { Select } from "../../ui/Select.tsx";
import { Spinner } from "../../ui/Spinner.tsx";

const CATEGORY_LABEL: Readonly<Record<ConfigSyncCategory, string>> = {
	mcp_servers: "MCP servers",
	slash_commands: "Slash commands",
	skills: "Skills",
};

type AgentChoice = "claude" | "codex";

const AGENT_OPTIONS: readonly { value: AgentChoice; label: string }[] = [
	{ value: "claude", label: "Claude Code" },
	{ value: "codex", label: "Codex" },
];

/** The General page row. It opens the dialog and keeps it mounted only while open. */
export function SyncAgentConfigsRow() {
	const [open, setOpen] = useState(false);
	return (
		<div className="flex items-center justify-between gap-8 border-t border-border py-5">
			<div className="flex min-w-0 flex-col">
				<p className="flex min-h-7 items-center text-sm font-medium text-fg">Sync agent configs</p>
				<p className="mt-0.5 text-sm text-fg-muted">
					Copy skills, slash commands, and MCP servers between Claude Code and Codex.
				</p>
			</div>
			{/* Conductor's button row: an outline button with the two-way arrow and "Sync". */}
			<Button variant="outline" onClick={() => setOpen(true)}>
				<ArrowLeftRightIcon className="size-4" />
				Sync
			</Button>
			{open ? <SyncAgentConfigsDialog onClose={() => setOpen(false)} /> : null}
		</div>
	);
}

export function SyncAgentConfigsDialog({ onClose }: { onClose: () => void }) {
	const actions = useActions();
	const [from, setFrom] = useState<AgentChoice>("claude");
	const [selected, setSelected] = useState<ConfigSyncCategory[]>([...CONFIG_SYNC_CATEGORIES]);
	const [result, setResult] = useState<ConfigSyncResult | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const [syncing, setSyncing] = useState(false);
	const preview = useConfigSyncPreview(from, selected);

	const chooseFrom = (next: AgentChoice) => {
		setFrom(next);
		setResult(null);
		setFailure(null);
	};

	const toggle = (category: ConfigSyncCategory) => {
		setSelected((current) =>
			current.includes(category)
				? current.filter((entry) => entry !== category)
				: [...current, category],
		);
		setResult(null);
		setFailure(null);
	};

	const changes = preview.state === "ready" ? preview.data : [];
	const canSync = preview.state === "ready" && changes.length > 0 && !syncing;

	const sync = async () => {
		if (!canSync) return;
		setSyncing(true);
		setFailure(null);
		const copied = await actions.agents.syncConfigs(from, selected);
		setSyncing(false);
		if (!copied.ok) {
			setFailure(copied.error.message);
			return;
		}
		setResult(copied.value);
	};

	return (
		<Dialog
			open
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent
				title="Sync agent configs"
				description="Copy skills, slash commands, and MCP servers between Claude Code and Codex."
				onConfirm={canSync ? () => void sync() : undefined}
			>
				<div className="flex flex-col gap-4 overflow-y-auto">
					<div className="flex items-center justify-between gap-6">
						<Label htmlFor="sync-agent-configs-from">Copy from</Label>
						<Select
							id="sync-agent-configs-from"
							value={from}
							options={AGENT_OPTIONS}
							onValueChange={chooseFrom}
						/>
					</div>

					<fieldset className="flex flex-col gap-2 border-0 p-0">
						<legend className="mb-1 text-sm font-medium text-fg">Categories</legend>
						{CONFIG_SYNC_CATEGORIES.map((category) => (
							<label
								key={category}
								className="flex items-center gap-2 text-sm text-fg"
								htmlFor={`sync-category-${category}`}
							>
								<Checkbox
									id={`sync-category-${category}`}
									checked={selected.includes(category)}
									onCheckedChange={() => toggle(category)}
								/>
								{CATEGORY_LABEL[category]}
							</label>
						))}
					</fieldset>

					<section className="flex flex-col gap-2">
						<p className="text-sm font-medium text-fg">Changes</p>
						{preview.state === "loading" ? (
							<div className="flex items-center gap-2 text-sm text-fg-muted">
								<Spinner label="Loading config changes" size="sm" />
								Reading both agents' configs…
							</div>
						) : preview.state === "error" ? (
							<p role="alert" className="text-sm text-danger">
								{preview.error.message}
							</p>
						) : changes.length === 0 ? (
							<p className="text-sm text-fg-muted">
								No changes. Both agents already match for the selected categories.
							</p>
						) : (
							<ul className="flex flex-col gap-2">
								{changes.map((change) => (
									<li
										key={`${change.category}:${change.name}`}
										className="rounded-md border border-border p-3"
									>
										<div className="flex flex-wrap items-center gap-2">
											<Badge tone={change.change === "add" ? "success" : "neutral"}>
												{change.change === "add" ? "Add" : "Update"}
											</Badge>
											<span className="text-sm font-medium text-fg">{change.name}</span>
											<span className="text-xs text-fg-muted">
												{CATEGORY_LABEL[change.category]}
											</span>
										</div>
										<pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-xs text-fg-muted">
											{change.diff}
										</pre>
									</li>
								))}
							</ul>
						)}
					</section>

					{failure === null ? null : (
						<p role="alert" className="text-sm text-danger">
							{failure}
						</p>
					)}

					{result === null ? null : (
						<div className="flex flex-col gap-1">
							<p role="status" className="text-sm text-fg">
								{result.applied === 0
									? "Nothing was copied."
									: `Copied ${result.applied} ${result.applied === 1 ? "entry" : "entries"}.`}
							</p>
							{result.failures.length === 0 ? null : (
								<div role="alert" className="flex flex-col gap-1">
									<p className="text-sm text-danger">
										Could not copy {result.failures.length}{" "}
										{result.failures.length === 1 ? "entry" : "entries"}:
									</p>
									<ul className="flex flex-col gap-0.5 text-sm text-danger">
										{result.failures.map((entry) => (
											<li key={`${entry.category}:${entry.name}`}>
												{CATEGORY_LABEL[entry.category]} {entry.name}: {entry.message}
											</li>
										))}
									</ul>
								</div>
							)}
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button loading={syncing} disabled={!canSync} onClick={() => void sync()}>
						Sync
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
