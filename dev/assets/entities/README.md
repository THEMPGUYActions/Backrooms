# Entity model pack

The runtime loads committed GLB entity assets from this directory. The deployment bootstrap can populate missing files once, then commits the binaries back into this repository so the browser never needs Sketchfab or another model repository at runtime.

Current researched CC BY 4.0 model sources:

- `smiler.glb` - 🇧🇷 Fog 🇧🇷
  https://sketchfab.com/3d-models/smiler-entity3-backrooms-994d17d347da4806968bb8ed9af5dedd
- `hound.glb` - 🇧🇷 Fog 🇧🇷
  https://sketchfab.com/3d-models/hound-backrooms-b835cbb0440942a0856da6cefd365d38
- `skinstealer.glb` - Speed12 / RocketOfficial
  https://sketchfab.com/3d-models/skin-stealer-the-backrooms-blender-302-c0db7c843ce44bb0a86a0b3a7d7884e1
- `duller.glb` - Hunter198511
  https://sketchfab.com/3d-models/backrooms-entity-6-duller-84d9383ca8dc4bdbbeba87dae49ccecb
- `deathmoth.glb` - Bittergiggle Playz [OFFICIAL]
  https://sketchfab.com/3d-models/deathmoth-backrooms-6101e3e3991545d6a8cce026fb2a51b2
- `faceling.glb` - TacoModels / original model by AlanH1213
  https://sketchfab.com/3d-models/backrooms-faceling-ps1psx-style-76ff872b6d12402ba6d363c6d16f64c7
- `partygoer.glb` - bigdowsey
  https://sketchfab.com/3d-models/the-partygoer-backrooms-entity-0593ef4788b146e4b2f820b10245a948
- `bacteria.glb` - DocoDummy
  https://sketchfab.com/3d-models/backrooms-custom-bacteria-lifeform-fb79a5140b144362abdaca43c0effb5c

The listed pages currently show Creative Commons Attribution licensing. Preserve creator attribution and source links with the binaries.

The bootstrap script accepts one-time direct `.glb` URLs through the `directUrl` fields or matching Actions secrets. It can also resolve Sketchfab downloads with the `SKETCHFAB_ACCESS_TOKEN` Actions secret. Sketchfab's official download API requires authenticated access, and its returned archive links are temporary. After the GLB is committed here, none of that is needed for the game or ordinary deployment.

The runtime remains self-contained. Missing model files fall back safely until their one-time sources are configured.
