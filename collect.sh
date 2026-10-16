#!/usr/bin/env bash
# Downloads every artifact of a VoiceOver workflow run and places the transcripts in results/<slug>/
# and the videos next to them. Raw artifacts stay in results-raw/run-<id>/.
# Usage: bash collect.sh <run-id>
set -e
run="$1"; repo="Dlopez0207/miami-boat-show-voiceover"
cd "$(dirname "$0")"
rm -rf "results-raw/run-$run" && mkdir -p "results-raw/run-$run"
gh run download "$run" -R "$repo" -D "results-raw/run-$run"
find "results-raw/run-$run" -path "*/transcripts/*" -name "voiceover-transcript-*.txt" | while read -r f; do
  slug=$(basename "$(dirname "$f")"); browser=$(basename "$f" .txt); browser=${browser#voiceover-transcript-}
  mkdir -p "results/$slug"; cp "$f" "results/$slug/"
  art=$(echo "$f" | cut -d/ -f3)
  v=$(find "results-raw/run-$run/$art" -name "*.webm" | head -1)
  [ -n "$v" ] && cp "$v" "results/$slug/voiceover-video-$browser.webm"
  echo "results/$slug/$(basename "$f")  $(grep -m1 '^Phrases' "$f")"
done
