# CLAUDE.md — src/public/

Static assets served by Express at the repo root URL path `/`.

## Directory layout

```
src/public/
  css/     Site-wide stylesheet(s)
  img/     Static site images — SVG maps, logos, icons, decorative assets
  js/      Client-side JavaScript — progressive enhancement only, no build step
```

## img/ — static site images

Use `src/public/img/` for any image that is part of the site itself (not user-uploaded media). Examples: world map SVG, IFPA logo, placeholder graphics, inline icons.

User-uploaded photos and media live on S3, not here.

## js/ — client JavaScript

Scripts in `src/public/js/` must work as plain ES5/ES6 without a bundler or transpiler — they are served directly with no build step. Each script should be scoped to a single page or feature. Load with `defer` to avoid blocking render.

Progressive enhancement rule: every page must work without JavaScript. JS files may enhance behavior (maps, tooltips, etc.) but must never be required for core content to display.
