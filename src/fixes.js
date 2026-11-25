import * as THREE from "three";

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
        new THREE.BoxGeometry(tileSize+.04,.055,tileSize+.04),
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
    if(!["0","9","10"].includes(String(game.level?.id))&&world.ceilingSurface)world.ceilingSurface.visible=true;
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
    if(!["0","9","10"].includes(String(game.level?.id))&&world.ceilingSurface)world.ceilingSurface.visible=true;
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
    game.flash.visible=on;
    game.flashFill.visible=on;
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

}

export function installBackroomsFixes(game,AdminClass){
  installRoof(game);
  installFlashlight(game);
  installManilaAdmin(AdminClass);
}
