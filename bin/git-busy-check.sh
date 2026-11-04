#!/usr/bin/env bash
# @feature GIT-11 Git busy check: is a git operation in progress?
# Owns: telling the checkpointer and the app whether a worktree is in the middle of a rebase,
#   merge, squash merge, cherry-pick or revert.
# Behaviour: research/conductor/native-and-sidecar-map.md C2: the answer follows git's own
#   git-prompt.sh logic (state files inside the git directory). The code is ours.
# Must handle:
#   - a linked worktree: its git directory is not <path>/.git but a file that points elsewhere, so
#     ask git for the path (`git rev-parse --git-dir`), never assume it
#   - rebase has two forms (rebase-merge and rebase-apply); both print busy:rebase
#   - a squash merge leaves SQUASH_MSG and unmerged entries, but no MERGE_HEAD: busy:squash-merge
#     only when both are present
#   - several states at once: print the first in the order rebase, merge, squash-merge,
#     cherry-pick, revert
#   - a path that does not exist or is not a git worktree: print "error: ..." on stderr, exit 2
#   - paths with spaces
# Test first: in a temp repo with a conflicting `git merge`, the script prints busy:merge; after
#   `git merge --abort` it prints clean.
#
# Usage:
#   git-busy-check.sh <workspace-path>
#
# Output (one line on stdout):
#   clean | busy:rebase | busy:merge | busy:squash-merge | busy:cherry-pick | busy:revert
#
# Exit codes:
#   0   the state was printed
#   2   bad path or not a git repository (message on stderr)
#   64  wrong command line

set -euo pipefail

not_implemented() { echo "Not implemented: $1" >&2; exit 64; }

if [ $# -ne 1 ]; then
  echo "usage: git-busy-check.sh <workspace-path>" >&2
  exit 64
fi

workspace="$1"
if [ ! -d "$workspace" ]; then
  echo "error: not a folder: $workspace" >&2
  exit 2
fi

not_implemented "GIT-11"
