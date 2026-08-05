#!/usr/bin/env bash
# atlas-bundle.sh — manage the private atlasMaster files that CI cannot check out.
#
# WHY THIS EXISTS
# functions/src/index.ts exports four functions whose source is GITIGNORED (private
# Sheet IDs / customer names; this repo is PUBLIC). A clean checkout therefore does
# not compile — verified 2026-08-05: `tsc` on `git archive HEAD` fails with 14 errors,
# 8 of them TS2307 "Cannot find module '../sources/atlasMaster/...'".
#
# So CI restores those files from the GitHub secret ATLAS_MASTER_BUNDLE, and verifies
# what it restored against the COMMITTED sentinel functions/atlasMaster.sha256.
# The sentinel is safe to publish: it is filenames (already named in index.ts) plus
# SHA-256 digests, which reveal nothing about the contents.
#
# THE DRIFT HOLE THIS CLOSES
# Edit a private file locally and the GitHub secret silently goes stale — CI would
# keep deploying the OLD config forever. The sentinel makes that mismatch loud:
# CI fails, and the pre-commit hook warns you before you even push.
#
# USAGE
#   scripts/atlas-bundle.sh check      # do local files match the committed sentinel?
#   scripts/atlas-bundle.sh sentinel   # regenerate the sentinel from local files
#   scripts/atlas-bundle.sh bundle     # emit base64 tar.gz -> paste into the secret
#
# WHENEVER YOU EDIT A PRIVATE FILE, BOTH must be refreshed:
#   1. scripts/atlas-bundle.sh sentinel   (then commit functions/atlasMaster.sha256)
#   2. scripts/atlas-bundle.sh bundle     (then update the ATLAS_MASTER_BUNDLE secret)
# Doing only one of the two is exactly the drift the sentinel exists to catch.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$REPO_ROOT/functions/src"
SENTINEL="$REPO_ROOT/functions/atlasMaster.sha256"

# Private paths, relative to functions/src. Must stay in sync with the trailing
# block of .gitignore. `verify-ignored` below asserts that they really are ignored.
PRIVATE_PATHS=(
  "sources/atlasMaster"
  "jobs/atlasMasterSync.ts"
  "http/triggerAtlasMasterRead.ts"
  "http/triggerAtlasMasterSync.ts"
)

# Expand the path list into a sorted list of concrete files (dirs are walked).
#
# NOTE ON THE SHAPE OF THIS FUNCTION (do not "simplify" it back into a pipeline):
# it was originally `for p in ...; done | LC_ALL=C sort`. A pipeline runs its
# left-hand side in a SUBSHELL, so the `exit 1` on a missing file exited only that
# subshell and the function returned *sort's* status — always 0. The integrity
# guard was inert, and `sentinel`/`bundle` would happily emit a TRUNCATED result
# with exit 0. Accumulate first, sort last, `return` (not `exit`) so the status
# actually reaches the caller. (Rule 11 — found by the reviewer subagent 2026-08-05.)
#
# Restricted to *.ts so a stray config.ts.orig / .swp / .DS_Store cannot slip into
# the sentinel and the secret and produce phantom drift.
list_files() {
  cd "$SRC_DIR"
  local p out=""
  for p in "${PRIVATE_PATHS[@]}"; do
    if [ -d "$p" ]; then
      out+="$(find "$p" -type f -name '*.ts')"$'\n'
    elif [ -f "$p" ]; then
      out+="$p"$'\n'
    else
      echo "atlas-bundle: MISSING private path: functions/src/$p" >&2
      echo "  This checkout cannot build or deploy. Restore it from your operator copy." >&2
      return 1
    fi
  done
  printf '%s' "$out" | grep -v '^[[:space:]]*$' | LC_ALL=C sort
}

# Capture list_files into the array FILES, propagating its failure status.
# `mapfile < <(list_files)` would NOT propagate — process substitution discards the
# exit status, the same class of bug as the pipeline above.
load_files() {
  local raw
  raw="$(list_files)" || return 1
  mapfile -t FILES <<< "$raw"
  [ "${#FILES[@]}" -gt 0 ] || { echo "atlas-bundle: no private files found" >&2; return 1; }
}

# Guard: a private file that is NOT gitignored would leak on the next commit.
verify_ignored() {
  load_files || return 1
  cd "$REPO_ROOT"
  local f leaked=0
  for f in "${FILES[@]}"; do
    if ! git check-ignore -q "functions/src/$f"; then
      echo "atlas-bundle: NOT GITIGNORED: functions/src/$f" >&2
      leaked=1
    fi
  done
  if [ "$leaked" -ne 0 ]; then
    echo "atlas-bundle: refusing to continue — a private file would be committed to a PUBLIC repo." >&2
    exit 1
  fi
}

cmd_sentinel() {
  verify_ignored || exit 1
  load_files || exit 1
  cd "$SRC_DIR"
  sha256sum "${FILES[@]}" > "$SENTINEL"
  echo "atlas-bundle: wrote $(wc -l < "$SENTINEL") digests to functions/atlasMaster.sha256"
  echo "atlas-bundle: NOW ALSO refresh the secret -> scripts/atlas-bundle.sh bundle"
}

cmd_check() {
  if [ ! -f "$SENTINEL" ]; then
    echo "atlas-bundle: no sentinel at functions/atlasMaster.sha256 (run: sentinel)" >&2
    exit 1
  fi
  cd "$SRC_DIR"
  # Every listed file must exist with the recorded digest...
  if ! sha256sum -c --quiet "$SENTINEL"; then
    echo "atlas-bundle: DRIFT — local private files do not match the committed sentinel." >&2
    exit 1
  fi
  # ...and there must be no EXTRA private file the sentinel does not cover.
  local recorded actual
  # Strip "<64 hex> " plus coreutils' mode marker. Git Bash writes "hash *path"
  # (binary mode); Linux coreutils writes "hash  path" (text). Accept both, so a
  # sentinel regenerated on either OS parses identically.
  recorded="$(sed -E 's/^[0-9a-f]{64} [ *]//' < "$SENTINEL" | LC_ALL=C sort)"
  actual="$(list_files)" || exit 1
  if [ "$recorded" != "$actual" ]; then
    echo "atlas-bundle: DRIFT — private file SET differs from the sentinel:" >&2
    diff <(echo "$recorded") <(echo "$actual") >&2 || true
    exit 1
  fi
  echo "atlas-bundle: OK — $(echo "$actual" | wc -l) private files match the sentinel."
}

cmd_bundle() {
  verify_ignored || exit 1
  # Refuse to emit a bundle that does not match the committed sentinel — that is
  # exactly the stale-secret drift this whole mechanism exists to prevent.
  cmd_check >/dev/null || {
    echo "atlas-bundle: refusing to emit a bundle that does not match the sentinel." >&2
    echo "  Run 'scripts/atlas-bundle.sh sentinel' first, and commit it." >&2
    exit 1
  }
  load_files || exit 1
  cd "$SRC_DIR"
  tar czf - "${FILES[@]}" | base64 -w0
  echo
}

case "${1:-}" in
  sentinel) cmd_sentinel ;;
  check)    cmd_check ;;
  bundle)   cmd_bundle ;;
  *)
    echo "usage: scripts/atlas-bundle.sh {check|sentinel|bundle}" >&2
    exit 2
    ;;
esac
