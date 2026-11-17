# Pokéred Browser Lab

An editable, native JavaScript reconstruction of Pokémon Red, using original declarative data and assets from [pret/pokered](https://github.com/pret/pokered). This is an initial playable implementation, **not the complete game and not a verified 1:1 port**. No Game Boy CPU, ROM, emulator, or WebAssembly core runs in the browser.

## Website

The public site is deployed from `dist/` by `.github/workflows/pages.yml`. Each push to `main` runs the regression tests and publishes the updated game to GitHub Pages. The source repository includes the importer and editable game code; only `dist/` is served as the website.

## Run

From this directory:

```sh
python3 -m http.server 4173 --directory dist
```

Open http://localhost:4173 in a browser. No package installation or build step is needed. Use a local server; ES modules and JSON loading do not work reliably through `file://`.

Arrow keys or WASD move. Z / Enter confirms. X goes back. Escape opens the menu. Touch controls and clickable battle choices are included.

## What is here

- 223 original maps with tile graphics, borders, collision grids, warps, and connections.
- 151 species, original front/back sprites, base stats, learnsets, and evolution **data**.
- 165 move definitions, original type effectiveness, encounter tables, 391 trainer parties, 72 character sprite sheets, and the original pixel font.
- Native movement, ledge jumps, NPC interaction, text boxes, basic battles, HP/PP/status, experience/leveling, capture, party switching, healing, shops, item pickup, save/export/import.
- Abbreviated opening events: home, Oak, starter selection, rival, parcel delivery, travel through Viridian Forest, and Brock's Boulderbadge.
- Workbench: travel to any imported map, optional noclip, edit species stats/types/moves/learnsets, and add test Pokémon.

The opening is playable, but its scripts and battle rules are incomplete approximations. All 151 species being imported does **not** mean all mechanics are implemented.

## Modify it

| File | Purpose |
| --- | --- |
| `dist/js/game.js` | Rendering, input, browser UI, save state, opening event scripts, battle flow |
| `dist/js/mechanics.js` | Pokémon construction, stats, experience, damage, move effects, healing |
| `dist/js/navigation.js` | Map connection and warp calculations |
| `dist/data/world.json` | All map definitions, objects, collision grids, text, sprites, provenance |
| `dist/data/pokemon.json` | Species, moves, encounters, trainer parties, type chart |
| `dist/assets/` | Original pixel assets; map images are already composed from tiles |
| `tools/import_pokered.py` | Repeatable importer from the upstream assembly tables and PNGs |
| `tests/core.test.mjs` | Data integrity, navigation and battle-rule regression checks |

The Workbench saves overrides in this browser's localStorage. Edit the JSON/source files to make changes part of the project. Modifying a base stat affects newly created Pokémon, not the stats already saved on existing party members. Source data uses original constants such as `PSYCHIC_TYPE` and `PSYCHIC_M`.

Save key: `pokered-browser-save-v1`. Mod key: `pokered-browser-mods-v1`. Saves contain the JavaScript RNG state. Exploration temporarily preserves the story position and disables encounters/events. The source contains no user save data.

## Reimport original data

Requires Python 3 and Pillow. The upstream checkout is intentionally separate from this project. The current data was imported from commit `ba9c0568f64ae602fadda577a08c66639f93082a`.

```sh
git clone https://github.com/pret/pokered.git /path/to/pokered
python3 tools/import_pokered.py /path/to/pokered --output dist
```

For exact reproducibility, check out the pinned commit before importing. Reimporting overwrites generated JSON and image assets. Make engine edits separately; preserve data edits before reimporting.

## Verification

```sh
node --test tests/*.test.mjs
```

Eleven automated tests cover imported references, map geometry, route offsets, forest gate exits retaining the outdoor map, stats, growth curves, deterministic random state, Gen I immunities, damage, PP/status/healing, the 1-in-256 accuracy miss, and experience/learning.

Browser checks completed: new game, home exit, Oak event, starter selection, full first-rival battle, leveling, saving/reloading, save import, gym trainer and Brock battles using a test save, Boulderbadge/reward, Workbench map travel/return, and species edits. Original map geometry was checked for the opening route. This is not a complete original-game parity test or a full uninterrupted campaign playthrough.

## Remaining for 1:1

1. Translate every map event script and conditional dialogue; implement visibility transitions and NPC movement.
2. Complete battle effects, trainer AI, battle sequencing, capture rules, experience sharing, move-replacement prompts, and the original RNG/timing behavior.
3. Implement evolution, PC storage retrieval, full items/TMs/HMs, field moves, puzzles, trading, all later gyms, the League, and credits.
4. Add original audio playback and animation/timing fidelity.
5. Build a differential test harness: identical input traces against the original reference, checking state and frame output.

Known differences: choice/escort events are abbreviated; NPCs stay still; capture and trainer AI are simplified; only the active Pokémon gets experience; a fifth learned move automatically replaces the oldest move; unknown non-damaging effects explicitly report that they are untranslated. Pokémon beyond a full party are stored in save data, but the PC retrieval interface is not implemented yet. No evolution occurs yet. Later-map art and generic interaction are available, but story progression beyond Brock is not implemented. This browser save format is not compatible with original `.sav` files.

Original game, artwork and characters belong to their respective owners. Reference project and upstream commit are recorded in `dist/data/provenance.json`. No ownership or license over the original assets is claimed.
