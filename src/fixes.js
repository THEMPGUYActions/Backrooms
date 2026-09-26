import * as THREE from "three";

const MANILA_MACRO_SIZE=20;

function cycleHash(a,b,c=0){
  let n=(Math.imul(a|0,374761393)+Math.imul(b|0,668265263)+Math.imul(c|0,1442695041))|0;
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967296;
}

function positiveMod(n,d){return ((n%d)+d)%d}

function manilaAt(cx,cz,seed){
  if(cx===0&&cz===0)return null;
  const macroX=Math.floor(cx/MANILA_MACRO_SIZE),macroZ=Math.floor(cz/MANILA_MACRO_SIZE);
  const lx=positiveMod(cx,MANILA_MACRO_SIZE),lz=positiveMod(cz,MANILA_MACRO_SIZE);
  if(lx<1||lx>8||lz<1||lz>8)return null;
  if(cycleHash(seed^0x6d6e,macroX,macroZ,0x41)>.045)return null;
  const tx=1+Math.floor(cycleHash(seed^0x6d6f,macroX,macroZ,0x42)*8);
  const tz=1+Math.floor(cycleHash(seed^0x6d70,macroX,macroZ,0x43)*8);
  if(lx!==tx||lz!==tz)return null;
  return {
    cellX:1+Math.floor(cycleHash(seed^0x6d72,macroX,macroZ,0x45)*3),
    cellZ:1+Math.floor(cycleHash(seed^0x6d73,macroX,macroZ,0x46)*3),
    entrySide:["north","east","south","west"][Math.floor(cycleHash(seed^0x6d71,macroX,macroZ,0x44)*4)]
  };
}

function installRoof(game){
  const world=game.world;
  if(!world||world.__level0RoofPatched)return;
  world.__level0RoofPatched=true;
  world.__level0RoofSignature="";
  world.__level0RoofGroup=null;

  const syncRoofMaterial=()=>{
    const root=world.__level0RoofGroup;
    const source=world.library?.ceiling;
    if(!root||!source)return;
    const material=root.children.find(o=>o.isInstancedMesh)?.material;
    if(!material)return;
    for(const key of ["map","roughnessMap","normalMap","aoMap"]){
      const previous=material[key];
      if(previous?.userData?.manilaRoofClone)previous.dispose();
      const sourceTexture=source[key];
      if(!sourceTexture){material[key]=null;continue}
      const cloned=sourceTexture.clone();
      cloned.wrapS=THREE.ClampToEdgeWrapping;
      cloned.wrapT=THREE.ClampToEdgeWrapping;
      cloned.repeat.set(1,1);
      cloned.offset.set(0,0);
      cloned.needsUpdate=true;
      cloned.userData.manilaRoofClone=true;
      material[key]=cloned;
    }
    material.needsUpdate=true;
  };

  const rebuild=()=>{
    if(game.level?.id!=="0")return;
    const keys=[...world.chunks.keys()].sort().join("|");
    if(keys===world.__level0RoofSignature&&world.__level0RoofGroup)return;
    world.__level0RoofSignature=keys;
    if(world.__level0RoofGroup){
      world.__level0RoofGroup.traverse(o=>{
        if(o.geometry)o.geometry.dispose();
        if(o.material&&!o.material.isMaterialShared)o.material.dispose?.();
      });
      game.scene.remove(world.__level0RoofGroup);
    }

    const root=new THREE.Group();
    root.name="level0-roof-tiles";
    const material=world.library?.ceiling?.clone?.();
    if(!material)return;
    // Level 0 roof panels represent individual ceiling tiles. Do not inherit
    // the global floor/ceiling repeat, which is tuned for large surfaces.
    for(const key of ["map","roughnessMap","normalMap","aoMap"]){
      const texture=material[key];
      if(!texture)continue;
      const cloned=texture.clone();
      cloned.wrapS=THREE.ClampToEdgeWrapping;
      cloned.wrapT=THREE.ClampToEdgeWrapping;
      cloned.repeat.set(1,1);
      cloned.offset.set(0,0);
      cloned.needsUpdate=true;
      material[key]=cloned;
    }
    material.color.setHex(0xffffff);
    material.roughness=.92;
    material.metalness=0;
    material.isMaterialShared=false;

    for(const chunk of world.chunks.values()){
      const tiles=10;
      const tileSize=world.size/tiles;
      const mesh=new THREE.InstancedMesh(
        new THREE.BoxGeometry(tileSize-.10,.055,tileSize-.10),
        material,
        tiles*tiles
      );
      let i=0;
      for(let z=0;z<tiles;z++)for(let x=0;x<tiles;x++){
        const isManilaTile=!!chunk.manilaRoom&&x===chunk.manilaRoom.cellX&&z===chunk.manilaRoom.cellZ;
        // The source Manila Room has a low interior ceiling with the fluorescent
        // fixture sitting just below it. Keep the normal Level 0 roof elsewhere.
        const roofY=isManilaTile?3.125:game.level.wallHeight-.025;
        const m=new THREE.Matrix4().makeTranslation(
          chunk.originX+x*tileSize+tileSize/2,
          roofY,
          chunk.originZ+z*tileSize+tileSize/2
        );
        mesh.setMatrixAt(i++,m);
      }
      mesh.instanceMatrix.needsUpdate=true;
      mesh.computeBoundingSphere();
      root.add(mesh);
    }

    world.ceilingSurface&&(world.ceilingSurface.visible=false);
    game.scene.add(root);
    world.__level0RoofGroup=root;
  };

  const originalUpdateSurfaceTiling=world.updateSurfaceTiling.bind(world);
  world.updateSurfaceTiling=()=>{
    originalUpdateSurfaceTiling();
    syncRoofMaterial();
  };

  const originalConfigure=world.configure.bind(world);
  world.configure=async(...args)=>{
    if(world.__level0RoofGroup){
      game.scene.remove(world.__level0RoofGroup);
      world.__level0RoofGroup.traverse(o=>{if(o.geometry)o.geometry.dispose();});
      world.__level0RoofGroup=null;
    }
    world.__level0RoofSignature="";
    const result=await originalConfigure(...args);
    if(game.level?.id!=="0"&&world.ceilingSurface)world.ceilingSurface.visible=true;
    return result;
  };

  const originalEnsure=world.ensureAround.bind(world);
  world.ensureAround=(...args)=>{
    const result=originalEnsure(...args);
    rebuild();
    return result;
  };

  const originalSetLevel=game.setLevel.bind(game);
  game.setLevel=(id)=>{
    const result=originalSetLevel(id);
    world.__level0RoofSignature="";
    if(game.level?.id!=="0"&&world.ceilingSurface)world.ceilingSurface.visible=true;
    if(game.level?.id==="0")queueMicrotask(rebuild);
    return result;
  };

  queueMicrotask(rebuild);
}

function installFlashlight(game){
  const player=game.player;
  if(!player||player.__flashlightPatch)return;
  player.__flashlightPatch=true;
  const originalUpdate=player.update.bind(player);
  player.update=(dt)=>{
    originalUpdate(dt);
    if(game.level?.id!=="0")return;
    const on=!!player.flashlight&&player.flashBattery>0;
    game.flash.visible=true;
    game.flashFill.visible=true;
    game.flash.distance=24;
    game.flash.decay=2;
    game.flashFill.distance=24;
    game.flashFill.decay=2;
    game.flashFill.angle=.34;
    game.flashFill.penumbra=.88;
    if(on){
      const battery=Math.max(.18,player.flashBattery/100);
      const power=Math.pow(battery,.58);
      game.flash.intensity=9+15*power;
      game.flashFill.intensity=18+30*power;
    }else{
      game.flash.intensity=0;
      game.flashFill.intensity=0;
    }
  };
}

function installManilaAdmin(adminClass){
  if(!adminClass||adminClass.prototype.__manilaPatch)return;
  adminClass.prototype.__manilaPatch=true;
  const originalBuild=adminClass.prototype.build;
  adminClass.prototype.build=function(){
    originalBuild.call(this);
    const button=document.createElement("button");
    button.className="admin-level admin-manila";
    button.type="button";
    button.innerHTML="<span>ANOMALY</span><b>MANILA ROOM</b><i>TP</i>";
    button.title="Teleport to the deterministic Level 0 Manila Room";
    button.addEventListener("click",()=>this.teleportManilaRoom());
    this.levels?.appendChild(button);
  };

  adminClass.prototype.teleportManilaRoom=async function(){
    if(this.busy||!this.game.running||this.game.introActive||this.game.dead)return;
    if(this.game.level?.id!=="0"){
      this.game.toast("MANILA ROOM IS LEVEL 0",1.4);
      return;
    }
    this.busy=true;
    try{
      const p=this.game.player,world=this.game.world,size=world.size;
      let best=null,bestDistance=Infinity;
      for(let macroX=-12;macroX<=12;macroX++)for(let macroZ=-12;macroZ<=12;macroZ++){
        for(let lx=1;lx<=8;lx++)for(let lz=1;lz<=8;lz++){
          const cx=macroX*MANILA_MACRO_SIZE+lx,cz=macroZ*MANILA_MACRO_SIZE+lz;
          const room=manilaAt(cx,cz,this.game.seed);
          if(!room)continue;
          const wx=cx*size-size/2, wz=cz*size-size/2;
          const d=Math.hypot(wx-p.position.x,wz-p.position.z);
          if(d<bestDistance){bestDistance=d;best={cx,cz,room}}
        }
      }
      if(!best){
        this.game.toast("NO MANILA ROOM FOUND",1.5);
        return;
      }

      this.game.paused=true;
      world.ensureAround(best.cx*size,best.cz*size);
      const chunk=world.chunks.get(best.cx+","+best.cz);
      if(!chunk?.manilaRoom){
        this.game.toast("MANILA ROOM LOAD FAILED",1.5);
        return;
      }
      const cell=this.game.level.cellSize;
      const x=chunk.originX+best.room.cellX*cell+cell/2;
      const z=chunk.originZ+best.room.cellZ*cell+cell/2;
      p.position.set(x,p.eyeY,z);
      p.yaw=0;p.pitch=0;p.viewYaw=0;p.viewPitch=0;
      this.game.world.ensureAround(x,z);
      this.game.paused=false;
      this.game.toast("TELEPORTED TO MANILA ROOM",1.8);
      this.sync();
    }catch(error){
      console.error("[Backrooms] Manila teleport failed:",error);
      this.game.paused=false;
      this.game.toast("MANILA TELEPORT FAILED",1.8);
    }finally{
      this.busy=false;
    }
  };
}

export function installBackroomsFixes(game,AdminClass){
  installRoof(game);
  installFlashlight(game);
  installManilaAdmin(AdminClass);
}
