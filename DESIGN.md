# PropertyIQ — Design System

> Extends the global GEA design system (`~/.claude/GEA_DESIGN.md`). Where this file and
> the GEA baseline conflict, **this file wins for PropertyIQ**.

## Positioning

PropertyIQ is a property **data product**, not a marketing surface. Authority and trust
come from clarity, precision, and restraint — the register of PropTrack / CoreLogic /
Stripe / Linear. Crisp sans typography, generous cool whitespace, hairline rules,
monospaced figures, and a single sparing accent.

**Override of GEA baseline:** GEA mandates a warm paper/gold palette and serif-forward
editorial typography. PropertyIQ deliberately runs **cooler & whiter** with **sans-dominant**
type. GEA gold is retained strictly as a sparing brand accent so the product still reads as
a GEA property.

## Tokens (machine-readable)

```yaml
colors:
  primary: "#C8A96E"
  bg: "#FBFBFC"
  surface: "#FFFFFF"
  subtle: "#F4F5F7"
  rule: "#E7E9EE"
  ink: "#16181D"
  ink-soft: "#33363D"
  ink-mid: "#4A4E57"
  muted: "#6B7077"
  faint: "#8A8F97"
  gold: "#C8A96E"
  gold-dark: "#B8954A"
  gold-soft: "#EFE3CC"
  data: "#335C7D"
  up: "#2F8F6B"
  down: "#C5544A"
  warn: "#B8954A"
spacing:
  section: "5rem"
  section-lg: "6rem"
  card: "1.5rem"
  card-lg: "2rem"
rounded:
  card: "0.75rem"
  control: "0.5rem"
typography:
  sans: "DM Sans, system-ui, sans-serif"
  display: "Playfair Display, Georgia, serif"
  mono: "IBM Plex Mono, monospace"
contrast:
  - { fg: "#16181D", bg: "#FBFBFC" }   # body text on page
  - { fg: "#6B7077", bg: "#FBFBFC" }   # muted text on page
  - { fg: "#8A6830", bg: "#EFE3CC" }   # gold badge text on gold-soft
  - { fg: "#FFFFFF", bg: "#C8A96E" }   # button label on gold
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
| `gold` | `#C8A96E` | **brand accent — sparing only** |
| `gold-dark` | `#B8954A` | gold hover / press |
| `gold-soft` | `#EFE3CC` | gold selected / hover fill |
| `data` | `#335C7D` | charts, links, data emphasis (muted steel-blue, **not** SaaS `#3b82f6`) |
| `up` / `up-soft` | `#2F8F6B` / `#E4F1EB` | positive / growth |
| `down` / `down-soft` | `#C5544A` / `#F7E7E5` | negative / risk |
| `warn` / `warn-soft` | `#B8954A` / `#F5EEDD` | caution (stays in gold family) |

Anti-patterns: no SaaS blue `#3b82f6`; no rainbow `*-50` status fills (use the status tokens
above); one accent colour per chart; gold never used for large fills.

## Typography

- **Headings → sans** (`DM Sans` / Söhne), `tracking-tight`, weight 500–600, `clamp()` sizes.
  Utility classes: `.text-display`, `.text-h1`, `.text-h2`, `.text-h3`, `.text-eyebrow`.
- **Serif (`Playfair Display`) is reserved** for at most one hero display moment — opt in via
  `.font-editorial`. Never on section headings, labels, nav, or buttons.
- **Mono (`IBM Plex Mono`)** for every price/area/date/stat, always with `tabular-nums`.

## Spacing & components

- Sections `py-20`/`py-24`; content `max-w-5xl mx-auto px-6`; cards `p-6`/`p-8`.
- Radii: `rounded-xl` (cards), `rounded-lg` (controls). No `rounded-full` on content blocks.
- **Hairline rules over shadows** — cards are border-delineated; shadow only on hover.
- Shared primitives live in `src/components/ui/`: `Card`, `Button`, `Badge`, `Stat`,
  `SectionHeading`. Use them rather than re-inlining patterns.

## Interaction (inherited from GEA)

Hover = opacity/brightness shift (150–200ms). Press = `scale-0.97`. Focus = visible
`ring-2 ring-[#C8A96E] ring-offset-2` — never removed. Disabled = opacity 0.4. Respect
`prefers-reduced-motion`. Touch targets ≥ 44–48px.
