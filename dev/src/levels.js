export const LEVELS = {
  "0": {
    id: "0",
    number: "LEVEL 0",
    name: "The Lobby",
    sourceTitle: 'Level 0 - "The Lobby"',
    // "The Lobby" is the archived Level 0 title. The current live wiki page
    // is "Threshold"; keeping the archived source here matches the game's
    // requested naming while preserving provenance.
    sourceUrl: "https://backrooms-wiki.wikidot.com/archived:level-0",
    currentWikiTitle: 'Level 0 - "Threshold"',
    currentWikiUrl: "https://backrooms-wiki.wikidot.com/level-0",
    next: "1",
    theme: {
      // Kane Pixels' Common Backrooms read as faded olive-yellow wallpaper,
      // worn brown carpet and warm-white fluorescent lighting, not saturated gold.
      wall: 0xb5ad79,
      wallRough: 0.96,
      floor: 0x6b604c,
      ceiling: 0xbdb79a,
      fog: 0x000000,
      accent: 0xe3d7a2,
      light: 0xffedc8,
      ambient: 0x17150d
    },
    gridSize: 10,
    cellSize: 4.0,
    wallHeight: 3.05,
    darkness: 0.075,
    holeChance: 0,
    pipeChance: 0,
    entity: "figure",
    exitStyle: "mixed",
    exitAfterChunks: 6,
    batteryChance: 0.075,
    objective: "Find a way out. Not every door is real.",
    safe: true
  },
  "1": {
    id: "1",
    number: "LEVEL 1",
    name: "HABITABLE ZONE",
    sourceTitle: 'Level 1 - "Habitable Zone"',
    sourceUrl: "https://backrooms-wiki.wikidot.com/level-1",
    next: "2",
    theme: {
      wall: 0x999b98,
      wallRough: 0.84,
      floor: 0x666a68,
      ceiling: 0x4e514f,
      fog: 0x070809,
      accent: 0x92e7af,
      light: 0xf0f0e8,
      ambient: 0x0d0f0f
    },
    gridSize: 10,
    cellSize: 8.0,
    wallHeight: 6.0,
    darkness: 0.24,
    holeChance: 0,
    pipeChance: 0,
    entity: "smiler",
    exitStyle: "green",
    batteryChance: 0.14,
    exitAfterChunks: 4,
    objective: "Find the stairwell. The garage goes on forever. The lights do not stay on.",
    safe: false
  },
  "2": {
    id: "2",
    number: "LEVEL 2",
    name: "ABANDONED UTILITY HALLS",
    sourceTitle: 'Level 2 - "Abandoned Utility Halls"',
    sourceUrl: "https://backrooms-wiki.wikidot.com/level-2",
    next: "3",
    theme: {
      wall: 0x62605a,
      wallRough: 0.96,
      floor: 0x2f302f,
      ceiling: 0x252625,
      fog: 0x000000,
      accent: 0x8f6cff,
      light: 0xb9b0ff,
      ambient: 0x2e3340
    },
    cellSize: 5.0,
    wallHeight: 3.2,
    darkness: 0.28,
    holeChance: 0,
    pipeChance: 0.28,
    entity: "smiler",
    exitStyle: "violet",
    batteryChance: 0.10,
    exitAfterChunks: 5,
    objective: "The power is unstable. Reach the emergency threshold.",
    safe: false
  },
  "3": {
    id: "3",
    number: "LEVEL 3",
    name: "ELECTRICAL STATION",
    sourceTitle: 'Level 3 - "Electrical Station"',
    sourceUrl: "https://backrooms-wiki.wikidot.com/level-3",
    next: "4",
    theme: {
      wall: 0x66584f,
      wallRough: 0.96,
      floor: 0x50504c,
      ceiling: 0x878781,
      fog: 0x000000,
      accent: 0xffa45c,
      light: 0xd9d5c7,
      ambient: 0x151818
    },
    cellSize: 7.2,
    wallHeight: 3.9,
    darkness: 0.34,
    holeChance: 0.004,
    pipeChance: 0.38,
    batteryChance: 0.10,
    entity: "hound",
    exitStyle: "green",
    exitAfterChunks: 4,
    objective: "Follow the service markings. Find an elevator out.",
    safe: false
  },
  "4": {
    id: "4",
    number: "LEVEL 4",
    name: "ABANDONED OFFICE",
    sourceTitle: 'Level 4 - "Abandoned Office"',
    sourceUrl: "https://backrooms-wiki.wikidot.com/level-4",
    next: "5",
    theme: {
      wall: 0xd2d0c8,
      wallRough: 0.86,
      floor: 0x777872,
      ceiling: 0xb9b9b2,
      fog: 0x000000,
      accent: 0xe5d59a,
      light: 0xf1eee0,
      ambient: 0x4b4c46
    },
    cellSize: 9.5,
    wallHeight: 4.0,
    darkness: 0.10,
    holeChance: 0,
    pipeChance: 0.02,
    batteryChance: 0.14,
    entity: "none",
    exitStyle: "green",
    exitAfterChunks: 5,
    objective: "The lights still work. Find the next door.",
    safe: true
  },
  "5": {
    id: "5", number: "LEVEL 5", name: "TERROR HOTEL",
    sourceTitle: 'Level 5 - "Terror Hotel"', sourceUrl: "https://backrooms-wiki.wikidot.com/level-5", next: "6",
    theme: { wall: 0x654b4a, wallRough: .92, floor: 0x382c2d, ceiling: 0x8f8174, fog: 0x100b0b, accent: 0xc7a36d, light: 0xf4d8ad, ambient: 0x211716 },
    cellSize: 10.5, wallHeight: 4.2, darkness: .16, holeChance: 0, pipeChance: 0, entity: "deathmoth", exitStyle: "gold", exitAfterChunks: 4, batteryChance: .12,
    objective: "The hotel is still expecting guests. Find the boiler room exit.", safe: false, ambientIntensity: .09, fogDensity: .018
  },
  "6": {
    id: "6", number: "LEVEL 6", name: "LIGHTS OUT",
    sourceTitle: 'Level 6 - "Lights Out"', sourceUrl: "https://backrooms-wiki.wikidot.com/level-6", next: "7",
    theme: { wall: 0x08090d, wallRough: 1, floor: 0x050608, ceiling: 0x020304, fog: 0x000000, accent: 0x46506b, light: 0x8993aa, ambient: 0x010204 },
    cellSize: 4.4, wallHeight: 3.5, darkness: .94, holeChance: 0, pipeChance: 0, entity: "none", exitStyle: "blue", exitAfterChunks: 3, batteryChance: .06,
    objective: "There is no light here. Follow the sounds, not the walls.", safe: false, ambientIntensity: .004, fogDensity: .032
  },
  "7": {
    id: "7", number: "LEVEL 7", name: "THALASSOPHOBIA",
    sourceTitle: 'Level 7 - "Thalassophobia"', sourceUrl: "https://backrooms-wiki.wikidot.com/level-7", next: "8",
    theme: { wall: 0x182a35, wallRough: .92, floor: 0x10232e, ceiling: 0x07131c, fog: 0x06131e, accent: 0x4f8ca4, light: 0x9bbac6, ambient: 0x07121a },
    cellSize: 14, wallHeight: 4.5, darkness: .48, holeChance: .008, pipeChance: 0, entity: "leviathan", exitStyle: "blue", exitAfterChunks: 4, batteryChance: .08,
    objective: "The ocean has no visible bottom. Find the cave beneath the waterline.", safe: false, ambientIntensity: .035, fogDensity: .012
  },
  "8": {
    id: "8", number: "LEVEL 8", name: "CAVE SYSTEMS",
    sourceTitle: 'Level 8 - "Cave Systems"', sourceUrl: "https://backrooms-wiki.wikidot.com/level-8", next: "9",
    theme: { wall: 0x514b43, wallRough: 1, floor: 0x25231f, ceiling: 0x302d29, fog: 0x050504, accent: 0x8b785e, light: 0xb0a28c, ambient: 0x11100e },
    cellSize: 8.5, wallHeight: 5.4, darkness: .52, holeChance: .012, pipeChance: 0, entity: "crawler", exitStyle: "green", exitAfterChunks: 4, batteryChance: .11,
    objective: "The cave keeps folding back on itself. Stay on the marked path.", safe: false, ambientIntensity: .035, fogDensity: .025
  },
  "9": {
    id: "9", number: "LEVEL 9", name: "THE SUBURBS",
    sourceTitle: 'Level 9 - "The Suburbs"', sourceUrl: "https://backrooms-wiki.wikidot.com/level-9", next: "10",
    theme: { wall: 0x4c514f, wallRough: .94, floor: 0x171a1b, ceiling: 0x080b0e, fog: 0x020407, accent: 0x7d9b8d, light: 0x9aa9a1, ambient: 0x05090c },
    cellSize: 18, wallHeight: 4.1, darkness: .76, holeChance: 0, pipeChance: 0, entity: "smiler", exitStyle: "green", exitAfterChunks: 4, batteryChance: .10,
    objective: "The streetlights are dead. Do not trust the houses with open doors.", safe: false, ambientIntensity: .018, fogDensity: .014
  },
  "10": {
    id: "10", number: "LEVEL 10", name: "BUMPER CROP",
    sourceTitle: 'Level 10 - "Bumper Crop"', sourceUrl: "https://backrooms-wiki.wikidot.com/level-10", next: null,
    theme: { wall: 0x8c8054, wallRough: .98, floor: 0x4b4829, ceiling: 0x9b9a86, fog: 0x78816c, accent: 0xc0a75c, light: 0xe1d8b8, ambient: 0x3c3a2b },
    cellSize: 20, wallHeight: 4.8, darkness: .08, holeChance: 0, pipeChance: 0, entity: "none", exitStyle: "gold", exitAfterChunks: 2, batteryChance: .04,
    objective: "The fields go on forever. Find the old barn and the way home.", safe: true, ambientIntensity: .16, fogDensity: .006
  }
};

export function levelById(id){ return LEVELS[String(id)] || LEVELS["0"]; }

export function cycleHash(a,b,c=0){
  let n = (Math.imul(a|0, 374761393) + Math.imul(b|0, 668265263) + Math.imul(c|0, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
