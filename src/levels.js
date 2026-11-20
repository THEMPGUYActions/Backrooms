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
      fog: 0x30383a,
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
    safe: false, ambientIntensity: 0.11, fogDensity: 0.006
  },
  "2": {
    id: "2",
    number: "LEVEL 2",
    name: "ABANDONED UTILITY HALLS",
    sourceTitle: 'Level 2 - "Abandoned Utility Halls"',
    sourceUrl: "https://backrooms-wiki.wikidot.com/level-2",
    next: "3",
    theme: {
      wall: 0x6d625a,
      wallRough: 0.96,
      floor: 0x49433e,
      ceiling: 0x39332f,
      fog: 0x34302c,
      accent: 0xd18b43,
      light: 0xffd4a1,
      ambient: 0x24201b
    },
    cellSize: 5.0,
    wallHeight: 3.2,
    darkness: 0.18,
    holeChance: 0,
    pipeChance: 0.34,
    entity: "smiler",
    exitStyle: "violet",
    batteryChance: 0.10,
    exitAfterChunks: 5,
    objective: "Follow the chalk marks through the hot utility tunnels. Find the service lift.",
    safe: false,
    ambientIntensity: 0.17,
    fogDensity: 0.006
  },
  "3": {
    id: "3",
    number: "LEVEL 3",
    name: "ELECTRICAL STATION",
    sourceTitle: 'Level 3 - "Electrical Station"',
    sourceUrl: "https://backrooms-wiki.wikidot.com/level-3",
    next: "4",
    theme: {
      wall: 0x684c40,
      wallRough: 0.96,
      floor: 0x55514b,
      ceiling: 0x625e57,
      fog: 0x403936,
      accent: 0xffa15b,
      light: 0xffdfba,
      ambient: 0x201b17
    },
    cellSize: 7.2,
    wallHeight: 3.9,
    darkness: 0.22,
    holeChance: 0.004,
    pipeChance: 0.42,
    batteryChance: 0.10,
    entity: "hound",
    exitStyle: "green",
    exitAfterChunks: 4,
    objective: "Trace the live busbars to the generator control room. Find an elevator out.",
    safe: false,
    ambientIntensity: 0.17,
    fogDensity: 0.005
  },
  "4": {
    id: "4",
    number: "LEVEL 4",
    name: "ABANDONED OFFICE",
    sourceTitle: 'Level 4 - "Abandoned Office"',
    sourceUrl: "https://backrooms-wiki.wikidot.com/level-4",
    next: "5",
    theme: {
      // Empty white office plate — cool grey walls, pale floor, drop ceiling
      wall: 0xd8d8d4,
      wallRough: 0.88,
      floor: 0xb8b8b4,
      ceiling: 0xe8e8e4,
      fog: 0xc9cdd0,
      accent: 0xa0a8b0,
      light: 0xf0f2f5,
      ambient: 0x3a3c40
    },
    cellSize: 12.0,
    wallHeight: 3.6,
    darkness: 0.06,
    holeChance: 0,
    pipeChance: 0.02,
    batteryChance: 0.14,
    entity: "none",
    exitStyle: "green",
    exitAfterChunks: 5,
    objective: "Search the quiet office floors for the stairwell. Stock up before moving on.",
    safe: true, ambientIntensity: 0.24, fogDensity: 0.003
  },
  "5": {
    id: "5", number: "LEVEL 5", name: "TERROR HOTEL",
    sourceTitle: 'Level 5 - "Terror Hotel"', sourceUrl: "https://backrooms-wiki.wikidot.com/level-5", next: "6",
    theme: { wall: 0x704541, wallRough: .88, floor: 0x493238, ceiling: 0xb4a38d, fog: 0x3b3030, accent: 0xd7b36d, light: 0xffdfb5, ambient: 0x30231f },
    cellSize: 10.5, wallHeight: 4.2, darkness: .10, holeChance: 0, pipeChance: 0, entity: "deathmoth", exitStyle: "gold", exitAfterChunks: 4, batteryChance: .12,
    objective: "Find the Beverly Room, then follow the boiler pipes to the service stair.",
    safe: false, ambientIntensity: .16, fogDensity: .004
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
    theme: { wall: 0x263c48, wallRough: .92, floor: 0x10232e, ceiling: 0x25333a, fog: 0x718c98, accent: 0x67a6bd, light: 0xb4d0da, ambient: 0x263b46 },
    cellSize: 14, wallHeight: 4.5, darkness: .34, holeChance: .008, pipeChance: 0, entity: "leviathan", exitStyle: "blue", exitAfterChunks: 4, batteryChance: .08,
    objective: "Descend from the flooded entrance room into the ocean. Find the underwater cave.",
    safe: false, ambientIntensity: .22, fogDensity: .0028
  },
  "8": {
    id: "8", number: "LEVEL 8", name: "CAVE SYSTEMS",
    sourceTitle: 'Level 8 - "Cave Systems"', sourceUrl: "https://backrooms-wiki.wikidot.com/level-8", next: "9",
    theme: { wall: 0x625b50, wallRough: 1, floor: 0x302e28, ceiling: 0x49443b, fog: 0x37352f, accent: 0x9b8b69, light: 0xc4b79d, ambient: 0x1b1a16 },
    cellSize: 8.5, wallHeight: 5.4, darkness: .40, holeChance: .012, pipeChance: 0, entity: "crawler", exitStyle: "green", exitAfterChunks: 4, batteryChance: .11,
    objective: "Follow the marked 9th Road through the flooded cave chambers. Find the exit.",
    safe: false, ambientIntensity: .085, fogDensity: .005
  },
  "9": {
    id: "9", number: "LEVEL 9", name: "THE SUBURBS",
    sourceTitle: 'Level 9 - "The Suburbs"', sourceUrl: "https://backrooms-wiki.wikidot.com/level-9", next: "10",
    theme: { wall: 0x656b68, wallRough: .94, floor: 0x202426, ceiling: 0x15191b, fog: 0x50595a, accent: 0x8b9c91, light: 0xb1beb8, ambient: 0x101619 },
    cellSize: 18, wallHeight: 4.1, darkness: .68, holeChance: 0, pipeChance: 0, entity: "smiler", exitStyle: "green", exitAfterChunks: 4, batteryChance: .10,
    objective: "Follow the wet residential streets. Search the houses, but watch the fog.",
    safe: false, ambientIntensity: .24, fogDensity: .003
  },
  "10": {
    id: "10", number: "LEVEL 10", name: "BUMPER CROP",
    sourceTitle: 'Level 10 - "Bumper Crop"', sourceUrl: "https://backrooms-wiki.wikidot.com/level-10", next: null,
    theme: { wall: 0x9b916b, wallRough: .98, floor: 0x5b5738, ceiling: 0xb3b0a0, fog: 0xa5aaa7, accent: 0xcbb66d, light: 0xe7dfc4, ambient: 0x555548 },
    cellSize: 20, wallHeight: 4.8, darkness: .04, holeChance: 0, pipeChance: 0, entity: "none", exitStyle: "gold", exitAfterChunks: 2, batteryChance: .04,
    objective: "Cross the wheat and barley plots. Find the old farm buildings and the way home.",
    safe: true, ambientIntensity: .52, fogDensity: .0018
  }
};

export function levelById(id){ return LEVELS[String(id)] || LEVELS["0"]; }

export function cycleHash(a,b,c=0){
  let n = (Math.imul(a|0, 374761393) + Math.imul(b|0, 668265263) + Math.imul(c|0, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
