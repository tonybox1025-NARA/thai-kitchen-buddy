#!/usr/bin/env bash
# Fails if operational code reads the viewer's device timezone.
# Allowed: src/lib/bkk-time.ts (canonical module), src/components/ui (date picker
# widgets), and lines tagged "tz-safe:" with a justification.
set -euo pipefail
cd "$(dirname "$0")/../src"
PAT='\.(getHours|getDay|getDate|getMonth|getFullYear|setHours|setDate|setMonth|getMinutes)\(|\.toLocale(Date|Time)String\(|new Date\([^)]*\)\.toLocaleString\(|\bnow\.toLocaleString\(|new Intl\.DateTimeFormat\('
hits=$(rg -n "$PAT" routes lib components --glob '!components/ui/**' --glob '!lib/bkk-time.ts' \
  | rg -v 'timeZone|tz-safe:' || true)
# multi-line Intl/toLocale calls carry timeZone on a following line
bad=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  f=${line%%:*}; rest=${line#*:}; n=${rest%%:*}
  if sed -n "${n},$((n+6))p" "$f" | rg -q 'timeZone'; then continue; fi
  if echo "$line" | rg -q '\.(getHours|getDay|getDate|getMonth|getFullYear|setHours|setDate|setMonth|getMinutes)\(' ; then bad+="$line"$'\n'; continue; fi
  bad+="$line"$'\n'
done <<< "$hits"
if [ -n "$bad" ]; then echo "Device-timezone date usage found:"; printf '%s' "$bad"; exit 1; fi
echo "OK: no device-timezone date usage in operational code"
