# Game assets

The playable build uses the **Backrooms PBR texture pack** by methodical pixel from OpenGameArt.org:

https://opengameart.org/content/backrooms-pbr-texture-pack

The pack is listed as **CC0** on OpenGameArt.org. It provides color, roughness and normal maps at 1024x1024 for multiple Backrooms materials, including wallpaper, painted wall, carpet and ceiling tiles.

The build downloads the locked maps from their OpenGameArt URLs into dist/assets/pbr/. The browser then loads the local copies from the same site origin. The procedural material maps remain as a fallback for cases where an individual local texture cannot be loaded.

The renderer pins Three.js r186 through an import map and uses the texture maps as real PBR inputs:

- Base color
- Roughness
- Normal

The streamed world also has a player-following ceiling surface so chunk boundaries cannot expose the empty WebGL background when exploring beyond the currently generated chunks.

No ripped game files or Backrooms Wiki photographs are bundled by this project.


## SpacePotato Found Footage assets

The development build also downloads a pinned set of reference textures from:

https://github.com/SpacePotatoee/MinecraftFoundFootage/tree/0c46c8301fc512c318ac93e23b669355b7d4b180

The build script places them under `dist/assets/spb-ff/`. The Level 0 set includes the original wall texture, wall-base texture, carpet PBR maps, ceiling-tile PBR maps and fluorescent-light texture. Level 1 continues to use its concrete, white-brick, crate, fluorescent, trim and stair assets.

The upstream repository's root `LICENSE` and its mod metadata should be treated as the source of the applicable third-party terms. These files remain third-party assets and are not relicensed as original THEMPGUY material.


## Industrial PBR (Levels 2-3)

The pbr/industrial/ directory contains 14 bundled 1K JPEG maps from ambientCG, all CC0 1.0 Universal:

- Concrete 046 for Level 2 wall surfaces
- Concrete 013 for Level 3 wall surfaces
- Metal 064 for rusted industrial metal
- Metal 063 for aged industrial steel

The maps are copied into the static build and verified against data/industrial-pbr-assets-lock.json. No runtime cross-origin texture requests are required.

## Audio

The audio/ directory includes the existing OpenGameArt CC0 assets and 14 BigSoundBank CC0 recordings converted to OGG for browser playback. See ASSET_CREDITS.md, data/audio-assets-lock.json and audio/manifest.json for exact sources and checksums.
