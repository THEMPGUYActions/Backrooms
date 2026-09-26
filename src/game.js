import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { InputManager } from "./input.js?v=20260923-2050";
import { AudioDirector } from "./audio.js?v=20260923-2050";
import { LEVELS, levelById, cycleHash } from "./levels.js?v=20260926-level0ceiling3";
import { makeLibrary, applyFoundFootageLevel0Assets, applyOpenGameArtPBR, applyLevel1Assets, disposeLibrary, box, makePropSet } from "./assets.js?v=20260926-level0carpet1";

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
      float tear=smoothstep(.014,0.0,abs(uv.y-tearY))*step(.84,hash(vec2(tearSeed,52.0)));
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

      vec3 center=texture2D(tDiffuse,uv).rgb;
      vec3 left=texture2D(tDiffuse,uv-vec2(chroma,0.0)).rgb;
      vec3 right=texture2D(tDiffuse,uv+vec2(chroma,0.0)).rgb;
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

      gl_FragColor=vec4(max(c,0.0),1.0);
    }`
};

const CELLS=16;
const BASE_RADIUS=1;
const MAX_DT=.05;

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
const LEVEL0_HOLE_SIZE=6;
const LEVEL0_BLACKOUT_SIZE=4;

function positiveMod(n,d){return ((n%d)+d)%d}
function level0RegionAt(cx,cz,seed){
  if(Math.abs(cx)<=1&&Math.abs(cz)<=1)return {type:"maze",id:"start"};
  const macroX=Math.floor(cx/LEVEL0_REGION_CHUNKS),macroZ=Math.floor(cz/LEVEL0_REGION_CHUNKS);
  const lx=positiveMod(cx,LEVEL0_REGION_CHUNKS),lz=positiveMod(cz,LEVEL0_REGION_CHUNKS);
  const roll=cycleHash(seed^0x6c3000,macroX,macroZ,0x51);
  if(roll<.022&&lx>=3&&lx<3+LEVEL0_RED_SIZE&&lz>=3&&lz<3+LEVEL0_RED_SIZE)return {type:"red",id:"red:"+macroX+":"+macroZ};
  if(roll>=.022&&roll<.055&&lx>=2&&lx<2+LEVEL0_HOLE_SIZE&&lz>=2&&lz<2+LEVEL0_HOLE_SIZE)return {type:"holes",id:"holes:"+macroX+":"+macroZ};
  if(roll>=.055&&roll<.085&&lx>=3&&lx<3+LEVEL0_BLACKOUT_SIZE&&lz>=3&&lz<3+LEVEL0_BLACKOUT_SIZE)return {type:"blackout",id:"blackout:"+macroX+":"+macroZ};
  if(roll>=.085&&roll<.15)return {type:"pillars",id:"pillars:"+macroX+":"+macroZ};
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
  if(cycleHash(seed^0x6d6e,macroX,macroZ,0x41)>.045)return null;
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
    this.walls=new Uint8Array(this.gridSize()*this.gridSize());this.hazards=[];this.exit=null;this.falseDoors=[];this.entitySpawn=false;this.fixtures=[];this.lightSources=[];this.batteries=[];this.crates=[];this.pebbles=[];this.collisionSegments=[];this.zone="halls";this.rooms=[];
    this.flickerTimer=10+Math.random()*18;
    this.buildMaze();this.buildGeometry();
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
      // Level 1 uses two generation paths:
      // a 10x10 DFS maze and a Perlin-selected large parking-garage room.
      // There is no separate procedural "hall/corridor" generator.
      const forceStart=this.cx===0&&this.cz===0;
      const worldX=this.cx*cells*level.cellSize;
      const worldZ=this.cz*cells*level.cellSize;
      const macro=smoothNoise2D(worldX*.002,worldZ*.002,this.game.seed);
      this.zone=(forceStart||macro>.5)?"mega":"maze";

      if(this.zone==="mega"){
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
        // Keep large garage sectors connected. These openings are the
        // browser equivalent of the neighboring megaroom connections.
        for(const i of [2,7]){
          this.setEdge(i,0,"north",true);
          this.setEdge(i,cells-1,"south",true);
          this.setEdge(0,i,"west",true);
          this.setEdge(cells-1,i,"east",true);
        }
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
    }else if(level.id==="0"){
      this.zone="maze";
      this.megaType=null;
      this.level0Region=this.world.forceLevel0AllRed
        ? {type:"red",id:"red:global"}
        : level0RegionAt(this.cx,this.cz,this.game.seed);
      if(!this.world.forceLevel0AllRed&&this.world.forceLevel0Zone&&Math.abs(this.cx-this.world.forceLevel0Zone.cx)<=1&&Math.abs(this.cz-this.world.forceLevel0Zone.cz)<=1){
        this.level0Region={type:this.world.forceLevel0Zone.type,id:"forced:"+this.world.forceLevel0Zone.type};
      }
      this.level0SpawnCell={x:Math.floor(cells/2),z:Math.floor(cells/2)};
      this.level0Blackout=this.level0Region.type==="blackout";
      this.level0PillarArea=this.level0Region.type==="pillars";
      this.level0HoleArea=this.level0Region.type==="holes";
      this.level0RedRoom=this.level0Region.type==="red";
      this.level0PoleArea=this.level0PillarArea;
      this.manilaRoom=this.level0Region.type==="maze"?level0ManilaAt(this.cx,this.cz,this.game.seed):null;

      if(this.level0Region.type==="pillars"||this.level0Region.type==="holes"){
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
        // Keep the maze spatially tight so each 8m cell corresponds to one
        // 8m roof panel. Only a small amount of room merging is allowed;
        // broad multi-cell openings made the floor feel disconnected from
        // the ceiling grid and too much like a warehouse.
        for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){
          if(x<cells-1&&rng.next()<.025)this.setEdge(x,z,"east",true);
          if(z<cells-1&&rng.next()<.025)this.setEdge(x,z,"south",true);
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

      if(this.level0Region.type==="holes"){
        const holeRng=new RNG(this.seedKey()^0x481e);
        for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){
          if((x===Math.floor(cells/2)&&z===Math.floor(cells/2))||holeRng.next()<.72)this.hazards.push({x,z,cluster:true});
        }
      }
    }

    if(level.id!=="1"&&level.id!=="0"){
      const boundaryChance=.19;
      for(let x=0;x<cells;x++){
        const gx=this.cx*cells+x;
        if(canonicalOpen(this.game.seed,gx,this.cz*cells,"h",boundaryChance))this.setEdge(x,0,"north",true);
        if(canonicalOpen(this.game.seed,gx,this.cz*cells+cells,"h",boundaryChance))this.setEdge(x,cells-1,"south",true);
      }
      for(let z=0;z<cells;z++){
        const gz=this.cz*cells+z;
        if(canonicalOpen(this.game.seed,this.cx*cells,gz,"v",boundaryChance))this.setEdge(0,z,"west",true);
        if(canonicalOpen(this.game.seed,this.cx*cells+cells,gz,"v",boundaryChance))this.setEdge(cells-1,z,"east",true);
      }
    }

    const rng2=new RNG((Math.imul(this.cx,83492791)^Math.imul(this.cz,2971215073)^this.game.seed)|0);
    for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){
      if(level.id!=="0"&&rng2.next()<level.holeChance&&Math.hypot(x-(cells-1)/2,z-(cells-1)/2)>1.7)this.hazards.push({x,z});
    }

    const chunkDistance=Math.hypot(this.cx,this.cz),minCell=1,maxCell=Math.max(1,cells-2);
    const level1ExitSector=level.id==="1"&&this.zone==="maze"&&!((this.cx===0&&this.cz===0))&&chunkDistance>=level.exitAfterChunks;
    if(level.id==="1"){
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
    }else if(chunkDistance>=level.exitAfterChunks&&cycleHash(this.seedKey(),this.cx*13+this.cz*7,level.id.charCodeAt(0))<.18){
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
    const wallThickness=.18;
    const safeWallHeight=level.wallHeight-.04;
    const safeWallY=safeWallHeight/2+.02;
    const hGeom=new THREE.BoxGeometry(cell,safeWallHeight,wallThickness),vGeom=new THREE.BoxGeometry(wallThickness,safeWallHeight,cell);
    const trimHGeom=new THREE.BoxGeometry(cell,.11,.12),trimVGeom=new THREE.BoxGeometry(.12,.11,cell);
    const topHGeom=new THREE.BoxGeometry(cell,.075,.09),topVGeom=new THREE.BoxGeometry(.09,.075,cell);
    const hData=[],vData=[],trimH=[],trimV=[],topH=[],topV=[],edges=[],rngBase=new RNG(this.seedKey());
    const region=level.id==="0"?(this.level0Region?.type||"maze"):"";
    const wallMaterial=level.id==="1"?lib.concrete:region==="red"?lib.redWall:lib.wall;
    const seenH=new Set(),seenV=new Set();
    const pushMat=(arr,x,y,z)=>{const m=new THREE.Matrix4();m.compose(new THREE.Vector3(x,y,z),new THREE.Quaternion(),new THREE.Vector3(1,1,1));arr.push(m)};
    const key=(x,z,s)=>s+"|"+x+"|"+z;
    const addInstanced=(geometry,material,data)=>{if(!data.length)return;const mesh=new THREE.InstancedMesh(geometry,material,data.length);mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);data.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();g.add(mesh)};
    const buildWallEdge=(x,z,side)=>{
      const px=this.originX+x*cell+cell/2,pz=this.originZ+z*cell+cell/2;
      if(side==="north"){const k=key(x,z,side);if(seenH.has(k))return;seenH.add(k);pushMat(hData,px,safeWallY,pz-cell/2);pushMat(trimH,px,.065,pz-cell/2);pushMat(topH,px,level.wallHeight-.04,pz-cell/2);edges.push({x,z,side});}
      else if(side==="south"){const k=key(x,z+1,"north");if(seenH.has(k))return;seenH.add(k);pushMat(hData,px,safeWallY,pz+cell/2);pushMat(trimH,px,.065,pz+cell/2);pushMat(topH,px,level.wallHeight-.04,pz+cell/2);edges.push({x,z,side});}
      else if(side==="west"){const k=key(x,z,side);if(seenV.has(k))return;seenV.add(k);pushMat(vData,px-cell/2,safeWallY,pz);pushMat(trimV,px-cell/2,.065,pz);pushMat(topV,px-cell/2,level.wallHeight-.04,pz);edges.push({x,z,side});}
      else{const k=key(x+1,z,"west");if(seenV.has(k))return;seenV.add(k);pushMat(vData,px+cell/2,safeWallY,pz);pushMat(trimV,px+cell/2,.065,pz);pushMat(topV,px+cell/2,level.wallHeight-.04,pz);edges.push({x,z,side});}
    };
    for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){
      const mask=this.walls[this.index(x,z)];
      if(mask&1)buildWallEdge(x,z,"north");if(mask&8)buildWallEdge(x,z,"west");if(z===cells-1&&(mask&4))buildWallEdge(x,z,"south");if(x===cells-1&&(mask&2))buildWallEdge(x,z,"east");
      if(level.id==="0"){
        const fixtureChance=region==="blackout"?0:region==="red"?.24:.30;
        if(rngBase.next()<fixtureChance){
          const mat=(region==="red"?lib.redLight:lib.light).clone();mat.emissiveIntensity=region==="red"?1.25:2.7;
          const rotation=rngBase.next()<.5?0:Math.PI/2,px=this.originX+x*cell+cell/2,pz=this.originZ+z*cell+cell/2;
          const fixture=box(g,new THREE.BoxGeometry(1.55,.055,.46),mat,px,level.wallHeight-.08,pz,0,rotation,0);fixture.userData.light=true;fixture.userData.baseEmissive=mat.emissiveIntensity;this.fixtures.push(fixture);
          const intensity=region==="red"?72:175;this.lightSources.push({position:new THREE.Vector3(px,level.wallHeight-.24,pz),color:region==="red"?0x761712:level.theme.light,baseIntensity:intensity,intensity,distance:region==="red"?18:0,decay:2,fixture});
        }
      }else if(level.id!=="1"&&rngBase.next()<.13){
        const fixtureMat=level.id==="2"&&rngBase.next()<.28?lib.orangeLight:lib.light,material=fixtureMat.clone();material.emissiveIntensity=fixtureMat===lib.orangeLight?2.2:3.0;
        const rotation=rngBase.next()<.5?0:Math.PI/2,px=this.originX+x*cell+cell/2,pz=this.originZ+z*cell+cell/2;
        const fixture=box(g,new THREE.BoxGeometry(3.7,.055,.72),material,px,level.wallHeight-.09,pz,0,rotation,0);fixture.userData.light=true;fixture.userData.baseEmissive=material.emissiveIntensity;this.fixtures.push(fixture);
        const lightColor=fixtureMat===lib.orangeLight?0xff9b52:level.theme.light,intensity=level.id==="3"?220:level.id==="4"?110:170;this.lightSources.push({position:new THREE.Vector3(px,level.wallHeight-.24,pz),color:lightColor,baseIntensity:intensity,intensity,distance:0,decay:2,fixture});
      }
    }
    this.collisionSegments=edges.map(e=>{const px=this.originX+e.x*cell+cell/2,pz=this.originZ+e.z*cell+cell/2;return e.side==="north"||e.side==="south"?{x1:px-cell/2,z1:e.side==="north"?pz-cell/2:pz+cell/2,x2:px+cell/2,z2:e.side==="north"?pz-cell/2:pz+cell/2}:{x1:e.side==="west"?px-cell/2:px+cell/2,z1:pz-cell/2,x2:e.side==="west"?px-cell/2:px+cell/2,z2:pz+cell/2}});
    addInstanced(hGeom,wallMaterial,hData);addInstanced(vGeom,wallMaterial,vData);
    if(level.id==="0"&&region==="red"){
      const redFloor=new THREE.Mesh(new THREE.PlaneGeometry(size,size),lib.redFloor);
      redFloor.rotation.x=-Math.PI/2;
      redFloor.position.set(this.originX+size/2,.006,this.originZ+size/2);
      redFloor.renderOrder=1;
      g.add(redFloor);
    }
    if(level.id!=="1"){addInstanced(trimHGeom,lib.trim,trimH);addInstanced(trimVGeom,lib.trim,trimV);addInstanced(topHGeom,lib.trimTop,topH);addInstanced(topVGeom,lib.trimTop,topV)}

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


    if(level.id!=="0"||(!this.level0RedRoom&&!this.manilaRoom))for(let i=0;i<Math.min(9,edges.length);i++){
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

    if(level.id==="0"&&!this.level0RedRoom&&!this.manilaRoom&&rngBase.next()<.18&&edges.length){
      const e=rngBase.pick(edges),p=wallPoint(e,.108,1.48),group=new THREE.Group();
      group.position.copy(p.position);group.rotation.y=p.rotation;
      box(group,new THREE.BoxGeometry(.46,.3,.07),lib.intercom,0,0,0);
      for(let i=-1;i<=1;i++)box(group,new THREE.BoxGeometry(.28,.018,.018),lib.intercomSlot,0,.075+i*.055,.041);
      box(group,new THREE.BoxGeometry(.055,.055,.018),lib.intercomSlot,.17,-.08,.041);
      g.add(group);
    }

    if(level.id==="0"&&!this.level0RedRoom&&!this.manilaRoom&&rngBase.next()<.3){
      const camGroup=new THREE.Group();
      camGroup.position.set(this.originX+cell*.5+cell*(cells-1)*rngBase.next(),level.wallHeight-.18,this.originZ+cell*.5+cell*(cells-1)*rngBase.next());
      const dome=new THREE.Mesh(new THREE.SphereGeometry(.17,10,6,0,Math.PI*2,0,Math.PI/2),lib.cameraDome);dome.scale.y=.65;camGroup.add(dome);
      box(camGroup,new THREE.BoxGeometry(.06,.06,.045),lib.socket,0,-.055,-.11);
      g.add(camGroup);
    }

    const buildDoor=(entry,exitDoor)=>{
      const doorHeight=Math.min(2.75,level.wallHeight-.16);
      const doorWidth=Math.min(3.1,cell-.9);
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
      if(e.kind==="stairwell2"){
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
      const pipeMat=lib.metal,rng=new RNG(this.seedKey()^0x72ea);
      for(let i=0;i<5;i++){
        const y=.75+rng.next()*2.0;
        const horizontal=new THREE.Mesh(new THREE.CylinderGeometry(.075+rng.next()*.09,.075+rng.next()*.09,size*.52,8),pipeMat);
        horizontal.rotation.z=Math.PI/2;horizontal.position.set(this.originX+rng.next()*size,y,this.originZ+rng.next()*size);g.add(horizontal);
      }
    }else if(level.id==="3"){
      const rng=new RNG(this.seedKey()^0x31e1);
      for(let i=0;i<8;i++){
        const y=1.15+rng.next()*2.35;
        const radius=.055+rng.next()*.085;
        const vertical=rng.next()<.35;
        const length=vertical?2.6+ rng.next()*1.4:size*.36+rng.next()*size*.18;
        const pipe=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,length,8),lib.metal);
        if(vertical){
          pipe.position.set(this.originX+rng.next()*size,y,this.originZ+rng.next()*size);
        }else{
          pipe.rotation.z=Math.PI/2;
          pipe.position.set(this.originX+rng.next()*size,y,this.originZ+rng.next()*size);
        }
        g.add(pipe);
      }
      for(let i=0;i<2;i++){
        const bx=this.originX+cell*(1+rng.next()*Math.max(1,cells-2));
        const bz=this.originZ+cell*(1+rng.next()*Math.max(1,cells-2));
        const panel=new THREE.Group();
        panel.position.set(bx,1.55,bz);
        box(panel,new THREE.BoxGeometry(.72,1.1,.16),lib.officePlastic,0,0,0);
        box(panel,new THREE.BoxGeometry(.055,.055,.035),lib.indicator,.2,.3,-.095);
        box(panel,new THREE.BoxGeometry(.055,.055,.035),lib.indicator,.2,.12,-.095);
        g.add(panel);
      }
    }else if(level.id==="4"){
      const rng=new RNG(this.seedKey()^0x44aa);
      for(let i=0;i<3;i++){
        const ox=this.originX+cell*(1+rng.next()*Math.max(1,cells-2));
        const oz=this.originZ+cell*(1+rng.next()*Math.max(1,cells-2));
        const desk=new THREE.Group();
        desk.position.set(ox,.0,oz);
        box(desk,new THREE.BoxGeometry(1.55,.12,.75),lib.officeWood,0,.78,0);
        box(desk,new THREE.BoxGeometry(.08,.78,.08),lib.officeWood,-.62,.39,-.27);
        box(desk,new THREE.BoxGeometry(.08,.78,.08),lib.officeWood,.62,.39,-.27);
        box(desk,new THREE.BoxGeometry(.08,.78,.08),lib.officeWood,-.62,.39,.27);
        box(desk,new THREE.BoxGeometry(.08,.78,.08),lib.officeWood,.62,.39,.27);
        box(desk,new THREE.BoxGeometry(.8,.5,.06),lib.officePlastic,0,1.08,.18);
        box(desk,new THREE.BoxGeometry(.62,.035,.035),lib.indicator,0,1.12,.215);
        g.add(desk);
      }
      for(let i=0;i<Math.min(4,edges.length);i++){
        const e=edges[(rng.int(0,edges.length-1)+i*7)%edges.length];
        const p=wallPoint(e,.112,2.25);
        const windowGroup=new THREE.Group();
        windowGroup.position.copy(p.position);windowGroup.rotation.y=p.rotation;
        box(windowGroup,new THREE.BoxGeometry(2.9,1.2,.035),lib.windowDark,0,0,0);
        box(windowGroup,new THREE.BoxGeometry(.045,1.28,.05),lib.trim,.0,0,0);
        g.add(windowGroup);
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
        pillarData.push(new THREE.Matrix4().compose(new THREE.Vector3(x+j,level.wallHeight/2,z-j),q,new THREE.Vector3(1.15,1,1.15)));
        baseData.push(new THREE.Matrix4().compose(new THREE.Vector3(x+j,.08,z-j),q,new THREE.Vector3(1.35,1,1.35)));
      }
      const pg=new THREE.BoxGeometry(1.25,level.wallHeight,1.25),bg=new THREE.BoxGeometry(1.5,.16,1.5);
      const addLocal=(geometry,material,data)=>{if(!data.length)return;const m=new THREE.InstancedMesh(geometry,material,data.length);m.instanceMatrix.setUsage(THREE.StaticDrawUsage);data.forEach((v,i)=>m.setMatrixAt(i,v));m.instanceMatrix.needsUpdate=true;m.computeBoundingSphere();g.add(m)};
      addLocal(pg,lib.pillar,pillarData);addLocal(bg,lib.wall,baseData);
      for(const m of pillarData){const px=m.elements[12],pz=m.elements[14],r=.64;this.collisionSegments.push({x1:px-r,z1:pz-r,x2:px+r,z2:pz-r},{x1:px+r,z1:pz-r,x2:px+r,z2:pz+r},{x1:px+r,z1:pz+r,x2:px-r,z2:pz+r},{x1:px-r,z1:pz+r,x2:px-r,z2:pz-r})}
    }

    if(region==="holes"){
      const hole=5,holeBottom=-5.42,depth=5.42;
      for(const h of this.hazards.filter(v=>v.cluster)){
        const p=center(h.x,h.z);
        box(g,new THREE.BoxGeometry(hole,.08,hole),lib.dark,p.x,holeBottom,p.z);
        box(g,new THREE.BoxGeometry(hole,depth,.10),lib.dark,p.x,-depth/2,p.z-hole/2);
        box(g,new THREE.BoxGeometry(hole,depth,.10),lib.dark,p.x,-depth/2,p.z+hole/2);
        box(g,new THREE.BoxGeometry(.10,depth,hole),lib.dark,p.x-hole/2,-depth/2,p.z);
        box(g,new THREE.BoxGeometry(.10,depth,hole),lib.dark,p.x+hole/2,-depth/2,p.z);
      }
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

    if(this.manilaRoom&&region==="maze"){
      const p=center(this.manilaRoom.cellX,this.manilaRoom.cellZ),w=8,h=3.15,thick=.42,doorW=1.45,doorH=2.35,side=(w-doorW)/2,wall=lib.manilaWall,wood=lib.officeWood;
      const wallSegments=[];
      const addHorizontal=(z)=>{
        const y=h/2;
        wallSegments.push({x1:p.x-w/2,z1:z,x2:p.x-doorW/2,z2:z},{x1:p.x+doorW/2,z1:z,x2:p.x+w/2,z2:z});
        box(g,new THREE.BoxGeometry(side,h,thick),wall,p.x-(doorW/2+side/2),y,z);
        box(g,new THREE.BoxGeometry(side,h,thick),wall,p.x+(doorW/2+side/2),y,z);
        box(g,new THREE.BoxGeometry(doorW,h-doorH,thick),wall,p.x,(h+doorH)/2,z);
      };
      const addVertical=(x)=>{
        const y=h/2;
        wallSegments.push({x1:x,z1:p.z-w/2,x2:x,z2:p.z-doorW/2},{x1:x,z1:p.z+doorW/2,x2:x,z2:p.z+w/2});
        box(g,new THREE.BoxGeometry(thick,h,side),wall,x,y,p.z-(doorW/2+side/2));
        box(g,new THREE.BoxGeometry(thick,h,side),wall,x,y,p.z+(doorW/2+side/2));
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
      box(g,new THREE.BoxGeometry(.48,.012,.32),lib.outlet,p.x,.86,p.z-.12);
      if(!this.level0Blackout){
        const fixture=box(g,new THREE.BoxGeometry(1.25,.05,.42),lib.light,p.x,h-.13,p.z);fixture.userData.light=true;fixture.userData.baseEmissive=1.5;this.fixtures.push(fixture);this.lightSources.push({position:new THREE.Vector3(p.x,h-.32,p.z),color:0xffc46a,baseIntensity:70,intensity:70,distance:10,decay:2,fixture});
      }
      return;
    }

    if(region==="pillars")return;
    const candidates=[];
    for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){if(x===centerCell&&z===centerCell)continue;const mask=this.walls[this.index(x,z)],closed=(mask&1?1:0)+(mask&2?1:0)+(mask&4?1:0)+(mask&8?1:0);candidates.push({x,z,mask,closed})}
    if(next()<.25){const dead=candidates.filter(c=>c.closed===3),room=dead.length?dead[Math.floor(next()*dead.length)]:null;if(room){const p=center(room.x,room.z),open=!(room.mask&1)?"north":!(room.mask&2)?"east":!(room.mask&4)?"south":"west";const t=new THREE.Mesh(new THREE.TorusGeometry(cell*.19,.11,8,18,Math.PI),lib.wall);t.position.set(p.x,2.1,p.z);t.rotation.y=open==="east"||open==="west"?Math.PI/2:0;g.add(t)}}
    if(this.level0Blackout)return;
    const propRng=new RNG(this.seedKey()^0x71a4);
    for(let i=0;i<2;i++){const room=candidates[propRng.int(0,Math.max(0,candidates.length-1))];if(!room)continue;const p=center(room.x,room.z);if(propRng.next()<.35){const mat=lib.light.clone();mat.emissiveIntensity=2.5;const f=box(g,new THREE.BoxGeometry(1.65,.055,.46),mat,p.x,level.wallHeight-.08,p.z,0,propRng.next()<.5?0:Math.PI/2,0);f.userData.light=true;f.userData.baseEmissive=2.5;this.fixtures.push(f);this.lightSources.push({position:new THREE.Vector3(p.x,level.wallHeight-.25,p.z),color:level.theme.light,baseIntensity:165,intensity:165,distance:0,decay:2,fixture:f})}}
  }
  buildLevel1Set(level,lib,rng){
    const g=this.group,cell=level.cellSize,cells=this.gridSize(),size=this.world.size;
    const next=()=>rng.next();
    const center=(x,z)=>({
      x:this.originX+x*cell+cell/2,
      z:this.originZ+z*cell+cell/2
    });

    const addLight=(x,z,rotation=0,scale=1,intensity=105)=>{
      const cableLength=.22;
      const cableOffset=1.35*scale;
      for(const side of [-1,1]){
        const cable=new THREE.Mesh(
          new THREE.CylinderGeometry(.022,.022,cableLength,8),
          lib.cable
        );
        cable.position.set(
          x+Math.cos(rotation)*cableOffset*side,
          level.wallHeight-cableLength/2-.035,
          z+Math.sin(rotation)*cableOffset*side
        );
        g.add(cable);
      }

      const fixture=box(
        g,
        new THREE.BoxGeometry(3.65*scale,.07,.32*scale),
        lib.level1Light,
        x,
        level.wallHeight-.38,
        z,
        0,
        rotation,
        0
      );
      fixture.userData.light=true;
      fixture.userData.baseEmissive=2.9;
      this.fixtures.push(fixture);

      // Dark recessed housing around the tube. The reference lights sit under
      // broad ceiling beams rather than on a white Level 0 tile grid.
      box(
        g,
        new THREE.BoxGeometry(3.95*scale,.16,.52*scale),
        lib.garageBeam,
        x,
        level.wallHeight-.27,
        z,
        0,
        rotation,
        0
      );

      this.lightSources.push({
        position:new THREE.Vector3(x,level.wallHeight-.48,z),
        color:0xf4f4ee,
        baseIntensity:intensity,
        intensity,
        distance:34,
        decay:2,
        fixture
      });
    };

    if(this.zone==="mega"){
      // 5x5 parking-column rhythm. This is the dominant Level 1 shape in
      // The Level 0 macro room 1: long sightlines with repeating square
      // concrete pillars and low structural beams.
      const columnGeom=new THREE.BoxGeometry(1.22,level.wallHeight,.1);
      const pillarGeom=new THREE.BoxGeometry(1.22,level.wallHeight,1.22);
      const baseGeom=new THREE.BoxGeometry(1.42,.16,1.42);
      const columns=[],bases=[];

      for(let ix=1;ix<=8;ix+=2){
        for(let iz=1;iz<=8;iz+=2){
          const p=center(ix,iz);
          columns.push(new THREE.Matrix4().makeTranslation(p.x,level.wallHeight/2,p.z));
          bases.push(new THREE.Matrix4().makeTranslation(p.x,.08,p.z));
        }
      }

      const addInst=(geometry,material,data)=>{
        const mesh=new THREE.InstancedMesh(geometry,material,data.length);
        mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        data.forEach((m,i)=>mesh.setMatrixAt(i,m));
        mesh.instanceMatrix.needsUpdate=true;
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
        g.add(mesh);
      };
      addInst(pillarGeom,lib.concrete,columns);
      addInst(baseGeom,lib.garageBase,bases);

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
      }

      // Long fluorescent rows between the structural bands.
      for(let z=8;z<size;z+=16){
        for(let x=8;x<size;x+=16){
          const p=this.centerForLevel1Cell(x,z);
          addLight(p.x,p.z,0,.92,98+next()*24);
        }
      }

      // A second perpendicular row in selected lanes creates the deep,
      // repeating light pattern visible in the reference.
      for(let x=16;x<size-4;x+=32){
        for(let z=16;z<size-8;z+=16){
          if(next()<.34)continue;
          const p={x:this.originX+x,z:this.originZ+z};
          addLight(p.x,p.z,Math.PI/2,.72,72+next()*20);
        }
      }

      // Faded parking/traffic markings. Keep them extremely dark and thin so
      // they read as garage infrastructure instead of a bright arcade floor.
      const lineMat=lib.parkingLine;
      for(let x=16;x<size-8;x+=16){
        box(g,new THREE.BoxGeometry(.055,.012,5.6),lineMat,this.originX+x,.012,this.originZ+12);
        if(next()<.7)box(g,new THREE.BoxGeometry(.055,.012,5.6),lineMat,this.originX+x,.012,this.originZ+44);
      }

      // Large wet patches are a major part of the reference appearance.
      for(let i=0;i<7;i++){
        const px=this.originX+6+next()*(size-12);
        const pz=this.originZ+6+next()*(size-12);
        const puddle=new THREE.Mesh(new THREE.CircleGeometry(.8+next()*3.8,32),lib.puddle);
        puddle.rotation.x=-Math.PI/2;
        puddle.rotation.z=next()*Math.PI;
        puddle.scale.set(1.2+next()*1.7,.38+.18*next(),1);
        puddle.position.set(px,.014,pz);
        g.add(puddle);
      }

      // Sparse service hardware at the edge of a few bays.
      for(let i=0;i<2;i++){
        if(next()>.42)continue;
        const px=this.originX+(2+next()*(cells-4))*cell;
        const pz=this.originZ+(.9+next()*.15)*cell;
        box(g,new THREE.BoxGeometry(.16,1.8,.28),lib.garageBase,px,.9,pz);
        box(g,new THREE.BoxGeometry(.5,.08,.32),lib.metal,px,1.72,pz);
      }
    }else{
      // The non-megaroom path is the maze portion of the reference generator.
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
            box(g,new THREE.BoxGeometry(.58,level.wallHeight,.58),lib.concrete,p.x+ox*1.15,.0+level.wallHeight/2,p.z+oz*1.15);
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
    const duration=Math.max(2.8,Math.min(5.8,.16*fixtureCount+.9+Math.random()*1.7));
    const spacing=duration/fixtureCount;
    const order=this.fixtures.slice();
    for(let i=order.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [order[i],order[j]]=[order[j],order[i]];
    }
    for(let i=0;i<order.length;i++){
      const fixture=order[i];
      const offDuration=Math.min(.14,Math.max(.055,spacing*.52+Math.random()*.045));
      const jitter=Math.min(.035,spacing*.12)*Math.random();
      const start=i*spacing+jitter;
      fixture.userData.flickerPulses=[[start,start+offDuration]];
      fixture.userData.flickerEventStart=now;
    }
  }
  flickerScale(fixture){
    const pulses=fixture?.userData?.flickerPulses;
    if(!pulses?.length)return 1;
    const elapsed=this.game.gameTime-(fixture.userData.flickerEventStart??this.game.gameTime);
    for(const [start,end] of pulses){
      if(elapsed>=start&&elapsed<end)return .018;
    }
    return 1;
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
    this.surfaceSize=4096;
    this.library=makeLibrary(this.game.level);

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
      this.ceilingSurface.position.set(0,this.game.level.id==="0"?this.game.level.wallHeight-.025:this.game.level.wallHeight+.002,0);
      this.ceilingSurface.updateMatrix();
      this.ceilingSurface.matrixAutoUpdate=false;
      this.ceilingSurface.frustumCulled=false;
      this.ceilingSurface.renderOrder=-2;
    }

    if(this.floorSurface)this.game.scene.add(this.floorSurface);
    if(this.ceilingSurface)this.game.scene.add(this.ceilingSurface);
    if(this.game.level.id==="1"){
      this.library.floor.color.setHex(0x666a68);
      this.library.floor.roughness=.42;
      this.library.floor.metalness=.03;
      this.library.ceiling.color.setHex(0x4e514f);
      this.library.ceiling.roughness=.78;
      this.library.ceiling.metalness=0;
      this.library.concrete.color.setHex(0xaeb0ac);
      this.library.concrete.roughness=.84;
    }

    this.updateSurfaceTiling();
    this.updateWallTextureTiling();

    // The procedural fallback is complete at this point. Do not make startup
    // depend on remote texture downloads or external asset hosts.
    void (async()=>{
      try{
        if(this.game.level.id==="1")await applyLevel1Assets(this.library,this.game.level,onProgress);
        else if(this.game.level.id==="0"){
          await applyFoundFootageLevel0Assets(this.library,this.game.level,onProgress);
          await applyOpenGameArtPBR(this.library,this.game.level,onProgress);
        }else await applyOpenGameArtPBR(this.library,this.game.level,onProgress);
      }catch(error){
        console.warn("[Backrooms] Surface asset enhancement failed; procedural fallback remains active.",error);
      }
      this.updateSurfaceTiling();
      this.updateWallTextureTiling();
    })();

    return true;
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
          {material:this.library?.floor,tileWorld:1.25},
          {material:this.library?.ceiling,tileWorld:1.0}
        ]
      : this.game.level.id==="1"
        ? [
            {material:this.library?.floor,tileWorld:5.4},
            {material:this.library?.ceiling,tileWorld:5.4}
          ]
        : [
            {material:this.library?.floor,tileWorld:3.0},
            {material:this.library?.ceiling,tileWorld:1.25}
          ];

    for(const {material,tileWorld} of surfaces){
      if(!material)continue;
      const repeat=isLevel0?tileWorld:this.surfaceSize/tileWorld;
      for(const key of ["map","roughnessMap","normalMap"]){
        const texture=material[key];
        if(!texture)continue;
        texture.wrapS=THREE.RepeatWrapping;
        texture.wrapT=THREE.RepeatWrapping;
        texture.repeat.set(repeat,repeat);
        texture.offset.set(0,0);
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
    for(let dz=-this.radius;dz<=this.radius;dz++)for(let dx=-this.radius;dx<=this.radius;dx++){
      if(dx*dx+dz*dz>(this.radius+.35)*(this.radius+.35))continue;
      const k=this.key(cx+dx,cz+dz);
      if(!this.chunks.has(k)){
        const c=new Chunk(this,cx+dx,cz+dz);this.chunks.set(k,c);this.game.scene.add(c.group);
        if(this.game.level.entity!=="none"&&Math.hypot(cx+dx,cz+dz)>=2&&cycleHash(this.game.seed,c.cx,c.cz+449+this.game.level.id.charCodeAt(0))<.055)c.entitySpawn=true;
      }
    }
    for(const [k,c] of this.chunks){
      if(Math.hypot(c.cx-cx,c.cz-cz)>this.radius+1){this.game.scene.remove(c.group);this.chunks.delete(k)}
    }
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
    const direct=this.collision(new THREE.Vector3(x,0,z),radius);
    if(Math.hypot(direct.x-x,direct.z-z)<.02)return {x,z};
    const candidates=[
      [2,0],[-2,0],[0,2],[0,-2],[4,0],[-4,0],[0,4],[0,-4],
      [2,2],[-2,2],[2,-2],[-2,-2],[6,0],[-6,0],[0,6],[0,-6],
      [4,2],[-4,2],[4,-2],[-4,-2],[2,4],[-2,4],[2,-4],[-2,-4]
    ];
    for(const [dx,dz] of candidates){
      const cx=x+dx,cz=z+dz,hit=this.collision(new THREE.Vector3(cx,0,cz),radius);
      if(Math.hypot(hit.x-cx,hit.z-cz)<.02)return {x:cx,z:cz};
    }
    return {x:direct.x,z:direct.z};
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
    for(const h of c.hazards){const hx=c.originX+h.x*cell+cell/2,hz=c.originZ+h.z*cell+cell/2;if((x-hx)*(x-hx)+(z-hz)*(z-hz)<(cell*.26)**2)return true}
    return false;
  }
  exitAt(x,z){
    const c=this.chunkAt(x,z);if(!c||!c.exit)return false;
    return Math.hypot(c.exit.position.x-x,c.exit.position.z-z)<1.25;
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
  nearbyLightSources(x,z,frustum,camera){
    const out=[];
    const offset=this.size/2;
    const cx=Math.floor((x+offset)/this.size),cz=Math.floor((z+offset)/this.size);
    const span=this.game.level.id==="0"?1:2;
    for(let dz=-span;dz<=span;dz++)for(let dx=-span;dx<=span;dx++){
      const c=this.chunks.get(this.key(cx+dx,cz+dz));
      if(!c)continue;
      for(const light of c.lightSources){
        const range=Math.max(34,light.distance||0);
        const d=Math.hypot(light.position.x-x,light.position.z-z);
        // A point light can illuminate geometry that is outside the camera
        // frustum. Do not cull it because the light source itself is behind
        // the camera or just outside the view.
        if(d>Math.max(96,range+54))continue;
        out.push({light,d,score:d});
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
      if(this.game.level.id==="1"&&this.game.lightState!=="BLACKOUT")continue;
      out.push(c);
    }
    return out;
  }
}

class Player{
  constructor(game){
    this.game=game;this.position=new THREE.Vector3(0,1.72,0);this.yaw=0;this.pitch=0;
    this.health=100;this.stamina=100;this.hydration=100;this.sanity=100;
    this.flashlight=true;this.flashBattery=100;
    this.eyeY=1.72;this.bob=0;this.bobStrength=0;this.shake=0;this.cameraFov=62;this.flashWarmup=1.15;
    this.viewYaw=0;this.viewPitch=0;
  }
  reset(){
    this.position.set(0,this.eyeY,0);this.yaw=0;this.pitch=0;this.viewYaw=0;this.viewPitch=0;
    this.bob=0;this.bobStrength=0;this.shake=0;this.cameraFov=62;
    this.health=this.stamina=this.hydration=this.sanity=100;this.flashBattery=100;
    this.flashlight=this.game.startFlash;
    this.flashWarmup=1.15;
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
    const mv=input.getMove(),run=input.wantsRun()&&this.stamina>4&&Math.hypot(mv.x,mv.y)>.12,speed=run?6.2:2.85;
    const forward=new THREE.Vector3(-Math.sin(this.yaw),0,-Math.cos(this.yaw)),right=new THREE.Vector3(Math.cos(this.yaw),0,-Math.sin(this.yaw));
    const delta=new THREE.Vector3().addScaledVector(right,mv.x).addScaledVector(forward,-mv.y);if(delta.lengthSq()>1)delta.normalize();
    const oldX=this.position.x,oldZ=this.position.z;
    this.position.x+=delta.x*speed*dt;this.position.z+=delta.z*speed*dt;
    const col=this.game.world.collision(this.position,.34);this.position.x=col.x;this.position.z=col.z;
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
    const stride=Math.min(1,Math.abs(mv.y));
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
    const roll=Math.sin(this.bob)*(.0024+(run?.0032:.00125))*this.bobStrength+sway*.35;
    const shakeY=this.shake*Math.sin(this.game.gameTime*31)*.11;
    const side=new THREE.Vector3(Math.cos(this.viewYaw),0,-Math.sin(this.viewYaw));
    const cameraTarget=this.position.clone().addScaledVector(side,bobX);
    cameraTarget.y=this.eyeY+bobY+breathing+shakeY;
    this.game.camera.position.lerp(cameraTarget,1-Math.exp(-dt*24));

    const targetFov=run?67:62;
    this.cameraFov+=(targetFov-this.cameraFov)*(1-Math.exp(-dt*8));
    if(Math.abs(this.game.camera.fov-this.cameraFov)>.01){this.game.camera.fov=this.cameraFov;this.game.camera.updateProjectionMatrix()}
    this.game.camera.rotation.set(this.viewPitch,this.viewYaw,roll,"YXZ");

    const batteryPower=Math.max(0,this.flashBattery/100);
    const beamPower=Math.pow(batteryPower,.72);
    const flashForward=new THREE.Vector3(0,0,-1).applyQuaternion(this.game.camera.quaternion).normalize();
    // Keep the source slightly behind the camera so a wall can never contain
    // the light origin. This matters most when the player is inches from a wall.
    const flashOrigin=this.game.camera.position.clone().addScaledVector(flashForward,-.22);
    this.game.flash.position.copy(flashOrigin);
    this.game.flashFill.position.copy(flashOrigin).addScaledVector(flashForward,1.35);

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
    this.game.flash.decay=2;
    const warmup=1-Math.min(1,this.flashWarmup/1.15);
    const flashRamp=.12+.88*THREE.MathUtils.smoothstep(warmup,0,1);
    this.game.flash.intensity=this.flashlight
      ? (.34+beamPower*.66)*washScale*flashRamp
      : 0;

    this.game.flashFill.distance=25;
    // flashFill is a forward-biased point light; its position provides the directional falloff.
    this.game.flashFill.penumbra=.94;
    this.game.flashFill.decay=2;
    this.game.flashFill.intensity=this.flashlight
      ? (.10+beamPower*.55)*beamScale*flashRamp
      : 0;

    this.game.blackoutLight.position.copy(this.game.camera.position);
    const blackout=this.game.level.id==="0"&&this.game.lightState==="BLACKOUT";
    this.game.blackoutLight.intensity=blackout?.22:0;

    this.game.flashFillTarget.position.copy(this.game.camera.position)
      .addScaledVector(flashForward,2.0);

    this.game.audio.update(dt,moving,run,1-this.sanity/100,this.game.world.lightProximity(this.position.x,this.position.z),this.game.lightState,distance);
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
  const mat=entityMat(0x030303,1),wire=new THREE.LineBasicMaterial({color:0x030303,transparent:true,opacity:.94});
  const core=new THREE.Mesh(new THREE.IcosahedronGeometry(.43,1),mat);core.scale.set(1,1.3,.8);core.position.y=2.25;group.add(core);
  const parts={legs:[],arms:[],head:core};
  for(const side of [-1,1]){
    const leg=limb(group,wire,new THREE.Vector3(side*.22,.78,0),1.15,.055);leg.rotation.z=side*.3;parts.legs.push(leg);
    const arm=limb(group,wire,new THREE.Vector3(side*.48,1.65,0),1.25,.055);arm.rotation.z=-side*.28;parts.arms.push(arm);
  }
  const neck=limb(group,wire,new THREE.Vector3(0,1.72,0),.65,.05);parts.neck=neck;
  group.userData={height:3.25,parts,anim:"idle",phase:Math.random()*6.28};
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
  deathrat:{label:"Death Rat",factory:makeDeathrat,range:24,speed:2.7,attack:.75,behavior:"swarm"}
};

function animateEntity(e,dt){
  const u=e.group.userData,parts=u.parts||{},moving=e.motion||0,state=e.state;
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

class EntityManager{
  constructor(game){this.game=game;this.entities=[];this.serial=0;this.lastUpdate=0;this.bacteriaSpawned=false}
  clear(){for(const e of this.entities)this.game.scene.remove(e.group);this.entities=[];this.bacteriaSpawned=false}
  create(type,position,key=null){
    const def=ENTITY_TYPES[type];if(!def)return null;
    const group=new THREE.Group();group.position.copy(position);def.factory(group);group.userData.entityType=type;group.userData.entityLabel=def.label;
    this.game.scene.add(group);
    const e={
      key:key||"manual:"+(++this.serial),type,def,group,state:"idle",cool:0,age:0,motion:0,
      lastSeen:null,lastHeard:null,lastPlayerX:this.game.player.position.x,lastPlayerZ:this.game.player.position.z,
      stalkSeed:Math.random()*1000,waypoint:null
    };
    this.entities.push(e);return e;
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
    // Level 0 uses a delayed Bacteria encounter instead of continuously
    // populating the safe opening with hostile entities. This mirrors the
    // game adaptations where Bacteria becomes a late Lobby threat.
    if(this.game.level.id==="0"&&!this.bacteriaSpawned&&this.game.gameTime>=180){
      const p=this.game.player,rng=new RNG((this.game.seed^0xBAc7e)|0),angle=rng.next()*Math.PI*2,distance=28+rng.next()*18;
      const pos=new THREE.Vector3(p.position.x+Math.cos(angle)*distance,0,p.position.z+Math.sin(angle)*distance);
      const e=this.create("bacteria",pos,"level0:bacteria");
      if(e){e.state="stalk";e.lastSeen=null;e.lastHeard=null;this.bacteriaSpawned=true;this.game.audio.scare();this.game.triggerFear(.16);this.game.toast("SOMETHING IS MOVING.",2.2)}
    }
    for(const c of this.game.world.entitySpawns()){
      const key=c.cx+","+c.cz;if(this.entities.some(e=>e.key===key))continue;
      const type=this.game.level.entity,def=ENTITY_TYPES[type];if(!def)continue;
      const cell=this.game.level.cellSize,rng=new RNG(c.seedKey()^0x4a91),grid=this.game.level.gridSize||CELLS;
      const minSpawn=1,maxSpawn=Math.max(1,grid-2);
      const x=c.originX+rng.int(minSpawn,maxSpawn)*cell+cell/2,z=c.originZ+rng.int(minSpawn,maxSpawn)*cell+cell/2;
      this.create(type,new THREE.Vector3(x,0,z),key);
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
    for(const e of [...this.entities]){
      const dx=p.position.x-e.group.position.x,dz=p.position.z-e.group.position.z,d=Math.hypot(dx,dz)||.001;
      e.cool-=dt;e.age+=dt;e.motion=Math.max(0,e.motion-dt*2);
      const visible=entityLineOfSight(this.game,e,p),light=p.flashlight;
      const heard=entityNoise(this.game,e);
      if(visible)e.lastSeen=p.position.clone();
      if(heard)e.lastHeard=p.position.clone();
      const target=e.lastSeen||e.lastHeard;
      if(d>72&&e.key.startsWith("manual:")){this.game.scene.remove(e.group);this.entities=this.entities.filter(x=>x!==e);continue}
      const def=e.def;
      if(def.behavior==="light"){
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
        steerAroundWalls(this.game,e,predicted.sub(e.group.position),dt);
      }else if(e.state==="investigate"&&target){
        const desired=target.clone().sub(e.group.position);
        if(desired.length()>1.5)steerAroundWalls(this.game,e,desired,dt);
        else e.state="stalk";
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
    this.admin={enabled:new URLSearchParams(location.search).get("admin")==="1",god:false,noclip:false};
    this.levelId="0";this.level=LEVELS["0"];this.paused=true;this.running=false;this.dead=false;this.introActive=true;this.introPlaying=false;this.mounted=false;this.worldReady=false;this.pendingStart=false;this.gameTime=0;this.argTimer=9;this.intercomTimer=80+Math.random()*100;
    this.redZoneTimer=0;this.redZoneTrapped=false;this.redZoneId=null;this.redZoneBounds=null;
    this.redZoneFontTimer=0;
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
    this.camera=new THREE.PerspectiveCamera(62,1,.05,240);this.camera.rotation.order="YXZ";
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
    this.vhsPass=new ShaderPass(VHSShader);
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
    this.flashTarget=new THREE.Object3D();
    this.flashFillTarget=new THREE.Object3D();
    this.blackoutLight=new THREE.PointLight(0xffe8bd,0,2.6,2);
    this.blackoutLight.name="level0_blackout_proximity";
    this.blackoutLight.castShadow=false;
    this.scene.add(this.blackoutLight);
    // SpacePotato uses two deferred AreaLights for the flashlight: one broad
    // wash and one 0.25-radian directional beam. Two spotlights are the closest
    // portable WebGL equivalent without introducing a screen-space light decal.
    // Source uses two deferred AreaLights: one broad wash plus one
    // 0.25-radian directional beam. A Three.js point light is a closer visual
    // match for the broad component than another concentrated spotlight.
    this.flash=new THREE.PointLight(0xfff1d5,0,25,2);
    this.flashFill=new THREE.PointLight(0xfff1d5,0,28,2);
    this.flash.castShadow=false;
    this.flashFill.castShadow=false;
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
    document.getElementById("boot")?.classList.add("intro-ready");
    this.render();
    this.last=performance.now();
    requestAnimationFrame(this.loop.bind(this));

    // Build the procedural world before allowing the intro to hand control to gameplay.
    // configure() returns as soon as the fallback geometry exists; optional visual
    // enhancements continue in the background and can never block starting the game.
    try{
      // configure() creates the procedural fallback synchronously before any
      // remote asset work. Start the playable world from that fallback now.
      const worldLoad=this.world.configure((progress,label,detail)=>{
        this.setLoadingProgress(progress,label||"BUILDING WORLD",detail||"Generating the environment...");
      });
      this.world.ensureAround(0,0);
      const spawn=this.level.id==="0"?this.world.level0SpawnPoint():this.world.findSafeSpawn(0,0,.36);
      this.player.position.set(spawn.x,this.player.eyeY,spawn.z);
      this.worldReady=true;
      if(this.pendingStart)this.beginIntroReveal();
      worldLoad.catch(error=>{
        console.warn("[Backrooms] Optional world assets failed:",error);
      });
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
      setTimeout(activateAudioGate,16500);
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
    // The procedural fallback is enough to start. If startup was triggered
    // before mount finished, finish the initial chunk setup here instead of
    // leaving the tap waiting on a readiness flag.
    if(!this.worldReady){
      try{
        this.world.ensureAround(this.player.position.x,this.player.position.z);
        this.worldReady=true;
      }catch(error){
        console.error("[Backrooms] Initial world setup failed:",error);
        return;
      }
    }
    this.introActive=false;
    this.introPlaying=false;
    this.pendingStart=false;
    this.running=true;
    this.paused=false;
    this.dead=false;
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

  setLoadingProgress(progress,label,detail=""){
    const fill=document.getElementById("loading-fill");
    const pct=document.getElementById("loading-percent");
    const status=document.getElementById("loading-status");
    const info=document.getElementById("loading-detail");
    if(fill)fill.style.width=Math.max(0,Math.min(100,progress*100))+"%";
    if(pct)pct.textContent=Math.round(Math.max(0,Math.min(1,progress))*100).toString().padStart(2,"0");
    if(status)status.textContent=label;
    if(info)info.textContent=detail;
  }

  isTouchLayout(){return isTouchControlsDevice()}
  start(){if(this.mounted)this.beginIntroReveal();else this.pendingStart=true}
  restart(){
    document.getElementById("death").classList.add("hidden");document.getElementById("ending").classList.add("hidden");document.getElementById("pause").classList.add("hidden");
    this.seed=(Math.random()*2147483647)|0;this.levelId="0";this.setLevel("0");this.player.reset();const spawn=this.world.level0SpawnPoint();this.player.position.set(spawn.x,this.player.eyeY,spawn.z);
    this.running=true;this.paused=false;this.dead=false;this.introActive=false;document.getElementById("hud").classList.remove("hidden");
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
  setLevel(id){
    this.levelId=String(id);this.level=levelById(id);this.lightState="ON";this.lightEventTimer=48+Math.random()*55;this.redZoneTimer=0;this.redZoneTrapped=false;this.redZoneId=null;this.redZoneBounds=null;this.redZoneFontTimer=0;this.world.forceLevel0AllRed=false;this.intercomTimer=80+Math.random()*100;
    this.scene.fog=new THREE.FogExp2(this.level.id==="1"?0x070809:0x000000,this.level.id==="0"?.027:this.level.id==="1"?.024:.058);
    this.ambient.color.setHex(this.level.theme.ambient);this.ambient.groundColor.setHex(0x020303);this.ambient.intensity=this.level.id==="1"?.026:this.level.id==="0"?.032:.052;
    const flashlightColor=this.level.id==="2"?0xd9d7ff:0xfff1d5;
    this.flash.color.setHex(flashlightColor);this.flashFill.color.setHex(flashlightColor);this.world.configure();this.world.ensureAround(this.player.position.x,this.player.position.z);this.entityManager.clear();
    const levelNumber=document.getElementById("level-number");if(levelNumber)levelNumber.textContent=this.level.number;
    const levelName=document.getElementById("level-name");if(levelName)levelName.textContent=this.level.name;
    const objective=document.getElementById("objective");if(objective)objective.textContent=this.level.objective;
    const recordingLevel=document.getElementById("recording-level");if(recordingLevel)recordingLevel.textContent=this.level.number;
    const pauseLevel=document.getElementById("pause-level");if(pauseLevel)pauseLevel.textContent=this.level.number;
  }
  changeLevel(id){
    if(!id){this.ending();return}
    this.audio.exit();
    this.setLevel(id);
    if(String(id)==="1"){
      this.player.position.set(6,this.player.eyeY,3);
    }else{
      this.player.position.set(0,this.player.eyeY,0);
    }
    this.world.ensureAround(this.player.position.x,this.player.position.z);
    this.toast("You slipped into "+this.level.number+".",3);
  }
  reachExit(){if(this.level.next)this.changeLevel(this.level.next);else this.ending()}
  ending(){this.paused=true;this.running=false;document.getElementById("hud").classList.add("hidden");document.getElementById("ending").classList.remove("hidden");document.exitPointerLock?.()}
  die(copy){this.lightState="BLACKOUT";this.dead=true;this.paused=true;this.running=false;this.triggerFear(1);document.getElementById("hud").classList.add("hidden");document.getElementById("death-copy").textContent=copy;document.getElementById("death").classList.remove("hidden");document.exitPointerLock?.();this.audio.scare()}
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
      if(document.fullscreenElement)await document.exitFullscreen();
      else await document.documentElement.requestFullscreen?.();
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
    if(this.level.id!=="0"){
      this.redZoneTimer=0;this.redZoneTrapped=false;this.redZoneId=null;this.redZoneBounds=null;this.redZoneFontTimer=0;
      bar?.classList.add("hidden");
      if(bar)bar.style.fontFamily="";
      return;
    }

    const chunk=this.world.chunkAt(this.player.position.x,this.player.position.z);
    const region=chunk?.level0Region;
    const inRed=region?.type==="red";
    const id=region?.id||null;

    if(!inRed&&!this.redZoneTrapped){
      this.redZoneTimer=0;this.redZoneId=null;this.redZoneBounds=null;this.redZoneFontTimer=0;
      bar?.classList.add("hidden");
      return;
    }

    if(inRed&&this.redZoneId!==id&&!this.redZoneTrapped){
      this.redZoneId=id;
      this.redZoneTimer=60;
      const parts=String(id).split(":");
      const mx=Number(parts[1]),mz=Number(parts[2]);
      const size=this.world.size||80;
      if(id==="red:global"){
        this.redZoneBounds={
          minX:-Infinity,maxX:Infinity,minZ:-Infinity,maxZ:Infinity
        };
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
      this.redZoneFontTimer=0;
      this.triggerFear(.18);
    }

    if(this.redZoneTrapped){
      if(bar){
        bar.textContent="RED ZONE\nTRAPPED FOREVER";
        bar.classList.remove("hidden","warning");
        bar.classList.add("trapped");
        this.redZoneFontTimer-=dt;
        if(this.redZoneFontTimer<=0){
          this.redZoneFontTimer=.5;
          const fonts=this.redZoneFonts||["system-ui","sans-serif"];
          bar.style.fontFamily=fonts[Math.floor(Math.random()*fonts.length)];
        }
      }
      return;
    }

    this.redZoneTimer=Math.max(0,this.redZoneTimer-dt);
    if(this.redZoneTimer<=0){
      this.redZoneTrapped=true;
      this.triggerFear(.8);
      this.audio.ambientSting(.12);
      this.world.setLevel0AllRed(true);
      this.redZoneBounds={minX:-Infinity,maxX:Infinity,minZ:-Infinity,maxZ:Infinity};
      if(bar){
        bar.textContent="RED ZONE\nTRAPPED FOREVER";
        bar.classList.remove("hidden","warning");
        bar.classList.add("trapped");
      }
      return;
    }

    if(bar){
      const seconds=Math.ceil(this.redZoneTimer);
      bar.textContent="RED ZONE\nMOST DANGEROUS AREA\nLEAVE IN "+seconds+"s";
      bar.classList.remove("hidden","trapped");
      bar.classList.add("warning");
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
      // SpacePotatoee/MinecraftFoundFootage uses 20 ticks for the generic blackout event.
      // Minecraft runs at 20 ticks per second, so this is exactly 1 second here.
      this.lightEventTimer=this.level.id==="0"?1:30;
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
    }else{
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
    const sources=this.world.nearbyLightSources(this.player.position.x,this.player.position.z,lightFrustum,this.camera);
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
      target.intensity=source.intensity;
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
    const t=Math.floor(this.gameTime),h=String(Math.floor(t/3600)%24).padStart(2,"0"),m=String(Math.floor(t/60)%60).padStart(2,"0"),s=String(t%60).padStart(2,"0");
    const rec=document.getElementById("rec-time");if(rec)rec.textContent=h+":"+m+":"+s;
    if(this.argTimer<=0&&this.running&&!this.paused){
      this.argTimer=14+Math.random()*28;
      const messages=this.level.id==="0"
        ? ["AUDIO SOURCE: UNKNOWN","ROOM INDEX DESYNC","DOOR COUNT DOES NOT MATCH","FRAME DROP / 00:00:07","DO NOT TRUST THE HUM"]
        : this.level.id==="1"
        ? ["SIGNAL: SECONDARY CARRIER","CAMERA CLOCK DRIFT","MOTION DETECTED","NO EXIT MARKER IN RANGE"]
        : ["POWER BUS: UNSTABLE","FEED: 03:19:XX","THERMAL SIGNATURE LOST","SOMETHING MOVED BETWEEN FRAMES"];
      this.showArgMessage(messages[Math.floor(Math.random()*messages.length)]);
      if(Math.random()<.46)this.audio.distantKnock();
    }
  }

  showArgMessage(message){
    const el=document.getElementById("arg-message");if(!el)return;
    el.textContent=message;el.classList.remove("hidden","glitch");void el.offsetWidth;el.classList.add("glitch");
    clearTimeout(this.argMessageTimer);this.argMessageTimer=setTimeout(()=>el.classList.add("hidden"),2300+Math.random()*2400);
  }

  render(){this.vhsPass.uniforms.resolution.value.set(Math.max(1,this.renderer.domElement.clientWidth||innerWidth),Math.max(1,this.renderer.domElement.clientHeight||innerHeight));this.composer.render()}
  loop(now){
    const raw=(now-this.last)/1000;this.last=now;
    const dt=Math.min(MAX_DT,raw);
    try{
      if(this.running&&!this.paused)this.update(dt);
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
