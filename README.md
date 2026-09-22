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
- PBR materials using the OpenGameArt Backrooms PBR texture pack, with procedural fallbacks
- Three.js r186
- ACES filmic tone mapping
- Adaptive resolution for weaker devices
- Low / Medium / High / Auto quality modes
- Desktop pointer lock controls
- Mobile joystick and touch-look controls
- Flashlight with dynamic cone lighting
- Procedural Web Audio ambience and effects with echo/reverb
- Cinematic audio-gated intro and noclip reveal
- Footsteps, lighting faults, damage, distant knocks and exit audio
- ARG-style camera telemetry, signal faults and hidden messages
- Health, stamina, hydration and sanity systems
- Hazards and deaths
- Data-driven level definitions
- Level 0, Level 1 and Level 2 gameplay
- Hound and Smiler gameplay representations
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

Tighter utility corridors with concrete, pipes, unstable lighting and a heavier industrial atmosphere.

Source:
https://backrooms-wiki.wikidot.com/level-2

More levels can be added without rewriting the renderer. Level metadata lives in src/levels.js and data/levels.json.

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

The build uses the Backrooms PBR texture pack by methodical pixel from OpenGameArt.org for the environmental materials. The build downloads the CC0 maps into dist/assets/pbr/ so the deployed game serves them from the same site origin rather than depending on runtime cross-origin requests.

Used material sets include:

- Wallpaper
- Painted wall
- Carpet
- Ceiling tiles

Each set supplies a base-color map, roughness map and normal map. The renderer keeps its procedural PBR materials as a fallback for local development or a temporarily unavailable asset.

Props such as pipes, crates, fluorescent fixtures and exit markers are generated from primitive geometry.

See assets/README.md.

## Audio

The core ambience and sound effects are synthesised with the Web Audio API. This keeps the project completely static and avoids shipping large audio binaries.

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
