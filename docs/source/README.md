# Stakeholder source documents

Supplementary stakeholder references kept for traceability. **None of these is a technical source of
truth.** The implementation sources of truth are `CLAUDE.md`, `docs/MEMORY.md`,
`docs/MASTER-MAPPING.md`, `docs/PHASE-PROMPTS.md`, and the approved ADRs in `docs/decisions/`
([ADR-0013](../decisions/adr-0013-arabic-scope-document-status.md)). Later written stakeholder decisions
supersede conflicting statements in these documents.

Files here are stored byte-for-byte as received. They are never edited; a new revision is added as a new
file, and the reconciliation review is re-run against it.

## alola-client-business-scope-ar.pdf

| | |
|---|---|
| Stored as | `docs/source/alola-client-business-scope-ar.pdf` |
| Original filename | `نطاق_أعمال_نظام_شركة_العلا_للتطوير_العقاري.pdf` |
| Description | Arabic client-facing business scope, version 1.0, September 2026, 22 pages; unsigned draft (approval page blank) |
| Status | Approved **supplementary** stakeholder reference — not a technical source of truth |
| Size | 309,327 bytes |
| SHA-256 | `89fade53871af54f69527c3a23cee7171197525b322db0ed0d301e9c53199f7b` |
| Added to repository | 2026-09-19, moved and renamed only; contents unchanged (checksum identical before and after) |
| Reconciliation | [../discovery/arabic-scope-review.md](../discovery/arabic-scope-review.md) — conflicts `C-01`–`C-06`, gaps `G-01`–`G-13` |
| Superseded statements | Dark Mode (`C-01` → `SD-13`), narrower Meta scope (`C-02` → `SD-14`), Conversions API silence (`C-03` → `SD-15`) — see [../decisions/open-decisions.md](../decisions/open-decisions.md) |

Verify the file is unmodified:

```sh
sha256sum docs/source/alola-client-business-scope-ar.pdf
# PowerShell: Get-FileHash docs/source/alola-client-business-scope-ar.pdf -Algorithm SHA256
```
