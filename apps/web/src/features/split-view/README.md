# Split View

A universal, route-driven split view. Any surface (top-level tab) can be split
into multiple panes, and any interface the app can route to can be dropped in as
a pane — chat beside a diff beside a work view. There is one engine, not a
per-feature implementation.

## The core idea: a pane is a route

A pane is nothing but a `SurfaceRoute`. That single decision is what makes the
split view universal:

- **No component registry.** A secondary pane renders by running the app's own
  route tree against a private in-memory location (`split-pane-router.tsx`), so
  it gets loaders, error boundaries, pending states and in-pane `Link`
  navigation for free. Add a route to the app and it is splittable — nothing
  here changes.
- **The route is the pane's identity** (`surfaceIdForRoute`). The same interface
  can never be opened twice inside one surface.
- **Persistence, tear-off and session restore come for free**, because surfaces
  already carry their route.

```
window router ── __root ── AppRouteRoot ── SplitSurface ── dockview
                                              │ primary pane → <Outlet/>  (window router)
                                              └ other panes  → SplitPaneRouter (own memory router)
```

The primary pane is the surface's own routed `<Outlet/>`, passed through context
so it renders under the window router's match. Secondary panes each spin up an
isolated memory router over the *shared* route tree — safe because TanStack
route hooks resolve their router from React context (the nearest
`<RouterProvider>`), and `route.init` only recomputes structural fields.

`__root` and `SplitSurface` both check `useIsSplitPaneRoot()` so a pane renders a
bare outlet, never a second app shell or a nested split.

## What we own vs. what dockview owns

The store (`store/split-workspace-store.ts`) owns **which** routes are on screen
and **which** has focus. dockview owns the **geometry** — where panes sit, how
big they are, sash dragging, edge-drop overlays — serialized into
`workspace.layout`. We deliberately keep dockview's mature drag/resize behaviour
and drive it, rather than reimplementing a tiling engine.

Layout writes are debounced (`LAYOUT_PERSIST_DEBOUNCE_MS`): dockview reports a
change every frame of a sash drag, and nothing reads the layout back until the
surface remounts, so only a trailing write matters.

## Drag & drop

One payload for every source (`dnd/split-drag-payload.ts`): the dragged
`SurfaceRoute`. Two entry paths converge on the same `openRouteInSplit` command:

- **Sidebar / cross-tab HTML5 drags** land in dockview's own `onDidDrop`, using
  dockview's native edge overlay.
- **Surface-bar tab drags** are pointer-driven (they can tear off into native
  windows), so dockview never sees them. They publish pointer samples
  (`surface-drag-stream.ts`), hit-test through `resolveSplitDropTarget`, and
  render the mirrored overlay (`split-drop-overlay.tsx`). Hover and drop share
  one resolver so the overlay can never promise a placement the drop won't make.

The sidebar also writes the legacy `application/x-cradle-session` id alongside
the route, because the Electron tear-off target is a native window outside this
drag system and reads that id directly.

## Files

| Area | File | Responsibility |
| --- | --- | --- |
| Entry | `split-surface.tsx` | Public wrapper; bare content inside a pane |
| Entry | `split-commands.ts` | Imperative open/close/focus/drop for outside callers |
| Store | `store/split-workspace-store.ts` | Pane table, focus, layout blob, reconcile-on-restore |
| Runtime | `runtime/split-surface-host.tsx` | Mounts dockview, wires persistence & drops |
| Runtime | `runtime/split-pane-content.tsx` | Per-panel: primary outlet vs. pane router |
| Runtime | `runtime/split-pane-router.tsx` | Isolated memory router for a secondary pane |
| Runtime | `runtime/split-panels.ts` | Add/lock dockview panels |
| Runtime | `runtime/split-dockview-registry.ts` | Live `DockviewApi` lookup by surface |
| Model | `model/split-direction.ts` | Diagonal drop-point → direction (no dead centre) |
| DnD | `dnd/*` | Payload, pointer stream, hover state, hit-testing, overlay |

## Invariants

- The primary pane is never removed (closing it means closing the surface).
- A route already on screen is focused, not duplicated.
- A partially restorable persisted layout is discarded for a clean single pane —
  half a layout is worse than none.
- Panes never stack as hidden tabs: groups are locked to split-only, so every
  pane the workspace knows about is visible.
