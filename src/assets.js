import * as THREE from "three";
THREE.Cache.enabled=true;

const LOCAL_PBR_ASSET_BASE = new URL("../assets/pbr/", import.meta.url).href;
const LOCAL_SPB_ASSET_BASE = new URL("../assets/spb-ff/", import.meta.url).href;

export const LEVEL1_ASSET_SOURCES = Object.freeze({
  concreteColor: LOCAL_SPB_ASSET_BASE + "pbr/concrete/concrete_color.png",
  concreteNormal: LOCAL_SPB_ASSET_BASE + "pbr/concrete/concrete_normal.png",
  brickColor: LOCAL_SPB_ASSET_BASE + "pbr/bricks/bricks_color.png",
  crateColor: LOCAL_SPB_ASSET_BASE + "pbr/crate/crate_color.png",
  fluorescent: LOCAL_SPB_ASSET_BASE + "fluorescent_light.png",
  wallTrim: LOCAL_SPB_ASSET_BASE + "wall_trim_texture.png",
  stairs: LOCAL_SPB_ASSET_BASE + "newstairs_texture.png"
});

export const BACKROOMS_PBR_SOURCES = Object.freeze({
  wallpaper: {
    color: LOCAL_PBR_ASSET_BASE + "wallpaper_color.png",
    rough: LOCAL_PBR_ASSET_BASE + "wallpaper_rough.png",
    normal: LOCAL_PBR_ASSET_BASE + "wallpaper_normal.png"
  },
  carpet: {
    color: LOCAL_PBR_ASSET_BASE + "carpet_color.png",
    rough: LOCAL_PBR_ASSET_BASE + "carpet_rough.png",
    normal: LOCAL_PBR_ASSET_BASE + "carpet_normal.png"
  },
  paintedWall: {
    color: LOCAL_PBR_ASSET_BASE + "painted_wall_color.png",
    rough: LOCAL_PBR_ASSET_BASE + "painted_wall_rough.png",
    normal: LOCAL_PBR_ASSET_BASE + "painted_wall_normal.png"
  },
  ceiling: {
    color: LOCAL_PBR_ASSET_BASE + "ceiling_tiles_color.png",
    rough: LOCAL_PBR_ASSET_BASE + "ceiling_tiles_rough.png",
    normal: LOCAL_PBR_ASSET_BASE + "ceiling_tiles_normal.png"
  }
});

const remoteTextureCache = new Map();

function noise2d(x,y,s){
  let n=(Math.imul((x+s)|0,374761393)+Math.imul((y+s)|0,668265263))|0;
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967296;
}

function makeCanvas(size,fn){
  const c=document.createElement("canvas");c.width=c.height=size;
  const ctx=c.getContext("2d"), img=ctx.createImageData(size,size), d=img.data;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)fn(x,y,d,(y*size+x)*4);
  ctx.putImageData(img,0,0);return c;
}

function tex(canvas,color=true){
  const t=new THREE.CanvasTexture(canvas);
  t.wrapS=THREE.RepeatWrapping;t.wrapT=THREE.RepeatWrapping;t.anisotropy=2;
  if(color)t.colorSpace=THREE.SRGBColorSpace;
  t.userData.backroomsOwned=true;
  return t;
}

function configureTexture(t,{color=false,repeat=1}={}){
  t.wrapS=THREE.RepeatWrapping;
  t.wrapT=THREE.RepeatWrapping;
  t.repeat.set(repeat,repeat);
  t.anisotropy=2;
  if(color)t.colorSpace=THREE.SRGBColorSpace;
  else t.colorSpace=THREE.NoColorSpace;
  t.needsUpdate=true;
  return t;
}

function loadRemoteTexture(url,color=false){
  if(remoteTextureCache.has(url))return remoteTextureCache.get(url);
  const promise=new Promise((resolve,reject)=>{
    const loader=new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      texture=>resolve(configureTexture(texture,{color,repeat:1})),
      undefined,
      error=>reject(error||new Error("Texture failed to load"))
    );
  });
  remoteTextureCache.set(url,promise);
  return promise;
}

async function applyRemoteTexture(material,kind,url,color,repeat,normalStrength){
  try{
    const texture=await loadRemoteTexture(url,color);
    texture.repeat.set(repeat,repeat);
    const previous=kind==="map"?material.map:kind==="roughnessMap"?material.roughnessMap:material.normalMap;
    if(previous?.userData?.backroomsOwned)previous.dispose();
    if(kind==="map")material.map=texture;
    else if(kind==="roughnessMap")material.roughnessMap=texture;
    else material.normalMap=texture;
    if(kind==="normalMap")material.normalScale.set(normalStrength,normalStrength);
    material.needsUpdate=true;
  }catch(error){
    console.warn("[Backrooms] OpenGameArt texture unavailable, keeping procedural fallback:",url,error);
  }
}

export async function applyOpenGameArtPBR(library,level,onProgress=()=>{}){
  if(level.id==="1")return false;
  const source=level.id==="0"
    ? {wall:BACKROOMS_PBR_SOURCES.wallpaper,floor:BACKROOMS_PBR_SOURCES.carpet}
    : {wall:BACKROOMS_PBR_SOURCES.paintedWall,floor:BACKROOMS_PBR_SOURCES.carpet};
  const wallRepeat=level.id==="0"?2.4:3.0,floorRepeat=level.id==="0"?4.8:4.2,ceilingRepeat=1.0;
  const dataMaps=[
    ["wall","roughnessMap",source.wall.rough,false,wallRepeat,.28,"Roughness // wallpaper"],
    ["wall","normalMap",source.wall.normal,false,wallRepeat,.28,"Normal // wallpaper"],
    ["floor","roughnessMap",source.floor.rough,false,floorRepeat,.16,"Roughness // carpet"],
    ["floor","normalMap",source.floor.normal,false,floorRepeat,.16,"Normal // carpet"],
    ["ceiling","roughnessMap",BACKROOMS_PBR_SOURCES.ceiling.rough,false,ceilingRepeat,.25,"Roughness // ceiling"],
    ["ceiling","normalMap",BACKROOMS_PBR_SOURCES.ceiling.normal,false,ceilingRepeat,.25,"Normal // ceiling"]
  ];
  const level0Data=level.id==="0"?[
    ["redWall","roughnessMap",source.wall.rough,false,wallRepeat,.28,"Roughness // red wallpaper"],
    ["redWall","normalMap",source.wall.normal,false,wallRepeat,.28,"Normal // red wallpaper"],
    ["redFloor","roughnessMap",source.floor.rough,false,floorRepeat,.16,"Roughness // red carpet"],
    ["redFloor","normalMap",source.floor.normal,false,floorRepeat,.16,"Normal // red carpet"],
    ["manilaWall","roughnessMap",source.wall.rough,false,wallRepeat,.28,"Roughness // Manila wallpaper"],
    ["manilaWall","normalMap",source.wall.normal,false,wallRepeat,.28,"Normal // Manila wallpaper"]
  ]:[];
  const colorMaps=[
    ["wall","map",source.wall.color,true,wallRepeat,.28,"Color // wallpaper"],
    ["floor","map",source.floor.color,true,floorRepeat,.16,"Color // carpet"],
    ["ceiling","map",BACKROOMS_PBR_SOURCES.ceiling.color,true,ceilingRepeat,.25,"Color // ceiling"]
  ];
  const level0Colors=level.id==="0"?[
    ["redWall","map",source.wall.color,true,wallRepeat,.28,"Color // red wallpaper"],
    ["redFloor","map",source.floor.color,true,floorRepeat,.16,"Color // red carpet"],
    ["manilaWall","map",source.wall.color,true,wallRepeat,.28,"Color // Manila wallpaper"]
  ]:[];
  const maps=[...dataMaps,...level0Data,...colorMaps,...level0Colors];
  const dataCount=dataMaps.length+level0Data.length,total=maps.length;
  let done=0;
  const loadOne=async(entry)=>{
    const [materialName,kind,url,color,repeat,normalStrength,label]=entry;
    onProgress(done/total,done<dataCount?"CALIBRATING SURFACES":"LOADING COLORS",label);
    await applyRemoteTexture(library[materialName],kind,url,color,repeat,normalStrength);
    done++;onProgress(done/total,done<=dataCount?"CALIBRATING SURFACES":"LOADING COLORS",label);
  };
  await Promise.all(maps.slice(0,dataCount).map(loadOne));
  await Promise.all(maps.slice(dataCount).map(loadOne));
  onProgress(1,"SURFACES READY","Bundled PBR surfaces loaded");
  return true;
}

function normalFromHeight(size,seed){
  const h=[];
  for(let y=0;y<size;y++){h[y]=[];for(let x=0;x<size;x++)h[y][x]=noise2d(x,y,seed)*255}
  return makeCanvas(size,(x,y,d,i)=>{
    const l=h[y][(x+size-1)%size],r=h[y][(x+1)%size],u=h[(y+size-1)%size][x],dn=h[(y+1)%size][x];
    d[i]=Math.max(0,Math.min(255,128+(l-r)*.48));
    d[i+1]=Math.max(0,Math.min(255,128+(u-dn)*.48));
    d[i+2]=255;d[i+3]=255;
  });
}

export function createPBRMaterial({base,seed=1,rough=.9,metal=0,scale=4,normalStrength=.45}){
  const r0=(base>>16)&255,g0=(base>>8)&255,b0=base&255,size=64;
  const baseCanvas=makeCanvas(size,(x,y,d,i)=>{
    const n=noise2d(x>>2,y>>2,seed)*.72+noise2d(x,y,seed+11)*.28;
    const factor=.84+n*.26;
    d[i]=Math.max(0,Math.min(255,r0*factor));
    d[i+1]=Math.max(0,Math.min(255,g0*factor));
    d[i+2]=Math.max(0,Math.min(255,b0*factor));
    d[i+3]=255;
  });
  const roughCanvas=makeCanvas(size,(x,y,d,i)=>{
    const n=noise2d(x,y,seed+73);
    const v=Math.max(25,Math.min(255,rough*255+n*34));
    d[i]=d[i+1]=d[i+2]=v;d[i+3]=255;
  });
  const m=new THREE.MeshStandardMaterial({
    color:0xffffff,roughness:rough,metalness:metal,
    map:tex(baseCanvas,true),roughnessMap:tex(roughCanvas,false),normalMap:tex(normalFromHeight(size,seed+41),false),
    normalScale:new THREE.Vector2(normalStrength,normalStrength)
  });
  m.map.repeat.set(scale,scale);m.roughnessMap.repeat.set(scale,scale);m.normalMap.repeat.set(scale,scale);
  return m;
}

export async function applyLevel1Assets(library,level,onProgress=()=>{}){
  if(level.id!=="1")return false;
  const maps=[
    [library.floor,"map",LEVEL1_ASSET_SOURCES.concreteColor,true,3.2,.18,"Concrete floor"],
    [library.floor,"normalMap",LEVEL1_ASSET_SOURCES.concreteNormal,false,3.2,.22,"Concrete floor normal"],
    [library.ceiling,"map",LEVEL1_ASSET_SOURCES.concreteColor,true,3.2,.18,"Concrete ceiling"],
    [library.ceiling,"normalMap",LEVEL1_ASSET_SOURCES.concreteNormal,false,3.2,.22,"Concrete ceiling normal"],
    [library.concrete,"map",LEVEL1_ASSET_SOURCES.concreteColor,true,3.2,.18,"Concrete walls"],
    [library.concrete,"normalMap",LEVEL1_ASSET_SOURCES.concreteNormal,false,3.2,.22,"Concrete wall normal"],
    [library.maintenanceWall,"map",LEVEL1_ASSET_SOURCES.brickColor,true,2.4,.20,"White brick corridors"],
    [library.crate,"map",LEVEL1_ASSET_SOURCES.crateColor,true,1,.16,"Wooden crates"],
    [library.level1Light,"map",LEVEL1_ASSET_SOURCES.fluorescent,true,1,.18,"Fluorescent fixtures"],
    [library.trim,"map",LEVEL1_ASSET_SOURCES.wallTrim,true,1,.12,"Wall trim"],
    [library.trimTop,"map",LEVEL1_ASSET_SOURCES.wallTrim,true,1,.12,"Wall trim top"],
    [library.stairs,"map",LEVEL1_ASSET_SOURCES.stairs,true,1,.12,"Concrete stairs"]
  ];
  let done=0;
  onProgress(0,"LOADING LEVEL 1 ASSETS","Level 1 reference materials");
  await Promise.all(maps.map(async([material,kind,url,color,repeat,normalStrength,label])=>{
    await applyRemoteTexture(material,kind,url,color,repeat,normalStrength);
    done++;
    onProgress(done/maps.length,"LOADING LEVEL 1 ASSETS",label);
  }));
  return true;
}

export function disposeMaterial(material){
  if(!material)return;
  for(const key of ["map","roughnessMap","normalMap","metalnessMap","aoMap","emissiveMap","alphaMap"]){
    const texture=material[key];
    if(texture && texture.userData?.backroomsOwned)texture.dispose();
  }
  material.dispose();
}

export function disposeLibrary(library){
  if(!library)return;
  for(const [key,material] of Object.entries(library)){
    if(material?.isMaterial && key!=="exit")disposeMaterial(material);
  }
  if(library.exit?.isMaterial)disposeMaterial(library.exit);
}

export function makeLibrary(level){
  const ceiling=createPBRMaterial({base:level.id==="1"?0x767976:level.theme.ceiling,seed:89+Number(level.id),rough:level.id==="1"?.97:.9,scale:level.id==="1"?4:2,normalStrength:level.id==="1"?.22:.24});
  ceiling.side=THREE.FrontSide;
  ceiling.color.setHex(level.theme.ceiling);
  ceiling.emissive=new THREE.Color(level.id==="0"?0x776621:0x252725);
  ceiling.emissiveIntensity=level.id==="0"?.055:level.id==="1"?0:.028;
  return {
    floor:createPBRMaterial({base:level.id==="1"?0x666966:level.theme.floor,seed:17+Number(level.id),rough:.98,scale:5,normalStrength:.18}),
    wall:createPBRMaterial({base:level.theme.wall,seed:29+Number(level.id),rough:level.theme.wallRough,scale:level.id==="0"?1:3.8,normalStrength:.35}),
    wall2:createPBRMaterial({base:level.theme.wall,seed:129+Number(level.id),rough:level.theme.wallRough,scale:1,normalStrength:.35}),
    wallBottom:createPBRMaterial({base:level.theme.wall,seed:129+Number(level.id),rough:level.theme.wallRough,scale:1,normalStrength:.08}),
    wallBottom2:createPBRMaterial({base:level.theme.wall,seed:131+Number(level.id),rough:level.theme.wallRough,scale:1,normalStrength:.08}),
    concrete:createPBRMaterial({base:level.id==="1"?0xcfd0cb:level.theme.wall,seed:57+Number(level.id),rough:.97,scale:5.5,normalStrength:.3}),
    maintenanceWall:createPBRMaterial({base:0xe4e3dc,seed:117+Number(level.id),rough:.9,scale:2.4,normalStrength:.28}),
    stairs:new THREE.MeshStandardMaterial({color:0x8b8d89,roughness:.88,metalness:0}),
    parkingLine:new THREE.MeshStandardMaterial({color:0xb5b8b4,roughness:.82,metalness:0}),
    warningLine:new THREE.MeshStandardMaterial({color:0xc0a84a,roughness:.76,metalness:0}),
    garageBeam:new THREE.MeshStandardMaterial({color:0x383a39,roughness:.88,metalness:0}),
    garageBase:new THREE.MeshStandardMaterial({color:0x555957,roughness:.86,metalness:0}),
    puddle:new THREE.MeshStandardMaterial({color:0x0b0e10,roughness:.045,metalness:.18,transparent:true,opacity:.63}),
    level1Light:new THREE.MeshStandardMaterial({color:0xffffff,roughness:.28,metalness:0,emissive:0xfff8e8,emissiveIntensity:2.9}),
    ceiling,
    metal:new THREE.MeshStandardMaterial({color:0x3d3f3e,roughness:.62,metalness:.78}),
    cable:new THREE.MeshStandardMaterial({color:0x171817,roughness:.79,metalness:.58}),
    water:new THREE.MeshStandardMaterial({color:0x263236,roughness:.09,metalness:.18,transparent:true,opacity:.72}),
    dark:new THREE.MeshStandardMaterial({color:0x030303,roughness:1,metalness:0}),
    crate:new THREE.MeshStandardMaterial({color:0x6e5132,roughness:.92,metalness:0}),
    trim:new THREE.MeshStandardMaterial({color:0xf4f0e3,roughness:.66,metalness:0}),
    trimTop:new THREE.MeshStandardMaterial({color:0xe8e5dc,roughness:.72,metalness:0}),
    outlet:new THREE.MeshStandardMaterial({color:0xe7e4dc,roughness:.58,metalness:0}),
    socket:new THREE.MeshStandardMaterial({color:0x2a2824,roughness:.88,metalness:0}),
    intercom:new THREE.MeshStandardMaterial({color:0xcac5b5,roughness:.72,metalness:.12}),
    intercomSlot:new THREE.MeshStandardMaterial({color:0x302f2b,roughness:.9,metalness:0}),
    cameraDome:new THREE.MeshStandardMaterial({color:0x252522,roughness:.55,metalness:.42}),
    handle:new THREE.MeshStandardMaterial({color:0x8b8067,roughness:.34,metalness:.72}),
    door:new THREE.MeshStandardMaterial({color:0xd8d2be,roughness:.73,metalness:.02}),
    doorFrame:new THREE.MeshStandardMaterial({color:0xf0eee5,roughness:.6,metalness:0}),
    exitDoor:new THREE.MeshStandardMaterial({color:0xd8d1bd,roughness:.68,metalness:.03,emissive:level.theme.accent,emissiveIntensity:.12}),
    exitFrame:new THREE.MeshStandardMaterial({color:0xf3f0e4,roughness:.56,metalness:0}),
    wallAnomaly:new THREE.MeshStandardMaterial({color:0xd2bf61,roughness:.72,metalness:0,emissive:0xffdc69,emissiveIntensity:.7}),
    redWall:createPBRMaterial({base:0x651713,seed:211,rough:.94,scale:1,normalStrength:.28}),
    redFloor:createPBRMaterial({base:0x3d1714,seed:212,rough:.99,scale:5,normalStrength:.12}),
    manilaWall:createPBRMaterial({base:0x8a7357,seed:213,rough:.9,scale:1.2,normalStrength:.22}),
    mold:new THREE.MeshStandardMaterial({color:0x4e5437,roughness:1,metalness:0}),
    exit:new THREE.MeshStandardMaterial({color:0xffffff,roughness:.38,metalness:.1,emissive:level.theme.accent,emissiveIntensity:1.2}),
    light:new THREE.MeshStandardMaterial({color:0xfff5d3,roughness:.34,metalness:0,emissive:0xffcf5b,emissiveIntensity:3.0}),
    redLight:new THREE.MeshStandardMaterial({color:0x9a2825,roughness:.42,metalness:0,emissive:0x6e1714,emissiveIntensity:1.5}),
    orangeLight:new THREE.MeshStandardMaterial({color:0xffe0b6,roughness:.34,metalness:0,emissive:0xff9b52,emissiveIntensity:2.2}),
    battery:new THREE.MeshStandardMaterial({color:0x1c1d1b,roughness:.55,metalness:.35}),
    batteryLabel:new THREE.MeshStandardMaterial({color:0xc9b85f,roughness:.45,metalness:.15,emissive:0x6f5b1c,emissiveIntensity:.45}),
    windowDark:new THREE.MeshStandardMaterial({color:0x121412,roughness:.9,metalness:.05}),
    officeWood:new THREE.MeshStandardMaterial({color:0x6a6253,roughness:.86,metalness:0}),
    officePlastic:new THREE.MeshStandardMaterial({color:0x343634,roughness:.72,metalness:.12}),
    indicator:new THREE.MeshStandardMaterial({color:0xff8a3c,roughness:.35,metalness:.1,emissive:0xff5d14,emissiveIntensity:2.2})
  };
}

export function box(parent,geometry,material,x,y,z,rx=0,ry=0,rz=0){
  const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);parent.add(m);return m;
}

export function makePropSet(parent,level,library,rng,x,z){
  if(rng()<.09 && level.id!=="0"){
    box(parent,new THREE.BoxGeometry(.8,.7,.8),library.crate,x,.35,z);
    box(parent,new THREE.BoxGeometry(.86,.06,.86),library.metal,x,.72,z);
  }
  if(rng()<level.pipeChance){
    const pipe=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,4.4,8),library.metal);
    pipe.rotation.z=Math.PI/2;pipe.position.set(x,2.7,z);parent.add(pipe);
  }
}
