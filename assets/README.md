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

The development build also downloads a small pinned set of Level 1 reference textures from:

https://github.com/SpacePotatoee/MinecraftFoundFootage/tree/0c46c8301fc512c318ac93e23b669355b7d4b180

The build script places them under `dist/assets/spb-ff/` so the browser can load them locally. They are used for Level 1 concrete, white-brick corridors, crates, fluorescent fixtures, wall trim and stairs.

The upstream repository's root `LICENSE` and its mod metadata should be treated as the source of the applicable third-party terms. These assets are not claimed as original THEMPGUY material.
