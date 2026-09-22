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
