// Browser-native Level 0 room templates.
//
// The family/mask mapping follows SpacePotato's MazeCell.java:
// A = 4-way, B = 3-way, C = corner, D = straight hallway, E = dead-end.
// The original project stores these as Minecraft NBT structures. This file
// deliberately does NOT ship those binaries. These are recreated Three.js
// template parameters for the browser build.

export const LEVEL0_ROOM_FAMILY_BY_MASK = Object.freeze({
  0:"A",
  1:"B", 2:"B", 4:"B", 8:"B",
  3:"C", 6:"C", 9:"C", 12:"C",
  5:"D", 10:"D",
  7:"E", 11:"E", 13:"E", 14:"E"
});

export const LEVEL0_ROOM_VARIANTS = Object.freeze({
  A:Object.freeze([
    {doorWidth:4.2,pillars:[[4,4,1.0],[12,4,.82],[4,12,.82],[12,12,1.0]],returns:[[2.8,2.8,2.2,.58,0],[13.2,13.2,2.2,.58,0]]},
    {doorWidth:4.8,pillars:[[4,4,.9],[12,4,.9],[4,12,.9],[12,12,.9]],returns:[[3.2,12,3.1,.54,0],[12,3.2,3.1,.54,Math.PI/2]]},
    {doorWidth:5.1,pillars:[[3.4,3.4,.78],[12.6,3.4,1.05],[3.4,12.6,1.05],[12.6,12.6,.78]],returns:[[3.1,3.1,.54,2.9,0],[12.9,12.9,.54,2.9,0]]},
    {doorWidth:4.4,pillars:[[5,3.6,.82],[11,12.4,.82]],returns:[[3.4,6.2,2.8,.52,0],[12.6,9.8,2.8,.52,0]]},
    {doorWidth:4.7,pillars:[[3.6,8,.9],[12.4,8,.9]],returns:[[3.1,3.1,.52,3.2,0],[12.9,12.9,.52,3.2,0]]},
    {doorWidth:5.0,pillars:[[4.2,4.2,1.05],[11.8,11.8,1.05]],returns:[[12,4,3.2,.5,0],[4,12,3.2,.5,0]]},
    {doorWidth:4.0,pillars:[[3.5,3.5,.72],[12.5,3.5,.72],[8,12.5,.92]],returns:[[2.9,13.1,3,.48,0]]},
    {doorWidth:4.6,pillars:[[4,4,.84],[12,4,.84],[8,12,.84]],returns:[[3.2,8,2.4,.5,0],[12.8,8,2.4,.5,0]]}
  ]),
  B:Object.freeze([
    {doorWidth:4.4,pillars:[[4,5,.9],[12,5,.85]],returns:[[3.0,3.0,2.8,.56,0],[13,3.0,2.8,.56,0]]},
    {doorWidth:4.9,pillars:[[4,7,.82],[12,7,.82]],returns:[[3.1,5.0,2.9,.52,0],[12.9,5.0,2.9,.52,0]]},
    {doorWidth:4.1,pillars:[[4.1,4.2,.8],[11.9,4.2,.8]],returns:[[3.0,4.2,2.5,.48,0],[13.0,4.2,2.5,.48,0]]},
    {doorWidth:5.2,pillars:[[3.8,6.0,.88],[12.2,6.0,.88]],returns:[[3.0,9.5,3.0,.54,0],[13.0,9.5,3.0,.54,0]]},
    {doorWidth:4.6,pillars:[[5,5.2,.76],[11,5.2,1.0]],returns:[[3.0,3.1,3.2,.5,0],[13,3.1,2.2,.5,0]]},
    {doorWidth:4.3,pillars:[[3.7,5,.9],[12.3,5,.72]],returns:[[3.0,8.9,2.5,.5,0]]},
    {doorWidth:4.8,pillars:[[4,5,.8],[12,5,.8]],returns:[[3.1,3.2,.5,3.0,Math.PI/2],[12.9,3.2,.5,3.0,Math.PI/2]]},
    {doorWidth:4.5,pillars:[[4.2,5.4,.95],[11.8,5.4,.95]],returns:[[3.0,8.7,2.7,.48,0],[13,8.7,2.0,.48,0]]}
  ]),
  C:Object.freeze([
    {doorWidth:4.3,pillars:[[5,5,.92]],returns:[[3.0,3.0,3.4,.56,0],[3.0,3.0,.56,3.4,Math.PI/2]]},
    {doorWidth:4.8,pillars:[[11,5,.82]],returns:[[3.1,3.1,3.0,.52,0],[3.1,3.1,.52,3.0,Math.PI/2]]},
    {doorWidth:4.2,pillars:[[6,6,.78]],returns:[[2.9,2.9,4.1,.48,0],[2.9,2.9,.48,4.1,Math.PI/2]]},
    {doorWidth:5.0,pillars:[[5.0,6.0,.9]],returns:[[3.2,3.0,2.8,.5,0],[3.0,3.2,.5,2.8,Math.PI/2]]},
    {doorWidth:4.5,pillars:[[7,4.8,.78]],returns:[[3.0,3.0,3.8,.5,0],[3.0,3.0,.5,2.4,Math.PI/2]]},
    {doorWidth:4.6,pillars:[[4.6,7,.95]],returns:[[3.2,3.0,2.6,.54,0],[3.0,3.2,.54,3.2,Math.PI/2]]},
    {doorWidth:4.0,pillars:[[6.8,6.8,.82]],returns:[[2.8,2.8,4.0,.48,0],[2.8,2.8,.48,3.2,Math.PI/2]]},
    {doorWidth:5.1,pillars:[[5.2,5.2,.86]],returns:[[3.0,3.0,2.2,.54,0],[3.0,3.0,.54,3.8,Math.PI/2]]}
  ]),
  D:Object.freeze([
    {doorWidth:4.3,pillars:[[4,8,.84],[12,8,.84]],returns:[[3.2,3.0,.5,3.6,Math.PI/2],[12.8,3.0,.5,3.6,Math.PI/2]]},
    {doorWidth:4.8,pillars:[[5,8,.82],[11,8,.82]],returns:[[3.0,3.0,.5,3.0,Math.PI/2],[13,3.0,.5,3.0,Math.PI/2]]},
    {doorWidth:4.1,pillars:[[4.1,8,.9],[11.9,8,.9]],returns:[[3.0,5.1,.48,2.6,Math.PI/2],[13.0,5.1,.48,2.6,Math.PI/2]]},
    {doorWidth:5.0,pillars:[[4.5,8,.78],[11.5,8,1.0]],returns:[[3.0,3.2,.5,4.1,Math.PI/2],[13.0,5.0,.5,2.6,Math.PI/2]]},
    {doorWidth:4.5,pillars:[[3.5,8,.74],[12.5,8,.74]],returns:[[3.0,12.7,.52,2.1,Math.PI/2],[13,12.7,.52,2.1,Math.PI/2]]},
    {doorWidth:4.7,pillars:[[5.2,8,.86],[10.8,8,.86]],returns:[[3.2,4.0,.5,2.8,Math.PI/2],[12.8,4.0,.5,2.8,Math.PI/2]]},
    {doorWidth:4.0,pillars:[[4,7.5,.82],[12,7.5,.82]],returns:[[3.0,3.0,.52,2.8,Math.PI/2],[13,10.5,.52,2.8,Math.PI/2]]},
    {doorWidth:5.2,pillars:[[4.3,8,.92],[11.7,8,.92]],returns:[[3.0,5.0,.48,3.2,Math.PI/2],[13,5.0,.48,3.2,Math.PI/2]]}
  ]),
  E:Object.freeze([
    {doorWidth:4.2,pillars:[[8,10,.92]],returns:[[4.0,7.0,.56,4.0,Math.PI/2],[12,7.0,.56,4.0,Math.PI/2]]},
    {doorWidth:4.7,pillars:[[8,10,.8]],returns:[[3.8,7.2,.5,4.4,Math.PI/2],[12.2,7.2,.5,4.4,Math.PI/2]]},
    {doorWidth:4.0,pillars:[[8,9.4,.86]],returns:[[4.2,6.7,.54,3.8,Math.PI/2],[11.8,6.7,.54,3.8,Math.PI/2]]},
    {doorWidth:5.0,pillars:[[8,9.8,1.0]],returns:[[3.6,7.0,.52,4.0,Math.PI/2],[12.4,7.0,.52,4.0,Math.PI/2]]},
    {doorWidth:4.4,pillars:[[8,10.4,.8]],returns:[[4.4,6.6,.48,3.0,Math.PI/2],[11.6,9.2,.48,2.8,Math.PI/2]]},
    {doorWidth:4.8,pillars:[[8,10,.9]],returns:[[3.8,7.5,.5,4.4,Math.PI/2],[12.2,7.5,.5,4.4,Math.PI/2],[8,6.0,3.0,.46,0]]},
    {doorWidth:4.1,pillars:[[8,10,.76]],returns:[[4.2,7.0,.5,3.4,Math.PI/2],[11.8,7.0,.5,3.4,Math.PI/2],[8,5.9,2.4,.44,0]]},
    {doorWidth:5.1,pillars:[[8,10.2,.94]],returns:[[3.5,7.1,.54,4.5,Math.PI/2],[12.5,7.1,.54,4.5,Math.PI/2]]}
  ])
});

export const LEVEL0_MEGA_TEMPLATES = Object.freeze({
  1:Object.freeze({
    size:32,
    pillars:[[5,5,1.15],[27,5,.95],[5,27,.95],[27,27,1.15],[16,16,.78]],
    parts:[[8,2.8,6,.5,0],[24,2.8,6,.5,0],[2.8,8,.5,6,Math.PI/2],[29.2,8,.5,6,Math.PI/2],
           [8,29.2,6,.5,0],[24,29.2,6,.5,0],[2.8,24,.5,6,Math.PI/2],[29.2,24,.5,6,Math.PI/2]]
  }),
  2:Object.freeze({
    size:32,
    pillars:[[5,5,.9],[27,5,.9],[5,27,.9],[27,27,.9]],
    parts:[[8,8,.55,12,Math.PI/2],[24,24,.55,12,Math.PI/2],[8,24,12,.55,0],[24,8,12,.55,0]]
  }),
  3:Object.freeze({
    size:32,
    pillars:[[6,6,1.0],[26,6,1.0],[6,26,1.0],[26,26,1.0]],
    parts:[[16,4.0,18,.62,0],[16,28,18,.62,0]]
  }),
  4:Object.freeze({
    size:32,
    pillars:[[6,6,.82],[16,6,.82],[26,6,.82],[6,16,.82],[26,16,.82],[6,26,.82],[16,26,.82],[26,26,.82]],
    parts:[[10,16,.52,14,Math.PI/2],[22,16,.52,14,Math.PI/2]]
  }),
  5:Object.freeze({
    size:32,
    pillars:[[7,7,1.0],[25,7,.84],[7,25,.84],[25,25,1.0]],
    parts:[[16,7,12,.5,0],[16,25,12,.5,0],[7,16,.5,8,Math.PI/2],[25,16,.5,8,Math.PI/2],[16,16,5,.48,0]]
  }),
  6:Object.freeze({
    size:32,
    pillars:[[8,8,.78],[24,8,.78],[16,24,.92]],
    parts:[[6,16,6,.5,0],[26,16,6,.5,0],[16,26,8,.5,0]]
  })
});

export function level0RoomFamily(mask){
  return LEVEL0_ROOM_FAMILY_BY_MASK[mask] || "A";
}

export function level0RoomVariant(mask,index){
  const family=level0RoomFamily(mask);
  const list=LEVEL0_ROOM_VARIANTS[family];
  return {family,index:Math.max(0,Math.min(list.length-1,index|0)),...list[Math.max(0,Math.min(list.length-1,index|0))]};
}

export function level0RotationForMask(mask){
  if(mask===1||mask===9||mask===13)return 0;
  if(mask===2||mask===6||mask===14)return Math.PI/2;
  if(mask===4||mask===12||mask===7)return Math.PI;
  if(mask===8||mask===3||mask===11)return -Math.PI/2;
  if(mask===5)return 0;
  if(mask===10)return Math.PI/2;
  return 0;
}

export function rotateLevel0Local(x,z,rotation,size=16){
  const c=size/2,dx=x-c,dz=z-c;
  const cr=Math.cos(rotation),sr=Math.sin(rotation);
  return {x:c+dx*cr-dz*sr,z:c+dx*sr+dz*cr};
}
