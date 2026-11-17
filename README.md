# Pokéred Browser Lab

[Play the public build](https://festyve.github.io/pokered-browser/).

## Run and modify

```sh
python3 -m http.server 4173 --directory dist
```

Open http://localhost:4173. No package install or build step is required to play. Arrow keys / WASD move, Z / Enter confirms, X goes back, and Escape opens the menu. Touch controls and clickable choices are included. The Field Guide contains text speed, protected dialogue, animation and music options.

| File | Purpose |
| --- | --- |
| `dist/js/game.js` | Scene runner, interactions, campaign integration, menus and rendering |
| `dist/js/campaign.js` | Persistent quest rewards, requirements, visibility and puzzle geometry |
| `dist/js/presentation.js` | Buffered tile motion, text pacing and HP interpolation |
| `dist/js/mechanics.js` | Native battle effects, stats, growth and learning |
| `dist/js/music.js` | Web Audio playback of original music scores |
| `dist/js/navigation.js` | Map connections and warp coordinates |
| `dist/data/world.json` | Maps, block geometry, objects, sprites and dialogue |
| `dist/data/pokemon.json` | Species, moves, encounters and trainer teams |
| `dist/data/events.json` | Original quest, gym, rival, League, item, machine and puzzle references |
| `dist/data/music.json` | 46 extracted music sequences, loops and map assignments |
| `tools/` | Repeatable source-data importers |

The Workbench supports local species edits, map exploration and test party additions. Exploration pauses events and encounters and preserves the story position. Base-stat modifications affect newly created Pokémon. Edit source/JSON files to share modifications with everyone.

## Changes in 0.2

## Saves and publication

Save key: `pokered-browser-save-v1`; mod key: `pokered-browser-mods-v1`; options key: `pokered-settings-v2`. Older browser saves receive default campaign fields on load. Export a save before experimenting. Original cartridge `.sav` files are not compatible.

Each push to `main` runs unit regressions and publishes `dist/` to GitHub Pages via `.github/workflows/pages.yml`. Tests, importers and local verification artifacts are not served by the website. No personal save data is committed.

## Reimport

Requires Python 3 and Pillow, plus a separate upstream checkout at commit `ba9c0568f64ae602fadda577a08c66639f93082a`.

```sh
git clone https://github.com/pret/pokered.git /path/to/pokered
# Check out the pinned commit in that checkout first.
python3 tools/import_pokered.py /path/to/pokered --output dist
python3 tools/import_events.py /path/to/pokered --output dist/data/events.json
python3 tools/import_music.py /path/to/pokered --output dist/data/music.json
```

Reimport overwrites generated JSON and images; preserve manual data edits first. Event manifests document original data and coordinates; JavaScript implements their behavior.

## Verification and remaining scope

```sh
npm test
# Optional isolated browser regression suite; start the local server first:
npm install --no-save playwright
npx playwright install chromium
npm run test:browser
```


Still incomplete: optional events and some conditional dialogue, in-game trades/link features, casino games, fossil revival and other side activities, NPC wandering, Seafoam currents, exact Safari/fishing rules, capture probability, trainer AI and item use, experience sharing, battle quirks, original animation choreography and hardware audio/timing. Level/stone evolution is implemented; trade evolution is not. Only the active Pokémon receives battle experience. Initial player/rival names remain RED/BLUE. 
