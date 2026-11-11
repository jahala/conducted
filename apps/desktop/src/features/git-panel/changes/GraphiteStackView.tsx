/**
 * @feature PR-08 Graphite stack list in the Changes tab
 * Owns: the read-only list of the checked-out branch's Graphite stack, top first and the trunk
 * last, joined by a line with one dot per branch. The current branch is marked and shows its
 * changed files under its row; a branch Graphite says needs a restack shows a warning whose hint
 * names `gt restack`; every other branch but the trunk has "Checkout this branch".
 * Behaviour: ui-map.md 3.6 ("(trunk)", "gt restack", "Checkout this branch", "Ready for review");
 * services-map.md 3.8.1 and 5B.1.8 (read-only plus `gt checkout`). Order, wording and controls
 * follow Conductor's Changes tab: the restack hint reads "This branch needs to be restacked. Use
 * gt restack", "Ready for review" heads the files not yet viewed once any file is viewed, with
 * "Conflicts" first and "Viewed" last, and a checkout asks nothing first.
 * Data: the props. The Changes tab supplies the stack from graphiteStackOf, the branch git reports,
 * the files of the diff scope, the branch whose checkout runs, and the checkout through switch
 * branch, which runs `gt checkout` for a branch Graphite knows.
 * Must handle: the trunk (no checkout, muted), the current branch (no checkout, its files below it),
 * a checkout running (every checkout held, a spinner on that branch), a current branch with no
 * changes (no file rows), conflicted files (first, under "Conflicts"), and no file viewed yet (one
 * plain list, no headings).
 * Test first: four branches render top first with the trunk last and the current one marked.
 */
import type { ChangedFile } from "../../../core/api.ts";
import type { GraphiteBranch } from "../../../core/graphite.ts";
import { cn } from "../../../ui/cn.ts";
import { IconButton } from "../../../ui/IconButton.tsx";
import { ArrowDownToLineIcon, TriangleAlertIcon } from "../../../ui/icons.tsx";
import { Spinner } from "../../../ui/Spinner.tsx";
import { Tooltip } from "../../../ui/Tooltip.tsx";
import { ChangedFileRow } from "./ChangedFileRow.tsx";

export interface GraphiteStackViewProps {
	/** The stack, top first and the trunk last (graphiteStackOf). */
	branches: readonly GraphiteBranch[];
	/** The branch checked out in the workspace. */
	currentBranch: string;
	/** The current branch's changed files, in the tab's diff scope. */
	files: readonly ChangedFile[];
	selectedPath: string | null;
	onOpenFile: (path: string) => void;
	/** Shown on the current branch's files where the Changes tab offers Discard. */
	onDiscard?: (path: string) => void;
	/** The branch whose checkout is running, or null. */
	checkingOut: string | null;
	onCheckout: (branch: string) => void;
}

const RESTACK_HINT = "This branch needs to be restacked. Use gt restack";

const byPath = (a: ChangedFile, b: ChangedFile) => a.path.localeCompare(b.path);

/** The groups the current branch's files show in, each with its heading or none. */
function fileGroups(
	files: readonly ChangedFile[],
): { heading: string | null; files: ChangedFile[] }[] {
	const conflicts = files.filter((file) => file.conflicted).sort(byPath);
	const unviewed = files.filter((file) => !file.conflicted && !file.viewed).sort(byPath);
	const viewed = files.filter((file) => !file.conflicted && file.viewed).sort(byPath);
	const groups: { heading: string | null; files: ChangedFile[] }[] = [];
	if (conflicts.length > 0) groups.push({ heading: "Conflicts", files: conflicts });
	if (unviewed.length > 0) {
		groups.push({ heading: viewed.length > 0 ? "Ready for review" : null, files: unviewed });
	}
	if (viewed.length > 0) groups.push({ heading: "Viewed", files: viewed });
	return groups;
}

export function GraphiteStackView({
	branches,
	currentBranch,
	files,
	selectedPath,
	onOpenFile,
	onDiscard,
	checkingOut,
	onCheckout,
}: GraphiteStackViewProps) {
	const last = branches.length - 1;
	return (
		<ul aria-label="Graphite stack" className="m-0 min-h-0 flex-1 list-none overflow-auto p-0 pb-2">
			{branches.map((branch, index) => {
				const isCurrent = branch.name === currentBranch;
				const showFiles = isCurrent && files.length > 0;
				return (
					<li
						key={branch.name}
						data-testid="graphite-branch"
						data-branch={branch.name}
						aria-current={isCurrent ? "true" : undefined}
					>
						<div
							className={cn(
								"group mx-1 flex h-8 items-center gap-2 rounded-md px-3 text-sm hover:bg-hover",
								isCurrent && "bg-active",
							)}
						>
							<div className="relative flex h-full w-3 shrink-0 items-center justify-center">
								{index > 0 ? (
									<div className="absolute top-0 left-1.5 h-1/2 w-px -translate-x-1/2 bg-separator" />
								) : null}
								{index < last || showFiles ? (
									<div className="absolute bottom-0 left-1.5 h-1/2 w-px -translate-x-1/2 bg-separator" />
								) : null}
								<div
									className={cn(
										"relative z-10 size-2 rounded-full",
										isCurrent ? "bg-success" : branch.trunk ? "bg-fg-muted" : "bg-fg-subtle",
									)}
								/>
							</div>
							<div
								className={cn(
									"flex min-w-0 flex-1 items-center gap-1.5",
									isCurrent ? "font-medium text-fg" : "text-fg",
									branch.trunk && "text-fg-muted",
								)}
							>
								<span className="truncate">
									{branch.name}
									{branch.trunk ? (
										<span className="ml-1 text-xs text-fg-muted">(trunk)</span>
									) : null}
								</span>
								{branch.needsRestack ? (
									<Tooltip content={RESTACK_HINT}>
										<span
											role="img"
											aria-label={RESTACK_HINT}
											// biome-ignore lint/a11y/noNoninteractiveTabindex: the hint lives only in the tooltip, so keyboard users must reach it.
											tabIndex={0}
											className="flex shrink-0 items-center justify-center rounded-sm text-warning"
										>
											<TriangleAlertIcon className="size-3" />
										</span>
									</Tooltip>
								) : null}
							</div>
							{isCurrent || branch.trunk ? null : (
								<IconButton
									label="Checkout this branch"
									size="xs"
									className="size-5 text-fg-muted"
									disabled={checkingOut !== null}
									onClick={() => {
										if (checkingOut === null) onCheckout(branch.name);
									}}
									icon={
										checkingOut === branch.name ? (
											<Spinner size="sm" label={`Checking out ${branch.name}`} className="size-3" />
										) : (
											<ArrowDownToLineIcon className="size-3" />
										)
									}
								/>
							)}
						</div>
						{showFiles ? (
							// biome-ignore lint/a11y/useSemanticElements: the file rows are grid rows shared with the Changes list.
							<div
								role="grid"
								aria-label="Changed files"
								className="ml-2.5 min-w-0 overflow-hidden border-l border-separator pl-1.5"
							>
								{fileGroups(files).map((group) => {
									const rows = group.files.map((file) => (
										<ChangedFileRow
											key={file.path}
											file={file}
											depth={0}
											selected={file.path === selectedPath}
											onOpen={() => onOpenFile(file.path)}
											onDiscard={onDiscard === undefined ? undefined : () => onDiscard(file.path)}
										/>
									));
									if (group.heading === null) return <div key="files">{rows}</div>;
									return (
										// biome-ignore lint/a11y/useSemanticElements: a group of the grid's rows, named by its heading; the rows are divs placed like the Changes list's.
										<div key={group.heading} role="rowgroup" aria-label={group.heading}>
											<div className="ml-1.5 py-1.5 text-xs font-medium text-fg-muted">
												{group.heading}
											</div>
											{rows}
										</div>
									);
								})}
							</div>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}
