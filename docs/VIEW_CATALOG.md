# Footbag Website Modernization Project -- View Catalog
**Last updated:** March 16, 2026
**Prepared by:** David Leberknight / [DavidLeberknight@gmail.com](mailto:DavidLeberknight@gmail.com)

---

## 1. Purpose

This document is the authoritative catalog for the current public website pages and the authoritative standard those pages must follow.

It has two jobs:

1. define the **generic look-and-feel standard** that applies to every cataloged page.
2. define the **catalog of public pages** that consume that standard.

The standard is cross-site and generic. Every public page must conform to it.

---

## 2. Scope

This document covers:

- the public visual and structural standard for server-rendered visitor pages
- the current public route catalog
- the required page contract for public rendering
- the current public pages in the current deployed public baseline:
  - Home  (main landing page for site)
  - Events index (main landing page for events)
  - Events year archive
  - Event detail
  - Clubs landing placeholder
- the rules future pages must follow to join the catalog

This document does not cover (yet):

- member-only pages
- organizer workflows
- admin pages
- APIs
- authentication flows
- internal tools
- implementation details that belong in code patches rather than catalog definition

---

## 3. Governing Principles

### 3.1 One standard, many pages

The public site must have one reusable look-and-feel standard. Pages consume the standard. Pages do not define their own standards.

### 3.2 Reuse must be enforceable

The standard must be enforceable through reusable code, not through convention alone.

That means:

- thin controllers
- shaped page view models
- one public layout contract
- reusable Handlebars partials/components
- shared CSS tokens and component styles
- logic-light templates

### 3.3 Events are consumers, not the authority

The existing Events pages are part of the catalog, but they do not define the site-wide visual or structural rules. They must refer to the generic standard exactly as Home, Clubs, and future sections do.

### 3.4 Future pages must fit the standard

A new public page may join the catalog only if it can be expressed through the same generic standard. If a genuinely reusable new primitive is needed, that primitive must be added to the standard itself and then reused.

---

## 4. Public Rendering Standard

## 4.1 Standard purpose

The public rendering standard defines the shared structure, page contract, and reusable UI primitives that every cataloged public page must use.

## 4.2 Required page contract

Every public page must render from the same top-level contract.

### Required top-level shape

- `seo`
  - `title`
  - optional `description`
- `page`
  - `sectionKey`
  - `pageKey`
  - `title`
  - optional `eyebrow`
  - optional `intro`
  - optional `notice`
- `navigation`
  - current public nav items: Home (`/`), Events (`/events`), Clubs (`/clubs`)
  - active section/page state
- `content`
  - page-specific regions already shaped for rendering

Templates must consume this contract rather than derive it.

## 4.3 Required reusable primitives

Every public page must be composed from the same small set of reusable primitives.

### Site frame

- header/navigation region
- main content container
- footer region

### Page hero

- optional eyebrow
- page title
- optional intro
- optional notice

### Content section

- section heading
- optional supporting text
- content body

### Event card

Used in the events index upcoming list and the home featured events region.

Each card renders: title (linked to the canonical event route), date range, location (city / region / country), host club when present, status badge, short description when present.

### Discipline tag

Used in event detail. Each tag renders the discipline name. Non-singles disciplines (`doubles`, `mixed_doubles`) include a parenthetical team-type indicator. Tags are ordered by `sortOrder`.

`discipline_category` is an application-enforced taxonomy. Canonical families are `freestyle`, `net`, `golf`, and `sideline`. The schema stores this as free text; no CHECK constraint exists.

### Result section

Used in event detail and in year archive inline results. One section per discipline grouping.

- Section header: `disciplineName` when present; otherwise "General Results"
- Optional meta line when `teamType` is present (renders raw `teamType` value)
- One row per placement: `placement` number, participant `participantDisplayName` values ordered by `participantOrder` (stacked for `doubles` and `mixed_doubles`), `scoreText` when present (cell is empty when absent — no placeholder text)
- Placements rendered in ascending `placement` order
- Template comments, loop prose, and debugging text must never appear in rendered HTML output

### Year navigation

Used in year archive. Renders previous-year and next-year links when adjacent years with completed public events exist. When no adjacent year exists, a disabled placeholder labeled "← Previous" or "Next →" renders instead. Uses `.year-nav`, `.year-nav-arrow`, and `.year-nav-arrow--disabled`.

### Metadata list / summary rows

Used for date, location, host, status, and equivalent facts.

### Empty state

Used when a page is valid but has no content to show.

### Notice / coming-soon block

Used for temporary incompleteness or intentionally stubbed sections.

### CSS class vocabulary

The CSS vocabulary is split into two tiers.

**Shared — required across all public pages:**

- Site frame: `.wrapper`, `.site-header`, `.site-logo`, `.main-nav`, `.site-footer`
- Hero: `.hero`, `.hero-sm` (compact variant for secondary pages: year archive and event detail)
- Sections: `.section-heading`, `.section-count`
- Cards: `.card-grid`, `.card`, `.card-title`, `.card-meta`, `.card-description`
- Badges: `.badge`, `.badge-published`, `.badge-registration_full`, `.badge-closed`, `.badge-completed`
- Buttons: `.btn`, `.btn-primary`, `.btn-outline`
- States: `.empty-state`

**Events section — required within events pages only:**

- Archive years: `.year-grid`, `.year-pill`, `.year-nav`, `.year-nav-arrow`, `.year-nav-arrow--disabled`
- Event detail layout: `.event-detail`, `.event-header`, `.event-meta-row`, `.event-external-link`
- Disciplines: `.disciplines-list`, `.discipline-tag`
- Results: `.results-section`, `.results-section-header`, `.discipline-meta`, `.results-table`, `.placement-num`, `.participants-list`, `.score-text`, `.no-results-notice`

## 4.4 Implementation rules

The standard must be implemented through reusable code.

### Express / controller rules

- routes return HTML pages
- controllers stay thin
- page shaping belongs in services or page-model builders
- shared site-wide data may be injected through `app.locals` and `res.locals`

### Handlebars rules

- shared structure must live in reusable partials/components
- templates remain logic-light
- helpers, if used, remain presentation-oriented
- templates must not own business rules or infer domain behavior from raw data

### CSS rules

The visual system must be organized as reusable layers rather than one growing page-specific stylesheet.

Preferred structure:

- design tokens
- base/global styles
- layout styles
- reusable component styles
- minimal page-specific exceptions only when unavoidable

## 4.5 Visual rules

All public pages must present a consistent public experience.

Required characteristics:

- clean, readable, content-first layout
- consistent spacing and max width
- consistent typography hierarchy
- consistent card treatment across sections
- consistent metadata styling
- consistent empty-state styling
- consistent notice / coming-soon styling
- consistent header/footer behavior
- no section-specific chrome systems

Visual token baseline (from `src/public/css/style.css`):

- font stack: Inter, Helvetica Neue, Arial, sans-serif
- primary accent: green (`#1bb36b`)
- secondary accent: teal (`#0b5e6b`)
- page background: white
- borders: soft gray
- cards: rounded corners, light drop shadow
- layout: generous whitespace, clean editorial, not dense app chrome

---

## 5. Public Route Catalog

| Route | Page | Purpose | Status |
| --- | --- | --- | --- |
| `GET /` | Home | Public landing page | Current |
| `GET /events` | Events index | Browse upcoming events and archive entry points | Current |
| `GET /events/year/:year` | Events year archive | Browse completed events for one year | Current |
| `GET /events/:eventKey` | Event detail | Canonical public event page | Current |
| `GET /clubs` | Clubs landing | Placeholder public clubs entry page | Current stub |
| `GET /health/live` | Operational endpoint | Liveness check | Not a cataloged page |
| `GET /health/ready` | Operational endpoint | Readiness check | Not a cataloged page |

### Route rules

- `GET /` is the canonical public home route.
- `GET /events` is the canonical events section entry route.
- `GET /events/:eventKey` is the canonical public event detail route.
- `GET /clubs` is the canonical clubs section entry route for the current slice.
- health routes are operational and are outside the cataloged page system.

---

## 6. Page Specifications

## 6.1 Home

### Purpose

Provide the primary public entry point for the modernized site.

### Route

`GET /`

### Audience

Public visitor.

### Standard relationship

This page consumes the generic public rendering standard.

### Page intent

- welcome visitors to IFPA Footbag
- state clearly that public event data is live now
- signal that additional sections are coming
- provide direct navigation into Events
- establish Clubs as an expected section even while still lightweight

### Required content

- hero with site title and short welcome text
- clear statement about current platform scope
- direct links to Home, Events, and Clubs
- featured upcoming events teaser region
- link to browse all events
- clubs teaser / placeholder region
- optional coming-soon region for other future sections

### Required view-model fields

- `page.sectionKey = home`
- `page.pageKey = home_index`
- `page.title`
- optional `page.eyebrow`
- `page.intro`
- optional `page.notice`
- `featuredUpcomingEvents[]`
- `primaryLinks[]`
- optional `comingSoonSections[]`

### Navigation outputs

- `GET /events`
- `GET /events/:eventKey`
- `GET /clubs`

### Empty state

If there are no featured upcoming events, the page still renders normally with a standard empty state and retains the Events entry point.

---

## 6.2 Events index

### Purpose

Provide the primary public Events entry page by showing upcoming public events and links into completed-event archives.

### Route

`GET /events`

### Audience

Public visitor.

### Standard relationship

This page consumes the generic public rendering standard.

### Page intent

- show upcoming public events
- provide clear event drill-down links
- provide archive-year entry points for completed events

### Required content

- hero for the Events section
- upcoming events region — event cards use the standard event card primitive (§4.3)
- archive years region

### Required view-model fields

- `page.sectionKey = events`
- `page.pageKey = events_index`
- `page.title`
- optional `page.eyebrow`
- `page.intro`
- optional `page.notice`
- `upcomingEvents[]`
  - `eventKey`
  - `title`
  - `description`
  - `startDate`
  - `endDate`
  - `city`
  - `region`
  - `country`
  - `hostClub`
  - `registrationStatus`
  - `status`
- `archiveYears[]`

### Navigation outputs

- `GET /events/:eventKey`
- `GET /events/year/:year`

### Empty state

If no upcoming events exist, render a standard empty state. Archive-year links may still appear if completed-event years exist.

---

## 6.3 Events year archive

### Purpose

Provide a complete public archive page for completed events in one calendar year.

### Route

`GET /events/year/:year`

### Audience

Public visitor.

### Standard relationship

This page consumes the generic public rendering standard.

### Page intent

- show completed public events for one year
- provide drill-down links to canonical event pages
- preserve year-level browseability without pagination

### Required content

- hero showing the selected archive year
- year navigation using the standard year navigation primitive (§4.3)
- completed events list for that year — result sections per event use the standard result section primitive (§4.3)

### Required view-model fields

- `page.sectionKey = events`
- `page.pageKey = events_year_archive`
- `page.title`
- optional `page.eyebrow`
- `page.intro`
- optional `page.notice`
- `year`
- `previousYear` (nullable)
- `nextYear` (nullable)
- `archiveYears[]`
- `events[]`
  - `eventKey`
  - `title`
  - optional `description`
  - `startDate`
  - `endDate`
  - `city`
  - optional `region`
  - `country`
  - optional `hostClub`
  - `status`
  - `hasResults`
  - `resultSections[]` (same shape as §6.4; empty array when `hasResults` is false)
  - `noResultsMessage` (rendered when `hasResults` is false)

### Navigation outputs

- `GET /events`
- `GET /events/:eventKey`

### Empty state

If the requested year is valid but contains no public completed events, render a standard empty state.

---

## 6.4 Event detail

### Purpose

Provide the canonical public detail page for one event.

### Route

`GET /events/:eventKey`

### Audience

Public visitor.

### Standard relationship

This page consumes the generic public rendering standard.

### Page intent

- present the event identity, timing, location, and status clearly
- present the public event description and available public results sections
- act as the canonical drill-down destination from all public event browse pages

### Event visibility

Public canonical event pages exist only for events whose `status` is one of:
`published`, `registration_full`, `closed`, `completed`

Events with status `draft`, `pending_approval`, or `canceled` resolve through standard not-found behavior. No distinct error state is exposed for non-public events.

### Required content

- hero: event title; location and date range as subtitle
- meta row below hero: date range, location, host club when present, status badge; external URL button when present
- optional description region
- disciplines region: discipline tags ordered by `sortOrder` using the standard discipline tag primitive (§4.3); omitted cleanly when no disciplines exist
- results region: when `hasResults`, render one result section per entry in `resultSections[]` using the standard result section primitive (§4.3); when not, render a styled no-results notice

### Required view-model fields

- `page.sectionKey = events`
- `page.pageKey = event_detail`
- `page.title`
- optional `page.eyebrow`
- optional `page.intro`
- optional `page.notice`
- `event`
  - `eventKey`
  - `title`
  - optional `description`
  - `startDate`
  - `endDate`
  - `city`
  - optional `region`
  - `country`
  - optional `hostClub`
  - `status`
  - optional `registrationStatus`
  - optional `registrationDeadline`
  - optional `capacityLimit`
  - optional `externalUrl`
- `disciplines[]`
  - `disciplineId`
  - `name`
  - `disciplineCategory`
  - `teamType` (`singles` | `doubles` | `mixed_doubles`)
  - `teamTypeLabel` (`null` for singles; `"Doubles"` or `"Mixed Doubles"` for non-singles — computed by service; templates use this for display)
  - `sortOrder`
- `hasResults`
- `primarySection` (`details` when no results exist; `results` when results exist — affects emphasis only, not route shape)
- `resultSections[]`
  - optional `disciplineId`
  - optional `disciplineName`
  - optional `disciplineCategory`
  - optional `teamType`
  - `placements[]`
    - `placement`
    - optional `scoreText`
    - `participants[]`
      - `participantDisplayName`
      - `participantOrder`

### Canonical event identity rule

For the current slice, the public route key is `eventKey`.

Rules:

- `GET /events/:eventKey` is the canonical public detail route
- the public key format remains `event_{year}_{event_slug}` for the current slice
- validation and normalization happen in controller/service code, not templates
- the catalog does not authorize alternate public detail URL patterns

### Navigation outputs

- `GET /events`
- related public links already shaped into the page model

### Empty state

There is no empty state for a missing event. A valid missing-record path should resolve through the site’s standard not-found behavior.

---

## 6.5 Clubs landing placeholder

### Purpose

Establish Clubs as a first-class public section in the site structure even before the club directory is implemented.

### Route

`GET /clubs`

### Audience

Public visitor.

### Standard relationship

This page consumes the generic public rendering standard.

### Page intent

- establish Clubs as a durable public navigation destination
- communicate that richer club browsing is coming later
- provide a reusable placeholder pattern for future sections in early rollout states

### Required content

- hero for the Clubs section
- concise explanation that the club directory is coming soon
- optional placeholder cards or notice blocks for expected future browse paths

### Required view-model fields

- `page.sectionKey = clubs`
- `page.pageKey = clubs_index`
- `page.title`
- optional `page.eyebrow`
- `page.intro`
- optional `page.notice`
- optional `placeholderLinks[]`
- optional `comingSoonSections[]`

### Navigation outputs

- `GET /`
- `GET /events`

### Empty state

This page is itself a controlled placeholder state and should use the standard notice / coming-soon treatment rather than a generic empty state.

---

## 7. Shared Public Behavior Rules

### 7.1 Authorization boundary

All pages in this catalog are public visitor pages.

They must not expose:

- member-only data
- organizer-only controls
- admin controls
- internal diagnostics
- private participant history
- workflow actions outside the public browsing scope

### 7.2 Error behavior

Public pages must fail safely.

They must not expose:

- stack traces
- SQL errors
- internal implementation details

### 7.3 Template behavior

Templates may branch only on already-shaped display data such as booleans, empty lists, or presentation-ready sections. They must not parse route semantics, authorization rules, or domain logic.

---

## 8. Future Admission Rules

A future public page may join this catalog only if:

- it uses the same top-level page contract
- it uses the same reusable primitives
- it does not introduce a section-specific chrome system
- it can be rendered through the same reusable Handlebars and CSS approach

If a future page requires a new reusable primitive, add that primitive to the standard first, then apply it across all relevant pages.

---

## 9. Summary

This catalog establishes a single generic public look-and-feel standard and then catalogs the current pages that consume it.

The hierarchy is intentional:

1. define the standard
2. define the route catalog
3. define each page as a consumer of the standard

That is the governing structure for the public site going forward.
