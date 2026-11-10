# track 📐toolbox — pitch

## One-liner

Fast multi-track / waypoint surgery in the browser: load, select, cut, rename, convert, digitize, export. Not a tour planner SPA — a **surgical GPX/KML toolbox**.

## Niche we fill

Between “viewer / converter” and “full GPX IDE” (gpx.studio), biased toward **quick multi-feature cleanup**.

| Typical tools | Job | Gap |
|---|---|---|
| GPS Visualizer, converters | View / transform | Almost no geometry edit |
| Komoot, RWGPS, Strava, Plotaroute | Plan, social, device sync | Not multi-file cleanup |
| **gpx.studio** | Full GPX workshop | Trace-centric; slower for batch select → operate |
| Desktop (Viking, GPX Editor, JOSM) | Heavy editing | Not “open and fix in 30s” |
| **track toolbox** | Select many → trim / split / rename / export clean files | That gap |

**gpx.studio** is the only true peer. They win on deep file surgery (elevation, time, merge, POI icons, brand). We win when the job is: dump files in, multi-select, cut the garbage, ship device-ready GPX/KML.

## Positioning

- **Workshop vs toolbox** — studio is a workshop; we are a toolbox.
- **Selection-first** — multi-select, Shift+box add, filter without losing selection, Ctrl+A / Ctrl+D.
- **Edit session** — tools (node, scissor, trim, delete), save / discard, undo / redo, node focus.
- **Batch file ops** — multi-upload, separate vs collection export, tracks vs points never mixed, ZIP when needed.
- **Convert + edit** — GPX ↔ KML, KMZ / ZIP in the same flow.
- **Digitize into the list** — BRouter (Alps window) → same list → same export.

## Flagship use case — Google Maps / Google Earth

KML/KMZ from Maps or Earth is often **multilayered and messy**: folders, mixed paths and placemarks, leftovers from My Maps, stuff you never meant to ship. Pull it into track toolbox, multi-select what matters, trim/split/rename/remove noise, then export a **clean set of tracks and points**.

The other way matters just as much: build or tidy a set here, then export KML ready for **import back into Google Maps / Earth** — tracks and waypoints kept separate when you need that discipline.

This is the go-to tool for that cleanup ↔ publish loop — not another place to “draw a tour.”

## Who is this for?

Anyone who repeatedly cleans, cuts, renames, or converts tracks and waypoints — not only trail builders:

- **Trail builders & clubs** — GPS dumps → clean trail lines, splits, waypoints for signs / gates
- **Tourism & destination agencies** — productize rides/hikes as consistent GPX/KML packages
- **Guiding venues & schools** — maintain route libraries; quick fixes before a session
- **Event managers** — course maps, feed zones, cutoffs as points; export per stage or as a set
- **Planners & cartographers** — multi-file select → operate → export without a desktop GIS
- **Heavy riders, athletes, coaches** — fix bad GPS, trim cool-downs, reverse/clean routes for devices
- **Map maintainers** — batch rename, filter, remove noise, keep tracks and points in separate exports
- **Google Maps / Earth users** — clean multilayered KML/KMZ dumps; assemble a clean track + point set for re-import

If your workflow is “select → cut → export” more often than “plan a round-trip with elevation,” this is for you.

## Pitch lines (pick one)

- *Surgical GPX/KML editing for people who ship routes, not just draw them.*
- *Multi-select, trim, split, convert — then download. Done.*
- *The fast toolbox next to gpx.studio’s workshop.*
- *From messy GPS to device-ready files — in the browser, free.*
- *Clean Google Maps / Earth KML — then send a clean set back.*

## What we do not claim

- We are not the deepest elevation / time / merge suite (that’s gpx.studio).
- Digitize routing is strongest inside the Alps map window — lean into regional strength, don’t fake “world planner.”
- No account, no cloud library, no social — by design.

## Audience message (short — for docs / landing)

**Who is this for?** Trail builders, tourism and destination teams, guiding venues, event managers, planners, and serious riders or athletes who need to load, multi-select, edit, convert, and export GPX/KML quickly — without installing software or fighting a full tour-planning app. Especially useful when cleaning multilayered KML/KMZ from Google Maps or Earth, or assembling a clean track and point set to import back there.
