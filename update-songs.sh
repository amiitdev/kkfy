#!/usr/bin/env bash
#
# update-songs.sh — index new songs and ship them.
#
#   ./update-songs.sh              scan, rebuild, commit, push  (live in ~45 s)
#   ./update-songs.sh --no-push    scan + commit only, push yourself later
#   ./update-songs.sh --dry-run    show what would change, touch nothing
#
set -euo pipefail
cd "$(dirname "$0")"

PUSH=1
DRY=0
for a in "$@"; do
  case "$a" in
    --no-push) PUSH=0 ;;
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $a (try --help)" >&2; exit 2 ;;
  esac
done

KK="public/KK"
INDEX="public/library.json"
command -v node >/dev/null || { echo "error: node is required" >&2; exit 1; }
command -v git  >/dev/null || { echo "error: git is required"  >&2; exit 1; }
[ -d "$KK" ] || { echo "error: $KK does not exist" >&2; exit 1; }
if ! git rev-parse --verify -q HEAD >/dev/null; then
  echo "error: git HEAD is broken (a commit was interrupted)." >&2
  echo "  repair it first, e.g.:" >&2
  echo "    git fsck                      # see what is missing" >&2
  echo "    git update-ref refs/heads/main <last good commit>" >&2
  exit 1
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# baseline = the index as last COMMITTED (= what GitHub/Vercel has),
# not the working file, so a run after a failed run still reports real changes
if git show "HEAD:$INDEX" > "$TMP/old.json" 2>/dev/null && [ -s "$TMP/old.json" ]; then
  :
elif [ -f "$INDEX" ]; then cp "$INDEX" "$TMP/old.json"
else echo 'null' > "$TMP/old.json"
fi

echo "== 1/4  scanning $KK"
if [ "$DRY" = 1 ]; then echo "  (dry run: skipping build-static.mjs)"; else
  node scripts/build-static.mjs | sed 's/^/  /'
fi

echo "== 2/4  comparing with the index in the last commit"
DIFF="$(node -e '
const fs = require("fs");
const old = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const cur = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const o = new Map(((old && old.tracks) || []).map(t => [t.id, t]));
const c = new Map((cur.tracks || []).map(t => [t.id, t]));
const added = [...c.values()].filter(t => !o.has(t.id));
const removed = [...o.values()].filter(t => !c.has(t.id));
console.log(JSON.stringify({
  total: c.size,
  added: added.map(t => t.title + " — " + t.album),
  removed: removed.map(t => t.title),
}));' "$TMP/old.json" "$INDEX")"

echo "$DIFF" | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
console.log("  songs now : " + d.total);
if (d.added.length)  console.log("  new       : " + d.added.length + "\n              " + d.added.join("\n              "));
if (d.removed.length) console.log("  removed   : " + d.removed.length + "\n              " + d.removed.join("\n              "));
if (!d.added.length && !d.removed.length) console.log("  no song changes");
'

echo "== 3/4  local server (if it is running)"
if curl -fsS -m 2 -o /dev/null http://127.0.0.1:7770/api/library 2>/dev/null; then
  # a rescan probes every file, so give it real time (it is not a health check)
  curl -fsS -m 90 -X POST http://127.0.0.1:7770/api/rescan -o "$TMP/rescan.json" 2>/dev/null \
    && echo "  running on 127.0.0.1:7770 -> reloaded: $(cat "$TMP/rescan.json")" \
    || echo "  running, but the rescan failed (restart it with: node server.mjs)"
else
  echo "  not running (start it with: node server.mjs)"
fi

echo "== 4/4  git"
if [ "$DRY" = 1 ]; then
  git status --short | sed 's/^/  /' || true
  echo "  (dry run: nothing was staged, committed or pushed)"
  exit 0
fi
if git diff --quiet && git diff --cached --quiet &&
   [ -z "$(git ls-files --others --exclude-standard)" ]; then
  echo "  no file changes: songs, index and code are already committed"
  exit 0
fi
git add -A
COUNT="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("public/library.json","utf8")).tracks.length)')"
MSG="update-songs: index ${COUNT} songs"
git -c user.name="amiitdev" -c user.email="amiitdev@users.noreply.github.com" commit -q -m "$MSG"
echo "  committed  : $MSG"

if [ "$PUSH" = 1 ]; then
  if git push -q origin main; then
    echo "  pushed     : main -> Vercel rebuilds in ~45 s -> https://kkfy.vercel.app"
  else
    echo "  push FAILED (remote has commits this machine does not)."
    echo "    git pull --rebase origin main   # then run this script again"
    exit 1
  fi
else
  echo "  not pushed : run 'git push' when you are ready"
fi
echo "done."
