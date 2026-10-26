# Room Planner

Recreate a real room from your measurements, then drag, rotate and rearrange furniture on a dimensionally accurate floor plan, with live distances, collision checks and chair-space analysis.

It opens with a sample office ("Office Layout") and your L-shaped standing desk already placed. Every number in it can be edited.

## The one rule: the geometry is the source of truth

Everything is stored in **inches**, in room coordinates (origin = the room's north-west interior corner, +x east, +y south). Pixels never appear in the data. The canvas converts inches to pixels with a view transform, so a 64″ desk is exactly 64″ at every zoom level.

**Nothing is guessed.** A measurement you have not entered is `null`, never inferred from a photo. The app lists what is missing ("Needs measurements"), does not draw items it cannot place, and when measurements contradict each other it names the ones that conflict (e.g. *"Window does not fit on the north wall: position 80″ + width 36″ = 116″, but the wall is only 101″ long"*) without changing any of them.

### The seed office
| Supplied by you | Used as |
|---|---|
| One primary room dimension, 101″ | Room **width** (east–west). Use *Swap* in the Room panel if it is the other direction. |
| Room depth, 102″ (your diagram: left wall and right wall, each “to pillar”) | Room **depth** (north–south) |
| Pillar width, 24″ (your diagram) | Pillar width only; its position, depth and height are still unmeasured |
| Desk: 64″ main run, 24″ deep | Main run |
| Desk: ~43½″ return, ~21″ narrow end | Return, 43½″ measured **overall** along the outer edge (toggle *Past main* if you measured beyond the main run) |
| Desk: curved inside corner | Real L-shaped polygon; the curve's **radius was not given**, so 6″ is a visible placeholder (labelled "Estimate: not measured") |

Everything else (window, doorway, the pillar's position and depth, built-ins, wall TV) starts **unmeasured** and waits for you.

Interior dimensions are finished-surface to finished-surface. Wall thickness is display-only.

## Using it

**Modes** (top toolbar): *Room* edits architecture, *Furniture* arranges it, *Measure* is a CAD-style tape (free / horizontal / vertical, snaps to corners and vertices).

**Dragging**: smooth, with live X/Y (distance from the west/north walls), size, distances to walls, furniture, windows and door swing, magnetic snapping (walls, corners, furniture edges and centres, optional grid) and guide lines. Hold **Alt/Option** to bypass snapping temporarily.

**Rotating**: drag the round handle above the piece, with Free / 15° / 45° / 90° snapping, the current angle shown while you turn; or use ⟲90 ⟳90, flip H/V, or type an angle.

**Clearance**: green = good (≥ comfortable path, or flush), yellow = tight, red = collision, blocked door swing, or not enough chair space. Rules are editable (walking path 30″, comfortable path 36″, chair clearance 36″, keep door swing clear).

**Collisions**: *Warn* (default) lets pieces overlap and outlines the overlap in red; *Block* stops a piece at the point of contact.

**Layouts**: Layout A, B, C… share the architecture and differ only in furniture. Save a copy, rename, delete, switch with keys `1`–`9`, or overlay another layout faintly to compare.

### Wave 2 features
- **Custom room outline** (Room mode → *Edit as custom shape*): starts from your measured rectangle (so width and depth must both be entered), then edit corners by dragging, typing X/Y, clicking a **+** on a wall to add a corner, removing corners, or *Cut out a corner* (an exact notch, e.g. a rectangle becomes an L). Walls are numbered *Wall 1…n*; doors, windows and TVs follow their walls through every edit, and anything that cannot be carried across without guessing is detached and listed as "needs a wall". A self-crossing outline is reported as an error rather than repaired.
- **Custom furniture shapes** (Furniture → *Draw a custom shape*, or *Edit footprint* on a placed piece): click to add corners, drag to move, snap to ½″/1″/3″/6″, type exact corner positions, scale to an overall width/depth. Presets: rectangle, L, U, angled corner, triangle. Saved to the library and used by collisions and clearance like any other piece.
- **Reference photo** (Room tab): sits under the plan with opacity, rotation, lock and drag-to-position. It is labelled *Not to scale* until you click *Calibrate scale*, pick two points on it and type the real distance between them. It never produces a dimension by itself.
- **PDF export** (⋯ menu → *Export PDF (to scale)*): Letter, plan with a printed scale (e.g. 1:26 when printed at 100%), unmeasured items listed, plus a furniture schedule page.

### Shortcuts
`Ctrl/Cmd+Z` undo · `Shift+Ctrl/Cmd+Z` redo · `Ctrl/Cmd+D` duplicate · `Delete` remove · `R` / `Shift+R` rotate 90° · arrows nudge 1″ (`Shift` 6″, `Alt` ⅛″) · `L` lock · `F` fit · `C` center · `Space`+drag pan · wheel zoom · pinch on touch · `Esc` deselect / end tool

### Saving
Autosaves to your browser (IndexedDB). **Export project** / **Import project** use a versioned JSON file. **Export PNG / SVG** produce a clean presentation image with names and room dimensions; **Presentation mode** hides the editing chrome. Nothing is uploaded anywhere.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (geometry, engines, store)
npm run typecheck
npm run build        # production build in dist/
npm run build:single # one self-contained dist/index.html you can open or host anywhere
npm run e2e          # browser tests (needs Playwright; see e2e/run-all.cjs)
```

### Layout
```
src/geometry   inches-based maths: vectors, polygons, closest points, clipping, fractional-inch parse/format, L-desk
src/model      the scene model (types), seed office, furniture library, JSON validate/import/export
src/engine     room resolution + conflict reporting, collisions, clearance + chair zone, snapping
src/store      Zustand + Immer project store with undo/redo, IndexedDB autosave, UI state
src/canvas     the SVG plan renderer (pure) and the interaction layer (drag, rotate, resize, pan, pinch)
src/ui         toolbar, library, inspector, sheets
e2e/           browser tests: drag, snap, rotate, collisions, touch, export/import, persistence
```

The renderer takes plain data and draws; the engines take plain data and return plain data. Nothing in `geometry`, `model` or `engine` knows about React, the DOM or pixels, so the renderer (or a 3D view) can be replaced without touching the rules.

### Why SVG and not Konva
The brief allowed another renderer with a strong reason. SVG gives crisp vector output at every zoom, exports to a standalone SVG/PNG using the exact same drawing code, and lets the automated tests read real polygon geometry from the DOM. The scene is small (tens of objects), so canvas-level performance is not needed.

## Roadmap

**Wave 1 (this build)**: room canvas, editable rectangular room, interior walls, pillars, built-ins, door (hinge + swing arc), window, wall TV, furniture library, accurate parametric L-desk, drag / rotate / resize, scale-aware geometry, snapping, collisions, clearance, measure tool, layouts, undo/redo, autosave, import/export, PNG/SVG export.

**Wave 2 (this build)**: custom polygon editor with exact corner positions, non-rectangular room outlines (corner editing, notches, wall-attached openings preserved), calibrated photo reference, PDF export. Not yet: side-by-side layout compare, curved walls.

**Wave 3**: 3D / isometric view from the same scene model (orbit, pan, zoom, top/perspective), richer furniture models, optional photo calibration from *entered* measurements.

**Cloud sync (future)**: the project is a single versioned JSON document (`schema: 1`) with stable ids and independent layouts, so a sync layer can sit behind a `load()/save()` interface without changing the app. None is required today.

## Known limits
- Room outlines have straight walls only. Snapping to walls works on axis-aligned walls; angled walls are drawn and block furniture but furniture does not magnetically snap to them.
- The PDF is the plan as a high-resolution image plus selectable text, not vector artwork.
- A reference photo is downscaled to 2000 px and stored inside the project, so projects with photos are larger.
- Round furniture is a 48-sided polygon for collisions.
- Starter furniture sizes are typical dimensions, not measurements of your pieces.
