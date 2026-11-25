# The Backrooms

A browser Backrooms game by THEMPGUY.

The game is static-host friendly: the playable build is HTML, CSS and JavaScript and can be published directly to GitHub Pages or another static host.

## Current build

The current game build includes:

- First-person 3D exploration
- Procedurally generated maze chunks
- Seeded world generation
- Streaming chunk loading and unloading
- Instanced wall rendering for repeated geometry
- PBR materials using the OpenGameArt Backrooms pack plus bundled ambientCG industrial concrete and metal maps
- Three.js r186
- ACES filmic tone mapping
- Adaptive resolution for weaker devices
- Low / Medium / High / Auto quality modes
- Desktop pointer lock controls
- Mobile joystick and touch-look controls
- Flashlight with dynamic cone lighting
- Procedural Web Audio ambience and effects with echo/reverb
- Bundled CC0 industrial, ocean, field-wind and entity one-shot audio
- Level-aware ambience, distance falloff and stereo entity panning
- Cinematic audio-gated intro and noclip reveal
- Footsteps, lighting faults, damage, distant knocks and exit audio
- ARG-style camera telemetry, signal faults and hidden messages
- Health, stamina, hydration and sanity systems
- Hazards and deaths
- Data-driven level definitions
- Playable campaign progression from Level 0 through Level 10
- Distinct utility halls, electrical station, office, hotel, lights-out maze, ocean, cave, suburb and wheat-field environments
- Hound, Smiler, Deathmoth, Skin-Stealer, Wretch, Crawler, Leviathan and Tiny gameplay representations
- Local settings persistence
- No backend, database or server required

The generator is intentionally deterministic from a world seed. Chunks can be regenerated from coordinates without storing the entire map, which keeps memory use bounded.

## Levels

### Level 0 - "Threshold"

Yellow maze-like spaces, damp carpet, fluorescent fixtures, darkness, hazards and a flickering route forward.

Source:
https://backrooms-wiki.wikidot.com/level-0

### Level 1 - "Habitable Zone"

A rougher and less forgiving environment with flickering events, supplies, industrial details and hostile encounters.

Source:
https://backrooms-wiki.wikidot.com/level-1

### Level 2 - "Abandoned Utility Halls"

Five-metre maintenance cells, diagonal 45-degree partitions, chalky concrete, exposed pipes, valves, wiring and unstable industrial lighting.

Source:
https://backrooms-wiki.wikidot.com/level-2

### Level 3 - "Electrical Station"

A dangerous electrical facility with connected service corridors, switchgear, transformers, conveyor machinery, exposed cables and generator-room set pieces.

Source:
https://backrooms-wiki.wikidot.com/level-3

### Level 4 - "Abandoned Office"

A quieter office environment with desks, storage and sparse supplies.

Source:
https://backrooms-wiki.wikidot.com/level-4

### Level 5 - "Terror Hotel"

A 1930s hotel with a furnished Main Hall, a chandelier-lit ballroom-inspired hub and occasional boiler-room machinery.

Source:
https://backrooms-wiki.wikidot.com/level-5

### Level 6 - "Lights Out"

A tight, silent concrete maze with rare auditory hallucinations and no hostile entity spawns.

Source:
https://backrooms-wiki.wikidot.com/level-6

### Level 7 - "Thalassophobia"

A vast ocean chamber beneath a low concrete ceiling, with a waterline, submerged rock formations and a deep hatch.

Source:
https://backrooms-wiki.wikidot.com/level-7

### Level 8 - "Cave Systems"

Cold, dark cave passages with jagged rock formations and hostile creatures.

Source:
https://backrooms-wiki.wikidot.com/level-8

### Level 9 - "The Suburbs"

An unpowered suburban street at midnight, with hollow houses, broken street lamps and open road intersections.

Source:
https://backrooms-wiki.wikidot.com/level-9

### Level 10 - "Bumper Crop"

Overcast wheat and barley plots divided by tree lines, ponds, sheds and barns.

Source:
https://backrooms-wiki.wikidot.com/level-10

Level metadata and source licensing live in src/levels.js and data/levels.json. The current campaign includes Levels 0-10; the procedural generator streams each environment from a deterministic seed.

## Controls

Desktop:

- W A S D to move
- Mouse to look
- Shift to run
- F to toggle the flashlight
- Esc to pause
- R + Shift to restart

Mobile:

- Left stick to move
- Swipe the right side of the screen to look
- RUN toggles sprint while held
- The flashlight button toggles the light

## Performance design

The world is not generated as one giant mesh. A continuous player-following ceiling surface sits above the streamed chunks so crossing chunk boundaries cannot reveal an empty sky or a missing roof.

Only nearby chunks are kept in memory. Each chunk uses a small deterministic maze grid, shared geometry, instanced wall meshes and a limited number of dynamic lights. Far chunks are detached from the scene.

The renderer also adapts its pixel ratio when Auto quality is selected. This is intended to make the game usable on lower-end PCs and mobile GPUs without forcing the high-end rendering path on every device.

The production build bundles the required CC0 PBR maps into its generated static output.

## Procedural assets

The build uses the Backrooms PBR texture pack by methodical pixel from OpenGameArt.org for the original environment materials, plus CC0 ambientCG Concrete 046, Concrete 013, Metal 064 and Metal 063 for Levels 2 and 3. All maps are bundled into dist/assets/pbr/ and served from the same site origin.

Used material sets include:

- Wallpaper
- Painted wall
- Carpet
- Ceiling tiles

Each set supplies a base-color map, roughness map and normal map. The renderer keeps its procedural PBR materials as a fallback for local development or a temporarily unavailable asset.

Props such as pipes, crates, fluorescent fixtures and exit markers are generated from primitive geometry.

See assets/README.md.

## Audio

The audio layer combines procedural Web Audio synthesis with bundled CC0 recordings from OpenGameArt and BigSoundBank. Level 2 has machinery and steam, Level 3 has transformer hum, Level 7 has ocean waves, Level 8 has a cave-room recording, Level 10 has field wind and light rain, and Level 37 has an indoor-pool recording. Hotel footsteps use a separate wooden-floor set; industrial, cave, and suburban levels use concrete-footstep variations. Entity cues are spatialized and varied by behavior state. All source URLs, authors, licenses, input checksums and converted-output hashes are tracked in data/audio-assets-lock.json and assets/audio/manifest.json.

The game starts audio after a user gesture, which is required by modern browser autoplay policies.

## Development

Clone the repository and run a local web server:

~~~bash
git clone https://github.com/THEMPGUYActions/Backrooms.git
cd Backrooms
python -m http.server 8000
~~~

Then open:

http://localhost:8000/

For Node-based QA/build checks:

~~~bash
npm run check
npm run build
~~~

## GitHub Pages

Production is the main branch.

The GitHub Actions workflow:

1. Builds the static site into dist/.
2. Runs source-quality and browser-module resolution checks.
3. Publishes main to the gh-pages branch root for production.
4. Publishes dev under /dev/ on the same branch.

After GitHub Pages is enabled with gh-pages as the publishing source, the production site will use:

https://thempguyactions.github.io/Backrooms/

GitHub Pages documentation:
https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## Branches

- main = production
- dev = active development

The dev branch is where new game systems should land first. Production changes should be promoted to main only after the QA workflow passes.

## Attribution and licensing

This project uses Backrooms Wiki-derived material for identifiable levels and entities. The project intentionally does not bundle the wiki's photographs, page artwork, music or other third-party media.

See:

- ATTRIBUTION.md
- ASSET_CREDITS.md
- GAME-CONTENT-LICENSE.md
- LICENSE

The Backrooms Wiki licensing guide is used for the wiki-derived setting material:

https://backrooms-wiki.wikidot.com/licensing-guide

The OpenGameArt texture pack used by this build is separately identified as CC0:

https://opengameart.org/content/backrooms-pbr-texture-pack

The current image-use guide also describes compatible media licenses and attribution requirements:

https://backrooms-wiki.wikidot.com/image-use-policy

Original project material that is not derived from third-party Backrooms content remains subject to the applicable repository license.

## Disclaimer

This is an independent fan game project. It is not affiliated with or endorsed by the Backrooms Wiki, Wikidot, or other Backrooms projects.

Copyright © 2026 THEMPGUY.
