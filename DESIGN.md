# PropertyIQ — Design System

> Extends the global GEA design system (`~/.claude/GEA_DESIGN.md`). Where this file and
> the GEA baseline conflict, **this file wins for PropertyIQ**.

## Positioning

PropertyIQ is a property **data product**, not a marketing surface. Authority and trust
come from clarity, precision, and restraint — the register of PropTrack / CoreLogic /
Stripe / Linear. Crisp sans typography, generous cool whitespace, hairline rules,
monospaced figures, and a single sparing accent.

**Override of GEA baseline:** GEA mandates a warm paper/gold palette and serif-forward
editorial typography. everypropertyAI deliberately runs **cooler & whiter** with
**sans-dominant** type. GEA gold is **retired from the product UI** — the product accent is
a deep steel-slate, with a muted eucalypt as the secondary accent. GEA branding survives in
the wordmark/nav context only.

## Tokens (machine-readable)

```yaml
colors:
  primary: "#2E5470"
  bg: "#FBFBFC"
  surface: "#FFFFFF"
  subtle: "#F4F5F7"
  rule: "#E7E9EE"
  ink: "#16181D"
  ink-soft: "#33363D"
  ink-mid: "#4A4E57"
  muted: "#6B7077"
  faint: "#8A8F97"
  accent: "#2E5470"
  accent-dark: "#24435A"
  accent-soft: "#E4EBF1"
  accent-2: "#5C7466"
  accent-2-ink: "#435548"
  accent-2-soft: "#E9EFEA"
  data: "#2E5470"
  up: "#2F8F6B"
  down: "#C5544A"
  warn: "#8A6425"
spacing:
  section: "5rem"
  section-lg: "6rem"
  card: "1.5rem"
  card-lg: "2rem"
rounded:
  card: "0.75rem"
  control: "0.5rem"
typography:
  sans: "Instrument Sans, system-ui, sans-serif"
  mono: "IBM Plex Mono, monospace"
contrast:
  - { fg: "#16181D", bg: "#FBFBFC" }   # body text on page
  - { fg: "#6B7077", bg: "#FBFBFC" }   # muted text on page
  - { fg: "#24435A", bg: "#E4EBF1" }   # accent badge text on accent-soft
  - { fg: "#FFFFFF", bg: "#2E5470" }   # button label on accent
  - { fg: "#435548", bg: "#E9EFEA" }   # accent-2 badge text on accent-2-soft
  - { fg: "#8A6425", bg: "#F5EEDD" }   # warn text on warn-soft
```

## Colour tokens

| Token | Hex | Use |
|---|---|---|
| `bg` | `#FBFBFC` | page background, faintly cool near-white |
| `surface` | `#FFFFFF` | cards / elevated surfaces |
| `subtle` | `#F4F5F7` | fills: icon boxes, table stripes, chips |
| `rule` | `#E7E9EE` | hairline borders / dividers |
| `ink` | `#16181D` | primary text, cool near-black |
| `ink-soft` | `#33363D` | strong secondary text |
| `ink-mid` | `#4A4E57` | mid text |
| `muted` | `#6B7077` | secondary text, labels, captions |
| `faint` | `#8A8F97` | tertiary text, fine print |
| `accent` | `#2E5470` | **primary accent — actions, links, focus, data emphasis (deep steel-slate, not SaaS `#3b82f6`)** |
| `accent-dark` | `#24435A` | accent hover / press |
| `accent-soft` | `#E4EBF1` | accent selected / hover fill |
| `accent-2` | `#5C7466` | secondary accent — muted eucalypt; highlights, chart series 2 |
| `accent-2-ink` / `accent-2-soft` | `#435548` / `#E9EFEA` | accent-2 text / fill |
| `data` | `#2E5470` | alias of accent for charts/links |
| `up` / `up-soft` | `#2F8F6B` / `#E4F1EB` | positive / growth — **always paired with +/− or ▲/▼, never decorative** |
| `down` / `down-soft` | `#C5544A` / `#F7E7E5` | negative / risk |
| `warn` / `warn-soft` | `#8A6425` / `#F5EEDD` | caution — muted amber |

Anti-patterns: no SaaS blue `#3b82f6`; no violet/indigo AI-slop accents; no gold in product
UI (retired); no rainbow `*-50` status fills; one accent colour per chart (accent-2 for a
second series only); semantic colours never used decoratively.

## Typography

- **Headings → sans** (`Instrument Sans`), `tracking-tight`, weight 500–600, `clamp()` sizes.
  Utility classes: `.text-display`, `.text-h1`, `.text-h2`, `.text-h3`, `.text-eyebrow`.
- **No serif.** Playfair/editorial serif is retired — the register is financial-data, not
  lifestyle.
- **Mono (`IBM Plex Mono`)** for every price/area/date/stat, always with `tabular-nums`.

## Spacing & components

- Sections `py-20`/`py-24`; content `max-w-5xl mx-auto px-6`; cards `p-6`/`p-8`.
- Radii: `rounded-xl` (cards), `rounded-lg` (controls). No `rounded-full` on content blocks.
- **Hairline rules over shadows** — cards are border-delineated; shadow only on hover.
- Shared primitives live in `src/components/ui/`: `Card`, `Button`, `Badge`, `Stat`,
  `SectionHeading`. Use them rather than re-inlining patterns.

## Interaction (inherited from GEA)

Hover = opacity/brightness shift (150–200ms). Press = `scale-0.97`. Focus = visible
`ring-2 ring-[#2E5470] ring-offset-2` — never removed. Disabled = opacity 0.4. Respect
`prefers-reduced-motion`. Touch targets ≥ 44–48px.

## Trust furniture

Provenance is the brand: every displayed figure carries source + date where the data
exists ("Based on 14 comparable sales · CoreLogic · updated 12 Jun 2026"). Estimated vs
recorded values are marked consistently (estimates carry a confidence badge + range;
recorded values carry their source). Tables right-align numbers; charts always show axis
context.
