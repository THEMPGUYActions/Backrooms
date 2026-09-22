import * as THREE from "three";
import { InputManager } from "./input.js";
import { AudioDirector } from "./audio.js";
import { LEVELS, levelById, cycleHash } from "./levels.js";
import { makeLibrary, applyOpenGameArtPBR, disposeLibrary, box, makePropSet } from "./assets.js";

const CELLS=16;
const BASE_RADIUS=1;
const MAX_DT=.05;

class RNG{
  constructor(seed){this.s=(seed|0)||1}
  next(){let x=this.s|0;x^=x<<13;x^=x>>>17;x^=x<<5;this.s=x|0;return (x>>>0)/4294967296}
  int(a,b){return Math.floor(a+this.next()*(b-a+1))}
  pick(a){return a[Math.floor(this.next()*a.length)]}
}

function canonicalOpen(seed,gx,gz,axis){
  return cycleHash(seed^gx,gz,axis==="h"?17:31)<.19;
}

class Chunk{
  constructor(world,cx,cz){
    this.world=world;this.game=world.game;this.cx=cx;this.cz=cz;
    this.originX=cx*world.size-world.size/2;this.originZ=cz*world.size-world.size/2;
    this.group=new THREE.Group();this.group.name="chunk_"+cx+"_"+cz;
    this.walls=new Uint8Array(this.gridSize()*this.gridSize());this.hazards=[];this.exit=null;this.falseDoors=[];this.entitySpawn=false;this.fixtures=[];this.lightSources=[];
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
    this.walls.fill(15);

    if(level.id==="0"){
      const mega=this.cx===0&&this.cz===0||cycleHash(this.game.seed,this.cx,this.cz,77)<.38;
      if(mega){
        this.walls.fill(0);
        for(let z=0;z<cells;z++){this.walls[this.index(0,z)]|=8;this.walls[this.index(cells-1,z)]|=2}
        for(let x=0;x<cells;x++){this.walls[this.index(x,0)]|=1;this.walls[this.index(x,cells-1)]|=4}

        const partitions=rng.int(0,3);
        for(let i=0;i<partitions;i++){
          const vertical=rng.next()<.5;
          if(vertical){
            const x=rng.int(1,cells-2),gap=rng.int(1,cells-2);
            for(let z=1;z<cells-1;z++)if(z!==gap)this.setEdge(x,z,"east",false);
          }else{
            const z=rng.int(1,cells-2),gap=rng.int(1,cells-2);
            for(let x=1;x<cells-1;x++)if(x!==gap)this.setEdge(x,z,"south",false);
          }
        }
      }else{
        const visited=new Uint8Array(cells*cells),stack=[[0,0]];
        visited[this.index(0,0)]=1;
        while(stack.length){
          const [x,z]=stack[stack.length-1],options=[];
          for(const [dx,dz,b,ob,side] of [[0,-1,1,4,"north"],[1,0,2,8,"east"],[0,1,4,1,"south"],[-1,0,8,2,"west"]]){
            const nx=x+dx,nz=z+dz;
            if(nx>=0&&nx<cells&&nz>=0&&nz<cells&&!visited[this.index(nx,nz)])options.push([nx,nz,b,ob,side]);
          }
          if(!options.length){stack.pop();continue}
          const [nx,nz,b,ob]=rng.pick(options);
          this.walls[this.index(x,z)]&=~b;
          this.walls[this.index(nx,nz)]&=~ob;
          visited[this.index(nx,nz)]=1;
          stack.push([nx,nz]);
        }
        const loopChance=.18;
        for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){
          if(x<cells-1&&rng.next()<loopChance)this.setEdge(x,z,"east",true);
          if(z<cells-1&&rng.next()<loopChance)this.setEdge(x,z,"south",true);
        }
      }

      if(cells>=5){
        if((this.cx+this.cz)%2===0)this.setEdge(2,0,"north",true);
        if((this.cx-this.cz)%2===0)this.setEdge(2,cells-1,"south",true);
        if((this.cz%2)===0)this.setEdge(0,2,"west",true);
        if((this.cx%2)===0)this.setEdge(cells-1,2,"east",true);
      }
      if(this.cx===0&&this.cz===0){
        this.setEdge(2,2,"north",true);this.setEdge(2,2,"east",true);
        this.setEdge(2,2,"south",true);this.setEdge(2,2,"west",true);
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
      for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){
        if(x<cells-1&&rng.next()<loopChance)this.setEdge(x,z,"east",true);
        if(z<cells-1&&rng.next()<loopChance*.82)this.setEdge(x,z,"south",true);
      }
    }

    for(let x=0;x<cells;x++){
      const gx=this.cx*cells+x;
      if(canonicalOpen(this.game.seed,gx,this.cz*cells,"h"))this.setEdge(x,0,"north",true);
      if(canonicalOpen(this.game.seed,gx,this.cz*cells+cells,"h"))this.setEdge(x,cells-1,"south",true);
    }
    for(let z=0;z<cells;z++){
      const gz=this.cz*cells+z;
      if(canonicalOpen(this.game.seed,this.cx*cells,gz,"v"))this.setEdge(0,z,"west",true);
      if(canonicalOpen(this.game.seed,this.cx*cells+cells,gz,"v"))this.setEdge(cells-1,z,"east",true);
    }

    const rng2=new RNG((Math.imul(this.cx,83492791)^Math.imul(this.cz,2971215073)^this.game.seed)|0);
    for(let z=0;z<cells;z++)for(let x=0;x<cells;x++){
      if(rng2.next()<level.holeChance&&Math.hypot(x-(cells-1)/2,z-(cells-1)/2)>1.7)this.hazards.push({x,z});
    }

    const chunkDistance=Math.hypot(this.cx,this.cz);
    const minCell=1,maxCell=Math.max(1,cells-2);
    if(chunkDistance>=level.exitAfterChunks&&cycleHash(this.seedKey(),this.cx*13+this.cz*7,level.id.charCodeAt(0))<.035){
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
        if(mask&1)candidates.push({x,z,side:"north"});
        if(mask&2)candidates.push({x,z,side:"east"});
        if(mask&4)candidates.push({x,z,side:"south"});
        if(mask&8)candidates.push({x,z,side:"west"});
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
      const fixtureChance=level.id==="0"?.78:level.id==="1"?.2:.13;
      if(fixtureSlot&&rngBase.next()<fixtureChance){
        const fixtureMat=level.id==="2"&&rngBase.next()<.28?lib.orangeLight:lib.light,fixtureMaterial=fixtureMat.clone();
        const rotation=rngBase.next()<.5?0:Math.PI/2,jx=(rngBase.next()-.5)*1.05,jz=(rngBase.next()-.5)*1.05;
        const fixture=box(g,new THREE.BoxGeometry(1.62,.026,.5),fixtureMaterial,px+jx,level.wallHeight-.105,pz+jz,0,rotation,0);
        box(g,new THREE.BoxGeometry(1.9,.08,.66),lib.metal,px+jx,level.wallHeight-.05,pz+jz,0,rotation,0);
        fixture.userData.light=true;fixture.userData.baseEmissive=fixtureMat.emissiveIntensity;this.fixtures.push(fixture);
        if(rngBase.next()<.34){
          const lightColor=fixtureMat===lib.orangeLight?0xff9b52:level.theme.light;
          const intensity=level.id==="0"?4.2:3.1;
          this.lightSources.push({
            position:new THREE.Vector3(px+jx,level.wallHeight-.28,pz+jz),
            color:lightColor,
            baseIntensity:intensity,
            intensity,
            distance:11,
            decay:2
          });
        }
      }
    }

    const addInstanced=(geometry,material,data)=>{
      const mesh=new THREE.InstancedMesh(geometry,material,Math.max(1,data.length));
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);data.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.count=data.length;mesh.frustumCulled=true;g.add(mesh);
    };
    addInstanced(hGeom,lib.wall,hData);addInstanced(vGeom,lib.wall,vData);
    addInstanced(trimHGeom,lib.trim,trimH);addInstanced(trimVGeom,lib.trim,trimV);
    addInstanced(topHGeom,lib.trimTop,topH);addInstanced(topVGeom,lib.trimTop,topV);

    if(level.id==="0"){
      const columnGeom=new THREE.BoxGeometry(.72,level.wallHeight,.72),columnData=[],columnCount=3+rngBase.int(0,4);
      for(let i=0;i<columnCount;i++){
        const cx=.75+rngBase.next()*(cells-1.5),cz=.75+rngBase.next()*(cells-1.5);
        columnData.push(new THREE.Matrix4().makeTranslation(this.originX+cx*cell,level.wallHeight/2,this.originZ+cz*cell));
      }
      const columns=new THREE.InstancedMesh(columnGeom,lib.wall,columnData.length);
      columns.instanceMatrix.setUsage(THREE.StaticDrawUsage);columnData.forEach((m,i)=>columns.setMatrixAt(i,m));columns.frustumCulled=true;g.add(columns);
    }

    for(const hz of this.hazards){
      const p=new THREE.Mesh(new THREE.CircleGeometry(cell*.22,18),lib.dark);
      p.rotation.x=-Math.PI/2;p.position.set(this.originX+hz.x*cell+cell/2,.013,this.originZ+hz.z*cell+cell/2);g.add(p);
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
      const p=wallPoint(entry,.105,1.29),group=new THREE.Group();group.position.copy(p.position);group.rotation.y=p.rotation;
      const frameMat=exitDoor?lib.exitFrame:lib.doorFrame;
      box(group,new THREE.BoxGeometry(.11,2.62,.18),frameMat,-1.02,0,0);
      box(group,new THREE.BoxGeometry(.11,2.62,.18),frameMat,1.02,0,0);
      box(group,new THREE.BoxGeometry(2.15,.11,.18),frameMat,0,1.31,0);
      const door=box(group,new THREE.BoxGeometry(1.94,2.48,.07),(exitDoor?lib.exitDoor:lib.door).clone(),0,0,0);
      door.rotation.z=exitDoor?-0.16:-0.03;
      if(exitDoor)door.userData.exit=true;
      box(group,new THREE.BoxGeometry(.06,.08,.035),lib.handle,.78,.02,.06);
      g.add(group);
    };

    for(const d of this.falseDoors)buildDoor(d,false);

    if(this.exit){
      const e=this.exit;
      if(e.kind==="door"){
        buildDoor(e,true);
        const px=this.originX+e.x*cell+cell/2,pz=this.originZ+e.z*cell+cell/2;
        this.exit.position=e.side==="north"?new THREE.Vector3(px,1.28,pz-cell/2-.78):
          e.side==="south"?new THREE.Vector3(px,1.28,pz+cell/2+.78):
          e.side==="west"?new THREE.Vector3(px-cell/2-.78,1.28,pz):
          new THREE.Vector3(px+cell/2+.78,1.28,pz);
      }else{
        const p=wallPoint(e,.105,1.29),anomaly=box(g,new THREE.BoxGeometry(1.72,2.35,.028),lib.wallAnomaly.clone(),p.position.x,p.position.y,p.position.z,0,p.rotation,0);
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
    }
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
  update(dt){
    if(this.game.lightState==="ON"){
      for(const fixture of this.fixtures){
        if(fixture.material?.emissive&&fixture.userData.baseEmissive!==undefined)
          fixture.material.emissiveIntensity=fixture.userData.baseEmissive;
      }
      for(const light of this.lightSources)light.intensity=light.baseIntensity;
    }

    if(this.game.lightState!=="ON"){
      const blackout=this.game.lightState==="BLACKOUT";
      const flicker=Math.sin(this.game.gameTime*87+this.cx*11+this.cz*17)>-.18;
      const scale=blackout?0:(flicker?1:.028);
      for(const fixture of this.fixtures){
        if(fixture.material?.emissive)
          fixture.material.emissiveIntensity=(fixture.userData.baseEmissive??.8)*scale;
      }
      for(const light of this.lightSources)light.intensity=light.baseIntensity*scale;
      return;
    }

    this.flickerTimer-=dt;
    if(this.flickerTimer<=0&&this.fixtures.length){
      for(let i=0;i<Math.min(2,this.fixtures.length);i++){
        const f=this.fixtures[Math.floor(Math.random()*this.fixtures.length)];
        if(f.material?.emissive&&f.userData.baseEmissive!==undefined)
          f.material.emissiveIntensity=Math.random()<.55?.08:f.userData.baseEmissive;
      }
      for(const light of this.lightSources){
        if(Math.random()<.35)light.intensity=light.baseIntensity*(Math.random()<.55?.025:1);
      }
      this.flickerTimer=11+Math.random()*24;
    }
  }
}

class WorldStreamer{
  constructor(game){
    this.game=game;this.chunks=new Map();this.library=null;this.radius=2;this.size=0;
    this.surfaceSize=0;this.floorSurface=null;this.ceilingSurface=null;
  }
  key(cx,cz){return cx+","+cz}
  configure(){
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
    this.ceilingSurface.position.set(0,this.game.level.wallHeight+.08,0);
    this.ceilingSurface.updateMatrix();
    this.ceilingSurface.matrixAutoUpdate=false;
    this.ceilingSurface.frustumCulled=false;
    this.ceilingSurface.renderOrder=-2;

    this.game.scene.add(this.floorSurface,this.ceilingSurface);

    const library=this.library;
    applyOpenGameArtPBR(library,this.game.level)
      .then(()=>this.updateSurfaceTiling())
      .catch(error=>{
        console.warn("[Backrooms] PBR enhancement failed; procedural fallback remains active.",error);
      });
    this.updateSurfaceTiling();
  }

  updateSurfaceTiling(){
    const surfaces=[
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
    for(const c of this.chunks.values())c.update(dt)
  }
  collision(position,radius){
    const chunk=this.chunkAt(position.x,position.z);if(!chunk)return position;
    const c=chunk.cellAt(position.x,position.z),cell=this.game.level.cellSize,ox=chunk.originX+c.ix*cell,oz=chunk.originZ+c.iz*cell;
    let x=position.x,z=position.z;
    if(c.mask&8&&x-ox<radius)x=ox+radius;
    if(c.mask&2&&ox+cell-x<radius)x=ox+cell-radius;
    if(c.mask&1&&z-oz<radius)z=oz+radius;
    if(c.mask&4&&oz+cell-z<radius)z=oz+cell-radius;
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
    return best<18?1-best/18:0;
  }
  nearbyLightSources(x,z){
    const out=[];
    const cx=Math.floor((x+this.size/2)/this.size),cz=Math.floor((z+this.size/2)/this.size);
    for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){
      const c=this.chunks.get(this.key(cx+dx,cz+dz));if(!c)continue;
      for(const light of c.lightSources){
        const d=Math.hypot(light.position.x-x,light.position.z-z);
        if(d<22)out.push({light,d});
      }
    }
    out.sort((a,b)=>a.d-b.d);
    return out;
  }
  entitySpawns(){const out=[];for(const c of this.chunks.values())if(c.entitySpawn)out.push(c);return out}
}

class Player{
  constructor(game){
    this.game=game;this.position=new THREE.Vector3(0,1.62,0);this.yaw=0;this.pitch=0;
    this.health=100;this.stamina=100;this.hydration=100;this.sanity=100;this.flashlight=true;this.eyeY=1.62;this.bob=0;this.shake=0;this.cameraFov=72;
  }
  reset(){this.position.set(0,this.eyeY,0);this.yaw=0;this.pitch=0;this.bob=0;this.shake=0;this.cameraFov=72;this.health=this.stamina=this.hydration=this.sanity=100;this.flashlight=this.game.startFlash;this.game.camera.fov=72;this.game.camera.updateProjectionMatrix();this.game.camera.rotation.set(0,0,0,"YXZ")}
  update(dt){
    const input=this.game.input,look=input.consumeLook();
    this.yaw-=look.x*.0021;this.pitch-=look.y*.0021;this.pitch=Math.max(-1.48,Math.min(1.48,this.pitch));
    const mv=input.getMove(),run=input.wantsRun()&&this.stamina>4&&Math.hypot(mv.x,mv.y)>.12,speed=run?4.75:2.85;
    const forward=new THREE.Vector3(-Math.sin(this.yaw),0,-Math.cos(this.yaw)),right=new THREE.Vector3(Math.cos(this.yaw),0,-Math.sin(this.yaw));
    const delta=new THREE.Vector3().addScaledVector(right,mv.x).addScaledVector(forward,-mv.y);if(delta.lengthSq()>1)delta.normalize();
    const oldX=this.position.x,oldZ=this.position.z;
    this.position.x+=delta.x*speed*dt;this.position.z+=delta.z*speed*dt;
    const col=this.game.world.collision(this.position,.34);this.position.x=col.x;this.position.z=col.z;
    if(run)this.stamina=Math.max(0,this.stamina-dt*15);else this.stamina=Math.min(100,this.stamina+dt*9);
    this.hydration=Math.max(0,this.hydration-dt*.48);if(this.hydration<18)this.health=Math.max(0,this.health-dt*1.5);
    const dark=this.game.isDark();this.sanity+=dt*(dark?-.95:.22);if(this.flashlight&&dark)this.sanity+=dt*.12;this.sanity=Math.max(0,Math.min(100,this.sanity));
    if(this.game.world.hazardAt(this.position.x,this.position.z)){this.health-=dt*34}
    if(this.game.world.exitAt(this.position.x,this.position.z)){this.game.reachExit();return}
    if(this.health<=0||this.sanity<=0){this.game.die(this.health<=0?"The dark won.":"Your sense of direction collapsed.");return}
    const moving=Math.hypot(this.position.x-oldX,this.position.z-oldZ)>.01;
    const stride=Math.min(1,Math.abs(mv.y));
    if(moving&&stride>.05){this.bob+=dt*(run?13:8)*stride;if(this.game.settings.shake)this.shake=Math.min(.03,this.shake+dt*.09*stride)}else this.shake=Math.max(0,this.shake-dt*.24);
    const fear=1-this.sanity/100;
    const bobY=(run?.055:.036)*Math.sin(this.bob*2)*stride;
    const breathing=Math.sin(this.game.gameTime*1.35)*.007;
    const roll=Math.sin(this.bob)*(.003+(run?.0035:.001))*stride+Math.sin(this.game.gameTime*1.7)*.001*fear;
    const shakeY=this.shake*Math.sin(this.game.gameTime*31)*.28;
    this.game.camera.position.copy(this.position);
    this.game.camera.position.y=this.eyeY+bobY+breathing+shakeY;
    const targetFov=run?74:70;
    this.cameraFov+=(targetFov-this.cameraFov)*Math.min(1,dt*8);
    if(Math.abs(this.game.camera.fov-this.cameraFov)>.01){this.game.camera.fov=this.cameraFov;this.game.camera.updateProjectionMatrix()}
    this.game.camera.rotation.set(this.pitch,this.yaw,roll,"YXZ");
    this.game.flash.position.copy(this.game.camera.position);
    this.game.flashTarget.position.copy(this.game.camera.position).add(new THREE.Vector3(0,0,-1).applyQuaternion(this.game.camera.quaternion));
    this.game.audio.update(dt,moving,run,1-this.sanity/100,this.game.world.lightProximity(this.position.x,this.position.z),this.game.lightState,Math.hypot(this.position.x-oldX,this.position.z-oldZ));
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
      const group=new THREE.Group();group.position.set(x,0,z);
      if(type==="hound"){
        const mat=new THREE.MeshStandardMaterial({color:0x050505,roughness:.95,metalness:.05});
        const body=box(group,new THREE.SphereGeometry(.48,12,8),mat,0,.75,0);body.scale.set(.8,1.25,1.15);
        box(group,new THREE.CapsuleGeometry(.12,.62,5,8),mat,-.3,.45,-.18,0,.12,.1);
        box(group,new THREE.CapsuleGeometry(.12,.62,5,8),mat,.3,.45,-.18,0,-.12,-.1);
        const eye=new THREE.MeshStandardMaterial({color:0xffe7a8,emissive:0xffd36a,emissiveIntensity:5});
        box(group,new THREE.SphereGeometry(.055,8,8),eye,-.12,.86,-.42);box(group,new THREE.SphereGeometry(.055,8,8),eye,.12,.86,-.42);
      }else if(type==="skinwalker"){
        const mat=new THREE.MeshStandardMaterial({color:0x010101,roughness:1,metalness:0});
        box(group,new THREE.CapsuleGeometry(.22,.98,7,10),mat,0,1.02,0);
        box(group,new THREE.SphereGeometry(.24,12,8),mat,0,1.8,0);
        box(group,new THREE.CapsuleGeometry(.075,.92,5,8),mat,-.22,.55,0,0,0,-.035);
        box(group,new THREE.CapsuleGeometry(.075,.92,5,8),mat,.22,.55,0,0,0,.035);
        box(group,new THREE.CapsuleGeometry(.055,.88,5,8),mat,-.36,1.08,0,0,0,.08);
        box(group,new THREE.CapsuleGeometry(.055,.88,5,8),mat,.36,1.08,0,0,0,-.08);
      }else{
        const mat=new THREE.MeshStandardMaterial({color:0x020202,roughness:1});
        box(group,new THREE.SphereGeometry(.72,16,10),mat,0,1.4,0);
        const eyeMat=new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xffffff,emissiveIntensity:14});
        box(group,new THREE.SphereGeometry(.08,8,8),eyeMat,-.18,1.52,-.66);box(group,new THREE.SphereGeometry(.08,8,8),eyeMat,.18,1.52,-.66);
        box(group,new THREE.TorusGeometry(.28,.055,6,20,Math.PI),eyeMat,0,1.27,-.67,0,Math.PI,0);
      }
      group.scale.setScalar(.9+rng.next()*.4);this.game.scene.add(group);this.entities.push({key,type,group,state:"idle",cool:0});
      if(type==="skinwalker")this.game.triggerFear(.06);
    }
  }
  update(dt){
    const p=this.game.player;
    for(const e of [...this.entities]){
      const dx=p.position.x-e.group.position.x,dz=p.position.z-e.group.position.z,d=Math.hypot(dx,dz);e.cool-=dt;
      if(d>50){this.game.scene.remove(e.group);this.entities=this.entities.filter(x=>x!==e);continue}
      if(e.type==="hound"){
        const forward=new THREE.Vector3(-Math.sin(p.yaw),0,-Math.cos(p.yaw)),to=new THREE.Vector3(dx,0,dz).normalize(),looking=forward.dot(to)<-.48;
        if(d<13&&!looking&&e.state!=="chase"){e.state="chase";this.game.audio.scare();this.game.triggerFear(.45);e.cool=2.7}
        if(d<10&&looking)e.state="intimidated";
        if(e.state==="chase"&&e.cool<=0){const s=1.45*dt;e.group.position.x+=dx/d*s;e.group.position.z+=dz/d*s}
        if(e.state==="intimidated"){e.group.position.x-=dx/d*.7*dt;e.group.position.z-=dz/d*.7*dt;if(d>14)e.state="idle"}
        e.group.lookAt(p.position.x,1,p.position.z);if(d<1.05&&e.state==="chase"){p.health-=dt*38;this.game.audio.hurt()}
      }else if(e.type==="skinwalker"){
        const forward=new THREE.Vector3(-Math.sin(p.yaw),0,-Math.cos(p.yaw)),to=new THREE.Vector3(dx,0,dz).normalize();
        const looking=forward.dot(to)<-.72;
        if(looking&&d<25){
          e.state="frozen";
        }else{
          e.state="stalk";
          if(d<32){const speed=.58;e.group.position.x+=dx/d*speed*dt;e.group.position.z+=dz/d*speed*dt}
        }
        if(p.flashlight&&d<16){e.group.position.x-=dx/d*.9*dt;e.group.position.z-=dz/d*.9*dt}
        if(d<2.0){p.health-=dt*30;this.game.audio.hurt()}
        if(d<12)this.game.triggerFear(.24*dt);
        e.group.lookAt(p.position.x,1.2,p.position.z);
      }else{
        const lightOn=p.flashlight;if(lightOn&&d<18){e.group.position.x-=dx/d*dt*2.2;e.group.position.z-=dz/d*dt*2.2}
        if(!lightOn&&d<15){e.group.position.x+=dx/d*dt*1.4;e.group.position.z+=dz/d*dt*1.4}
        if(d<1.1){p.health-=dt*42;this.game.audio.hurt()}e.group.lookAt(p.position.x,1,p.position.z);
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
    this.game.renderer.setPixelRatio(ratio);
    this.game.renderer.setSize(innerWidth,innerHeight,false);
    this.game.world.radius=l.radius;
  }
  update(dt){
    if(this.mode!=="auto")return;
    this.samples.push(dt*1000);if(this.samples.length>45)this.samples.shift();this.cool-=dt;if(this.cool>0)return;
    const avg=this.samples.reduce((a,b)=>a+b,0)/this.samples.length;
    const safe=this.maxSafePixelRatio();
    if(avg>28)this.game.renderer.setPixelRatio(Math.max(.5,this.game.renderer.getPixelRatio()*.9));
    else if(avg<18)this.game.renderer.setPixelRatio(Math.min(1.0,safe,this.game.renderer.getPixelRatio()*1.025));
    this.game.renderer.setSize(innerWidth,innerHeight,false);
    this.cool=2;
  }
  set(mode){this.mode=mode;localStorage.setItem("br.quality",mode);this.apply()}
}

export class BackroomsGame{
  constructor(){
    this.seed=(Number(localStorage.getItem("br.seed"))||Math.floor(Math.random()*2147483647))|0;localStorage.setItem("br.seed",String(this.seed));
    this.levelId="0";this.level=LEVELS["0"];this.paused=true;this.running=false;this.dead=false;this.introActive=true;this.gameTime=0;this.argTimer=9;this.intercomTimer=80+Math.random()*100;
    this.settings={shake:localStorage.getItem("br.shake")!=="0"};this.startFlash=localStorage.getItem("br.flash")!=="0";
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x000000);this.camera=new THREE.PerspectiveCamera(70,innerWidth/innerHeight,.05,180);this.camera.rotation.order="YXZ";
    const touchDevice=matchMedia("(pointer:coarse)").matches||matchMedia("(hover:none)").matches;
    this.renderer=new THREE.WebGLRenderer({antialias:!touchDevice,powerPreference:"high-performance",stencil:false,depth:true,precision:"mediump"});
    this.renderer.setPixelRatio(1);this.renderer.setSize(Math.max(1,innerWidth),Math.max(1,innerHeight),false);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.62;
    this.scene.environment=null;
    this.input=new InputManager(this);this.audio=new AudioDirector();this.player=new Player(this);this.world=new WorldStreamer(this);
    this.localLights=[];
    for(let i=0;i<3;i++){
      const light=new THREE.PointLight(0xffd34d,0,22,2);
      light.name="dynamic_fluorescent_"+i;
      light.visible=true;
      this.localLights.push(light);
      this.scene.add(light);
    }this.entityManager=new EntityManager(this);this.quality=new AdaptiveQuality(this);
    this.ambient=new THREE.HemisphereLight(0x554c3c,0x000000,.055);this.scene.add(this.ambient);
    this.flashTarget=new THREE.Object3D();this.flash=new THREE.SpotLight(0xfffff1,24,25,.48,.9,2);this.flash.castShadow=false;this.flash.target=this.flashTarget;this.scene.add(this.flash,this.flashTarget);
    this.horror=0;this.scareTimer=18+Math.random()*20;this.lightState="ON";this.lightEventTimer=48+Math.random()*55;
    this.bindUI();addEventListener("resize",()=>this.resize());this.last=performance.now();
  }
  mount(){
    document.getElementById("game").appendChild(this.renderer.domElement);this.quality.apply();this.world.configure();this.world.ensureAround(0,0);this.player.reset();
    this.render();this.last=performance.now();requestAnimationFrame(this.loop.bind(this));
  }
  bindUI(){
    const $=id=>document.getElementById(id);
    const begin=async()=>{if(!this.introActive)return;this.audio.resume().then(()=>{this.audio.clickToEnter();this.beginIntroReveal()})};
    $("audio-gate").onclick=begin;
    $("audio-gate").onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();begin()}};
    $("resume").onclick=()=>this.togglePause(false);$("restart").onclick=()=>this.restart();$("retry").onclick=()=>this.restart();$("again-ending").onclick=()=>this.restart();
    $("quality").value=this.quality.mode;$("quality").onchange=e=>this.quality.set(e.target.value);
    $("volume").value=String(this.audio.volume);$("volume").oninput=e=>this.audio.setVolume(e.target.value);
    $("shake").checked=this.settings.shake;$("shake").onchange=e=>{this.settings.shake=e.target.checked;localStorage.setItem("br.shake",e.target.checked?"1":"0")};
    $("flashlight").checked=this.startFlash;$("flashlight").onchange=e=>{this.startFlash=e.target.checked;localStorage.setItem("br.flash",e.target.checked?"1":"0")};
  }
  beginIntroReveal(){
    if(!this.introActive)return;
    this.introActive=false;
    const boot=document.getElementById("boot");
    boot.classList.add("booting");
    this.player.reset();
    this.running=true;this.paused=false;this.dead=false;this.introReveal=0;
    document.getElementById("hud").classList.remove("hidden");
    document.getElementById("mobile-controls").classList.toggle("hidden",matchMedia("(pointer:fine)").matches);
    setTimeout(()=>boot.classList.add("fade-out"),80);
    setTimeout(()=>{this.toast(this.level.objective,3);this.renderer.domElement.requestPointerLock?.()},1100);
  }

  start(){this.beginIntroReveal()}
  restart(){
    document.getElementById("death").classList.add("hidden");document.getElementById("ending").classList.add("hidden");document.getElementById("pause").classList.add("hidden");
    this.seed=(Math.random()*2147483647)|0;localStorage.setItem("br.seed",String(this.seed));this.levelId="0";this.setLevel("0");this.player.reset();
    this.running=true;this.paused=false;this.dead=false;this.introActive=false;document.getElementById("hud").classList.remove("hidden");
    document.getElementById("mobile-controls").classList.toggle("hidden",matchMedia("(pointer:fine)").matches);this.toast(this.level.objective,2.4);
  }
  setLevel(id){
    this.levelId=String(id);this.level=levelById(id);this.lightState="ON";this.lightEventTimer=48+Math.random()*55;this.intercomTimer=80+Math.random()*100;
    this.scene.fog=new THREE.FogExp2(0x000000,this.level.id==="0"?.027:this.level.id==="1"?.043:.058);
    this.ambient.color.setHex(this.level.theme.ambient);this.ambient.groundColor.setHex(0x050404);
    this.flash.color.setHex(this.level.id==="2"?0xd9d7ff:0xffffee);this.world.configure();this.world.ensureAround(this.player.position.x,this.player.position.z);this.entityManager.clear();
    document.getElementById("level-number").textContent=this.level.number;document.getElementById("level-name").textContent=this.level.name;document.getElementById("objective").textContent=this.level.objective;
  }
  changeLevel(id){
    if(!id){this.ending();return}
    this.audio.exit();this.player.position.set(0,1.62,0);this.setLevel(id);this.toast("You slipped into "+this.level.number+".",3);
  }
  reachExit(){if(this.level.next)this.changeLevel(this.level.next);else this.ending()}
  ending(){this.paused=true;this.running=false;document.getElementById("hud").classList.add("hidden");document.getElementById("ending").classList.remove("hidden");document.exitPointerLock?.()}
  die(copy){this.lightState="BLACKOUT";this.dead=true;this.paused=true;this.running=false;this.triggerFear(1);document.getElementById("hud").classList.add("hidden");document.getElementById("death-copy").textContent=copy;document.getElementById("death").classList.remove("hidden");document.exitPointerLock?.();this.audio.scare()}
  togglePause(force){
    if(!this.running||this.dead)return;this.paused=force!==undefined?force:!this.paused;document.getElementById("pause").classList.toggle("hidden",!this.paused);
    if(this.paused)document.exitPointerLock?.();else{this.audio.resume();this.renderer.domElement.requestPointerLock?.()}
  }
  toggleFlashlight(){this.player.flashlight=!this.player.flashlight;this.audio.click();this.toast(this.player.flashlight?"Flashlight on":"Flashlight off",.9)}
  isDark(){if(this.level.id==="2")return true;if(this.lightState==="BLACKOUT")return true;return !this.player.flashlight}
  triggerFear(amount=.25){this.horror=Math.max(this.horror,Math.max(0,Math.min(1,amount)));this.player.shake=Math.min(.055,this.player.shake+amount*.07)}
  updateLightEvent(dt){
    if(!this.running||this.paused||this.dead)return;
    this.lightEventTimer-=dt;
    if(this.lightState!=="ON"){
      if(this.lightEventTimer<=0){this.lightState="ON";this.lightEventTimer=42+Math.random()*45}
      return;
    }
    if(this.lightEventTimer>0)return;
    if(this.level.id==="0"&&Math.random()<.42){
      this.lightState="BLACKOUT";this.lightEventTimer=1.3+Math.random()*2.5;this.audio.lightsOut();this.triggerFear(.48);
    }else{
      this.lightState="FLICKER";this.lightEventTimer=.7+Math.random()*1.7;this.audio.flicker();this.triggerFear(.16);
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
  updateLocalLights(){
    const sources=this.world.nearbyLightSources(this.player.position.x,this.player.position.z);
    for(let i=0;i<this.localLights.length;i++){
      const target=this.localLights[i],entry=sources[i];
      if(!entry){
        target.intensity=0;
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
  update(dt){
    this.gameTime+=dt;this.argTimer-=dt;this.scareTimer-=dt;
    if(this.introReveal<1)this.introReveal=Math.min(1,this.introReveal+dt/2.7);
    this.player.update(dt);this.world.update(dt);this.updateLocalLights();this.entityManager.update(dt);this.quality.update(dt);
    this.updateArgLayer(dt);
    this.updateLightEvent(dt);
    this.updateHorror(dt);
    const c=this.world.chunkAt(this.player.position.x,this.player.position.z);
    document.getElementById("coords").textContent=(c?c.cx:0)+" : "+(c?c.cz:0);
    document.getElementById("health-bar").style.width=Math.max(0,this.player.health)+"%";
    document.getElementById("stamina-bar").style.width=Math.max(0,this.player.stamina)+"%";
    document.getElementById("hydration-bar").style.width=Math.max(0,this.player.hydration)+"%";
    document.getElementById("sanity-bar").style.width=Math.max(0,this.player.sanity)+"%";
    document.getElementById("status").textContent=this.player.flashlight?"LIGHT ON":"LIGHT OFF";this.flash.intensity=this.player.flashlight?18:0;
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

  render(){this.syncRendererViewport();this.renderer.render(this.scene,this.camera)}
  loop(now){const raw=(now-this.last)/1000;this.last=now;const dt=Math.min(MAX_DT,raw);if(this.running&&!this.paused)this.update(dt);this.render();requestAnimationFrame(this.loop.bind(this))}
  syncRendererViewport(){
    const size=this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const ratio=Math.max(.0001,this.renderer.getPixelRatio());
    this.renderer.setViewport(0,0,size.x/ratio,size.y/ratio);
    this.renderer.setScissor(0,0,size.x/ratio,size.y/ratio);
    this.renderer.setScissorTest(false);
  }
  resize(){
    const ratio=Math.min(this.renderer.getPixelRatio(),this.quality.maxSafePixelRatio());
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(innerWidth,innerHeight,false);
    this.syncRendererViewport();
    this.camera.aspect=innerWidth/innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
