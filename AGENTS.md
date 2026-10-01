
- Operational native prints go through the print_jobs outbox (`enqueue_print_job`, `open_shift_safely`, `close_shift_with_ticket`) and are delivered only by the leased worker in `src/lib/native-print-queue.ts` — so paper failures never lose tickets or roll back business commits.
