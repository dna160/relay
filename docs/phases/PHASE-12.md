# PHASE 12 — Document ingestion

## ENTRY
Phase 11 complete. D4 and D5 answered.

## SCOPE
Upload to shelf, private by default. Classifier. Deterministic extractors for xlsx, docx, pdf, with OCR fallback and provenance on every row. Constrained-schema structuring where parsing cannot reach, schema-validated with one retry then fail preserving partial extraction. Assignee resolution — deterministic email match first, role inference second as suggestions. Three-pane review UI sorted by confidence ascending. Kickoff date collected once when relative dates exist. Confirmation emits a TemplateDefinition into applyTemplate. Purge walk extended to ingest_jobs and source files.

## OUT
Auto-creation of any kind. Auto-invite of any kind. Partial saves of a proposal.

## EXIT
INV-13 unskipped: a completed ingest job writes zero rows to lanes or cards. INV-14 unskipped: mail transport asserted uncalled across the pipeline. Acceptance rate meets the PRD targets on a fixture corpus of at least twenty real documents.

## INVARIANTS
INV-13, INV-14

## HANDOVER
Report per-input-class acceptance rates against the fixture corpus. If PDF SOW is materially below target, say so — D5 may need revisiting.
