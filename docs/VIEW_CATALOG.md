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
  - [6.7 Clubs index](#67-clubs-index)
  - [6.8 Clubs country page](#68-clubs-country-page)
  - [6.9 Club detail](#69-club-detail)
  - [6.10 HoF landing](#610-hof-landing)
  - [6.11 Login](#611-login)
- [7. Shared Public Behavior Rules](#7-shared-public-behavior-rules)
  - [7.1 Authorization boundary](#71-authorization-boundary)
  - [7.2 Error behavior](#72-error-behavior)
  - [7.3 Template behavior](#73-template-behavior)
- [8. Future Admission Rules](#8-future-admission-rules)
- [9. Summary](#9-summary)

---

## 1. Purpose

**Current implementation status:** see `IMPLEMENTATION_PLAN.md`. This catalog defines the long-lived rendering standard and page contracts. The plan governs what is implemented now versus deferred, and it also governs accepted temporary deviations where the current slice intentionally differs from the target catalog. Contributors and AI assistants must not silently flatten disagreements between this catalog, `IMPLEMENTATION_PLAN.md`, and the code.

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
  - Clubs section — live with real club data, SVG world map (JS-enhanced, degrades gracefully, hidden on mobile ≤768px), country and club detail pages
  - Historical players index (auth-gated; `/history`)
  - Historical player detail (auth-gated; `/history/:personId`)
  - Login (DB-backed member authentication)
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

Home (`/`) is the one intentional composition-page exception. It is not required to use the standard `seo / page / navigation / content` contract, but it must still use the shared site layout, shared visual tokens, shared section identity, thin-controller discipline, and service-owned shaping.

Home may introduce richer editorial composition and optional media/interactivity regions such as hero media, inline video, motion treatments, or other page-specific JavaScript enhancements. These enhancements must remain within the same Express + Handlebars + vanilla TypeScript architecture and must not introduce a separate front-end stack, template-owned routing logic, or a home-only chrome system.

Any permanent change to navigation structure or global shell belongs in the shared layout and design system, not in the Home template alone.

---

## 4. Public Rendering Standard

### 4.1 Standard purpose

The public rendering standard defines the shared structure, page contract, and reusable UI primitives that every cataloged public page must use.

### 4.2 Required page contract

Every public page except Home (see §3.5) must render from the same top-level contract. This is a current implementation obligation, not aspirational — existing non-home pages must comply before new pages are added.

### Required top-level shape

- `seo`
  - `title` — tab suffix (e.g. `"Events"`, `"2025 Events"`, `"Alice Footbag"`); the layout renders `Footbag {seo.title}` in the `<title>` tag; never include the word "Footbag" in this value
  - optional `description` — meta description for future SEO use
- `page`
  - `sectionKey` — nav section identifier (`'events'`, `'members'`, `'clubs'`, `'hof'`, or `''` for login/error pages)
  - `pageKey` — unique page identifier (`'events_index'`, `'event_detail'`, `'member_history_detail'`, etc.)
  - `title` — displayed h1 text
  - optional `eyebrow` — small label rendered above h1
  - optional `intro` — subtitle paragraph rendered below h1
  - optional `notice` — WIP or caveat notice block
- `navigation` — contextual navigation; service-provided and distinct from middleware locals
  - Middleware provides `currentSection` (drives active nav link) and `isAuthenticated` (drives login/logout display) via `res.locals` on every request; these are not part of the service contract
  - Services provide an optional `navigation` object for page-specific nav context that middleware cannot infer:
  - optional `breadcrumbs` — `{ label: string; href?: string }[]`; last entry is the current page (no `href`); used for hierarchical pages (clubs, deep member pages); omitted on flat pages
  - optional `siblings` — `{ previous?: { label: string; href: string }; next?: { label: string; href: string } }`; sequential browsing (year archive prev/next); omitted on pages with no sequential relationship
  - optional `contextLinks` — `{ label: string; href: string; variant?: 'primary' | 'outline' }[]`; page-scoped related actions (back to members, more events from year); templates place these explicitly — the layout does not render them automatically
- `content`
  - page-specific regions, always nested under this key
  - services compute all hrefs (e.g. `participantHref`, `eventHref`, `memberHref`) — templates never construct URLs
  - services compute domain-derived display labels (e.g. `teamTypeLabel`) and boolean display flags (e.g. `hasResults`)
  - services compute `summaryFacts[]` for entity metadata regions
  - templates use registered helpers (`formatDate`, `countryFlag`) for presentation formatting only
  - templates iterate typed arrays for structured content (results, event groups, discipline lists)

Templates must consume this contract rather than derive it.

### Browser tab title rule

The HTML `<title>` tag follows the pattern `Footbag {seo.title}` for all pages. The sole exception is the home page (`/`), which renders as `Footbag Worldwide` (no suffix, no `seo` contract applies). The layout accesses `seo.title` directly from the view model.

`seo.title` values by page:

| Page | `seo.title` | Tab result |
|---|---|---|
| Home `/` | *(none — home is exempt)* | `Footbag Worldwide` |
| Events index | `Events` | `Footbag Events` |
| Events year archive | `{year} Events` | `Footbag 2024 Events` |
| Event detail | `event.standardTagDisplay` | `Footbag #event_{year}_{slug}` |
| Members index | `Members` | `Footbag Members` |
| Member detail | `{personName}` | `Footbag {name}` |
| Clubs index | `Clubs` | `Footbag Clubs` |
| Clubs country | `"{country} Clubs"` | `Footbag New Zealand Clubs` |
| Club detail | `club.standardTagDisplay` | `Footbag #club_wellington_hack_crew` |
| HoF | `Hall of Fame` | `Footbag Hall of Fame` |
| Login | `Login` | `Footbag Login` |
| Error pages | `Page Not Found` / `Service Unavailable` | `Footbag {error label}` |

New pages must follow this pattern. `seo.title` is the short section or entity label only — never include the word "Footbag" in it. Note that `page.title` is the full displayed h1 text (e.g. `"Footbag Events"`, `"Member Login"`) and is distinct from `seo.title`.

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

Used in event detail. One section per discipline grouping.

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

**Clubs section — required within clubs pages only:**

- Country nav: `.club-country-nav`, `.club-country-nav-list`, `.club-country-count`
- Country sections: `.club-section`, `.club-region-heading`
- Club list: `.club-list`, `.club-entry`, `.club-name`, `.club-location`, `.club-hashtag`, `.club-external-link`
- Club detail: `.club-detail`, `.club-detail-meta`, `.club-detail-description`

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
| `GET /clubs` | Clubs index | Country-grouped clubs directory entry page | Current |
| `GET /clubs/:countrySlug` | Clubs country page | All clubs in one country, grouped by state/province | Current |
| `GET /clubs/club_:clubKey` | Club detail | Canonical public club page | Current |
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
- `GET /clubs` is the canonical clubs section entry route.
- `GET /clubs/:slug` is the shared Express handler for both the country page and the club detail page. The controller dispatches by prefix: a slug beginning with `club_` routes to the club detail handler; any other slug routes to the country page handler. No club tag may produce a `clubKey` that is also a valid `countrySlug` — the seed script enforces this collision constraint at data-load time.
- `GET /clubs/club_:clubKey` is the canonical public club detail route. `clubKey` is `tag_normalized` with the leading `#` stripped (e.g. `club_wellington_hack_crew`). Pattern: `^club_[a-z0-9_]+$`.
- `GET /login` is the member login route. `POST /login` and `POST /logout` are form-action handlers, not cataloged pages.
- `GET /hof` is the canonical HoF section entry route.
- health routes are operational and are outside the cataloged page system.

---

## 6. Page Specifications

### 6.1 Home

### Purpose

Provide the primary public entry point for the modernized site. Home is a richer landing-page composition surface that introduces the platform, highlights live public data, and routes visitors into the main sections.

### Route

`GET /`

### Audience

Public visitor.

### Standard relationship

This page consumes the generic public rendering standard's shared frame, shared visual language, and reusable primitives where practical, but it is the one intentional composition-page exception and does not use the §4.2 generic page contract.

### Page intent

- welcome visitors to IFPA Footbag
- establish the site's overall look and feel
- provide strong entry points into Events, Members, and Clubs
- support richer editorial/media presentation than ordinary list/detail pages
- remain compatible with future designer-led landing-page enhancements without requiring a new front-end architecture

### Required content

- hero with site title and short welcome text
- primary navigation cards/links into the major sections
- optional featured upcoming events teaser region
- optional editorial or media regions
- optional coming-soon / future-sections region

### Required view-model fields

- `page.sectionKey = home`
- `page.pageKey = home_index`
- `page.title`
- optional `page.eyebrow`
- `page.intro`
- optional `page.notice`
- `hero`
  - `heading`
  - optional `subheading`
  - optional `media`
    - `kind: 'image' | 'video' | 'youtube'`
    - `src`
    - optional `alt`
    - optional `posterSrc`
    - optional `caption`
- `primaryLinks[]`
  - `label`
  - `href`
  - `description`
  - optional `variant`
- optional `featuredUpcomingEvents[]`
- optional `featurePanels[]`
  - `heading`
  - `body`
  - optional `href`
  - optional `ctaLabel`
- optional `comingSoonSections[]`

### Navigation outputs

- `GET /events`
- `GET /members`
- `GET /clubs`

### Empty state

Home still renders normally when optional featured/media regions are absent.

---

### 6.2 Historical players index

### Purpose

Provide the historical-person index for competitive footbag players. Lists all imported historical persons with competitive records.

### Route

`GET /history`

### Audience

Authenticated member. Auth enforced at controller level (not route middleware). Unauthenticated visitors are redirected to `/login?returnTo=/history`.

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

- `seo.title = Members`
- `page.sectionKey = members`
- `page.pageKey = members_index`
- `page.title`
- optional `page.eyebrow`
- `page.intro`
- optional `page.notice`
- `content.memberCount` — total count of listed members
- `content.countryCount` — count of distinct non-global countries represented
- `content.members[]`
  - `personId`
  - `personName`
  - `memberHref` — service-computed; `'/members/{slug}'` when a linked member account exists, otherwise `'/history/{personId}'`; templates must not construct this URL
  - optional `country`
  - optional `eventCount`
  - optional `placementCount`
  - `bapMember: boolean`
  - `fbhofMember: boolean`

### Navigation outputs

No service-provided navigation outputs. Member detail links are part of `content.members[].memberHref`, not the `navigation` object. Global nav (`currentSection`) is set by middleware.

### Empty state

This page does not require data-backed list content and should still render normally when no additional member functionality is available yet.

### Implementation notes

- The page currently includes an authenticated full historical-record table with client-side filter/sort. This is a review and bootstrapping surface, not the final public design.

---

### 6.3 Historical player detail

### Purpose

Provide the detail page for one imported historical person's competitive record.

### Route

`GET /history/:personId`

### Audience

Public for HoF and BAP persons. Auth required otherwise. Auth enforced at controller level: the controller loads the person, checks honor flags, and redirects unauthenticated visitors to `/login?returnTo=/history/{personId}` for non-honored persons.

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
- `page.title` — the person's display name (plain text, for h1 and tab title)
- optional `page.eyebrow` — e.g. `"Historical member record"`
- optional `page.intro`
- optional `page.notice`
- `navigation.contextLinks` — typed back link to `GET /history` (service-computed)
- `content.personId`
- `content.displayName` — the person's display name
- optional `content.honorificNickname` — BAP nickname when present; rendered in a styled span alongside `displayName` in the h1
- `content.summaryFacts` — `{ label: string; value: string }[]`; service-computed list of key facts (country, BAP induction year, HoF induction year, etc.); includes only facts with values; empty array when none apply
- `content.eventGroups` — `{ eventKey, eventHref, eventTitle, startDate, city, eventCountry, results[] }[]`; service computes `eventHref` as `"/events/{eventKey}"`; each result entry includes `disciplineName`, `disciplineCategory`, `teamType`, `placement`, `scoreText`, and `teammates: { name, memberHref? }[]` where `memberHref` is service-computed as `"/history/{personId}"` when a historical person link exists

### Navigation outputs

- `GET /events/:eventKey` (via `content.eventGroups[].eventHref`)
- `GET /events/year/:year`
- `GET /history` (via `navigation.contextLinks`)

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
- optional featured promo region for intentionally highlighted event content
- upcoming events region — event cards use the standard event card primitive (§4.3)
- archive years region

### Required view-model fields

- `seo.title = Events`
- `page.sectionKey = events`
- `page.pageKey = events_index`
- `page.title` — e.g. `"Footbag Events"`
- optional `page.eyebrow`
- `page.intro`
- optional `page.notice`
- optional `content.featuredPromo`
  - `title`
  - `href`
  - `ctaLabel`
  - optional `description`
  - `startDate`
  - `endDate`
  - `city`
  - optional `region`
  - `country`
  - optional `external: boolean`
- `content.upcomingEvents[]`
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
- `content.archiveYears[]`

`registrationStatus` is part of the display contract. Templates should render it when present and should not invent fallback wording when it is absent or empty.

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

- years before 1997 are excluded from year navigation
- direct navigation to a pre-1997 year URL returns a standard 404

### Required view-model fields

- `seo.title` — e.g. `"{year} Events"`
- `page.sectionKey = events`
- `page.pageKey = events_year_archive`
- `page.title` — e.g. `"Footbag Events from {year}"`
- optional `page.eyebrow`
- optional `page.intro`
- optional `page.notice`
- optional `navigation.siblings.previous: { label, href }` — service-computed; present when a previous archive year exists; omitted otherwise
- optional `navigation.siblings.next: { label, href }` — service-computed; present when a next archive year exists; omitted otherwise
- `content.year`
- `content.events[]`
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
  - `hasResults` — may be used for a visual indicator; results are not rendered inline on this page

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

- `seo.title = event.standardTagDisplay` — the event's canonical display tag (e.g. `"World Championships 2024"`)
- `page.sectionKey = events`
- `page.pageKey = event_detail`
- `page.title`
- optional `page.eyebrow`
- optional `page.intro`
- optional `page.notice`
- `navigation.contextLinks[]` — service-provided; one entry: `{ label: "More events from {year}", href: "/events/year/{year}" }` where year is derived from `event.startDate`
- `content.event`
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
- `content.disciplines[]`
  - `disciplineId`
  - `name`
  - `disciplineCategory`
  - `teamType` (`singles` | `doubles` | `mixed_doubles`)
  - `teamTypeLabel` (`null` for singles; `"Doubles"` or `"Mixed Doubles"` for non-singles — computed by service; templates use this for display)
  - `sortOrder`
- `content.hasResults`
- `content.primarySection` (`details` when no results exist; `results` when results exist — affects emphasis only, not route shape)
- `content.resultSections[]`
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

`navigation.contextLinks` is the sole navigation output for this page. The "More events from {year}" link is included as the single entry (see Required view-model fields above). Templates render contextLinks as a button (`.btn.btn-outline`) at the bottom of the page. No other navigation outputs are produced.

### Empty state

There is no empty state for a missing event. A valid missing-record path should resolve through the site’s standard not-found behavior.

---

### 6.7 Clubs index

### Purpose

Provide the primary public Clubs entry page showing all countries that have at least one active club, with counts and drill-down links.

### Route

`GET /clubs`

### Audience

Public visitor.

### Standard relationship

This page consumes the generic public rendering standard and the §4.2 page contract.

### Page intent

- introduce the Clubs section as a first-class public destination
- show all countries with active clubs as a scannable list with counts
- provide drill-down links to each country's club page
- expose total club and country counts in the hero

### Required content

- hero with title, intro, and stat counts (total clubs, total countries)
- SVG world map: JS-enhanced; active-club countries highlighted; tooltip on hover; click drills to country page; requires JS to render and is hidden on mobile (≤768px); degrades to the country list when JS is absent or the fetch fails
- country list: one entry per country with country flag, name, count, and link to country page

### Required view-model fields

- `seo.title = Clubs`
- `page.sectionKey = clubs`
- `page.pageKey = clubs_index`
- `page.title`
- `page.intro`
- `content.totalClubs`
- `content.totalCountries`
- `content.countries[]`
  - `country` — full country name
  - `countryCode` — ISO 3166-1 alpha-2 code; service-computed; used for SVG map path matching
  - `countrySlug` — slugified country name; service-computed; used in `countryHref`
  - `countryHref` — service-computed; `/clubs/{countrySlug}`
  - `total` — count of active clubs in this country
- `content.mapDataJson` — JSON string; serialized array of `{ code, slug, name, total }` per country; injected into `window.__CLUBS_MAP_DATA__` for the client-side map script

### Navigation outputs

- `GET /clubs/:countrySlug` (via `content.countries[].countryHref`)

### Empty state

Render standard empty state if no clubs are active.

---

### 6.8 Clubs country page

### Purpose

Show all active clubs in one country, grouped by state or province when applicable, with anchor-linked section navigation for countries with many clubs.

### Route

`GET /clubs/:countrySlug`

### Audience

Public visitor.

### Standard relationship

This page consumes the generic public rendering standard and the §4.2 page contract.

### Page intent

- present all clubs in the selected country
- group by state/province for countries with regional data (USA, Canada, etc.)
- bake in region anchor IDs and `data-club-id` attributes on club entries for future map integration
- optional coming-soon map notice (to be replaced by an interactive state/province map in a future slice — clicking a state on the map will anchor-jump to that region's section)

### Required content

- hero with country name and club count
- anchor nav to state/province sections when two or more named regions exist
- club list grouped by region; unnamed-region clubs appear last under no heading
- each entry: club name (linked to club detail), city, hashtag, external URL when present
- each region section must carry `id="region-{regionSlug}"` for future map anchor targeting
- each club entry must carry `data-club-id="{clubId}"` for future map pin linking

### Required view-model fields

- `seo.title = "{country} Clubs"` — full country name (e.g. `"New Zealand Clubs"` → tab `Footbag New Zealand Clubs`)
- `page.sectionKey = clubs`
- `page.pageKey = clubs_country`
- `page.title` — e.g. `"Clubs in New Zealand"`
- `navigation.breadcrumbs` — `[{ label: 'Clubs', href: '/clubs' }, { label: country }]`
- `content.country` — full country name
- `content.countrySlug`
- `content.total` — count of clubs on this page
- `content.hasMultipleRegions` — boolean; true only when all clubs have a named region and 2+ distinct named regions exist; controls anchor nav and region heading rendering
- `content.regions[]`
  - optional `region` — state/province name; `null` for clubs with no region
  - optional `regionSlug` — slugified region name; service-computed; used as anchor target `region-{regionSlug}`
  - `clubs[]`
    - `clubId`
    - `clubKey` — service-computed; `tag_normalized.slice(1)`; used in `clubHref`
    - `clubHref` — service-computed; `/clubs/{clubKey}`
    - `name`
    - `city`
    - optional `externalUrl`
    - `standardTagDisplay`

### Navigation outputs

- `GET /clubs` (via `navigation.breadcrumbs`)
- `GET /clubs/club_:clubKey` (via `content.regions[].clubs[].clubHref`)

### Empty state

Unknown country slug returns standard 404. A valid country with zero active clubs renders a standard empty state.

---

### 6.9 Club detail

### Purpose

Provide the canonical public page for one club.

### Route

`GET /clubs/club_:clubKey`

### Audience

Public visitor.

### Standard relationship

This page consumes the generic public rendering standard and the §4.2 page contract.

### Page intent

- present the club's identity, location, and contact/web information
- act as the canonical drill-down destination from the country page
- support future map and membership features via stable `club_:clubKey` URLs

### Canonical club identity rule

- `clubKey` = `tag_normalized` with the leading `#` stripped: `club_wellington_hack_crew`
- Pattern: `^club_[a-z0-9_]+$`
- Controller dispatch: `slug.startsWith('club_')` → club detail; otherwise → country page
- No aliasing, hyphen rewrites, or fuzzy matching

### Required content

- hero with club name
- meta: city, region (when present), country, hashtag, external URL when present
- optional description when non-empty

### Required view-model fields

- `seo.title = club.standardTagDisplay`
- `page.sectionKey = clubs`
- `page.pageKey = clubs_detail`
- `page.title` — club name
- `navigation.breadcrumbs` — `[{ label: 'Clubs', href: '/clubs' }, { label: country, href: '/clubs/{countrySlug}' }, { label: clubName }]`
- `navigation.contextLinks` — `[{ label: "All clubs in {country}", href: "/clubs/{countrySlug}" }]`; service-computed; renders as a back-link button at the bottom of the page
- `content.club`
  - `clubId`
  - `clubKey`
  - `name`
  - optional `description`
  - `city`
  - optional `region`
  - `country`
  - `countrySlug` — service-computed; used in breadcrumb href
  - optional `externalUrl`
  - `standardTagNormalized`
  - `standardTagDisplay`

### Navigation outputs

- `GET /clubs` (via breadcrumbs)
- `GET /clubs/:countrySlug` (via breadcrumbs)

### Empty state

Unknown or inactive club key returns standard 404.

---

### 6.10 HoF landing

### Purpose

Provide the public Footbag Hall of Fame landing page as a first-class route in the main site. In the current slice this is a service-shaped editorial landing page that links to the existing standalone HoF site. Future inductee pages, member-linked HoF records, and richer HoF history remain future scope.

### Route

`GET /hof`

### Audience

Public visitor.

### Standard relationship

This page consumes the generic public rendering standard and the §4.2 page contract.

### Page intent

- establish the Footbag Hall of Fame as a first-class section in the site navigation
- provide a credible current landing page now
- link visitors to the existing standalone HoF site
- leave a clean expansion path for future HoF detail/history pages inside footbag.org

### Required content

- hero for the HoF section
- external call-to-action to the current standalone HoF site
- optional editorial sections when local content is available

### Required view-model fields

- `seo.title = Hall of Fame`
- `page.sectionKey = hof`
- `page.pageKey = hof_index`
- `page.title`
- optional `page.eyebrow`
- `page.intro`
- optional `page.notice`
- optional `content.externalLink`
  - `href`
  - `label`
- optional `content.sections[]`
  - `heading`
  - `paragraphs: string[]`

### Navigation outputs

No service-provided navigation outputs. Global nav (`currentSection`) is set by middleware.

### Empty state

This page has editorial content in the current slice and does not use a generic empty-state treatment.

### Implementation notes

- No DB queries required for the current slice; service shapes the page model directly.
- Templates must not construct the standalone HoF URL.
- Future HoF inductee/member/history routes are intentionally out of scope here and will be cataloged separately when implemented.

---

### 6.11 Login

### Purpose

Provide the public member login page with DB-backed authentication.

### Route

`GET /login`

### Audience

Public visitor.

### Standard relationship

This page consumes the generic public rendering standard and the §4.2 page contract.

### Page intent

- establish member login as a first-class section of the site
- allow registered members to authenticate
- when a visitor arrives via `requireAuth` redirect, explain why login is required

### Required content

- hero: "Member Login" title with a brief subtitle establishing context
- optional auth-reason notice when the visitor was redirected from a protected page
- a login form with email and password fields
- inline error display when authentication fails
- link to registration page

### Required view-model fields

- `seo.title = Login`
- `page.sectionKey` — none (login is not a primary nav section)
- `page.pageKey = login`
- `page.title = Member Login` — displayed h1; `seo.title` is the shorter tab suffix
- optional `content.error` — rendered inline above the form when authentication fails
- optional `content.authReason` — informational notice shown when the visitor was redirected from a protected page (present when `returnTo` query param exists)
- optional `content.returnTo: string` — the path to redirect to after successful login; read by the controller from the `?returnTo` query parameter; must be validated as a relative same-site path (starts with `/`, not `//` or `http`) before use — invalid or absent values fall back to `/members/{memberSlug}`; rendered as a hidden form field so the destination survives the `POST /login` submission

### Navigation outputs

No service-provided navigation outputs. When `requireAuth` intercepts an unauthenticated request, it redirects to `/login?returnTo=<originalUrl>`. On successful `POST /login`, the controller redirects to `content.returnTo` (the validated return path) when present; otherwise falls back to `GET /members/{memberSlug}`.

### Empty state

Not applicable. The form always renders.

### Implementation notes

- `POST /login` and `POST /logout` are form-action handlers, not cataloged pages.
- `POST /logout` clears the session cookie and redirects to the Referer page if present and valid, otherwise `/`.

---

## 7. Shared Public Behavior Rules

### 7.1 Authorization boundary

Most pages in this catalog are public visitor pages. The following routes require authentication and redirect unauthenticated visitors to `/login?returnTo=<originalUrl>`:

- `GET /history` — historical players index (controller-enforced)
- `GET /history/:personId` — historical player detail (public for HoF/BAP; controller-enforced for others)
- `GET /members/:memberId` — public read-only view for HoF/BAP members; auth required otherwise (controller-enforced)
- `GET /members/:memberId/edit`, `POST /members/:memberId/edit` — auth required (route middleware)
- `GET /members/:memberId/avatar`, `POST /members/:memberId/avatar` — auth required (route middleware)
- `GET /members/:memberId/:section` — auth required (route middleware)

Public pages must not expose:

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
