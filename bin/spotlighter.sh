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
#   - bursts of changes: the watcher runs the sync script once per batch and queues one more run
#     while a sync is running, so the root always ends up equal to the latest workspace state
#   - ignore noise: *.tmp.* files and the .context folder
#   - a merge or rebase in the workspace (checkpointer exit 101) or a failed save: skip this round
#     quietly, do not fail the watcher
#   - a failed restore into the root: warn on stderr, keep watching
#   - stop on SIGTERM or SIGINT: stop the watcher, exit 143
#   - the checkpoint ids are cp-spotlight-<epoch>-<pid>, saved with --force, so they do not pile up
#     (each run replaces the same family; old ones are removed by the app on stop)
#   - log lines go to /tmp/conducted-spotlight-<pid>.log and to stdout
# Test first: in two temp repos, start the script, write a file in the workspace, and see the same
#   file appear in the root within a few seconds; stop it and see it exit 143.
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

not_implemented() { echo "Not implemented: $1" >&2; exit 64; }

if [ $# -ne 0 ]; then
  echo "usage: spotlighter.sh (no arguments)" >&2
  exit 64
fi

for name in CONDUCTED_CHECKPOINTER_PATH CONDUCTED_WATCHEXEC_PATH CONDUCTED_ROOT_PATH; do
  if [ -z "${!name:-}" ]; then
    echo "error: $name is not set" >&2
    exit 1
  fi
done

not_implemented "RUN-08"
