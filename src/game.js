import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
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
    this.walls=new Uint8Array(CELLS*CELLS);this.hazards=[];this.exit=null;this.entitySpawn=false;this.fixtures=[];
    this.flickerTimer=1+Math.random()*4;
    this.buildMaze();this.buildGeometry();
  }
  index(x,z){return z*CELLS+x}
  buildMaze(){
    this.walls.fill(15);
    const visited=new Uint8Array(CELLS*CELLS),stack=[[8,8]];
    visited[this.index(8,8)]=1;
    const dirs=[[0,-1,1,4],[1,0,2,8],[0,1,4,1],[-1,0,8,2]];
    const rng=new RNG((Math.imul(this.cx,73856093)^Math.imul(this.cz,19349663)^this.game.seed)|0);
    while(stack.length){
      const [x,z]=stack[stack.length-1],options=[];
      for(const [dx,dz,b,ob] of dirs){
        const nx=x+dx,nz=z+dz;
        if(nx>=0&&nx<CELLS&&nz>=0&&nz<CELLS&&!visited[this.index(nx,nz)])options.push([nx,nz,b,ob]);
      }
      if(!options.length){stack.pop();continue}
      const [nx,nz,b,ob]=rng.pick(options);
      this.walls[this.index(x,z)]&=~b;this.walls[this.index(nx,nz)]&=~ob;
      visited[this.index(nx,nz)]=1;stack.push([nx,nz]);
    }
    const loopChance=this.game.level.id==="0"?.24:this.game.level.id==="1"?.12:.07;
    for(let z=0;z<CELLS;z++)for(let x=0;x<CELLS;x++){
      const i=this.index(x,z);
      if(x<CELLS-1&&rng.next()<loopChance){this.walls[i]&=~2;this.walls[this.index(x+1,z)]&=~8}
      if(z<CELLS-1&&rng.next()<loopChance*.82){this.walls[i]&=~4;this.walls[this.index(x,z+1)]&=~1}
    }
    if(this.game.level.id==="0"){
      for(let z=3;z<13;z+=5)for(let x=3;x<13;x+=5){
        if(rng.next()<.58){
          this.walls[this.index(x,z)]&=~(2|4);
          if(x>0)this.walls[this.index(x-1,z)]&=~2;
          if(z>0)this.walls[this.index(x,z-1)]&=~4;
          if(x<CELLS-1)this.walls[this.index(x+1,z)]&=~8;
          if(z<CELLS-1)this.walls[this.index(x,z+1)]&=~1;
        }
      }
    }
    for(let x=0;x<CELLS;x++){
      const gx=this.cx*CELLS+x;
      if(canonicalOpen(this.game.seed,gx,this.cz*CELLS,"h"))this.walls[this.index(x,0)]&=~1;
      if(canonicalOpen(this.game.seed,gx,this.cz*CELLS+CELLS,"h"))this.walls[this.index(x,CELLS-1)]&=~4;
    }
    for(let z=0;z<CELLS;z++){
      const gz=this.cz*CELLS+z;
      if(canonicalOpen(this.game.seed,this.cx*CELLS,gz,"v"))this.walls[this.index(0,z)]&=~8;
      if(canonicalOpen(this.game.seed,this.cx*CELLS+CELLS,gz,"v"))this.walls[this.index(CELLS-1,z)]&=~2;
    }
    const level=this.game.level,rng2=new RNG((Math.imul(this.cx,83492791)^Math.imul(this.cz,2971215073)^this.game.seed)|0);
    for(let z=0;z<CELLS;z++)for(let x=0;x<CELLS;x++){
      const d=Math.hypot(this.cx,this.cz);
      if(d>=level.exitAfterChunks&&cycleHash(this.seedKey(),x,this.cz*31+z)<.0009&&!this.exit&&(this.walls[this.index(x,z)]!==15))this.exit={x,z};
      if(rng2.next()<level.holeChance&&Math.hypot(x-8,z-8)>2.5)this.hazards.push({x,z});
    }
    if(!this.exit&&Math.hypot(this.cx,this.cz)>=level.exitAfterChunks&&cycleHash(this.seedKey(),this.cx,this.cz)<.025){
      for(let i=0;i<64;i++){const x=rng2.int(1,14),z=rng2.int(1,14);if(this.walls[this.index(x,z)]!==15){this.exit={x,z};break}}
    }
  }
  seedKey(){return (this.cx*73856093)^(this.cz*19349663)^this.game.seed}
  buildGeometry(){
    const g=this.group,level=this.game.level,lib=this.world.library,size=this.world.size,cell=level.cellSize;
    box(g,new THREE.BoxGeometry(size,.09,size),lib.floor,0,-.045,0);
    box(g,new THREE.BoxGeometry(size,.1,size),lib.ceiling,0,level.wallHeight+.05,0);
    const hGeom=new THREE.BoxGeometry(cell,level.wallHeight,.11),vGeom=new THREE.BoxGeometry(.11,level.wallHeight,cell);
    const hData=[],vData=[],rngBase=new RNG(this.seedKey());
    const pushMat=(arr,x,y,z)=>{const m=new THREE.Matrix4();m.compose(new THREE.Vector3(x,y,z),new THREE.Quaternion(),new THREE.Vector3(1,1,1));arr.push(m)};
    for(let z=0;z<CELLS;z++)for(let x=0;x<CELLS;x++){
      const mask=this.walls[this.index(x,z)],px=this.originX+x*cell+cell/2,pz=this.originZ+z*cell+cell/2;
      if(mask&1)pushMat(hData,px,level.wallHeight/2,pz-cell/2);
      if(mask&4)pushMat(hData,px,level.wallHeight/2,pz+cell/2);
      if(mask&8)pushMat(vData,px-cell/2,level.wallHeight/2,pz);
      if(mask&2)pushMat(vData,px+cell/2,level.wallHeight/2,pz);
      const fixtureChance=level.id==="0"?.43:.24;
      if(rngBase.next()<fixtureChance){
        const fixtureMat=level.id==="2"&&rngBase.next()<.28?lib.orangeLight:lib.light;
        const fixture=box(g,new THREE.BoxGeometry(1.35,.07,.18),fixtureMat,px,level.wallHeight-.05,pz);
        fixture.userData.light=true;this.fixtures.push(fixture);
        if(((x*13+z*7)%61===0)||level.id==="2"&&((x+z)%29===0)){
          const lightColor=fixtureMat===lib.orangeLight?0xff9b52:level.theme.light;
          const l=new THREE.PointLight(lightColor,level.id==="0"?.58:.42,level.id==="2"?9:13,.95);
          l.position.set(px,level.wallHeight-.2,pz);g.add(l);this.fixtures.push(l);
        }
      }
      const propRng=new RNG(this.seedKey()^Math.imul(x,92821)^Math.imul(z,31337));
      makePropSet(g,level,lib,()=>propRng.next(),px,pz);
      if(level.id==="1"&&propRng.next()<.055){
        const puddle=new THREE.Mesh(new THREE.CircleGeometry(cell*(.18+propRng.next()*.2),18),lib.water);
        puddle.rotation.x=-Math.PI/2;puddle.scale.y=.55;
        puddle.position.set(px+(propRng.next()-.5)*cell*.65,.012,pz+(propRng.next()-.5)*cell*.65);g.add(puddle);
      }
      if(level.id==="2"&&propRng.next()<.12){
        const cable=new THREE.Mesh(new THREE.CylinderGeometry(.026,.026,cell*(.75+propRng.next()*.4),6),lib.cable);
        cable.rotation.z=Math.PI/2;cable.position.set(px,level.wallHeight-.42,pz);g.add(cable);
      }
    }
    const hm=new THREE.InstancedMesh(hGeom,lib.wall,Math.max(1,hData.length));hm.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    hData.forEach((m,i)=>hm.setMatrixAt(i,m));hm.count=hData.length;hm.frustumCulled=true;g.add(hm);
    const vm=new THREE.InstancedMesh(vGeom,lib.wall,Math.max(1,vData.length));vm.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    vData.forEach((m,i)=>vm.setMatrixAt(i,m));vm.count=vData.length;vm.frustumCulled=true;g.add(vm);
    for(const hz of this.hazards){
      const p=new THREE.Mesh(new THREE.CircleGeometry(cell*.33,16),lib.dark);
      p.rotation.x=-Math.PI/2;p.position.set(this.originX+hz.x*cell+cell/2,.009,this.originZ+hz.z*cell+cell/2);g.add(p);
    }
    if(this.exit){
      const ex=this.exit,exPos=new THREE.Vector3(this.originX+ex.x*cell+cell/2,1.45,this.originZ+ex.z*cell+cell/2);
      const frame=new THREE.Group();frame.position.copy(exPos);
      const mat=lib.exit.clone();const portal=box(frame,new THREE.BoxGeometry(1.05,2.5,.12),mat,0,0,-.05);
      portal.userData.exit=true;mat.emissiveIntensity=level.id==="0"?.9:1.6;
      box(frame,new THREE.BoxGeometry(1.35,.09,.19),lib.metal,0,1.3,0);g.add(frame);
      this.exit.position=exPos;
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
    const cell=this.game.level.cellSize;
    let ix=Math.floor((x-this.originX)/cell),iz=Math.floor((z-this.originZ)/cell);
    ix=Math.max(0,Math.min(CELLS-1,ix));iz=Math.max(0,Math.min(CELLS-1,iz));
    return {ix,iz,mask:this.walls[this.index(ix,iz)]};
  }
  dispose(){
    const shared=new Set(Object.values(this.world.library||{}));
    const geometries=new Set();
    const uniqueMaterials=new Set();
    this.group.traverse(object=>{
      if(object.geometry)geometries.add(object.geometry);
      const material=object.material;
      if(material && !shared.has(material)){
        if(Array.isArray(material))material.forEach(m=>uniqueMaterials.add(m));
        else uniqueMaterials.add(material);
      }
    });
    for(const geometry of geometries)geometry.dispose();
    for(const material of uniqueMaterials)material.dispose();
    this.group.clear();
  }
  update(dt){
    this.flickerTimer-=dt;
    if(this.flickerTimer<=0&&this.fixtures.length){
      const f=this.fixtures[Math.floor(Math.random()*this.fixtures.length)];
      if(f.material?.emissive)f.material.emissiveIntensity=Math.random()<.35?.15:3;
      if(f.isLight)f.intensity=Math.random()<.35?0.04:(this.game.level.id==="0"?.58:.42);
      this.game.audio.flicker();
      this.flickerTimer=2.5+Math.random()*7;
    }
  }
}

class WorldStreamer{
  constructor(game){
    this.game=game;this.chunks=new Map();this.library=null;this.radius=BASE_RADIUS;this.size=0;
    this.infiniteCeiling=null;
  }
  key(cx,cz){return cx+","+cz}
  configure(){
    for(const c of this.chunks.values()){
      this.game.scene.remove(c.group);
      c.dispose();
    }
    this.chunks.clear();

    if(this.infiniteCeiling){
      this.game.scene.remove(this.infiniteCeiling);
      this.infiniteCeiling.geometry.dispose();
      this.infiniteCeiling=null;
    }
    if(this.library)disposeLibrary(this.library);

    this.size=this.game.level.cellSize*CELLS;
    this.library=makeLibrary(this.game.level);

    this.infiniteCeiling=new THREE.Mesh(
      new THREE.PlaneGeometry(this.size*10,this.size*10),
      this.library.ceiling
    );
    this.infiniteCeiling.rotation.x=Math.PI/2;
    this.infiniteCeiling.position.set(0,this.game.level.wallHeight+.14,0);
    this.infiniteCeiling.frustumCulled=false;
    this.game.scene.add(this.infiniteCeiling);

    const library=this.library;
    applyOpenGameArtPBR(library,this.game.level).catch(error=>{
      console.warn("[Backrooms] OpenGameArt enhancement failed; procedural materials remain active.",error);
    });
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
    if(this.infiniteCeiling){
      const snap=this.size*2;
      this.infiniteCeiling.position.x=Math.floor(p.x/snap)*snap;
      this.infiniteCeiling.position.z=Math.floor(p.z/snap)*snap;
    }
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
  entitySpawns(){const out=[];for(const c of this.chunks.values())if(c.entitySpawn)out.push(c);return out}
}

class Player{
  constructor(game){
    this.game=game;this.position=new THREE.Vector3(0,1.62,0);this.yaw=0;this.pitch=0;
    this.health=100;this.stamina=100;this.hydration=100;this.sanity=100;this.flashlight=true;this.eyeY=1.62;this.bob=0;this.shake=0;
  }
  reset(){this.position.set(0,this.eyeY,0);this.yaw=0;this.pitch=0;this.health=this.stamina=this.hydration=this.sanity=100;this.flashlight=this.game.startFlash;this.game.camera.rotation.set(0,0,0,"YXZ")}
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
    if(moving){this.bob+=dt*(run?13:8);if(this.game.settings.shake)this.shake=Math.min(.04,this.shake+dt*.12)}else this.shake=Math.max(0,this.shake-dt*.22);
    const bob=Math.sin(this.bob)*(.018*(run?1.5:.7))*(moving?1:0);
    this.game.camera.position.copy(this.position);this.game.camera.position.y=this.eyeY+bob;
    this.game.camera.rotation.set(this.pitch,this.yaw,0,"YXZ");
    this.game.flash.position.copy(this.game.camera.position);
    this.game.flashTarget.position.copy(this.game.camera.position).add(new THREE.Vector3(0,0,-1).applyQuaternion(this.game.camera.quaternion));
    this.game.audio.update(dt,moving,run);
  }
}

class EntityManager{
  constructor(game){this.game=game;this.entities=[]}
  clear(){for(const e of this.entities)this.game.scene.remove(e.group);this.entities=[]}
  spawnForChunks(){
    for(const c of this.game.world.entitySpawns()){
      const key=c.cx+","+c.cz;if(this.entities.some(e=>e.key===key))continue;
      const cell=this.game.level.cellSize,rng=new RNG(c.seedKey()^0x4a91);
      const x=c.originX+rng.int(2,14)*cell+cell/2,z=c.originZ+rng.int(2,14)*cell+cell/2,type=this.game.level.entity;
      const group=new THREE.Group();group.position.set(x,0,z);
      if(type==="hound"){
        const mat=new THREE.MeshStandardMaterial({color:0x050505,roughness:.95,metalness:.05});
        const body=box(group,new THREE.SphereGeometry(.48,12,8),mat,0,.75,0);body.scale.set(.8,1.25,1.15);
        box(group,new THREE.CapsuleGeometry(.12,.62,5,8),mat,-.3,.45,-.18,0,.12,.1);
        box(group,new THREE.CapsuleGeometry(.12,.62,5,8),mat,.3,.45,-.18,0,-.12,-.1);
        const eye=new THREE.MeshStandardMaterial({color:0xffe7a8,emissive:0xffd36a,emissiveIntensity:5});
        box(group,new THREE.SphereGeometry(.055,8,8),eye,-.12,.86,-.42);box(group,new THREE.SphereGeometry(.055,8,8),eye,.12,.86,-.42);
      }else{
        const mat=new THREE.MeshStandardMaterial({color:0x020202,roughness:1});
        box(group,new THREE.SphereGeometry(.72,16,10),mat,0,1.4,0);
        const eyeMat=new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xffffff,emissiveIntensity:14});
        box(group,new THREE.SphereGeometry(.08,8,8),eyeMat,-.18,1.52,-.66);box(group,new THREE.SphereGeometry(.08,8,8),eyeMat,.18,1.52,-.66);
        box(group,new THREE.TorusGeometry(.28,.055,6,20,Math.PI),eyeMat,0,1.27,-.67,0,Math.PI,0);
      }
      group.scale.setScalar(.9+rng.next()*.4);this.game.scene.add(group);this.entities.push({key,type,group,state:"idle",cool:0});
      this.game.toast(type==="hound"?"Something is moving nearby.":"There is a face in the dark.",2.4);
    }
  }
  update(dt){
    const p=this.game.player;
    for(const e of [...this.entities]){
      const dx=p.position.x-e.group.position.x,dz=p.position.z-e.group.position.z,d=Math.hypot(dx,dz);e.cool-=dt;
      if(d>50){this.game.scene.remove(e.group);this.entities=this.entities.filter(x=>x!==e);continue}
      if(e.type==="hound"){
        const forward=new THREE.Vector3(-Math.sin(p.yaw),0,-Math.cos(p.yaw)),to=new THREE.Vector3(dx,0,dz).normalize(),looking=forward.dot(to)<-.48;
        if(d<13&&!looking&&e.state!=="chase"){e.state="chase";this.game.audio.scare();e.cool=2.7}
        if(d<10&&looking)e.state="intimidated";
        if(e.state==="chase"&&e.cool<=0){const s=1.45*dt;e.group.position.x+=dx/d*s;e.group.position.z+=dz/d*s}
        if(e.state==="intimidated"){e.group.position.x-=dx/d*.7*dt;e.group.position.z-=dz/d*.7*dt;if(d>14)e.state="idle"}
        e.group.lookAt(p.position.x,1,p.position.z);if(d<1.05&&e.state==="chase"){p.health-=dt*38;this.game.audio.hurt()}
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
  limits(){if(this.mode==="low")return{pixel:.8,radius:1};if(this.mode==="medium")return{pixel:1,radius:1};if(this.mode==="high")return{pixel:1.35,radius:2};return{pixel:Math.min(devicePixelRatio,1.35),radius:1}}
  apply(){const l=this.limits();this.game.renderer.setPixelRatio(Math.min(devicePixelRatio,l.pixel));this.game.world.radius=l.radius}
  update(dt){
    if(this.mode!=="auto")return;
    this.samples.push(dt*1000);if(this.samples.length>45)this.samples.shift();this.cool-=dt;if(this.cool>0)return;
    const avg=this.samples.reduce((a,b)=>a+b,0)/this.samples.length;
    if(avg>28)this.game.renderer.setPixelRatio(Math.max(.72,this.game.renderer.getPixelRatio()*.9));
    else if(avg<18)this.game.renderer.setPixelRatio(Math.min(1.35,this.game.renderer.getPixelRatio()*1.045));
    this.cool=2;
  }
  set(mode){this.mode=mode;localStorage.setItem("br.quality",mode);this.apply()}
}

export class BackroomsGame{
  constructor(){
    this.seed=(Number(localStorage.getItem("br.seed"))||Math.floor(Math.random()*2147483647))|0;localStorage.setItem("br.seed",String(this.seed));
    this.levelId="0";this.level=LEVELS["0"];this.paused=true;this.running=false;this.dead=false;this.introActive=true;this.gameTime=0;this.argTimer=9;
    this.settings={shake:localStorage.getItem("br.shake")!=="0"};this.startFlash=localStorage.getItem("br.flash")!=="0";
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(74,innerWidth/innerHeight,.05,220);this.camera.rotation.order="YXZ";
    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance",stencil:false,depth:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.2));this.renderer.setSize(innerWidth,innerHeight);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1;
    const room=new RoomEnvironment();
    const pmrem=new THREE.PMREMGenerator(this.renderer);
    this.environmentTarget=pmrem.fromScene(room,0.04);
    pmrem.dispose();
    room.dispose();
    this.scene.environment=this.environmentTarget.texture;
    this.scene.environmentIntensity=.42;
    this.input=new InputManager(this);this.audio=new AudioDirector();this.player=new Player(this);this.world=new WorldStreamer(this);this.entityManager=new EntityManager(this);this.quality=new AdaptiveQuality(this);
    this.ambient=new THREE.HemisphereLight(0xb8b0a0,0x0a0806,.20);this.scene.add(this.ambient);
    this.flashTarget=new THREE.Object3D();this.flash=new THREE.SpotLight(0xffffee,18,28,.48,.75,1.3);this.flash.castShadow=false;this.flash.target=this.flashTarget;this.scene.add(this.flash,this.flashTarget);
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
    this.levelId=String(id);this.level=levelById(id);
    this.scene.fog=new THREE.FogExp2(this.level.theme.fog,this.level.id==="0"?.012:this.level.id==="1"?.018:.024);
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
  die(copy){this.dead=true;this.paused=true;this.running=false;document.getElementById("hud").classList.add("hidden");document.getElementById("death-copy").textContent=copy;document.getElementById("death").classList.remove("hidden");document.exitPointerLock?.();this.audio.scare()}
  togglePause(force){
    if(!this.running||this.dead)return;this.paused=force!==undefined?force:!this.paused;document.getElementById("pause").classList.toggle("hidden",!this.paused);
    if(this.paused)document.exitPointerLock?.();else{this.audio.resume();this.renderer.domElement.requestPointerLock?.()}
  }
  toggleFlashlight(){this.player.flashlight=!this.player.flashlight;this.audio.click();this.toast(this.player.flashlight?"Flashlight on":"Flashlight off",.9)}
  isDark(){if(this.level.id==="2")return true;return !this.player.flashlight}
  toast(text,duration=2){
    const el=document.getElementById("toast");el.textContent=text;el.classList.remove("hidden");clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>el.classList.add("hidden"),duration*1000)
  }
  update(dt){
    this.gameTime+=dt;this.argTimer-=dt;
    if(this.introReveal<1)this.introReveal=Math.min(1,this.introReveal+dt/2.7);
    this.player.update(dt);this.world.update(dt);this.entityManager.update(dt);this.quality.update(dt);
    this.updateArgLayer(dt);
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

  render(){this.renderer.render(this.scene,this.camera)}
  loop(now){const raw=(now-this.last)/1000;this.last=now;const dt=Math.min(MAX_DT,raw);if(this.running&&!this.paused)this.update(dt);this.render();requestAnimationFrame(this.loop.bind(this))}
  resize(){this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();this.renderer.setSize(innerWidth,innerHeight)}
}
