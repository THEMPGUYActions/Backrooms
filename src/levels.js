export const LEVELS = {
  "0": {
    id: "0",
    number: "LEVEL 0",
    name: "THRESHOLD",
    sourceTitle: 'Level 0 - "Threshold"',
    sourceUrl: "https://backrooms-wiki.wikidot.com/level-0",
    next: "1",
    theme: {
      wall: 0xb69c4b,
      wallRough: 0.88,
      floor: 0x5b4c3b,
      ceiling: 0xe8e5dc,
      fog: 0x000000,
      accent: 0xffe992,
      light: 0xffcf42,
      ambient: 0x100e08
    },
    gridSize: 5,
    cellSize: 16,
    wallHeight: 5.2,
    darkness: 0.075,
    holeChance: 0.010,
    pipeChance: 0,
    entity: "figure",
    exitStyle: "mixed",
    exitAfterChunks: 3,
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
      wall: 0x8e9088,
      wallRough: 0.92,
      floor: 0x45443f,
      ceiling: 0x343632,
      fog: 0x000000,
      accent: 0x8fffb0,
      light: 0xe3ead9,
      ambient: 0x39433f
    },
    cellSize: 4.6,
    wallHeight: 3.4,
    darkness: 0.18,
    holeChance: 0.012,
    pipeChance: 0.06,
    entity: "hound",
    exitStyle: "green",
    exitAfterChunks: 4,
    objective: "Stay alert. Find the green-marked exit.",
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
    cellSize: 3.9,
    wallHeight: 3.2,
    darkness: 0.28,
    holeChance: 0,
    pipeChance: 0.28,
    entity: "smiler",
    exitStyle: "violet",
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
    next: null,
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
  }
};

export function levelById(id){ return LEVELS[String(id)] || LEVELS["0"]; }

export function cycleHash(a,b,c=0){
  let n = (Math.imul(a|0, 374761393) + Math.imul(b|0, 668265263) + Math.imul(c|0, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
