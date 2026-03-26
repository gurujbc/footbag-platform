# Footbag Website Modernization Project -- View Catalog
**Last updated:** March 21, 2026
**Prepared by:** David Leberknight / [DavidLeberknight@gmail.com](mailto:DavidLeberknight@gmail.com)

---

## Table of Contents

- [1. Purpose](#1-purpose)
- [2. Scope](#2-scope)
- [3. Governing Principles](#3-governing-principles)
  - [3.1 One standard, many pages](#31-one-standard-many-pages)
  - [3.2 Reuse must be enforceable](#32-reuse-must-be-enforceable)
  - [3.3 Events are consumers, not the authority](#33-events-are-consumers-not-the-authority)
  - [3.4 Future pages must fit the standard](#34-future-pages-must-fit-the-standard)
  - [3.5 Home is a special composition-page exception](#35-home-is-a-special-composition-page-exception)
- [4. Public Rendering Standard](#4-public-rendering-standard)
  - [4.1 Standard purpose](#41-standard-purpose)
  - [4.2 Required page contract](#42-required-page-contract)
  - [4.3 Required reusable primitives](#43-required-reusable-primitives)
  - [4.4 Implementation rules](#44-implementation-rules)
  - [4.5 Visual rules](#45-visual-rules)
- [5. Public Route Catalog](#5-public-route-catalog)
- [6. Page Specifications](#6-page-specifications)
  - [6.1 Home](#61-home)
  - [6.2 Members section landing](#62-members-section-landing)
  - [6.3 Member detail](#63-member-detail)
  - [6.4 Events index](#64-events-index)
  - [6.5 Events year archive](#65-events-year-archive)
  - [6.6 Event detail](#66-event-detail)
  - [6.7 Clubs landing placeholder](#67-clubs-landing-placeholder)
  - [6.8 HoF landing](#68-hof-landing)
  - [6.9 Login](#69-login)
- [7. Shared Public Behavior Rules](#7-shared-public-behavior-rules)
  - [7.1 Authorization boundary](#71-authorization-boundary)
  - [7.2 Error behavior](#72-error-behavior)
  - [7.3 Template behavior](#73-template-behavior)
- [8. Future Admission Rules](#8-future-admission-rules)
- [9. Summary](#9-summary)

---

## 1. Purpose

**Current implementation status:** see `IMPLEMENTATION_PLAN.md`. This catalog defines the standard and page contracts; the plan governs what is implemented now vs deferred.

This document is the authoritative catalog for the public pages that are already implemented or actively specified in the current slice, and for the rendering standard those cataloged pages must follow.

It is intentionally partial. A view may still be part of the product because it is defined in `docs/USER_STORIES.md` even when it is not yet cataloged here.

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
  - Members section landing (auth-gated for now; Tier 1 historical-person data)
  - Member detail (auth-gated for now; Tier 1 historical-person data)
  - Login (member login preview stub)
  - HoF landing (placeholder; static/editorial content page)
- the rules future pages must follow to join the catalog

`docs/USER_STORIES.md` remains broader than this file. This catalog is authoritative for the views it includes; it does not attempt to catalog the full future product yet.

This document does not cover (yet):

- authenticated member-only pages and profiles (beyond the current Tier 1 historical-person surfaces)
- organizer workflows
- admin pages
- APIs
- full authentication flows (the current auth stub login page at `GET /login` is cataloged; full auth implementation is out of scope for the current slice)
- internal tools
- implementation details that belong in code patches rather than catalog definition
- media pages that remain out of scope for the current slice
- news pages that remain out of scope for the current slice
- tutorial pages that remain out of scope for the current slice

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

### 3.5 Home is a special composition-page exception

Home (`/`) is the one intentional exception to the page contract defined in §4.2. It still follows the reusable public frame, thin-controller rule, and service-owned shaping rule, but it is a landing-page composition view and does not follow the standard `seo / page / navigation / content` contract. The home controller currently composes directly from available services; a dedicated `HomeService` may be introduced later if warranted. All other cataloged pages must conform to §4.2.

---

## 4. Public Rendering Standard

### 4.1 Standard purpose

The public rendering standard defines the shared structure, page contract, and reusable UI primitives that every cataloged public page must use.

### 4.2 Required page contract

Every public page except Home (see §3.5) must render from the same top-level contract. This is a current implementation obligation, not aspirational — existing non-home pages must comply before new pages are added.

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
  - current public nav items: Home (`/`), Events (`/events`), Members (`/members`), Clubs (`/clubs`), HoF (`/hof`)
  - active section/page state
- `content`
  - page-specific regions already shaped for rendering

Templates must consume this contract rather than derive it.

### Browser tab title rule

The HTML `<title>` tag follows the pattern `Footbag {pageTitle}` for all pages. The sole exception is the home page (`/`), which renders as `Footbag Worldwide` (no suffix, no `pageTitle` passed).

`pageTitle` values by page:

| Page | `pageTitle` | Tab result |
|---|---|---|
| Home `/` | *(none)* | `Footbag Worldwide` |
| Events index | `Events` | `Footbag Events` |
| Events year archive | `{year} Events` | `Footbag 2024 Events` |
| Event detail | `event.standardTagDisplay` | `Footbag #event_{year}_{slug}` |
| Members index | `Members` | `Footbag Members` |
| Member detail | `{personName}` | `Footbag {name}` |
| Clubs | `Clubs` | `Footbag Clubs` |
| HoF | `Hall of Fame` | `Footbag Hall of Fame` |
| Login | `Login` | `Footbag Login` |
| Error pages | `Page Not Found` / `Service Unavailable` | `Footbag {error label}` |

New pages must follow this pattern. `pageTitle` is the short section or entity label only — never include the word "Footbag" in `pageTitle`.

### 4.3 Required reusable primitives

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
- One row per placement: `placement` number, participant entries ordered by `participantOrder` (stacked for `doubles` and `mixed_doubles`); each participant renders `participantDisplayName` and may optionally render `participantHref` when a linked historical member detail page exists; `scoreText` when present (cell is empty when absent — no placeholder text)
- Placements rendered in ascending `placement` order
- Template comments, loop prose, and debugging text must never appear in rendered HTML output

### Handlebars helpers

Two registered helpers are part of the rendering standard and must be used consistently across all templates:

- `formatDate` — formats an ISO date string (`YYYY-MM-DD`) as `D Month YYYY` (e.g. "29 July 2024"). All templates must use this helper for displayed dates. Raw ISO date strings must never appear in rendered output.
- `yearFromDate` — extracts the 4-digit year string from an ISO date string. Use when a year value is needed for linking, e.g. `{{yearFromDate event.startDate}}` to build a `/events/year/{year}` href.
- Same-day events: suppress the end date when `startDate === endDate` using `{{#unless (eq startDate endDate)}}`. This rule applies to all date range displays across all templates.

### Year navigation

Used in year archive. Renders previous-year and next-year links when adjacent years with completed public events exist. When no adjacent year exists, a disabled placeholder renders instead. The nav sits **below the hero inside the wrapper**, not inside the hero. Uses `.year-page-nav`, `.hero-year-arrow`, and `.hero-year-arrow--disabled`.

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
- Hero: `.hero` (base, 72px padding), `.hero-sm` (36px padding — use on all pages; `.hero` without `.hero-sm` is reserved for future large-format hero use only)
- Sections: `.section-heading`, `.section-count`
- Cards: `.card-grid`, `.card`, `.card-title`, `.card-meta`, `.card-description`
- Badges: `.badge`, `.badge-published`, `.badge-registration_full`, `.badge-closed`, `.badge-completed`
- Buttons: `.btn`, `.btn-primary`, `.btn-outline`
- States: `.empty-state`

**Events section — required within events pages only:**

- Archive years: `.year-grid`, `.year-pill`
- Year page navigation: `.year-page-nav`, `.hero-year-arrow`, `.hero-year-arrow--disabled`
- Year archive event list: `.event-list`, `.event-list-row`, `.event-list-main`, `.event-list-title`, `.event-list-host`, `.event-list-meta`, `.event-list-date`, `.event-list-location`
- Event detail layout: `.event-detail`, `.event-header`, `.event-meta-row`, `.event-external-link`
- Disciplines: `.disciplines-list`, `.discipline-tag`
- Results: `.results-section`, `.results-section-header`, `.discipline-meta`, `.results-table`, `.placement-num`, `.participants-list`, `.score-text`, `.no-results-notice`

### 4.4 Implementation rules

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

### 4.5 Visual rules

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
| `GET /members` | Members section | Tier 1 public historical-person index | Current |
| `GET /members/:personId` | Member detail | Tier 1 public historical-person detail | Current |
| `GET /clubs` | Clubs landing | Placeholder public clubs entry page | Current stub |
| `GET /login` | Login | Member login preview; functional stub for members with preview password | Current |
| `GET /hof` | HoF landing | Footbag Hall of Fame editorial/informational landing page | Current stub |
| `GET /health/live` | Operational endpoint | Liveness check | Not a cataloged page |
| `GET /health/ready` | Operational endpoint | Readiness check | Not a cataloged page |

### Route rules

- `GET /` is the canonical public home route.
- `GET /events` is the canonical events section entry route.
- `GET /events/:eventKey` is the canonical public event detail route.
- `GET /members` is the canonical Members section entry route. Serves a Tier 1 public historical-person index.
- `GET /members/:personId` is the canonical historical-person detail route for the current slice. Route will evolve as the Members section grows to serve authenticated member profiles.
- `GET /clubs` is the canonical clubs section entry route for the current slice.
- `GET /login` is the member login route. `POST /login` and `POST /logout` are form-action handlers, not cataloged pages.
- `GET /hof` is the canonical HoF section entry route.
- health routes are operational and are outside the cataloged page system.

---

## 6. Page Specifications

### 6.1 Home

### Purpose

Provide the primary public entry point for the modernized site.

### Route

`GET /`

### Audience

Public visitor.

### Standard relationship

This page consumes the generic public rendering standard.

It is also the one intentional Home-page exception: a landing-page composition view rather than a generic list/detail consumer. It does not follow the §4.2 page contract. A dedicated `HomeService` may be introduced later if warranted.

### Page intent

- welcome visitors to IFPA Footbag
- state clearly that public event data is live now
- signal that additional sections are coming
- provide direct navigation into Events
- establish Clubs as an expected section even while still lightweight

### Required content

- hero with site title and short welcome text
- clear statement about current platform scope
- direct links to Home, Events, Members, and Clubs
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
- `GET /members`
- `GET /clubs`

### Empty state

If there are no featured upcoming events, the page still renders normally with a standard empty state and retains the Events entry point.

---

### 6.2 Members section landing

### Purpose

Provide the Members section entry page. Serves a Tier 1 public historical-person index for competitive footbag players. The section will grow to full authenticated member features.

### Route

`GET /members`

### Audience

Public visitor. (Temporarily auth-gated — see IMPLEMENTATION_PLAN.md accepted deviations.)

### Standard relationship

This page consumes the generic public rendering standard and the §4.2 page contract.

### Page intent

- present the public historical competitive record index for footbag players
- make clear this is the Members section and that member accounts and login are part of this section
- avoid implying historical imported people are current-member accounts or publicly searchable/contactable members

### Required content

- hero for the Members section
- public historical-record listing (players with imported event data)
- optional explanatory text clarifying that historical records and current member accounts are distinct

### Required view-model fields

- `page.sectionKey = members`
- `page.pageKey = members_index`
- `page.title`
- optional `page.eyebrow`
- `page.intro`
- optional `page.notice`
- optional `primaryLinks[]`

### Navigation outputs

- `GET /members/:personId` (only when linking to a known historical member detail target)

### Empty state

This page does not require data-backed list content and should still render normally when no additional member functionality is available yet.

---

### 6.3 Member detail

### Purpose

Provide the member detail page. Current slice shows a minimal public read-only page for one imported historical person. Future slices will add authenticated member profile content at this route as the Members section matures.

### Route

`GET /members/:personId`

### Audience

Public visitor. (Temporarily auth-gated — see IMPLEMENTATION_PLAN.md accepted deviations.)

### Standard relationship

This page consumes the generic public rendering standard and the §4.2 page contract. It is a Tier 1 public historical read page. It must not imply current-member capabilities, profile ownership, member-search inclusion, or club-roster visibility for historical-only persons.

### Page intent

- present the imported historical person's competitive record clearly
- support result-participant linking from public event pages when a historical person is known
- preserve historical accuracy
- for historical-only persons: must not imply current-member account, public discoverability, or contactability

### Required content

- hero with the historical person's display name
- minimal identity/facts region using only data available from imported historical records
- optional historical-results or related-links region when present
- optional notice clarifying that historical imported people may not be current Members

### Required view-model fields

- `page.sectionKey = members`
- `page.pageKey = member_history_detail`
- `page.title`
- optional `page.eyebrow`
- optional `page.intro`
- optional `page.notice`
- `personId`
- `displayName`
- optional `summaryFacts[]`
- optional `relatedResultLinks[]`

### Navigation outputs

- `GET /events/:eventKey`
- `GET /events/year/:year`
- `GET /members`

### Empty state

Unknown or non-public historical identities resolve through standard not-found behavior rather than a custom empty state.

---

### 6.4 Events index

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

### 6.5 Events year archive

### Purpose

Provide a complete public archive page for completed events in one calendar year.

### Route

`GET /events/year/:year`

### Audience

Public visitor.

### Standard relationship

This page consumes the generic public rendering standard.

### Page intent

- show completed public events for one year as a clean scannable list
- provide drill-down links to canonical event pages
- preserve year-level browseability without pagination

### Required content

- hero showing "Footbag Events from {year}"
- year navigation (previous/next) using the standard year navigation primitive (§4.3), positioned below the hero
- completed events list for that year — one row per event using the `.event-list` primitive; each row renders title (linked to canonical event route), formatted date range (via `formatDate`; same-day events show one date only), and location
- no inline results on this page; results are accessed via the canonical event detail route
- a note below the archive year pills on the events index page that pre-1997 data is incomplete and more historical results are coming

### Data constraints

- years before 1997 are excluded from `archiveYears[]` and from the year navigation
- direct navigation to a pre-1997 year URL returns a standard 404

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

### Navigation outputs

- `GET /events`
- `GET /events/:eventKey`

### Empty state

If the requested year is valid but contains no public completed events, render a standard empty state.

---

### 6.6 Event detail

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
      - optional `participantHref` — present only when the participant resolves to a historical-person-backed read-only detail target; omit otherwise and render plain text

### Canonical event identity rule

For the current slice, the public route key is `eventKey`.

Rules:

- `GET /events/:eventKey` is the canonical public detail route
- the public key format is exactly `event_{year}_{event_slug}` for the current slice
- exactness is underscore-based; the catalog does not authorize hyphen/underscore rewrites, aliasing, or fuzzy matching
- route validation belongs in controller/service code, not templates
- the catalog does not authorize alternate public detail URL patterns

### Navigation outputs

- `GET /events/year/:year` — "More events from {year}" button (`.btn.btn-outline`) at the bottom of the page, using `yearFromDate` on `event.startDate`
- related public links already shaped into the page model

### Empty state

There is no empty state for a missing event. A valid missing-record path should resolve through the site’s standard not-found behavior.

---

### 6.7 Clubs landing placeholder

### Purpose

Establish Clubs as a first-class public section in the site structure even before the club directory is implemented. This is a drafted next-level placeholder contract in the current slice, not the full future clubs-directory contract.

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

### 6.8 HoF landing

### Purpose

Provide the public Footbag Hall of Fame informational landing page. For the current slice this is a static/editorial content page; it will eventually display About-Us-style text sourced from footbaghalloffame.net.

### Route

`GET /hof`

### Audience

Public visitor.

### Standard relationship

This page consumes the generic public rendering standard and the §4.2 page contract.

### Page intent

- establish the Footbag Hall of Fame as a first-class section in the site navigation
- communicate that richer HoF content is coming
- provide a view model shaped to accept rich editorial sections once content is ready

### Required content

- hero for the HoF section
- placeholder notice that full HoF content is coming
- optional editorial content sections when content is available (heading + body per section)

### Required view-model fields

- `page.sectionKey = hof`
- `page.pageKey = hof_index`
- `page.title`
- optional `page.eyebrow`
- `page.intro`
- optional `page.notice`
- optional `content.sections[]`
  - `heading`
  - `body`

### Navigation outputs

- `GET /`
- `GET /events`

### Empty state

This page is itself a controlled placeholder state for the current slice and should use the standard notice / coming-soon treatment rather than a generic empty state.

### Implementation notes

- No DB queries required for the current slice; service shapes static page model only.
- `extend-service-contract` skill is not needed. Use `add-public-page` directly.
- Content sections are intentionally empty until the About-Us text is sourced and loaded.

---

### 6.9 Login

### Purpose

Provide the public member login page. For the current slice this is a functional preview stub for members who are in the loop; full authentication is a future implementation.

### Route

`GET /login`

### Audience

Public visitor (specifically: members aware of the preview).

### Standard relationship

This page consumes the generic public rendering standard and the §4.2 page contract.

### Page intent

- establish member login as a first-class section of the site
- make clear this is an early preview, not a finished feature
- allow members who have the preview password to try it out

### Required content

- hero: "Member Login" title with a brief subtitle establishing context
- a work-in-progress notice explaining this is an early preview for members who have the preview password
- a login form with username and password fields
- inline error display when authentication fails

### Required view-model fields

- `page.sectionKey` — none (login is not a primary nav section)
- `page.pageKey = login`
- `page.title = Login`
- optional `error` — rendered inline above the form when authentication fails

### Navigation outputs

- `GET /members` — on successful authentication

### Empty state

Not applicable. The form always renders.

### Implementation notes

- `POST /login` and `POST /logout` are form-action handlers, not cataloged pages.
- The current implementation is an auth stub. Full member authentication is out of scope for the current slice.
- WIP notices and stub behaviors in this page are intentional and must not be removed without a corresponding slice promotion.

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
