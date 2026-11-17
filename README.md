# Pokéred Browser Lab

[Play the public build](https://festyve.github.io/pokered-browser/).

An editable JavaScript reconstruction of Pokémon Red, using original data and assets from [pret/pokered](https://github.com/pret/pokered). Build 0.2 adds the main campaign events through the League, but **is not the complete original game or a verified 1:1 port**. No ROM, Game Boy CPU interpreter, emulator, or WebAssembly core runs in the browser.

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

- Movement commits once per tile, interpolates the camera with the player, buffers the next direction, handles uppercase WASD, and clears stale input on blur. Holding a direction continues across route connections.
- Dialogue retains authored lines, reveals progressively and requires a fresh confirmation. Protected text adds a short pause after reveal; it is configurable. Oak's introduction, escort, starters and parcel scene now use the original longer dialogue.
- Encounter wipes, sprite entrances, move effects, hit flashes, HP interpolation, fainting, capture, switching and evolution sequences replace instant changes. The animations are newly implemented approximations, not original frame scripts.
- Original music compositions are translated to note data and synthesized with Web Audio. Music follows locations, battles, healing and the ending. Hardware envelopes, vibrato, SFX and cries are not fully reproduced.
- All eight gym leader teams, badge/TM awards, later rival encounters, Elite Four and the Hall of Fame sequence are connected. Brock no longer ends the story.
- Quest handlers cover Bill and his PC, S.S. Ticket and CUT, bicycle voucher, Rocket Hideout and Silph Scope, Marowak/Fuji/Flute/Snorlax, Silph Co./Master Ball, Safari SURF/Gold Teeth/STRENGTH, FLY and the Secret Key.
- Field systems cover HM teaching and badge requirements, CUT, SURF, STRENGTH, FLY, FLASH, block-changing doors, card keys, elevators, spinner paths, Vermilion switches, Cinnabar quizzes, Mansion switches, boulder switches and falls.
- Party systems include PC deposit/withdraw, level and stone evolution, move-replacement choices, expanded items and original shop inventories. Capture beyond a full party goes to the storage box.
- Battle effects now have handlers for charging, recharge, confusion, Disable, screens, Substitute, Bide, Transform, Mimic, Metronome, Mirror Move, trapping and additional status effects. Their presence is not a guarantee of original bug or timing parity.

Imported data includes 223 maps, 151 species, 165 moves, 391 trainer parties and 72 character sprite sheets. Counts describe data coverage, not gameplay equivalence.

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

28 unit tests cover data integrity, movement, dialogue pacing, HP interpolation, reward idempotence, all gym teams, original text references, dynamic collision, visibility, music assignments, navigation, stats and representative move effects. Browser fixture checks cover Oak's walking scene, starter choice, a real battle turn and animation, all gym battle starts/rewards, Bill's ticket, CUT save/reload, HM teaching, PC storage, evolution, quiz/Card Key doors, and the Hall of Fame return. Fixture checks deliberately jump between scenarios; they are **not an uninterrupted start-to-finish playthrough**. Browser tests inject test hooks only into the isolated test response, never into the shipped game.

Still incomplete: optional events and some conditional dialogue, in-game trades/link features, casino games, fossil revival and other side activities, NPC wandering, Seafoam currents, exact Safari/fishing rules, capture probability, trainer AI and item use, experience sharing, battle quirks, original animation choreography and hardware audio/timing. Level/stone evolution is implemented; trade evolution is not. Only the active Pokémon receives battle experience. Initial player/rival names remain RED/BLUE. A differential input/state/frame harness against the original is still needed before calling this 1:1.

Original game, artwork and characters belong to their respective owners. Source provenance is recorded in `dist/data/provenance.json` and the imported datasets. No ownership or license over the original assets is claimed.
