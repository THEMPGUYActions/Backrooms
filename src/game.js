import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { InputManager } from "./input.js?v=20260923-1950";
import { AudioDirector } from "./audio.js?v=20260923-1950";
import { LEVELS, levelById, cycleHash } from "./levels.js?v=20260923-1950";
import { makeLibrary, applyOpenGameArtPBR, applySpacePotatoLevel1Assets, disposeLibrary, box, makePropSet } from "./assets.js?v=20260923-1950";

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

class Chunk{
  constructor(world,cx,cz){
    this.world=world;this.game=world.game;this.cx=cx;this.cz=cz;
    this.originX=cx*world.size-world.size/2;this.originZ=cz*world.size-world.size/2;
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
    this.walls=new Uint8Array(this.gridSize()*this.gridSize());this.hazards=[];this.exit=null;this.falseDoors=[];this.entitySpawn=false;this.fixtures=[];this.lightSources=[];this.batteries=[];this.crates=[];this.zone="halls";this.rooms=[];
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
    const cells=this.gridSize(),level=this.game.level;
    const rng=new RNG((Math.imul(this.cx,73856093)^Math.imul(this.cz,19349663)^this.game.seed)|0);
    this.walls.fill(15);this.rooms=[];

    if(level.id==="1"){
      // SpacePotato's Level 1 uses two real generation paths:
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
      const mega=this.cx===0&&this.cz===0||cycleHash(this.game.seed,this.cx,this.cz,77)<.38;
      if(mega){
        this.walls.fill(0);
        for(let z=0;z<cells;z++){this.walls[this.index(0,z)]|=8;this.walls[this.index(cells-1,z)]|=2}
        for(let x=0;x<cells;x++){this.walls[this.index(x,0)]|=1;this.walls[this.index(x,cells-1)]|=4}
        const partitions=rng.int(0,3);
        for(let i=0;i<partitions;i++){
          const vertical=rng.next()<.5;
          if(vertical){const x=rng.int(1,cells-2),gap=rng.int(1,cells-2);for(let z=1;z<cells-1;z++)if(z!==gap)this.setEdge(x,z,"east",false)}
          else{const z=rng.int(1,cells-2),gap=rng.int(1,cells-2);for(let x=1;x<cells-1;x++)if(x!==gap)this.setEdge(x,z,"south",false)}
        }
      }else{
        const visited=new Uint8Array(cells*cells),stack=[[0,0]];visited[this.index(0,0)]=1;
        while(stack.length){
          const [x,z]=stack[stack.length-1],options=[];
          for(const [dx,dz,b,ob,side] of [[0,-1,1,4,"north"],[1,0,2,8,"east"],[0,1,4,1,"south"],[-1,0,8,2,"west"]]){
            const nx=x+dx,nz=z+dz;
            if(nx>=0&&nx<cells&&nz>=0&&nz<cells&&!visited[this.index(nx,nz)])options.push([nx,nz,b,ob,side]);
          }
          if(!options.length){stack.pop();continue}
          const [nx,nz,b,ob]=rng.pick(options);
          this.walls[this.index(x,z)]&=~b;this.walls[this.index(nx,nz)]&=~ob;
          visited[this.index(nx,nz)]=1;stack.push([nx,nz]);
        }
        for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){
          if(x<cells-1&&rng.next()<.18)this.setEdge(x,z,"east",true);
          if(z<cells-1&&rng.next()<.18)this.setEdge(x,z,"south",true);
        }
      }
      if(cells>=5){
        if((this.cx+this.cz)%2===0)this.setEdge(2,0,"north",true);
        if((this.cx-this.cz)%2===0)this.setEdge(2,cells-1,"south",true);
        if(this.cz%2===0)this.setEdge(0,2,"west",true);
        if(this.cx%2===0)this.setEdge(cells-1,2,"east",true);
      }
      if(this.cx===0&&this.cz===0){
        this.setEdge(2,2,"north",true);this.setEdge(2,2,"east",true);this.setEdge(2,2,"south",true);this.setEdge(2,2,"west",true);
      }
    }else{
      const visited=new Uint8Array(cells*cells),stack=[[Math.floor(cells/2),Math.floor(cells/2)]];
      visited[this.index(Math.floor(cells/2),Math.floor(cells/2))]=1;
      const dirs=[[0,-1,1,4],[1,0,2,8],[0,1,4,1],[-1,0,8,2]];
      while(stack.length){
        const [x,z]=stack[stack.length-1],options=[];
        for(const [dx,dz,b,ob] of dirs){
          const nx=x+dx,nz=z+dz;
          if(nx>=0&&nx<cells&&nz>=0&&nz<cells&&!visited[this.index(nx,nz)])options.push([nx,nz,b,ob]);
        }
        if(!options.length){stack.pop();continue}
        const [nx,nz,b,ob]=rng.pick(options);
        this.walls[this.index(x,z)]&=~b;this.walls[this.index(nx,nz)]&=~ob;
        visited[this.index(nx,nz)]=1;stack.push([nx,nz]);
      }
      const loopChance=level.id==="1"?.12:.07;
      for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){if(x<cells-1&&rng.next()<loopChance)this.setEdge(x,z,"east",true);if(z<cells-1&&rng.next()<loopChance*.82)this.setEdge(x,z,"south",true)}
    }

    if(level.id!=="1"){
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
      if(rng2.next()<level.holeChance&&Math.hypot(x-(cells-1)/2,z-(cells-1)/2)>1.7)this.hazards.push({x,z});
    }

    const chunkDistance=Math.hypot(this.cx,this.cz),minCell=1,maxCell=Math.max(1,cells-2);
    const level1ExitSector=level.id==="1"&&this.zone==="maze"&&!((this.cx===0&&this.cz===0));
    if(level.id==="1"){
      // SpacePotato's Level1ChunkGenerator places the level2 stairwell only
      // in the non-megaroom path, outside the spawn radius, with a 50% roll.
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
        const chosen=rng2.pick(candidates),kind=level.id==="0"?(rng2.next()<.62?"door":"flicker-wall"):"door";
        if(kind==="door")this.setEdge(chosen.x,chosen.z,chosen.side,true);
        this.exit={...chosen,kind};
      }
    }
    if(level.id==="0"&&rng2.next()<.55){
      const candidates=[];
      for(let z=minCell;z<=maxCell;z++)for(let x=minCell;x<=maxCell;x++){
        const mask=this.walls[this.index(x,z)];
        if(mask&1)candidates.push({x,z,side:"north"});if(mask&2)candidates.push({x,z,side:"east"});if(mask&4)candidates.push({x,z,side:"south"});if(mask&8)candidates.push({x,z,side:"west"});
      }
      if(candidates.length)this.falseDoors.push(rng2.pick(candidates));
    }
  }
  seedKey(){return (this.cx*73856093)^(this.cz*19349663)^this.game.seed}
  buildGeometry(){
    const cells=this.gridSize();
    const g=this.group,level=this.game.level,lib=this.world.library,size=this.world.size,cell=level.cellSize;
    const wallThickness=.18;
    const hGeom=new THREE.BoxGeometry(cell,level.wallHeight,wallThickness),vGeom=new THREE.BoxGeometry(wallThickness,level.wallHeight,cell);
    const trimHGeom=new THREE.BoxGeometry(cell,.11,.12),trimVGeom=new THREE.BoxGeometry(.12,.11,cell);
    const topHGeom=new THREE.BoxGeometry(cell,.075,.09),topVGeom=new THREE.BoxGeometry(.09,.075,cell);
    const hData=[],vData=[],trimH=[],trimV=[],topH=[],topV=[],edges=[],rngBase=new RNG(this.seedKey());
    const wallMaterial=level.id==="1"?lib.concrete:lib.wall;
    const seenH=new Set(),seenV=new Set();
    const pushMat=(arr,x,y,z)=>{const m=new THREE.Matrix4();m.compose(new THREE.Vector3(x,y,z),new THREE.Quaternion(),new THREE.Vector3(1,1,1));arr.push(m)};
    const key=(x,z,s)=>s+"|"+x+"|"+z;

    for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){
      const mask=this.walls[this.index(x,z)],px=this.originX+x*cell+cell/2,pz=this.originZ+z*cell+cell/2;
      const addEdge=(side)=>{
        if(side==="north"){
          const k=key(x,z,side);if(seenH.has(k))return;seenH.add(k);
          pushMat(hData,px,level.wallHeight/2,pz-cell/2);pushMat(trimH,px,.065,pz-cell/2);pushMat(topH,px,level.wallHeight-.04,pz-cell/2);edges.push({x,z,side});
        }else if(side==="south"){
          const k=key(x,z+1,"north");if(seenH.has(k))return;seenH.add(k);
          pushMat(hData,px,level.wallHeight/2,pz+cell/2);pushMat(trimH,px,.065,pz+cell/2);pushMat(topH,px,level.wallHeight-.04,pz+cell/2);edges.push({x,z,side});
        }else if(side==="west"){
          const k=key(x,z,side);if(seenV.has(k))return;seenV.add(k);
          pushMat(vData,px-cell/2,level.wallHeight/2,pz);pushMat(trimV,px-cell/2,.065,pz);pushMat(topV,px-cell/2,level.wallHeight-.04,pz);edges.push({x,z,side});
        }else{
          const k=key(x+1,z,"west");if(seenV.has(k))return;seenV.add(k);
          pushMat(vData,px+cell/2,level.wallHeight/2,pz);pushMat(trimV,px+cell/2,.065,pz);pushMat(topV,px+cell/2,level.wallHeight-.04,pz);edges.push({x,z,side});
        }
      };
      if(mask&1)addEdge("north");
      if(mask&8)addEdge("west");
      if(z===cells-1&&(mask&4))addEdge("south");
      if(x===cells-1&&(mask&2))addEdge("east");

      const fixtureSlot=level.id==="0"?x%2===0&&z%2===0:true;
      const fixtureChance=level.id==="0"?.78:level.id==="1"?0:.13;
      if(fixtureSlot&&rngBase.next()<fixtureChance){
        const fixtureMat=level.id==="2"&&rngBase.next()<.28?lib.orangeLight:lib.light,fixtureMaterial=fixtureMat.clone();
        const rotation=rngBase.next()<.5?0:Math.PI/2,jx=(rngBase.next()-.5)*1.8,jz=(rngBase.next()-.5)*1.8;
        const fixture=box(g,new THREE.BoxGeometry(3.7,.045,.72),fixtureMaterial,px+jx,level.wallHeight-.11,pz+jz,0,rotation,0);
        box(g,new THREE.BoxGeometry(4.0,.11,.9),lib.metal,px+jx,level.wallHeight-.045,pz+jz,0,rotation,0);
        fixture.userData.light=true;fixture.userData.baseEmissive=fixtureMat.emissiveIntensity;this.fixtures.push(fixture);
        {
          const lightColor=fixtureMat===lib.orangeLight?0xff9b52:level.theme.light;
          const intensity=level.id==="0"?320:level.id==="3"?220:level.id==="4"?110:170;
          this.lightSources.push({
            position:new THREE.Vector3(px+jx,level.wallHeight-.24,pz+jz),
            color:lightColor,
            baseIntensity:intensity,
            intensity,
            distance:0,
            decay:2,
            fixture
          });
        }
      }
    }

    const addInstanced=(geometry,material,data)=>{
      if(!data.length)return;
      const mesh=new THREE.InstancedMesh(geometry,material,data.length);
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      data.forEach((m,i)=>mesh.setMatrixAt(i,m));
      mesh.instanceMatrix.needsUpdate=true;
      mesh.count=data.length;
      mesh.frustumCulled=true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      g.add(mesh);
    };
    addInstanced(hGeom,wallMaterial,hData);addInstanced(vGeom,wallMaterial,vData);
    if(level.id!=="1"){
      addInstanced(trimHGeom,lib.trim,trimH);
      addInstanced(trimVGeom,lib.trim,trimV);
      addInstanced(topHGeom,lib.trimTop,topH);
      addInstanced(topVGeom,lib.trimTop,topV);
    }

    if(level.id==="1")this.buildLevel1Set(level,lib,rngBase);

    if(level.id==="0"){
      const columnGeom=new THREE.BoxGeometry(.72,level.wallHeight,.72),columnData=[],columnCount=3+rngBase.int(0,4);
      for(let i=0;i<columnCount;i++){
        const cx=.75+rngBase.next()*(cells-1.5),cz=.75+rngBase.next()*(cells-1.5);
        columnData.push(new THREE.Matrix4().makeTranslation(this.originX+cx*cell,level.wallHeight/2,this.originZ+cz*cell));
      }
      if(columnData.length){
        const columns=new THREE.InstancedMesh(columnGeom,lib.wall,columnData.length);
        columns.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        columnData.forEach((m,i)=>columns.setMatrixAt(i,m));
        columns.instanceMatrix.needsUpdate=true;
        columns.computeBoundingBox();
        columns.computeBoundingSphere();
        columns.frustumCulled=true;
        g.add(columns);
      }
    }

    for(const hz of this.hazards){
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

    for(let i=0;i<Math.min(9,edges.length);i++){
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

    if(level.id==="0"&&rngBase.next()<.18&&edges.length){
      const e=rngBase.pick(edges),p=wallPoint(e,.108,1.48),group=new THREE.Group();
      group.position.copy(p.position);group.rotation.y=p.rotation;
      box(group,new THREE.BoxGeometry(.46,.3,.07),lib.intercom,0,0,0);
      for(let i=-1;i<=1;i++)box(group,new THREE.BoxGeometry(.28,.018,.018),lib.intercomSlot,0,.075+i*.055,.041);
      box(group,new THREE.BoxGeometry(.055,.055,.018),lib.intercomSlot,.17,-.08,.041);
      g.add(group);
    }

    if(level.id==="0"&&rngBase.next()<.3){
      const camGroup=new THREE.Group();
      camGroup.position.set(this.originX+cell*.5+cell*(cells-1)*rngBase.next(),level.wallHeight-.18,this.originZ+cell*.5+cell*(cells-1)*rngBase.next());
      const dome=new THREE.Mesh(new THREE.SphereGeometry(.17,10,6,0,Math.PI*2,0,Math.PI/2),lib.cameraDome);dome.scale.y=.65;camGroup.add(dome);
      box(camGroup,new THREE.BoxGeometry(.06,.06,.045),lib.socket,0,-.055,-.11);
      g.add(camGroup);
    }

    const buildDoor=(entry,exitDoor)=>{
      const p=wallPoint(entry,.105,1.95),group=new THREE.Group();group.position.copy(p.position);group.rotation.y=p.rotation;
      const frameMat=exitDoor?lib.exitFrame:lib.doorFrame;
      box(group,new THREE.BoxGeometry(.16,3.9,.24),frameMat,-1.02,0,0);
      box(group,new THREE.BoxGeometry(.16,3.9,.24),frameMat,1.02,0,0);
      box(group,new THREE.BoxGeometry(3.35,.16,.24),frameMat,0,1.31,0);
      const door=box(group,new THREE.BoxGeometry(3.1,3.62,.09),(exitDoor?lib.exitDoor:lib.door).clone(),0,0,0);
      door.rotation.z=exitDoor?-0.16:-0.03;
      if(exitDoor)door.userData.exit=true;
      box(group,new THREE.BoxGeometry(.08,.1,.045),lib.handle,.78,.02,.06);
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

    if(level.id==="0"&&rngBase.next()<.12){
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
  buildLevel1Set(level,lib,rng){
    const g=this.group,cell=level.cellSize,cells=this.gridSize(),size=this.world.size;
    const next=()=>rng.next();
    const center=(x,z)=>({
      x:this.originX+x*cell+cell/2,
      z:this.originZ+z*cell+cell/2
    });

    const addLight=(x,z,rotation=0,scale=1,intensity=105)=>{
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
      // SpacePotato's megaroom1: long sightlines with repeating square
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

    this.floorSurface=new THREE.Mesh(
      new THREE.PlaneGeometry(this.surfaceSize,this.surfaceSize),
      this.library.floor
    );
    this.floorSurface.rotation.x=-Math.PI/2;
    this.floorSurface.position.set(0,0,0);
    this.floorSurface.updateMatrix();
    this.floorSurface.matrixAutoUpdate=false;
    this.floorSurface.frustumCulled=false;
    this.floorSurface.renderOrder=-2;

    this.ceilingSurface=new THREE.Mesh(
      new THREE.PlaneGeometry(this.surfaceSize,this.surfaceSize),
      this.library.ceiling
    );
    this.ceilingSurface.rotation.x=Math.PI/2;
    this.ceilingSurface.position.set(0,this.game.level.wallHeight+.025,0);
    this.ceilingSurface.updateMatrix();
    this.ceilingSurface.matrixAutoUpdate=false;
    this.ceilingSurface.frustumCulled=false;
    this.ceilingSurface.renderOrder=-2;

    this.game.scene.add(this.floorSurface,this.ceilingSurface);
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

    // The procedural fallback is complete at this point. Do not make startup
    // depend on remote texture downloads or external asset hosts.
    void (async()=>{
      try{
        if(this.game.level.id==="1"){
          await applySpacePotatoLevel1Assets(this.library,this.game.level,onProgress);
        }else{
          await applyOpenGameArtPBR(this.library,this.game.level,onProgress);
        }
      }catch(error){
        console.warn("[Backrooms] Surface asset enhancement failed; procedural fallback remains active.",error);
      }
      this.updateSurfaceTiling();
    })();

    return true;
  }

  updateSurfaceTiling(){
    const surfaces=this.game.level.id==="1"
      ? [
          {material:this.library?.floor,tileWorld:5.4},
          {material:this.library?.ceiling,tileWorld:5.4}
        ]
      : [
          {material:this.library?.floor,tileWorld:3.2},
          {material:this.library?.ceiling,tileWorld:1.6}
        ];

    for(const {material,tileWorld} of surfaces){
      if(!material)continue;
      const repeat=this.surfaceSize/tileWorld;
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
    const cx=Math.floor((x+this.size/2)/this.size),cz=Math.floor((z+this.size/2)/this.size);
    return this.chunks.get(this.key(cx,cz))||null;
  }
  ensureAround(x,z){
    const cx=Math.floor((x+this.size/2)/this.size),cz=Math.floor((z+this.size/2)/this.size);
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
  currentCell(){const c=this.chunkAt(this.game.player.position.x,this.game.player.position.z);return c?c.cellAt(this.game.player.position.x,this.game.player.position.z):null}
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
    const cell=this.game.level.cellSize,wallRadius=radius+.11;
    let x=position.x,z=position.z;

    for(let pass=0;pass<2;pass++){
      const baseX=Math.floor((x-chunk.originX)/cell);
      const baseZ=Math.floor((z-chunk.originZ)/cell);
      for(let iz=baseZ-1;iz<=baseZ+1;iz++)for(let ix=baseX-1;ix<=baseX+1;ix++){
        if(ix<0||iz<0||ix>=chunk.gridSize()||iz>=chunk.gridSize())continue;
        const mask=chunk.walls[chunk.index(ix,iz)];
        const minX=chunk.originX+ix*cell,maxX=minX+cell;
        const minZ=chunk.originZ+iz*cell,maxZ=minZ+cell;

        const testWall=(x1,z1,x2,z2,nx,nz,closed)=>{
          if(!closed)return;
          const sx=x2-x1,sz=z2-z1,lenSq=sx*sx+sz*sz||1;
          const t=Math.max(0,Math.min(1,((x-x1)*sx+(z-z1)*sz)/lenSq));
          const qx=x1+sx*t,qz=z1+sz*t;
          let dx=x-qx,dz=z-qz,dist=Math.hypot(dx,dz);
          if(dist<wallRadius){
            if(dist<.0001){dx=nx;dz=nz;dist=1}
            const push=wallRadius-dist;
            x+=dx/dist*push;z+=dz/dist*push;
          }
        };

        testWall(minX,minZ,maxX,minZ,0,-1,(mask&1)!==0);
        testWall(maxX,minZ,maxX,maxZ,1,0,(mask&2)!==0);
        testWall(minX,maxZ,maxX,maxZ,0,1,(mask&4)!==0);
        testWall(minX,minZ,minX,maxZ,-1,0,(mask&8)!==0);
      }
    }
    return {x,z};
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
    const cx=Math.floor((x+this.size/2)/this.size),cz=Math.floor((z+this.size/2)/this.size);
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
    const cx=Math.floor((x+this.size/2)/this.size),cz=Math.floor((z+this.size/2)/this.size);
    const bounds=this._lightBounds||(this._lightBounds=new THREE.Sphere(new THREE.Vector3(),2.05));
    const view=this._lightViewPosition||(this._lightViewPosition=new THREE.Vector3());
    const verticalFov=THREE.MathUtils.degToRad(camera?.getEffectiveFOV?.()??camera?.fov??62);
    const horizontalFov=2*Math.atan(Math.tan(verticalFov*.5)*(camera?.aspect||1));
    const halfV=verticalFov*.5;
    const halfH=horizontalFov*.5;
    for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){
      const c=this.chunks.get(this.key(cx+dx,cz+dz));if(!c)continue;
      for(const light of c.lightSources){
        const d=Math.hypot(light.position.x-x,light.position.z-z);
        if(d>Math.max(96,this.size*2.6))continue;
        view.copy(light.position).applyMatrix4(camera.matrixWorldInverse);
        if(view.z>=-0.05||-view.z>camera.far+20)continue;
        if(Math.abs(Math.atan2(view.x,-view.z))>halfH||Math.abs(Math.atan2(view.y,-view.z))>halfV)continue;
        if(frustum){
          bounds.center.copy(light.position);
          if(!frustum.intersectsSphere(bounds))continue;
        }
        const horizontal=Math.abs(Math.atan2(view.x,-view.z))/Math.max(.001,halfH);
        const vertical=Math.abs(Math.atan2(view.y,-view.z))/Math.max(.001,halfV);
        const edge=Math.min(1,Math.max(horizontal,vertical));
        const score=d*(1+edge*.9);
        out.push({light,d,score});
      }
    }
    out.sort((a,b)=>a.score-b.score);
    return out;
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
    this.eyeY=1.72;this.bob=0;this.bobStrength=0;this.shake=0;this.cameraFov=62;
    this.viewYaw=0;this.viewPitch=0;
  }
  reset(){
    this.position.set(0,this.eyeY,0);this.yaw=0;this.pitch=0;this.viewYaw=0;this.viewPitch=0;
    this.bob=0;this.bobStrength=0;this.shake=0;this.cameraFov=62;
    this.health=this.stamina=this.hydration=this.sanity=100;this.flashBattery=100;
    this.flashlight=this.game.startFlash;
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
    const mv=input.getMove(),run=input.wantsRun()&&this.stamina>4&&Math.hypot(mv.x,mv.y)>.12,speed=run?4.75:2.85;
    const forward=new THREE.Vector3(-Math.sin(this.viewYaw),0,-Math.cos(this.viewYaw)),right=new THREE.Vector3(Math.cos(this.viewYaw),0,-Math.sin(this.viewYaw));
    const delta=new THREE.Vector3().addScaledVector(right,mv.x).addScaledVector(forward,-mv.y);if(delta.lengthSq()>1)delta.normalize();
    const oldX=this.position.x,oldZ=this.position.z;
    this.position.x+=delta.x*speed*dt;this.position.z+=delta.z*speed*dt;
    const col=this.game.world.collision(this.position,.34);this.position.x=col.x;this.position.z=col.z;
    if(run)this.stamina=Math.max(0,this.stamina-dt*15);else this.stamina=Math.min(100,this.stamina+dt*9);
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
    const beamPower=Math.pow(batteryPower,.82);
    this.game.flash.position.copy(this.game.camera.position);
    this.game.flash.intensity=this.flashlight?(20+beamPower*700):0;
    this.game.flash.distance=this.flashlight?(10+beamPower*105):10;
    this.game.flash.angle=.36;
    this.game.flash.penumbra=.54;
    this.game.flashTarget.position.copy(this.game.camera.position).add(new THREE.Vector3(0,0,-1).applyQuaternion(this.game.camera.quaternion));
    this.game.audio.update(dt,moving,run,1-this.sanity/100,this.game.world.lightProximity(this.position.x,this.position.z),this.game.lightState,distance);
  }
}

class EntityManager{
  constructor(game){this.game=game;this.entities=[]}
  clear(){for(const e of this.entities)this.game.scene.remove(e.group);this.entities=[]}
  spawnForChunks(){
    for(const c of this.game.world.entitySpawns()){
      const key=c.cx+","+c.cz;if(this.entities.some(e=>e.key===key))continue;
      const cell=this.game.level.cellSize,rng=new RNG(c.seedKey()^0x4a91);
      const grid=this.game.level.gridSize||CELLS,minSpawn=1,maxSpawn=Math.max(1,grid-2);const x=c.originX+rng.int(minSpawn,maxSpawn)*cell+cell/2,z=c.originZ+rng.int(minSpawn,maxSpawn)*cell+cell/2,type=this.game.level.entity;
      if(type==="none")continue;
      const group=new THREE.Group();group.position.set(x,0,z);
      if(type==="hound"){
        const mat=new THREE.MeshStandardMaterial({color:0x050505,roughness:.95,metalness:.05});
        const body=box(group,new THREE.SphereGeometry(.48,12,8),mat,0,.75,0);body.scale.set(.8,1.25,1.15);
        box(group,new THREE.CapsuleGeometry(.12,.62,5,8),mat,-.3,.45,-.18,0,.12,.1);
        box(group,new THREE.CapsuleGeometry(.12,.62,5,8),mat,.3,.45,-.18,0,-.12,-.1);
        const eye=new THREE.MeshStandardMaterial({color:0xffe7a8,emissive:0xffd36a,emissiveIntensity:5});
        box(group,new THREE.SphereGeometry(.055,8,8),eye,-.12,.86,-.42);box(group,new THREE.SphereGeometry(.055,8,8),eye,.12,.86,-.42);
      }else if(type==="figure"){
        const mat=new THREE.MeshStandardMaterial({color:0x010101,roughness:1,metalness:0,transparent:true,opacity:.82});
        const body=box(group,new THREE.CapsuleGeometry(.16,.98,6,8),mat,0,1.05,0);
        body.scale.set(.72,1.35,.62);
        box(group,new THREE.SphereGeometry(.19,10,7),mat,0,1.86,0);
        box(group,new THREE.CapsuleGeometry(.045,.92,5,7),mat,-.23,1.02,0,0,0,-.08);
        box(group,new THREE.CapsuleGeometry(.045,.92,5,7),mat,.23,1.02,0,0,0,.08);
      }else{
        const mat=new THREE.MeshStandardMaterial({color:0x020202,roughness:1});
        box(group,new THREE.SphereGeometry(.72,16,10),mat,0,1.4,0);
        const eyeMat=new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xffffff,emissiveIntensity:14});
        box(group,new THREE.SphereGeometry(.08,8,8),eyeMat,-.18,1.52,-.66);box(group,new THREE.SphereGeometry(.08,8,8),eyeMat,.18,1.52,-.66);
        box(group,new THREE.TorusGeometry(.28,.055,6,20,Math.PI),eyeMat,0,1.27,-.67,0,Math.PI,0);
      }
      group.scale.setScalar(.9+rng.next()*.4);this.game.scene.add(group);this.entities.push({key,type,group,state:"idle",cool:0});
      if(type==="figure")this.game.triggerFear(.02);
    }
  }
  update(dt){
    const p=this.game.player;
    for(const e of [...this.entities]){
      const dx=p.position.x-e.group.position.x,dz=p.position.z-e.group.position.z,d=Math.hypot(dx,dz);e.cool-=dt;
      if(d>50){this.game.scene.remove(e.group);this.entities=this.entities.filter(x=>x!==e);continue}
      if(e.type==="hound"){
        const forward=new THREE.Vector3(-Math.sin(p.viewYaw),0,-Math.cos(p.viewYaw)),to=new THREE.Vector3(dx,0,dz).normalize(),looking=forward.dot(to)<-.48;
        if(d<13&&!looking&&e.state!=="chase"){e.state="chase";this.game.audio.scare();this.game.triggerFear(.45);e.cool=2.7}
        if(d<10&&looking)e.state="intimidated";
        if(e.state==="chase"&&e.cool<=0){const s=1.45*dt;e.group.position.x+=dx/d*s;e.group.position.z+=dz/d*s}
        if(e.state==="intimidated"){e.group.position.x-=dx/d*.7*dt;e.group.position.z-=dz/d*.7*dt;if(d>14)e.state="idle"}
        e.group.lookAt(p.position.x,1,p.position.z);if(d<1.05&&e.state==="chase"){p.health-=dt*38;this.game.audio.hurt()}
      }else if(e.type==="figure"){
        const forward=new THREE.Vector3(-Math.sin(p.viewYaw),0,-Math.cos(p.viewYaw)),to=new THREE.Vector3(dx,0,dz).normalize();
        const looking=forward.dot(to)<-.78;
        if(d<28&&!looking){
          e.group.position.x+=dx/d*.32*dt;
          e.group.position.z+=dz/d*.32*dt;
          e.group.visible=true;
        }
        if(looking&&d<24)e.group.userData.seen=(e.group.userData.seen||0)+dt;
        else e.group.userData.seen=0;
        if(e.group.userData.seen>.35){
          e.group.visible=false;
          e.group.position.x+=-dx/d*1.8;
          e.group.position.z+=-dz/d*1.8;
          e.group.userData.seen=0;
        }
        if(d<18)this.game.triggerFear(.07*dt);
        e.group.lookAt(p.position.x,1.2,p.position.z);
      }else{
        const lightOn=p.flashlight;if(lightOn&&d<18){e.group.position.x-=dx/d*dt*2.2;e.group.position.z-=dz/d*dt*2.2}
        if(!lightOn&&d<15){e.group.position.x+=dx/d*dt*1.4;e.group.position.z+=dz/d*dt*1.4}
        if(d<1.1&&!this.game.admin?.god){p.health-=dt*42;this.game.audio.hurt()}e.group.lookAt(p.position.x,1,p.position.z);
      }
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
    if(this.mode==="low")return{pixel:1,radius:2};
    if(this.mode==="medium")return{pixel:1,radius:2};
    if(this.mode==="high")return{pixel:1.15,radius:2};
    return{pixel:Math.min(devicePixelRatio,1.0),radius:2};
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
    this.seed=(Number(localStorage.getItem("br.seed"))||Math.floor(Math.random()*2147483647))|0;localStorage.setItem("br.seed",String(this.seed));
    this.admin={enabled:new URLSearchParams(location.search).get("admin")==="1",god:false,noclip:false};
    this.levelId="0";this.level=LEVELS["0"];this.paused=true;this.running=false;this.dead=false;this.introActive=true;this.introPlaying=false;this.mounted=false;this.worldReady=false;this.pendingStart=false;this.gameTime=0;this.argTimer=9;this.intercomTimer=80+Math.random()*100;
    this.settings={
      shake:localStorage.getItem("br.shake")!=="0",
      sensitivity:Math.max(.5,Math.min(2,Number(localStorage.getItem("br.sensitivity")||1)))
    };
    this.startFlash=localStorage.getItem("br.flash")!=="0";
    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color(0x000000);
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
    const localLightCount=isTouchControlsDevice()?14:24;
    for(let i=0;i<localLightCount;i++){
      const light=new THREE.PointLight(0xffd34d,0,0,2);
      light.name="dynamic_fluorescent_"+i;
      light.visible=true;
      this.localLights.push(light);
      this.scene.add(light);
    }this.entityManager=new EntityManager(this);this.quality=new AdaptiveQuality(this);
    this.ambient=new THREE.HemisphereLight(0x665f52,0x080807,.052);this.scene.add(this.ambient);
    this.flashTarget=new THREE.Object3D();this.flash=new THREE.SpotLight(0xfffff1,0,10,.36,.54,2);this.flash.castShadow=false;this.flash.target=this.flashTarget;this.scene.add(this.flash,this.flashTarget);
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

    $("resume")?.addEventListener("click",()=>this.togglePause(false));
    $("restart")?.addEventListener("click",()=>this.restart());
    $("retry")?.addEventListener("click",()=>this.restart());
    $("again-ending")?.addEventListener("click",()=>this.restart());
    $("fullscreen")?.addEventListener("click",()=>this.toggleFullscreen());

    const quality=$("quality");
    if(quality){quality.value=this.quality.mode;quality.onchange=e=>this.quality.set(e.target.value)}
    const volume=$("volume");
    if(volume){volume.value=String(this.audio.volume);volume.oninput=e=>this.audio.setVolume(e.target.value)}
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
    this.seed=(Math.random()*2147483647)|0;localStorage.setItem("br.seed",String(this.seed));this.levelId="0";this.setLevel("0");this.player.reset();
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
    this.levelId=String(id);this.level=levelById(id);this.lightState="ON";this.lightEventTimer=48+Math.random()*55;this.intercomTimer=80+Math.random()*100;
    this.scene.fog=new THREE.FogExp2(this.level.id==="1"?0x070809:0x000000,this.level.id==="0"?.027:this.level.id==="1"?.024:.058);
    this.ambient.color.setHex(this.level.theme.ambient);this.ambient.groundColor.setHex(0x020303);this.ambient.intensity=this.level.id==="1"?.026:.052;
    this.flash.color.setHex(this.level.id==="2"?0xd9d7ff:0xffffee);this.world.configure();this.world.ensureAround(this.player.position.x,this.player.position.z);this.entityManager.clear();
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
    const mobile=document.getElementById("mobile-controls");
    mobile?.classList.toggle("paused",this.paused);
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
      this.lightEventTimer=this.level.id==="1"?30:10+Math.random()*18;
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
    if(this.running&&!this.paused&&this.level.id==="0"){
      this.intercomTimer-=dt;
      if(this.intercomTimer<=0){
        this.intercomTimer=110+Math.random()*170;
        if(Math.random()<.72){this.audio.intercom();this.triggerFear(.08);}
      }
    }
    document.documentElement.style.setProperty("--fear",this.horror.toFixed(3));
    document.body.classList.toggle("fear",this.horror>.08);
    if(!this.running||this.paused||this.dead||this.scareTimer>0)return;
    this.scareTimer=18+Math.random()*35;
    if(Math.random()<(this.level.id==="0"?.58:.76)){this.audio.distantKnock((Math.random()<.5?-1:1)*(.85+Math.random()*1.1));this.triggerFear(this.level.id==="2"?.32:.18)}
    if(Math.random()<.28){this.audio.ambientSting(.08+Math.random()*.08);this.triggerFear(.12)}
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
    this.player.update(dt);this.world.update(dt);this.collectBatteryPickups();this.updateLocalLights();this.entityManager.update(dt);this.quality.update(dt);
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
    this.flash.position.copy(this.camera.position);
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
