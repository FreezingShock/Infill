# What nate asks for and likes (sfvOS)

Seeded 9 Nov 2026 from the sfvOS project chat and from nate's Deepstack notes. Threads: append one dated line when something new about taste comes up (a correction, a "don't", a "love this"), under the matching heading, and add 2-3 backlog ideas in his wording.

## Product
- **No grid map.** Real lots and streets, deep customization, but customizing must be much easier (Nexus-like ease). 2026-10-25.
- **Realism does not matter.** Skip county heights and assessor data. 2026-10-25.
- **Few verbs, paint-like editing.** 5-verb toolbar, 6 paints plus a building card, 3-number HUD, Sandbox and Career. Wants "grid-like editing feel" on real lots. 2026-10-25.
- **Live world.** Whatever section loads should have cars, traffic, parked cars, turns; always evolving; as close to Cities: Skylines 2 / CityRT as possible. 2026-11-09.
- **Existing cities must be easy to update**, not just create. 2026-11-09.

- **Name**: the game is sfvOS; the in-game OS/theme label is Camino (not Vantage). Camino is the only look; the classic paper look is removed. 2026-11-09.
- **Scan view shows only real data**, never modeled utilities. Street view should look realistic; scan is the full surveillance-OS view. 2026-11-09.
- **No emoji in the UI**; drawn glyphs only. 2026-11-09.
- **Notices are a stack**, not one line: newest on top, older ones tucked back and fading, a type tag, a drawn glyph and a timer bar, hover pauses. He wants the ctOS feel. 2026-11-09.
- **Reported fixes are general**: fix the recognition method for every area and every future area, not one lot. 2026-11-09.

## Process
- **Never test in a headless browser.** nate tests on localhost; tell him what to try. 2026-10-25.
- **Auto-merge PRs into `integration`** when lint, tests and build pass; localhost runs from `integration`. 2026-10-26.
- **Many threads at once**, split to avoid file conflicts; ask him questions on style, taste and decisions (numbered, with a recommended default), then proceed on the default. Pattern from Deepstack.
- **Models**: big features claude-sonnet-5-5 at medium effort; quick fixes claude-haiku-5-5 at high effort. 2026-11-09.
- **Work in `C:\Users\natea\sfvOS`**, not Backbone. 2026-11-09.
- Windows user: `git checkout integration`, `git pull`, `npm install`, `npm run dev`.

## From Deepstack (likely to carry over)
- Overhaul, not tweak: offers should be bold rebuilds with a clear idea.
- Motion fast, smooth, physical; nothing snaps. Check long labels; nothing clipped.
- Performance is a feature: measure cost before building, report numbers honestly.
- Honest answers: real cause and fix, not a defence.
- Fit one screen at 1280x720 and 375x667 where UI is involved.

## Boot screen (2026-11-09)
- nate likes the boot readout layout as is. He wants it pushed toward the surveillance-OS look: faint grid only in scattered patches that drift and fade (decorative, not the city map), scanlines, a slow scan band, corner brackets, numbered steps. Keep the reduce-motion path still.

## Area picker and loading (2026-11-09)
- Loading a new area was too slow and the picker felt janky. He wants a real map of the Valley (satellite or an on-theme render), address suggestions like the in-game search, a better progress bar, and custom areas he can install and remove.
- Every scrollbar and every dropdown must be on theme, like the View and Layers menus (done app-wide in `src/camino/controls.js`).
- 2026-11-09: The area picker's selected-area card was covering the list and its text collided. nate loves the frosted glass and wants the list still visible behind it, with every field and button kept. The card is now a docked footer with stronger blur, so the list reads as soft texture behind it. Its facts and actions sit in two columns.
- 2026-11-09: nate wants long builds backgroundable with an ETA, a compact HUD chip and a finish toast with an Open action; closing the picker must not interrupt play.
- 2026-11-09: nate hit the 101 freeway at Shoup Ave and Ventura: no level separation, street-tree rows, no barriers. Wants multi-level roads as a general rule, underpasses that look right, and a freeway model with barriers and natural vegetation (PR #76).
