#!/usr/bin/env bash
# Fails if any operational screen writes straight to a printer. Direct writes
# are allowed only in the printer library, the outbox worker, and test prints.
set -euo pipefail
hits=$(rg -n "printDirect\(|printDirectBatch\(|printCounterViaAndroidBridge\(|queuePrintJob\(|from\(\"print_jobs\"\)\.insert" src \
  | grep -v "^src/lib/counter-printer.ts:" \
  | grep -v "^src/lib/native-print-queue.ts:" \
  | grep -v "^src/routes/print-test\.\$kind\.tsx:" \
  | grep -v "^src/routes/_app/settings.tsx:" || true)
if [ -n "$hits" ]; then echo "Operational direct-print bypass found:"; echo "$hits"; exit 1; fi
echo "OK: no operational direct-print paths"
