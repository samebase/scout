# Scout UI design contract

## Treat this document as a cache

This document records the current design direction so each UI task does not need to reconstruct it
from the whole application. It is a starting point, not an invariant or a substitute for judgment.

Before using it, compare it with the current product, the requested change, and the relevant source
code. A direct user requirement, accessibility need, or clearer product behavior takes precedence.
If the direction changes, update this document in the same change. Do not preserve a rule only
because it appears here.

Repeat a broader design audit when the audience changes, a new platform is added, the information
architecture changes, or repeated UI friction suggests that this cache is stale.

## Current design read

Scout is an authenticated research and verification workspace for researchers and operators. It
should feel like a precise editorial tool: calm, legible, compact, and trustworthy. It is a product
interface, not a marketing site.

Use these Taste Skill dials as starting coordinates:

- `DESIGN_VARIANCE: 6` - controlled asymmetry and a clear hierarchy without novelty for its own sake.
- `MOTION_INTENSITY: 3` - tactile feedback and short state transitions, with no decorative choreography.
- `VISUAL_DENSITY: 7` - efficient working layouts that still leave enough space to scan and think.

The project-local Taste Skill is strongest as a redesign and consistency check. Its landing-page
rules do not automatically apply to Scout's dense product workspaces.

## Visual direction

- Use cool off-white and cool near-black surfaces with cobalt as the primary accent.
- Reserve other colors for semantic states such as success, warning, or failure.
- Use the existing `Avenir Next` and system sans-serif stack. Use weight, spacing, and color before
  increasing type size.
- Keep controls near a 10px radius and larger panels near 14-16px. Pills belong to compact controls
  or tags, not every container.
- Prefer borders, spacing, and subtle tinted shadows over heavy elevation or glass effects.
- Support light and dark system themes. Preserve the same hierarchy in both modes.

The semantic tokens and radius scale in `src/style.css` are the source of truth. Update this summary
when those foundations change.

## Composition and density

- Keep the 64px application navigation on one line at desktop. Let route links scroll horizontally
  on narrow screens instead of wrapping.
- Use `route-page` for standard centered pages. Let Lab and resizable Product workspaces use the
  width they need.
- Use panels when they represent a real workspace, object, or decision boundary. Do not wrap every
  paragraph or metric in a card.
- Put the primary action near the object it changes. Keep secondary metadata quieter but readable.
- Preserve Product and claim pane behavior. Pane width, not only viewport width, determines how
  those workspaces reflow.
- Prefer plain, specific labels. Avoid decorative eyebrows, fake status metadata, and marketing
  language inside operational views.

## Interaction and states

- Use motion for feedback or a state change. Keep it short and respect `prefers-reduced-motion`.
- Preserve visible hover, active, focus, selected, and disabled states.
- Design loading, empty, error, and success states as part of the feature. Do not ship only the
  populated happy path.
- Keep form labels above their controls. Keep helper and error text next to the field they explain.
- Reuse the shared Button, Input, and Textarea components before adding route-specific variants.
- Keep icons within the existing Lucide family unless the application deliberately migrates as one
  change.

## Ownership map

| Concern                                               | Current owner                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| Semantic tokens, themes, radii, shared layout classes | `src/style.css`                                                     |
| Global navigation                                     | `src/components/app-navigation.tsx`                                 |
| Application shell and authentication boundary         | `src/routes/__root.tsx`                                             |
| Shared controls                                       | `src/components/ui/`                                                |
| Product and claim pane composition                    | `src/components/products-workspace.tsx` and `src/routes/products.*` |
| Route-specific content and states                     | `src/routes/`                                                       |

Change the shared owner when a decision affects several routes. Keep a decision local when it only
serves one workflow.

## Avoid by default

- A second component or icon system beside the existing stack.
- AI-purple gradients, ornamental glow, or glass on operational surfaces.
- Oversized headings that displace the task a user came to perform.
- Equal card grids used only to fill space.
- Decorative animation, scroll effects, or custom cursors.
- Uppercase micro-labels above every section.
- Middle dots or dash characters used as default metadata separators.
- Fake data, fake product previews, or invented precision.

These are defaults, not bans. Use an exception when the product benefits, then make the reason clear
in the change.

## Verify UI changes

For each affected workflow:

1. Exercise the real route and its main interaction.
2. Check authenticated and signed-out behavior when access changes the route.
3. Check populated, empty, loading, and failure states that the feature can reach.
4. Check desktop and a 390px-wide mobile viewport.
5. Check light and dark modes.
6. Check keyboard navigation, focus visibility, text contrast, and control labels.
7. Run `pnpm run check`. Run `pnpm run build` when the change affects production output.

If the result establishes a new reusable design decision, update this cache before merging.
