#!/usr/bin/env bash
# @feature RUN-08 Spotlighter: mirror a workspace into the repo root on every change
# Owns: the long-running process behind "Spotlight". While it runs, every change in the workspace
#   folder is saved as a checkpoint and restored into the main clone, so a dev server that runs in
#   the main clone shows the agent's work.
# Behaviour: research/conductor/native-and-sidecar-map.md C3 and services-map.md section 3.12 (the
#   app restores the "pre-spotlight state" of the root when Spotlight stops). The code is ours.
# Must handle:
#   - required environment (see below); a missing one prints which and exits 1
#   - run with the workspace as the current folder
#   - bursts of changes: watchexec runs one job at a time and queues the latest event, so the root
#     ends up equal to the latest workspace state
#   - ignore noise: *.tmp.* files and the .context folder
#   - a merge or rebase in the workspace (checkpointer exit 101) or a failed save: skip this round
#     and keep watching
#   - a failed restore into the root: warn in the log and on stdout, keep watching
#   - stop on SIGTERM or SIGINT: stop the watcher, exit 143
#   - the checkpoint id is cp-spotlight-<epoch>-<pid>, saved with --force, so each run replaces the
#     same ref instead of piling up (the app removes the refs on stop)
#   - log lines go to /tmp/conducted-spotlight-<pid>.log and to stdout
# Test first: in a root clone and a worktree of it, start the script, write a file in the
#   worktree, and see the same file appear in the root; stop it and see it exit 143.
#
# Usage:
#   spotlighter.sh            (no arguments; run with the workspace as the current folder)
#
# Environment (all required):
#   CONDUCTED_CHECKPOINTER_PATH   absolute path of checkpointer.sh
#   CONDUCTED_WATCHEXEC_PATH      the watchexec program (a file watcher): a path, or a name the
#                                 PATH finds; the app passes `watchexec`, which its bin folder
#                                 first on PATH resolves to the managed copy (PLAT-35)
#   CONDUCTED_ROOT_PATH           the main clone that receives the changes
#
# Exit codes:
#   0    stopped normally
#   1    a required program or variable is missing
#   64   wrong command line
#   143  terminated by SIGTERM or SIGINT

set -euo pipefail

usage() {
  sed -n '/^# Usage:/,/^$/p' "$0" | sed 's/^# \{0,1\}//' >&2
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

if [ "$#" -ne 0 ]; then
  usage
  exit 64
fi

for name in CONDUCTED_CHECKPOINTER_PATH CONDUCTED_WATCHEXEC_PATH CONDUCTED_ROOT_PATH; do
  if [ -z "${!name:-}" ]; then
    printf 'error: %s is not set\n' "$name" >&2
    exit 1
  fi
done

if [ ! -f "$CONDUCTED_CHECKPOINTER_PATH" ]; then
  die "CONDUCTED_CHECKPOINTER_PATH is not a file: $CONDUCTED_CHECKPOINTER_PATH"
fi

if [ ! -d "$CONDUCTED_ROOT_PATH" ]; then
  die "CONDUCTED_ROOT_PATH is not a folder: $CONDUCTED_ROOT_PATH"
fi

case "$CONDUCTED_WATCHEXEC_PATH" in
  */*)
    watchexec_path="$CONDUCTED_WATCHEXEC_PATH"
    if [ ! -x "$watchexec_path" ]; then
      die "the watchexec program is not executable: $watchexec_path"
    fi
    ;;
  *)
    if ! watchexec_path=$(command -v "$CONDUCTED_WATCHEXEC_PATH" 2>/dev/null); then
      die "the watchexec program is not on PATH: $CONDUCTED_WATCHEXEC_PATH"
    fi
    ;;
esac

log_file="/tmp/conducted-spotlight-$$.log"
: >"$log_file"
exec > >(tee -a "$log_file") 2>&1

workspace_path=$(pwd -P)
checkpoint_id="cp-spotlight-$(date +%s)-$$"
export CONDUCTED_CHECKPOINTER_PATH CONDUCTED_ROOT_PATH
export CONDUCTED_SPOTLIGHT_ID="$checkpoint_id"

printf 'spotlight: watching %s, restoring into %s\n' "$workspace_path" "$CONDUCTED_ROOT_PATH"

# watchexec runs this string once per change batch. It saves the worktree as one checkpoint and
# restores that checkpoint into the root. A save that git refused (a merge, a rebase) is skipped;
# any other failed save or restore is reported without stopping the watcher.
# shellcheck disable=SC2016 # the child's shell expands these variables, not this one
runner='
paths="${WATCHEXEC_CREATED_PATH:-} ${WATCHEXEC_WRITTEN_PATH:-} ${WATCHEXEC_REMOVED_PATH:-}"
printf "spotlight: change %s\n" "${paths:-in the workspace}"
if bash "$CONDUCTED_CHECKPOINTER_PATH" save --id "$CONDUCTED_SPOTLIGHT_ID" --force; then
  :
else
  status=$?
  if [ "$status" -eq 101 ]; then
    exit 0
  fi
  printf "spotlight: checkpoint save failed (exit %s); skipping this round\n" "$status" >&2
  exit 0
fi
if ! cd "$CONDUCTED_ROOT_PATH"; then
  printf "spotlight: cannot enter the root %s\n" "$CONDUCTED_ROOT_PATH" >&2
  exit 0
fi
if ! bash "$CONDUCTED_CHECKPOINTER_PATH" restore "$CONDUCTED_SPOTLIGHT_ID"; then
  printf "spotlight: restoring %s into %s failed\n" "$CONDUCTED_SPOTLIGHT_ID" "$CONDUCTED_ROOT_PATH" >&2
fi
exit 0
'

watcher_pid=""

# shellcheck disable=SC2329 # the trap below invokes it
on_signal() {
  trap '' INT TERM
  if [ -n "$watcher_pid" ]; then
    kill -TERM "$watcher_pid" 2>/dev/null || true
    wait "$watcher_pid" 2>/dev/null || true
  fi
  printf 'spotlight: stopped\n'
  exit 143
}

trap on_signal INT TERM

"$watchexec_path" \
  --quiet \
  --color=never \
  --shell=none \
  --watch . \
  --project-origin . \
  --emit-events-to=environment \
  --ignore '*.tmp.*' \
  --ignore '.context/**' \
  -- bash -c "$runner" &
watcher_pid=$!

if wait "$watcher_pid"; then
  exit 0
else
  watcher_status=$?
  exit "$watcher_status"
fi
