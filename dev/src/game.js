import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { InputManager } from "./input.js?v=20261120-level7-ocean-sky-swim1";
import { Level1Reflection } from "./level1-wet.js?v=20261120-level7-ocean-sky-swim1";
import { AudioDirector } from "./audio.js?v=20260926-redzone-audio4";
import { LEVELS, levelById, cycleHash } from "./levels.js?v=20261120-level4-office-level1-multifloor1";
import { makeLibrary, applyFoundFootageLevel0Assets, applyOpenGameArtPBR, applyIndustrialPBR, applyLevelSpecificPBR, applyLevel1Assets, disposeLibrary, tileGeometryUV, box, makePropSet } from "./assets.js?v=20261125-level0-architecture-daylight-sky1";
import { EntityModelLibrary } from "./entity-models.js?v=20261024-bacteria-roof3";

function oceanSurfaceHeight(x,z,time){
  return .02+Math.sin(x*.19+time*.72)*.13+Math.sin(z*.15-time*.61)*.08+Math.sin((x+z)*.09+time*.43)*.05;
}

const LEVEL1_UPPER_FLOOR_Y=LEVELS["1"].wallHeight/2;
const LEVEL1_FLOOR_SLAB_THICKNESS=.28;

const VHSShader={
  name:"BackroomsVHS",
  uniforms:{
    tDiffuse:{value:null},
    time:{value:0},
    intensity:{value:.72},
    tracking:{value:.24},
    fear:{value:0},
    resolution:{value:new THREE.Vector2(1,1)}
  },
  vertexShader:`varying vec2 vUv;
    void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`uniform sampler2D tDiffuse;
    uniform float time;
    uniform float intensity;
    uniform float tracking;
    uniform float fear;
    uniform vec2 resolution;
    varying vec2 vUv;
    out vec4 backroomsFragColor;

    float hash(vec2 p){
      return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);
    }
    float valueNoise(vec2 p){
      vec2 i=floor(p),f=fract(p);
      f=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),
                 mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y);
    }
    vec2 tapeWarp(vec2 uv,float t){
      float lineBlock=floor(uv.y*resolution.y*.07);
      float low=valueNoise(vec2(lineBlock*.43,t*1.25));
      float hi=valueNoise(vec2(floor(uv.y*resolution.y*.34),t*6.0));
      uv.x+=(low-.5)*.0017*tracking+(hi-.5)*.00055*tracking;
      float tearSeed=floor(t*2.0);
      float tearY=hash(vec2(tearSeed,41.0));
      float tear=(1.0-smoothstep(0.0,.014,abs(uv.y-tearY)))*step(.84,hash(vec2(tearSeed,52.0)));
      uv.x+=tear*.012;
      uv.y+=tear*(hash(vec2(tearSeed,63.0))-.5)*.002;
      return uv;
    }
    void main(){
      vec2 p=vUv-.5;
      float r=dot(p,p);
      p*=1.0+r*(.045+.02*fear);
      vec2 uv=tapeWarp(p+.5,time);

      float line=floor(uv.y*resolution.y);
      float frame=floor(time*24.0);
      float chroma=(.0017+.0018*fear)*intensity;

      vec3 center=texture(tDiffuse,uv).rgb;
      vec3 left=texture(tDiffuse,uv-vec2(chroma,0.0)).rgb;
      vec3 right=texture(tDiffuse,uv+vec2(chroma,0.0)).rgb;
      vec3 c=vec3(left.r*.5+center.r*.5,
                  center.g*.8+left.g*.1+right.g*.1,
                  right.b*.5+center.b*.5);

      float lum=dot(c,vec3(.299,.587,.114));
      c=mix(c,vec3(lum),.035+.04*intensity);

      float fine=hash(floor(uv*resolution*1.08)+vec2(frame*1.31,frame*.71))-.5;
      float coarse=valueNoise(vec2(floor(uv.x*resolution.x/9.0),floor(uv.y*resolution.y/7.0))+frame*.07)-.5;
      c+=vec3(fine*.042*intensity+coarse*.02*intensity);

      float scan=.978+.022*sin((line+frame*.18)*3.14159);
      c*=scan;

      float flutter=(hash(vec2(frame,91.0))-.5)*.014*intensity;
      c+=flutter;

      float dropout=step(.994,hash(vec2(floor(line/3.0),floor(time*4.0))));
      c*=1.0-dropout*.3*intensity;

      vec2 edge=abs(vUv-.5)*2.0;
      float vignette=1.0-smoothstep(.55,1.0,max(edge.x,edge.y));
      c*=mix(.7,1.0,vignette);

      backroomsFragColor=vec4(max(c,0.0),1.0);
    }`
};

const CELLS=16;
const BASE_RADIUS=1;
const MAX_DT=.05;
const LEVELS_WITHOUT_GLOBAL_CEILING=new Set(["4","6","7","9","10","37"]);
const QUERY_PARAMS=new URLSearchParams(location.search);
function queryFlag(name){
  if(!QUERY_PARAMS.has(name))return false;
  const value=String(QUERY_PARAMS.get(name)||"").trim().toLowerCase();
  return value===""||value==="1"||value==="true"||value==="yes"||value==="on";
}

function isTouchControlsDevice(){
  const coarse=matchMedia("(pointer:coarse)").matches;
  const fine=matchMedia("(pointer:fine)").matches;
  const touchPoints=Number.isFinite(navigator.maxTouchPoints)?navigator.maxTouchPoints:0;
  return coarse&&!fine||(touchPoints>0&&!fine);
}

class RNG{
  constructor(seed){this.s=(seed|0)||1}
  next(){let x=this.s|0;x^=x<<13;x^=x>>>17;x^=x<<5;this.s=x|0;return (x>>>0)/4294967296}
  int(a,b){return Math.floor(a+this.next()*(b-a+1))}
  pick(a){return a[Math.floor(this.next()*a.length)]}
}

function canonicalOpen(seed,gx,gz,axis,chance=.19){
  return cycleHash(seed^gx,gz,axis==="h"?17:31)<chance;
}

function smoothNoise2D(x,z,seed){
  const x0=Math.floor(x),z0=Math.floor(z);
  const fx=x-x0,fz=z-z0;
  const sx=fx*fx*(3-2*fx),sz=fz*fz*(3-2*fz);
  const n00=cycleHash(seed,x0,z0,71);
  const n10=cycleHash(seed,x0+1,z0,71);
  const n01=cycleHash(seed,x0,z0+1,71);
  const n11=cycleHash(seed,x0+1,z0+1,71);
  const a=n00+(n10-n00)*sx;
  const b=n01+(n11-n01)*sx;
  return a+(b-a)*sz;
}

function level0AddBoundaryInterval(map,key,start,end){
  let list=map.get(key);
  if(!list){list=[];map.set(key,list)}
  list.push([start,end]);
}

const LEVEL0_REGION_CHUNKS=20;
const LEVEL0_RED_SIZE=3;
const LEVEL0_HOLE_SIZE=1;
const LEVEL0_BLACKOUT_SIZE=3;
const LEVEL0_PILLAR_SIZE=5;

function positiveMod(n,d){return ((n%d)+d)%d}
function level0RegionAt(cx,cz,seed){
  if(Math.abs(cx)<=1&&Math.abs(cz)<=1)return {type:"maze",id:"start"};
  const macroX=Math.floor(cx/LEVEL0_REGION_CHUNKS),macroZ=Math.floor(cz/LEVEL0_REGION_CHUNKS);
  const lx=positiveMod(cx,LEVEL0_REGION_CHUNKS),lz=positiveMod(cz,LEVEL0_REGION_CHUNKS);
  const roll=cycleHash(seed^0x6c3000,macroX,macroZ,0x51);
  if(roll<.022&&lx>=3&&lx<3+LEVEL0_RED_SIZE&&lz>=3&&lz<3+LEVEL0_RED_SIZE)return {type:"red",id:"red:"+macroX+":"+macroZ};
  if(roll>=.022&&roll<.04&&lx===9&&lz===9)return {type:"holes",id:"holes:"+macroX+":"+macroZ};
  if(roll>=.04&&roll<.075&&lx>=3&&lx<3+LEVEL0_BLACKOUT_SIZE&&lz>=3&&lz<3+LEVEL0_BLACKOUT_SIZE)return {type:"blackout",id:"blackout:"+macroX+":"+macroZ};
  if(roll>=.075&&roll<.15&&lx>=7&&lx<7+LEVEL0_PILLAR_SIZE&&lz>=7&&lz<7+LEVEL0_PILLAR_SIZE)return {type:"pillars",id:"pillars:"+macroX+":"+macroZ};
  return {type:"maze",id:"maze"};
}
function level0RegionSame(a,b){return a.type!=="maze"&&a.type===b.type&&a.id===b.id}
function level0BoundaryOpen(seed,cx,cz,side,region){
  const nx=side==="west"?cx-1:side==="east"?cx+1:cx,nz=side==="north"?cz-1:side==="south"?cz+1:cz,other=level0RegionAt(nx,nz,seed);
  if(level0RegionSame(region,other))return true;
  if(region.type==="red"||other.type==="red"){
    if(region.type==="red"){
      const lx=positiveMod(cx,LEVEL0_REGION_CHUNKS),lz=positiveMod(cz,LEVEL0_REGION_CHUNKS);
      if(side==="west"&&lx===3&&lz===4)return true;
    }
    if(other.type==="red"){
      const lx=positiveMod(nx,LEVEL0_REGION_CHUNKS),lz=positiveMod(nz,LEVEL0_REGION_CHUNKS);
      if(side==="east"&&lx===3&&lz===4)return true;
      if(side==="west"&&lx===5&&lz===4)return true;
      if(side==="north"&&lx===4&&lz===5)return true;
      if(side==="south"&&lx===4&&lz===3)return true;
    }
    return false;
  }
  const gx=side==="west"?cx:side==="east"?cx+1:cx,gz=side==="north"?cz:side==="south"?cz+1:cz;
  const chance=(region.type==="pillars"||other.type==="pillars")?.18:.22;
  return canonicalOpen(seed,gx,gz,side==="north"||side==="south"?"h":"v",chance);
}
function level0ManilaAt(cx,cz,seed){
  if(cx===0&&cz===0)return null;
  const macroX=Math.floor(cx/LEVEL0_REGION_CHUNKS),macroZ=Math.floor(cz/LEVEL0_REGION_CHUNKS);
  const lx=positiveMod(cx,LEVEL0_REGION_CHUNKS),lz=positiveMod(cz,LEVEL0_REGION_CHUNKS);
  if(lx<1||lx>8||lz<1||lz>8)return null;
  if(cycleHash(seed^0x6d6e,macroX,macroZ,0x41)>.012)return null;
  const tx=1+Math.floor(cycleHash(seed^0x6d6f,macroX,macroZ,0x42)*8),tz=1+Math.floor(cycleHash(seed^0x6d70,macroX,macroZ,0x43)*8);
  if(lx!==tx||lz!==tz)return null;
  return {
    cellX:1+Math.floor(cycleHash(seed^0x6d72,macroX,macroZ,0x45)*3),
    cellZ:1+Math.floor(cycleHash(seed^0x6d73,macroX,macroZ,0x46)*3),
    entrySide:["north","east","south","west"][Math.floor(cycleHash(seed^0x6d71,macroX,macroZ,0x44)*4)]
  };
}

class Chunk{
  constructor(world,cx,cz){
    this.world=world;this.game=world.game;this.cx=cx;this.cz=cz;
    // Level 0 follows the source generator's 80-block sector origin: chunkStart - 32.
    // Keep the streamer and the generated geometry on the same coordinate grid.
    const originOffset=world.size/2;
    this.originX=cx*world.size-originOffset;this.originZ=cz*world.size-originOffset;
    this.group=new THREE.Group();this.group.name="chunk_"+cx+"_"+cz;
    this.bounds=new THREE.Sphere(
      new THREE.Vector3(
        this.originX+world.size*.5,
        this.game.level.wallHeight*.5,
        this.originZ+world.size*.5
      ),
      Math.sqrt((world.size*.5)**2*2+(this.game.level.wallHeight*.5)**2)
    );
    this.hiddenSince=0;
    this.walls=new Uint8Array(this.gridSize()*this.gridSize());this.hazards=[];this.floorPit=null;this.exit=null;this.falseDoors=[];this.entitySpawn=false;this.fixtures=[];this.lightSources=[];this.batteries=[];this.crates=[];this.pebbles=[];this.collisionSegments=[];this.obstacleSegments=[];this.solidRects=[];this.baseCollisionSegmentCount=0;this.level1Ramp=null;this.zone="halls";this.rooms=[];
    this.flickerTimer=10+Math.random()*18;
    this.buildMaze();this.buildGeometry();
    if(this.game.level.id==="1")this.obstacleSegments=this.collisionSegments.slice(this.baseCollisionSegmentCount);
  }
  index(x,z){return z*this.gridSize()+x}
  gridSize(){return this.game.level.gridSize||CELLS}
  setEdge(x,z,side,open=false){
    const cells=this.gridSize(),here=this.index(x,z);
    if(side==="north"){
      this.walls[here]=open?this.walls[here]&~1:this.walls[here]|1;
      if(z>0){
        const other=this.index(x,z-1);
        this.walls[other]=open?this.walls[other]&~4:this.walls[other]|4;
      }
    }else if(side==="south"){
      this.walls[here]=open?this.walls[here]&~4:this.walls[here]|4;
      if(z<cells-1){
        const other=this.index(x,z+1);
        this.walls[other]=open?this.walls[other]&~1:this.walls[other]|1;
      }
    }else if(side==="west"){
      this.walls[here]=open?this.walls[here]&~8:this.walls[here]|8;
      if(x>0){
        const other=this.index(x-1,z);
        this.walls[other]=open?this.walls[other]&~2:this.walls[other]|2;
      }
    }else{
      this.walls[here]=open?this.walls[here]&~2:this.walls[here]|2;
      if(x<cells-1){
        const other=this.index(x+1,z);
        this.walls[other]=open?this.walls[other]&~8:this.walls[other]|8;
      }
    }
  }
  buildMaze(){
    const cells=this.gridSize(),level=this.game.level,cell=level.cellSize;
    const rng=new RNG((Math.imul(this.cx,73856093)^Math.imul(this.cz,19349663)^this.game.seed)|0);
    this.walls.fill(15);this.rooms=[];

    if(level.id==="1"){
      // Low-frequency seeded regions keep neighboring chunks in coherent districts.
      const forceStart=this.cx===0&&this.cz===0;
      const worldX=this.cx*cells*level.cellSize;
      const worldZ=this.cz*cells*level.cellSize;
      const macro=smoothNoise2D(worldX*.00135,worldZ*.00135,this.game.seed);
      this.zone=forceStart?"parking":macro>.66?"parking":macro>.32?"halls":"corridors";

      if(this.zone!=="corridors"){
        // Reference megaroom sectors are open concrete garage space.
        this.walls.fill(0);
        for(let z=0;z<cells;z++){
          this.walls[this.index(0,z)]|=8;
          this.walls[this.index(cells-1,z)]|=2;
        }
        for(let x=0;x<cells;x++){
          this.walls[this.index(x,0)]|=1;
          this.walls[this.index(x,cells-1)]|=4;
        }
        // Match the corridor sector's deterministic perimeter pattern so
        // every district transition lines up across streamed chunk borders.
        for(let i=0;i<cells;i+=2)this.setEdge(i,0,"north",true);
        for(let i=1;i<cells;i+=2)this.setEdge(cells-1,i,"east",true);
        for(let i=cells-2;i>=0;i-=2)this.setEdge(i,cells-1,"south",true);
        for(let i=cells-1;i>=0;i-=2)this.setEdge(0,i,"west",true);
      }else{
        // Exact Level1MazeGenerator topology: randomized DFS over 10x10
        // cells, starting at [0,0], with no extra loop carving.
        const visited=new Uint8Array(cells*cells);
        const stack=[[0,0]];
        visited[this.index(0,0)]=1;
        const dirs=[[0,-1,1,4],[1,0,2,8],[0,1,4,1],[-1,0,8,2]];
        while(stack.length){
          const [x,z]=stack[stack.length-1],options=[];
          for(const [dx,dz,b,ob] of dirs){
            const nx=x+dx,nz=z+dz;
            if(nx>=0&&nx<cells&&nz>=0&&nz<cells&&!visited[this.index(nx,nz)])options.push([nx,nz,b,ob]);
          }
          if(!options.length){stack.pop();continue}
          const [nx,nz,b,ob]=rng.pick(options);
          this.walls[this.index(x,z)]&=~b;
          this.walls[this.index(nx,nz)]&=~ob;
          visited[this.index(nx,nz)]=1;
          stack.push([nx,nz]);
        }

        // The reference connects neighboring 10x10 maze sectors with a
        // deterministic alternating perimeter pattern.
        for(let i=0;i<cells;i+=2)this.walls[this.index(i,0)]&=~1;
        for(let i=1;i<cells;i+=2)this.walls[this.index(cells-1,i)]&=~2;
        for(let i=cells-2;i>=0;i-=2)this.walls[this.index(i,cells-1)]&=~4;
        for(let i=cells-1;i>=0;i-=2)this.walls[this.index(0,i)]&=~8;

        // Level1MazeGenerator.spawnRandomRooms(): one 3x3 special area,
        // with storage being uncommon and the pillars structure otherwise.
        {
          let room=null;
          for(let attempt=0;attempt<18&&!room;attempt++){
            const x=rng.int(1,cells-4),z=rng.int(1,cells-4);
            const candidate={x,z,w:3,h:3,type:rng.next()<1/9?"storage":"pillars"};
            if(!this.rooms.some(other=>candidate.x<other.x+other.w+1&&candidate.x+candidate.w+1>other.x&&candidate.z<other.z+other.h+1&&candidate.z+candidate.h+1>other.z))room=candidate;
          }
          if(room){
            for(let rz=room.z;rz<room.z+room.h;rz++)for(let rx=room.x;rx<room.x+room.w;rx++){
              if(rx<room.x+room.w-1)this.setEdge(rx,rz,"east",true);
              if(rz<room.z+room.h-1)this.setEdge(rx,rz,"south",true);
            }
            const side=rng.int(0,3);
            if(side===0){room.entry={side:"north",x:room.x+rng.int(0,room.w-1),z:room.z};this.setEdge(room.entry.x,room.entry.z,"north",true)}
            else if(side===1){room.entry={side:"east",x:room.x+room.w-1,z:room.z+rng.int(0,room.h-1)};this.setEdge(room.entry.x,room.entry.z,"east",true)}
            else if(side===2){room.entry={side:"south",x:room.x+rng.int(0,room.w-1),z:room.z+room.h-1};this.setEdge(room.entry.x,room.entry.z,"south",true)}
            else{room.entry={side:"west",x:room.x,z:room.z+rng.int(0,room.h-1)};this.setEdge(room.entry.x,room.entry.z,"west",true)}
            this.rooms.push(room);
          }
        }
      }
      // Keep the ramp approach aligned through streamed parking sectors.
      const upperDeckLane=Math.floor(36/level.cellSize);
      this.setEdge(cells-1,upperDeckLane,"east",true);
      this.setEdge(0,upperDeckLane,"west",true);
    }else if(level.id==="0"){
      this.zone="maze";
      this.megaType=null;
      const forcedManila=this.world.forceLevel0ManilaRoom;
      const isForcedManila=!!(forcedManila&&forcedManila.cx===this.cx&&forcedManila.cz===this.cz);
      this.level0Region=isForcedManila
        ? {type:"maze",id:"manila:admin"}
        : this.world.forceLevel0AllRed
          ? {type:"red",id:"red:global"}
          : level0RegionAt(this.cx,this.cz,this.game.seed);
      if(!isForcedManila&&!this.world.forceLevel0AllRed&&this.world.forceLevel0Zone&&Math.abs(this.cx-this.world.forceLevel0Zone.cx)<=1&&Math.abs(this.cz-this.world.forceLevel0Zone.cz)<=1){
        this.level0Region={type:this.world.forceLevel0Zone.type,id:"forced:"+this.world.forceLevel0Zone.type};
      }
      this.level0SpawnCell={x:Math.floor(cells/2),z:Math.floor(cells/2)};
      this.level0Blackout=this.level0Region.type==="blackout";
      if(this.level0Blackout&&cycleHash(this.game.seed,this.cx,this.cz+0x4b1)<.34)this.entitySpawn=true;
      this.level0PillarArea=this.level0Region.type==="pillars";
      this.level0HoleArea=this.level0Region.type==="holes";
      this.level0RedRoom=this.level0Region.type==="red";
      this.level0PoleArea=this.level0PillarArea;
      this.manilaRoom=this.level0Region.type==="maze"
        ? (isForcedManila
          ? {cellX:forcedManila.cellX,cellZ:forcedManila.cellZ,entrySide:forcedManila.entrySide}
          : level0ManilaAt(this.cx,this.cz,this.game.seed))
        : null;

      if(this.level0Region.type==="pillars"){
        this.walls.fill(0);
      }else{
        const visited=new Uint8Array(cells*cells);
        const startX=this.cx===0&&this.cz===0?Math.floor(cells/2):0,startZ=this.cx===0&&this.cz===0?Math.floor(cells/2):0;
        const stack=[[startX,startZ]];visited[this.index(startX,startZ)]=1;
        const dirs=[[0,-1,1,4],[1,0,2,8],[0,1,4,1],[-1,0,8,2]];
        while(stack.length){
          const [x,z]=stack[stack.length-1],options=[];
          for(const [dx,dz,b,ob] of dirs){const nx=x+dx,nz=z+dz;if(nx>=0&&nx<cells&&nz>=0&&nz<cells&&!visited[this.index(nx,nz)])options.push([nx,nz,b,ob])}
          if(!options.length){stack.pop();continue}
          const [nx,nz,b,ob]=rng.pick(options);
          this.walls[this.index(x,z)]&=~b;this.walls[this.index(nx,nz)]&=~ob;visited[this.index(nx,nz)]=1;stack.push([nx,nz]);
        }

        // The source is an irregular maze of office partitions, not a perfect
        // grid of tiny rooms. Carve a few broad, crooked sightline rooms into
        // each chunk while keeping the initial spawn cell surrounded enough
        // to preserve the disorienting first reveal.
        const roomAttempts=2+rng.int(0,2),rooms=[];
        for(let attempt=0;attempt<roomAttempts;attempt++){
          const rw=rng.int(2,4),rh=rng.int(2,3);
          const rx=rng.int(1,Math.max(1,cells-rw-1)),rz=rng.int(1,Math.max(1,cells-rh-1));
          const candidate={x:rx,z:rz,w:rw,h:rh};
          if(this.cx===0&&this.cz===0&&rx<=cells/2+1&&rx+rw>cells/2-1&&rz<=cells/2+1&&rz+rh>cells/2-1)continue;
          if(rooms.some(room=>candidate.x<room.x+room.w+1&&candidate.x+candidate.w+1>room.x&&candidate.z<room.z+room.h+1&&candidate.z+candidate.h+1>room.z))continue;
          rooms.push(candidate);
          for(let z=rz;z<rz+rh;z++)for(let x=rx;x<rx+rw;x++){
            if(x<rx+rw-1)this.setEdge(x,z,"east",true);
            if(z<rz+rh-1)this.setEdge(x,z,"south",true);
          }
          const entrySide=rng.pick(["north","east","south","west"]);
          const entryX=entrySide==="east"?rx+rw-1:entrySide==="west"?rx:rx+rng.int(0,rw-1);
          const entryZ=entrySide==="south"?rz+rh-1:entrySide==="north"?rz:rz+rng.int(0,rh-1);
          this.setEdge(entryX,entryZ,entrySide,true);
        }

        // A few opportunistic breaches create angled, offset passage links.
        for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){
          if(x<cells-1&&rng.next()<.085)this.setEdge(x,z,"east",true);
          if(z<cells-1&&rng.next()<.085)this.setEdge(x,z,"south",true);
        }
        if(this.level0Region.type==="holes"){
          const hx=Math.floor(cells/2),hz=Math.floor(cells/2);
          for(let z=hz-1;z<=hz;z++)for(let x=hx-1;x<=hx;x++){
            if(x<cells-1)this.setEdge(x,z,"east",true);
            if(z<cells-1)this.setEdge(x,z,"south",true);
            this.hazards.push({x,z,cluster:true});
          }
        }
      }

      if(this.world.forceLevel0AllRed){
        for(let x=0;x<cells;x++){
          this.setEdge(x,0,"north",true);
          this.setEdge(x,cells-1,"south",true);
        }
        for(let z=0;z<cells;z++){
          this.setEdge(0,z,"west",true);
          this.setEdge(cells-1,z,"east",true);
        }
      }else{
        for(let x=0;x<cells;x++){
          if(level0BoundaryOpen(this.game.seed,this.cx,this.cz,"north",this.level0Region))this.setEdge(x,0,"north",true);
          if(level0BoundaryOpen(this.game.seed,this.cx,this.cz,"south",this.level0Region))this.setEdge(x,cells-1,"south",true);
        }
        for(let z=0;z<cells;z++){
          if(level0BoundaryOpen(this.game.seed,this.cx,this.cz,"west",this.level0Region))this.setEdge(0,z,"west",true);
          if(level0BoundaryOpen(this.game.seed,this.cx,this.cz,"east",this.level0Region))this.setEdge(cells-1,z,"east",true);
        }
      }
      if(this.cx===0&&this.cz===0){const s=Math.floor(cells/2);for(const side of ["north","east","south","west"])this.setEdge(s,s,side,true)}
      if(this.manilaRoom)this.setEdge(this.manilaRoom.cellX,this.manilaRoom.cellZ,this.manilaRoom.entrySide,true);

    }

    if(level.id!=="1"&&level.id!=="0"){
      // Levels 2+ are connected environments, not a grid of sealed boxes.
      // The old generator only punched occasional chunk-edge doors, leaving
      // every interior cell surrounded by four fallback walls. Build a seeded
      // spanning network first, then add level-specific loops and room pockets.
      if(level.id==="2"||level.id==="3"){
        // Industrial levels use authored corridor geometry, not the old
        // cell-by-cell maze wall fallback.
        this.walls.fill(0);
        if(level.id==="3"){
          const roomRoll=cycleHash(this.seedKey()^0x31e1,this.cx*17+this.cz*31,0x3a);
          this.zone=this.cx===0&&this.cz===0?"generator":roomRoll<.28?"generator":roomRoll<.50?"assembly":roomRoll<.72?"boiler":roomRoll<.88?"switchgear":"corridors";
          this.level3RoomType=this.zone;
        }
      }else if(level.id==="4"){
        // Abandoned office is an open floor plate with sparse partitions,
        // not a yellow-maze of sealed cells.
        this.walls.fill(0);
      }else if(level.id==="7"){
        // The ocean is intentionally open. Its boundaries are water, not walls.
        this.walls.fill(0);
      }else if(level.id==="9"){
        // Suburban blocks are open streets with discrete lots, not indoor maze walls.
        this.walls.fill(0);
        this.rooms.push({x:1,z:1,w:2,h:2,type:"suburban"},{x:cells-4,z:cells-4,w:2,h:2,type:"suburban"});
      }else if(level.id==="10"){
        // The wheat fields are open terrain; the final route is a barn door,
        // not a fake perimeter wall around each streamed chunk.
        this.walls.fill(0);
      }else if(level.id==="6"){
        // Lights Out is outdoor mountain / tundra night — open terrain, not sealed cells.
        this.walls.fill(0);
      }else if(level.id==="8"){
        // Natural karst caves are open chamber networks, not a square-cell maze.
        // Organic rock banks below define the traversable 9th Road.
        this.walls.fill(0);
      }else if(level.id==="37"){
        // Poolrooms are open tiled chambers with water basins, not a maze of sealed boxes.
        this.walls.fill(0);
      }else{
        const visited=new Uint8Array(cells*cells);
        const startX=Math.floor(cells/2),startZ=Math.floor(cells/2);
        const stack=[[startX,startZ]];
        visited[this.index(startX,startZ)]=1;
        const dirs=[[0,-1,1,4],[1,0,2,8],[0,1,4,1],[-1,0,8,2]];
        while(stack.length){
          const [x,z]=stack[stack.length-1],options=[];
          for(const [dx,dz,b,ob] of dirs){
            const nx=x+dx,nz=z+dz;
            if(nx>=0&&nx<cells&&nz>=0&&nz<cells&&!visited[this.index(nx,nz)])options.push([nx,nz,b,ob]);
          }
          if(!options.length){stack.pop();continue}
          const [nx,nz,b,ob]=rng.pick(options);
          this.walls[this.index(x,z)]&=~b;
          this.walls[this.index(nx,nz)]&=~ob;
          visited[this.index(nx,nz)]=1;
          stack.push([nx,nz]);
        }

        const loopChance={"2":.14,"3":.28,"4":.2,"5":.24,"6":.035,"8":.18,"9":.16}[level.id]??.15;
        for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){
          if(x<cells-1&&(this.walls[this.index(x,z)]&2)&&rng.next()<loopChance)this.setEdge(x,z,"east",true);
          if(z<cells-1&&(this.walls[this.index(x,z)]&4)&&rng.next()<loopChance)this.setEdge(x,z,"south",true);
        }

        if(level.id==="3"){
          // A broad, continuous service spine separates the smaller switchgear
          // corridors and makes the Electrical Station read like a facility.
          const mid=Math.floor(cells/2);
          for(let x=0;x<cells-1;x++)this.setEdge(x,mid,"east",true);
          for(let z=0;z<cells-1;z++)this.setEdge(mid,z,"south",true);
        }

        if(level.id==="2"||level.id==="5"||level.id==="9"){
          // Utility bays, hotel rooms and suburban lots are open pockets attached
          // to the maze, never isolated 4-wall cells.
          const attempts=level.id==="2"?2:level.id==="9"?2:3;
          for(let attempt=0;attempt<attempts;attempt++){
            const w=level.id==="5"?3:2,h=2;
            const rx=rng.int(1,Math.max(1,cells-w-1)),rz=rng.int(1,Math.max(1,cells-h-1));
            const room={x:rx,z:rz,w,h,type:level.id==="2"?"maintenance":level.id==="9"?"suburban":"hotel"};
            if(this.rooms.some(other=>room.x<other.x+other.w+1&&room.x+room.w+1>other.x&&room.z<other.z+other.h+1&&room.z+room.h+1>other.z))continue;
            for(let rz2=rz;rz2<rz+h;rz2++)for(let rx2=rx;rx2<rx+w;rx2++){
              if(rx2<rx+w-1)this.setEdge(rx2,rz2,"east",true);
              if(rz2<rz+h-1)this.setEdge(rx2,rz2,"south",true);
            }
            const side=rng.pick(["north","east","south","west"]);
            const ex=side==="east"?rx+w-1:side==="west"?rx:rx+rng.int(0,w-1);
            const ez=side==="south"?rz+h-1:side==="north"?rz:rz+rng.int(0,h-1);
            this.setEdge(ex,ez,side,true);
            this.rooms.push(room);
          }
          if(level.id==="5"&&cycleHash(this.seedKey(),this.cx,this.cz)<.22){
            const ballroom={x:3,z:3,w:4,h:4,type:"beverly"};
            const overlaps=this.rooms.some(other=>ballroom.x<other.x+other.w+1&&ballroom.x+ballroom.w+1>other.x&&ballroom.z<other.z+other.h+1&&ballroom.z+ballroom.h+1>other.z);
            if(!overlaps){
              for(let rz=ballroom.z;rz<ballroom.z+ballroom.h;rz++)for(let rx=ballroom.x;rx<ballroom.x+ballroom.w;rx++){
                if(rx<ballroom.x+ballroom.w-1)this.setEdge(rx,rz,"east",true);
                if(rz<ballroom.z+ballroom.h-1)this.setEdge(rx,rz,"south",true);
              }
              for(const [ex,ez,side] of [[ballroom.x+1,ballroom.z,"north"],[ballroom.x+ballroom.w-1,ballroom.z+1,"east"],[ballroom.x+2,ballroom.z+ballroom.h-1,"south"],[ballroom.x,ballroom.z+2,"west"]])this.setEdge(ex,ez,side,true);
              this.rooms.push(ballroom);
            }
          }
        }
      }

      const boundaryChance=({"2":0,"3":0,"6":.08,"7":0,"9":0,"10":0})[level.id]??.19;
      for(let x=0;x<cells;x++){
        const gx=this.cx*cells+x;
        if(boundaryChance>0&&canonicalOpen(this.game.seed,gx,this.cz*cells,"h",boundaryChance))this.setEdge(x,0,"north",true);
        if(boundaryChance>0&&canonicalOpen(this.game.seed,gx,this.cz*cells+cells,"h",boundaryChance))this.setEdge(x,cells-1,"south",true);
      }
      for(let z=0;z<cells;z++){
        const gz=this.cz*cells+z;
        if(boundaryChance>0&&canonicalOpen(this.game.seed,this.cx*cells,gz,"v",boundaryChance))this.setEdge(0,z,"west",true);
        if(boundaryChance>0&&canonicalOpen(this.game.seed,this.cx*cells+cells,gz,"v",boundaryChance))this.setEdge(cells-1,z,"east",true);
      }

      if(level.id==="7"&&Math.hypot(this.cx,this.cz)>=level.exitAfterChunks&&cycleHash(this.seedKey(),this.cx*17+this.cz*5,7)<.2){
        const mid=Math.floor(cells/2);this.exit={x:mid,z:mid,side:"south",kind:"ocean"};
      }else if(level.id==="8"&&Math.hypot(this.cx,this.cz)>=level.exitAfterChunks&&cycleHash(this.seedKey(),this.cx*17+this.cz*5,8)<.24){
        this.exit={x:Math.floor(cells*.84),z:Math.floor(cells*.34),kind:"cave"};
      }else if(level.id==="9"&&Math.hypot(this.cx,this.cz)>=level.exitAfterChunks&&cycleHash(this.seedKey(),this.cx*11+this.cz*13,9)<.22){
        const lot=this.rooms[0];if(lot)this.exit={...lot,kind:"suburb"};
      }else if(level.id==="10"&&Math.hypot(this.cx,this.cz)>=level.exitAfterChunks&&cycleHash(this.seedKey(),this.cx*13+this.cz*5,10)<.22){
        this.exit={kind:"field",x:Math.floor(cells*.68),z:Math.floor(cells*.64)};
      }else if((level.id==="2"||level.id==="3")&&Math.hypot(this.cx,this.cz)>=level.exitAfterChunks&&cycleHash(this.seedKey(),this.cx*13+this.cz*7,level.id.charCodeAt(0))<.22){
        this.exit={kind:"industrial"};
      }
    }

    const rng2=new RNG((Math.imul(this.cx,83492791)^Math.imul(this.cz,2971215073)^this.game.seed)|0);
    for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){
      if(level.id!=="0"&&rng2.next()<level.holeChance&&Math.hypot(x-(cells-1)/2,z-(cells-1)/2)>1.7)this.hazards.push({x,z});
    }

    const chunkDistance=Math.hypot(this.cx,this.cz),minCell=1,maxCell=Math.max(1,cells-2);
    const level1ExitSector=level.id==="1"&&this.zone==="corridors"&&!((this.cx===0&&this.cz===0))&&chunkDistance>=level.exitAfterChunks;
    if(level.id==="4"){
      // Level 4 has no maze edges to convert into a door. Put one stairwell
      // exit in a deterministic outer sector so the open office cannot be endless.
      if(this.cx===level.exitAfterChunks&&this.cz===0)this.exit={kind:"office"};
    }else if(level.id==="1"){
      // The Level 1 generator places the level2 stairwell on
      // maze-grid sectors outside the starting area, using a 50% roll.
      if(level1ExitSector&&rng2.next()<.5){
        const candidates=[];
        for(let z=minCell;z<=maxCell;z++)for(let x=minCell;x<=maxCell;x++){
          if(this.rooms.some(room=>x>=room.x&&x<room.x+room.w&&z>=room.z&&z<room.z+room.h))continue;
          candidates.push({x,z});
        }
        if(candidates.length){
          const chosen=rng2.pick(candidates);
          this.exit={...chosen,kind:"stairwell2"};
        }
      }
    }else if(level.id!=="4"&&chunkDistance>=level.exitAfterChunks&&cycleHash(this.seedKey(),this.cx*13+this.cz*7,level.id.charCodeAt(0))<.18){
      const candidates=[];
      for(let z=minCell;z<=maxCell;z++)for(let x=minCell;x<=maxCell;x++){
        const mask=this.walls[this.index(x,z)];
        if(mask&1)candidates.push({x,z,side:"north"});
        if(mask&2)candidates.push({x,z,side:"east"});
        if(mask&4)candidates.push({x,z,side:"south"});
        if(mask&8)candidates.push({x,z,side:"west"});
      }
      if(candidates.length){
        const chosen=rng2.pick(candidates),kind="door";
        this.setEdge(chosen.x,chosen.z,chosen.side,true);
        this.exit={...chosen,kind};
      }
    }
  }
  seedKey(){return (this.cx*73856093)^(this.cz*19349663)^this.game.seed}
  buildGeometry(){
    const cells=this.gridSize();
    const g=this.group,level=this.game.level,lib=this.world.library,size=this.world.size,cell=level.cellSize;
    const wallThickness=level.id==="0"?.12:.18;
    const level1MultiFloor=level.id==="1";
    const safeWallHeight=level1MultiFloor?LEVEL1_UPPER_FLOOR_Y-LEVEL1_FLOOR_SLAB_THICKNESS/2-.025:level.wallHeight-.025;
    const safeWallY=safeWallHeight/2+.0125;
    const upperWallHeight=level1MultiFloor?level.wallHeight-LEVEL1_UPPER_FLOOR_Y-.025:0;
    const upperWallY=level1MultiFloor?LEVEL1_UPPER_FLOOR_Y+.0125+upperWallHeight/2:0;
    const hGeom=new THREE.BoxGeometry(cell,safeWallHeight,wallThickness),vGeom=new THREE.BoxGeometry(wallThickness,safeWallHeight,cell);
    const upperHGeom=level1MultiFloor?new THREE.BoxGeometry(cell,upperWallHeight,wallThickness):null;
    const upperVGeom=level1MultiFloor?new THREE.BoxGeometry(wallThickness,upperWallHeight,cell):null;
    // Painted 4-inch (101.6 mm) Level 0 cove base. Offset it onto
    // both visible wall faces instead of burying it in wall thickness.
    const trimHGeom=level.id==="0"?new THREE.BoxGeometry(cell,.1016,.012):new THREE.BoxGeometry(cell,.11,.12);
    const trimVGeom=level.id==="0"?new THREE.BoxGeometry(.012,.1016,cell):new THREE.BoxGeometry(.12,.11,cell);
    const trimToeGeom=level.id==="0"?new THREE.CylinderGeometry(.009,.009,cell,10):null;
    const topHGeom=new THREE.BoxGeometry(cell,.075,.09),topVGeom=new THREE.BoxGeometry(.09,.075,cell);
    const hData=[],vData=[],upperHData=[],upperVData=[],trimH=[],trimV=[],trimToeH=[],trimToeV=[],topH=[],topV=[],edges=[],rngBase=new RNG(this.seedKey());
    const region=level.id==="0"?(this.level0Region?.type||"maze"):"";
    const wallMaterial=level.id==="1"?lib.concrete:region==="red"?lib.redWall:lib.wall;
    const seenH=new Set(),seenV=new Set();
    const pushMat=(arr,x,y,z)=>{const m=new THREE.Matrix4();m.compose(new THREE.Vector3(x,y,z),new THREE.Quaternion(),new THREE.Vector3(1,1,1));arr.push(m)};
    const pushRotated=(arr,x,y,z,rx,ry,rz)=>{
      const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz));
      const m=new THREE.Matrix4();m.compose(new THREE.Vector3(x,y,z),q,new THREE.Vector3(1,1,1));arr.push(m);
    };
    const pushLevel0Baseboard=(axis,x,z)=>{
      const faceOffset=wallThickness/2+.006,toeOffset=wallThickness/2+.013;
      for(const side of [-1,1]){
        if(axis==="horizontal"){
          pushMat(trimH,x,.0508,z+side*faceOffset);
          pushRotated(trimToeH,x,.009,z+side*toeOffset,0,0,Math.PI/2);
        }else{
          pushMat(trimV,x+side*faceOffset,.0508,z);
          pushRotated(trimToeV,x+side*toeOffset,.009,z,Math.PI/2,0,0);
        }
      }
    };
    const key=(x,z,s)=>s+"|"+x+"|"+z;
    const addInstanced=(geometry,material,data)=>{if(!geometry||!data.length)return;const mesh=new THREE.InstancedMesh(tileGeometryUV(geometry,material),material,data.length);mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);data.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();g.add(mesh)};
    const buildWallEdge=(x,z,side)=>{
      const px=this.originX+x*cell+cell/2,pz=this.originZ+z*cell+cell/2;
      if(level.id==="0"&&this.manilaRoom){
        const roomX=this.originX+this.manilaRoom.cellX*cell+cell/2;
        const roomZ=this.originZ+this.manilaRoom.cellZ*cell+cell/2;
        const edgeX=px+(side==="west"?-cell/2:side==="east"?cell/2:0);
        const edgeZ=pz+(side==="north"?-cell/2:side==="south"?cell/2:0);
        if(Math.abs(edgeX-roomX)<3.85&&Math.abs(edgeZ-roomZ)<3.85)return;
      }
      if(side==="north"){
        const k=key(x,z,side);if(seenH.has(k))return;seenH.add(k);
        pushMat(hData,px,safeWallY,pz-cell/2);if(level1MultiFloor)pushMat(upperHData,px,upperWallY,pz-cell/2);
        if(level.id==="0")pushLevel0Baseboard("horizontal",px,pz-cell/2);else pushMat(trimH,px,.065,pz-cell/2);
        pushMat(topH,px,level.wallHeight-.04,pz-cell/2);edges.push({x,z,side});
      }else if(side==="south"){
        const k=key(x,z+1,"north");if(seenH.has(k))return;seenH.add(k);
        pushMat(hData,px,safeWallY,pz+cell/2);if(level1MultiFloor)pushMat(upperHData,px,upperWallY,pz+cell/2);
        if(level.id==="0")pushLevel0Baseboard("horizontal",px,pz+cell/2);else pushMat(trimH,px,.065,pz+cell/2);
        pushMat(topH,px,level.wallHeight-.04,pz+cell/2);edges.push({x,z,side});
      }else if(side==="west"){
        const k=key(x,z,side);if(seenV.has(k))return;seenV.add(k);
        pushMat(vData,px-cell/2,safeWallY,pz);if(level1MultiFloor)pushMat(upperVData,px-cell/2,upperWallY,pz);
        if(level.id==="0")pushLevel0Baseboard("vertical",px-cell/2,pz);else pushMat(trimV,px-cell/2,.065,pz);
        pushMat(topV,px-cell/2,level.wallHeight-.04,pz);edges.push({x,z,side});
      }else{
        const k=key(x+1,z,"west");if(seenV.has(k))return;seenV.add(k);
        pushMat(vData,px+cell/2,safeWallY,pz);if(level1MultiFloor)pushMat(upperVData,px+cell/2,upperWallY,pz);
        if(level.id==="0")pushLevel0Baseboard("vertical",px+cell/2,pz);else pushMat(trimV,px+cell/2,.065,pz);
        pushMat(topV,px+cell/2,level.wallHeight-.04,pz);edges.push({x,z,side});
      }
    };
    for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){
      const mask=this.walls[this.index(x,z)];
      if(mask&1)buildWallEdge(x,z,"north");if(mask&8)buildWallEdge(x,z,"west");if(z===cells-1&&(mask&4))buildWallEdge(x,z,"south");if(x===cells-1&&(mask&2))buildWallEdge(x,z,"east");
      if(level.id==="0"){
        const fixtureChance=region==="blackout"?0:region==="red"?.34:.58;
        if(rngBase.next()<fixtureChance){
          const mat=(region==="red"?lib.redLight:lib.light).clone();mat.emissiveIntensity=region==="red"?.85:1.05;
          const rotation=rngBase.next()<.5?0:Math.PI/2,px=this.originX+x*cell+cell/2,pz=this.originZ+z*cell+cell/2;
          // Four-by-two tile texture sheet: fluorescent trays sit across
          // several tiles and repeat at consistent ceiling-grid positions.
          const snap=(value,step)=>Math.round((value-step/2)/step)*step+step/2;
          const fixtureX=snap(px,1.27),fixtureZ=snap(pz,1.14);
          const fixture=box(g,new THREE.BoxGeometry(1.18,.035,.56),mat,fixtureX,level.wallHeight-.05,fixtureZ,0,rotation,0);
          fixture.userData.light=true;fixture.userData.baseEmissive=mat.emissiveIntensity;this.fixtures.push(fixture);
          const intensity=region==="red"?20:30;
          this.lightSources.push({position:new THREE.Vector3(fixtureX,level.wallHeight-.15,fixtureZ),color:region==="red"?0xa52a20:0xffefc8,baseIntensity:intensity,intensity,distance:region==="red"?9:8.5,decay:2,fixture});
        }
      }else if(!["1","2","3","4","6","7","8","9","10"].includes(level.id)&&rngBase.next()<(level.id==="5"?.17:.13)){
        const fixtureMat=level.id==="2"&&rngBase.next()<.28?lib.orangeLight:lib.light,material=fixtureMat.clone();material.emissiveIntensity=fixtureMat===lib.orangeLight?2.2:3.0;
        const rotation=rngBase.next()<.5?0:Math.PI/2,px=this.originX+x*cell+cell/2,pz=this.originZ+z*cell+cell/2;
        const fixture=box(g,new THREE.BoxGeometry(3.7,.055,.72),material,px,level.wallHeight-.09,pz,0,rotation,0);fixture.userData.light=true;fixture.userData.baseEmissive=material.emissiveIntensity;this.fixtures.push(fixture);
        const lightColor=fixtureMat===lib.orangeLight?0xff9b52:level.theme.light,intensity=level.id==="3"?220:level.id==="4"?110:170;this.lightSources.push({position:new THREE.Vector3(px,level.wallHeight-.24,pz),color:lightColor,baseIntensity:intensity,intensity,distance:0,decay:2,fixture});
      }
    }
    this.collisionSegments=edges.map(e=>{const px=this.originX+e.x*cell+cell/2,pz=this.originZ+e.z*cell+cell/2;return e.side==="north"||e.side==="south"?{x1:px-cell/2,z1:e.side==="north"?pz-cell/2:pz+cell/2,x2:px+cell/2,z2:e.side==="north"?pz-cell/2:pz+cell/2}:{x1:e.side==="west"?px-cell/2:px+cell/2,z1:pz-cell/2,x2:e.side==="west"?px-cell/2:px+cell/2,z2:pz+cell/2}});
    this.baseCollisionSegmentCount=this.collisionSegments.length;
    addInstanced(hGeom,wallMaterial,hData);addInstanced(vGeom,wallMaterial,vData);
    if(level1MultiFloor){addInstanced(upperHGeom,wallMaterial,upperHData);addInstanced(upperVGeom,wallMaterial,upperVData)}
    if(level.id==="0"&&region==="red"){
      const redFloor=new THREE.Mesh(tileGeometryUV(new THREE.PlaneGeometry(size,size),lib.redFloor),lib.redFloor);
      redFloor.rotation.x=-Math.PI/2;
      redFloor.position.set(this.originX+size/2,.006,this.originZ+size/2);
      redFloor.renderOrder=1;
      g.add(redFloor);
    }
    if(level.id==="0"){
      addInstanced(trimHGeom,lib.trim,trimH);addInstanced(trimVGeom,lib.trim,trimV);
      addInstanced(trimToeGeom,lib.trim,trimToeH);addInstanced(trimToeGeom,lib.trim,trimToeV);
    }else if(level.id!=="1"){addInstanced(trimHGeom,lib.trim,trimH);addInstanced(trimVGeom,lib.trim,trimV);addInstanced(topHGeom,lib.trimTop,topH);addInstanced(topVGeom,lib.trimTop,topV)}

    if(level.id==="0"&&region==="maze"&&!this.manilaRoom){
      const arches=[];
      for(let z=1;z<cells-1;z++)for(let x=1;x<cells-1;x++){
        const mask=this.walls[this.index(x,z)];
        if(x<cells-1&&!(mask&2)){
          const score=cycleHash(this.game.seed^0xa2c4,x,z,0x71);
          if(score<.035)arches.push({axis:"vertical",x,z,score});
        }
        if(z<cells-1&&!(mask&4)){
          const score=cycleHash(this.game.seed^0xa2c4,x,z,0x72);
          if(score<.035)arches.push({axis:"horizontal",x,z,score});
        }
      }
      arches.sort((a,b)=>a.score-b.score);
      for(const arch of arches.slice(0,2)){
        const px=this.originX+(arch.axis==="vertical"?(arch.x+1)*cell:(arch.x+.5)*cell);
        const pz=this.originZ+(arch.axis==="horizontal"?(arch.z+1)*cell:(arch.z+.5)*cell);
        const frame=new THREE.Group();frame.position.set(px,0,pz);
        frame.rotation.y=arch.axis==="vertical"?Math.PI/2:0;
        box(frame,new THREE.BoxGeometry(.13,1.84,.13),lib.wall,-.74,.92,0);
        box(frame,new THREE.BoxGeometry(.13,1.84,.13),lib.wall,.74,.92,0);
        const crown=new THREE.Mesh(new THREE.TorusGeometry(.74,.055,8,20,Math.PI),lib.wall);
        crown.position.set(0,1.84,0);frame.add(crown);
        frame.userData.level0Arch=true;g.add(frame);
      }
    }
    if(level.id==="1")this.buildLevel1Set(level,lib,rngBase);
    else if(level.id==="0")this.buildLevel0Set(level,lib,rngBase);

    for(const hz of this.hazards){
      if(level.id==="0"&&hz.cluster)continue;
      // Manila Room has its own wood floor; never stamp the normal Level 0
      // dark hazard decal over that floor.
      if(level.id==="0"&&this.manilaRoom&&hz.x===this.manilaRoom.cellX&&hz.z===this.manilaRoom.cellZ)continue;
      const p=new THREE.Mesh(new THREE.CircleGeometry(cell*.22,18),lib.dark);
      p.rotation.x=-Math.PI/2;p.position.set(this.originX+hz.x*cell+cell/2,.013,this.originZ+hz.z*cell+cell/2);g.add(p);
    }

    const batteryChance=level.batteryChance??.08;
    const batteryRng=new RNG(this.seedKey()^0x0bba71);
    for(let i=0;i<2;i++){
      if(batteryRng.next()>batteryChance*(i===0?1:.48))continue;
      let bx=batteryRng.int(1,Math.max(1,cells-2)),bz=batteryRng.int(1,Math.max(1,cells-2));
      if(this.hazards.some(h=>h.x===bx&&h.z===bz)){bx=Math.max(1,Math.min(cells-2,bx+1));bz=Math.max(1,Math.min(cells-2,bz+1))}
      const battery=new THREE.Group();
      battery.position.set(
        this.originX+bx*cell+cell/2+(batteryRng.next()-.5)*Math.min(2.4,cell*.32),
        .22,
        this.originZ+bz*cell+cell/2+(batteryRng.next()-.5)*Math.min(2.4,cell*.32)
      );
      const body=box(battery,new THREE.CylinderGeometry(.105,.105,.42,10),lib.battery,0,0,0,0,0,Math.PI/2);
      box(battery,new THREE.BoxGeometry(.052,.23,.17),lib.batteryLabel,0,0,0);
      body.rotation.order="ZYX";
      battery.rotation.y=batteryRng.next()*Math.PI*2;
      g.add(battery);
      this.batteries.push({group:battery,amount:28+batteryRng.int(0,18)});
    }

    const wallPoint=(e,offset=.095,y=.6)=>{
      const px=this.originX+e.x*cell+cell/2,pz=this.originZ+e.z*cell+cell/2;
      if(e.side==="north")return{position:new THREE.Vector3(px,y,pz-cell/2-offset),rotation:0};
      if(e.side==="south")return{position:new THREE.Vector3(px,y,pz+cell/2+offset),rotation:0};
      if(e.side==="west")return{position:new THREE.Vector3(px-cell/2-offset,y,pz),rotation:Math.PI/2};
      return{position:new THREE.Vector3(px+cell/2+offset,y,pz),rotation:Math.PI/2};
    };


    const addLevel0Outlet=e=>{
      const px=this.originX+e.x*cell+cell/2,pz=this.originZ+e.z*cell+cell/2;
      const faceOffset=wallThickness/2+.008;
      let x=px,z=pz,rotation=0;
      if(e.side==="north"){z=pz-cell/2+faceOffset;rotation=0}
      else if(e.side==="south"){z=pz+cell/2-faceOffset;rotation=Math.PI}
      else if(e.side==="west"){x=px-cell/2+faceOffset;rotation=Math.PI/2}
      else{x=px+cell/2-faceOffset;rotation=-Math.PI/2}
      const plate=new THREE.Group();plate.position.set(x,.37,z);plate.rotation.y=rotation;
      box(plate,new THREE.BoxGeometry(.18,.265,.012),lib.outlet,0,0,0);
      for(const socketY of [.058,-.058]){
        box(plate,new THREE.BoxGeometry(.009,.046,.004),lib.socket,-.022,socketY,.007);
        box(plate,new THREE.BoxGeometry(.009,.046,.004),lib.socket,.022,socketY,.007);
        box(plate,new THREE.CylinderGeometry(.006,.006,.004,8),lib.socket,0,socketY-.034,.007,Math.PI/2,0,0);
      }
      for(const screwY of [.116,-.116])
        box(plate,new THREE.CylinderGeometry(.006,.006,.004,8),lib.intercomSlot,0,screwY,.008,Math.PI/2,0,0);
      g.add(plate);
    };
    if(level.id==="0"){
      if(!this.level0RedRoom&&!this.manilaRoom&&edges.length){
        const outletRng=new RNG(this.seedKey()^0x51eaf);
        if(outletRng.next()<.72){
          const candidates=edges.slice(),count=1+(outletRng.next()<.42?1:0);
          for(let i=0;i<Math.min(count,candidates.length);i++){
            const pick=outletRng.int(0,candidates.length-1);
            addLevel0Outlet(candidates.splice(pick,1)[0]);
          }
        }
      }
    }else{
      for(let i=0;i<Math.min(12,edges.length);i++){
        const e=edges[(rngBase.int(0,edges.length-1)+i*11)%edges.length];
        if(rngBase.next()<.22){
          const p=wallPoint(e,.105,.58);
          box(g,new THREE.BoxGeometry(.24,.32,.035),lib.outlet,p.position.x,p.position.y,p.position.z,0,p.rotation,0);
          const sx=e.side==="west"||e.side==="east"?p.position.x+(e.side==="west"?-0.002:e.side==="east"?0.002:0):p.position.x;
          const sz=e.side==="north"||e.side==="south"?p.position.z+(e.side==="north"?-.002:.002):p.position.z;
          box(g,new THREE.BoxGeometry(.045,.05,.018),lib.socket,sx-.055,p.position.y+.015,sz,0,p.rotation,0);
          box(g,new THREE.BoxGeometry(.045,.05,.018),lib.socket,sx+.055,p.position.y+.015,sz,0,p.rotation,0);
        }
      }
    }

    if(level.id==="0"&&!this.level0RedRoom&&!this.manilaRoom&&rngBase.next()<.035&&edges.length){
      const e=rngBase.pick(edges),p=wallPoint(e,.108,1.48),group=new THREE.Group();
      group.position.copy(p.position);group.rotation.y=p.rotation;
      box(group,new THREE.BoxGeometry(.46,.3,.07),lib.intercom,0,0,0);
      for(let i=-1;i<=1;i++)box(group,new THREE.BoxGeometry(.28,.018,.018),lib.intercomSlot,0,.075+i*.055,.041);
      box(group,new THREE.BoxGeometry(.055,.055,.018),lib.intercomSlot,.17,-.08,.041);
      g.add(group);
    }

    if(level.id==="0"&&!this.level0RedRoom&&!this.manilaRoom&&rngBase.next()<.045){
      const camGroup=new THREE.Group();
      camGroup.position.set(this.originX+cell*.5+cell*(cells-1)*rngBase.next(),level.wallHeight-.18,this.originZ+cell*.5+cell*(cells-1)*rngBase.next());
      const dome=new THREE.Mesh(new THREE.SphereGeometry(.17,10,6,0,Math.PI*2,0,Math.PI/2),lib.cameraDome);dome.scale.y=.65;camGroup.add(dome);
      box(camGroup,new THREE.BoxGeometry(.06,.06,.045),lib.socket,0,-.055,-.11);
      g.add(camGroup);
    }

    const buildDoor=(entry,exitDoor)=>{
      const doorHeight=Math.min(2.75,level.wallHeight-.16);
      const doorWidth=level.id==="0"?.96:Math.min(3.1,cell-.9);
      const frameWidth=Math.min(3.35,doorWidth+.24);
      const p=wallPoint(entry,.105,doorHeight/2),group=new THREE.Group();
      group.position.copy(p.position);group.rotation.y=p.rotation;
      const frameMat=exitDoor?lib.exitFrame:lib.doorFrame;
      box(group,new THREE.BoxGeometry(.16,doorHeight,.24),frameMat,-frameWidth/2,0,0);
      box(group,new THREE.BoxGeometry(.16,doorHeight,.24),frameMat,frameWidth/2,0,0);
      box(group,new THREE.BoxGeometry(frameWidth,.16,.24),frameMat,0,doorHeight/2-.08,0);
      const door=box(group,new THREE.BoxGeometry(doorWidth,doorHeight-.08,.09),(exitDoor?lib.exitDoor:lib.door).clone(),0,0,0);
      door.rotation.z=exitDoor?-0.12:-0.025;
      if(exitDoor)door.userData.exit=true;
      box(group,new THREE.BoxGeometry(.08,.1,.045),lib.handle,doorWidth*.25,.02,.06);
      g.add(group);
    };

    for(const d of this.falseDoors)buildDoor(d,false);

    if(this.exit){
      const e=this.exit;
      if(e.kind==="office"){
        const px=this.originX+size/2,pz=this.originZ+size-.2,doorWidth=1.16,doorHeight=2.55;
        box(g,new THREE.BoxGeometry(doorWidth,doorHeight,.1),lib.officePlastic,px,doorHeight/2,pz-.05);
        for(const side of [-1,1])box(g,new THREE.BoxGeometry(.12,doorHeight+.08,.16),lib.officeColumn,px+side*(doorWidth/2+.06),doorHeight/2,pz-.05);
        box(g,new THREE.BoxGeometry(doorWidth+.24,.12,.16),lib.officeColumn,px,doorHeight+.02,pz-.05);
        const signMaterial=new THREE.MeshStandardMaterial({color:0x5ca66b,emissive:0x287b3b,emissiveIntensity:.65,roughness:.5});
        box(g,new THREE.BoxGeometry(.72,.22,.035),signMaterial,px,doorHeight+.28,pz-.16);
        this.exit.position=new THREE.Vector3(px,1.05,pz-.86);
        this.lightSources.push({position:new THREE.Vector3(px,2.9,pz-.65),color:0x9cdb9a,baseIntensity:4,intensity:4,distance:8,decay:2});
      }else if(e.kind==="stairwell2"){
        const px=this.originX+e.x*cell+cell/2,pz=this.originZ+e.z*cell+cell/2;
        const landing=box(g,new THREE.BoxGeometry(3.9,.12,3.9),lib.concrete,px,.06,pz);
        landing.userData.exit=true;
        for(let i=0;i<8;i++){
          const step=box(
            g,
            new THREE.BoxGeometry(3.15,.16,.48),
            lib.stairs,
            px,
            .98-i*.12,
            pz-.20-i*.48
          );
          step.userData.exit=true;
        }
        const opening=box(g,new THREE.BoxGeometry(3.0,.025,1.55),lib.dark,px,.02,pz-2.0);
        opening.userData.exit=true;
        for(const side of [-1,1]){
          box(g,new THREE.BoxGeometry(.08,.92,3.9),lib.metal,px+side*2.02,.46,pz-1.4);
        }
        this.exit.position=new THREE.Vector3(px,.72,pz-1.65);
      }else if(e.kind==="door"){
        buildDoor(e,true);
        const px=this.originX+e.x*cell+cell/2,pz=this.originZ+e.z*cell+cell/2;
        this.exit.position=e.side==="north"?new THREE.Vector3(px,1.28,pz-cell/2-.78):
          e.side==="south"?new THREE.Vector3(px,1.28,pz+cell/2+.78):
          e.side==="west"?new THREE.Vector3(px-cell/2-.78,1.28,pz):
          new THREE.Vector3(px+cell/2+.78,1.28,pz);
      }else if(e.kind==="industrial"){
        const px=this.originX+size*.5,pz=this.originZ+size*.72,doorWidth=1.42,doorHeight=2.55,half=3.1;
        box(g,new THREE.BoxGeometry(half-doorWidth/2,level.wallHeight,.2),lib.wall,px-(half+doorWidth/2)/2,level.wallHeight/2,pz);
        box(g,new THREE.BoxGeometry(half-doorWidth/2,level.wallHeight,.2),lib.wall,px+(half+doorWidth/2)/2,level.wallHeight/2,pz);
        box(g,new THREE.BoxGeometry(doorWidth,level.wallHeight-doorHeight,.2),lib.rustMetal,px,(level.wallHeight+doorHeight)/2,pz);
        const door=box(g,new THREE.BoxGeometry(doorWidth-.08,doorHeight-.06,.09),lib.exitDoor.clone(),px,doorHeight/2,pz-.08);
        door.userData.exit=true;
        for(const side of [-1,1])box(g,new THREE.BoxGeometry(.13,doorHeight,.25),lib.exitFrame,px+side*(doorWidth/2+.07),doorHeight/2,pz-.06);
        box(g,new THREE.BoxGeometry(doorWidth+.28,.14,.25),lib.exitFrame,px,doorHeight+.02,pz-.06);
        box(g,new THREE.BoxGeometry(.12,.12,.08),level.id==="2"?lib.orangeLight:lib.indicator,px+doorWidth*.28,doorHeight-.28,pz-.2);
        this.collisionSegments.push({x1:px-half,z1:pz,x2:px-doorWidth/2-.08,z2:pz},{x1:px+doorWidth/2+.08,z1:pz,x2:px+half,z2:pz});
        this.exit.position=new THREE.Vector3(px,1.05,pz-.92);
        this.lightSources.push({position:new THREE.Vector3(px,2.8,pz-.7),color:level.id==="2"?0xa58aff:0x9cdb9a,baseIntensity:3.2,intensity:3.2,distance:7,decay:2});
      }else if(e.kind==="cave"){
        const px=this.originX+e.x*cell+cell/2,pz=this.originZ+e.z*cell+cell/2;
        const arch=new THREE.Mesh(tileGeometryUV(new THREE.TorusGeometry(1.7,.22,10,24),lib.concrete),lib.concrete);
        arch.position.set(px,1.45,pz);g.add(arch);
        box(g,new THREE.BoxGeometry(1.55,2.35,.14),lib.mahogany,px,1.18,pz-.08);
        box(g,new THREE.BoxGeometry(.16,2.55,.2),lib.hotelGold,px-.9,1.28,pz-.08);
        box(g,new THREE.BoxGeometry(.16,2.55,.2),lib.hotelGold,px+.9,1.28,pz-.08);
        box(g,new THREE.BoxGeometry(2.0,.16,.2),lib.hotelGold,px,2.58,pz-.08);
        box(g,new THREE.BoxGeometry(.72,.28,.06),lib.indicator,px,2.15,pz-.18);
        this.exit.position=new THREE.Vector3(px,1.05,pz-.85);
        this.lightSources.push({position:new THREE.Vector3(px,2.2,pz-.9),color:0xd8c28b,baseIntensity:3.4,intensity:3.4,distance:8,decay:2});
      }else if(e.kind==="ocean"){
        const px=this.originX+e.x*cell+cell/2,pz=this.originZ+e.z*cell+cell/2;
        const rim=new THREE.Mesh(tileGeometryUV(new THREE.TorusGeometry(1.45,.16,12,40),lib.rustMetal),lib.rustMetal);rim.rotation.x=Math.PI/2;rim.position.set(px,.055,pz);g.add(rim);
        const shaft=new THREE.Mesh(new THREE.CylinderGeometry(1.18,1.18,2.8,24,1,true),lib.dark);shaft.position.set(px,-1.35,pz);g.add(shaft);
        for(let i=0;i<7;i++)box(g,new THREE.BoxGeometry(1.1,.08,.08),lib.metal,px,-.35-i*.32,pz);
        this.exit.position=new THREE.Vector3(px,.82,pz);
      }else if(e.kind==="suburb"){
        const px=this.originX+(e.x+e.w/2)*cell,pz=this.originZ+(e.z+e.h/2)*cell-3.28;
        box(g,new THREE.BoxGeometry(1.18,2.3,.09),lib.exitDoor,px,1.15,pz);
        for(const side of [-1,1])box(g,new THREE.BoxGeometry(.1,2.48,.14),lib.exitFrame,px+side*.66,1.24,pz);
        box(g,new THREE.BoxGeometry(1.42,.12,.16),lib.exitFrame,px,2.42,pz);
        this.exit.position=new THREE.Vector3(px,1.1,pz-.5);
        this.lightSources.push({position:new THREE.Vector3(px,2.5,pz-.5),color:0x9cdb9a,baseIntensity:2.6,intensity:2.6,distance:6,decay:2});
      }else if(e.kind==="field"){
        const px=this.originX+(e.x+.5)*cell,pz=this.originZ+(e.z+.5)*cell-3.25;
        for(const side of [-1,1])box(g,new THREE.BoxGeometry(.14,4.2,.18),lib.exitFrame,px+side*1.18,2.1,pz);
        box(g,new THREE.BoxGeometry(2.55,.16,.18),lib.exitFrame,px,4.05,pz);
        this.exit.position=new THREE.Vector3(px,1.1,pz-.55);
        this.lightSources.push({position:new THREE.Vector3(px,2.2,pz-.7),color:0xc2a46b,baseIntensity:2.2,intensity:2.2,distance:7,decay:2});
      }else{
        const p=wallPoint(e,.105,1.95),anomaly=box(g,new THREE.BoxGeometry(1.72,2.35,.028),lib.wallAnomaly.clone(),p.position.x,p.position.y,p.position.z,0,p.rotation,0);
        anomaly.userData.exit=true;
        this.lightSources.push({position:p.position.clone(),color:0xffeaa0,baseIntensity:.65,intensity:.65,distance:5,decay:2});
        this.exit.position=p.position.clone();
      }
    }

    if(level.id==="0"&&!this.level0RedRoom&&!this.manilaRoom&&rngBase.next()<.12){
      const candidates=edges.filter(e=>e.side==="north"||e.side==="south");
      if(candidates.length){
        const e=rngBase.pick(candidates),p=wallPoint(e,.108,.9);
        const patch=box(g,new THREE.BoxGeometry(.75,.42,.026),lib.mold.clone(),p.position.x,p.position.y,p.position.z,0,p.rotation,0);
        patch.scale.y=.8;
      }
    }

    if(level.id==="2"){
      const rng=new RNG(this.seedKey()^0x72ea),pipeMat=lib.metal,rustMat=lib.rustMetal;
      const tiledWallGeometry=(width,height,depth,tileSize=2.8)=>{
        const geometry=new THREE.BoxGeometry(width,height,depth);
        const positions=geometry.attributes.position,normals=geometry.attributes.normal,uvs=geometry.attributes.uv;
        for(let i=0;i<positions.count;i++){
          const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);
          const nx=Math.abs(normals.getX(i)),ny=Math.abs(normals.getY(i)),nz=Math.abs(normals.getZ(i));
          if(ny>nx&&ny>nz)uvs.setXY(i,x/tileSize,z/tileSize);
          else if(nx>nz)uvs.setXY(i,z/tileSize,y/tileSize);
          else uvs.setXY(i,x/tileSize,y/tileSize);
        }
        uvs.needsUpdate=true;
        return geometry;
      };
      const addUtilityWall=(x1,z1,x2,z2,height=2.95,material=lib.wall)=>{
        const dx=x2-x1,dz=z2-z1,length=Math.hypot(dx,dz),angle=-Math.atan2(dz,dx);
        if(length<.3)return;
        box(g,tiledWallGeometry(length,height,.18),material,(x1+x2)/2,height/2,(z1+z2)/2,0,angle,0);
        this.collisionSegments.push({x1,z1,x2,z2});
      };
      const cx=this.originX+size/2,cz=this.originZ+size/2,door=1.5,offset=1.85;
      // Two continuous service corridors meet at a cross-junction. Wall runs
      // are split into real door openings so neighboring streamed chunks join.
      for(const side of [-1,1]){
        const x=cx+side*offset,z=cz+side*offset;
        addUtilityWall(x,this.originZ,x,cz-door/2);
        addUtilityWall(x,cz+door/2,x,this.originZ+size);
        addUtilityWall(this.originX,z,cx-door/2,z);
        addUtilityWall(cx+door/2,z,this.originX+size,z);
      }
      // Keep the cross-junction completely open. Do not generate room
      // partitions or machinery in this shared passage volume.
      const pipeMeshes=[];
      const addPipeSegment=(start,end,rusted=false)=>{
        const direction=new THREE.Vector3().subVectors(end,start),length=direction.length();
        if(length<.12)return;
        const geometry=new THREE.CylinderGeometry(.105,.105,length,12,1);
        const positions=geometry.attributes.position,uvs=geometry.attributes.uv;
        const circumference=Math.PI*.21;
        for(let i=0;i<positions.count;i++){
          const y=positions.getY(i);
          uvs.setXY(i,uvs.getX(i)*circumference/.8,(y+length/2)/.8);
        }
        uvs.needsUpdate=true;
        const mesh=new THREE.Mesh(geometry,rusted?rustMat:pipeMat);
        mesh.position.copy(start).add(end).multiplyScalar(.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
        mesh.userData.pipeNetwork=true;g.add(mesh);pipeMeshes.push(mesh);
      };
      const addPipeRoute=(points,rusted=false)=>{
        const pts=points.map(point=>new THREE.Vector3(...point)),trim=.22;
        for(let i=0;i<pts.length-1;i++){
          const direction=new THREE.Vector3().subVectors(pts[i+1],pts[i]).normalize();
          const a=pts[i].clone().addScaledVector(direction,i>0?trim:0);
          const b=pts[i+1].clone().addScaledVector(direction,i<pts.length-2?-trim:0);
          addPipeSegment(a,b,rusted);
          if(i<pts.length-2){
            const nextDirection=new THREE.Vector3().subVectors(pts[i+2],pts[i+1]).normalize();
            const elbowStart=pts[i+1].clone().addScaledVector(direction,-trim);
            const elbowEnd=pts[i+1].clone().addScaledVector(nextDirection,trim);
            const curve=new THREE.QuadraticBezierCurve3(elbowStart,pts[i+1],elbowEnd);
            const geometry=new THREE.TubeGeometry(curve,8,.105,10,false);
            const uv=geometry.attributes.uv,curveLength=curve.getLength(),circumference=Math.PI*.21;
            for(let v=0;v<uv.count;v++)uv.setXY(v,uv.getX(v)*circumference/.8,uv.getY(v)*curveLength/.8);
            uv.needsUpdate=true;
            const elbow=new THREE.Mesh(geometry,rusted?rustMat:pipeMat);
            elbow.userData.pipeNetwork=true;g.add(elbow);pipeMeshes.push(elbow);
          }
        }
      };
      const yNorthSouth=3.02,yEastWest=3.02;
      // Route mains along the outer edges of each corridor arm. Every route
      // stops before a cross-corridor opening; no pipe spans a doorway.
      const junctionGap=3.25,crossGap=1.25;
      const addRunWithOpening=(axis,fixed,start,end,openingCenter,openingHalf,rusted)=>{
        const intervals=[];
        const lo=Math.min(start,end),hi=Math.max(start,end);
        const cutA=Math.max(lo,openingCenter-openingHalf),cutB=Math.min(hi,openingCenter+openingHalf);
        if(cutA>lo+.25)intervals.push([lo,cutA]);
        if(cutB<hi-.25)intervals.push([cutB,hi]);
        for(const [a,b] of intervals){
          const p0=axis==="z"?[fixed,yNorthSouth,a]:[a,yEastWest,fixed];
          const p1=axis==="z"?[fixed,yNorthSouth,b]:[b,yEastWest,fixed];
          addPipeRoute([p0,p1],rusted);
        }
      };
      for(const side of [-1,1]){
        const x=cx+side*1.38;
        const northEnd=cz-junctionGap;
        const southStart=cz+junctionGap;
        addRunWithOpening("z",x,this.originZ+1.1,northEnd,cz-1.85,crossGap,side>0);
        addRunWithOpening("z",x,southStart,this.originZ+size-1.1,cz+1.85,crossGap,side>0);
        const z=cz+side*1.38;
        const westEnd=cx-junctionGap;
        const eastStart=cx+junctionGap;
        addRunWithOpening("x",z,this.originX+1.1,westEnd,cx-1.85,crossGap,side<0);
        addRunWithOpening("x",z,eastStart,this.originX+size-1.1,cx+1.85,crossGap,side<0);
      }
      // No low-hanging risers, valve wheels, or equipment are placed in the
      // cross-path. Those details belong in dedicated wall recesses only.
      // Repeating support frames and warm fixtures follow both corridor axes.
      const addFrame=(x,z,alongZ)=>{
        for(const side of [-1,1]){
          const px=x+(alongZ?side*1.68:0),pz=z+(alongZ?0:side*1.68);
          box(g,new THREE.BoxGeometry(.1,2.82,.1),lib.rustMetal,px,1.41,pz);
          box(g,new THREE.BoxGeometry(.2,.12,.2),lib.metal,px,2.78,pz);
        }
        box(g,alongZ?new THREE.BoxGeometry(3.45,.13,.14):new THREE.BoxGeometry(.14,.13,3.45),lib.rustMetal,x,2.88,z);
        box(g,alongZ?new THREE.BoxGeometry(3.25,.055,.09):new THREE.BoxGeometry(.09,.055,3.25),lib.metal,x,2.79,z);
      };
      const addTunnelLight=(x,z,alongZ,index)=>{
        const material=lib.light.clone();
        material.color.setHex(index%4===0?0xffe4bc:0xfff0d5);
        material.emissive.setHex(index%4===0?0xffa65f:0xffd5a1);
        material.emissiveIntensity=index%4===0?1.65:2.25;
        const fixture=box(g,new THREE.BoxGeometry(1.18,.055,.34),material,x,3.055,z,0,alongZ?Math.PI/2:0,0);
        fixture.userData.light=true;fixture.userData.baseEmissive=material.emissiveIntensity;this.fixtures.push(fixture);
        this.lightSources.push({position:new THREE.Vector3(x,2.88,z),color:index%4===0?0xffb16f:0xffd8ad,baseIntensity:index%4===0?78:112,intensity:index%4===0?78:112,distance:11.5,decay:2,fixture});
      };
      let fixtureIndex=0;
      for(let i=0;i<5;i++){
        const z=this.originZ+5+i*10;
        if(Math.abs(z-cz)<6)continue;
        addFrame(cx,z,true);addTunnelLight(cx,z,true,fixtureIndex++);
      }
      for(let i=0;i<5;i++){
        const x=this.originX+5+i*10;
        if(Math.abs(x-cx)<6)continue;
        addFrame(x,cz,false);addTunnelLight(x,cz,false,fixtureIndex++);
      }
      // The junction is deliberately left free of drains, grates, markings,
      // props and collision geometry so all four exits remain unobstructed.
    }else if(level.id==="3"){
      const rng=new RNG(this.seedKey()^0x31e1);
      const cx=this.originX+size/2,cz=this.originZ+size/2;
      const brick=lib.brickWall||lib.rustMetal;
      const addStationWall=(x1,z1,x2,z2,height=3.35,material=brick)=>{
        const dx=x2-x1,dz=z2-z1,length=Math.hypot(dx,dz);
        if(length<.3)return;
        box(g,new THREE.BoxGeometry(length,height,.22),material,(x1+x2)/2,height/2,(z1+z2)/2,0,-Math.atan2(dz,dx),0);
        this.collisionSegments.push({x1,z1,x2,z2});
      };
      const addDivider=(axis,fixed,start,end,opening,openingWidth=1.55,height=3.35,material=brick)=>{
        const lo=opening-openingWidth/2,hi=opening+openingWidth/2;
        if(axis==="x"){
          if(lo>start)addStationWall(start,fixed,lo,fixed,height,material);
          if(hi<end)addStationWall(hi,fixed,end,fixed,height,material);
        }else{
          if(lo>start)addStationWall(fixed,start,fixed,lo,height,material);
          if(hi<end)addStationWall(fixed,hi,fixed,end,height,material);
        }
      };
      const addGate=(x,z,alongX=true)=>{
        const length=3.9,depth=.18,half=length/2;
        const gate=new THREE.Group();
        gate.position.set(x,0,z);
        if(!alongX)gate.rotation.y=Math.PI/2;
        for(const side of [-1,1]){
          const post=box(gate,new THREE.BoxGeometry(.17,2.85,.17),lib.rustMetal,side*half,1.425,0);
          post.userData.level3GatePart=true;
        }
        for(let i=0;i<9;i++){
          const bar=box(gate,new THREE.BoxGeometry(.075,2.55,.075),lib.metal,-half+.48+i*.49,1.34,0);
          bar.userData.level3GatePart=true;
        }
        for(const y of [.42,1.32,2.28]){
          const cross=box(gate,new THREE.BoxGeometry(length,.12,.12),lib.rustMetal,0,y,0);
          cross.userData.level3GatePart=true;
        }
        gate.userData.isLevel3BarredGate=true;
        gate.userData.roomType="blocked-utility-passage";
        g.add(gate);
        if(alongX)this.collisionSegments.push({x1:x-half,z1:z,x2:x+half,z2:z});
        else this.collisionSegments.push({x1:x,z1:z-half,x2:x,z2:z+half});
      };
      const addPanel=(x,z,rotation=0,large=false)=>{
        const panel=new THREE.Group();
        panel.position.set(x,0,z);
        panel.rotation.y=rotation;
        const width=large?1.35:.9,height=large?1.85:1.15;
        box(panel,new THREE.BoxGeometry(width,height,.16),lib.rustMetal,0,1.4,0);
        box(panel,new THREE.BoxGeometry(width-.14,height-.16,.045),lib.dark,0,1.4,.105);
        for(let row=0;row<(large?5:3);row++){
          const yy=.82+row*(large?.27:.36);
          box(panel,new THREE.BoxGeometry(width*.55,.045,.035),lib.handle,-.08,yy,.14);
          const lamp=box(panel,new THREE.BoxGeometry(.095,.095,.05),row%3===0?lib.orangeLight:lib.indicator,width*.33,yy,.145);
          lamp.userData.light=true;
          lamp.userData.level3PanelIndicator=true;
        }
        for(let i=0;i<3;i++){
          const cable=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,1.8+i*.35,6),lib.cable);
          cable.position.set(-width*.28+i*.25,2.8,.04);panel.add(cable);
        }
        panel.userData.level3ElectricalPanel=true;
        g.add(panel);
        const halfX=width*.58,halfZ=.2,c=Math.cos(rotation),sn=Math.sin(rotation);
        const corners=[[-halfX,-halfZ],[halfX,-halfZ],[halfX,halfZ],[-halfX,halfZ]].map(([dx,dz])=>({x:x+dx*c+dz*sn,z:z-dx*sn+dz*c}));
        for(let i=0;i<4;i++){
          const a=corners[i],b=corners[(i+1)%4];
          this.collisionSegments.push({x1:a.x,z1:a.z,x2:b.x,z2:b.z});
        }
      };
      const addPipeRun=(x1,z1,x2,z2,y=2.95,radius=.075,material=lib.metal)=>{
        const a=new THREE.Vector3(x1,y,z1),b=new THREE.Vector3(x2,y,z2),delta=b.clone().sub(a);
        const pipe=new THREE.Mesh(tileGeometryUV(new THREE.CylinderGeometry(radius,radius,delta.length(),8),material),material);
        pipe.position.copy(a).add(b).multiplyScalar(.5);
        pipe.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
        pipe.userData.level3Pipe=true;
        g.add(pipe);
        const hangerCount=Math.max(2,Math.floor(delta.length()/10));
        for(let i=1;i<hangerCount;i++){
          const t=i/hangerCount;
          box(g,new THREE.BoxGeometry(.07,.42,.07),lib.rustMetal,x1+(x2-x1)*t,y+.25,z1+(z2-z1)*t);
        }
      };
      const addCorridorLight=(x,z,index)=>{
        const fixture=box(g,new THREE.BoxGeometry(1.55,.06,.34),lib.light,x,level.wallHeight+.035,z,0,index%2?Math.PI/2:0,0);
        fixture.material=lib.light.clone();
        fixture.material.color.setHex(index%4===0?0xe4d5bd:0xf2eee5);
        fixture.material.emissive.setHex(0xe0cba7);
        fixture.material.emissiveIntensity=index%4===0?.78:1.05;
        fixture.userData.light=true;
        fixture.userData.baseEmissive=fixture.material.emissiveIntensity;
        fixture.userData.level3Fluorescent=true;
        this.fixtures.push(fixture);
        this.lightSources.push({position:new THREE.Vector3(x,level.wallHeight-.4,z),color:0xd9c8aa,baseIntensity:18+index%3*2,intensity:18+index%3*2,distance:14,decay:2,fixture});
      };
      // An open four-way circulation spine ties every streamed sector together.
      // Brick dividers create side rooms without sealing chunk connections.
      const left=this.originX+size*.29,right=this.originX+size*.71;
      const near=this.originZ+size*.29,far=this.originZ+size*.71;
      addDivider("z",left,this.originZ+1.2,this.originZ+size-1.2,cz,1.9);
      addDivider("z",right,this.originZ+1.2,this.originZ+size-1.2,cz,1.9);
      addDivider("x",near,this.originX+1.2,this.originX+size-1.2,cx,1.9);
      addDivider("x",far,this.originX+1.2,this.originX+size-1.2,cx,1.9);
      for(const x of [this.originX+size*.13,this.originX+size*.87]){
        addDivider("z",x,this.originZ+size*.12,this.originZ+size*.88,cz,4.2,3.2,brick);
      }
      for(const z of [this.originZ+size*.13,this.originZ+size*.87]){
        addDivider("x",z,this.originX+size*.12,this.originX+size*.88,cx,4.2,3.2,brick);
      }
      // Inner cross-links are deliberately broken by narrow door openings.
      addDivider("z",cx-9,this.originZ+size*.13,this.originZ+size*.87,cz+size*.12,1.8,3.0,brick);
      addDivider("z",cx+9,this.originZ+size*.13,this.originZ+size*.87,cz-size*.12,1.8,3.0,brick);
      addDivider("x",cz-9,this.originX+size*.13,this.originX+size*.87,cx-size*.12,1.8,3.0,brick);
      addDivider("x",cz+9,this.originX+size*.13,this.originX+size*.87,cx+size*.12,1.8,3.0,brick);

      // Heavy barred gates interrupt two visible arms of the main service spine.
      // Their centre remains open so the player can orient before reaching them.
      addGate(cx,cz-size*.22,true);
      addGate(cx+size*.22,cz,false);
      addGate(cx-size*.22,cz,false);

      // Cable trays and insulated pipes run above the service corridors.
      for(const offset of [-2.35,2.35]){
        addPipeRun(this.originX+1.2,cz+offset,this.originX+size-1.2,cz+offset,3.12,.075,lib.metal);
        addPipeRun(cx+offset,this.originZ+1.2,cx+offset,this.originZ+size-1.2,3.18,.095,lib.rustMetal);
        box(g,new THREE.BoxGeometry(size-2.4,.07,.12),lib.rustMetal,cx,3.28,cz+offset);
      }
      // Breaker and switchgear panels are wall-mounted, never placed in the
      // centre of the service lanes or on top of the overhead pipe runs.
      for(const z of [this.originZ+size*.19,this.originZ+size*.39,this.originZ+size*.61,this.originZ+size*.81]){
        addPanel(left+.14,z,Math.PI/2,Math.abs(z-cz)>size*.28);
        addPanel(right-.14,z,-Math.PI/2,Math.abs(z-cz)>size*.28);
      }
      for(const x of [this.originX+size*.19,this.originX+size*.81]){
        addPanel(x,near+.14,0,false);
        addPanel(x,far-.14,Math.PI,false);
      }
      let fixtureIndex=0;
      for(let i=0;i<7;i++){
        addCorridorLight(this.originX+10+i*14.2,cz,fixtureIndex++);
        addCorridorLight(cx,this.originZ+10+i*14.2,fixtureIndex++);
      }

      const roomX=cx+size*.24,roomZ=cz+size*.24;
      const roomGroup=new THREE.Group();
      roomGroup.userData.isLevel3SpecialRoom=true;
      roomGroup.userData.level3RoomType=this.zone;
      roomGroup.position.set(roomX,0,roomZ);
      if(this.zone==="generator"){
        // Generator room: large alternator, ribbed housings, control desk and conduit.
        const generator=new THREE.Group();generator.position.set(roomX,0,roomZ);
        box(generator,new THREE.BoxGeometry(4.8,1.8,2.8),lib.rustMetal,0,.98,0);
        box(generator,new THREE.BoxGeometry(4.25,.18,2.45),lib.metal,0,1.96,0);
        for(let fin=0;fin<13;fin++)box(generator,new THREE.BoxGeometry(.11,1.35,2.05),lib.metal,-2.0+fin*.33,1.05,-.1);
        const rotor=new THREE.Mesh(tileGeometryUV(new THREE.CylinderGeometry(.64,.64,1.6,18),lib.metal),lib.metal);
        rotor.rotation.z=Math.PI/2;rotor.position.set(0,2.34,0);generator.add(rotor);
        box(generator,new THREE.BoxGeometry(1.25,1.7,.7),lib.officePlastic,3.3,.88,-.65);
        for(let i=0;i<5;i++)box(generator,new THREE.BoxGeometry(.11,.11,.05),i%2?lib.indicator:lib.orangeLight,2.78+i*.22,1.28,-1.02);
        generator.userData.level3RoomType="generator";
        g.add(generator);
        const gx=roomX,gz=roomZ;
        this.collisionSegments.push({x1:gx-2.5,z1:gz-1.5,x2:gx+2.5,z2:gz-1.5},{x1:gx+2.5,z1:gz-1.5,x2:gx+2.5,z2:gz+1.5},{x1:gx+2.5,z1:gz+1.5,x2:gx-2.5,z2:gz+1.5},{x1:gx-2.5,z1:gz+1.5,x2:gx-2.5,z2:gz-1.5});
      }else if(this.zone==="assembly"){
        const beltZ=roomZ;
        for(const offset of [-2.3,2.3]){
          const belt=new THREE.Group();belt.position.set(roomX,0,beltZ+offset);
          box(belt,new THREE.BoxGeometry(9.2,.2,1.4),lib.metal,0,.72,0);
          box(belt,new THREE.BoxGeometry(8.8,.07,1.1),lib.dark,0,.86,0);
          for(let roller=0;roller<15;roller++){
            const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.14,.14,1.2,8),lib.handle);
            wheel.rotation.z=Math.PI/2;wheel.position.set(-4.25+roller*.61,.58,0);belt.add(wheel);
          }
          for(let crate=0;crate<3;crate++)box(belt,new THREE.BoxGeometry(.62,.54,.48),lib.crate,-2.6+crate*2.4,1.22,.12);
          belt.userData.level3AssemblyLine=true;g.add(belt);
          this.collisionSegments.push({x1:roomX-4.7,z1:beltZ+offset-.78,x2:roomX+4.7,z2:beltZ+offset-.78},{x1:roomX+4.7,z1:beltZ+offset-.78,x2:roomX+4.7,z2:beltZ+offset+.78},{x1:roomX+4.7,z1:beltZ+offset+.78,x2:roomX-4.7,z2:beltZ+offset+.78},{x1:roomX-4.7,z1:beltZ+offset+.78,x2:roomX-4.7,z2:beltZ+offset-.78});
        }
      }else if(this.zone==="boiler"){
        for(let i=0;i<3;i++){
          const bx=roomX-4+i*4,bz=roomZ;
          const tank=new THREE.Mesh(tileGeometryUV(new THREE.CylinderGeometry(1.05,1.05,3.1,16),lib.rustMetal),lib.rustMetal);
          tank.position.set(bx,1.65,bz);g.add(tank);
          const cap=new THREE.Mesh(tileGeometryUV(new THREE.SphereGeometry(1.04,14,8,0,Math.PI*2,0,Math.PI/2),lib.metal),lib.metal);
          cap.position.set(bx,3.18,bz);g.add(cap);
          addPipeRun(bx,bz-1,bx,roomZ-6,2.45,.12,lib.rustMetal);
          this.collisionSegments.push({x1:bx-1.1,z1:bz-1.1,x2:bx+1.1,z2:bz-1.1},{x1:bx+1.1,z1:bz-1.1,x2:bx+1.1,z2:bz+1.1},{x1:bx+1.1,z1:bz+1.1,x2:bx-1.1,z2:bz+1.1},{x1:bx-1.1,z1:bz+1.1,x2:bx-1.1,z2:bz-1.1});
        }
      }else if(this.zone==="switchgear"){
        // A high-voltage switchgear bay: paired breaker cabinets, visible
        // busbars, ceramic standoffs and heavy conduit instead of decorative props.
        for(const side of [-1,1]){
          const bankX=roomX+side*3.15;
          const bank=new THREE.Group();bank.position.set(bankX,0,roomZ);
          box(bank,new THREE.BoxGeometry(2.45,2.55,1.25),lib.rustMetal,0,1.3,0);
          box(bank,new THREE.BoxGeometry(2.12,2.16,.055),lib.dark,0,1.32,-.655);
          box(bank,new THREE.BoxGeometry(2.18,.12,.08),lib.metal,0,2.48,-.68);
          for(let row=0;row<4;row++){
            const y=2.05-row*.43;
            for(let col=0;col<3;col++){
              const x=-.68+col*.68;
              const switchHandle=box(bank,new THREE.BoxGeometry(.13,.18,.075),lib.handle,x,y,-.71);
              switchHandle.userData.level3BreakerSwitch=true;
              const lamp=box(bank,new THREE.BoxGeometry(.12,.105,.065),(row+col)%3===0?lib.orangeLight:lib.indicator,x,y+.16,-.71);
              lamp.userData.level3BreakerIndicator=true;
            }
          }
          for(let fin=0;fin<9;fin++){
            box(bank,new THREE.BoxGeometry(.09,1.92,.34),lib.metal,-1.12+fin*.28,1.32,.72);
          }
          const cabinet=box(bank,new THREE.BoxGeometry(2.5,.13,1.3),lib.metal,0,.12,0);
          cabinet.userData.level3SwitchgearCabinet=true;
          bank.userData.level3SwitchgearBank=true;
          g.add(bank);
          const halfX=1.27,halfZ=.68;
          this.collisionSegments.push(
            {x1:bankX-halfX,z1:roomZ-halfZ,x2:bankX+halfX,z2:roomZ-halfZ},
            {x1:bankX+halfX,z1:roomZ-halfZ,x2:bankX+halfX,z2:roomZ+halfZ},
            {x1:bankX+halfX,z1:roomZ+halfZ,x2:bankX-halfX,z2:roomZ+halfZ},
            {x1:bankX-halfX,z1:roomZ+halfZ,x2:bankX-halfX,z2:roomZ-halfZ}
          );
        }
        for(const offset of [-2.15,2.15]){
          addPipeRun(roomX-5.2,roomZ+offset,roomX+5.2,roomZ+offset,3.08,.11,lib.rustMetal);
          addPipeRun(roomX-5.2,roomZ+offset,roomX+5.2,roomZ+offset,3.32,.065,lib.metal);
        }
        const insulatorGeometry=new THREE.CylinderGeometry(.13,.19,.62,10);
        for(const xOffset of [-4.6,-2.3,0,2.3,4.6])for(const zOffset of [-2.15,2.15]){
          const insulator=new THREE.Mesh(insulatorGeometry,lib.officeColumn||lib.officePlastic);
          insulator.position.set(roomX+xOffset,2.73,roomZ+zOffset);
          insulator.userData.level3BusbarInsulator=true;
          g.add(insulator);
        }
        const warning=box(g,new THREE.BoxGeometry(1.85,.48,.055),lib.orangeLight,roomX,2.78,roomZ-5.1);
        warning.userData.level3WarningSign=true;
        warning.userData.label="HIGH VOLTAGE";
      }else{
        const storage=new THREE.Group();storage.position.set(roomX,0,roomZ);
        for(let i=0;i<4;i++){
          box(storage,new THREE.BoxGeometry(.09,2.35,.09),lib.metal,-2.1+i*1.4,1.18,0);
          box(storage,new THREE.BoxGeometry(1.4,.08,.42),lib.rustMetal,-1.4+i*1.4,.7,0);
          box(storage,new THREE.BoxGeometry(1.2,.5,.7),lib.crate,-1.4+i*1.4,1.05,.08);
        }
        g.add(storage);
      }
      roomGroup.userData.level3RoomType=this.zone;
      g.add(roomGroup);
      this.rooms.push({x:Math.floor(cells*.72),z:Math.floor(cells*.72),w:3,h:3,type:this.zone});
      // The side-room doorway is visibly marked but not sealed; the gate props
      // above are separate dead-end passages, never chunk-to-chunk blockers.
    }else if(level.id==="4"){
      const rng=new RNG(this.seedKey()^0x44aa);
      const colMat=lib.officeColumn||lib.officePlastic;
      const wallMat=lib.officePlastic;
      const cx=this.originX+size/2,cz=this.originZ+size/2,doorWidth=1.75;
      let officeWindowIndex=0;
      const roomSpecs=[
        {type:"empty-office",x:.08,z:.08,w:.23,h:.23},
        {type:"open-office",x:.40,z:.08,w:.24,h:.22},
        {type:"meeting-room",x:.72,z:.09,w:.20,h:.22},
        {type:"workroom",x:.08,z:.43,w:.22,h:.18},
        {type:"break-room",x:.40,z:.43,w:.22,h:.18},
        {type:"copy-room",x:.73,z:.45,w:.19,h:.20},
        {type:"records-room",x:.08,z:.72,w:.22,h:.18},
        {type:"cubicle-room",x:.39,z:.72,w:.27,h:.16}
      ];
      const addOfficeWall=(x1,z1,x2,z2,height=3.35,material=wallMat)=>{
        const dx=x2-x1,dz=z2-z1,length=Math.hypot(dx,dz);
        if(length<.25)return;
        box(g,new THREE.BoxGeometry(length,height,.15),material,(x1+x2)/2,height/2,(z1+z2)/2,0,-Math.atan2(dz,dx),0);
        this.collisionSegments.push({x1,z1,x2,z2});
      };
      const addOfficePartition=(axis,fixed,start,end,opening,width=doorWidth,height=3.35)=>{
        const a=opening-width/2,b=opening+width/2;
        if(axis==="z"){
          if(a>start)addOfficeWall(fixed,start,fixed,a,height);
          if(b<end)addOfficeWall(fixed,b,fixed,end,height);
        }else{
          if(a>start)addOfficeWall(start,fixed,a,fixed,height);
          if(b<end)addOfficeWall(b,fixed,end,fixed,height);
        }
      };
      const addOfficeWindow=(axis,fixed,center,index)=>{
        const alongZ=axis==="z",rotation=alongZ?-Math.PI/2:0;
        const windowGroup=new THREE.Group();
        windowGroup.position.set(alongZ?fixed:center,0,alongZ?center:fixed);
        windowGroup.rotation.y=rotation;
        const blackedOut=officeWindowIndex++%4!==0;
        const pane=box(windowGroup,new THREE.BoxGeometry(3.05,1.42,.055),blackedOut?lib.officeWindowBlackout:lib.officeWindowGlass,0,2.15,0);
        pane.userData.isLevel4Window=true;
        pane.userData.isLevel4BlackedOut=blackedOut;
        pane.userData.rainy=!blackedOut&&index%3!==1;
        if(blackedOut){
          for(let slat=0;slat<5;slat++)box(windowGroup,new THREE.BoxGeometry(2.86,.035,.018),lib.officeBlind,0,1.64+slat*.23,.05);
        }
        const frame=lib.officeColumn||lib.officeFileCabinet;
        box(windowGroup,new THREE.BoxGeometry(3.22,.12,.13),frame,0,1.42,0);
        box(windowGroup,new THREE.BoxGeometry(3.22,.12,.13),frame,0,2.88,0);
        for(const side of [-1,1])box(windowGroup,new THREE.BoxGeometry(.12,1.58,.13),frame,side*1.55,2.15,0);
        if(!blackedOut&&index%3!==1){
          for(let streak=0;streak<7;streak++){
            const sx=-1.18+streak*.39;
            const drops=box(windowGroup,new THREE.BoxGeometry(.018,.76+rng.next()*.56,.012),lib.officeWindowStreak,sx,2.15+(rng.next()-.5)*.1,.045);
            drops.userData.isLevel4RainStreak=true;
          }
        }
        windowGroup.userData.isLevel4Window=true;
        g.add(windowGroup);
        if(alongZ)this.collisionSegments.push({x1:fixed,z1:center-1.55,x2:fixed,z2:center+1.55});
        else this.collisionSegments.push({x1:center-1.55,z1:fixed,x2:center+1.55,z2:fixed});
      };
      const addOfficeBoundary=(axis,fixed,start,end)=>{
        const span=end-start;
        const openings=[
          {center:start+span*(.18+rng.next()*.07),width:3.35,window:true},
          {center:start+span*(.52+rng.next()*.10),width:1.95,window:false},
          {center:start+span*(.80-rng.next()*.07),width:3.15,window:true}
        ].sort((a,b)=>a.center-b.center);
        let cursor=start,index=0;
        for(const opening of openings){
          const a=opening.center-opening.width/2,b=opening.center+opening.width/2;
          if(a>cursor){
            if(axis==="x")addOfficeWall(cursor,fixed,a,fixed,level.wallHeight);
            else addOfficeWall(fixed,cursor,fixed,a,level.wallHeight);
          }
          if(opening.window)addOfficeWindow(axis,fixed,opening.center,index++);
          cursor=b;
        }
        if(cursor<end){
          if(axis==="x")addOfficeWall(cursor,fixed,end,fixed,level.wallHeight);
          else addOfficeWall(fixed,cursor,fixed,end,level.wallHeight);
        }
      };
      for(const z of [this.originZ+.22,this.originZ+size-.22])addOfficeBoundary("x",z,this.originX+.2,this.originX+size-.2);
      for(const x of [this.originX+.22,this.originX+size-.22])addOfficeBoundary("z",x,this.originZ+.2,this.originZ+size-.2);
      // Staggered partitions form a connected sequence of offices rather than a single crosswall.
      const xA=this.originX+size*(.33+(rng.next()-.5)*.035);
      const xB=this.originX+size*(.68+(rng.next()-.5)*.035);
      const zA=this.originZ+size*(.35+(rng.next()-.5)*.035);
      const zB=this.originZ+size*(.65+(rng.next()-.5)*.035);
      addOfficePartition("z",xA,this.originZ+size*.05,this.originZ+size*.44,this.originZ+size*.24,2.15);
      addOfficePartition("z",xA,this.originZ+size*.56,this.originZ+size*.95,this.originZ+size*.78,2.0);
      addOfficePartition("z",xB,this.originZ+size*.07,this.originZ+size*.49,this.originZ+size*.29,2.1);
      addOfficePartition("z",xB,this.originZ+size*.59,this.originZ+size*.95,this.originZ+size*.76,1.95);
      addOfficePartition("x",zA,this.originX+size*.05,xA-1,this.originX+size*.20,2.0);
      addOfficePartition("x",zA,xA+2,xB-1,this.originX+size*.51,2.0);
      addOfficePartition("x",zB,this.originX+size*.70,this.originX+size*.95,this.originX+size*.82,1.9);
      addOfficePartition("x",this.originZ+size*.83,this.originX+size*.06,this.originX+size*.31,this.originX+size*.17,1.9);

      // White support columns at corridor intersections (batched and collidable).
      const columns=[];
      const columnDummy=new THREE.Object3D();
      for(const x of [this.originX+size*.28,this.originX+size*.77]){
        for(const z of [this.originZ+size*.23,this.originZ+size*.73]){
          columns.push({x,z});
          const half=.42;
          this.collisionSegments.push({x1:x-half,z1:z-half,x2:x+half,z2:z-half},{x1:x+half,z1:z-half,x2:x+half,z2:z+half},{x1:x+half,z1:z+half,x2:x-half,z2:z+half},{x1:x-half,z1:z+half,x2:x-half,z2:z-half});
        }
      }
      const columnMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(.72,level.wallHeight,.72),colMat,columns.length);
      columns.forEach((p,i)=>{columnDummy.position.set(p.x,level.wallHeight/2,p.z);columnDummy.updateMatrix();columnMesh.setMatrixAt(i,columnDummy.matrix)});
      columnMesh.instanceMatrix.needsUpdate=true;columnMesh.userData.isLevel4Columns=true;g.add(columnMesh);

      // Drop-ceiling panels are instanced in two large batches, not thousands of meshes.
      const tileMatrices=[],lightMatrices=[];
      const tileDummy=new THREE.Object3D();
      const tileStep=6,tileSize=5.9;
      let panelIndex=0;
      for(let z=this.originZ+3;z<this.originZ+size-2;z+=tileStep){
        for(let x=this.originX+3;x<this.originX+size-2;x+=tileStep){
          const panel=panelIndex++;
          const missing=rng.next()<.018;
          if(missing){
            const cavity=box(g,new THREE.BoxGeometry(tileSize*.96,.045,tileSize*.96),lib.officeCeilingCavity,x,level.wallHeight-.16,z);
            cavity.userData.isLevel4MissingCeilingTile=true;
          }else{
            tileDummy.position.set(x,level.wallHeight+.035,z);tileDummy.updateMatrix();tileMatrices.push(tileDummy.matrix.clone());
          }
          if(panel%6===0&&!missing&&rng.next()<.68){
            tileDummy.position.set(x,level.wallHeight+.095,z);tileDummy.rotation.y=rng.next()<.5?0:Math.PI/2;tileDummy.updateMatrix();lightMatrices.push(tileDummy.matrix.clone());tileDummy.rotation.y=0;
          }
        }
      }
      const tileMesh=new THREE.InstancedMesh(tileGeometryUV(new THREE.BoxGeometry(tileSize,.055,tileSize),lib.officeCeilingTile),lib.officeCeilingTile,tileMatrices.length);
      tileMatrices.forEach((matrix,i)=>tileMesh.setMatrixAt(i,matrix));
      tileMesh.instanceMatrix.needsUpdate=true;tileMesh.userData.isLevel4CeilingPanels=true;g.add(tileMesh);
      if(lightMatrices.length){
        const litPanels=new THREE.InstancedMesh(new THREE.BoxGeometry(1.65,.035,.64),lib.officeCeilingLight,lightMatrices.length);
        lightMatrices.forEach((matrix,i)=>litPanels.setMatrixAt(i,matrix));
        litPanels.instanceMatrix.needsUpdate=true;litPanels.userData.light=true;litPanels.userData.baseEmissive=.72;litPanels.userData.isLevel4CeilingLights=true;
        this.fixtures.push(litPanels);
        g.add(litPanels);
        // A small number of local sources support the panel rows without
        // creating one PointLight for every ceiling tile.
        for(let row=0;row<12;row++)for(let col=0;col<12;col++){
          const x=this.originX+size*(.0416666667+col/12),z=this.originZ+size*(.0416666667+row/12);
          this.lightSources.push({position:new THREE.Vector3(x,level.wallHeight-.28,z),color:0xfff2df,baseIntensity:900,intensity:900,distance:30,cullRadius:32,decay:2,fixture:litPanels});
        }
      }

      const addDesk=(x,z,rotation=0,monitor=true)=>{
        const desk=new THREE.Group();desk.position.set(x,0,z);desk.rotation.y=rotation;
        box(desk,new THREE.BoxGeometry(1.7,.09,.78),lib.officeWood,0,.76,0);
        for(const dx of [-.72,.72])for(const dz of [-.29,.29])box(desk,new THREE.BoxGeometry(.065,.74,.065),lib.officeFileCabinet,dx,.37,dz);
        if(monitor){
          box(desk,new THREE.BoxGeometry(.58,.42,.055),lib.dark,0,1.04,-.23);
          box(desk,new THREE.BoxGeometry(.72,.055,.42),lib.officeFileCabinet,0,.82,-.23);
        }
        g.add(desk);
        this.collisionSegments.push({x1:x-.9,z1:z-.48,x2:x+.9,z2:z-.48},{x1:x+.9,z1:z-.48,x2:x+.9,z2:z+.48},{x1:x+.9,z1:z+.48,x2:x-.9,z2:z+.48},{x1:x-.9,z1:z+.48,x2:x-.9,z2:z-.48});
      };
      const addChair=(x,z)=>{
        const chair=new THREE.Group();chair.position.set(x,0,z);
        box(chair,new THREE.BoxGeometry(.54,.09,.54),lib.officeCubicle,0,.48,0);
        box(chair,new THREE.BoxGeometry(.54,.58,.08),lib.officeCubicle,0,.78,-.23);
        g.add(chair);
      };
      const addRoomTag=(type,x,z)=>{
        const marker=new THREE.Group();marker.position.set(x,0,z);
        marker.userData.isLevel4OfficeRoom=true;marker.userData.level4RoomType=type;
        g.add(marker);this.rooms.push({x:Math.floor((x-this.originX)/cell),z:Math.floor((z-this.originZ)/cell),w:2,h:2,type});
        return marker;
      };
      for(const room of roomSpecs){
        const x=this.originX+size*(room.x+room.w/2),z=this.originZ+size*(room.z+room.h/2);
        const marker=addRoomTag(room.type,x,z);
        if(room.type==="open-office"){
          addDesk(x-2,z,0,true);addChair(x-1.6,z+1.05);
          box(g,new THREE.BoxGeometry(.08,1.32,2.9),lib.officeCubicle,x+1.15,.66,z+.1);
        }else if(room.type==="workroom"){
          addDesk(x-.8,z+.2,0,true);addChair(x-.55,z+1.25);
          box(g,new THREE.BoxGeometry(.88,1.75,.56),lib.officeFileCabinet,x+2.1,.875,z-.8);
        }else if(room.type==="meeting-room"){
          box(g,new THREE.BoxGeometry(3.8,.12,1.45),lib.officeWood,x,.78,z);
          for(let i=0;i<4;i++){
            const side=i<2?-1:1,index=i%2;
            const chair=new THREE.Group();chair.position.set(x+side*2.35,0,z-.55+index*1.1);
            box(chair,new THREE.BoxGeometry(.54,.09,.54),lib.officeCubicle,0,.48,0);
            box(chair,new THREE.BoxGeometry(.54,.58,.08),lib.officeCubicle,0,.78,-.23);g.add(chair);
          }
        }else if(room.type==="break-room"){
          box(g,new THREE.BoxGeometry(2.0,.12,.72),lib.officeWood,x-1.4,.78,z-2.1);
          box(g,new THREE.BoxGeometry(.64,1.75,.58),lib.officePlastic,x+2.3,.875,z-.8);
          box(g,new THREE.BoxGeometry(.48,.32,.44),lib.water,x+2.3,1.92,z-.8);
          box(g,new THREE.BoxGeometry(.92,2.05,.72),lib.officeFileCabinet,x-3,.1+1.025,z+.25);
          box(g,new THREE.BoxGeometry(.62,.92,.035),lib.windowDark,x-3,1.12,z-.13);
        }else if(room.type==="copy-room"){
          box(g,new THREE.BoxGeometry(1.12,.94,.9),lib.officePlastic,x,.61,z);
          box(g,new THREE.BoxGeometry(1.18,.12,.94),lib.officeFileCabinet,x,1.15,z);
          box(g,new THREE.BoxGeometry(.3,.07,.2),lib.dark,x,1.25,z);
          box(g,new THREE.BoxGeometry(.78,1.65,.52),lib.officeFileCabinet,x+2.2,.825,z+1.15);
        }else if(room.type==="records-room"){
          for(const dx of [-1.25,1.0]){
            box(g,new THREE.BoxGeometry(.9,1.8,.52),lib.officeFileCabinet,x+dx,.9,z);
            for(const y of [.48,1.0,1.52])box(g,new THREE.BoxGeometry(.72,.025,.04),lib.officeBlind,x+dx,y,z-.28);
          }
        }else if(room.type==="cubicle-room"){
          for(const dx of [-1.4,1.0])box(g,new THREE.BoxGeometry(.08,1.38,3.2),lib.officeCubicle,x+dx,.69,z);
          box(g,new THREE.BoxGeometry(3.1,1.38,.08),lib.officeCubicle,x,.69,z+1.5);
          addDesk(x-.2,z-.8,0,true);addChair(x-.1,z+.25);
        }
        marker.userData.roomFurnished=!["empty-office","open-office"].includes(room.type);
      }

      // Small signs, worn carpet marks, and stray paperwork keep the rooms quiet rather than cluttered.
      for(let i=0;i<4;i++){
        const x=this.originX+size*(.18+(i%2)*.57),z=this.originZ+size*(.22+Math.floor(i/2)*.55);
        const mark=new THREE.Mesh(new THREE.CircleGeometry(.55+rng.next()*.35,18),lib.officeCarpetWear);
        mark.rotation.x=-Math.PI/2;mark.position.set(x,.008,z);mark.userData.isLevel4CarpetWear=true;g.add(mark);
      }
      for(let i=0;i<3;i++){
        const paper=new THREE.Mesh(new THREE.PlaneGeometry(.42,.3),lib.officePaper);
        paper.rotation.x=-Math.PI/2;paper.rotateZ(rng.next()*Math.PI*2);
        paper.position.set(this.originX+size*(.18+rng.next()*.64),.014,this.originZ+size*(.18+rng.next()*.64));
        paper.userData.isLevel4Paper=true;g.add(paper);
      }
      for(let i=0;i<3;i++){
        const x=this.originX+size*(.17+i*.31),z=this.originZ+size*(.29+(i%2)*.38);
        const sign=box(g,new THREE.BoxGeometry(.42,.2,.035),lib.officeBlind,x,2.72,z);
        sign.userData.level4OfficeSign=true;
      }
    }else if(level.id==="5"){
      const rng=new RNG(this.seedKey()^0x5a11);
      // 1930s hotel: more tables, lamps, lobby chairs, and side cabinets.
      for(let i=0;i<3+rng.int(0,2);i++){
        const x=this.originX+cell*(1.2+rng.next()*(cells-2.4)),z=this.originZ+cell*(1.2+rng.next()*(cells-2.4));
        const table=new THREE.Group();table.position.set(x,0,z);
        box(table,new THREE.BoxGeometry(2.2,.14,.82),lib.officeWood,0,.82,0);
        for(const sx of [-.9,.9])for(const sz of [-.27,.27])box(table,new THREE.BoxGeometry(.09,.8,.09),lib.officeWood,sx,.4,sz);
        box(table,new THREE.BoxGeometry(.34,.44,.34),lib.trim,.62,1.1,0);
        const lamp=box(table,new THREE.CylinderGeometry(.11,.16,.34,10),lib.orangeLight,.62,1.48,0);
        lamp.userData.light=true;
        g.add(table);
      }
      for(let i=0;i<4;i++){
        const x=this.originX+cell*(1.3+rng.next()*(cells-2.6)),z=this.originZ+cell*(1.3+rng.next()*(cells-2.6));
        const chair=new THREE.Group();chair.position.set(x,0,z);chair.rotation.y=rng.next()*Math.PI*2;
        box(chair,new THREE.BoxGeometry(.62,.1,.62),lib.officeWood,0,.52,0);
        box(chair,new THREE.BoxGeometry(.62,.7,.1),lib.officeWood,0,.9,-.26);
        for(const [cx,cz] of [[-.22,-.22],[.22,-.22],[-.22,.22],[.22,.22]])box(chair,new THREE.BoxGeometry(.07,.5,.07),lib.officeWood,cx,.25,cz);
        g.add(chair);
      }
      for(let i=0;i<2;i++){
        const x=this.originX+cell*(1.4+rng.next()*(cells-2.8)),z=this.originZ+cell*(1.4+rng.next()*(cells-2.8));
        const cab=new THREE.Group();cab.position.set(x,0,z);
        box(cab,new THREE.BoxGeometry(1.1,1.8,.5),lib.officeWood,0,.9,0);
        box(cab,new THREE.BoxGeometry(.08,.08,.12),lib.handle,.55,1.1,-.02);
        g.add(cab);
      }
      // The Main Hall is the most furnished area: mahogany sofas, framed
      // portraits and brass room plaques contrast with the otherwise empty rooms.
      for(let i=0;i<3;i++){
        const x=this.originX+size*(.2+i*.3),z=this.originZ+size*.22,sofa=new THREE.Group();
        sofa.position.set(x,0,z);
        box(sofa,new THREE.BoxGeometry(2.35,.48,.82),lib.mahogany,0,.48,0);
        box(sofa,new THREE.BoxGeometry(2.35,.62,.22),lib.officeWood,0,.92,-.31);
        for(const sx of [-.98,.98])box(sofa,new THREE.BoxGeometry(.28,.72,.82),lib.mahogany,sx,.72,0);
        g.add(sofa);
        const picture=new THREE.Group();picture.position.set(x,2.35,z-1.2);
        box(picture,new THREE.BoxGeometry(.92,.72,.08),lib.hotelGold,0,0,0);
        box(picture,new THREE.BoxGeometry(.76,.56,.035),lib.mahogany,0,0,.055);g.add(picture);
      }
      for(let i=0;i<4;i++){
        const x=this.originX+size*(.12+i*.22),z=this.originZ+size*.42,plaque=new THREE.Group();
        plaque.position.set(x,2.0,z);box(plaque,new THREE.BoxGeometry(.48,.22,.045),lib.hotelGold,0,0,0);
        box(plaque,new THREE.BoxGeometry(.31,.035,.055),lib.mahogany,0,0,.03);g.add(plaque);
      }
      // Rare antique cage elevator landmark.
      if(cycleHash(this.seedKey(),this.cx,this.cz+0x51)<.34){
        const ex=this.originX+size*.82,ez=this.originZ+size*.28,elevator=new THREE.Group();elevator.position.set(ex,0,ez);
        for(const x of [-1.05,1.05])for(const z of [-1.05,1.05]){
          const post=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,3.6,8),lib.hotelGold);post.position.set(x,1.8,z);elevator.add(post);
        }
        for(const y of [.35,1.2,2.05,2.9])for(const x of [-1,0,1])box(elevator,new THREE.BoxGeometry(.045,.045,2.05),lib.hotelGold,x,y,0);
        box(elevator,new THREE.BoxGeometry(1.9,.12,1.9),lib.mahogany,0,.12,0);g.add(elevator);
      }
      const ballroom=this.rooms.find(room=>room.type==="beverly");
      const chandelier=new THREE.Group();
      chandelier.position.set(ballroom?this.originX+(ballroom.x+ballroom.w/2)*cell:this.originX+size/2,level.wallHeight-.48,ballroom?this.originZ+(ballroom.z+ballroom.h/2)*cell:this.originZ+size/2);
      const ring=new THREE.Mesh(new THREE.TorusGeometry(1.0,.055,8,28),lib.handle);ring.rotation.x=Math.PI/2;chandelier.add(ring);
      for(let i=0;i<6;i++){
        const a=i/6*Math.PI*2;
        const bulb=new THREE.Mesh(new THREE.SphereGeometry(.12,8,6),lib.light);bulb.position.set(Math.cos(a),-.2,Math.sin(a));chandelier.add(bulb);
      }
      g.add(chandelier);
      this.lightSources.push({position:chandelier.position.clone(),color:0xffd6a0,baseIntensity:24,intensity:24,distance:14,decay:2});
      if(ballroom){
        const table=new THREE.Mesh(tileGeometryUV(new THREE.CylinderGeometry(1.35,1.25,.24,24),lib.officeWood),lib.officeWood);table.position.set(chandelier.position.x,.92,chandelier.position.z);g.add(table);
        for(let i=0;i<4;i++){
          const a=i/4*Math.PI*2,x=chandelier.position.x+Math.cos(a)*2.05,z=chandelier.position.z+Math.sin(a)*2.05;
          const chair=new THREE.Group();chair.position.set(x,0,z);
          box(chair,new THREE.BoxGeometry(.72,.12,.72),lib.officeWood,0,.62,0);
          box(chair,new THREE.BoxGeometry(.72,.82,.12),lib.officeWood,0,1.05,-.31);
          g.add(chair);
        }
        for(let i=0;i<12;i++)box(g,new THREE.BoxGeometry(.12,.035,.12),lib.trim,chandelier.position.x- .8+(i%4)*.52,1.07,chandelier.position.z-.28+Math.floor(i/4)*.28);
      }
      if(cycleHash(this.seedKey(),this.cx*7+this.cz*3,0xB01)<.18){
        const boiler=new THREE.Group();boiler.position.set(this.originX+size*.72,0,this.originZ+size*.72);
        const tank=new THREE.Mesh(tileGeometryUV(new THREE.CylinderGeometry(1.0,1.0,3.1,16),lib.rustMetal),lib.rustMetal);tank.position.y=1.58;boiler.add(tank);
        const cap=new THREE.Mesh(tileGeometryUV(new THREE.SphereGeometry(1.0,12,8,0,Math.PI*2,0,Math.PI/2),lib.metal),lib.metal);cap.position.y=3.13;boiler.add(cap);
        for(let pipe=0;pipe<3;pipe++){
          const tube=new THREE.Mesh(tileGeometryUV(new THREE.CylinderGeometry(.11,.11,3.8,10),lib.metal),lib.metal);tube.rotation.z=Math.PI/2;tube.position.set(0,2.6,-1.15+pipe*.48);boiler.add(tube);
        }
        g.add(boiler);this.lightSources.push({position:new THREE.Vector3(boiler.position.x,2.2,boiler.position.z),color:0xff9a55,baseIntensity:5,intensity:5,distance:9,decay:2});
      }
    }else if(level.id==="6"){
      // Lights Out: outdoor barren mountain / tundra under perpetual night.
      // No indoor walls — ridgelines, rock outcrops, sparse dead scrub, moon-only light.
      const rng=new RNG(this.seedKey()^0x6b19);
      const rockGeom=tileGeometryUV(new THREE.IcosahedronGeometry(1,1),lib.concrete);
      const rocks=new THREE.InstancedMesh(rockGeom,lib.concrete,36),rockDummy=new THREE.Object3D();
      for(let i=0;i<36;i++){
        const x=this.originX+1.2+rng.next()*(size-2.4),z=this.originZ+1.2+rng.next()*(size-2.4);
        const radius=.55+rng.next()*1.8;
        rockDummy.position.set(x,radius*.42,z);
        rockDummy.scale.set(radius*1.35,radius*.55+rng.next()*.4,radius*1.05);
        rockDummy.rotation.set(rng.next()*.5,rng.next()*Math.PI*2,rng.next()*.4);
        rockDummy.updateMatrix();rocks.setMatrixAt(i,rockDummy.matrix);
        if(radius>1.15){
          const hx=radius*1.1,hz=radius*.85;
          this.collisionSegments.push(
            {x1:x-hx,z1:z-hz,x2:x+hx,z2:z-hz},{x1:x+hx,z1:z-hz,x2:x+hx,z2:z+hz},
            {x1:x+hx,z1:z+hz,x2:x-hx,z2:z+hz},{x1:x-hx,z1:z+hz,x2:x-hx,z2:z-hz}
          );
        }
      }
      rocks.instanceMatrix.needsUpdate=true;g.add(rocks);
      // Sparse dead scrub / brush that catches the flashlight beam.
      const scrubGeom=new THREE.ConeGeometry(.18,.55,5);
      const scrub=new THREE.InstancedMesh(scrubGeom,lib.dark,48),scrubDummy=new THREE.Object3D();
      for(let i=0;i<48;i++){
        const x=this.originX+1+rng.next()*(size-2),z=this.originZ+1+rng.next()*(size-2);
        scrubDummy.position.set(x,.22,z);
        scrubDummy.scale.set(.6+rng.next()*1.4,.5+rng.next()*1.2,.6+rng.next()*1.4);
        scrubDummy.rotation.y=rng.next()*Math.PI*2;
        scrubDummy.updateMatrix();scrub.setMatrixAt(i,scrubDummy.matrix);
      }
      scrub.instanceMatrix.needsUpdate=true;g.add(scrub);
      // Low ridgeline banks along two edges so the horizon is not a flat void.
      for(let i=0;i<8;i++){
        const t=i/7,x=this.originX+size*t,z=this.originZ+.8+rng.next()*1.4;
        box(g,new THREE.BoxGeometry(2.2+rng.next()*2.5,1.2+rng.next()*2.4,1.8+rng.next()*1.6),lib.concrete,x,.6+rng.next()*.4,z);
      }
      for(let i=0;i<8;i++){
        const t=i/7,x=this.originX+.8+rng.next()*1.4,z=this.originZ+size*t;
        box(g,new THREE.BoxGeometry(1.6+rng.next()*1.8,1.0+rng.next()*2.2,2.4+rng.next()*2.2),lib.concrete,x,.55+rng.next()*.35,z);
      }
      // Cold moon wash — single soft blue key so the space stays almost pitch dark.
      this.lightSources.push({
        position:new THREE.Vector3(this.originX+size*.55,level.wallHeight+6.5,this.originZ+size*.4),
        color:0x9eb0c8,baseIntensity:2.4,intensity:2.4,distance:size*1.6,decay:1.6
      });
      // Exit cairn / trail marker when this chunk owns the blue exit.
      if(this.exit){
        const ex=this.originX+(this.exit.x+.5)*cell,ez=this.originZ+(this.exit.z+.5)*cell;
        box(g,new THREE.BoxGeometry(1.1,.9,1.1),lib.concrete,ex,.45,ez);
        box(g,new THREE.BoxGeometry(.55,.7,.55),lib.concrete,ex,1.05,ez);
        box(g,new THREE.BoxGeometry(.22,.55,.22),lib.metal,ex,1.55,ez);
        this.lightSources.push({position:new THREE.Vector3(ex,1.9,ez),color:0x6a8ab0,baseIntensity:3.5,intensity:3.5,distance:8,decay:2});
      }
    }else if(level.id==="7"){
      const water=lib.water.clone();
      water.color.setHex(0x3a9aaa);water.opacity=.82;water.roughness=.08;water.metalness=0;water.emissive.setHex(0x1a5060);water.emissiveIntensity=.28;
      water.side=THREE.DoubleSide;water.depthWrite=false;
      const waterUniforms={time:{value:0},offset:{value:new THREE.Vector2(this.originX+size/2,this.originZ+size/2)}};
      water.onBeforeCompile=shader=>{
        shader.uniforms.uBackroomsTime=waterUniforms.time;
        shader.uniforms.uBackroomsWaterOffset=waterUniforms.offset;
        shader.vertexShader=shader.vertexShader.replace("#include <common>","#include <common>\nuniform float uBackroomsTime;\nuniform vec2 uBackroomsWaterOffset;\nvarying vec2 vBackroomsWaterWorld;");
        shader.vertexShader=shader.vertexShader.replace("#include <beginnormal_vertex>","#include <beginnormal_vertex>\nvec2 waterP=vec2(position.x+uBackroomsWaterOffset.x,-position.y+uBackroomsWaterOffset.y);\nfloat waterDx=.029*cos(waterP.x*.19+uBackroomsTime*.72)+.005*cos((waterP.x+waterP.y)*.09+uBackroomsTime*.43);\nfloat waterDz=.014*cos(waterP.y*.15-uBackroomsTime*.61)+.005*cos((waterP.x+waterP.y)*.09+uBackroomsTime*.43);\nobjectNormal=normalize(vec3(-waterDx,waterDz,1.0));");
        shader.vertexShader=shader.vertexShader.replace("#include <begin_vertex>","#include <begin_vertex>\nvec2 waterWorld=vec2(position.x+uBackroomsWaterOffset.x,-position.y+uBackroomsWaterOffset.y);\nvBackroomsWaterWorld=waterWorld;\ntransformed.z+=sin(waterWorld.x*.19+uBackroomsTime*.72)*.13+sin(waterWorld.y*.15-uBackroomsTime*.61)*.08+sin((waterWorld.x+waterWorld.y)*.09+uBackroomsTime*.43)*.05;");
        shader.fragmentShader=shader.fragmentShader.replace("#include <common>","#include <common>\nuniform float uBackroomsTime;\nvarying vec2 vBackroomsWaterWorld;");
        shader.fragmentShader=shader.fragmentShader.replace("#include <color_fragment>","#include <color_fragment>\nfloat crestA=pow(max(0.0,sin(vBackroomsWaterWorld.x*.19+vBackroomsWaterWorld.y*.09+uBackroomsTime*1.15)),16.0);\nfloat crestB=pow(max(0.0,sin(vBackroomsWaterWorld.y*.16-vBackroomsWaterWorld.x*.055-uBackroomsTime*.82)),19.0);\nfloat surfaceGlint=crestA*.38+crestB*.25;\ndiffuseColor.rgb*=.82+surfaceGlint;\ndiffuseColor.rgb+=vec3(.055,.15,.18)*(crestA+crestB)*.55;");
        water.userData.timeUniform=shader.uniforms.uBackroomsTime;
      };
      water.customProgramCacheKey=()=>"backrooms-level7-world-waves-v4";water.needsUpdate=true;
      const surface=new THREE.Mesh(new THREE.PlaneGeometry(size,size,128,128),water);
      surface.rotation.x=-Math.PI/2;surface.position.set(this.originX+size/2,.045,this.originZ+size/2);surface.renderOrder=1;g.add(surface);
      water.userData.timeUniform=waterUniforms.time;
      g.userData.animatedWaterMaterials=[water];
      const rng=new RNG(this.seedKey()^0x7a77),rockGeometry=new THREE.IcosahedronGeometry(1,1);
      const rocks=new THREE.InstancedMesh(tileGeometryUV(rockGeometry,lib.concrete),lib.concrete,24),rockDummy=new THREE.Object3D();
      for(let i=0;i<24;i++){
        const x=this.originX+2+rng.next()*(size-4),z=this.originZ+2+rng.next()*(size-4),scale=.8+rng.next()*2.1;
        rockDummy.position.set(x,-.65-rng.next()*2.8,z);rockDummy.scale.set(scale*1.45,scale*.62,scale*1.2);rockDummy.rotation.y=rng.next()*Math.PI*2;rockDummy.updateMatrix();rocks.setMatrixAt(i,rockDummy.matrix);
      }
      rocks.instanceMatrix.needsUpdate=true;g.add(rocks);
      // Furnished flooded entrance room built sideways into the ocean ceiling.
      if(this.cx===0&&this.cz===0){
        const room=new THREE.Group();
        box(room,new THREE.BoxGeometry(8.6,.16,8.6),lib.concrete,0,.10,0);
        box(room,new THREE.BoxGeometry(8.6,3.1,.18),lib.concrete,0,1.65,-4.25);
        box(room,new THREE.BoxGeometry(.18,3.1,8.6),lib.concrete,-4.25,1.65,0);
        box(room,new THREE.BoxGeometry(.18,3.1,8.6),lib.concrete,4.25,1.65,0);
        box(room,new THREE.BoxGeometry(2.8,3.1,.18),lib.concrete,-2.85,1.65,4.25);
        box(room,new THREE.BoxGeometry(2.8,3.1,.18),lib.concrete,2.85,1.65,4.25);
        box(room,new THREE.BoxGeometry(2.9,.22,.2),lib.concrete,0,3.1,4.25);
        const roomWater=water.clone();
        roomWater.opacity=.46;
        roomWater.onBeforeCompile=water.onBeforeCompile;
        roomWater.customProgramCacheKey=water.customProgramCacheKey;
        roomWater.userData.timeUniform=waterUniforms.time;
        const puddle=new THREE.Mesh(new THREE.PlaneGeometry(7.7,7.7,24,24),roomWater);
        puddle.rotation.x=-Math.PI/2;puddle.position.set(0,.19,0);room.add(puddle);
        box(room,new THREE.BoxGeometry(1.5,2.25,.38),lib.officeWood,-3.15,1.28,-.35);
        for(let shelf=0;shelf<4;shelf++)box(room,new THREE.BoxGeometry(1.38,.055,.34),lib.trim,-3.15,.48+shelf*.48,-.12);
        const chair=new THREE.Group();chair.position.set(2.25,0,-1.1);
        box(chair,new THREE.BoxGeometry(.78,.18,.78),lib.officeWood,0,.48,0);
        box(chair,new THREE.BoxGeometry(.78,1.0,.16),lib.officeWood,0,1.02,-.32);room.add(chair);
        box(room,new THREE.BoxGeometry(1.0,.12,.62),lib.officeWood,.55,.52,.75);
        for(const x of [-.35,1.45])for(const z of [.5,1.0])box(room,new THREE.BoxGeometry(.07,.48,.07),lib.officeWood,x,.24,z);
        g.add(room);
        // Daytime fill for the open-top entrance room — without these the start is pitch black.
        this.lightSources.push({position:new THREE.Vector3(0,4.2,0),color:0xd8eef8,baseIntensity:28,intensity:28,distance:16,decay:1.6});
        this.lightSources.push({position:new THREE.Vector3(0,2.4,2.2),color:0xc0dce8,baseIntensity:12,intensity:12,distance:10,decay:1.8});
        this.collisionSegments.push(
          {x1:-4.3,z1:-4.3,x2:4.3,z2:-4.3},{x1:-4.3,z1:-4.3,x2:-4.3,z2:4.3},
          {x1:4.3,z1:-4.3,x2:4.3,z2:4.3},
          {x1:-4.3,z1:4.3,x2:-1.45,z2:4.3},{x1:1.45,z1:4.3,x2:4.3,z2:4.3}
        );
      }
      // Partially submerged house shells: water only enters through the front door.
      if(Math.hypot(this.cx,this.cz)>0.5&&rng.next()<.42){
        const hx=this.originX+size*(.2+rng.next()*.6),hz=this.originZ+size*(.2+rng.next()*.6);
        const house=new THREE.Group();house.position.set(hx,-.35,hz);
        house.rotation.y=rng.next()*Math.PI*2;
        const wallMat=lib.concrete;
        const halfX=3.2,halfZ=2.6,doorHalf=.85,wallH=2.6;
        box(house,new THREE.BoxGeometry(halfX*2,.12,halfZ*2),wallMat,0,.06,0);
        box(house,new THREE.BoxGeometry(halfX*2,wallH,.16),wallMat,0,wallH*.5,-halfZ);
        box(house,new THREE.BoxGeometry(.16,wallH,halfZ*2),wallMat,-halfX,wallH*.5,0);
        box(house,new THREE.BoxGeometry(.16,wallH,halfZ*2),wallMat,halfX,wallH*.5,0);
        box(house,new THREE.BoxGeometry(halfX-doorHalf,wallH,.16),wallMat,-(halfX+doorHalf)*.5,wallH*.5,halfZ);
        box(house,new THREE.BoxGeometry(halfX-doorHalf,wallH,.16),wallMat,(halfX+doorHalf)*.5,wallH*.5,halfZ);
        box(house,new THREE.BoxGeometry(doorHalf*2,.35,.16),wallMat,0,wallH-.18,halfZ);
        const roof=new THREE.Mesh(tileGeometryUV(new THREE.BoxGeometry(halfX*2+.4,.12,halfZ*2+.4),lib.officeWood),lib.officeWood);
        roof.position.set(0,wallH+.12,0);roof.rotation.z=(rng.next()-.5)*.16;roof.rotation.x=(rng.next()-.5)*.08;house.add(roof);
        const table=new THREE.Group();table.position.set(-1.15,0,-.35);
        box(table,new THREE.BoxGeometry(1.35,.08,.78),lib.officeWood,0,.78,0);
        for(const [lx,lz] of [[-.58,-.3],[.58,-.3],[-.58,.3],[.58,.3]])box(table,new THREE.BoxGeometry(.08,.78,.08),lib.officeWood,lx,.39,lz);
        house.add(table);
        const chair=new THREE.Group();chair.position.set(1.35,0,-.2);chair.rotation.y=rng.next()*.4;
        box(chair,new THREE.BoxGeometry(.58,.07,.58),lib.officeWood,0,.48,0);
        box(chair,new THREE.BoxGeometry(.58,.72,.08),lib.officeWood,0,.88,-.25);
        for(const [lx,lz] of [[-.22,-.22],[.22,-.22],[-.22,.22],[.22,.22]])box(chair,new THREE.BoxGeometry(.07,.48,.07),lib.officeWood,lx,.24,lz);
        house.add(chair);
        const flood=water.clone();
        flood.opacity=.52;flood.depthWrite=false;
        flood.polygonOffset=true;flood.polygonOffsetFactor=-1;flood.polygonOffsetUnits=-2;
        const floodMesh=new THREE.Mesh(new THREE.PlaneGeometry(halfX*2-.45,halfZ*2-.45,10,10),flood);
        floodMesh.rotation.x=-Math.PI/2;floodMesh.position.set(0,.28,0);floodMesh.renderOrder=2;house.add(floodMesh);
        const inflow=new THREE.Mesh(new THREE.PlaneGeometry(doorHalf*1.7,1.1,6,4),flood);
        inflow.rotation.x=-Math.PI/2;inflow.position.set(0,.22,halfZ-.35);inflow.renderOrder=2;house.add(inflow);
        g.add(house);
        this.collisionSegments.push(
          {x1:hx-halfX,z1:hz-halfZ,x2:hx+halfX,z2:hz-halfZ},
          {x1:hx+halfX,z1:hz-halfZ,x2:hx+halfX,z2:hz+halfZ},
          {x1:hx+halfX,z1:hz+halfZ,x2:hx+doorHalf,z2:hz+halfZ},
          {x1:hx-doorHalf,z1:hz+halfZ,x2:hx-halfX,z2:hz+halfZ},
          {x1:hx-halfX,z1:hz+halfZ,x2:hx-halfX,z2:hz-halfZ}
        );
      }
    }else if(level.id==="8"){
      // Cave systems: denser floor rock + ceiling spikes + ground stalagmites
      const rng=new RNG(this.seedKey()^0x8ca7e);
      const boulders=new THREE.InstancedMesh(tileGeometryUV(new THREE.BoxGeometry(1,1,1),lib.concrete),lib.concrete,28),rockDummy=new THREE.Object3D();
      for(let i=0;i<28;i++){
        const x=this.originX+1+rng.next()*(size-2),z=this.originZ+1+rng.next()*(size-2),radius=.4+rng.next()*1.25;
        rockDummy.position.set(x,radius*.48,z);rockDummy.scale.set(radius*1.25,radius*.7,radius*.95);rockDummy.rotation.set(rng.next()*.4,rng.next()*Math.PI,rng.next()*.3);rockDummy.updateMatrix();boulders.setMatrixAt(i,rockDummy.matrix);
        if(radius>1.0){const hx=radius*1.05,hz=radius*.8;this.collisionSegments.push({x1:x-hx,z1:z-hz,x2:x+hx,z2:z-hz},{x1:x+hx,z1:z-hz,x2:x+hx,z2:z+hz},{x1:x+hx,z1:z+hz,x2:x-hx,z2:z+hz},{x1:x-hx,z1:z+hz,x2:x-hx,z2:z-hz})}
      }
      const spikes=new THREE.InstancedMesh(tileGeometryUV(new THREE.ConeGeometry(.4,1,7),lib.concrete),lib.concrete,14),spikeDummy=new THREE.Object3D();
      for(let i=0;i<14;i++){
        const x=this.originX+1.5+rng.next()*(size-3),z=this.originZ+1.5+rng.next()*(size-3),length=1+rng.next()*2.4;
        spikeDummy.position.set(x,level.wallHeight-length/2,z);spikeDummy.rotation.x=Math.PI;spikeDummy.scale.set(1,length,1);spikeDummy.updateMatrix();spikes.setMatrixAt(i,spikeDummy.matrix);
      }
      // Floor stalagmites
      const stags=new THREE.InstancedMesh(tileGeometryUV(new THREE.ConeGeometry(.28,1,6),lib.concrete),lib.concrete,12),stagDummy=new THREE.Object3D();
      for(let i=0;i<12;i++){
        const x=this.originX+2+rng.next()*(size-4),z=this.originZ+2+rng.next()*(size-4),h=.6+rng.next()*1.4;
        stagDummy.position.set(x,h/2,z);stagDummy.rotation.set(0,rng.next()*Math.PI,0);stagDummy.scale.set(.8+rng.next()*.5,h, .8+rng.next()*.5);stagDummy.updateMatrix();stags.setMatrixAt(i,stagDummy.matrix);
      }
      boulders.instanceMatrix.needsUpdate=true;spikes.instanceMatrix.needsUpdate=true;stags.instanceMatrix.needsUpdate=true;g.add(boulders,spikes,stags);
      // Cold pools and M.E.G. 9th Road markers give the karst network a
      // recognizable route through its natural chambers.
      for(let i=0;i<5;i++){
        const px=this.originX+size*(.15+rng.next()*.7),pz=this.originZ+size*(.15+rng.next()*.7);
        const waterMat=lib.water.clone();
        waterMat.color.setHex(0x1a3840);
        waterMat.opacity=.82;
        waterMat.roughness=.08;
        waterMat.emissive.setHex(0x0a1820);
        waterMat.emissiveIntensity=.08;
        const pool=new THREE.Mesh(new THREE.CircleGeometry(1.6+rng.next()*2.4,24),waterMat);
        pool.rotation.x=-Math.PI/2;pool.position.set(px,.022,pz);pool.renderOrder=1;g.add(pool);
        // Damp rock rim around the pool
        box(g,new THREE.BoxGeometry(3.2+rng.next()*1.5,.12,3.2+rng.next()*1.5),lib.concrete,px,.04,pz);
      }
      // Wet floor seepage patches along the 9th Road
      for(let i=0;i<8;i++){
        const px=this.originX+size*(.08+rng.next()*.84),pz=this.originZ+size*(.4+rng.next()*.2);
        const seep=new THREE.Mesh(new THREE.CircleGeometry(.4+rng.next()*.9,12),lib.wetAsphalt||lib.water.clone());
        seep.rotation.x=-Math.PI/2;seep.position.set(px,.016,pz);seep.material.opacity=.5;g.add(seep);
      }
      // A sinuous 9th Road passes through broad chambers linked by natural
      // constrictions. Instanced rock banks keep the cave organic and cheap.
      const road=[
        [this.originX+size*.04,this.originZ+size*.5],
        [this.originX+size*.2,this.originZ+size*.5],
        [this.originX+size*.34,this.originZ+size*.36],
        [this.originX+size*.5,this.originZ+size*.5],
        [this.originX+size*.68,this.originZ+size*.5],
        [this.originX+size*.82,this.originZ+size*.34],
        [this.originX+size*.97,this.originZ+size*.34]
      ];
      const wallGeometry=tileGeometryUV(new THREE.BoxGeometry(1,1,1),lib.concrete),wallInstances=new THREE.InstancedMesh(wallGeometry,lib.concrete,120);
      const wallDummy=new THREE.Object3D();let wallIndex=0;
      for(let segment=0;segment<road.length-1;segment++){
        const [ax,az]=road[segment],[bx,bz]=road[segment+1],dx=bx-ax,dz=bz-az,length=Math.hypot(dx,dz);
        const nx=-dz/length,nz=dx/length;
        for(const side of [-1,1]){
          this.collisionSegments.push({x1:ax+nx*4.4*side,z1:az+nz*4.4*side,x2:bx+nx*4.4*side,z2:bz+nz*4.4*side});
          for(let distance=3.5;distance<length-2;distance+=4.2){
            const t=distance/length,x=ax+dx*t+nx*(4.8+rng.next()*1.1)*side,z=az+dz*t+nz*(4.8+rng.next()*1.1)*side;
            const scale=1.65+rng.next()*1.1;
            wallDummy.position.set(x,1.05+rng.next()*.55,z);
            wallDummy.scale.set(scale*1.85+rng.next()*.6,1.15+rng.next()*1.65,scale*.55+rng.next()*.35);
            wallDummy.rotation.set(rng.next()*.18,rng.next()*Math.PI*2,rng.next()*.12);
            wallDummy.updateMatrix();wallInstances.setMatrixAt(wallIndex++,wallDummy.matrix);
          }
        }
      }
      wallInstances.count=wallIndex;wallInstances.instanceMatrix.needsUpdate=true;g.add(wallInstances);
      for(let i=0;i<3;i++){
        const [x,z]=road[1+i*2],sign=new THREE.Group();sign.position.set(x,0,z);
        const post=new THREE.Mesh(tileGeometryUV(new THREE.CylinderGeometry(.055,.075,2.1,8),lib.rustMetal),lib.rustMetal);post.position.y=1.05;sign.add(post);
        box(sign,new THREE.BoxGeometry(.9,.42,.08),lib.hotelGold,0,2.05,0);
        box(sign,new THREE.BoxGeometry(.72,.26,.035),lib.dark,0,2.05,.055);
        box(sign,new THREE.BoxGeometry(.42,.035,.04),lib.indicator,0,2.05,.08);g.add(sign);
      }
    }else if(level.id==="9"){
      const rng=new RNG(this.seedKey()^0x9b42);
      // Unpainted wet asphalt streets, stone sidewalks and grassy front lots.
      box(g,new THREE.BoxGeometry(size,.04,8.8),lib.asphalt,this.originX+size/2,.012,this.originZ+size/2);
      box(g,new THREE.BoxGeometry(8.8,.04,size),lib.asphalt,this.originX+size/2,.014,this.originZ+size/2);
      for(const side of [-1,1]){
        box(g,new THREE.BoxGeometry(size,.08,1.8),lib.sidewalk,this.originX+size/2,.045,this.originZ+size/2+side*5.25);
        box(g,new THREE.BoxGeometry(1.8,.08,size),lib.sidewalk,this.originX+size/2+side*5.25,.045,this.originZ+size/2);
        box(g,new THREE.BoxGeometry(size,.035,8),lib.lawn,this.originX+size/2,.012,this.originZ+size/2+side*18);
        box(g,new THREE.BoxGeometry(8,.035,size),lib.lawn,this.originX+size/2+side*18,.012,this.originZ+size/2);
      }
      // Rainwater gathers in shallow, irregular patches on the unmarked road.
      for(let i=0;i<5;i++){
        const px=this.originX+size*(.12+rng.next()*.76),pz=this.originZ+size*(.5+(rng.next()-.5)*.12);
        const puddle=new THREE.Mesh(tileGeometryUV(new THREE.CircleGeometry(.8+rng.next()*1.5,18),lib.wetAsphalt),lib.wetAsphalt);
        puddle.rotation.x=-Math.PI/2;puddle.scale.set(1.8,.65,1);puddle.position.set(px,.038,pz);g.add(puddle);
      }
      const leafGeometry=new THREE.PlaneGeometry(.18,.1),leaves=new THREE.InstancedMesh(leafGeometry,lib.leaf,90),leafDummy=new THREE.Object3D();
      for(let i=0;i<90;i++){
        const x=this.originX+rng.next()*size,z=this.originZ+rng.next()*size;
        leafDummy.position.set(x,.045,z);leafDummy.rotation.x=-Math.PI/2;leafDummy.rotation.z=rng.next()*Math.PI*2;
        leafDummy.scale.set(.55+rng.next(),.55+rng.next(),1);leafDummy.updateMatrix();leaves.setMatrixAt(i,leafDummy.matrix);
      }
      leaves.instanceMatrix.needsUpdate=true;g.add(leaves);
      for(let roomIndex=0;roomIndex<this.rooms.length;roomIndex++){
        const room=this.rooms[roomIndex];
        const x=this.originX+(room.x+room.w/2)*cell,z=this.originZ+(room.z+room.h/2)*cell;
        const house=new THREE.Group();house.position.set(x,0,z);
        const front=-4.0,halfX=4.35,halfZ=3.85,doorHalf=.68;
        const wallMat=roomIndex%2?lib.officePlastic:lib.maintenanceWall;
        const roofMat=roomIndex%2?lib.mahogany:lib.officeWood;
        // Build a hollow house shell with a real front-door opening, not a solid box.
        box(house,new THREE.BoxGeometry(halfX-doorHalf,3,.14),wallMat,-(halfX+doorHalf)/2,1.5,front);
        box(house,new THREE.BoxGeometry(halfX-doorHalf,3,.14),wallMat,(halfX+doorHalf)/2,1.5,front);
        box(house,new THREE.BoxGeometry(doorHalf*2,.8,.14),wallMat,0,2.6,front);
        box(house,new THREE.BoxGeometry(halfX*2,3,.14),wallMat,0,1.5,halfZ);
        box(house,new THREE.BoxGeometry(.14,3,halfZ*2),wallMat,-halfX,1.5,0);
        box(house,new THREE.BoxGeometry(.14,3,halfZ*2),wallMat,halfX,1.5,0);
        const roof=box(house,new THREE.BoxGeometry(halfX*2+.5,.3,halfZ*2+.5),roofMat,0,3.08,0);roof.rotation.z=.035;
        // Front porch, steps and a garage bay make the lots read as homes.
        box(house,new THREE.BoxGeometry(2.6,.16,1.2),lib.officeWood,0,.12,-5.0);
        box(house,new THREE.BoxGeometry(2.0,.12,.42),lib.officeWood,0,.06,-5.75);
        // Furnished but unpowered interior silhouettes.
        box(house,new THREE.BoxGeometry(1.6,.52,.72),lib.mahogany,-1.65,.55,1.1);
        box(house,new THREE.BoxGeometry(.8,1.7,.5),lib.officeWood,2.1,.85,1.3);
        for(const wx of [-2.7,2.7]){
          box(house,new THREE.BoxGeometry(1.2,1.0,.06),lib.dark,wx,1.95,front-.08);
          box(house,new THREE.BoxGeometry(1.32,.07,.08),lib.trim,wx,1.95,front-.12);
        }
        const isExitLot=this.exit?.kind==="suburb"&&this.exit.x===room.x&&this.exit.z===room.z;
        box(house,new THREE.BoxGeometry(1.12,2.2,.07),isExitLot?lib.exitDoor:lib.officeWood,0,1.1,front-.08);
        for(const wx of [-2.1,2.1]){
          box(house,new THREE.BoxGeometry(1.15,1.0,.07),lib.dark,wx,1.95,front-.08);
          box(house,new THREE.BoxGeometry(1.26,.06,.09),lib.trim,wx,1.95,front-.12);
        }
        g.add(house);
        this.collisionSegments.push(
          {x1:x-halfX,z1:z-halfZ,x2:x-doorHalf,z2:z-halfZ},
          {x1:x+doorHalf,z1:z-halfZ,x2:x+halfX,z2:z-halfZ},
          {x1:x+halfX,z1:z-halfZ,x2:x+halfX,z2:z+halfZ},
          {x1:x+halfX,z1:z+halfZ,x2:x-halfX,z2:z+halfZ},
          {x1:x-halfX,z1:z+halfZ,x2:x-halfX,z2:z-halfZ}
        );
      }
      for(let i=0;i<5;i++){
        const x=this.originX+size*(.12+i*.19),z=this.originZ+size*(i%2?.46:.54);
        const pole=new THREE.Mesh(tileGeometryUV(new THREE.CylinderGeometry(.055,.085,4.4,7),lib.metal),lib.metal);pole.position.set(x,2.2,z);g.add(pole);
        box(g,new THREE.BoxGeometry(1.0,.08,.08),lib.metal,x+.45,4.28,z);
        const bulb=box(g,new THREE.BoxGeometry(.28,.12,.2),lib.dark,x+.9,4.22,z);bulb.userData.light=false;
        if(rng.next()<.28)this.lightSources.push({position:new THREE.Vector3(x+.9,4.15,z),color:0xd8e0d9,baseIntensity:7,intensity:7,distance:9,decay:2});
      }
    }else if(level.id==="10"){
      const rng=new RNG(this.seedKey()^0x10c0);
      const stalkGeometry=new THREE.CylinderGeometry(.009,.025,1.45,5,3);
      const headGeometry=new THREE.CylinderGeometry(.018,.028,.34,6,2);
      const kernelGeometry=new THREE.SphereGeometry(.027,5,4);
      const awnGeometry=new THREE.CylinderGeometry(.0015,.005,.24,3);
      const cropCount=isTouchControlsDevice()?4200:11000;
      const stalks=new THREE.InstancedMesh(stalkGeometry,lib.wheat,cropCount);
      const heads=new THREE.InstancedMesh(headGeometry,lib.wheatHead,cropCount);
      const kernels=new THREE.InstancedMesh(kernelGeometry,lib.wheatHead,cropCount*8);
      const awns=new THREE.InstancedMesh(awnGeometry,lib.wheatHead,cropCount*6);
      const dummy=new THREE.Object3D(),up=new THREE.Vector3(0,1,0),awnDirection=new THREE.Vector3(),grainColor=new THREE.Color(),stalkColor=new THREE.Color();
      let count=0,kernelCount=0,awnCount=0;
      for(let i=0;i<cropCount;i++){
        const x=this.originX+.4+rng.next()*(size-.8),z=this.originZ+.4+rng.next()*(size-.8);
        // Keep only a narrow walking gap near chunk center, otherwise pack the field.
        if(Math.hypot(x-(this.originX+size/2),z-(this.originZ+size/2))<2.2)continue;
        const height=1.0+rng.next()*.58,lean=(rng.next()-.5)*.22,heading=rng.next()*Math.PI*2;
        dummy.position.set(x,height*.5,z);dummy.rotation.set(Math.sin(heading)*lean,heading,Math.cos(heading)*lean);dummy.scale.set(.82+rng.next()*.3,height/1.45,.82+rng.next()*.3);dummy.updateMatrix();stalks.setMatrixAt(count,dummy.matrix);
        stalkColor.setHSL(.19+rng.next()*.025,.34,.28+rng.next()*.10);stalks.setColorAt(count,stalkColor);
        dummy.position.set(x,height+.12,z);dummy.scale.set(.9,.9,.9);dummy.updateMatrix();heads.setMatrixAt(count,dummy.matrix);
        grainColor.setHSL(.115+rng.next()*.025,.52,.40+rng.next()*.13);heads.setColorAt(count,grainColor);
        // Eight overlapping kernels form a plump, irregular grain head.
        for(let row=0;row<4;row++)for(let side=0;side<2;side++){
          const angle=heading+row*Math.PI*.72+side*Math.PI;
          const radius=.022+(row%2)*.006;
          dummy.position.set(x+Math.cos(angle)*radius,height+.015+row*.075,z+Math.sin(angle)*radius);
          dummy.rotation.set(0,angle,0);dummy.scale.set(.78,.95,.78);dummy.updateMatrix();kernels.setMatrixAt(kernelCount,dummy.matrix);
          grainColor.setHSL(.115+rng.next()*.025,.5,.39+rng.next()*.15);kernels.setColorAt(kernelCount,grainColor);kernelCount++;
        }
        // Fine bristles (awns) catch the overcast light and break up the toy-like silhouette.
        for(let bristle=0;bristle<6;bristle++){
          const angle=heading+bristle*Math.PI/3,tilt=.42+rng.next()*.22;
          awnDirection.set(Math.cos(angle)*tilt,1,Math.sin(angle)*tilt).normalize();
          dummy.position.set(x+Math.cos(angle)*.025,height+.16+(bristle%3)*.025,z+Math.sin(angle)*.025);
          dummy.quaternion.setFromUnitVectors(up,awnDirection);dummy.scale.set(1,.9+rng.next()*.35,1);dummy.updateMatrix();awns.setMatrixAt(awnCount,dummy.matrix);
          awns.setColorAt(awnCount,grainColor);awnCount++;
        }
        count++;
      }
      stalks.count=count;heads.count=count;kernels.count=kernelCount;awns.count=awnCount;
      for(const mesh of [stalks,heads,kernels,awns]){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere()}
      g.add(stalks,heads,kernels,awns);
      // Tree and shrub lines divide the cultivated plots, with shallow clean ponds between them.
      const treeCount=14;
      const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.12,.2,2.8,7),lib.treeBark,treeCount);
      const crowns=new THREE.InstancedMesh(new THREE.SphereGeometry(1.25,9,7),lib.treeLeaves,treeCount),treeDummy=new THREE.Object3D();let treeIndex=0;
      for(let row=0;row<2;row++)for(let i=0;i<7;i++){
        const x=this.originX+(row===0?size*.12:size*.88),z=this.originZ+size*(.08+i*.14);
        treeDummy.position.set(x,1.4,z);treeDummy.scale.set(1,1,1);treeDummy.updateMatrix();trunks.setMatrixAt(treeIndex,treeDummy.matrix);
        treeDummy.position.set(x,3.1,z);treeDummy.scale.set(1.1,1.2,1);treeDummy.updateMatrix();crowns.setMatrixAt(treeIndex,treeDummy.matrix);treeIndex++;
        const half=.22;this.collisionSegments.push({x1:x-half,z1:z-half,x2:x+half,z2:z-half},{x1:x+half,z1:z-half,x2:x+half,z2:z+half},{x1:x+half,z1:z+half,x2:x-half,z2:z+half},{x1:x-half,z1:z+half,x2:x-half,z2:z-half});
      }
      trunks.instanceMatrix.needsUpdate=true;crowns.instanceMatrix.needsUpdate=true;g.add(trunks,crowns);
      // Farm tracks and a pair of shallow, clear irrigation ponds.
      box(g,new THREE.BoxGeometry(size,.035,3.8),lib.farmDirt,this.originX+size/2,.012,this.originZ+size*.54);
      for(let i=0;i<2;i++){
        const pond=new THREE.Mesh(new THREE.CircleGeometry(2.2+rng.next()*2.2,24),lib.water.clone());
        pond.rotation.x=-Math.PI/2;
        pond.position.set(this.originX+size*(.22+rng.next()*.56),.022,this.originZ+size*(.22+rng.next()*.56));
        pond.material.color.setHex(0x526d70);pond.material.opacity=.86;g.add(pond);
      }
      // Small weathered sheds and tool stores punctuate the fields between barns.
      if(cycleHash(this.seedKey(),this.cx*23+this.cz*11,0x51)<.32){
        const sx=this.originX+size*(.2+rng.next()*.6),sz=this.originZ+size*(.2+rng.next()*.6),shed=new THREE.Group();
        shed.position.set(sx,0,sz);
        box(shed,new THREE.BoxGeometry(4.2,2.5,.12),lib.officeWood,0,1.25,-1.55);
        box(shed,new THREE.BoxGeometry(4.2,2.5,.12),lib.officeWood,0,1.25,1.55);
        box(shed,new THREE.BoxGeometry(.12,2.5,3.1),lib.officeWood,-2.1,1.25,0);
        box(shed,new THREE.BoxGeometry(.12,2.5,3.1),lib.officeWood,2.1,1.25,0);
        box(shed,new THREE.BoxGeometry(4.6,.22,3.5),lib.rustMetal,0,2.58,0);
        box(shed,new THREE.BoxGeometry(1.05,2.05,.08),lib.mahogany,0,1.02,-1.62);
        g.add(shed);
        this.collisionSegments.push(
          {x1:sx-2.1,z1:sz-1.55,x2:sx+2.1,z2:sz-1.55},
          {x1:sx+2.1,z1:sz-1.55,x2:sx+2.1,z2:sz+1.55},
          {x1:sx+2.1,z1:sz+1.55,x2:sx-2.1,z2:sz+1.55},
          {x1:sx-2.1,z1:sz+1.55,x2:sx-2.1,z2:sz-1.55}
        );
      }
      const exitBarn=this.exit?.kind==="field",randomBarn=cycleHash(this.seedKey(),this.cx*17+this.cz*7,10)<.2;
      if(exitBarn||randomBarn){
        const lotX=exitBarn?this.exit.x:Math.floor(cells*.68),lotZ=exitBarn?this.exit.z:Math.floor(cells*.64);
        const x=this.originX+(lotX+.5)*cell,z=this.originZ+(lotZ+.5)*cell,barn=new THREE.Group();barn.position.set(x,0,z);
        const halfX=4.25,halfZ=3.25,doorHalf=1.12,front=-3.25;
        box(barn,new THREE.BoxGeometry(halfX-doorHalf,4,.14),lib.officeWood,-(halfX+doorHalf)/2,2,front);
        box(barn,new THREE.BoxGeometry(halfX-doorHalf,4,.14),lib.officeWood,(halfX+doorHalf)/2,2,front);
        box(barn,new THREE.BoxGeometry(doorHalf*2,1,.14),lib.officeWood,0,3.5,front);
        box(barn,new THREE.BoxGeometry(8.5,4,.14),lib.officeWood,0,2,halfZ);
        box(barn,new THREE.BoxGeometry(.14,4,6.5),lib.officeWood,-halfX,2,0);
        box(barn,new THREE.BoxGeometry(.14,4,6.5),lib.officeWood,halfX,2,0);
        box(barn,new THREE.BoxGeometry(9.1,.3,7.1),lib.rustMetal,0,4.05,0);
        box(barn,new THREE.BoxGeometry(2.1,3,.08),exitBarn?lib.exitDoor:lib.dark,0,1.5,front-.08);
        g.add(barn);
        this.collisionSegments.push(
          {x1:x-halfX,z1:z-halfZ,x2:x-doorHalf,z2:z-halfZ},
          {x1:x+doorHalf,z1:z-halfZ,x2:x+halfX,z2:z-halfZ},
          {x1:x+halfX,z1:z-halfZ,x2:x+halfX,z2:z+halfZ},
          {x1:x+halfX,z1:z+halfZ,x2:x-halfX,z2:z+halfZ},
          {x1:x-halfX,z1:z+halfZ,x2:x-halfX,z2:z-halfZ}
        );
      }
    }else if(level.id==="37"){
      // Poolrooms: white ceramic tiled chambers, soft turquoise basins, diffuse light.
      const rng=new RNG(this.seedKey()^0x37a1);
      const tileMat=lib.maintenanceWall||lib.wall;
      const waterMat=lib.water.clone();
      waterMat.color.setHex(0x4ec8c0);
      waterMat.opacity=.72;
      waterMat.roughness=.06;
      waterMat.metalness=.04;
      waterMat.emissive.setHex(0x1a6058);
      waterMat.emissiveIntensity=.18;
      waterMat.transparent=true;
      waterMat.depthWrite=false;
      waterMat.side=THREE.DoubleSide;
      this.lightSources.push({
        position:new THREE.Vector3(this.originX+size*.5,level.wallHeight-0.6,this.originZ+size*.5),
        color:0xf4fcf8,baseIntensity:5.5,intensity:5.5,distance:size*1.7,decay:1.35
      });
      const chamberLayouts=[
        {cx:.22,cz:.22,w:size*.38,d:size*.36,pool:false,cols:true},
        {cx:.72,cz:.26,w:size*.42,d:size*.4,pool:true,cols:false},
        {cx:.28,cz:.72,w:size*.4,d:size*.38,pool:true,cols:true},
        {cx:.74,cz:.74,w:size*.36,d:size*.34,pool:false,cols:false}
      ];
      for(const ch of chamberLayouts){
        const cx=this.originX+size*ch.cx,cz=this.originZ+size*ch.cz;
        const hw=ch.w*.5,hd=ch.d*.5,wallH=level.wallHeight;
        const gap=.95;
        box(g,new THREE.BoxGeometry(hw-gap,.22,ch.d),tileMat,cx-(hw+gap)*.5,.11,cz);
        box(g,new THREE.BoxGeometry(hw-gap,.22,ch.d),tileMat,cx+(hw+gap)*.5,.11,cz);
        box(g,new THREE.BoxGeometry(ch.w,wallH,.18),tileMat,cx,wallH*.5,cz-hd);
        box(g,new THREE.BoxGeometry(ch.w,wallH,.18),tileMat,cx,wallH*.5,cz+hd);
        box(g,new THREE.BoxGeometry(.18,wallH,hd-gap),tileMat,cx-hw,wallH*.5,cz-(hd+gap)*.5);
        box(g,new THREE.BoxGeometry(.18,wallH,hd-gap),tileMat,cx-hw,wallH*.5,cz+(hd+gap)*.5);
        box(g,new THREE.BoxGeometry(.18,wallH,hd-gap),tileMat,cx+hw,wallH*.5,cz-(hd+gap)*.5);
        box(g,new THREE.BoxGeometry(.18,wallH,hd-gap),tileMat,cx+hw,wallH*.5,cz+(hd+gap)*.5);
        box(g,new THREE.BoxGeometry(ch.w,.08,ch.d),tileMat,cx,.04,cz);
        this.collisionSegments.push(
          {x1:cx-hw,z1:cz-hd,x2:cx+hw,z2:cz-hd},
          {x1:cx-hw,z1:cz+hd,x2:cx+hw,z2:cz+hd},
          {x1:cx-hw,z1:cz-hd,x2:cx-hw,z2:cz-gap},
          {x1:cx-hw,z1:cz+gap,x2:cx-hw,z2:cz+hd},
          {x1:cx+hw,z1:cz-hd,x2:cx+hw,z2:cz-gap},
          {x1:cx+hw,z1:cz+gap,x2:cx+hw,z2:cz+hd}
        );
        if(ch.pool){
          const poolW=ch.w*.78,poolD=ch.d*.74;
          const surfaceY=1.15;
          const basin=new THREE.Mesh(new THREE.PlaneGeometry(poolW,poolD,48,48),waterMat);
          basin.rotation.x=-Math.PI/2;basin.position.set(cx,surfaceY,cz);basin.renderOrder=1;g.add(basin);
          box(g,new THREE.BoxGeometry(poolW+.5,.16,poolD+.5),tileMat,cx,surfaceY+.08,cz);
          box(g,new THREE.BoxGeometry(poolW,.08,poolD),tileMat,cx,-.02,cz);
        }
        if(ch.cols){
          for(const [ox,oz] of [[-.32,-.28],[.32,-.28],[-.32,.28],[.32,.28]]){
            const colX=cx+ox*ch.w,colZ=cz+oz*ch.d;
            box(g,new THREE.BoxGeometry(.55,wallH,.55),tileMat,colX,wallH*.5,colZ);
            box(g,new THREE.BoxGeometry(.72,.12,.72),tileMat,colX,wallH-.06,colZ);
            box(g,new THREE.BoxGeometry(.72,.1,.72),tileMat,colX,.05,colZ);
            const hx=.32,hz=.32;
            this.collisionSegments.push(
              {x1:colX-hx,z1:colZ-hz,x2:colX+hx,z2:colZ-hz},
              {x1:colX+hx,z1:colZ-hz,x2:colX+hx,z2:colZ+hz},
              {x1:colX+hx,z1:colZ+hz,x2:colX-hx,z2:colZ+hz},
              {x1:colX-hx,z1:colZ+hz,x2:colX-hx,z2:colZ-hz}
            );
          }
        }
        box(g,new THREE.BoxGeometry(ch.w+.4,.12,ch.d+.4),lib.officeCeilingTile||tileMat,cx,wallH-.06,cz);
        // No ceiling light fixtures — Poolrooms use soft ambient/window glow only.
      }
      box(g,new THREE.BoxGeometry(size*.18,.05,size*.18),tileMat,this.originX+size*.5,.025,this.originZ+size*.5);
      if(rng.next()<.55){
        const ax=this.originX+size*.5,az=this.originZ+size*.48;
        box(g,new THREE.BoxGeometry(.22,2.4,.22),tileMat,ax-1.1,1.2,az);
        box(g,new THREE.BoxGeometry(.22,2.4,.22),tileMat,ax+1.1,1.2,az);
        box(g,new THREE.BoxGeometry(2.6,.2,.22),tileMat,ax,2.5,az);
      }
      if(this.exit){
        const ex=this.originX+(this.exit.x+.5)*cell,ez=this.originZ+(this.exit.z+.5)*cell;
        box(g,new THREE.BoxGeometry(2.4,.12,2.4),tileMat,ex,.06,ez);
        box(g,new THREE.BoxGeometry(1.1,2.15,.12),lib.exitDoor||tileMat,ex,1.1,ez);
        this.lightSources.push({position:new THREE.Vector3(ex,2.4,ez),color:0x88e0d8,baseIntensity:6,intensity:6,distance:8,decay:2});
      }
    }
  }

  buildLevel0Set(level,lib,rng){
    const g=this.group,cells=this.gridSize(),cell=level.cellSize,size=this.world.size,region=this.level0Region?.type||"maze",centerCell=Math.floor(cells/2),next=()=>rng.next();
    const center=(x,z)=>({x:this.originX+x*cell+cell/2,z:this.originZ+z*cell+cell/2});

    if(region==="pillars"){
      const spacing=20,pillarData=[],baseData=[],q=new THREE.Quaternion();
      const firstX=Math.ceil((this.originX+2)/spacing)*spacing,firstZ=Math.ceil((this.originZ+2)/spacing)*spacing;
      for(let x=firstX;x<this.originX+size-2;x+=spacing)for(let z=firstZ;z<this.originZ+size-2;z+=spacing){
        if(x<=this.originX+2||x>=this.originX+size-2||z<=this.originZ+2||z>=this.originZ+size-2)continue;
        const gx=Math.round(x/spacing),gz=Math.round(z/spacing),j=.7*(cycleHash(this.game.seed^0x8a12,gx,gz,0x17)-.5);
        pillarData.push(new THREE.Matrix4().compose(new THREE.Vector3(x+j,level.wallHeight/2,z-j),q,new THREE.Vector3(1,1,1)));
        baseData.push(new THREE.Matrix4().compose(new THREE.Vector3(x+j,.08,z-j),q,new THREE.Vector3(1,1,1)));
      }
      const pg=new THREE.BoxGeometry(1.4375,level.wallHeight,1.4375),bg=new THREE.BoxGeometry(2.025,.216,2.025);
      const addLocal=(geometry,material,data)=>{if(!data.length)return;const m=new THREE.InstancedMesh(tileGeometryUV(geometry,material),material,data.length);m.instanceMatrix.setUsage(THREE.StaticDrawUsage);data.forEach((v,i)=>m.setMatrixAt(i,v));m.instanceMatrix.needsUpdate=true;m.computeBoundingSphere();g.add(m)};
      addLocal(pg,lib.pillar,pillarData);addLocal(bg,lib.wall,baseData);
      for(const m of pillarData){const px=m.elements[12],pz=m.elements[14],r=.72;this.collisionSegments.push({x1:px-r,z1:pz-r,x2:px+r,z2:pz-r},{x1:px+r,z1:pz-r,x2:px+r,z2:pz+r},{x1:px+r,z1:pz+r,x2:px-r,z2:pz+r},{x1:px-r,z1:pz+r,x2:px-r,z2:pz-r})}
    }

    if(region==="holes"){
      // A single architectural floor opening, not a grid of black decals.
      // The shader cuts the continuous streaming floor and these walls descend
      // into a dark shaft so the hole is visibly open when approached.
      const hole=5.6,depth=7.5,hx=Math.floor(cells/2),hz=Math.floor(cells/2);
      const p=center(hx-.5,hz-.5);
      this.floorPit={x:p.x,z:p.z,halfWidth:hole/2,halfDepth:hole/2};
      box(g,new THREE.BoxGeometry(hole,.10,hole),lib.dark,p.x,-depth-.05,p.z);
      box(g,new THREE.BoxGeometry(hole,depth,.12),lib.dark,p.x,-depth/2,p.z-hole/2);
      box(g,new THREE.BoxGeometry(hole,depth,.12),lib.dark,p.x,-depth/2,p.z+hole/2);
      box(g,new THREE.BoxGeometry(.12,depth,hole),lib.dark,p.x-hole/2,-depth/2,p.z);
      box(g,new THREE.BoxGeometry(.12,depth,hole),lib.dark,p.x+hole/2,-depth/2,p.z);
    }

    if(region==="blackout"){
      const wetRng=new RNG(this.seedKey()^0x9c31);
      for(let i=0;i<3;i++)if(wetRng.next()<.72){const p=center(wetRng.int(0,cells-1),wetRng.int(0,cells-1));const puddle=new THREE.Mesh(new THREE.CircleGeometry(1.8+wetRng.next()*2.2,18),lib.water);puddle.rotation.x=-Math.PI/2;puddle.position.set(p.x,.009,p.z);g.add(puddle)}
    }

    if(region==="maze"&&!this.manilaRoom){
      // Extremely rare Level 0 anomaly: stepping on this pebble transitions to Level 1.
      const pebbleRng=new RNG(this.seedKey()^0x5e771);
      if(pebbleRng.next()<.015){
        const p=center(pebbleRng.int(1,Math.max(1,cells-2)),pebbleRng.int(1,Math.max(1,cells-2)));
        const pebble=new THREE.Mesh(new THREE.IcosahedronGeometry(.09,1),new THREE.MeshStandardMaterial({color:0x6b6254,roughness:.95,metalness:0}));
        pebble.position.set(p.x,.075,p.z);pebble.scale.set(1,.65,.85);g.add(pebble);
        this.pebbles.push({x:p.x,z:p.z,r:.58,mesh:pebble});
      }
    }

    if(region==="red"){
      const moldRng=new RNG(this.seedKey()^0xa13d);
      for(let i=0;i<5;i++)if(moldRng.next()<.8){const p=center(moldRng.int(0,cells-1),moldRng.int(0,cells-1));const patch=box(g,new THREE.BoxGeometry(.7+.7*moldRng.next(),.5+.45*moldRng.next(),.025),lib.mold,p.x,1,p.z);patch.rotation.y=moldRng.next()<.5?0:Math.PI/2}
      return;
    }

    if((region==="maze"&&!this.manilaRoom)||region==="pillars"){
      // Subtle irregular damp/shaded patches in the carpet. The silhouettes
      // stay low contrast so they read as wear, not decorative circles.
      const stainRng=new RNG(this.seedKey()^0x4d731);
      const stainCount=4+stainRng.int(0,3);
      for(let i=0;i<stainCount;i++){
        const p=center(stainRng.int(0,cells-1),stainRng.int(0,cells-1));
        const radius=.22+stainRng.next()*.52,points=8+stainRng.int(0,4),shape=new THREE.Shape();
        for(let n=0;n<points;n++){
          const angle=n/points*Math.PI*2,rr=radius*(.55+stainRng.next()*.55);
          const x=Math.cos(angle)*rr,z=Math.sin(angle)*rr;
          if(n===0)shape.moveTo(x,z);else shape.lineTo(x,z);
        }
        shape.closePath();
        const patch=new THREE.Mesh(new THREE.ShapeGeometry(shape),lib.dampPatch);
        patch.rotation.x=-Math.PI/2;
        patch.rotateZ(stainRng.next()*Math.PI*2);
        patch.position.set(p.x,.014+stainRng.next()*.004,p.z);
        g.add(patch);
      }
    }

    if(this.manilaRoom&&region==="maze"){
      const p=center(this.manilaRoom.cellX,this.manilaRoom.cellZ),w=8,h=3.15,thick=.42,doorW=1.45,doorH=2.35,side=(w-doorW)/2,wall=lib.manilaWall,wood=lib.officeWood;
      const wallSegments=[];
      const addManilaBaseboard=(horizontal,x,z,length)=>{
        const offset=thick/2+.006,toeOffset=thick/2+.013;
        for(const sign of [-1,1]){
          if(horizontal){
            box(g,new THREE.BoxGeometry(length,.1016,.012),lib.trim,x,.0508,z+sign*offset);
            box(g,new THREE.CylinderGeometry(.009,.009,length,10),lib.trim,x,.009,z+sign*toeOffset,0,0,Math.PI/2);
          }else{
            box(g,new THREE.BoxGeometry(.012,.1016,length),lib.trim,x+sign*offset,.0508,z);
            box(g,new THREE.CylinderGeometry(.009,.009,length,10),lib.trim,x+sign*toeOffset,.009,z,Math.PI/2,0,0);
          }
        }
      };
      const addHorizontal=(z)=>{
        const y=h/2,leftX=p.x-(doorW/2+side/2),rightX=p.x+(doorW/2+side/2);
        wallSegments.push({x1:p.x-w/2,z1:z,x2:p.x-doorW/2,z2:z},{x1:p.x+doorW/2,z1:z,x2:p.x+w/2,z2:z});
        box(g,new THREE.BoxGeometry(side,h,thick),wall,leftX,y,z);
        box(g,new THREE.BoxGeometry(side,h,thick),wall,rightX,y,z);
        addManilaBaseboard(true,leftX,z,side);addManilaBaseboard(true,rightX,z,side);
        box(g,new THREE.BoxGeometry(doorW,h-doorH,thick),wall,p.x,(h+doorH)/2,z);
      };
      const addVertical=(x)=>{
        const y=h/2,nearZ=p.z-(doorW/2+side/2),farZ=p.z+(doorW/2+side/2);
        wallSegments.push({x1:x,z1:p.z-w/2,x2:x,z2:p.z-doorW/2},{x1:x,z1:p.z+doorW/2,x2:x,z2:p.z+w/2});
        box(g,new THREE.BoxGeometry(thick,h,side),wall,x,y,nearZ);
        box(g,new THREE.BoxGeometry(thick,h,side),wall,x,y,farZ);
        addManilaBaseboard(false,x,nearZ,side);addManilaBaseboard(false,x,farZ,side);
        box(g,new THREE.BoxGeometry(thick,h-doorH,doorW),wall,x,(h+doorH)/2,p.z);
      };
      addHorizontal(p.z-w/2);addHorizontal(p.z+w/2);addVertical(p.x-w/2);addVertical(p.x+w/2);
      for(const [name,x,z] of [["north",p.x,p.z-w/2],["east",p.x+w/2,p.z],["south",p.x,p.z+w/2],["west",p.x-w/2,p.z]]){
        const horizontal=name==="north"||name==="south";
        const isEntry=name===this.manilaRoom.entrySide;
        const door=box(g,new THREE.BoxGeometry(horizontal?doorW:.10,doorH,horizontal?.10:doorW),wood,x,doorH/2,z,0,0,0);
        if(isEntry){
          door.position.x+=horizontal?doorW*.42:0;
          door.position.z+=horizontal?0:doorW*.42;
          door.rotation.y=horizontal?(name==="north"?-.38:.38):(name==="west"?-.38:.38);
        }else{
          door.userData.solidDoor=true;
          if(horizontal)this.collisionSegments.push({x1:x-doorW/2,z1:z,x2:x+doorW/2,z2:z});
          else this.collisionSegments.push({x1:x,z1:z-doorW/2,x2:x,z2:z+doorW/2});
        }
      }
      for(const seg of wallSegments)this.collisionSegments.push(seg);
      const floor=new THREE.Mesh(new THREE.PlaneGeometry(w-.25,w-.25),wood);floor.rotation.x=-Math.PI/2;floor.position.set(p.x,.012,p.z);g.add(floor);
      const table=new THREE.Group();table.position.set(p.x,0,p.z);
      const tabletop=new THREE.Mesh(new THREE.CylinderGeometry(.9,.9,.12,8),wood);tabletop.position.y=.78;table.add(tabletop);
      for(const [x,z] of [[-.62,-.46],[.62,-.46],[-.62,.46],[.62,.46]])box(table,new THREE.BoxGeometry(.09,.72,.09),wood,x,.36,z);
      box(table,new THREE.BoxGeometry(.42,.08,.26),wood,0,.84,0);g.add(table);
      for(const x of [-1,1]){const chair=new THREE.Group();chair.position.set(p.x+x*1.65,0,p.z);chair.rotation.y=x<0?Math.PI/2:-Math.PI/2;box(chair,new THREE.BoxGeometry(.72,.10,.72),wood,0,.48,0);for(const [lx,lz] of [[-.27,-.27],[.27,-.27],[-.27,.27],[.27,.27]])box(chair,new THREE.BoxGeometry(.10,.65,.10),wood,lx,.23,lz);box(chair,new THREE.BoxGeometry(.72,.64,.10),wood,0,.72,-.31);g.add(chair)}
      box(g,new THREE.BoxGeometry(1.15,.55,.42),wood,p.x,.32,p.z+.95);
      const outlet=new THREE.Group();outlet.position.set(p.x,.43,p.z-w/2+thick/2+.012);
      box(outlet,new THREE.BoxGeometry(.18,.265,.012),lib.outlet,0,0,0);
      for(const socketY of [.058,-.058]){
        box(outlet,new THREE.BoxGeometry(.009,.046,.004),lib.socket,-.022,socketY,.007);
        box(outlet,new THREE.BoxGeometry(.009,.046,.004),lib.socket,.022,socketY,.007);
        box(outlet,new THREE.CylinderGeometry(.006,.006,.004,8),lib.socket,0,socketY-.034,.007,Math.PI/2,0,0);
      }
      for(const screwY of [.116,-.116])
        box(outlet,new THREE.CylinderGeometry(.006,.006,.004,8),lib.intercomSlot,0,screwY,.008,Math.PI/2,0,0);
      g.add(outlet);
      if(!this.level0Blackout){
        const fixture=box(g,new THREE.BoxGeometry(1.25,.05,.42),lib.light,p.x,h-.13,p.z);fixture.material.emissiveIntensity=.95;fixture.userData.light=true;fixture.userData.baseEmissive=.95;this.fixtures.push(fixture);this.lightSources.push({position:new THREE.Vector3(p.x,h-.32,p.z),color:0xffedc8,baseIntensity:24,intensity:24,distance:7.5,decay:2,fixture});
      }
      return;
    }

    if(region==="pillars")return;
    const candidates=[];
    for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){if(x===centerCell&&z===centerCell)continue;const mask=this.walls[this.index(x,z)],closed=(mask&1?1:0)+(mask&2?1:0)+(mask&4?1:0)+(mask&8?1:0);candidates.push({x,z,mask,closed})}
    // Keep the ordinary spaces architectural and empty. Anomalous props are
    // represented by rare impossible rooms and light events, not floating rings.
    if(this.level0Blackout)return;
    // Fluorescent fixtures are placed with the ceiling grid in buildGeometry().
    // Avoid creating a second, unaligned set of lights in every chunk.
  }
  buildLevel1Set(level,lib,rng){
    const g=this.group,cell=level.cellSize,cells=this.gridSize(),size=this.world.size;
    const next=()=>rng.next();
    const center=(x,z)=>({
      x:this.originX+x*cell+cell/2,
      z:this.originZ+z*cell+cell/2
    });

    if(this.zone!=="parking"){
      const upperFloor=new THREE.Group();upperFloor.name="level1_upper_floor";
      upperFloor.userData.isLevel1UpperFloor=true;
      const slab=new THREE.Mesh(tileGeometryUV(new THREE.BoxGeometry(size,LEVEL1_FLOOR_SLAB_THICKNESS,size),lib.concrete),lib.concrete);
      slab.position.set(this.originX+size/2,LEVEL1_UPPER_FLOOR_Y-LEVEL1_FLOOR_SLAB_THICKNESS/2,this.originZ+size/2);
      slab.userData.isLevel1UpperFloorSlab=true;upperFloor.add(slab);g.add(upperFloor);
    }

    const addLight=(x,z,rotation=0,scale=1,intensity=105)=>{
      const cableLength=.22,cableOffset=2.08*scale;
      for(const floorOffset of [0,LEVEL1_UPPER_FLOOR_Y]){
        const ceilingY=floorOffset+LEVEL1_UPPER_FLOOR_Y;
        for(const side of [-1,1]){
          const cable=new THREE.Mesh(new THREE.CylinderGeometry(.022,.022,cableLength,8),lib.cable);
          cable.position.set(x+Math.cos(rotation)*cableOffset*side,ceilingY-cableLength/2-.035,z+Math.sin(rotation)*cableOffset*side);
          g.add(cable);
        }
        const fixture=box(g,new THREE.BoxGeometry(3.65*scale,.07,.32*scale),lib.level1Light,x,ceilingY-.38,z,0,rotation,0);
        fixture.userData.light=true;fixture.userData.baseEmissive=2.9;fixture.userData.level1Storey=floorOffset?2:1;
        this.fixtures.push(fixture);
        box(g,new THREE.BoxGeometry(3.95*scale,.16,.52*scale),lib.garageBeam,x,ceilingY-.27,z,0,rotation,0);
        this.lightSources.push({position:new THREE.Vector3(x,ceilingY-.48,z),color:0xf4f4ee,baseIntensity:intensity,intensity,distance:34,decay:2,fixture});
      }
    };

    const addPillarSideLight=(x,z,face,intensity=34)=>{
      for(const floorOffset of [0,LEVEL1_UPPER_FLOOR_Y]){
        const y=2.05+floorOffset;
        let backing,emitter,lightPosition;
        if(face==="west"){
          backing=box(g,new THREE.BoxGeometry(.10,1.48,.40),lib.garageBeam,x-.66,y,z);
          emitter=box(g,new THREE.BoxGeometry(.035,1.22,.23),lib.level1Light,x-.7275,y,z);
          lightPosition=new THREE.Vector3(x-1.02,y,z);
        }else if(face==="east"){
          backing=box(g,new THREE.BoxGeometry(.10,1.48,.40),lib.garageBeam,x+.66,y,z);
          emitter=box(g,new THREE.BoxGeometry(.035,1.22,.23),lib.level1Light,x+.7275,y,z);
          lightPosition=new THREE.Vector3(x+1.02,y,z);
        }else if(face==="north"){
          backing=box(g,new THREE.BoxGeometry(.40,1.48,.10),lib.garageBeam,x,y,z-.66);
          emitter=box(g,new THREE.BoxGeometry(.23,1.22,.035),lib.level1Light,x,y,z-.7275);
          lightPosition=new THREE.Vector3(x,y,z-1.02);
        }else{
          backing=box(g,new THREE.BoxGeometry(.40,1.48,.10),lib.garageBeam,x,y,z+.66);
          emitter=box(g,new THREE.BoxGeometry(.23,1.22,.035),lib.level1Light,x,y,z+.7275);
          lightPosition=new THREE.Vector3(x,y,z+1.02);
        }
        emitter.userData.light=true;emitter.userData.level1PillarLight=true;
        emitter.userData.level1Storey=floorOffset?2:1;
        emitter.userData.mountFace=face;emitter.userData.baseEmissive=2.35;
        this.fixtures.push(emitter);
        this.lightSources.push({position:lightPosition,color:0xf4f5f0,baseIntensity:intensity,intensity,distance:17,decay:2,fixture:emitter});
        backing.userData.level1LightHousing=true;
      }
    };

    if(this.zone==="parking"){
      // 5x5 parking-column rhythm. This is the dominant Level 1 shape in
      // The Level 0 macro room 1: long sightlines with repeating square
      // concrete pillars and low structural beams.
      const lowerStoreyHeight=LEVEL1_UPPER_FLOOR_Y-LEVEL1_FLOOR_SLAB_THICKNESS/2-.025;
      const upperStoreyHeight=level.wallHeight-LEVEL1_UPPER_FLOOR_Y-.025;
      const upperStoreyStart=LEVEL1_UPPER_FLOOR_Y;
      const pillarGeom=new THREE.BoxGeometry(1.22,lowerStoreyHeight,1.22);
      const upperPillarGeom=new THREE.BoxGeometry(1.22,upperStoreyHeight,1.22);
      const baseGeom=new THREE.BoxGeometry(1.42,.16,1.42);
      const columnsLower=[],columnsUpper=[],basesLower=[],basesUpper=[];

      for(let ix=1;ix<=8;ix+=2){
        for(let iz=1;iz<=8;iz+=2){
          const p=center(ix,iz);
          columnsLower.push(new THREE.Matrix4().makeTranslation(p.x,.0125+lowerStoreyHeight/2,p.z));
          columnsUpper.push(new THREE.Matrix4().makeTranslation(p.x,upperStoreyStart+.0125+upperStoreyHeight/2,p.z));
          basesLower.push(new THREE.Matrix4().makeTranslation(p.x,.08,p.z));
          basesUpper.push(new THREE.Matrix4().makeTranslation(p.x,upperStoreyStart+.08,p.z));
          const half=.71;
          this.solidRects.push({minX:p.x-half,maxX:p.x+half,minZ:p.z-half,maxZ:p.z+half});
          this.collisionSegments.push(
            {x1:p.x-.61,z1:p.z-.61,x2:p.x+.61,z2:p.z-.61},
            {x1:p.x+.61,z1:p.z-.61,x2:p.x+.61,z2:p.z+.61},
            {x1:p.x+.61,z1:p.z+.61,x2:p.x-.61,z2:p.z+.61},
            {x1:p.x-.61,z1:p.z+.61,x2:p.x-.61,z2:p.z-.61}
          );
        }
      }

      const addInst=(geometry,material,data)=>{
        const mesh=new THREE.InstancedMesh(tileGeometryUV(geometry,material),material,data.length);
        mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        data.forEach((m,i)=>mesh.setMatrixAt(i,m));
        mesh.instanceMatrix.needsUpdate=true;
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
        g.add(mesh);
      };
      addInst(pillarGeom,lib.level1Pillar,columnsLower);
      addInst(upperPillarGeom,lib.level1Pillar,columnsUpper);
      addInst(baseGeom,lib.garageBase,basesLower);
      addInst(baseGeom,lib.garageBase,basesUpper);

      // The faded yellow band wraps the bottom of each square support column.
      // Instance all four faces into one draw call, and mount lights on selected
      // pillar sides rather than suspending every fixture in the cable runs.
      const stripeGeometry=new THREE.BoxGeometry(1.25,.14,.035);
      const stripeMatrices=[],stripeDummy=new THREE.Object3D();
      for(let ix=1;ix<=8;ix+=2){
        for(let iz=1;iz<=8;iz+=2){
          const p=center(ix,iz);
          for(const side of ["north","south","west","east"]){
            stripeDummy.position.set(
              p.x+(side==="west"?-.63:side==="east"?.63:0),
              .39,
              p.z+(side==="north"?-.63:side==="south"?.63:0)
            );
            stripeDummy.rotation.set(0,side==="west"||side==="east"?Math.PI/2:0,0);
            stripeDummy.updateMatrix();stripeMatrices.push(stripeDummy.matrix.clone());
            stripeDummy.position.y=LEVEL1_UPPER_FLOOR_Y+.39;
            stripeDummy.updateMatrix();stripeMatrices.push(stripeDummy.matrix.clone());
          }
          if((ix+iz)%2===0){
            const face=next()<.5?(ix<5?"west":"east"):(iz<5?"north":"south");
            addPillarSideLight(p.x,p.z,face,31+next()*9);
          }
        }
      }
      addInst(stripeGeometry,lib.warningLine,stripeMatrices);

      // Dark structural bands directly below the slab.
      for(let z=8;z<size;z+=16){
        box(
          g,
          new THREE.BoxGeometry(size,.42,.58),
          lib.garageBeam,
          this.originX+size/2,
          level.wallHeight-.55,
          this.originZ+z
        );
        box(g,new THREE.BoxGeometry(size,.42,.58),lib.garageBeam,this.originX+size/2,LEVEL1_UPPER_FLOOR_Y-.55,this.originZ+z);
      }

      // Faded bay markings repeat on both concrete decks.
      const lineMat=lib.warningLine;
      for(let x=8;x<size-8;x+=16){
        const px=this.originX+x;
        for(const floorY of [0,LEVEL1_UPPER_FLOOR_Y]){
          const paintY=floorY+.014;
          box(g,new THREE.BoxGeometry(.07,.014,7.6),lineMat,px,paintY,this.originZ+16);
          box(g,new THREE.BoxGeometry(.07,.014,7.6),lineMat,px,paintY,this.originZ+48);
          for(const z of [12,20,44,52])box(g,new THREE.BoxGeometry(4.8,.014,.07),lineMat,px+2.4,paintY,this.originZ+z);
        }
      }

      // A continuous upper storey spans the chunk. The ramp passes through a
      // real rectangular opening and meets the upper parking deck flush.
      const rampStartX=this.originX+9,rampLength=40,rampEndX=rampStartX+rampLength,rampZ=this.originZ+36;
      const rise=LEVEL1_UPPER_FLOOR_Y,angle=Math.atan2(rise,rampLength),centerX=rampStartX+rampLength/2;
      const centerY=rise/2-.14*Math.cos(angle),openingHalfWidth=3.42;
      const chunkEndX=this.originX+size,chunkEndZ=this.originZ+size;
      this.level1Ramp={startX:rampStartX,endX:rampEndX,endDeckX:chunkEndX,z:rampZ,length:rampLength,rise,halfWidth:3.25,deckHalfWidth:size/2};
      const upperDeck=new THREE.Group();upperDeck.name="level1_upper_floor";
      upperDeck.userData.level1ParkingRamp=true;upperDeck.userData.level1WalkableDeck=true;
      upperDeck.userData.isLevel1UpperFloor=true;
      upperDeck.userData.level1UpperFloorOpening={minX:rampStartX,maxX:rampEndX,minZ:rampZ-openingHalfWidth,maxZ:rampZ+openingHalfWidth};
      const addUpperSlab=(x,z,width,depth)=>{
        if(width<=.01||depth<=.01)return;
        const slab=new THREE.Mesh(tileGeometryUV(new THREE.BoxGeometry(width,LEVEL1_FLOOR_SLAB_THICKNESS,depth),lib.concrete),lib.concrete);
        slab.position.set(x,LEVEL1_UPPER_FLOOR_Y-LEVEL1_FLOOR_SLAB_THICKNESS/2,z);
        slab.userData.isLevel1UpperFloorSlab=true;upperDeck.add(slab);
      };
      const nearDepth=rampZ-openingHalfWidth-this.originZ;
      const farStart=rampZ+openingHalfWidth;
      addUpperSlab((this.originX+rampStartX)/2,this.originZ+size/2,rampStartX-this.originX,size);
      addUpperSlab((rampEndX+chunkEndX)/2,this.originZ+size/2,chunkEndX-rampEndX,size);
      addUpperSlab((rampStartX+rampEndX)/2,this.originZ+nearDepth/2,rampLength,nearDepth);
      addUpperSlab((rampStartX+rampEndX)/2,(farStart+chunkEndZ)/2,rampLength,chunkEndZ-farStart);
      const ramp=new THREE.Mesh(tileGeometryUV(new THREE.BoxGeometry(rampLength,.28,6.5),lib.concrete),lib.concrete);
      ramp.position.set(centerX,centerY,rampZ);ramp.rotation.z=angle;
      ramp.userData.level1ParkingRamp=true;ramp.userData.level1WalkableRamp=true;upperDeck.add(ramp);
      for(const side of [-1,1]){
        const rail=new THREE.Mesh(new THREE.BoxGeometry(rampLength,.74,.25),lib.garageBase);
        rail.position.set(centerX,centerY+.48,rampZ+side*3.12);rail.rotation.z=angle;upperDeck.add(rail);
        const edgePaint=new THREE.Mesh(new THREE.BoxGeometry(rampLength,.035,.035),lib.warningLine);
        edgePaint.position.set(centerX,centerY+.86,rampZ+side*2.94);edgePaint.rotation.z=angle;upperDeck.add(edgePaint);
        this.collisionSegments.push({x1:rampStartX,z1:rampZ+side*3.12,x2:rampEndX,z2:rampZ+side*3.12});
      }
      for(const t of [.34,.68]){
        const x=rampStartX+rampLength*t,h=Math.max(.18,rise*t-.28*Math.cos(angle));
        for(const side of [-1,1])box(upperDeck,new THREE.BoxGeometry(.38,h,.38),lib.concrete,x,h/2,rampZ+side*2.55);
      }
      g.add(upperDeck);

      // Abandoned vehicles are rare landmarks, kept clear of the chunk's central route.
      const carCount=next()<.42?1:next()<.18?2:0;
      for(let i=0;i<carCount;i++){
        const px=this.originX+12+next()*(size-24),pz=this.originZ+12+next()*(size-24);
        if(this.level1Ramp&&Math.abs(pz-this.level1Ramp.z)<5&&px>this.level1Ramp.startX-2&&px<this.level1Ramp.endX+5)continue;
        if(Math.hypot(px-(this.originX+size/2),pz-(this.originZ+size/2))<8)continue;
        const car=new THREE.Group();car.position.set(px,0,pz);
        box(car,new THREE.BoxGeometry(1.82,.62,3.75),lib.garageBase,0,.72,0);
        box(car,new THREE.BoxGeometry(1.58,.72,1.65),lib.metal,0,1.34,-.12);
        box(car,new THREE.BoxGeometry(1.62,.12,3.25),lib.rustMetal,0,1.08,0);
        for(const z of [-1.18,1.18])for(const x of [-.94,.94]){
          const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,.2,12),lib.dark);
          wheel.rotation.z=Math.PI/2;wheel.position.set(x,.42,z);car.add(wheel);
        }
        g.add(car);
        this.collisionSegments.push(
          {x1:px-.98,z1:pz-1.95,x2:px+.98,z2:pz-1.95},
          {x1:px+.98,z1:pz-1.95,x2:px+.98,z2:pz+1.95},
          {x1:px+.98,z1:pz+1.95,x2:px-.98,z2:pz+1.95},
          {x1:px-.98,z1:pz+1.95,x2:px-.98,z2:pz-1.95}
        );
      }

      // Sparse service hardware at the edge of a few bays.
      for(let i=0;i<2;i++){
        if(next()>.42)continue;
        const px=this.originX+(2+next()*(cells-4))*cell;
        const pz=this.originZ+(.9+next()*.15)*cell;
        box(g,new THREE.BoxGeometry(.16,1.8,.28),lib.garageBase,px,.9,pz);
        box(g,new THREE.BoxGeometry(.5,.08,.32),lib.metal,px,1.72,pz);
      }
    }else if(this.zone==="halls"){
      const addHallWall=(x1,z1,x2,z2,height=3.25,material=lib.concrete)=>{
        const dx=x2-x1,dz=z2-z1,length=Math.hypot(dx,dz);
        if(length<.3)return;
        const rotation=-Math.atan2(dz,dx);
        if(height>=3.2){
          const lowerHeight=LEVEL1_UPPER_FLOOR_Y-LEVEL1_FLOOR_SLAB_THICKNESS/2-.025;
          const upperHeight=level.wallHeight-LEVEL1_UPPER_FLOOR_Y-.025;
          box(g,new THREE.BoxGeometry(length,lowerHeight,.18),material,(x1+x2)/2,.0125+lowerHeight/2,(z1+z2)/2,0,rotation,0);
          box(g,new THREE.BoxGeometry(length,upperHeight,.18),material,(x1+x2)/2,LEVEL1_UPPER_FLOOR_Y+.0125+upperHeight/2,(z1+z2)/2,0,rotation,0);
        }else{
          const partitionHeight=Math.min(height,LEVEL1_UPPER_FLOOR_Y-LEVEL1_FLOOR_SLAB_THICKNESS/2-.025);
          box(g,new THREE.BoxGeometry(length,partitionHeight,.18),material,(x1+x2)/2,partitionHeight/2,(z1+z2)/2,0,rotation,0);
        }
        this.collisionSegments.push({x1,z1,x2,z2});
      };
      const left=this.originX+size*.32,right=this.originX+size*.68;
      const near=this.originZ+size*.1,far=this.originZ+size*.9;
      // Two broken partition runs create three broad, connected warehouse halls.
      for(const x of [left,right]){
        addHallWall(x,near,x,near+size*.34);
        addHallWall(x,near+size*.49,x,far);
      }
      addHallWall(this.originX+size*.12,this.originZ+size*.5,left-1,this.originZ+size*.5,LEVEL1_UPPER_FLOOR_Y-LEVEL1_FLOOR_SLAB_THICKNESS/2-.025);
      addHallWall(right+1,this.originZ+size*.5,this.originX+size*.88,this.originZ+size*.5,2.9);

      // Repeating columns and overhead fluorescent rows give the halls scale.
      for(const x of [this.originX+size*.18,this.originX+size*.82]){
        for(let z=12;z<size-8;z+=24){
          const px=x,pz=this.originZ+z;
          const lowerHeight=LEVEL1_UPPER_FLOOR_Y-LEVEL1_FLOOR_SLAB_THICKNESS/2-.025;
          const upperHeight=level.wallHeight-LEVEL1_UPPER_FLOOR_Y-.025;
          box(g,new THREE.BoxGeometry(.72,lowerHeight,.72),lib.level1Pillar,px,.0125+lowerHeight/2,pz);
          box(g,new THREE.BoxGeometry(.72,upperHeight,.72),lib.level1Pillar,px,LEVEL1_UPPER_FLOOR_Y+.0125+upperHeight/2,pz);
          box(g,new THREE.BoxGeometry(.94,.12,.94),lib.garageBase,px,.06,pz);
          box(g,new THREE.BoxGeometry(.94,.12,.94),lib.garageBase,px,LEVEL1_UPPER_FLOOR_Y+.06,pz);
          const half=.47;
          this.solidRects.push({minX:px-half,maxX:px+half,minZ:pz-half,maxZ:pz+half});
          this.collisionSegments.push(
            {x1:px-half,z1:pz-half,x2:px+half,z2:pz-half},
            {x1:px+half,z1:pz-half,x2:px+half,z2:pz+half},
            {x1:px+half,z1:pz+half,x2:px-half,z2:pz+half},
            {x1:px-half,z1:pz+half,x2:px-half,z2:pz-half}
          );
          if(z%48===12)addPillarSideLight(px,pz,x<this.originX+size/2?"east":"west",28+next()*8);
        }
      }
      for(let z=10;z<size-8;z+=18){
        addLight(this.originX+size*.5,this.originZ+z,0,1.08,108+next()*22);
      }
      for(const x of [left+4,right-4]){
        for(let z=12;z<size-10;z+=28){
          if(next()<.24)continue;
          addLight(x,this.originZ+z,Math.PI/2,.78,78+next()*18);
        }
      }

      // Sparse industrial shelving: steel uprights, crossbars and stored crates.
      for(const x of [left-3,right+3]){
        for(let z=14;z<size-12;z+=22){
          const pz=this.originZ+z;
          for(const side of [-1,1]){
            const px=x+side*.82;
            box(g,new THREE.BoxGeometry(.09,2.35,.09),lib.metal,px,1.175,pz);
            box(g,new THREE.BoxGeometry(.09,2.35,.09),lib.metal,px,1.175,pz+2.2);
          }
          for(const y of [.42,1.18,1.94]){
            box(g,new THREE.BoxGeometry(1.75,.09,.12),lib.rustMetal,x,y,pz+1.1);
            if(next()<.66)box(g,new THREE.BoxGeometry(1.25,.48,.92),lib.crate,x,y+.29,pz+1.1);
          }
          this.collisionSegments.push(
            {x1:x-.9,z1:pz+.7,x2:x+.9,z2:pz+.7},
            {x1:x+.9,z1:pz+.7,x2:x+.9,z2:pz+1.5},
            {x1:x+.9,z1:pz+1.5,x2:x-.9,z2:pz+1.5},
            {x1:x-.9,z1:pz+1.5,x2:x-.9,z2:pz+.7}
          );
        }
      }
    }else{
      // Narrower service corridors use a seeded DFS topology with occasional widened rooms.
      // It still uses the same gray concrete palette, not the yellow Level 0
      // materials or a painted-white ceiling.
      for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){
        const mask=this.walls[this.index(x,z)];
        const openings=4-((mask&1?1:0)+(mask&2?1:0)+(mask&4?1:0)+(mask&8?1:0));
        if(openings<=0)continue;
        if((x+z)%2!==0&&next()>.42)continue;
        const p=center(x,z);
        addLight(p.x,p.z,openings>=2?0:Math.PI/2,.72,82+next()*18);
      }

      // Small pillar rooms are the same 3x3 special-room mechanism used by
      // Level1MazeGenerator.spawnRandomRooms().
      for(const room of this.rooms){
        const p=center(room.x+1,room.z+1);
        if(room.type==="pillars"){
          for(const [ox,oz] of [[-1.1,-1.1],[1.1,-1.1],[-1.1,1.1],[1.1,1.1]]){
            const px=p.x+ox*1.15,pz=p.z+oz*1.15,half=.29;
            const lowerHeight=LEVEL1_UPPER_FLOOR_Y-LEVEL1_FLOOR_SLAB_THICKNESS/2-.025;
            const upperHeight=level.wallHeight-LEVEL1_UPPER_FLOOR_Y-.025;
            box(g,new THREE.BoxGeometry(.58,lowerHeight,.58),lib.level1Pillar,px,.0125+lowerHeight/2,pz);
            box(g,new THREE.BoxGeometry(.58,upperHeight,.58),lib.level1Pillar,px,LEVEL1_UPPER_FLOOR_Y+.0125+upperHeight/2,pz);
            this.solidRects.push({minX:px-.34,maxX:px+.34,minZ:pz-.34,maxZ:pz+.34});
            this.collisionSegments.push(
              {x1:px-half,z1:pz-half,x2:px+half,z2:pz-half},
              {x1:px+half,z1:pz-half,x2:px+half,z2:pz+half},
              {x1:px+half,z1:pz+half,x2:px-half,z2:pz+half},
              {x1:px-half,z1:pz+half,x2:px-half,z2:pz-half}
            );
          }
        }else{
          for(let i=0;i<2;i++){
            const ox=(next()-.5)*room.w*cell*.34;
            const oz=(next()-.5)*room.h*cell*.34;
            box(g,new THREE.BoxGeometry(.92,.78,.92),lib.crate,p.x+ox,.39,p.z+oz);
          }
        }
      }
    }

    // Damp concrete and standing water are distributed through the entire
    // sector. Most puddles are long tracked-out streaks; others are compact,
    // ragged pools. Each material gets one merged mesh per chunk to keep draw
    // calls flat even with the higher puddle density.
    const puddleCount=this.zone==="parking"?17:this.zone==="halls"?14:10;
    const patchCount=this.zone==="parking"?14:this.zone==="halls"?12:8;
    const makeWetShape=(radiusX,radiusZ,points)=>{
      const shape=new THREE.Shape();
      for(let i=0;i<points;i++){
        const angle=i/points*Math.PI*2;
        const irregular=.72+next()*.42;
        const x=Math.cos(angle)*radiusX*irregular;
        const z=Math.sin(angle)*radiusZ*irregular;
        if(i===0)shape.moveTo(x,z);else shape.lineTo(x,z);
      }
      shape.closePath();
      return shape;
    };
    const appendWetShape=(positions,radiusX,radiusZ,points,px,pz,rotation)=>{
      const shapeGeometry=new THREE.ShapeGeometry(makeWetShape(radiusX,radiusZ,points),2);
      const attribute=shapeGeometry.attributes.position;
      const c=Math.cos(rotation),sn=Math.sin(rotation);
      for(let vertex=0;vertex<attribute.count;vertex++){
        const x=attribute.getX(vertex),z=attribute.getY(vertex);
        const dx=x*c-z*sn,dz=x*sn+z*c;
        // Geometry lives in a shared horizontal XY plane; its group rotates
        // once to XZ, so negate local Y to preserve world-space Z orientation.
        positions.push(px-this.originX+dx,-(pz-this.originZ+dz),0);
      }
      shapeGeometry.dispose();
    };
    const stainPositions=[],puddlePositions=[];
    for(let i=0;i<patchCount;i++){
      const px=this.originX+4+next()*(size-8),pz=this.originZ+4+next()*(size-8);
      const radiusX=2.2+next()*5.0,radiusZ=.65+next()*2.8;
      appendWetShape(stainPositions,radiusX,radiusZ,12+Math.floor(next()*7),px,pz,next()*Math.PI*2);
    }
    for(let i=0;i<puddleCount;i++){
      const px=this.originX+4+next()*(size-8),pz=this.originZ+4+next()*(size-8);
      const kind=next();
      let radiusX,radiusZ;
      if(kind<.48){
        radiusX=2.6+next()*4.0;radiusZ=.22+next()*.62;
      }else if(kind<.82){
        radiusX=.85+next()*2.1;radiusZ=.55+next()*1.5;
      }else{
        radiusX=1.6+next()*3.2;radiusZ=1.15+next()*2.4;
      }
      appendWetShape(puddlePositions,radiusX,radiusZ,14+Math.floor(next()*9),px,pz,next()*Math.PI*2);
    }
    const makeMergedWetGeometry=positions=>{
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
      geometry.computeVertexNormals();
      return geometry;
    };
    if(stainPositions.length){
      const stainRoot=new THREE.Group();stainRoot.position.set(this.originX,.010,this.originZ);stainRoot.rotation.x=-Math.PI/2;
      const stains=new THREE.Mesh(makeMergedWetGeometry(stainPositions),lib.wetConcrete);
      stains.renderOrder=1;stains.userData.isLevel1WetConcrete=true;stains.userData.patchCount=patchCount;
      stainRoot.add(stains);g.add(stainRoot);
    }
    if(puddlePositions.length){
      const puddleRoot=new THREE.Group();puddleRoot.position.set(this.originX,.018,this.originZ);puddleRoot.rotation.x=-Math.PI/2;
      const puddle=new THREE.Mesh(makeMergedWetGeometry(puddlePositions),lib.puddle);
      puddle.renderOrder=2;puddle.userData.isLevel1Puddle=true;puddle.userData.puddleCount=puddleCount;
      puddle.layers.set(1);puddleRoot.add(puddle);g.add(puddleRoot);
    }
  }

  centerForLevel1Cell(worldX,worldZ){
    return {x:this.originX+worldX,z:this.originZ+worldZ};
  }

  contains(x,z){return x>=this.originX&&x<this.originX+this.world.size&&z>=this.originZ&&z<this.originZ+this.world.size}
  cellAt(x,z){
    const cells=this.gridSize(),cell=this.game.level.cellSize;
    let ix=Math.floor((x-this.originX)/cell),iz=Math.floor((z-this.originZ)/cell);
    ix=Math.max(0,Math.min(cells-1,ix));iz=Math.max(0,Math.min(cells-1,iz));
    return {ix,iz,mask:this.walls[this.index(ix,iz)]};
  }
  dispose(){
    const shared=new Set(Object.values(this.world.library||{})),geometries=new Set(),uniqueMaterials=new Set();
    this.group.traverse(object=>{
      if(object.geometry)geometries.add(object.geometry);
      const material=object.material;
      if(material&&!shared.has(material)){
        if(Array.isArray(material))material.forEach(m=>uniqueMaterials.add(m));else uniqueMaterials.add(material);
      }
    });
    for(const geometry of geometries)geometry.dispose();
    for(const material of uniqueMaterials)material.dispose();
    this.group.clear();
  }
  startFlickerEvent(){
    const now=this.game.gameTime;
    const fixtureCount=this.fixtures.length;
    if(!fixtureCount)return;
    // Every rendered fixture participates, but each gets its own 1-6 pulse
    // pattern. The starts are spread across the event so the whole ceiling
    // never strobes in lockstep.
    const duration=Math.max(4.2,Math.min(9.5,3.1+fixtureCount*.055+Math.random()*2.4));
    const order=this.fixtures.slice();
    for(let i=order.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [order[i],order[j]]=[order[j],order[i]];
    }
    const pulseSlots=Math.max(1,fixtureCount*3);
    for(let i=0;i<order.length;i++){
      const fixture=order[i];
      const count=1+Math.floor(Math.random()*6);
      const pulses=[];
      const baseOffset=(i/pulseSlots)*duration;
      for(let n=0;n<count;n++){
        const wave=(n/Math.max(1,count-1||1))*.82*duration;
        const jitter=(Math.random()-.5)*Math.min(.22,duration*.025);
        const start=Math.max(0,Math.min(duration-.08,baseOffset+wave+jitter));
        const offDuration=.055+Math.random()*.105;
        pulses.push({start,end:Math.min(duration,start+offDuration),played:false});
      }
      pulses.sort((a,b)=>a.start-b.start);
      fixture.userData.flickerPulses=pulses;
      fixture.userData.flickerEventStart=now;
    }
  }
  flickerScale(fixture){
    const pulses=fixture?.userData?.flickerPulses;
    if(!pulses?.length)return 1;
    const elapsed=this.game.gameTime-(fixture.userData.flickerEventStart??this.game.gameTime);
    let dark=false;
    for(const pulse of pulses){
      if(!pulse.played&&elapsed>=pulse.start){
        pulse.played=true;
        const p=fixture?.position;
        if(p)this.game.audio.flickerAt?.(p);
      }
      if(elapsed>=pulse.start&&elapsed<pulse.end)dark=true;
    }
    return dark?.018:1;
  }
  update(dt){
    const state=this.game.lightState;
    const enteredFlicker=state==="FLICKER"&&this.lastLightState!=="FLICKER";
    this.lastLightState=this.game.lightState;

    if(enteredFlicker)this.startFlickerEvent();

    if(state==="BLACKOUT"){
      for(const fixture of this.fixtures){
        if(fixture.material?.emissive)
          fixture.material.emissiveIntensity=0;
      }
      for(const light of this.lightSources)light.intensity=0;
      return;
    }

    if(state==="FLICKER"){
      for(const fixture of this.fixtures){
        const scale=this.flickerScale(fixture);
        if(fixture.material?.emissive)
          fixture.material.emissiveIntensity=(fixture.userData.baseEmissive??.8)*scale;
      }
      for(const light of this.lightSources){
        const scale=this.flickerScale(light.fixture);
        light.intensity=light.baseIntensity*scale;
      }
      return;
    }

    for(const fixture of this.fixtures){
      if(fixture.material?.emissive&&fixture.userData.baseEmissive!==undefined)
        fixture.material.emissiveIntensity=fixture.userData.baseEmissive;
      fixture.userData.flickerPulses=null;
    }
    for(const light of this.lightSources)light.intensity=light.baseIntensity;
  }
}

class WorldStreamer{
  constructor(game){
    this.game=game;this.chunks=new Map();this.library=null;this.radius=2;this.size=0;
    this.surfaceSize=0;this.floorSurface=null;this.ceilingSurface=null;
    this.forceLevel0Zone=null;
    this.forceLevel0AllRed=false;
    this.forceLevel0ManilaRoom=null;
  }
  key(cx,cz){return cx+","+cz}
  async configure(onProgress=()=>{}){
    for(const c of this.chunks.values()){
      this.game.scene.remove(c.group);
      c.dispose();
    }
    this.chunks.clear();

    for(const surface of [this.floorSurface,this.ceilingSurface]){
      if(surface){
        this.game.scene.remove(surface);
        surface.geometry.dispose();
      }
    }
    this.floorSurface=null;
    this.ceilingSurface=null;

    if(this.library)disposeLibrary(this.library);

    this.size=this.game.level.cellSize*(this.game.level.gridSize||CELLS);
    this.surfaceSize=this.size*(this.radius*2+3);
    this.surfaceCenterX=0;this.surfaceCenterZ=0;
    this.library=makeLibrary(this.game.level);
    if(this.game.level.id==="0")this.configureLevel0FloorHoles(this.library.floor);

    {
      this.floorSurface=new THREE.Mesh(
        new THREE.PlaneGeometry(this.surfaceSize,this.surfaceSize),
        this.library.floor
      );
      this.floorSurface.rotation.x=-Math.PI/2;
      this.floorSurface.position.set(0,this.game.level.id==="0"?0:-.001,0);
      this.floorSurface.updateMatrix();
      this.floorSurface.matrixAutoUpdate=false;
      this.floorSurface.frustumCulled=false;
      this.floorSurface.renderOrder=-2;

      this.ceilingSurface=new THREE.Mesh(
        new THREE.PlaneGeometry(this.surfaceSize,this.surfaceSize),
        this.library.ceiling
      );
      this.ceilingSurface.rotation.x=Math.PI/2;
      // Keep the ceiling plane just above wall tops. Level 0 previously put
      // both surfaces at the same Y coordinate, causing tiny z-fighting seams.
      this.ceilingSurface.position.set(0,this.game.level.wallHeight+.008,0);
      this.ceilingSurface.updateMatrix();
      this.ceilingSurface.matrixAutoUpdate=false;
      this.ceilingSurface.frustumCulled=false;
      this.ceilingSurface.renderOrder=-2;
      this.ceilingSurface.visible=!LEVELS_WITHOUT_GLOBAL_CEILING.has(String(this.game.level.id));
    }
    if(this.game.level.id==="7"){
      // Ocean-bottom teal (NOT near-black). Global floor stays under the water plane.
      this.library.floor.color.setHex(0x1a4a58);this.library.floor.roughness=.55;this.library.floor.metalness=.08;
      this.library.concrete.color.setHex(0x8aa0a8);this.library.concrete.roughness=.88;
      if(this.floorSurface)this.floorSurface.visible=false; // water mesh is the visible surface
    }else if(this.game.level.id==="8"){
      // White tint so cave-rock albedo reads as limestone, not soil-brown.
      this.library.floor.color.setHex(0xffffff);this.library.floor.roughness=.96;this.library.floor.metalness=.04;
      this.library.concrete.color.setHex(0xffffff);this.library.concrete.roughness=.97;
    }else if(this.game.level.id==="9"){
      this.library.floor.color.setHex(0x202527);this.library.floor.roughness=.88;this.library.floor.metalness=.03;
    }else if(this.game.level.id==="10"){
      this.library.floor.color.setHex(0x8a7e4a);this.library.floor.roughness=.98;this.library.floor.metalness=0;
    }else if(this.game.level.id==="5"){
      this.library.floor.color.setHex(0x493238);this.library.floor.roughness=.94;
    }else if(this.game.level.id==="6"){
      this.library.floor.color.setHex(0x030406);this.library.ceiling.color.setHex(0x010203);
    }else if(this.game.level.id==="37"){
      this.library.floor.color.setHex(0xd4e0dc);this.library.floor.roughness=.42;this.library.floor.metalness=.02;
      this.library.ceiling.color.setHex(0xf0f4f0);this.library.ceiling.roughness=.85;
    }

    if(this.floorSurface)this.game.scene.add(this.floorSurface);
    if(this.ceilingSurface)this.game.scene.add(this.ceilingSurface);
    if(this.game.level.id==="1"){
      this.library.floor.color.setHex(0x666a68);
      this.library.floor.roughness=.42;
      this.library.floor.metalness=.03;
      this.library.ceiling.color.setHex(0xc5c8c5);
      this.library.ceiling.roughness=.9;
      this.library.ceiling.metalness=0;
      this.library.concrete.color.setHex(0xaeb0ac);
      this.library.concrete.roughness=.84;
    }

    this.updateSurfaceTiling();
    this.updateWallTextureTiling();

    // The procedural fallback is complete at this point. Do not make startup
    // depend on remote texture downloads or external asset hosts. Capture this
    // level/library pair: a player can change levels while these promises are
    // pending, and reading this.game.level/this.library after an await used to
    // apply Level 0 carpet maps to the next level's ceiling material.
    const assetLibrary=this.library,assetLevel=this.game.level;
    const assetLoad=(async()=>{
      try{
        if(assetLevel.id==="1")await applyLevel1Assets(assetLibrary,assetLevel,onProgress);
        else if(assetLevel.id==="2"||assetLevel.id==="3")await applyIndustrialPBR(assetLibrary,assetLevel,onProgress);
        else if(assetLevel.id==="0"){
          await applyFoundFootageLevel0Assets(assetLibrary,assetLevel,onProgress);
          if(this.library!==assetLibrary||this.game.level!==assetLevel)return;
          await applyOpenGameArtPBR(assetLibrary,assetLevel,onProgress);
        }else await applyLevelSpecificPBR(assetLibrary,assetLevel,onProgress);
      }catch(error){
        console.warn("[Backrooms] Surface asset enhancement failed; procedural fallback remains active.",error);
      }
      if(this.library!==assetLibrary||this.game.level!==assetLevel)return;
      if(this.ceilingSurface)this.ceilingSurface.visible=!LEVELS_WITHOUT_GLOBAL_CEILING.has(String(this.game.level.id));
      if(assetLevel.id==="8"){
        assetLibrary.floor.color.setHex(0xffffff);
        assetLibrary.concrete.color.setHex(0xffffff);
      }
      this.updateSurfaceTiling();
      this.updateWallTextureTiling();
    })();

    return assetLoad;
  }

  configureLevel0FloorHoles(material){
    const uniforms={
      count:{value:0},
      pits:{value:Array.from({length:16},()=>new THREE.Vector4(0,0,0,0))}
    };
    material.userData.level0PitUniforms=uniforms;
    material.onBeforeCompile=shader=>{
      shader.uniforms.uBackroomsPitCount=uniforms.count;
      shader.uniforms.uBackroomsPits=uniforms.pits;
      shader.vertexShader=shader.vertexShader.replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vBackroomsWorldPosition;"
      );
      shader.vertexShader=shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvBackroomsWorldPosition=(modelMatrix*vec4(transformed,1.0)).xyz;"
      );
      shader.fragmentShader=shader.fragmentShader.replace(
        "#include <common>",
        "#include <common>\nuniform int uBackroomsPitCount;\nuniform vec4 uBackroomsPits[16];\nvarying vec3 vBackroomsWorldPosition;"
      );
      shader.fragmentShader=shader.fragmentShader.replace(
        "#include <clipping_planes_fragment>",
        "#include <clipping_planes_fragment>\nif(uBackroomsPitCount>0){for(int i=0;i<16;i++){if(i<uBackroomsPitCount){vec4 pit=uBackroomsPits[i];vec2 delta=abs(vBackroomsWorldPosition.xz-pit.xy);if(delta.x<pit.z&&delta.y<pit.w)discard;}}}"
      );
    };
    material.customProgramCacheKey=()=>"backrooms-level0-floor-holes-v1";
    material.needsUpdate=true;
  }

  refreshFloorPits(){
    const uniforms=this.library?.floor?.userData?.level0PitUniforms;
    if(!uniforms)return;
    const pits=[...this.chunks.values()].map(chunk=>chunk.floorPit).filter(Boolean).slice(0,16);
    uniforms.count.value=pits.length;
    for(let i=0;i<uniforms.pits.value.length;i++){
      const target=uniforms.pits.value[i],pit=pits[i];
      if(pit)target.set(pit.x,pit.z,pit.halfWidth,pit.halfDepth);
      else target.set(0,0,0,0);
    }
  }

  updateWallTextureTiling(){
    if(this.game.level.id!=="0"||!this.library?.wall)return;
    for(const key of ["map","roughnessMap","normalMap"]){
      const texture=this.library.wall[key];
      if(!texture)continue;
      texture.wrapS=THREE.RepeatWrapping;
      texture.wrapT=THREE.RepeatWrapping;
      const repeat=2.4;
      texture.repeat.set(repeat,repeat);
      texture.offset.set(0,0);
    }
  }

  updateSurfaceTiling(){
    const isLevel0=this.game.level.id==="0";
    const surfaces=isLevel0
      ? [
          {material:this.library?.floor,tileWorldX:1.25,tileWorldZ:1.25},
          // The authored color map is a sheet of four columns by two rows.
          // Each source panel is about 1.27 × 1.14 m, so repeat the whole sheet
          // at 5.08 × 2.28 m to keep the rendered tiles at life size.
          {material:this.library?.ceiling,tileWorldX:5.08,tileWorldZ:2.28}
        ]
      : this.game.level.id==="1"
        ? [
            {material:this.library?.floor,tileWorldX:5.4,tileWorldZ:5.4},
            {material:this.library?.ceiling,tileWorldX:5.4,tileWorldZ:5.4}
          ]
        : [
            {material:this.library?.floor,tileWorldX:this.game.level.id==="3"?2.4:3.0,tileWorldZ:this.game.level.id==="3"?2.4:3.0},
            {material:this.library?.ceiling,tileWorldX:1.25,tileWorldZ:1.25}
          ];

    for(const {material,tileWorldX,tileWorldZ} of surfaces){
      if(!material)continue;
      // UVs span 0..1 across the active streamed surface, so repeat once per
      // real-world tile instead of stretching one image across the whole world.
      const repeatX=this.surfaceSize/tileWorldX;
      const repeatZ=this.surfaceSize/tileWorldZ;
      for(const key of ["map","roughnessMap","normalMap"]){
        const texture=material[key];
        if(!texture)continue;
        texture.wrapS=THREE.RepeatWrapping;
        texture.wrapT=THREE.RepeatWrapping;
        texture.repeat.set(repeatX,repeatZ);
        const isFloor=material===this.library?.floor;
        texture.offset.set(
          this.surfaceCenterX/tileWorldX,
          (isFloor?-1:1)*this.surfaceCenterZ/tileWorldZ
        );
      }
    }
  }
  chunkAt(x,z){
    const offset=this.size/2;
    const cx=Math.floor((x+offset)/this.size),cz=Math.floor((z+offset)/this.size);
    return this.chunks.get(this.key(cx,cz))||null;
  }
  ensureAround(x,z){
    const offset=this.size/2;
    const cx=Math.floor((x+offset)/this.size),cz=Math.floor((z+offset)/this.size);
    const centerX=cx*this.size,centerZ=cz*this.size;
    if(centerX!==this.surfaceCenterX||centerZ!==this.surfaceCenterZ){
      this.surfaceCenterX=centerX;this.surfaceCenterZ=centerZ;
      for(const surface of [this.floorSurface,this.ceilingSurface]){
        if(!surface)continue;
        surface.position.x=centerX;surface.position.z=centerZ;surface.updateMatrix();
      }
      this.updateSurfaceTiling();
    }
    let changed=false;
    for(let dz=-this.radius;dz<=this.radius;dz++)for(let dx=-this.radius;dx<=this.radius;dx++){
      if(dx*dx+dz*dz>(this.radius+.35)*(this.radius+.35))continue;
      const k=this.key(cx+dx,cz+dz);
      if(!this.chunks.has(k)){
        const c=new Chunk(this,cx+dx,cz+dz);this.chunks.set(k,c);this.game.scene.add(c.group);changed=true;
        const entityChance=this.game.level.id==="3"?.13:this.game.level.id==="4"?.012:.055;
        if(this.game.level.entity!=="none"&&Math.hypot(cx+dx,cz+dz)>=2&&c.level3RoomType!=="switchgear"&&cycleHash(this.game.seed,c.cx,c.cz+449+this.game.level.id.charCodeAt(0))<entityChance)c.entitySpawn=true;
      }
    }
    for(const [k,c] of this.chunks){
      if(Math.hypot(c.cx-cx,c.cz-cz)>this.radius+1){this.game.scene.remove(c.group);this.chunks.delete(k);changed=true}
    }
    if(changed)this.refreshFloorPits();
  }
  async ensureAroundAsync(x,z,onProgress=()=>{}){
    const offset=this.size/2;
    const cx=Math.floor((x+offset)/this.size),cz=Math.floor((z+offset)/this.size);
    const centerX=cx*this.size,centerZ=cz*this.size;
    if(centerX!==this.surfaceCenterX||centerZ!==this.surfaceCenterZ){
      this.surfaceCenterX=centerX;this.surfaceCenterZ=centerZ;
      for(const surface of [this.floorSurface,this.ceilingSurface]){
        if(!surface)continue;
        surface.position.x=centerX;surface.position.z=centerZ;surface.updateMatrix();
      }
      this.updateSurfaceTiling();
    }
    const targets=[];
    for(let dz=-this.radius;dz<=this.radius;dz++)for(let dx=-this.radius;dx<=this.radius;dx++){
      if(dx*dx+dz*dz>(this.radius+.35)*(this.radius+.35))continue;
      targets.push([cx+dx,cz+dz]);
    }
    let changed=false,done=0;
    for(const [chunkX,chunkZ] of targets){
      const key=this.key(chunkX,chunkZ);
      if(!this.chunks.has(key)){
        const chunk=new Chunk(this,chunkX,chunkZ);
        this.chunks.set(key,chunk);this.game.scene.add(chunk.group);changed=true;
        const entityChance=this.game.level.id==="3"?.13:this.game.level.id==="4"?.012:.055;
        if(this.game.level.entity!=="none"&&Math.hypot(chunkX,chunkZ)>=2&&chunk.level3RoomType!=="switchgear"&&cycleHash(this.game.seed,chunkX,chunkZ+449+this.game.level.id.charCodeAt(0))<entityChance)chunk.entitySpawn=true;
      }
      done++;
      onProgress(done,targets.length);
      if(done%2===0&&done<targets.length)await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
    }
    for(const [key,chunk] of this.chunks){
      if(Math.hypot(chunk.cx-cx,chunk.cz-cz)>this.radius+1){this.game.scene.remove(chunk.group);this.chunks.delete(key);changed=true;}
    }
    if(changed)this.refreshFloorPits();
    return done;
  }

  setLevel0AllRed(enabled=true){
    this.forceLevel0AllRed=!!enabled;
    if(this.game.level.id!=="0")return;
    if(this.forceLevel0AllRed){
      // The red-room rewrite is intentionally a game mechanic: once the
      // 60-second escape window expires, the loaded world and every newly
      // streamed Level 0 chunk use the Red Rooms appearance.
      const redFloor=this.library?.redFloor;
      const redWall=this.library?.redWall;
      if(redWall){
        redWall.map=null;
        redWall.color.setHex(0xb51b1b);
        redWall.needsUpdate=true;
      }
      if(redFloor){
        redFloor.map=null;
        redFloor.color.setHex(0x651515);
        redFloor.emissive=new THREE.Color(0x160000);
        redFloor.emissiveIntensity=.035;
        redFloor.needsUpdate=true;
      }
      if(this.library?.floor){
        this.library.floor.map=null;
        this.library.floor.color.setHex(0x651515);
        this.library.floor.emissive=new THREE.Color(0x160000);
        this.library.floor.emissiveIntensity=.035;
        this.library.floor.needsUpdate=true;
      }
      if(this.library?.ceiling){
        this.library.ceiling.map=null;
        this.library.ceiling.color.setHex(0x350909);
        this.library.ceiling.emissive=new THREE.Color(0x210000);
        this.library.ceiling.emissiveIntensity=.075;
        this.library.ceiling.needsUpdate=true;
      }
    }

    const p=this.game.player.position;
    for(const c of this.chunks.values()){
      this.game.scene.remove(c.group);
      c.dispose();
    }
    this.chunks.clear();
    this.ensureAround(p.x,p.z);
  }
  currentCell(){const c=this.chunkAt(this.game.player.position.x,this.game.player.position.z);return c?c.cellAt(this.game.player.position.x,this.game.player.position.z):null}
  level0SpawnPoint(){
    if(this.game.level.id!=="0")return{x:0,z:0};
    const c=Math.floor(this.game.level.gridSize/2);
    const chunk=this.chunks.get("0,0");
    if(!chunk)return{x:0,z:0};
    return{x:chunk.originX+c*this.game.level.cellSize+this.game.level.cellSize/2,z:chunk.originZ+c*this.game.level.cellSize+this.game.level.cellSize/2};
  }
    findSafeSpawn(x,z,radius=.36){
    // Never accept the collision resolver's pushed position as a spawn: a
    // push can land against a second segment (especially garage columns) and
    // leave the player wedged inside the next obstacle. Search clear points
    // around the preferred location and only accept a point that stays put.
    const candidates=[[0,0]];
    const step=Math.max(.5,Math.min(1.0,this.game.level.cellSize/8));
    for(let ring=1;ring<=12;ring++){
      const distance=ring*step;
      const count=Math.max(8,Math.ceil(2*Math.PI*distance/(step*.8)));
      for(let i=0;i<count;i++){
        const angle=(i/count)*Math.PI*2;
        candidates.push([Math.cos(angle)*distance,Math.sin(angle)*distance]);
      }
    }
    for(const [dx,dz] of candidates){
      const cx=x+dx,cz=z+dz;
      const hit=this.collision(new THREE.Vector3(cx,0,cz),radius);
      if(Math.hypot(hit.x-cx,hit.z-cz)>.015)continue;
      // Confirm a second independent pass is stable; this catches corner
      // cases where resolving one pole/wall pushes the point into another.
      const verify=this.collision(new THREE.Vector3(hit.x,0,hit.z),radius);
      if(Math.hypot(verify.x-hit.x,verify.z-hit.z)>.015)continue;
      return {x:hit.x,z:hit.z};
    }
    // Keep the preferred point only as a last-resort fallback; callers still
    // get a finite location if a malformed chunk has no walkable surface.
    return {x,z};
  }
  walkSurfaceHeightAt(x,z,floor=this.game.player?.parkingFloor??0){
    if(this.game.level.id!=="1")return 0;
    const ramp=this.chunkAt(x,z)?.level1Ramp;
    if(ramp&&Math.abs(z-ramp.z)<=ramp.halfWidth&&x>=ramp.startX-.08&&x<=ramp.endX+.08){
      return ramp.rise*THREE.MathUtils.clamp((x-ramp.startX)/ramp.length,0,1);
    }
    return floor>=1?LEVEL1_UPPER_FLOOR_Y:0;
  }
  update(dt){
    const p=this.game.player.position;
    this.ensureAround(p.x,p.z);
    this.updateVisibility(dt);
    for(const c of this.chunks.values()){
      if(c.group.visible||Math.hypot(c.bounds.center.x-p.x,c.bounds.center.z-p.z)<38)c.update(dt);
    }
  }

  updateVisibility(dt){
    if(this.ceilingSurface)this.ceilingSurface.visible=!LEVELS_WITHOUT_GLOBAL_CEILING.has(String(this.game.level.id));
    const camera=this.game.camera;
    camera.updateMatrixWorld();
    const frustum=new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
    );
    const p=this.game.player.position;
    const remove=[];
    for(const [key,c] of this.chunks){
      const d=Math.hypot(c.bounds.center.x-p.x,c.bounds.center.z-p.z);
      const visible=frustum.intersectsSphere(c.bounds);

      // The group stays attached so visible fixtures can render at distance.
      // Individual meshes still use Three.js frustum culling.
      c.group.visible=true;
      if(visible||d<55)c.hiddenSince=0;
      else c.hiddenSince+=dt;

      if(c!==this.chunkAt(p.x,p.z)&&d>155&&!visible&&c.hiddenSince>4)remove.push([key,c]);
    }
    for(const [key,c] of remove){
      this.game.scene.remove(c.group);
      c.dispose();
      this.chunks.delete(key);
    }
  }
  collision(position,radius){
    if(this.game.admin?.noclip)return {x:position.x,z:position.z};
    const chunk=this.chunkAt(position.x,position.z);
    if(!chunk)return position;
    const wallRadius=this.game.level.id==="0"?radius:radius+.11;
    let x=position.x,z=position.z;

    const testSegment=(x1,z1,x2,z2)=>{
      const sx=x2-x1,sz=z2-z1,lenSq=sx*sx+sz*sz||1;
      const t=Math.max(0,Math.min(1,((x-x1)*sx+(z-z1)*sz)/lenSq));
      const qx=x1+sx*t,qz=z1+sz*t;
      let dx=x-qx,dz=z-qz,dist=Math.hypot(dx,dz);
      if(dist<wallRadius){
        if(dist<.0001){dx=-(sz||1);dz=sx||1;dist=Math.hypot(dx,dz)||1}
        const push=wallRadius-dist;
        x+=dx/dist*push;z+=dz/dist*push;
      }
    };

    if(this.game.level.id==="0"){
      const offset=this.size/2;
      const cx=Math.floor((x+offset)/this.size),cz=Math.floor((z+offset)/this.size);
      for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
        const nearby=this.chunks.get(this.key(cx+dx,cz+dz));
        if(!nearby?.collisionSegments?.length)continue;
        for(let pass=0;pass<2;pass++)for(const seg of nearby.collisionSegments)testSegment(seg.x1,seg.z1,seg.x2,seg.z2);
      }
      return {x,z};
    }

    const cell=this.game.level.cellSize;
    const baseX=Math.floor((x-chunk.originX)/cell),baseZ=Math.floor((z-chunk.originZ)/cell);
    for(let pass=0;pass<2;pass++){
      const bx=Math.floor((x-chunk.originX)/cell),bz=Math.floor((z-chunk.originZ)/cell);
      for(let iz=bz-1;iz<=bz+1;iz++)for(let ix=bx-1;ix<=bx+1;ix++){
        if(ix<0||iz<0||ix>=chunk.gridSize()||iz>=chunk.gridSize())continue;
        const mask=chunk.walls[chunk.index(ix,iz)];
        const minX=chunk.originX+ix*cell,maxX=minX+cell;
        const minZ=chunk.originZ+iz*cell,maxZ=minZ+cell;
        if(mask&1)testSegment(minX,minZ,maxX,minZ);
        if(mask&2)testSegment(maxX,minZ,maxX,maxZ);
        if(mask&4)testSegment(minX,maxZ,maxX,maxZ);
        if(mask&8)testSegment(minX,minZ,minX,maxZ);
      }
    }
    if(this.game.level.id==="1"){
      const offset=this.size/2,cx=Math.floor((x+offset)/this.size),cz=Math.floor((z+offset)/this.size),reach=wallRadius+.35;
      for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
        if(dx<0&&x-chunk.originX>reach)continue;
        if(dx>0&&chunk.originX+this.size-x>reach)continue;
        if(dz<0&&z-chunk.originZ>reach)continue;
        if(dz>0&&chunk.originZ+this.size-z>reach)continue;
        const nearby=this.chunks.get(this.key(cx+dx,cz+dz));
        for(const rect of nearby?.solidRects||[]){
          if(x<rect.minX-reach||x>rect.maxX+reach||z<rect.minZ-reach||z>rect.maxZ+reach)continue;
          if(x>rect.minX&&x<rect.maxX&&z>rect.minZ&&z<rect.maxZ){
            const exits=[
              {distance:x-rect.minX,axis:'x',value:rect.minX-wallRadius},
              {distance:rect.maxX-x,axis:'x',value:rect.maxX+wallRadius},
              {distance:z-rect.minZ,axis:'z',value:rect.minZ-wallRadius},
              {distance:rect.maxZ-z,axis:'z',value:rect.maxZ+wallRadius}
            ].sort((a,b)=>a.distance-b.distance);
            if(exits[0].axis==='x')x=exits[0].value;else z=exits[0].value;
          }
        }
        for(const seg of nearby?.obstacleSegments||[]){
          const minX=Math.min(seg.x1,seg.x2)-reach,maxX=Math.max(seg.x1,seg.x2)+reach;
          const minZ=Math.min(seg.z1,seg.z2)-reach,maxZ=Math.max(seg.z1,seg.z2)+reach;
          if(x<minX||x>maxX||z<minZ||z>maxZ)continue;
          testSegment(seg.x1,seg.z1,seg.x2,seg.z2);
        }
      }
    }else{
      const offset=this.size/2;
      const cx=Math.floor((x+offset)/this.size),cz=Math.floor((z+offset)/this.size);
      const reach=wallRadius+.35;
      for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
        if(dx<0&&x-chunk.originX>reach)continue;
        if(dx>0&&chunk.originX+this.size-x>reach)continue;
        if(dz<0&&z-chunk.originZ>reach)continue;
        if(dz>0&&chunk.originZ+this.size-z>reach)continue;
        const nearby=this.chunks.get(this.key(cx+dx,cz+dz));
        if(!nearby?.collisionSegments?.length)continue;
        for(const seg of nearby.collisionSegments){
          const minX=Math.min(seg.x1,seg.x2)-reach,maxX=Math.max(seg.x1,seg.x2)+reach;
          const minZ=Math.min(seg.z1,seg.z2)-reach,maxZ=Math.max(seg.z1,seg.z2)+reach;
          if(x<minX||x>maxX||z<minZ||z>maxZ)continue;
          testSegment(seg.x1,seg.z1,seg.x2,seg.z2);
        }
      }
    }
    return {x,z};
  }
  pebbleAt(x,z){
    for(const c of this.chunks.values())for(const p of c.pebbles||[]){
      if((x-p.x)*(x-p.x)+(z-p.z)*(z-p.z)<p.r*p.r)return true;
    }
    return false;
  }
  hazardAt(x,z){
    const c=this.chunkAt(x,z);if(!c)return false;const cell=this.game.level.cellSize;
    // Cluster hazards mark the actual cut-out rectangle; the carpet rim around
    // a pit remains walkable instead of killing the player several metres early.
    if(c.floorPit&&Math.abs(x-c.floorPit.x)<=c.floorPit.halfWidth&&Math.abs(z-c.floorPit.z)<=c.floorPit.halfDepth)return true;
    for(const h of c.hazards){
      if(h.cluster)continue;
      const hx=c.originX+h.x*cell+cell/2,hz=c.originZ+h.z*cell+cell/2;
      if((x-hx)*(x-hx)+(z-hz)*(z-hz)<(cell*.26)**2)return true;
    }
    return false;
  }
  exitAt(x,z){
    const offset=this.size/2;
    const cx=Math.floor((x+offset)/this.size),cz=Math.floor((z+offset)/this.size);
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
      const chunk=this.chunks.get(this.key(cx+dx,cz+dz)),exit=chunk?.exit;
      if(!exit?.position)continue;
      if(exit.kind==="ocean"&&this.game.player.position.y> -2.4)continue;
      if(Math.hypot(exit.position.x-x,exit.position.z-z)<1.25)return true;
    }
    return false;
  }
  lightProximity(x,z){
    const offset=this.size/2;
    const cx=Math.floor((x+offset)/this.size),cz=Math.floor((z+offset)/this.size);
    let best=Infinity;
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
      const c=this.chunks.get(this.key(cx+dx,cz+dz));if(!c)continue;
      for(const light of c.lightSources){
        const d=Math.hypot(light.position.x-x,light.position.z-z);if(d<best)best=d;
      }
    }
    return best<90?1-best/90:0;
  }
  nearbyLightSources(x,z,frustum){
    const out=[];
    const camera=this.game.camera;
    camera.updateMatrixWorld(true);
    const cameraPosition=this._lightCameraPosition||(this._lightCameraPosition=new THREE.Vector3());
    const cameraDirection=this._lightCameraDirection||(this._lightCameraDirection=new THREE.Vector3());
    camera.getWorldPosition(cameraPosition);
    camera.getWorldDirection(cameraDirection);
    const halfVertical=THREE.MathUtils.degToRad((camera.fov||62)*.5);
    const halfHorizontal=Math.atan(Math.tan(halfVertical)*Math.max(.5,camera.aspect||1));
    const halfDiagonal=Math.atan(Math.hypot(Math.tan(halfVertical),Math.tan(halfHorizontal)));
    const offset=this.size/2;
    const cx=Math.floor((x+offset)/this.size),cz=Math.floor((z+offset)/this.size);
    const span=Math.min(4,Math.max(2,Math.ceil(32/this.size)));
    const sphere=this._lightCullSphere||(this._lightCullSphere=new THREE.Sphere());
    const toLight=this._lightCullVector||(this._lightCullVector=new THREE.Vector3());
    for(let dz=-span;dz<=span;dz++)for(let dx=-span;dx<=span;dx++){
      const c=this.chunks.get(this.key(cx+dx,cz+dz));
      if(!c)continue;
      for(const light of c.lightSources){
        const influenceRadius=light.cullRadius??(light.distance>0?light.distance:24);
        sphere.center.copy(light.position);sphere.radius=influenceRadius;
        if(!frustum.intersectsSphere(sphere))continue;
        toLight.copy(light.position).sub(cameraPosition);
        const cameraDistance=toLight.length();
        const forward=cameraDistance>.001?cameraDirection.dot(toLight.multiplyScalar(1/cameraDistance)):1;
        const angle=Math.acos(Math.max(-1,Math.min(1,forward)));
        const angularRadius=cameraDistance>influenceRadius
          ? Math.asin(Math.min(1,influenceRadius/cameraDistance))
          : Math.PI/2;
        const offAxis=Math.max(0,angle-angularRadius-halfDiagonal);
        const sourceInFrustum=frustum.containsPoint(light.position);
        const playerDistance=Math.hypot(light.position.x-x,light.position.z-z);
        if(playerDistance>Math.max(54,influenceRadius+30))continue;
        const score=cameraDistance+offAxis*110+(forward<-.1?60:0)
          +(sourceInFrustum?-18:0)-Math.min(influenceRadius,16)*.25;
        out.push({light,d:playerDistance,score});
      }
    }
    out.sort((a,b)=>a.score-b.score);
    return out;
  }
  flashlightWallDistance(x,z,dx,dz,maxDistance=2.5){
    if(this.game.level.id!=="0")return Infinity;
    const offset=this.size/2;
    const cx=Math.floor((x+offset)/this.size),cz=Math.floor((z+offset)/this.size);
    let best=Infinity;
    const rayX=dx,rayZ=dz;
    const checkSegment=(s)=>{
      const x1=s.x1,x2=s.x2,z1=s.z1,z2=s.z2;
      const eps=1e-6;
      if(Math.abs(x2-x1)<eps){
        if(Math.abs(rayX)<eps)return;
        const t=(x1-x)/rayX;
        if(t<0||t>maxDistance||t>=best)return;
        const hitZ=z+t*rayZ;
        const lo=Math.min(z1,z2)-.03,hi=Math.max(z1,z2)+.03;
        if(hitZ>=lo&&hitZ<=hi)best=t;
      }else if(Math.abs(rayZ)>=eps){
        const t=(z1-z)/rayZ;
        if(t<0||t>maxDistance||t>=best)return;
        const hitX=x+t*rayX;
        const lo=Math.min(x1,x2)-.03,hi=Math.max(x1,x2)+.03;
        if(hitX>=lo&&hitX<=hi)best=t;
      }
    };
    for(let dzc=-1;dzc<=1;dzc++)for(let dxc=-1;dxc<=1;dxc++){
      const chunk=this.chunks.get(this.key(cx+dxc,cz+dzc));
      if(!chunk?.collisionSegments?.length)continue;
      for(const segment of chunk.collisionSegments)checkSegment(segment);
    }
    return best;
  }

  entitySpawns(){
    const out=[];
    for(const c of this.chunks.values()){
      if(!c.entitySpawn)continue;
      if(this.game.level.id==="0"&&!c.level0Blackout)continue;
      if(this.game.level.id==="1"&&this.game.lightState!=="BLACKOUT")continue;
      out.push(c);
    }
    return out;
  }
}

class Player{
  constructor(game){
    this.game=game;this.position=new THREE.Vector3(0,1.72,0);this.velocity=new THREE.Vector3();this.verticalVelocity=0;this.yaw=0;this.pitch=0;
    this.health=100;this.stamina=100;this.hydration=100;this.sanity=100;
    this.flashlight=true;this.flashBattery=100;
    this.eyeY=1.72;this.bob=0;this.bobStrength=0;this.shake=0;this.cameraFov=62;this.flashWarmup=1.15;this.redFlashBoost=1;this.inOcean=false;this.parkingFloor=0;
    this.viewYaw=0;this.viewPitch=0;
  }
  reset(){
    this.position.set(0,this.eyeY,0);this.velocity.set(0,0,0);this.verticalVelocity=0;this.yaw=0;this.pitch=0;this.viewYaw=0;this.viewPitch=0;
    this.bob=0;this.bobStrength=0;this.shake=0;this.cameraFov=62;
    this.health=this.stamina=this.hydration=this.sanity=100;this.flashBattery=100;
    this.flashlight=this.game.startFlash;
    this.inOcean=false;
    this.parkingFloor=0;
    this.flashWarmup=1.15;
    this.redFlashBoost=1;
    this.game.camera.fov=62;this.game.camera.updateProjectionMatrix();
    this.game.camera.position.set(0,this.eyeY,0);this.game.camera.rotation.set(0,0,0,"YXZ");
  }
  update(dt){
    const input=this.game.input,look=input.consumeLook();
    const sensitivity=this.game.settings.sensitivity||1;
    this.yaw-=look.x*.0021*sensitivity;this.pitch-=look.y*.0021*sensitivity;this.pitch=Math.max(-1.48,Math.min(1.48,this.pitch));
    const yawDiff=Math.atan2(Math.sin(this.yaw-this.viewYaw),Math.cos(this.yaw-this.viewYaw));
    const viewAlpha=1-Math.exp(-dt*20);
    this.viewYaw+=yawDiff*viewAlpha;
    this.viewPitch+=(this.pitch-this.viewPitch)*viewAlpha;
    const mv=input.getMove();
    const forward=new THREE.Vector3(-Math.sin(this.yaw),0,-Math.cos(this.yaw));
    const right=new THREE.Vector3(Math.cos(this.yaw),0,-Math.sin(this.yaw));
    const wish=new THREE.Vector3().addScaledVector(right,mv.x).addScaledVector(forward,-mv.y);
    if(wish.lengthSq()>1)wish.normalize();
    const predictedX=this.position.x+wish.x*.2,predictedZ=this.position.z+wish.z*.2;
    const level7Ocean=this.game.level.id==="7"&&(Math.abs(predictedX)>4.5||predictedZ>4.5||predictedZ< -4.5);
    const run=input.wantsRun()&&this.stamina>4&&Math.hypot(mv.x,mv.y)>.12;
    const speed=level7Ocean?(run?2.8:1.9):(run?6.2:2.85);
    const response=level7Ocean?(wish.lengthSq()>.001?4.2:1.65):(wish.lengthSq()>.001?(run?19:16):14);
    const targetX=wish.x*speed,targetZ=wish.z*speed;
    const blend=1-Math.exp(-response*dt);
    this.velocity.x+=(targetX-this.velocity.x)*blend;
    this.velocity.z+=(targetZ-this.velocity.z)*blend;
    const oldX=this.position.x,oldZ=this.position.z;
    const proposedX=this.position.x+this.velocity.x*dt;
    const proposedZ=this.position.z+this.velocity.z*dt;
    const col=this.game.world.collision(new THREE.Vector3(proposedX,this.position.y,proposedZ),.34);
    if(Math.abs(col.x-proposedX)>.001)this.velocity.x=0;
    if(Math.abs(col.z-proposedZ)>.001)this.velocity.z=0;
    this.position.x=col.x;this.position.z=col.z;

    const nowInOcean=this.game.level.id==="7"&&(Math.abs(this.position.x)>4.5||this.position.z>4.5||this.position.z< -4.5);
    if(nowInOcean){
      if(!this.inOcean){
        this.inOcean=true;this.verticalVelocity=0;
        this.game.toast("Swimming: WASD to move, SPACE to surface, CTRL to dive. Look up or down to steer.",4);
      }
      const surfaceY=oceanSurfaceHeight(this.position.x,this.position.z,this.game.gameTime);
      const bodyBottom=this.position.y-1.55;
      const submerged=THREE.MathUtils.clamp((surfaceY-bodyBottom)/1.67,0,1);
      const swimInput=(input.wantsAscend()?1:0)-(input.wantsDive()?1:0);
      const forwardStroke=-mv.y*Math.sin(this.pitch);
      const gravity=-9.81;
      const buoyancy=9.81*1.18*submerged;
      const waterDrag=-this.verticalVelocity*(2.5+submerged*1.8);
      const swimForce=swimInput*6.4+forwardStroke*3.2;
      this.verticalVelocity=THREE.MathUtils.clamp(this.verticalVelocity+(gravity+buoyancy+waterDrag+swimForce)*dt,-3.1,3.0);
      this.position.y=THREE.MathUtils.clamp(this.position.y+this.verticalVelocity*dt,-24,surfaceY+1.25);
      if(this.position.y>=surfaceY+1.25&&this.verticalVelocity>0)this.verticalVelocity=Math.min(0,this.verticalVelocity);
      const depthBlend=THREE.MathUtils.clamp((surfaceY+.08-this.position.y)/4.8,0,1);
      if(this.game.scene.fog){
        // Surface stays bright blue-white; only deep water goes dark.
        this.game.scene.fog.color.setRGB(THREE.MathUtils.lerp(.78,.05,depthBlend),THREE.MathUtils.lerp(.90,.14,depthBlend),THREE.MathUtils.lerp(.94,.22,depthBlend));
        this.game.scene.fog.density=.0006+depthBlend*.016;
      }
    }else{
      this.inOcean=false;
      this.verticalVelocity=0;
      if(this.game.level.id==="1"){
        const ramp=this.game.world.chunkAt(this.position.x,this.position.z)?.level1Ramp;
        if(ramp&&Math.abs(this.position.z-ramp.z)<=ramp.halfWidth){
          if(this.parkingFloor===0&&this.position.x>=ramp.endX-.05)this.parkingFloor=1;
          else if(this.parkingFloor===1&&this.position.x<=ramp.startX+.05)this.parkingFloor=0;
        }
      }else this.parkingFloor=0;
      this.position.y=this.eyeY+this.game.world.walkSurfaceHeightAt(this.position.x,this.position.z,this.parkingFloor);
      if(this.game.level.id==="7"&&this.game.scene.fog){
        // Daytime surface fog — must stay light or the ocean sky reads black.
        this.game.scene.fog.color.setHex(0xc8e4f0);
        this.game.scene.fog.density=.0005;
      }
    }
    if(this.game.redZoneTrapped&&this.game.redZoneBounds){
      const b=this.game.redZoneBounds;
      this.position.x=Math.max(b.minX,Math.min(b.maxX,this.position.x));
      this.position.z=Math.max(b.minZ,Math.min(b.maxZ,this.position.z));
    }
    if(run)this.stamina=Math.max(0,this.stamina-dt*15);else this.stamina=Math.min(100,this.stamina+dt*9);
    this.flashWarmup=Math.max(0,this.flashWarmup-dt);
    if(this.flashlight&&this.flashBattery>0){
      this.flashBattery=Math.max(0,this.flashBattery-dt*(run?.46:.31));
      if(this.flashBattery<=0)this.flashlight=false;
    }
    this.hydration=Math.max(0,this.hydration-dt*.48);
    const dark=this.game.isDark();
    if(!this.game.admin?.god){
      if(this.hydration<18)this.health=Math.max(0,this.health-dt*1.5);
      this.sanity+=dt*(dark?-.95:.22);if(this.flashlight&&dark)this.sanity+=dt*.12;
      if(this.game.world.hazardAt(this.position.x,this.position.z))this.health-=dt*34;
    }else{
      this.health=100;this.sanity=100;
    }
    this.sanity=Math.max(0,Math.min(100,this.sanity));
    if(this.game.world.exitAt(this.position.x,this.position.z)){this.game.reachExit();return}
    if(this.health<=0||this.sanity<=0){this.game.die(this.health<=0?"The dark won.":"Your sense of direction collapsed.");return}
    const distance=Math.hypot(this.position.x-oldX,this.position.z-oldZ);
    const moving=distance>.001;
    const stride=Math.min(1,Math.hypot(mv.x,mv.y));
    const targetBobStrength=moving?stride:0;
    this.bobStrength+=(targetBobStrength-this.bobStrength)*(1-Math.exp(-dt*13));
    if(this.bobStrength>.01){
      this.bob+=dt*(run?12.5:8.1)*(.32+.68*this.bobStrength);
      if(this.game.settings.shake)this.shake=Math.min(.028,this.shake+dt*.075*this.bobStrength);
    }else{
      this.shake=Math.max(0,this.shake-dt*.28);
    }

    const fear=1-this.sanity/100;
    const bobY=(run?.064:.042)*Math.sin(this.bob*2)*this.bobStrength;
    const bobX=(run?.028:.017)*Math.sin(this.bob)*this.bobStrength;
    const breathing=Math.sin(this.game.gameTime*1.31)*.0035;
    const sway=Math.sin(this.game.gameTime*.72)*.0022;
    const lateralLean=THREE.MathUtils.clamp(-this.velocity.x*.006,-.035,.035);
    const roll=Math.sin(this.bob)*(.0024+(run?.0032:.00125))*this.bobStrength+sway*.35+lateralLean;
    const shakeY=this.shake*Math.sin(this.game.gameTime*31)*.11;
    const side=new THREE.Vector3(Math.cos(this.viewYaw),0,-Math.sin(this.viewYaw));
    const cameraTarget=this.position.clone().addScaledVector(side,bobX);
    cameraTarget.y=this.position.y+bobY+breathing+shakeY+(this.inOcean?Math.sin(this.game.gameTime*1.7)*.025+this.verticalVelocity*.012:0);
    this.game.camera.position.lerp(cameraTarget,1-Math.exp(-dt*18));

    const targetFov=THREE.MathUtils.clamp(62+Math.hypot(this.velocity.x,this.velocity.z)*.72,62,67);
    this.cameraFov+=(targetFov-this.cameraFov)*(1-Math.exp(-dt*8));
    if(Math.abs(this.game.camera.fov-this.cameraFov)>.01){this.game.camera.fov=this.cameraFov;this.game.camera.updateProjectionMatrix()}
    this.game.camera.rotation.set(this.viewPitch,this.viewYaw,roll,"YXZ");

    const batteryPower=Math.max(0,this.flashBattery/100);
    const beamPower=Math.pow(batteryPower,.72);
    const currentLevel0Chunk=this.game.level.id==="0"
      ? this.game.world.chunkAt(this.position.x,this.position.z)
      : null;
    const inRedZone=!!(
      currentLevel0Chunk?.level0Region?.type==="red" ||
      (this.game.level.id==="0"&&this.game.redZoneTrapped)
    );
    // Red Rooms are intentionally harder to navigate, so the flashlight
    // gets a stronger output there without bypassing battery degradation.
    const redBoostTarget=inRedZone?1.85:1;
    this.redFlashBoost+=(redBoostTarget-this.redFlashBoost)*(1-Math.exp(-dt*7));
    const flashZoneBoost=Math.max(1,Math.min(1.85,this.redFlashBoost));
    const flashForward=new THREE.Vector3(0,0,-1).applyQuaternion(this.game.camera.quaternion).normalize();
    // Keep the source slightly behind the camera so a wall can never contain
    // the light origin. This matters most when the player is inches from a wall.
    const flashOrigin=this.game.camera.position.clone().addScaledVector(flashForward,-.22);
    this.game.flash.position.copy(flashOrigin);
    this.game.flashFill.position.copy(flashOrigin);

    const wallDistance=this.game.level.id==="0"
      ? this.game.world.flashlightWallDistance(
          this.game.camera.position.x,
          this.game.camera.position.z,
          flashForward.x,
          flashForward.z,
          2.5
        )
      : Infinity;
    const wallFade=wallDistance<Infinity
      ? THREE.MathUtils.smoothstep(wallDistance,.18,1.25)
      : 1;
    // A physically attenuated point light can still saturate a surface when
    // its origin is only a few centimeters from that surface. The source uses
    // deferred AreaLights, so emulate their softer near-wall response by
    // aggressively reducing the concentrated components only at close range.
    const washScale=.14+.86*wallFade;
    const beamScale=.05+.95*wallFade;

    this.game.flash.distance=25;
    this.game.flash.angle=.55;
    this.game.flash.penumbra=.82;
    this.game.flash.decay=2;
    const warmup=1-Math.min(1,this.flashWarmup/1.15);
    const flashRamp=.12+.88*THREE.MathUtils.smoothstep(warmup,0,1);
    // SpotLight intensity is candela in current Three.js, not the old
    // arbitrary point-light scale. Keep the spill broad and restrained.
    this.game.flash.intensity=this.flashlight
      ? (32+beamPower*128)*washScale*flashRamp*flashZoneBoost
      : 0;

    this.game.flashFill.distance=25;
    this.game.flashFill.angle=.25;
    this.game.flashFill.penumbra=.58;
    this.game.flashFill.decay=2;
    // The tighter center hotspot carries most of the throw; both cones
    // use inverse-square attenuation (decay=2) over the same 25 m range.
    this.game.flashFill.intensity=this.flashlight
      ? (180+beamPower*720)*beamScale*flashRamp*flashZoneBoost
      : 0;

    this.game.blackoutLight.position.copy(this.game.camera.position);
    const blackout=this.game.level.id==="0"&&this.game.lightState==="BLACKOUT";
    this.game.blackoutLight.intensity=blackout?12.0:0;

    this.game.flashTarget.position.copy(this.game.camera.position)
      .addScaledVector(flashForward,2.0);
    this.game.flashFillTarget.position.copy(this.game.camera.position)
      .addScaledVector(flashForward,2.0);

    const audioChunk=this.game.world.chunkAt(this.position.x,this.position.z);
    const audioZone=this.game.level.id==="0"&&audioChunk?.level0Blackout?"blackout":"normal";
    this.game.audio.update(dt,moving,run,1-this.sanity/100,this.game.world.lightProximity(this.position.x,this.position.z),this.game.lightState,distance,this.game.level.id,audioZone);
  }
}

function entityNoiseTexture(base="#b6b2aa",dark="#716d67"){
  if(typeof document==="undefined")return null;
  const canvas=document.createElement("canvas");canvas.width=64;canvas.height=64;
  const ctx=canvas.getContext("2d");ctx.fillStyle=base;ctx.fillRect(0,0,64,64);
  const image=ctx.getImageData(0,0,64,64),d=image.data;
  let s=0x91e10da5;
  const rand=()=>{s|=0;s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296};
  for(let i=0;i<d.length;i+=4){
    const n=rand()*42-21;
    d[i]=Math.max(0,Math.min(255,d[i]+n));
    d[i+1]=Math.max(0,Math.min(255,d[i+1]+n));
    d[i+2]=Math.max(0,Math.min(255,d[i+2]+n));
  }
  ctx.putImageData(image,0,0);ctx.globalAlpha=.18;ctx.fillStyle=dark;
  for(let i=0;i<18;i++)ctx.fillRect(rand()*64,rand()*64,1+rand()*7,1+rand()*2);
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=THREE.RepeatWrapping;texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(2,2);
  return texture;
}

function entityMat(color,roughness=1,emissive=0){
  return new THREE.MeshStandardMaterial({color,roughness,emissive:emissive?color:0,emissiveIntensity:emissive});
}

function limb(group,material,position,length=.65,radius=.09){
  const mesh=new THREE.Mesh(new THREE.CapsuleGeometry(radius,length,5,7),material);
  mesh.position.copy(position);group.add(mesh);return mesh;
}

function makeBacteria(group){
  const mat=entityMat(0x030303,1),wire=new THREE.LineBasicMaterial({color:0x050505,transparent:true,opacity:.96});
  // Make the fallback readable at corridor distance: a broad skull and splayed limbs.
  const core=new THREE.Mesh(new THREE.IcosahedronGeometry(.45,1),mat);
  core.scale.set(1.2,1.35,.95);core.position.y=2.72;group.add(core);
  const parts={legs:[],arms:[],head:core};
  for(const side of [-1,1]){
    const leg=limb(group,wire,new THREE.Vector3(side*.28,.78,0),1.2,.065);
    leg.rotation.z=side*.18;parts.legs.push(leg);
    const arm=limb(group,wire,new THREE.Vector3(side*.75,2.0,0),1.8,.078);
    arm.rotation.z=-side*.52;parts.arms.push(arm);
  }
  const neck=limb(group,wire,new THREE.Vector3(0,2.15,0),.62,.07);parts.neck=neck;
  group.userData={height:3.35,parts,anim:"idle",phase:Math.random()*6.28};
}

function makeHound(group){
  const fur=entityMat(0x090909),eye=entityMat(0xffe7a8,.7,4);
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.34,.8,6,10),fur);torso.rotation.z=Math.PI/2;torso.scale.set(1.15,.75,1);torso.position.y=.78;group.add(torso);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.38,12,9),fur);head.scale.set(1.05,.9,1.2);head.position.set(0,1.02,-.58);group.add(head);
  const legs=[];
  for(const x of [-.16,.16])for(const z of [-.2,.25]){const l=limb(group,fur,new THREE.Vector3(x,.48,z),.65,.09);l.rotation.z=x<0?.22:-.22;legs.push(l)}
  for(const x of [-.13,.13]){const e=new THREE.Mesh(new THREE.SphereGeometry(.045,8,6),eye);e.position.set(x,1.08,-.91);group.add(e)}
  const mouth=new THREE.Mesh(new THREE.TorusGeometry(.16,.035,5,16,Math.PI),eye);mouth.rotation.set(Math.PI/2,0,0);mouth.position.set(0,.91,-.92);group.add(mouth);
  group.userData={height:1.35,parts:{legs,head},anim:"idle",phase:Math.random()*6.28};
}

function makeSkinStealer(group){
  const tex=entityNoiseTexture("#b9b5ae","#6c6964"),skin=new THREE.MeshStandardMaterial({color:0xc8c4bc,roughness:.92,map:tex});
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.32,1.15,8,12),skin);body.scale.set(.8,1.35,.72);body.position.y=1.35;group.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.31,14,10),skin);head.scale.set(.9,1.1,.82);head.position.set(0,2.42,0);group.add(head);
  const arms=[];for(const x of [-.2,.2])arms.push(limb(group,skin,new THREE.Vector3(x,1.38,0),.9,.09));
  for(const x of [-.11,.11]){const e=new THREE.Mesh(new THREE.SphereGeometry(.035,8,6),entityMat(0xeeeae2));e.position.set(x,2.47,-.275);group.add(e)}
  group.userData={height:2.75,parts:{arms,head,body},anim:"idle",phase:Math.random()*6.28};
}

function makeSmiler(group){
  const dark=entityMat(0x000000),glow=entityMat(0xffffff,.4,10);
  const face=new THREE.Mesh(new THREE.CircleGeometry(.78,32),dark);face.rotation.y=Math.PI;group.add(face);
  for(const x of [-.25,.25]){const e=new THREE.Mesh(new THREE.SphereGeometry(.075,10,8),glow);e.position.set(x,.18,-.06);group.add(e)}
  const smile=new THREE.Mesh(new THREE.TorusGeometry(.36,.065,8,28,Math.PI),glow);smile.rotation.set(Math.PI/2,0,0);smile.position.set(0,-.12,-.07);group.add(smile);
  group.userData={height:1.6,parts:{face},anim:"idle",phase:Math.random()*6.28,float:true};
}

function makeFaceling(group){
  const skin=entityMat(0xc7c0b5,.95),dark=entityMat(0x171717);
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.35,.9,8,10),skin);body.scale.set(.8,1.5,.65);body.position.y=1.15;group.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.38,16,12),skin);head.scale.set(.86,1.12,.78);head.position.y=2.38;group.add(head);
  group.userData={height:2.9,parts:{head,body},anim:"idle",phase:Math.random()*6.28,faceless:true,dark};
}

function makeDeathmoth(group){
  const wing=entityMat(0x302b25,.9),body=entityMat(0x111111),parts={};
  for(const side of [-1,1]){
    const w=new THREE.Mesh(new THREE.BufferGeometry(),wing);
    const shape=new THREE.Shape();shape.moveTo(0,0);shape.lineTo(side*1.15,.55);shape.lineTo(side*.85,-.65);shape.lineTo(0,-.18);shape.closePath();
    w.geometry.setFromPoints(shape.getPoints(5));w.geometry.computeVertexNormals();w.position.y=1.5;group.add(w);(parts.wings??=[]).push(w);
  }
  const b=new THREE.Mesh(new THREE.CapsuleGeometry(.08,.8,5,8),body);b.position.y=1.5;group.add(b);parts.body=b;
  group.userData={height:2.1,parts,anim:"idle",phase:Math.random()*6.28,flying:true};
}

function makeCrawler(group){
  const mat=entityMat(0x252323),parts={legs:[]};
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.32,.8,6,8),mat);body.rotation.z=Math.PI/2;body.position.y=.42;group.add(body);parts.body=body;
  for(const x of [-.38,-.13,.13,.38]){const l=limb(group,mat,new THREE.Vector3(x,.28,.05),.58,.055);l.rotation.z=x*.8;parts.legs.push(l)}
  group.userData={height:.85,parts,anim:"idle",phase:Math.random()*6.28,crawler:true};
}

function makeWretch(group){
  const skin=entityMat(0x756d67,.98),dark=entityMat(0x151515);
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.3,.9,7,10),skin);body.scale.set(.8,1.35,.7);body.position.y=1.05;group.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.32,12,9),skin);head.position.y=2.2;group.add(head);
  const arms=[];for(const x of [-.2,.2])arms.push(limb(group,skin,new THREE.Vector3(x,1.1,0),1.1,.075));
  group.userData={height:2.65,parts:{arms,head,body},anim:"idle",phase:Math.random()*6.28};
}

function makeClump(group){
  const mat=entityMat(0x514c49,.98),parts={blobs:[]};
  for(let i=0;i<8;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.2+.08*(i%3),8,6),mat);m.position.set((i%4-.15)*.24,.25+(i%2)*.22,Math.floor(i/4)*.24-.24);group.add(m);parts.blobs.push(m)}
  group.userData={height:.8,parts,anim:"idle",phase:Math.random()*6.28,clump:true};
}

function makeDuller(group){
  const mat=entityMat(0x3b3937,.98),parts={legs:[]};
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.27,.7,7,9),mat);body.scale.set(.8,1.2,.65);body.position.y=.82;group.add(body);parts.body=body;
  for(const x of [-.15,.15])parts.legs.push(limb(group,mat,new THREE.Vector3(x,.35,0),.62,.08));
  group.userData={height:1.9,parts,anim:"idle",phase:Math.random()*6.28,duller:true};
}

function makePartygoer(group){
  const suit=entityMat(0x3b0b13,.9),mask=entityMat(0x7b101c,.8,1.2),parts={};
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.3,.95,7,10),suit);body.scale.set(.8,1.3,.7);body.position.y=1.15;group.add(body);parts.body=body;
  const head=new THREE.Mesh(new THREE.SphereGeometry(.34,14,10),mask);head.position.y=2.3;group.add(head);parts.head=head;
  const arms=[];for(const x of [-.2,.2])arms.push(limb(group,suit,new THREE.Vector3(x,1.2,0),.95,.08));parts.arms=arms;
  group.userData={height:2.75,parts,anim:"idle",phase:Math.random()*6.28};
}

function makeDeathrat(group){
  const mat=entityMat(0x191716),eye=entityMat(0xd8c39a,.6,3),parts={legs:[]};
  const body=new THREE.Mesh(new THREE.SphereGeometry(.24,10,8),mat);body.scale.set(1.5,.75,.8);body.position.y=.25;group.add(body);
  for(const x of [-.18,.18])parts.legs.push(limb(group,mat,new THREE.Vector3(x,.17,0),.28,.045));
  for(const x of [-.08,.08]){const e=new THREE.Mesh(new THREE.SphereGeometry(.025,6,5),eye);e.position.set(x,.31,-.2);group.add(e)}
  group.userData={height:.5,parts,anim:"idle",phase:Math.random()*6.28,rat:true};
}

function makeLeviathan(group){
  const hide=entityMat(0x07141d,.98),belly=entityMat(0x263a42,.94),eye=entityMat(0xb8dce4,.3,2.4);
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.72,4.4,8,14),hide);
  body.rotation.x=Math.PI/2;body.position.set(0,1.05,0);group.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.92,16,12),hide);
  head.scale.set(1.1,.78,1.25);head.position.set(0,1.18,-2.35);group.add(head);
  const jaw=new THREE.Mesh(new THREE.SphereGeometry(.72,12,8),belly);
  jaw.scale.set(1,.32,1.12);jaw.position.set(0,.72,-2.55);group.add(jaw);
  for(const side of [-1,1]){
    const eyeMesh=new THREE.Mesh(new THREE.SphereGeometry(.11,10,8),eye);
    eyeMesh.position.set(side*.63,1.4,-2.85);group.add(eyeMesh);
  }
  const tentacles=[];
  for(let i=0;i<6;i++){
    const side=i%2?1:-1,offset=(Math.floor(i/2)-1)*.48;
    const curve=new THREE.CatmullRomCurve3([
      new THREE.Vector3(side*.42,.85,.2+offset),
      new THREE.Vector3(side*1.1,.62,.7+offset),
      new THREE.Vector3(side*1.65,.35,1.35+offset),
      new THREE.Vector3(side*1.9,.18,2.05+offset)
    ]);
    const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,12,.105,6,false),hide);
    group.add(mesh);tentacles.push(mesh);
  }
  group.userData={height:2.6,parts:{body,head,jaw,tentacles},anim:"swim",phase:Math.random()*6.28,leviathan:true};
}

function makeTiny(group){
  const skin=entityMat(0x657b80,.72),fin=entityMat(0x9aaeb0,.82),eye=entityMat(0xe7e4d7,.3,1.1);
  const body=new THREE.Mesh(new THREE.SphereGeometry(.42,12,9),skin);body.scale.set(.72,.55,1.5);body.position.y=.72;group.add(body);
  const tail=new THREE.Mesh(new THREE.ConeGeometry(.3,.62,6),fin);tail.rotation.x=-Math.PI/2;tail.position.set(0,.72,.77);group.add(tail);
  const fins=[];
  for(const side of [-1,1]){const f=new THREE.Mesh(new THREE.ConeGeometry(.2,.55,5),fin);f.rotation.z=side*.75;f.position.set(side*.3,.68,.08);group.add(f);fins.push(f)}
  const eyeMesh=new THREE.Mesh(new THREE.SphereGeometry(.055,8,6),eye);eyeMesh.position.set(.2,.83,-.48);group.add(eyeMesh);
  group.userData={height:1.1,parts:{body,tail,fins},anim:"swim",phase:Math.random()*6.28,tiny:true};
}

const ENTITY_TYPES={
  bacteria:{label:"Bacteria",factory:makeBacteria,range:42,speed:2.25,attack:1.1,behavior:"stalk"},
  hound:{label:"Hound",factory:makeHound,range:30,speed:2.15,attack:1.0,behavior:"hunt"},
  skinstealer:{label:"Skin-Stealer",factory:makeSkinStealer,range:32,speed:1.55,attack:1.0,behavior:"ambush"},
  smiler:{label:"Smiler",factory:makeSmiler,range:38,speed:1.35,attack:1.05,behavior:"light"},
  faceling:{label:"Faceling",factory:makeFaceling,range:24,speed:1.1,attack:1.0,behavior:"observe"},
  deathmoth:{label:"Deathmoth",factory:makeDeathmoth,range:38,speed:2.0,attack:.8,behavior:"swarm"},
  crawler:{label:"Crawler",factory:makeCrawler,range:30,speed:2.5,attack:.85,behavior:"ambush"},
  wretch:{label:"Wretch",factory:makeWretch,range:26,speed:1.85,attack:1.0,behavior:"frenzy"},
  clump:{label:"Clump",factory:makeClump,range:20,speed:.75,attack:1.1,behavior:"slow"},
  duller:{label:"Duller",factory:makeDuller,range:22,speed:1.05,attack:1.0,behavior:"quiet"},
  partygoer:{label:"Partygoer",factory:makePartygoer,range:34,speed:1.8,attack:1.0,behavior:"stalk"},
  deathrat:{label:"Death Rat",factory:makeDeathrat,range:24,speed:2.7,attack:.75,behavior:"swarm"},
  leviathan:{label:"The Thing",factory:makeLeviathan,range:54,speed:1.35,attack:2.3,behavior:"hunt"},
  tiny:{label:"Tiny",factory:makeTiny,range:22,speed:2.6,attack:.65,behavior:"swarm"}
};

function animateEntity(e,dt){
  const u=e.group.userData;
  // The GLB owns the pose once attached; ignore detached procedural fallback parts.
  if(u.realModel)return;
  const parts=u.parts||{},moving=e.motion||0,state=e.state;
  u.phase=(u.phase||0)+dt*(moving?8:1.2);
  const t=u.phase,run=state==="chase"||state==="frenzy";
  u.anim=run?"run":state==="investigate"?"alert":state==="stalk"?"stalk":"idle";
  if(parts.legs)parts.legs.forEach((l,i)=>{l.rotation.x=Math.sin(t*(run?1.55:.7)+i*Math.PI)*(.25+(moving?.45:0));});
  if(parts.arms)parts.arms.forEach((a,i)=>{a.rotation.x=Math.sin(t*(run?1.35:.65)+i*Math.PI)*(.16+(moving?.3:0));a.rotation.z=(i?-.08:.08)});
  if(parts.head)parts.head.rotation.z=Math.sin(t*.8)*.035;
  if(parts.body)parts.body.rotation.z=Math.sin(t*.9)*.018;
  if(u.float)u.parts.face.position.y=Math.sin(t*.9)*.08;
  if(u.flying&&parts.wings)parts.wings.forEach((w,i)=>{w.rotation.z=Math.sin(t*5+i*Math.PI)*.45});
  if(u.clump&&parts.blobs)parts.blobs.forEach((b,i)=>b.scale.y=1+Math.sin(t*1.7+i)*.08);
  if(u.rat)u.parts.legs.forEach((l,i)=>l.rotation.x=Math.sin(t*8+i*Math.PI)*.5);
  if(u.leviathan){
    if(parts.body)parts.body.rotation.z=Math.sin(t*.72)*.045;
    if(parts.head)parts.head.rotation.y=Math.sin(t*.42)*.08;
    if(parts.tentacles)parts.tentacles.forEach((v,i)=>{v.rotation.y=Math.sin(t*1.4+i*.9)*.12;v.rotation.x=Math.cos(t*1.1+i*.7)*.08});
  }
  if(u.tiny){
    if(parts.tail)parts.tail.rotation.y=Math.sin(t*8)*.42;
    if(parts.fins)parts.fins.forEach((v,i)=>v.rotation.x=Math.sin(t*6+i*Math.PI)*.28);
    if(parts.body)parts.body.rotation.z=Math.sin(t*2)*.06;
  }
}

function entityLineOfSight(game,entity,target){
  const origin=entity.group.position.clone();origin.y+=(entity.group.userData.height||1)*.65;
  const end=target.position.clone();end.y=Math.max(1.1,end.y);
  const dir=end.clone().sub(origin),distance=dir.length();if(distance<.01)return true;dir.normalize();
  const ray=new THREE.Raycaster(origin,dir,0,distance-.15);
  const groups=[...game.world.chunks.values()].map(c=>c.group);
  const hits=ray.intersectObjects(groups,true);
  return !hits.some(h=>h.object?.visible&&h.object?.userData?.entityWall);
}

function entityNoise(game,entity){
  const p=game.player,dx=p.position.x-entity.group.position.x,dz=p.position.z-entity.group.position.z,d=Math.hypot(dx,dz);
  const moved=Math.hypot(p.position.x-(entity.lastPlayerX??p.position.x),p.position.z-(entity.lastPlayerZ??p.position.z));
  const loud=(p.bobStrength||0)>.45?1.0:.25;
  return d<Math.max(5,moved*18+loud*7);
}

function steerAroundWalls(game,entity,desired,dt){
  const pos=entity.group.position,base=desired.clone().setY(0).normalize();
  const speed=entity.def.speed*(entity.state==="chase"?1.18:1);
  const tries=[base,new THREE.Vector3(-base.z,0,base.x),new THREE.Vector3(base.z,0,-base.x),base.clone().multiplyScalar(-1)];
  let chosen=base;
  for(const dir of tries){
    const test=pos.clone().addScaledVector(dir,Math.min(1.2,speed*dt*3));
    const col=game.world.collision(test,.28);
    if(Math.hypot(col.x-test.x,col.z-test.z)<.18){chosen=dir;break}
  }
  entity.group.position.x+=chosen.x*speed*dt;
  entity.group.position.z+=chosen.z*speed*dt;
  entity.motion=Math.min(1,entity.motion+dt*5);
  const targetYaw=Math.atan2(chosen.x,chosen.z);
  const current=entity.group.rotation.y;
  entity.group.rotation.y+=Math.atan2(Math.sin(targetYaw-current),Math.cos(targetYaw-current))*Math.min(1,dt*9);
}

function entityPathKey(a,b,step){
  return Math.round(a.x/step)+":"+Math.round(a.z/step)+"->"+Math.round(b.x/step)+":"+Math.round(b.z/step);
}

function entityPathfind(game,start,goal,step=2.0){
  const half=Math.max(12,Math.min(26,game.level.cellSize*3.2));
  const minX=Math.floor((Math.min(start.x,goal.x)-half)/step);
  const maxX=Math.ceil((Math.max(start.x,goal.x)+half)/step);
  const minZ=Math.floor((Math.min(start.z,goal.z)-half)/step);
  const maxZ=Math.ceil((Math.max(start.z,goal.z)+half)/step);
  const width=Math.max(1,Math.min(30,maxX-minX+1)),height=Math.max(1,Math.min(30,maxZ-minZ+1));
  const ox=Math.floor(((start.x+goal.x)*.5)/step)-Math.floor(width/2);
  const oz=Math.floor(((start.z+goal.z)*.5)/step)-Math.floor(height/2);
  const sx=Math.max(0,Math.min(width-1,Math.round(start.x/step)-ox));
  const sz=Math.max(0,Math.min(height-1,Math.round(start.z/step)-oz));
  const gx=Math.max(0,Math.min(width-1,Math.round(goal.x/step)-ox));
  const gz=Math.max(0,Math.min(height-1,Math.round(goal.z/step)-oz));
  const blocked=new Uint8Array(width*height);
  const index=(x,z)=>z*width+x;
  const worldAt=(x,z)=>({x:(ox+x)*step,z:(oz+z)*step});
  for(let z=0;z<height;z++)for(let x=0;x<width;x++){
    const p=worldAt(x,z),q=game.world.collision(p,.30);
    blocked[index(x,z)]=(Math.abs(q.x-p.x)>.08||Math.abs(q.z-p.z)>.08)?1:0;
  }
  blocked[index(sx,sz)]=0;blocked[index(gx,gz)]=0;
  const open=[{x:sx,z:sz,g:0,f:0,parent:-1}];
  const nodes=new Map([[sx+","+sz,open[0]]]);
  const closed=new Set();
  const dirs=[[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,1.414],[-1,1,1.414],[1,-1,1.414],[-1,-1,1.414]];
  let best=null,iterations=0;
  while(open.length&&iterations++<900){
    let bestIndex=0;
    for(let i=1;i<open.length;i++)if(open[i].f<open[bestIndex].f)bestIndex=i;
    const cur=open.splice(bestIndex,1)[0];
    const key=cur.x+","+cur.z;
    if(closed.has(key))continue;
    closed.add(key);
    if(cur.x===gx&&cur.z===gz){best=cur;break}
    for(const [dx,dz,cost] of dirs){
      const nx=cur.x+dx,nz=cur.z+dz;
      if(nx<0||nz<0||nx>=width||nz>=height)continue;
      if(blocked[index(nx,nz)])continue;
      if(dx&&dz&&(blocked[index(cur.x+dx,cur.z)]||blocked[index(cur.x,cur.z+dz)]))continue;
      const nk=nx+","+nz;if(closed.has(nk))continue;
      const g=cur.g+cost;
      const h=Math.hypot(gx-nx,gz-nz);
      const old=nodes.get(nk);
      if(old&&old.g<=g)continue;
      const n={x:nx,z:nz,g,f:g+h,parent:cur};
      nodes.set(nk,n);open.push(n);
    }
  }
  if(!best)return [];
  const path=[];
  for(let n=best;n;n=n.parent)path.push(worldAt(n.x,n.z));
  path.reverse();
  return path;
}

class EntityManager{
  constructor(game){this.game=game;this.entities=[];this.serial=0;this.lastUpdate=0;this.modelLibrary=new EntityModelLibrary(game);this.hearingCooldown=0}
  clear(){for(const e of this.entities)this.game.scene.remove(e.group);this.entities=[];this.bacteriaSpawned=false}
  create(type,position,key=null){
    const def=ENTITY_TYPES[type];if(!def)return null;
    const group=new THREE.Group();group.position.copy(position);def.factory(group);group.userData.entityType=type;group.userData.entityLabel=def.label;
    this.game.scene.add(group);
    const e={
      key:key||"manual:"+(++this.serial),type,def,group,state:"idle",cool:0,age:0,motion:0,
      lastSeen:null,lastHeard:null,lastPlayerX:this.game.player.position.x,lastPlayerZ:this.game.player.position.z,
      stalkSeed:Math.random()*1000,waypoint:null,path:null,pathIndex:0,pathTimer:0,pathKey:"",model:null,soundTimer:1+Math.random()*3,squadId:null
    };
    this.entities.push(e);
    this.modelLibrary.attach(e).catch(()=>{});
    return e;
  }
  summon(type){
    if(!ENTITY_TYPES[type])return false;
    const p=this.game.player,angle=p.viewYaw;
    const forward=new THREE.Vector3(-Math.sin(angle),0,-Math.cos(angle));
    const side=new THREE.Vector3(-forward.z,0,forward.x);
    const pos=p.position.clone().addScaledVector(forward,Math.max(6,this.game.level.cellSize*1.8)).addScaledVector(side,((this.serial%3)-1)*3);
    pos.y=0;const e=this.create(type,pos);if(!e)return false;
    this.game.triggerFear(.12);this.game.toast("SUMMONED "+e.def.label.toUpperCase(),1.4);return true;
  }
  spawnForChunks(){
    const level0Blackout=this.game.level.id==="0";
    const pools={
      "0":["smiler","skinstealer","hound"],
      "1":["duller","hound","skinstealer","smiler","clump","crawler","wretch"],
      "2":["smiler","hound","deathmoth"],
      "3":["hound","deathmoth","skinstealer","faceling","wretch","clump","smiler","deathrat"],
      "4":["hound","duller"],
      "5":["deathmoth","hound","skinstealer","deathrat"],
      "6":[],
      "7":["leviathan","tiny"],
      "8":["crawler","deathmoth","smiler","wretch"],
      "9":["smiler","deathmoth","faceling"],
      "10":[]
    };
    for(const c of this.game.world.entitySpawns()){
      const key=(level0Blackout?"blackout:":"")+c.cx+","+c.cz;
      if(this.entities.some(e=>e.key===key||e.squadId===key))continue;
      const pool=pools[this.game.level.id]||[this.game.level.entity];
      if(!pool.length)continue;
      const rng=new RNG(c.seedKey()^0x4a91);
      const type=pool[Math.floor(rng.next()*pool.length)];
      const def=ENTITY_TYPES[type];if(!def)continue;
      const cell=this.game.level.cellSize,grid=this.game.level.gridSize||CELLS;
      const minSpawn=1,maxSpawn=Math.max(1,grid-2);
      const groupCount=this.game.level.id==="3"?(rng.next()<.28?3:2):1;
      const squadId=this.game.level.id==="3"?key:null;
      const baseX=c.originX+rng.int(minSpawn,maxSpawn)*cell+cell/2,baseZ=c.originZ+rng.int(minSpawn,maxSpawn)*cell+cell/2;
      for(let member=0;member<groupCount;member++){
        const angle=member/groupCount*Math.PI*2+rng.next()*.3,offset=groupCount>1?2.2+member*.35:0;
        const position=new THREE.Vector3(baseX+Math.cos(angle)*offset,0,baseZ+Math.sin(angle)*offset);
        const memberType=member===0?type:pool[Math.floor(rng.next()*pool.length)];
        const e=this.create(memberType,position,groupCount>1?key+":"+member:key);
        if(e){
          e.squadId=squadId;
          e.state="idle";
          if(this.game.level.id==="7"&&type==="leviathan")e.group.position.y=-.72;
          if(this.game.level.id==="7"&&type==="tiny")e.group.position.y=-.28;
        }
      }
    }
  }
  chooseStalkPoint(e,p){
    const a=e.stalkSeed+this.game.gameTime*.13,r=7+4*Math.sin(a*.73);
    const forward=new THREE.Vector3(-Math.sin(p.viewYaw),0,-Math.cos(p.viewYaw));
    const side=new THREE.Vector3(-forward.z,0,forward.x);
    return p.position.clone().addScaledVector(forward,-r).addScaledVector(side,Math.sin(a)*3);
  }
  update(dt){
    const p=this.game.player;
    this.hearingCooldown=Math.max(0,this.hearingCooldown-dt);
    for(const e of [...this.entities]){
      const dx=p.position.x-e.group.position.x,dz=p.position.z-e.group.position.z,d=Math.hypot(dx,dz)||.001;
      e.cool-=dt;e.age+=dt;e.motion=Math.max(0,e.motion-dt*2);
      const visible=entityLineOfSight(this.game,e,p),light=p.flashlight;
      const heard=entityNoise(this.game,e);
      if(visible)e.lastSeen=p.position.clone();
      if(heard)e.lastHeard=p.position.clone();
      if(this.game.level.id==="3"&&e.squadId&&(visible||heard)){
        const sharedPosition=(visible?e.lastSeen:e.lastHeard)?.clone();
        if(sharedPosition)for(const ally of this.entities){
          if(ally===e||ally.squadId!==e.squadId)continue;
          if(visible)ally.lastSeen=sharedPosition.clone();
          else if(!ally.lastSeen)ally.lastHeard=sharedPosition.clone();
        }
      }
      const target=e.lastSeen||e.lastHeard;
      if(target){
        const step=this.game.level.id==="0"?2.0:Math.max(1.5,Math.min(2.4,this.game.level.cellSize*.34));
        const pathKey=entityPathKey(e.group.position,target,step);
        if(!e.path||e.pathKey!==pathKey||e.pathTimer<=0){
          e.path=entityPathfind(this.game,e.group.position,target,step);
          e.pathIndex=1;
          e.pathKey=pathKey;
          e.pathTimer=.42+Math.random()*.22;
        }else e.pathTimer-=dt;
      }else{
        e.path=null;e.pathIndex=0;e.pathTimer=0;
      }
      if(d>72&&e.key.startsWith("manual:")){this.game.scene.remove(e.group);this.entities=this.entities.filter(x=>x!==e);continue}
      const def=e.def;
      if(this.game.level.id==="4"){
        // Level 4 is overwhelmingly quiet. Rare Hound/Duller sightings should
        // investigate briefly rather than immediately turning the office into
        // a hostile encounter.
        if(heard&&d<18)e.state="investigate";
        else if(visible&&d<9)e.state="observe";
        else e.state="idle";
      }else if(def.behavior==="light"){
        // Smilers are drawn toward light. Eye contact/slow movement keeps the
        // encounter from instantly becoming a straight-line attack.
        const eyeToEntity=new THREE.Vector3(e.group.position.x-p.position.x,0,e.group.position.z-p.position.z).normalize();
        const view=new THREE.Vector3(-Math.sin(p.viewYaw),0,-Math.cos(p.viewYaw));
        const watching=view.dot(eyeToEntity)>.35;
        if(light&&d<30)e.state=watching?"stalk":"chase";
        else if(!light&&d<20)e.state=watching?"observe":"stalk";
        else if(d>36)e.state="idle";
      }else if(def.behavior==="hunt"){
        if(visible&&d<def.range)e.state=d<12?"chase":"investigate";
        else if(heard)e.state="investigate";
        else if(d>def.range)e.state="stalk";
      }else if(def.behavior==="ambush"){
        if(visible&&d<def.range)e.state=d<8?"chase":"stalk";
        else if(heard)e.state="investigate";
        else if(d>14)e.state="stalk";
      }else if(def.behavior==="observe"){
        if(visible&&d<18)e.state="observe";else if(heard)e.state="investigate";else e.state="idle";
      }else if(def.behavior==="swarm"){
        if(visible||heard)e.state=d<12?"chase":"investigate";else e.state="idle";
      }else if(def.behavior==="frenzy"){
        if(d<def.range)e.state="chase";else if(heard)e.state="investigate";else e.state="stalk";
      }else if(def.behavior==="quiet"){
        if(heard&&d<def.range)e.state="investigate";else if(visible&&d<8)e.state="chase";else if(d>def.range)e.state="idle";
      }else if(def.behavior==="slow"){
        if(d<12&&visible)e.state="chase";else if(heard)e.state="investigate";else e.state="idle";
      }else{
        if(visible&&d<def.range)e.state=d<10?"chase":"stalk";else if(heard)e.state="investigate";else if(d>def.range)e.state="stalk";
      }

      if(e.state==="chase"&&def.behavior==="light"&&light){
        steerAroundWalls(this.game,e,new THREE.Vector3(dx,0,dz).multiplyScalar(-1),dt);
      }else if(e.state==="chase"){
        const predicted=p.position.clone();
        if(e.lastSeen)predicted.lerp(p.position,.55);
        const waypoint=e.path?.[e.pathIndex];
        if(waypoint){
          if(Math.hypot(waypoint.x-e.group.position.x,waypoint.z-e.group.position.z)<.8)e.pathIndex++;
          const next=e.path?.[e.pathIndex]||predicted;
          steerAroundWalls(this.game,e,new THREE.Vector3(next.x-e.group.position.x,0,next.z-e.group.position.z),dt);
        }else steerAroundWalls(this.game,e,predicted.sub(e.group.position),dt);
      }else if(e.state==="investigate"&&target){
        const waypoint=e.path?.[e.pathIndex];
        if(waypoint){
          if(Math.hypot(waypoint.x-e.group.position.x,waypoint.z-e.group.position.z)<.8)e.pathIndex++;
          const next=e.path?.[e.pathIndex]||target;
          steerAroundWalls(this.game,e,new THREE.Vector3(next.x-e.group.position.x,0,next.z-e.group.position.z),dt);
        }else{
          const desired=target.clone().sub(e.group.position);
          if(desired.length()>1.5)steerAroundWalls(this.game,e,desired,dt);
          else e.state="stalk";
        }
      }else if(e.state==="stalk"){
        const point=this.chooseStalkPoint(e,p),desired=point.sub(e.group.position);
        if(desired.length()>2)steerAroundWalls(this.game,e,desired,dt);
      }else if(e.state==="observe"){
        e.group.rotation.y=Math.atan2(dx,dz);e.motion=0;
      }
      if(def.behavior==="light"&&light&&d<8)this.game.triggerFear(.01);
      if(d<def.attack&&!this.game.admin?.god&&e.state==="chase"){
        this.game.die("THE "+def.label.toUpperCase()+" FOUND YOU.");continue;
      }
      if(e.state==="chase"&&e.cool<=0){this.game.triggerFear(.035);e.cool=.8}
      this.modelLibrary.update(e,dt);
      if(e.soundTimer<=0){
        const pan=Math.sin(Math.atan2(dx,dz)-p.viewYaw);
        if(e.state==="chase"||e.state==="frenzy"){
          this.game.audio.entityCue?.(e.type,e.state,d,pan);
          // Closer = more urgent cadence.
          e.soundTimer = d < 6 ? 0.9 + Math.random()*0.7 : d < 14 ? 1.6 + Math.random()*1.1 : 2.4 + Math.random()*1.8;
        }else if(e.state==="investigate"||e.state==="alert"){
          if(Math.random() < (d < 10 ? 0.7 : 0.4)) this.game.audio.entityCue?.(e.type,"alert",d,pan);
          e.soundTimer = 3.2 + Math.random()*3.5;
        }else if(e.state==="stalk" && d < 22){
          // Subtle attention cue so the player hears approach before visual contact.
          if(Math.random() < 0.55) this.game.audio.entityCue?.(e.type,"stalk",d,pan);
          e.soundTimer = 4.5 + Math.random()*5.5;
        }else{
          e.soundTimer = 6 + Math.random()*8;
        }
      }else e.soundTimer-=dt;
      animateEntity(e,dt);
      e.lastPlayerX=p.position.x;e.lastPlayerZ=p.position.z;
    }
    this.spawnForChunks();
  }
}

class AdaptiveQuality{
  constructor(game){this.game=game;this.mode=localStorage.getItem("br.quality")||"auto";this.samples=[];this.cool=0}
  maxSafePixelRatio(){
    const width=Math.max(1,innerWidth),height=Math.max(1,innerHeight);
    return Math.max(1,Math.min(1.15,this.game.renderer.capabilities.maxTextureSize/Math.max(width,height)));
  }
  limits(){
    const radius=this.game.level.id==="0"?1:2;
    if(this.mode==="low")return{pixel:1,radius};
    if(this.mode==="medium")return{pixel:1,radius};
    if(this.mode==="high")return{pixel:1.15,radius};
    return{pixel:Math.min(devicePixelRatio,1.0),radius};
  }
  apply(){
    const l=this.limits();
    const ratio=Math.min(devicePixelRatio,l.pixel,this.maxSafePixelRatio());
    const canvas=this.game.renderer.domElement;
    const width=Math.max(1,canvas.clientWidth||innerWidth);
    const height=Math.max(1,canvas.clientHeight||innerHeight);
    this.game.renderer.setPixelRatio(ratio);
    this.game.renderer.setSize(width,height,false);
    this.game.composer?.setPixelRatio(ratio);
    this.game.composer?.setSize(width,height);
    this.game.world.radius=l.radius;
  }
  update(dt){
    if(this.mode!=="auto")return;
    this.samples.push(dt*1000);if(this.samples.length>45)this.samples.shift();this.cool-=dt;if(this.cool>0)return;
    const avg=this.samples.reduce((a,b)=>a+b,0)/this.samples.length;
    const safe=this.maxSafePixelRatio();
    if(avg>28)this.game.renderer.setPixelRatio(Math.max(1,this.game.renderer.getPixelRatio()*.9));
    else if(avg<18)this.game.renderer.setPixelRatio(Math.min(1.0,safe,this.game.renderer.getPixelRatio()*1.025));
    const ratio=this.game.renderer.getPixelRatio();
    const canvas=this.game.renderer.domElement;
    const width=Math.max(1,canvas.clientWidth||innerWidth);
    const height=Math.max(1,canvas.clientHeight||innerHeight);
    this.game.renderer.setSize(width,height,false);
    this.game.composer?.setPixelRatio(ratio);
    this.game.composer?.setSize(width,height);
    this.cool=2;
  }
  set(mode){this.mode=mode;localStorage.setItem("br.quality",mode);this.apply()}
}

export class BackroomsGame{
  constructor(){
    const seedBuffer=new Int32Array(1);
    const cryptoApi=globalThis.crypto;
    if(cryptoApi?.getRandomValues)cryptoApi.getRandomValues(seedBuffer);
    this.seed=((seedBuffer[0]^Date.now())||Math.floor(Math.random()*2147483647))|0;
    this.admin={enabled:queryFlag("admin"),god:false,noclip:false};
    this.levelId="0";this.level=LEVELS["0"];this.paused=true;this.running=false;this.dead=false;this.deathSequenceActive=false;this.deathSequenceTime=0;this.deathSequenceDuration=3.35;this.introActive=true;this.introPlaying=false;this.mounted=false;this.worldReady=false;this.preloadComplete=false;this.pendingStart=false;this.gameTime=0;this.argTimer=9;this.intercomTimer=80+Math.random()*100;
    this.syncPageTitle();
    this.redZoneTimer=0;this.redZoneTrapped=false;this.redZoneId=null;this.redZoneBounds=null;
    this.redZoneFontTimer=0;
    this.redZoneAudioToken=0;
    this.redZoneAudioDuration=0;
    this.redZoneAudioStarted=false;
    this.redZoneFonts=["system-ui","ui-sans-serif","ui-monospace","ui-rounded","Arial, sans-serif","Helvetica, sans-serif","Verdana, sans-serif","Tahoma, sans-serif","Georgia, serif","Times New Roman, serif","Courier New, monospace","monospace","serif","sans-serif","cursive","fantasy"];
    this.settings={
      shake:localStorage.getItem("br.shake")!=="0",
      sensitivity:Math.max(.5,Math.min(2,Number(localStorage.getItem("br.sensitivity")||1)))
    };
    this.startFlash=localStorage.getItem("br.flash")!=="0";
    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color(0x000000);
    // Initialize fog before the first gameplay frame. The constructor starts on Level 0,
    // but setLevel() is intentionally not called during bootstrap, so update() must never
    // assume scene.fog already exists.
    this.scene.fog=new THREE.FogExp2(0x000000,.027);
    this.sky=new Sky();
    this.sky.scale.setScalar(220);
    this.sky.renderOrder=-10;
    this.sky.material.depthWrite=false;
    this.sky.material.depthTest=false;
    this.sky.visible=false;
    this.scene.add(this.sky);
    const oceanSkyMaterial=new THREE.ShaderMaterial({
      uniforms:{zenith:{value:new THREE.Color(0xa8d4f0)},horizon:{value:new THREE.Color(0xe8f4fc)},sunDirection:{value:new THREE.Vector3(.35,.75,-.4).normalize()},sunColor:{value:new THREE.Color(0xfff8e8)}},
      vertexShader:"varying vec3 vSkyDirection;void main(){vSkyDirection=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader:"varying vec3 vSkyDirection;uniform vec3 zenith;uniform vec3 horizon;uniform vec3 sunDirection;uniform vec3 sunColor;void main(){vec3 d=normalize(vSkyDirection);float h=clamp(d.y,0.0,1.0);vec3 sky=mix(horizon,zenith,pow(h,.72));float sun=max(dot(d,normalize(sunDirection)),0.0);sky+=sunColor*pow(sun,48.0)*.24;sky=mix(sky,horizon,exp(-abs(d.y)*8.0)*.18);gl_FragColor=vec4(sky,1.0);\n#include <colorspace_fragment>}",
      side:THREE.BackSide,depthWrite:false,depthTest:false,fog:false,toneMapped:false
    });
    this.oceanSky=new THREE.Mesh(new THREE.SphereGeometry(400,48,32),oceanSkyMaterial);
    this.oceanSky.renderOrder=-100;this.oceanSky.visible=false;this.oceanSky.frustumCulled=false;this.scene.add(this.oceanSky);
    const cloudMaterial=new THREE.ShaderMaterial({
      uniforms:{time:{value:0},coverage:{value:.56},opacity:{value:.55},cloudColor:{value:new THREE.Color(0xc3c8c8)}},
      vertexShader:"varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader:[
        "varying vec2 vUv;uniform float time;uniform float coverage;uniform float opacity;uniform vec3 cloudColor;",
        "float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}",
        "float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y);}",
        "float fbm(vec2 p){float v=0.0,a=.5;for(int i=0;i<4;i++){v+=noise(p)*a;p*=2.03;a*=.5;}return v;}",
        "void main(){vec2 uv=vec2(vUv.x*2.0+time*.00045,vUv.y);float n=fbm(uv*vec2(18.0,8.0));float detail=fbm(uv*vec2(39.0,17.0)+vec2(3.7,8.1));float field=mix(n,detail,.24);float cloud=smoothstep(coverage,coverage+.2,field);float horizon=smoothstep(.02,.24,vUv.y)*(1.0-smoothstep(.88,1.0,vUv.y));float alpha=cloud*opacity*horizon;gl_FragColor=vec4(cloudColor,alpha);}",
        "#include <tonemapping_fragment>",
        "#include <colorspace_fragment>"
      ].join("\n"),
      transparent:true,depthWrite:false,depthTest:false,side:THREE.BackSide,toneMapped:true
    });
    this.cloudLayer=new THREE.Mesh(new THREE.SphereGeometry(420,48,24),cloudMaterial);
    this.cloudLayer.renderOrder=-9;
    this.cloudLayer.visible=false;
    this.cloudLayer.frustumCulled=false;
    this.scene.add(this.cloudLayer);
    this.camera=new THREE.PerspectiveCamera(62,1,.05,800);this.camera.rotation.order="YXZ";
    const touchDevice=isTouchControlsDevice();
    this.renderer=new THREE.WebGLRenderer({antialias:!touchDevice,powerPreference:"high-performance",stencil:false,depth:true,precision:"highp"});
    this.renderer.setPixelRatio(1);this.renderer.setSize(Math.max(1,innerWidth),Math.max(1,innerHeight),false);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=.78;
    this.scene.environment=null;
    this.composer=new EffectComposer(this.renderer);
    this.composer.setPixelRatio(1);
    this.renderPass=new RenderPass(this.scene,this.camera);
    this.vhsPass=new ShaderPass(new THREE.ShaderMaterial({name:"Backrooms VHS",glslVersion:THREE.GLSL3,uniforms:THREE.UniformsUtils.clone(VHSShader.uniforms),vertexShader:VHSShader.vertexShader,fragmentShader:VHSShader.fragmentShader}));
    this.outputPass=new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.vhsPass);
    this.composer.addPass(this.outputPass);

    this.input=new InputManager(this);this.audio=new AudioDirector();this.player=new Player(this);this.world=new WorldStreamer(this);
    this.localLights=[];
    const localLightCount=this.level.id==="0"?(isTouchControlsDevice()?8:14):(isTouchControlsDevice()?14:24);
    for(let i=0;i<localLightCount;i++){
      const light=new THREE.PointLight(0xfff064,0,13,1);
      light.name="dynamic_fluorescent_"+i;
      light.visible=true;
      this.localLights.push(light);
      this.scene.add(light);
    }this.entityManager=new EntityManager(this);this.quality=new AdaptiveQuality(this);
    // The source Level 0 dimension has no skylight or ambient daylight. Keep
    // the base fill very low so fluorescent fixtures and the flashlight carry
    // the scene.
    this.ambient=new THREE.HemisphereLight(0x4b3b20,0x050403,.045);this.scene.add(this.ambient);
    this.daylight=new THREE.DirectionalLight(0xd8e0e4,0);this.daylight.position.set(-35,80,24);this.daylight.castShadow=false;this.scene.add(this.daylight);
    this.flashTarget=new THREE.Object3D();
    this.flashFillTarget=new THREE.Object3D();
    this.blackoutLight=new THREE.PointLight(0xffe8bd,0,2.6,2);
    this.blackoutLight.name="level0_blackout_proximity";
    this.blackoutLight.castShadow=false;
    this.scene.add(this.blackoutLight);
    // Two camera-aimed spotlights approximate a practical flashlight's
    // central hotspot and wider spill. PointLight ignores target, which made
    // the old "forward" fill omnidirectional and lit areas outside the view.
    this.flash=new THREE.SpotLight(0xfff1d5,0,25,0.55,0.82,2);
    this.flashFill=new THREE.SpotLight(0xfff1d5,0,25,0.25,0.58,2);
    this.flash.castShadow=false;
    this.flashFill.castShadow=false;
    this.flash.target=this.flashTarget;
    this.flashFill.target=this.flashFillTarget;
    this.scene.add(this.flash,this.flashFill,this.flashTarget,this.flashFillTarget);
    this.horror=0;this.scareTimer=18+Math.random()*20;this.lightState="ON";this.lightEventTimer=48+Math.random()*55;this.runtimeFaulted=false;
    this.bindUI();
    const introControls=document.getElementById("mobile-controls");
    introControls?.classList.add("hidden");
    introControls?.setAttribute("aria-hidden","true");
    introControls?.style.setProperty("display","none","important");
    addEventListener("resize",()=>this.resize());
    document.addEventListener("visibilitychange",()=>{
      if(document.hidden&&this.running&&!this.paused&&!this.dead)this.togglePause(true);
    });
    this.last=performance.now();
  }
  async mount(){
    document.getElementById("game").appendChild(this.renderer.domElement);
    this.resize();
    this.quality.apply();
    this.player.reset();
    this.mounted=true;
    this.render();
    this.last=performance.now();
    requestAnimationFrame(this.loop.bind(this));

    const boot=document.getElementById("boot");
    boot?.classList.add("intro-ready");
    this.armAudioGateFallback?.();

    try{
      const assetLoad=this.world.configure();
      await this.world.ensureAroundAsync(0,0);
      const requested=this.level.id==="0"?this.world.level0SpawnPoint():{x:0,z:0};
      const spawn=this.world.findSafeSpawn(requested.x,requested.z,.46);
      this.player.position.set(spawn.x,this.player.eyeY+this.world.walkSurfaceHeightAt(spawn.x,spawn.z),spawn.z);
      await assetLoad;
      this.scene.updateMatrixWorld(true);
      this.render();
      if(typeof this.renderer.compileAsync==="function"){
        try{await this.renderer.compileAsync(this.scene,this.camera)}
        catch(error){console.warn("[Backrooms] Shader prewarm skipped; shaders will compile on first use:",error)}
      }
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      this.worldReady=true;
      this.preloadComplete=true;
      if(this.pendingStart)this.beginIntroReveal();
    }catch(error){
      console.error("[Backrooms] World initialization failed:",error);
      this.toast("WORLD INITIALIZATION FAILED",5);
    }
  }
  bindUI(){
    const $=id=>document.getElementById(id);
    this.audioGateBusy=false;

    const begin=event=>{
      if(event?.isTrusted===false||!this.introActive)return;
      // Audio is best-effort. It must never be on the critical path for starting
      // the game because WebKit can leave AudioContext promises unresolved.
      this.audio.unlockFromGesture();
      try{
        if(this.mounted)this.beginIntroReveal();
        else this.pendingStart=true;
      }catch(error){
        console.error("[Backrooms] Startup handoff failed:",error);
        this.pendingStart=false;
        this.introActive=false;
        this.introPlaying=false;
        this.running=true;
        this.paused=false;
        this.dead=false;
        this.syncPageTitle();
        this.player.reset();
        document.getElementById("hud")?.classList.remove("hidden");
        document.getElementById("boot")?.classList.add("fade-out");
      }
    };

    const audioPage=document.querySelector(".intro-audio-page");
    const boot=document.getElementById("boot");
    const gate=$("audio-gate");
    let audioGateReady=false;
    const activateAudioGate=()=>{
      audioGateReady=true;
      audioPage?.classList.add("intro-audio-active");
    };
    if(audioPage){
      audioPage.addEventListener("animationend",event=>{
        if(event.animationName==="intro-audio-sequence")activateAudioGate();
      },{once:false});
      // CSS animation timing is fixed, but keep a JS fallback so the gate can
      // never remain untappable if animation events are lost on WebKit.
      this.armAudioGateFallback=()=>{
        clearTimeout(this.audioGateFallbackTimer);
        this.audioGateFallbackTimer=setTimeout(activateAudioGate,17000);
      };
    }
    const handleAudioGesture=event=>{
      if(!audioGateReady&&audioPage?.classList.contains("intro-audio-active"))audioGateReady=true;
      if(!this.introActive||!audioGateReady||!audioPage?.classList.contains("intro-audio-active"))return;
      if(gate&&!gate.contains(event.target)&&!audioPage?.contains(event.target))return;
      event.stopPropagation();
      begin(event);
    };
    // Use click as the authoritative activation event. WebKit has had multiple
    // touch/pointer compatibility bugs, while click is the browser's canonical
    // user activation event for a tap.
    gate?.addEventListener("click",handleAudioGesture);
    boot?.addEventListener("click",handleAudioGesture,{capture:true});
    gate?.addEventListener("keydown",event=>{
      if(event.key==="Enter"||event.key===" "){
        event.preventDefault();
        begin(event);
      }
    });

    // Native click is the authoritative activation path for menu controls.
    // iOS Safari/WebKit has changed pointer/click synthesis across releases, so
    // do not gate click handling on PointerEvent.pointerType or require pointerup.
    const bindUiButton=(element,handler)=>{
      if(!element)return;
      element.type==="button"&&(element.type="button");
      element.addEventListener("click",event=>{
        event.preventDefault();
        event.stopPropagation();
        handler(event);
      });
    };
    bindUiButton($("resume"),()=>this.togglePause(false));
    bindUiButton($("restart"),()=>this.restart());
    bindUiButton($("retry"),()=>this.restart());
    bindUiButton($("again-ending"),()=>this.restart());
    bindUiButton($("fullscreen"),()=>this.toggleFullscreen());
    bindUiButton($("fullscreen-settings"),()=>this.toggleFullscreen());
    this.updateFullscreenLabels=()=>{
      const label=document.fullscreenElement?"Exit Fullscreen":"Enter Fullscreen";
      const main=$("fullscreen"),settings=$("fullscreen-settings");
      if(main)main.textContent=label;
      if(settings)settings.textContent=label;
    };
    this.wasFullscreen=!!document.fullscreenElement;
    document.addEventListener("fullscreenchange",()=>{
      const active=!!document.fullscreenElement;
      if(this.wasFullscreen&&!active){
        navigator.keyboard?.unlock?.();
        if(this.running&&!this.paused&&!this.dead&&!this.introPlaying)this.togglePause(true);
      }
      this.wasFullscreen=active;
      this.updateFullscreenLabels();
    });
    this.updateFullscreenLabels();

    const pauseTabNames={settings:["SETTINGS","SETTINGS"],controls:["CONTROLS","HOW TO PLAY"]};
    this.pauseTabState=tab=>{
      const target=tab==="settings"||tab==="controls"?tab:"game";
      document.querySelectorAll("[data-pause-tab]").forEach(button=>button.classList.toggle("active",(button.dataset.pauseTab||"game")===target));
      document.querySelectorAll("[data-pause-panel]").forEach(panel=>panel.classList.toggle("active",(panel.dataset.pausePanel||"game")===target));
      const meta=pauseTabNames[target]||["GAME","THE RECORDING IS PAUSED"];
      const kicker=$("pause-panel-kicker"),title=$("pause-panel-title");
      if(kicker)kicker.textContent=meta[0];
      if(title)title.textContent=meta[1];
    };
    document.querySelectorAll("[data-pause-tab]").forEach(button=>bindUiButton(button,()=>this.pauseTabState(button.dataset.pauseTab)));
    document.querySelectorAll("[data-settings-tab]").forEach(button=>bindUiButton(button,()=>{
      const tab=button.dataset.settingsTab;
      document.querySelectorAll("[data-settings-tab]").forEach(x=>x.classList.toggle("active",x===button));
      document.querySelectorAll("[data-settings-panel]").forEach(x=>x.classList.toggle("active",x.dataset.settingsPanel===tab));
    }));

    const quality=$("quality");
    if(quality){quality.value=this.quality.mode;quality.onchange=e=>this.quality.set(e.target.value)}
    const volume=$("volume");
    if(volume){
      volume.value=String(this.audio.volume);
      volume.oninput=e=>{
        this.audio.setVolume(e.target.value);
        const value=volume.closest(".pause-setting")?.querySelector("b");
        if(value)value.textContent=Math.round(Number(e.target.value)*100)+"%";
      };
    }
    const shake=$("shake");
    if(shake){shake.checked=this.settings.shake;shake.onchange=e=>{this.settings.shake=e.target.checked;localStorage.setItem("br.shake",e.target.checked?"1":"0")}}
    const flashlight=$("flashlight");
    if(flashlight){flashlight.checked=this.startFlash;flashlight.onchange=e=>{this.startFlash=e.target.checked;localStorage.setItem("br.flash",e.target.checked?"1":"0")}}
    const sensitivity=$("sensitivity");
    if(sensitivity){
      sensitivity.value=String(this.settings.sensitivity);
      sensitivity.oninput=e=>{
        this.settings.sensitivity=Math.max(.5,Math.min(2,Number(e.target.value)));
        localStorage.setItem("br.sensitivity",String(this.settings.sensitivity));
        const value=sensitivity.closest(".pause-setting")?.querySelector("b");
        if(value)value.textContent=this.settings.sensitivity.toFixed(2);
      };
    }
  }
  beginIntroReveal(){
    if(!this.introActive||!this.mounted)return;
    if(!this.worldReady){this.pendingStart=true;return;}
    this.introActive=false;
    this.introPlaying=false;
    this.pendingStart=false;
    this.running=true;
    this.paused=false;
    this.dead=false;
    this.syncPageTitle();
    this.player.reset();
    this.vhsPass.uniforms.intensity.value=.72;
    this.vhsPass.uniforms.tracking.value=.28;
    this.vhsPass.uniforms.fear.value=0;
    document.getElementById("hud")?.classList.remove("hidden");
    const mobileControls=document.getElementById("mobile-controls");
    if(this.isTouchLayout()){
      mobileControls?.classList.remove("hidden");
      mobileControls?.setAttribute("aria-hidden","false");
      mobileControls?.style.removeProperty("display");
      requestAnimationFrame(()=>mobileControls?.classList.add("mobile-controls-ready"));
    }else{
      mobileControls?.classList.add("hidden");
      mobileControls?.classList.remove("mobile-controls-ready");
      mobileControls?.setAttribute("aria-hidden","true");
      mobileControls?.style.setProperty("display","none","important");
    }
    const boot=document.getElementById("boot");
    const audioPage=document.querySelector(".intro-audio-page");
    if(audioPage){
      audioPage.style.pointerEvents="none";
      audioPage.setAttribute("aria-hidden","true");
    }
    if(boot){
      // The audio-gate click is the final user gesture for startup. Remove the
      // cinematic overlay synchronously so the renderer and gameplay input are
      // never left underneath a transparent or fading DOM layer.
      boot.classList.add("fade-out");
      boot.style.pointerEvents="none";
      boot.style.visibility="hidden";
      boot.style.display="none";
      boot.setAttribute("aria-hidden","true");
    }
    this.render();
    this.toast(this.level.objective,3);
    if(this.admin?.enabled){
      window.dispatchEvent(new CustomEvent("backrooms:game-ready"));
    }
  }

  isTouchLayout(){return isTouchControlsDevice()}
  start(){if(this.mounted)this.beginIntroReveal();else this.pendingStart=true}
  restart(){
    document.getElementById("death").classList.add("hidden");document.getElementById("ending").classList.add("hidden");document.getElementById("pause").classList.add("hidden");
    this.seed=(Math.random()*2147483647)|0;this.levelId="0";this.setLevel("0");this.player.reset();this.world.ensureAround(0,0);const requested=this.world.level0SpawnPoint(),spawn=this.world.findSafeSpawn(requested.x,requested.z,.46);this.player.position.set(spawn.x,this.player.eyeY,spawn.z);
    this.running=true;this.paused=false;this.dead=false;this.deathSequenceActive=false;this.deathSequenceTime=0;this.introActive=false;this.syncPageTitle();document.getElementById("hud").classList.remove("hidden");
    const mobileControls=document.getElementById("mobile-controls");
    if(this.isTouchLayout()){
      mobileControls?.classList.remove("hidden");
      mobileControls?.setAttribute("aria-hidden","false");
      requestAnimationFrame(()=>mobileControls?.classList.add("mobile-controls-ready"));
    }else{
      mobileControls?.classList.add("hidden");
      mobileControls?.classList.remove("mobile-controls-ready");
      mobileControls?.setAttribute("aria-hidden","true");
    }
    this.toast(this.level.objective,2.4);
  }
  resizeLocalLightPool(){
    const touch=isTouchControlsDevice();
    const desired=this.level.id==="4"?(touch?14:24):this.level.id==="0"?(touch?8:14):(touch?14:24);
    while(this.localLights.length<desired){
      const light=new THREE.PointLight(0xffffff,0,0,2);
      light.name="dynamic_fluorescent_"+this.localLights.length;
      this.localLights.push(light);
      this.scene.add(light);
    }
    while(this.localLights.length>desired){
      const light=this.localLights.pop();
      this.scene.remove(light);
    }
  }
  setLevel(id,options={}){
    this.levelId=String(id);this.level=levelById(id);this.resizeLocalLightPool();this.lightState="ON";this.lightEventTimer=48+Math.random()*55;this.redZoneTimer=0;this.redZoneTrapped=false;this.redZoneId=null;this.redZoneBounds=null;this.redZoneFontTimer=0;this.redZoneAudioToken++;this.redZoneAudioDuration=0;this.redZoneAudioStarted=false;this.audio.stopRedZone();this.world.forceLevel0AllRed=false;this.world.forceLevel0Zone=null;this.world.forceLevel0ManilaRoom=options.manilaRoom?{...options.manilaRoom}:null;this.intercomTimer=80+Math.random()*100;
    this.scene.background=new THREE.Color(this.level.theme.fog??0x000000);
    this.scene.fog=this.level.id==="4"?null:new THREE.FogExp2(this.level.theme.fog??0x000000,this.level.fogDensity??(this.level.id==="0"?.014:this.level.id==="1"?.024:.038));
    this.ambient.color.setHex(this.level.theme.ambient);this.ambient.groundColor.setHex(this.level.id==="10"?0x9a9678:this.level.id==="7"?0x8ab0c0:this.level.id==="4"?0x7d898b:this.level.id==="37"?0xb8c8c4:0x080704);this.ambient.intensity=this.level.id==="7"||this.level.id==="10"?Math.max(this.level.ambientIntensity??.85,1.05):this.level.id==="37"?Math.max(this.level.ambientIntensity??.9,.95):(this.level.ambientIntensity??(this.level.id==="1"?.026:this.level.id==="0"?.044:.052));
    const openSky=["7","9","10"].includes(this.level.id);
    // L7 and L10 use the Preetham atmospheric sky. L9 remains an intentional
    // nocturnal, foggy outdoor environment.
    this.sky.visible=openSky;
    this.oceanSky.visible=false;
    this.cloudLayer.visible=openSky;
    this.scene.background=new THREE.Color(this.level.id==="7"?0x8bc3e8:this.level.id==="10"?0xc3d2de:this.level.id==="37"?0xd8e8e4:(this.level.theme.fog??0x000000));
    this.cloudLayer.material.uniforms.coverage.value=this.level.id==="7"?.50:this.level.id==="10"?.43:.63;
    this.cloudLayer.material.uniforms.opacity.value=this.level.id==="7"?.42:this.level.id==="10"?.48:.42;
    this.cloudLayer.material.uniforms.cloudColor.value.setHex(this.level.id==="7"?0xf1f6fa:this.level.id==="10"?0xe0e5e8:0x343e4b);
    const skyUniforms=this.sky.material.uniforms;
    skyUniforms.turbidity.value=this.level.id==="10"?8.5:this.level.id==="9"?11:4.2;
    skyUniforms.rayleigh.value=this.level.id==="10"?1.35:this.level.id==="9"?.22:2.6;
    skyUniforms.mieCoefficient.value=this.level.id==="10"?.009:this.level.id==="9"?.012:.0045;
    skyUniforms.mieDirectionalG.value=this.level.id==="10"?.78:.76;
    const sunY=this.level.id==="9"?-.18:this.level.id==="10"?.48:.68;
    skyUniforms.sunPosition.value.set(-.32,sunY,-.74).normalize();
    this.daylight.color.setHex(this.level.id==="10"?0xfff6e8:this.level.id==="9"?0x8499bd:this.level.id==="7"?0xd5eaff:0xe4edf0);
    this.daylight.position.set(-35,this.level.id==="9"?-18:this.level.id==="7"?34:88,24);
    this.daylight.intensity=this.level.id==="10"?1.55:this.level.id==="7"?1.65:this.level.id==="9"?.035:0;
    this.renderer.toneMappingExposure=["7","10"].includes(this.level.id)?1.35:this.level.id==="9"?.95:.78;
    this.audio.setLevel?.(this.level.id);
    const flashlightColor=this.level.id==="2"?0xd9d7ff:0xfff1d5;
    this.flash.color.setHex(flashlightColor);this.flashFill.color.setHex(flashlightColor);const worldLoad=this.world.configure();
    if(this.world.ceilingSurface)this.world.ceilingSurface.visible=!LEVELS_WITHOUT_GLOBAL_CEILING.has(String(this.level.id));
    this.world.ensureAround(this.player.position.x,this.player.position.z);this.entityManager.clear();
    const levelNumber=document.getElementById("level-number");if(levelNumber)levelNumber.textContent=this.level.number;
    const levelName=document.getElementById("level-name");if(levelName)levelName.textContent=this.level.name;
    const objective=document.getElementById("objective");if(objective)objective.textContent=this.level.objective;
    const mobileControls=document.getElementById("mobile-controls");
    mobileControls?.classList.toggle("level-seven",this.level.id==="7");
    this.player.velocity.set(0,0,0);this.player.verticalVelocity=0;this.player.inOcean=false;
    const pauseLevel=document.getElementById("pause-level");if(pauseLevel)pauseLevel.textContent=this.level.number;
    this.syncPageTitle();
    return worldLoad;
  }
  syncPageTitle(){
    const title=this.running&&!this.introActive?"The Backrooms: Level "+this.level.id:"The Backrooms";
    if(document.title!==title)document.title=title;
  }
  changeLevel(id){
    if(!id){this.ending();return}
    this.audio.exit();
    this.setLevel(id);
    this.player.parkingFloor=0;
    if(String(id)==="1"){
      this.player.position.set(0,this.player.eyeY,0);
    }else{
      this.player.position.set(0,this.player.eyeY,0);
    }
    this.world.ensureAround(this.player.position.x,this.player.position.z);
    const spawn=this.world.findSafeSpawn(this.player.position.x,this.player.position.z,.46);
    this.player.position.set(spawn.x,this.player.eyeY+this.world.walkSurfaceHeightAt(spawn.x,spawn.z),spawn.z);
    if(this.world.ceilingSurface)this.world.ceilingSurface.visible=!LEVELS_WITHOUT_GLOBAL_CEILING.has(String(this.level.id));
    this.toast("You slipped into "+this.level.number+".",3);
  }
  reachExit(){if(this.level.next)this.changeLevel(this.level.next);else this.ending()}
  ending(){this.paused=true;this.running=false;this.syncPageTitle();document.getElementById("hud").classList.add("hidden");document.getElementById("ending").classList.remove("hidden");document.exitPointerLock?.()}
  die(copy){
    // Horror death sequence: jumpscare + analog tape death, no generic text menu.
    if(this.dead||this.deathSequenceActive)return;
    this.deathSequenceActive=true;
    this.deathSequenceTime=0;
    this.deathSequenceDuration=3.35;
    this.lightState="BLACKOUT";
    this.dead=true;
    // Keep running=true so update() still advances the sequence and can respawn.
    // paused stays false for the same reason; player input is ignored while dead.
    this.paused=false;
    this.running=true;
    this.triggerFear(1);
    document.getElementById("hud")?.classList.add("hidden");
    document.getElementById("death")?.classList.add("hidden"); // never show the old text panel
    document.exitPointerLock?.();
    this.audio.scare();
    // Stage a bacteria jumpscare in front of the camera when possible.
    try{
      const entities=this.entityManager?.entities||[];
      let best=null,bestD=1e9;
      for(const e of entities){
        if(!e.group)continue;
        if(e.type!=="bacteria"&&e.type!=="hound"&&e.type!=="skinstealer")continue;
        const d=e.group.position.distanceTo(this.player.position);
        if(d<bestD){bestD=d;best=e}
      }
      if(best){
        const yaw=this.player.yaw||0;
        const dist=1.15;
        best.group.position.set(
          this.player.position.x-Math.sin(yaw)*dist,
          0,
          this.player.position.z-Math.cos(yaw)*dist
        );
        best.group.rotation.y=yaw+Math.PI;
        best.state="frenzy";
        if(this.entityManager?.modelLibrary){
          // Drive JUMPSCARE clip if present
          this.entityManager.modelLibrary.play?.(best,["JUMPSCARE","jumpscare","attack","frenzy"]);
          this.entityManager.modelLibrary.update(best,0);
        }
      }
    }catch(err){console.warn("[Backrooms] death jumpscare prep failed",err)}
    // Spike VHS hard for the tape-end feel.
    if(this.vhsPass){
      this.vhsPass.uniforms.intensity.value=1.55;
      this.vhsPass.uniforms.tracking.value=1.25;
      this.vhsPass.uniforms.fear.value=1;
    }
  }
  togglePause(force){
    if(!this.running||this.dead||this.introPlaying)return;
    this.paused=force!==undefined?force:!this.paused;
    const pause=document.getElementById("pause");
    pause?.classList.toggle("hidden",!this.paused);
    const pauseLevel=document.getElementById("pause-level");
    if(pauseLevel)pauseLevel.textContent=this.level.number;
    const pauseStatusLevel=document.getElementById("pause-status-level");
    if(pauseStatusLevel)pauseStatusLevel.textContent=this.level.number;
    const pauseFooterLevel=document.getElementById("pause-footer-level");
    if(pauseFooterLevel)pauseFooterLevel.textContent=String(this.level.number).replace(/^LEVEL\s*/i,"");
    const pauseObjective=document.getElementById("pause-status-objective");
    if(pauseObjective)pauseObjective.textContent=this.level.objective;
    this.pauseTabState?.("game");
    const mobile=document.getElementById("mobile-controls");
    mobile?.classList.toggle("paused",this.paused);
    mobile?.classList.toggle("hidden",this.paused);
    mobile?.setAttribute("aria-hidden",this.paused?"true":"false");
    if(this.paused){
      document.exitPointerLock?.();
    }else{
      this.audio.resume().catch(()=>{});
      const lock=this.renderer.domElement.requestPointerLock?.();
      lock?.catch(()=>{});
    }
  }
  async toggleFullscreen(){
    try{
      if(document.fullscreenElement){
        navigator.keyboard?.unlock?.();
        await document.exitFullscreen();
        return;
      }
      const options={navigationUI:"hide"};
      if(navigator.keyboard?.lock)options.keyboardLock="browser";
      await document.documentElement.requestFullscreen?.(options);
    }catch(error){
      console.warn("[Backrooms] Fullscreen unavailable:",error);
    }
  }
  toggleFlashlight(){
    if(!this.player.flashlight&&this.player.flashBattery<=0){this.audio.click();this.toast("BATTERY EMPTY",1.1);return}
    this.player.flashlight=!this.player.flashlight;
    this.audio.click();
    this.toast(this.player.flashlight?"Flashlight on":"Flashlight off",.9);
  }
  isDark(){if(this.level.id==="2")return true;if(this.lightState==="BLACKOUT")return true;return !this.player.flashlight}
  triggerFear(amount=.25){this.horror=Math.max(this.horror,Math.max(0,Math.min(1,amount)));this.player.shake=Math.min(.055,this.player.shake+amount*.07)}
  updateRedZone(dt){
    const bar=document.getElementById("zone-actionbar");
    const resetBar=()=>{
      if(bar){bar.classList.add("hidden","loading");bar.classList.remove("warning","trapped");bar.style.fontFamily="";bar.style.animationDuration="";}
    };

    if(this.level.id!=="0"){
      this.redZoneTimer=0;this.redZoneTrapped=false;this.redZoneId=null;this.redZoneBounds=null;
      this.redZoneAudioDuration=0;this.redZoneAudioStarted=false;this.redZoneAudioToken++;
      this.audio.stopRedZone();
      resetBar();
      return;
    }

    const chunk=this.world.chunkAt(this.player.position.x,this.player.position.z);
    const region=chunk?.level0Region;
    const inRed=region?.type==="red";
    const id=region?.id||null;

    if(!inRed&&!this.redZoneTrapped){
      this.redZoneTimer=0;this.redZoneId=null;this.redZoneBounds=null;
      this.redZoneAudioDuration=0;this.redZoneAudioStarted=false;this.redZoneAudioToken++;
      this.audio.stopRedZone();
      resetBar();
      return;
    }

    if(inRed&&this.redZoneId!==id&&!this.redZoneTrapped){
      this.redZoneId=id;
      this.redZoneTimer=30;
      this.redZoneFontTimer=0;
      this.redZoneAudioDuration=0;
      this.redZoneAudioStarted=false;
      this.audio.startRedZoneClock();
      const token=++this.redZoneAudioToken;

      const parts=String(id).split(":");
      const mx=Number(parts[1]),mz=Number(parts[2]);
      const size=this.world.size||80;
      if(id==="red:global"){
        this.redZoneBounds={minX:-Infinity,maxX:Infinity,minZ:-Infinity,maxZ:Infinity};
      }else{
        const minCx=mx*LEVEL0_REGION_CHUNKS+3,maxCx=minCx+LEVEL0_RED_SIZE-1;
        const minCz=mz*LEVEL0_REGION_CHUNKS+3,maxCz=minCz+LEVEL0_RED_SIZE-1;
        this.redZoneBounds={
          minX:minCx*size-size/2+.55,
          maxX:(maxCx+1)*size-size/2-.55,
          minZ:minCz*size-size/2+.55,
          maxZ:(maxCz+1)*size-size/2-.55
        };
      }
      this.triggerFear(.18);

      if(bar){
        bar.textContent="RED ZONE\nMOST DANGEROUS AREA\nLEAVE IN 30.0s";
        bar.classList.remove("hidden","warning","trapped","loading");
        bar.classList.add("warning");
      }

      // Metadata-only duration lookup is fast. The actual OGG decode happens
      // in parallel for playback and does not hold the visible countdown.
      this.audio.getRedZoneMetadata().then(duration=>{
        if(token!==this.redZoneAudioToken||this.redZoneTrapped||!duration)return;
        this.redZoneAudioDuration=duration;
        this.redZoneAudioStarted=true;
      }).catch(error=>console.warn("[Backrooms] Red Zone metadata failed:",error));

      this.audio.playRedZone().then(info=>{
        if(token!==this.redZoneAudioToken||this.redZoneTrapped||!info)return;
        this.redZoneAudioDuration=info.duration;
        this.redZoneAudioStarted=true;
      }).catch(error=>console.warn("[Backrooms] Red Zone sound failed:",error));
    }

    if(this.redZoneTrapped){
      if(bar){
        bar.textContent="RED ZONE\nTRAPPED FOREVER";
        bar.classList.remove("hidden","warning","loading");
        bar.classList.add("trapped");
        bar.style.setProperty("--rz-amp","4px");
        bar.style.animationDuration=".055s";
        this.redZoneFontTimer-=dt;
        if(this.redZoneFontTimer<=0){
          this.redZoneFontTimer=.5;
          const fonts=this.redZoneFonts||["system-ui","sans-serif"];
          bar.style.fontFamily=fonts[Math.floor(Math.random()*fonts.length)];
        }
      }
      return;
    }

    if(!this.redZoneAudioStarted||this.redZoneAudioDuration<=0){
      // Keep the actionbar live while the audio buffer finishes decoding.
      // Duration metadata already lets the countdown run without waiting for decode.
      if(bar){
        bar.textContent="RED ZONE\nMOST DANGEROUS AREA\nLEAVE IN 30.0s";
        bar.classList.remove("hidden","trapped","loading");
        bar.classList.add("warning");
      }
      return;
    }

    const elapsed=this.audio.redZoneElapsed();
    try{window.__backroomsDebug?.setState?.({redZoneTimer:this.redZoneTimer,redZoneElapsed:elapsed,redZoneDuration:this.redZoneAudioDuration,redZoneStarted:this.redZoneAudioStarted,audioContext:this.audio.ctx?.state||"none"})}catch{}
    const progress=Math.max(0,Math.min(1,elapsed/this.redZoneAudioDuration));
    // Nonlinear timing: the displayed 30-second clock moves slowly at first
    // and accelerates toward zero, while still landing exactly on 0 when audio ends.
    const curve=Math.pow(progress,2.15);
    this.redZoneTimer=Math.max(0,30*(1-curve));

    if(this.redZoneTimer<=.001||progress>=1){
      this.redZoneTimer=0;
      this.redZoneTrapped=true;
      this.redZoneAudioDuration=0;
      this.redZoneAudioStarted=false;
      this.audio.stopRedZone();
      this.triggerFear(.8);
      this.audio.ambientSting(.12);
      this.world.setLevel0AllRed(true);
      this.redZoneBounds={minX:-Infinity,maxX:Infinity,minZ:-Infinity,maxZ:Infinity};
      if(bar){
        bar.textContent="RED ZONE\nTRAPPED FOREVER";
        bar.classList.remove("hidden","warning","loading");
        bar.classList.add("trapped");
      }
      return;
    }

    if(bar){
      const seconds=this.redZoneTimer.toFixed(1);
      const danger=1-Math.max(0,Math.min(1,this.redZoneTimer/30));
      const amp=1.05+danger*3.35;
      const speed=Math.max(.045,.34-danger*.295);
      bar.textContent="RED ZONE\nMOST DANGEROUS AREA\nLEAVE IN "+seconds+"s";
      bar.classList.remove("hidden","trapped","loading");
      bar.classList.add("warning");
      bar.style.setProperty("--rz-amp",amp.toFixed(2)+"px");
      bar.style.animationDuration=speed.toFixed(3)+"s";
      this.redZoneFontTimer-=dt;
      if(this.redZoneFontTimer<=0){
        this.redZoneFontTimer=.5;
        const fonts=this.redZoneFonts||["system-ui","sans-serif"];
        bar.style.fontFamily=fonts[Math.floor(Math.random()*fonts.length)];
      }
    }
  }
  updateLightEvent(dt){
    if(!this.running||this.paused||this.dead)return;
    this.lightEventTimer-=dt;
    if(this.lightState!=="ON"){
      if(this.lightEventTimer<=0){
        this.lightState="ON";
        this.lightEventTimer=this.level.id==="1"?50+Math.random()*30:42+Math.random()*45;
      }
      return;
    }
    if(this.lightEventTimer>0)return;
    if((this.level.id==="0"&&Math.random()<.42)||(this.level.id==="1"&&Math.random()<.34)){
      this.lightState="BLACKOUT";
      // Short unstable-ballast outages, not multi-minute total darkness.
      this.lightEventTimer=this.level.id==="0"?1.2+Math.random()*2.2:30;
      this.audio.lightsOut();
      this.triggerFear(this.level.id==="1"?.38:.48);
    }else{
      this.lightState="FLICKER";
      this.lightEventTimer=this.level.id==="1"?10:2.8+Math.random()*3.2;
      this.audio.flicker();
      this.triggerFear(this.level.id==="1"?.20:.16);
    }
  }
  updateHorror(dt){
    this.horror=Math.max(0,this.horror-dt*.18);
    if(this.running&&!this.paused&&this.level.id==="0"&&this.lightState!=="BLACKOUT"){
      this.intercomTimer-=dt;
      if(this.intercomTimer<=0){
        this.intercomTimer=110+Math.random()*170;
        if(Math.random()<.72){this.audio.intercom();this.triggerFear(.08);}
      }
    }
    document.documentElement.style.setProperty("--fear",this.horror.toFixed(3));
    document.body.classList.toggle("fear",this.horror>.08);
    if(!this.running||this.paused||this.dead||this.scareTimer>0)return;
    this.scareTimer=this.level.id==="0"?52+Math.random()*54:26+Math.random()*42;
    if(this.level.id==="0"&&this.lightState==="BLACKOUT")return;
    if(this.level.id==="0"){
      const roll=Math.random();
      if(roll<.60){
        this.audio.distantKnock((Math.random()<.5?-1:1)*(.9+Math.random()*1.2));
        this.triggerFear(.14);
      }else if(roll<.82){
        this.audio.ambientSting(.045+Math.random()*.045);
        this.triggerFear(.07);
      }
    }else if(this.level.id!=="6"){
      if(Math.random()<.55){this.audio.distantKnock((Math.random()<.5?-1:1)*(.85+Math.random()*1.1));this.triggerFear(this.level.id==="2"?.30:.16)}
      else if(Math.random()<.35){this.audio.ambientSting(.065+Math.random()*.065);this.triggerFear(.10)}
    }
  }
  toast(text,duration=2){
    const el=document.getElementById("toast");el.textContent=text;el.classList.remove("hidden");clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>el.classList.add("hidden"),duration*1000)
  }
  collectBatteryPickups(){
    const p=this.player.position;
    for(const chunk of this.world.chunks.values()){
      for(let i=chunk.batteries.length-1;i>=0;i--){
        const pickup=chunk.batteries[i];
        const d=Math.hypot(p.x-pickup.group.position.x,p.z-pickup.group.position.z);
        pickup.group.rotation.y+=THREE.MathUtils.degToRad(1.5);
        pickup.group.position.y=.22+Math.sin(this.gameTime*2.5+i)*.025;
        if(d<1.05&&this.player.flashBattery<100){
          const before=this.player.flashBattery;
          this.player.flashBattery=Math.min(100,this.player.flashBattery+pickup.amount);
          const added=Math.round(this.player.flashBattery-before);
          this.audio.pickup();
          this.toast("BATTERY +"+added+"%",1.2);
          this.scene.remove(pickup.group);
          pickup.group.clear();
          chunk.batteries.splice(i,1);
        }
      }
    }
  }

  updateLocalLights(){
    this.camera.updateMatrixWorld();
    const lightFrustum=this._lightFrustum||(this._lightFrustum=new THREE.Frustum());
    const frustumMatrix=this._lightFrustumMatrix||(this._lightFrustumMatrix=new THREE.Matrix4());
    frustumMatrix.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse);
    lightFrustum.setFromProjectionMatrix(frustumMatrix);
    const currentChunk=this.world.chunkAt(this.player.position.x,this.player.position.z);
    const insideBlackout=this.level.id==="0"&&currentChunk?.level0Blackout===true;
    if(insideBlackout|| (this.level.id==="0"&&this.lightState==="BLACKOUT")){
      for(const light of this.localLights){light.intensity=0;light.visible=false}
      return;
    }
    const sources=this.world.nearbyLightSources(this.player.position.x,this.player.position.z,lightFrustum);
    const next=sources.slice(0,this.localLights.length);
    for(let i=0;i<this.localLights.length;i++){
      const target=this.localLights[i],entry=next[i];
      if(!entry){
        target.intensity=0;
        target.visible=false;
        continue;
      }
      const source=entry.light;
      target.visible=true;
      target.position.copy(source.position);
      target.color.setHex(source.color);
      target.distance=source.distance;
      target.decay=source.decay;
      const blackout=this.level.id==="0"&&this.lightState==="BLACKOUT";
      if(blackout){
        target.intensity=0;
        continue;
      }
      target.intensity=source.intensity*(this.level.id==="0"?18:4);
    }
  }
  updateIntro(dt){
    this.introTime+=dt;
    const t=this.introTime;
    const duration=7.2;
    const p=Math.max(0,Math.min(1,t/duration));
    const ease=p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;
    const drift=Math.sin(t*.58)*.018;
    const x=this.player.position.x+Math.sin(this.player.yaw+.12)*drift;
    const z=this.player.position.z+4.5*(1-ease);
    this.camera.position.set(x,this.player.eyeY+1.15*(1-ease)+Math.sin(t*1.15)*.008,z);
    this.camera.rotation.set(-.025*(1-ease),.06*(1-ease)+Math.sin(t*.47)*.002,Math.sin(t*.73)*.001,"YXZ");
    this.vhsPass.uniforms.time.value=this.gameTime;
    this.vhsPass.uniforms.intensity.value=1.1-ease*.42;
    this.vhsPass.uniforms.tracking.value=.85-ease*.55;

    const line=document.getElementById("intro-line");
    const sub=document.getElementById("intro-sub");
    if(t<1.7){
      if(line)line.textContent="REC 01 // SIGNAL ACQUIRED";
      if(sub)sub.textContent="No GPS fix";
    }else if(t<3.6){
      if(line)line.textContent="LOCATION // UNKNOWN";
      if(sub)sub.textContent="Structure does not match source records";
    }else if(t<5.5){
      if(line)line.textContent="LEVEL 0 // THE LOBBY";
      if(sub)sub.textContent="Yellow wallpaper. Damp carpet. Fluorescent hum.";
    }else{
      if(line)line.textContent="KEEP MOVING";
      if(sub)sub.textContent="Familiar spaces are not necessarily safe.";
    }

    if(t>=duration){
      this.introPlaying=false;
      this.running=true;this.paused=false;this.dead=false;
      this.syncPageTitle();
      document.getElementById("hud").classList.remove("hidden");
      const mobileControls=document.getElementById("mobile-controls");
      if(this.isTouchLayout()){
        mobileControls?.classList.remove("hidden");
        mobileControls?.setAttribute("aria-hidden","false");
        requestAnimationFrame(()=>mobileControls?.classList.add("mobile-controls-ready"));
      }
      document.getElementById("boot").classList.add("fade-out");
        this.vhsPass.uniforms.intensity.value=.72;
      this.vhsPass.uniforms.tracking.value=.28;
      this.toast(this.level.objective,3);
    }
  }

  update(dt){
    this.gameTime+=dt;this.argTimer-=dt;this.scareTimer-=dt;
    // Death sequence: analog tape end then soft respawn. No text death menu.
    if(this.deathSequenceActive){
      this.deathSequenceTime+=dt;
      const t=this.deathSequenceTime;
      const d=this.deathSequenceDuration||3.35;
      const u=Math.min(1,t/d);
      if(this.vhsPass){
        this.vhsPass.uniforms.time.value=this.gameTime;
        this.vhsPass.uniforms.intensity.value=1.55+Math.sin(t*18)*0.18+u*0.35;
        this.vhsPass.uniforms.tracking.value=1.1+Math.sin(t*9.5)*0.35+u*0.55;
        this.vhsPass.uniforms.fear.value=1;
      }
      // Keep entities updating so the jumpscare clip can finish posing.
      try{this.entityManager?.update?.(dt)}catch(_){}
      if(t>=d){
        this.deathSequenceActive=false;
        this.deathSequenceTime=0;
        if(this.vhsPass){
          this.vhsPass.uniforms.intensity.value=.72;
          this.vhsPass.uniforms.tracking.value=.28;
          this.vhsPass.uniforms.fear.value=0;
        }
        this.restart();
      }
      return;
    }
    this.vhsPass.uniforms.time.value=this.gameTime;
    this.vhsPass.uniforms.fear.value=this.horror;
    this.player.update(dt);this.world.update(dt);this.updateRedZone(dt);this.collectBatteryPickups();this.updateLocalLights();this.entityManager.update(dt);this.quality.update(dt);
    if(this.level.id==="0"){
      const zoneChunk=this.world.chunkAt(this.player.position.x,this.player.position.z);
      const zone=zoneChunk?.level0Region?.type||"maze";
      const blackout=zone==="blackout";
      const red=zone==="red"||this.redZoneTrapped;
      // Red Rooms are a physical Level 0 sub-section. After the escape timer
      // expires, the game intentionally converts all of Level 0 into the red state.
      this.ambient.color.setHex(red?0x4a0808:this.level.theme.ambient);
      this.ambient.intensity=blackout&&!this.redZoneTrapped?.010:red?.020:.020;
      this.scene.fog.density=blackout&&!this.redZoneTrapped?.036:red?.031:.027;
      this.scene.fog.color.setHex(blackout&&!this.redZoneTrapped?0x000000:red?0x240000:0x000000);
      document.documentElement.style.setProperty("--level0-zone",zone);
    }
    this.updateArgLayer(dt);
    this.updateLightEvent(dt);
    this.updateHorror(dt);
    const c=this.world.chunkAt(this.player.position.x,this.player.position.z);
    const coords=document.getElementById("coords");if(coords)coords.textContent=(c?c.cx:0)+" : "+(c?c.cz:0);
    for(const [id,value] of [
      ["health-bar",this.player.health],
      ["stamina-bar",this.player.stamina],
      ["hydration-bar",this.player.hydration],
      ["sanity-bar",this.player.sanity]
    ]){
      const bar=document.getElementById(id);
      if(bar)bar.style.width=Math.max(0,value)+"%";
    }
    const status=document.getElementById("status");
    if(status)status.textContent=this.player.flashlight?"LIGHT ON":"LIGHT OFF";
    const battery=document.getElementById("flash-battery");
    if(battery)battery.textContent="BAT "+Math.round(this.player.flashBattery)+"%";
  }
  updateArgLayer(dt){
    if(this.argTimer<=0&&this.running&&!this.paused){
      this.argTimer=14+Math.random()*28;
      const messages=this.level.id==="0"
        ? ["AUDIO SOURCE: UNKNOWN","ROOM INDEX DESYNC","DOOR COUNT DOES NOT MATCH","FRAME DROP / 00:00:07","DO NOT TRUST THE HUM"]
        : this.level.id==="1"
        ? ["SIGNAL: SECONDARY CARRIER","CAMERA CLOCK DRIFT","MOTION DETECTED","NO EXIT MARKER IN RANGE"]
        : ["POWER BUS: UNSTABLE","FEED: 03:19:XX","THERMAL SIGNATURE LOST","SOMETHING MOVED BETWEEN FRAMES"];
      this.showArgMessage(messages[Math.floor(Math.random()*messages.length)]);
      if(this.level.id!=="6"&&Math.random()<.46)this.audio.distantKnock();
    }
  }

  showArgMessage(message){
    const el=document.getElementById("arg-message");if(!el)return;
    el.textContent=message;el.classList.remove("hidden","glitch");void el.offsetWidth;el.classList.add("glitch");
    clearTimeout(this.argMessageTimer);this.argMessageTimer=setTimeout(()=>el.classList.add("hidden"),2300+Math.random()*2400);
  }

  render(){
    // Keep the daylight atmosphere stable while chunks stream. The scene
    // background remains a blue fallback if a browser loses the sky dome.
    if(this.level.id==="7"){
      this.scene.background.setHex(0x8bc3e8);
      this.sky.visible=true;this.oceanSky.visible=false;this.cloudLayer.visible=true;
      if(this.world.ceilingSurface)this.world.ceilingSurface.visible=false;
      if(this.scene.fog&&!this.player.inOcean){this.scene.fog.color.setHex(0x8bc3e8);this.scene.fog.density=.0004;}
    }else if(this.level.id==="10"){
      this.scene.background.setHex(0xc3d2de);
      this.sky.visible=true;this.oceanSky.visible=false;this.cloudLayer.visible=true;
      this.cloudLayer.material.uniforms.opacity.value=.48;
      this.cloudLayer.material.uniforms.coverage.value=.43;
      if(this.world.ceilingSurface)this.world.ceilingSurface.visible=false;
      if(this.scene.fog){this.scene.fog.color.setHex(0xc3d2de);this.scene.fog.density=.00028;}
    }
    if(this.sky.visible)this.sky.position.copy(this.camera.position);
    if(this.oceanSky.visible)this.oceanSky.position.copy(this.camera.position);
    if(this.cloudLayer.visible){
      this.cloudLayer.position.copy(this.camera.position);
      this.cloudLayer.material.uniforms.time.value=this.gameTime;
    }
    if(this.level.id==="7"||this.level.id==="37"){
      for(const chunk of this.world.chunks.values()){
        for(const material of chunk.group.userData.animatedWaterMaterials||[]){
          if(material.userData.timeUniform)material.userData.timeUniform.value=this.gameTime;
        }
      }
    }
    if(this.level.id==="1"&&this.world.library?.puddle){
      if(!this.level1Reflection)this.level1Reflection=new Level1Reflection(this.renderer,this.scene,this.camera,isTouchControlsDevice());
      this.level1Reflection.setMaterial(this.world.library.puddle);
      this.level1Reflection.render(this.gameTime);
    }
    this.vhsPass.uniforms.resolution.value.set(Math.max(1,this.renderer.domElement.clientWidth||innerWidth),Math.max(1,this.renderer.domElement.clientHeight||innerHeight));
    this.composer.render();
  }
  loop(now){
    const raw=(now-this.last)/1000;this.last=now;
    const dt=Math.min(MAX_DT,raw);
    try{
      if((this.running&&!this.paused)||this.deathSequenceActive)this.update(dt);
      this.render();
      if(window.backroomsAdmin?.ready)window.backroomsAdmin.update();
    }catch(error){
      if(!this.runtimeFaulted){
        this.runtimeFaulted=true;
        console.error("[Backrooms] Runtime update failed:",error);
        this.running=false;
        this.paused=true;
        this.toast("RUNTIME ERROR - OPEN CONSOLE",6);
      }
    }
    requestAnimationFrame(this.loop.bind(this));
  }
  resize(){
    const canvas=this.renderer.domElement;
    const width=Math.max(1,canvas.clientWidth||innerWidth);
    const height=Math.max(1,canvas.clientHeight||innerHeight);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width,height,false);
    this.composer.setPixelRatio(1);
    this.composer.setSize(width,height);
    this.camera.aspect=width/height;
    this.camera.updateProjectionMatrix();
    this.vhsPass.uniforms.resolution.value.set(width,height);
  }
}
