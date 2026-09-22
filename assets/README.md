# Generated game assets

The first production game build intentionally does not bundle random web images, ripped game files, or unverified asset packs.

The browser generates the environment materials and simple props at runtime:

- PBR-style base color maps
- Roughness maps
- Procedural normal maps
- Carpet, concrete, metal, rubber and ceiling materials
- Fluorescent fixtures
- Pipes, crates, exit markers and entity representations

This keeps the project static-host friendly, reduces repository weight, and avoids accidentally redistributing artwork with an incompatible license.

The renderer uses Three.js r186 from jsDelivr. The source is pinned instead of using an unversioned CDN URL.
