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
#   - an unborn HEAD (no commit yet): save works and records an all-zero head; restore of such a
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

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
REF_PREFIX="refs/conducted/checkpoints/"
TMP_NAME="conducted-checkpoint-tmp"
STALE_MINUTES=60
ZERO_OID="0000000000000000000000000000000000000000"
EMPTY_TREE="4b825dc642cb6eb9a060e54bf8d69288fbee4904"

tmp_work=""
tmp_index=""

usage() {
  sed -n '/^# Usage:/,/^$/p' "$0" | sed 's/^# \{0,1\}//' >&2
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "$tmp_work" ] && [ -d "$tmp_work" ]; then
    find "$tmp_work" -depth -delete 2>/dev/null || true
  fi
}

on_signal() {
  exit 143
}

trap cleanup EXIT
trap on_signal INT TERM

# A temp folder of ours may be removed; anything else goes to the Trash. The system `trash`
# command is present on macOS. When it is missing, a stale folder is left where it is.
trash_path() {
  if command -v trash >/dev/null 2>&1; then
    trash "$1" >/dev/null 2>&1 || true
  fi
}

# Remove temp index folders older than an hour whose owner process is gone. A folder without an
# owner file is treated as abandoned.
prune_stale() {
  local root="$1"
  [ -d "$root" ] || return 0
  local entry pid
  for entry in "$root"/*; do
    [ -d "$entry" ] || continue
    [ -n "$(find "$entry" -maxdepth 0 -mmin "+$STALE_MINUTES" -print 2>/dev/null)" ] || continue
    pid=""
    if [ -f "$entry/owner-pid" ]; then
      pid=$(cat "$entry/owner-pid" 2>/dev/null || true)
    fi
    case "$pid" in
      '' | *[!0-9]*) pid="" ;;
    esac
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
      trash_path "$entry"
    fi
  done
}

# Create a private temp index folder and record the path of its index file in tmp_index. The folder
# records the process that owns it, so a folder left by a killed run can be pruned later.
new_temp_index() {
  local root="$1"
  mkdir -p "$root"
  tmp_work=$(mktemp -d "$root/chkpt.XXXXXX")
  tmp_index="$tmp_work/index"
  printf '%s\n' "$$" >"$tmp_work/owner-pid"
}

# Both save and diff must run from the worktree root. A git-controlled parent folder (for example
# $HOME) is refused so a snapshot never covers more than the workspace.
require_worktree_root() {
  git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git worktree"
  local top
  top=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git worktree"
  top=$(cd -- "$top" && pwd -P)
  if [ "$(pwd -P)" != "$top" ]; then
    printf 'refused: the git top-level folder is not the current folder\n' >&2
    exit 103
  fi
}

checkpoint_ref() {
  printf '%s%s\n' "$REF_PREFIX" "$1"
}

ref_exists() {
  git show-ref --verify --quiet "$1"
}

# Read one metadata line from a checkpoint commit.
commit_field() {
  local commit="$1" name="$2"
  git cat-file commit "$commit" | sed -n "s/^$name //p" | sed -n '1p'
}

cmd_save() {
  local id=""
  local force="no"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --id)
        [ "$#" -ge 2 ] || {
          echo "error: --id needs a value" >&2
          exit 64
        }
        id="$2"
        shift 2
        ;;
      --force)
        force="yes"
        shift
        ;;
      *)
        echo "error: unknown argument: $1" >&2
        usage
        exit 64
        ;;
    esac
  done

  require_worktree_root

  local state
  state=$(bash "$SCRIPT_DIR/git-busy-check.sh" "$(pwd -P)") ||
    die "could not check whether a git operation is running"
  if [ "$state" != "clean" ]; then
    printf 'skipped: %s\n' "$state" >&2
    exit 101
  fi

  if [ -n "$(git ls-files -u)" ]; then
    printf 'skipped: the index has unresolved conflicts\n' >&2
    exit 102
  fi

  if [ -z "$id" ]; then
    id="cp-$(date -u +%Y%m%dT%H%M%SZ)"
  fi

  local ref
  ref=$(checkpoint_ref "$id")
  if ref_exists "$ref" && [ "$force" != "yes" ]; then
    printf 'error: checkpoint %s already exists (use --force to overwrite)\n' "$id" >&2
    exit 1
  fi

  local index_tree head_oid
  index_tree=$(git write-tree)
  if head_oid=$(git rev-parse --verify HEAD 2>/dev/null); then :; else head_oid="$ZERO_OID"; fi

  local git_dir worktree_tree
  git_dir=$(git rev-parse --absolute-git-dir)
  prune_stale "$git_dir/$TMP_NAME"
  new_temp_index "$git_dir/$TMP_NAME"

  GIT_INDEX_FILE="$tmp_index" git read-tree "$index_tree"
  GIT_INDEX_FILE="$tmp_index" git add -A -- .
  worktree_tree=$(GIT_INDEX_FILE="$tmp_index" git write-tree)

  local message commit
  message=$(printf 'checkpoint:%s\nhead %s\nindex-tree %s\nworktree-tree %s\ncreated %s\n' \
    "$id" "$head_oid" "$index_tree" "$worktree_tree" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
  commit=$(
    GIT_AUTHOR_NAME="Checkpointer" GIT_AUTHOR_EMAIL="checkpointer@noreply" \
      GIT_COMMITTER_NAME="Checkpointer" GIT_COMMITTER_EMAIL="checkpointer@noreply" \
      git commit-tree "$worktree_tree" -m "$message"
  )

  git update-ref "$ref" "$commit"
  printf '%s\n' "$id"
}

cmd_restore() {
  [ "$#" -eq 1 ] || {
    echo "error: restore needs one id" >&2
    usage
    exit 64
  }
  local id="$1"
  git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git worktree"

  local ref
  ref=$(checkpoint_ref "$id")
  ref_exists "$ref" || die "checkpoint $id does not exist"

  local commit head_oid index_tree worktree_tree
  commit=$(git rev-parse --verify "$ref")
  head_oid=$(commit_field "$commit" "head")
  index_tree=$(commit_field "$commit" "index-tree")
  worktree_tree=$(commit_field "$commit" "worktree-tree")
  if [ -z "$head_oid" ] || [ "$head_oid" = "$ZERO_OID" ]; then
    die "cannot restore checkpoint $id: it was saved on an unborn HEAD"
  fi
  [ -n "$index_tree" ] || die "checkpoint $id has no index tree"
  [ -n "$worktree_tree" ] || die "checkpoint $id has no worktree tree"

  # Move HEAD back only when it differs or a half-finished operation is still recorded. A plain
  # restore of an identical snapshot must not touch anything, so file watchers stay quiet.
  local git_dir current_head busy="no"
  git_dir=$(git rev-parse --absolute-git-dir)
  if [ -f "$git_dir/MERGE_HEAD" ] || [ -f "$git_dir/CHERRY_PICK_HEAD" ] ||
    [ -f "$git_dir/REVERT_HEAD" ]; then
    busy="yes"
  fi
  current_head=$(git rev-parse --verify HEAD 2>/dev/null || true)
  if [ "$current_head" != "$head_oid" ] || [ -n "$(git ls-files -u)" ] || [ "$busy" = "yes" ]; then
    git reset -q --mixed "$head_oid"
  fi

  git read-tree --reset "$head_oid"
  git add -A -- .
  git read-tree --reset -u "$worktree_tree"
  git clean -fd
  git read-tree --reset "$index_tree"
  git update-index -q --refresh

  printf 'restored checkpoint: %s\n' "$id"
}

cmd_diff() {
  [ "$#" -ge 2 ] || {
    echo "error: diff needs two ids" >&2
    usage
    exit 64
  }
  local left="$1" right="$2"
  shift 2
  if [ "$#" -gt 0 ]; then
    if [ "$1" = "--" ]; then
      shift
    else
      echo "error: put git diff arguments after --" >&2
      usage
      exit 64
    fi
  fi

  git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git worktree"
  local left_ref
  left_ref=$(checkpoint_ref "$left")
  ref_exists "$left_ref" || die "checkpoint $left does not exist"

  local right_target
  if [ "$right" = "current" ]; then
    local git_dir index_tree
    git_dir=$(git rev-parse --absolute-git-dir)
    prune_stale "$git_dir/$TMP_NAME"
    new_temp_index "$git_dir/$TMP_NAME"
    if index_tree=$(git rev-parse --verify 'HEAD^{tree}' 2>/dev/null); then :; else
      index_tree="$EMPTY_TREE"
    fi
    GIT_INDEX_FILE="$tmp_index" git read-tree "$index_tree"
    GIT_INDEX_FILE="$tmp_index" git add -A -- .
    right_target=$(GIT_INDEX_FILE="$tmp_index" git write-tree)
  else
    right_target=$(checkpoint_ref "$right")
    ref_exists "$right_target" || die "checkpoint $right does not exist"
  fi

  if [ "$#" -gt 0 ]; then
    git -c core.quotePath=false diff "$left_ref" "$right_target" "$@"
  else
    git -c core.quotePath=false diff "$left_ref" "$right_target"
  fi
}

command="${1:-help}"
if [ "$#" -gt 0 ]; then
  shift
fi

case "$command" in
  save) cmd_save "$@" ;;
  restore) cmd_restore "$@" ;;
  diff) cmd_diff "$@" ;;
  help | -h | --help)
    usage
    exit 0
    ;;
  *)
    echo "error: unknown command: $command" >&2
    usage
    exit 64
    ;;
esac
