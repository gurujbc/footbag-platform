---
name: add-public-page
description: Add or extend a public server-rendered page in the current Express + Handlebars app. Use when the task affects a public route, controller, service, template, or route-level tests.
---

# Add Public Page

1. Inspect first:
   - `CLAUDE.md`
   - nearest local `CLAUDE.md`
   - `src/routes/publicRoutes.ts`
   - the relevant controller
   - the relevant service
   - the target template(s)
   - nearby integration tests

2. Preserve current architecture:
   - server-rendered Express + Handlebars
   - thin controllers
   - service-owned page/use-case logic
   - logic-light templates
   - explicit route registration
   - no repository layer, ORM, mediator layer, or speculative API layer

3. Watch for route hazards:
   - preserve explicit route ordering
   - do not break `/events/year/:year` vs `/events/:eventKey`

4. Before editing, state:
   - route(s) affected
   - files likely to change
   - service ownership
   - verification plan

5. Verification:
   - prefer route/integration tests first
   - only use browser automation if the human explicitly asked for browser testing
