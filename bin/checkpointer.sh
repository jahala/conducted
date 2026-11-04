#!/usr/bin/env bash
# @feature GIT-10 Checkpointer: save, restore and diff a worktree with private refs
# Owns: snapshots of a worktree (index and full working tree, tracked and untracked, ignoring what
#   .gitignore ignores) stored as commits under refs/conducted/checkpoints/<id>. Nothing in the
#   worktree, HEAD or any branch changes when a snapshot is saved.
# Behaviour: research/conductor/native-and-sidecar-map.md C1 (usage, exit codes, temp index
#   handling) and sessions.md section 7 (the sidecar calls it before and after every turn, with a
#   60 s timeout and SIGTERM, and reads exit codes 101 and 102 as "skipped"). The code is ours.
# Must handle:
#   - run from the worktree root; if git's top-level folder is an ancestor of the current folder
#     (for example a git-controlled $HOME), refuse with exit 103 so a snapshot never covers it
#   - a merge, rebase, cherry-pick or revert in progress (git-busy-check.sh says busy): exit 101
#   - unmerged index entries: exit 102
#   - an id that already exists needs --force; without it exit 1 with a message
#   - an unborn HEAD (no commit yet): save works and records "none" as head; restore of such a
#     snapshot is refused
#   - temp index files live in <gitdir>/conducted-checkpoint-tmp/<random>/ with a file "owner-pid";
#     directories older than 60 minutes whose owner is gone are removed by the next run, through
#     `trash` (never rm)
#   - SIGTERM and SIGINT: clean up through the EXIT trap and exit 143
#   - restore rewrites only files that differ (so file watchers stay calm), removes untracked files
#     that the snapshot does not have, keeps ignored files, then restores the saved index
#   - file names with spaces, newlines or non-ASCII characters (use NUL-separated git output)
# Test first: in a temp repo, `save --id a`, edit a file, `save --id b`, `diff a b -- --name-status`
#   lists exactly that file, and `restore a` brings the content back with no other file touched.
#
# Usage:
#   checkpointer.sh save [--id <id>] [--force]
#   checkpointer.sh restore <id>
#   checkpointer.sh diff <id1> <id2|current> [-- <git diff arguments>]
#   checkpointer.sh help
#
# Arguments:
#   --id <id>      name of the snapshot; default cp-<UTC timestamp>
#   --force        overwrite an existing snapshot with the same id
#   <id>           the snapshot to restore or compare; "current" as the right side of diff means
#                  the live worktree, compared through a transient tree
#
# Output:
#   save     prints the id on stdout
#   restore  prints "restored checkpoint: <id>"
#   diff     prints git diff output for the arguments after "--"
#
# Exit codes (keep in sync with packages/sidecar/src/checkpoints/checkpoint-id.ts):
#   0    done
#   1    error (message on stderr)
#   64   wrong command line
#   101  skipped: a merge, rebase, cherry-pick or revert is in progress
#   102  skipped: the index has unresolved conflicts
#   103  refused: git's top-level folder is not the current folder
#   143  terminated by SIGTERM or SIGINT

set -euo pipefail

not_implemented() { echo "Not implemented: $1" >&2; exit 64; }

usage() {
  sed -n '/^# Usage:/,/^$/p' "$0" | sed 's/^# \{0,1\}//' >&2
}

command="${1:-help}"
[ $# -gt 0 ] && shift

case "$command" in
  save)
    id=""
    force="no"
    while [ $# -gt 0 ]; do
      case "$1" in
        --id) [ $# -ge 2 ] || { echo "error: --id needs a value" >&2; exit 64; }; id="$2"; shift 2 ;;
        --force) force="yes"; shift ;;
        *) echo "error: unknown argument: $1" >&2; usage; exit 64 ;;
      esac
    done
    : "${id}" "${force}"
    not_implemented "GIT-10"
    ;;
  restore)
    [ $# -eq 1 ] || { echo "error: restore needs one id" >&2; usage; exit 64; }
    not_implemented "GIT-10"
    ;;
  diff)
    [ $# -ge 2 ] || { echo "error: diff needs two ids" >&2; usage; exit 64; }
    not_implemented "GIT-10"
    ;;
  help|-h|--help)
    usage
    exit 0
    ;;
  *)
    echo "error: unknown command: $command" >&2
    usage
    exit 64
    ;;
esac
