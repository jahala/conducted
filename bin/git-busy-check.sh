#!/usr/bin/env bash
# @feature GIT-11 Git busy check: is a git operation in progress?
# Owns: telling the checkpointer and the app whether a worktree is in the middle of a rebase,
#   merge, squash merge, cherry-pick or revert.
# Behaviour: research/conductor/native-and-sidecar-map.md C2: the answer follows git's own
#   git-prompt.sh logic (state files inside the git directory). The code is ours.
# Must handle:
#   - a linked worktree: its git directory is not <path>/.git but a file that points elsewhere, so
#     ask git for the path (`git rev-parse --absolute-git-dir`), never assume it
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

usage() {
  printf 'usage: git-busy-check.sh <workspace-path>\n' >&2
}

if [ "$#" -ne 1 ]; then
  usage
  exit 64
fi

workspace="$1"

if [ ! -d "$workspace" ]; then
  printf 'error: not a folder: %s\n' "$workspace" >&2
  exit 2
fi

# Ask git whether this path is a worktree. A bare repository answers "false", and a path
# outside any repository fails. Both are errors here.
if ! inside=$(git -C "$workspace" rev-parse --is-inside-work-tree 2>/dev/null) ||
  [ "$inside" != "true" ]; then
  printf 'error: not a git worktree: %s\n' "$workspace" >&2
  exit 2
fi

# The git directory of a linked worktree is not <path>/.git, so let git report it.
if ! git_dir=$(git -C "$workspace" rev-parse --absolute-git-dir 2>/dev/null); then
  printf 'error: cannot read the git directory of %s\n' "$workspace" >&2
  exit 2
fi

# Rebase is directory based: rebase-merge for the merge backend, rebase-apply for the patch
# backend. Check both before anything else, because a conflicted rebase can leave other files.
if [ -d "$git_dir/rebase-merge" ] || [ -d "$git_dir/rebase-apply" ]; then
  printf 'busy:rebase\n'
  exit 0
fi

if [ -f "$git_dir/MERGE_HEAD" ]; then
  printf 'busy:merge\n'
  exit 0
fi

# `git merge --squash` leaves SQUASH_MSG but no MERGE_HEAD. A clean squash also leaves the file.
# Only an unresolved squash conflict has both SQUASH_MSG and index entries with stage 1 to 3.
if [ -f "$git_dir/SQUASH_MSG" ] &&
  [ -n "$(git -C "$workspace" ls-files --unmerged)" ]; then
  printf 'busy:squash-merge\n'
  exit 0
fi

if [ -f "$git_dir/CHERRY_PICK_HEAD" ]; then
  printf 'busy:cherry-pick\n'
  exit 0
fi

if [ -f "$git_dir/REVERT_HEAD" ]; then
  printf 'busy:revert\n'
  exit 0
fi

printf 'clean\n'
