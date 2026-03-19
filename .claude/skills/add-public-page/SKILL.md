---
name: add-public-page
description: Add or extend a public server-rendered page in the current Express + Handlebars app. Use when the task adds a new public route, new top-level nav section, or changes an existing public controller, service, template, or route-level tests.
---

# Add Public Page

Public pages in this project are IFPA-facing visitor pages. Every page must conform to the rendering standard in VIEW_CATALOG.md. New pages must satisfy accepted user stories. The source-of-truth order is: explicit human decisions > current code > docs.

## Step 1 — Load authoritative docs before touching code

Read these in order before proposing any change:

1. **The top active-slice/status block in `IMPLEMENTATION_PLAN.md`** — confirm the page is in scope now, drafted next, or out of scope.
2. **`docs/USER_STORIES.md`** — find the acceptance criteria that drive this page. Do not infer behavior; derive it from the stories.
3. **`docs/VIEW_CATALOG.md`** — the authoritative page contract for views already implemented or actively specified in the current slice. Read:
   - §4.2 Required top-level view-model shape (`seo`, `page`, `navigation`, `content`)
   - §4.3 Required reusable primitives (event card, discipline tag, result section, year nav, etc.)
   - §4.4 Implementation rules (thin controllers, logic-light templates, service-owned shaping)
   - §4.5 Visual rules and CSS token baseline
   - §5 Route catalog — confirm the route is cataloged or explain why it should be added
   - §6.x Page specification for the affected page — required content, required view-model fields, navigation outputs, empty states
4. **`docs/SERVICE_CATALOG.md`** — identify the owning service, its method contracts, and any business rules that must remain in the service layer. If the required service method does not yet exist, **invoke `extend-service-contract` first and complete it before continuing here**.
5. **`database/schema.sql`** — verify field names, nullable vs. required, status enum values, and any computed or join-derived fields used in the view-model.

`docs/VIEW_CATALOG.md` may be intentionally partial. If the requested page is not cataloged, first determine whether it is out of scope for the current slice before proposing catalog expansion.

## Step 1b — Fetch external content if required

If the page spec states that content is to be sourced from an external URL (e.g. an About Us page, editorial text, or an honor-roll from another site), fetch it **now** with WebFetch before writing any code:

- Review the fetched content to understand its headings, sections, and body text.
- Identify the section structure that will map to the view-model's `content.sections[]` (heading + body per section).
- Plan how the service will return that content as shaped static data — never as raw HTML or hardcoded template strings.
- If the content cannot be fetched (network error, paywall), stop and report to the human before continuing.

Do not defer this step. Fetching after writing the service leads to rework.

## Step 2 — Inspect current code

After reading docs, read:
- `src/routes/publicRoutes.ts`
- the relevant controller
- the relevant service
- the target Handlebars template(s) and partials
- nearby integration tests in `tests/integration/`

If this task adds a **new top-level nav section**, also read:
- `src/controllers/homeController.ts` — the home page composes `primaryLinks[]`; a new section must appear here
- the shared nav partial or layout template that renders the `navigation.items` array — confirm the new section key will render correctly

## Step 3 — Preserve current architecture

- server-rendered Express + Handlebars — no client-side rendering
- thin controllers: HTTP glue only; no business logic
- service-owned shaping: all page-model building, business rules, and domain logic belong in services
- logic-light templates: templates branch only on already-shaped booleans, empty arrays, or presentation-ready sections — never on raw domain data or route semantics
- explicit route registration — no dynamic or catch-all route magic
- no repository abstractions, ORMs, mediator layers, or speculative API layers

**Naming conventions (enforced):**
- Controllers: `{domain}Controller.ts` — camelCase, singular noun, no plurals. Examples: `eventController.ts`, `memberController.ts`, `clubController.ts`. There is no `publicController` layer.
- Services: `{domain}Service.ts` — camelCase, singular noun, no plurals. Examples: `eventService.ts`, `memberPublicReadService.ts`.

## Step 4 — Watch for route hazards

- preserve explicit route ordering
- do not break `/events/year/:year` vs. `/events/:eventKey` ordering (more-specific must be first)

## Step 5 — State your plan before editing

Before touching any file, state:
- route(s) affected and whether they are already cataloged in VIEW_CATALOG.md §5
- user story acceptance criteria being satisfied
- view-model fields required by VIEW_CATALOG.md §6.x
- service method(s) that will own the page shaping
- if content comes from an external URL: the fetched content structure and how it maps to `content.sections[]`
- if a new top-level nav section: which files need a nav item added (home controller, nav partial/layout, VIEW_CATALOG.md §4.2)
- complete list of files expected to change
- verification plan

## Step 6 — Verification

- write or update integration tests in `tests/integration/` (Vitest + Supertest pattern)
- run `npm test` to confirm all tests pass
- run `npm run build` (`tsc -p tsconfig.json`) to confirm no type errors
- only use browser automation if the human explicitly asked for it (see `browser-qa` skill)
- after changes, invoke `doc-sync` to check whether VIEW_CATALOG.md or SERVICE_CATALOG.md needs updating
