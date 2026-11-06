/**
 * @feature APP-03 Environment report
 * Owns: the on-screen sections of the diagnostics page: app and system facts, shell, PATH as a
 * list, environment variables as a table (values hashed in the redacted view), agent programs, and
 * sidecar status.
 * Behaviour: ui-map.md 2, `/diagnostics`.
 * Must handle: the redacted and full views (full only after the user confirms), a long PATH
 * (collapsed behind a summary), the same folder twice in PATH (both shown), and a very long
 * variable list (a filter box). A capture is whole or failed; the screen shows a failure with Retry.
 * Our design choice: the redacted capture arrives already hashed, so this component never holds a
 * raw value in the redacted view. It renders what it is given.
 * Test first: the redacted view never renders a value that is not on the safe list.
 */
import { useState } from "react";
import type { DiagnosticsCapture } from "../../core/model.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Input } from "../../ui/Input.tsx";
import { withKeys } from "../chat/tools/ToolCardFrame.tsx";

export interface EnvironmentReportProps {
	capture: DiagnosticsCapture;
	view: "redacted" | "full";
}

export function EnvironmentReport({ capture, view }: EnvironmentReportProps) {
	const [filter, setFilter] = useState("");
	const pathEntries = capture.path.split(":").filter((entry) => entry.trim() !== "");
	const names = Object.keys(capture.env).sort();
	const query = filter.trim().toLowerCase();
	const shown = query === "" ? names : names.filter((name) => name.toLowerCase().includes(query));

	return (
		<div className="flex flex-col gap-6">
			<section className="flex flex-col gap-2" aria-labelledby="diagnostics-app-system">
				<div className="flex items-center gap-2">
					<h2 id="diagnostics-app-system" className="text-sm font-medium text-fg">
						App and system
					</h2>
					<Badge tone={view === "redacted" ? "neutral" : "warning"}>
						{view === "redacted" ? "Redacted" : "Full values"}
					</Badge>
				</div>
				<dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
					<Fact label="Version" value={capture.app.version} />
					<Fact label="Channel" value={capture.app.channel} />
					<Fact label="Operating system" value={`${capture.os.name} ${capture.os.version}`} />
					<Fact label="Architecture" value={capture.os.arch} />
					<Fact label="Shell" value={capture.shell} />
					<Fact
						label="Sidecar"
						value={
							capture.sidecar.running
								? `Running${capture.sidecar.logPath === null ? "" : ` · ${capture.sidecar.logPath}`}`
								: "Not running"
						}
					/>
					<Fact label="Captured" value={new Date(capture.capturedAt).toISOString()} />
				</dl>
			</section>

			<section className="flex flex-col gap-2" aria-labelledby="diagnostics-path">
				<h2 id="diagnostics-path" className="text-sm font-medium text-fg">
					PATH
				</h2>
				{pathEntries.length === 0 ? (
					<p className="text-sm text-fg-muted">The PATH is empty.</p>
				) : (
					<details
						className="rounded-md border border-border bg-surface"
						open={pathEntries.length <= 8}
					>
						<summary className="cursor-pointer px-3 py-2 text-sm text-fg">
							{pathEntries.length} {pathEntries.length === 1 ? "entry" : "entries"}
						</summary>
						<ol className="flex flex-col gap-1 border-t border-border px-3 py-2 font-mono text-xs text-fg-muted">
							{withKeys(pathEntries, (entry) => entry, "path").map(({ key, item }) => (
								<li key={key} className="break-all">
									{item}
								</li>
							))}
						</ol>
					</details>
				)}
			</section>

			<section className="flex flex-col gap-2" aria-labelledby="diagnostics-agents">
				<h2 id="diagnostics-agents" className="text-sm font-medium text-fg">
					Agent programs
				</h2>
				{capture.agents.length === 0 ? (
					<p className="text-sm text-fg-muted">No agent programs were reported.</p>
				) : (
					<ul className="flex flex-col gap-1 text-sm">
						{capture.agents.map((agent) => (
							<li
								key={agent.name}
								className="flex flex-wrap items-baseline gap-x-2 border-b border-border py-1 last:border-b-0"
							>
								<span className="font-medium text-fg">{agent.name}</span>
								{agent.installed ? (
									<>
										<span className="text-fg-muted">{agent.version ?? "version unknown"}</span>
										<span className="font-mono text-xs text-fg-subtle">
											{agent.path ?? "path unknown"}
										</span>
									</>
								) : (
									<span className="text-fg-muted">Not installed</span>
								)}
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="flex flex-col gap-2" aria-labelledby="diagnostics-environment">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h2 id="diagnostics-environment" className="text-sm font-medium text-fg">
						Environment variables
					</h2>
					<Input
						aria-label="Filter environment variables"
						placeholder="Filter variables"
						value={filter}
						onChange={(event) => setFilter(event.target.value)}
						className="w-56"
					/>
				</div>
				{names.length === 0 ? (
					<p className="text-sm text-fg-muted">No environment variables were captured.</p>
				) : shown.length === 0 ? (
					<p className="text-sm text-fg-muted">No variables match your filter.</p>
				) : (
					<div className="overflow-hidden rounded-md border border-border">
						<table className="w-full table-fixed text-left text-sm">
							<thead className="bg-surface text-xs text-fg-muted">
								<tr>
									<th className="w-1/3 px-3 py-2 font-medium">Name</th>
									<th className="px-3 py-2 font-medium">Value</th>
								</tr>
							</thead>
							<tbody>
								{shown.map((name) => (
									<tr key={name} className="border-t border-border">
										<td className="break-all px-3 py-1.5 font-mono text-xs text-fg">{name}</td>
										<td className="break-all px-3 py-1.5 font-mono text-xs text-fg-muted">
											{capture.env[name] ?? ""}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</div>
	);
}

function Fact({ label, value }: { label: string; value: string }) {
	return (
		<>
			<dt className="text-fg-muted">{label}</dt>
			<dd className="break-all font-mono text-xs text-fg">{value}</dd>
		</>
	);
}
