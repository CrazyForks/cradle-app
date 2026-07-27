# Recall Module

Recall owns a rebuildable evidence projection over canonical chat messages, backend runs, run snapshot tool events, and extracted file touches. Live Chat Runtime writes call the same projector functions used by repair; Recall never owns the source rows.

Normal startup performs one bounded reconciliation batch per source instead of deleting and rewriting the full projection. The periodic Maintenance activity repeats that idempotent reconciliation, with at most 500 missing messages, runs, tool events, and orphaned tool events handled per invocation. `repairRecallProjection` remains the explicit destructive full rebuild for operator-directed corruption recovery and is never scheduled automatically.

<!-- Once this directory changes, update this README.md -->
