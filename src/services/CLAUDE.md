# CLAUDE.md

## Purpose

Local rules for service-layer work in `src/services/`.

## Ownership

- The service layer owns current public-route use-case logic and page shaping.
- `EventService` owns public events and results browse/detail reads.
- `OperationsPlatformService` owns readiness composition for `GET /health/ready`.
- `serviceErrors.ts` and `sqliteRetry.ts` should stay small, explicit, and easy to audit.

## eventKey rules

- Public `eventKey` pattern: `event_{year}_{event_slug}`
- Validation pattern: `^event_(\\d{4})_([a-z0-9_]+)$`
- Normalize the public key to the stored standardized hashtag form: `#event_{year}_{event_slug}`
- Do not invent an `event_slug` column or accept bare slugs.

## Layer boundaries

- Read flat rows from `db.ts`.
- Keep result grouping and presentation-oriented shaping in services or closely related UI shaping code, not in `db.ts` and not in templates.
- Do not add a repository layer, mediator layer, or extra orchestrator layer.

## Behavior reminders

- `GET /events/:eventKey` is the canonical public event route.
- A canonical event page should still render when no published results exist yet.
- Year archives show the full event list; add results-specific CTA treatment only when results exist.
