import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { USDLoader } from "three/addons/loaders/USDLoader.js";

const MODEL_BASE = new URL("../assets/entities/", import.meta.url).href;
const SUPPORTED_FORMATS = Object.freeze(["fbx","glb","gltf","obj","usdz"]);
const DEFAULT_FILE_ORDER = Object.freeze(["fbx","glb","gltf","obj","usdz"]);

// GLB assets come from different source projects and use inconsistent authoring
// scales. These are intentional in-game display heights (world units), audited
// against each committed model's actual bounds instead of assuming its source units.
const ENTITY_MODEL_TARGET_HEIGHTS = Object.freeze({
  bacteria: 12.5, // Oversized so the animated stalking silhouette still reaches above a 6-unit ceiling
  deathmoth: 3.6,
  duller: 2.8,
  faceling: 3.2,
  hound: 2.7,
  partygoer: 3.4,
  skinstealer: 3.4,
  smiler: 2.0
});
const ENTITY_MODEL_TARGET_WIDTHS = Object.freeze({
  // This Bacteria asset has a narrow skeletal silhouette; normalize its footprint too.
  bacteria: 8.5
});
const ENTITY_MODEL_YAWS = Object.freeze({
  smiler: Math.PI / 2
});

export const ENTITY_MODEL_SOURCES = Object.freeze({
  smiler: { files:["smiler.fbx","smiler.glb","smiler.gltf","smiler.obj","smiler.usdz"], creator:"🇧🇷 Fog 🇧🇷", license:"CC BY 4.0", source:"https://sketchfab.com/3d-models/smiler-entity3-backrooms-994d17d347da4806968bb8ed9af5dedd" },
  hound: { files:["hound.fbx","hound.glb","hound.gltf","hound.obj","hound.usdz"], creator:"🇧🇷 Fog 🇧🇷", license:"CC BY 4.0", source:"https://sketchfab.com/3d-models/hound-backrooms-b835cbb0440942a0856da6cefd365d38" },
  skinstealer: { files:["skinstealer.fbx","skinstealer.glb","skinstealer.gltf","skinstealer.obj","skinstealer.usdz"], creator:"Speed12 / RocketOfficial", license:"CC BY 4.0", source:"https://sketchfab.com/3d-models/skin-stealer-the-backrooms-blender-302-c0db7c843ce44bb0a86a0b3a7d7884e1" },
  duller: { files:["duller.fbx","duller.glb","duller.gltf","duller.obj","duller.usdz"], creator:"Hunter198511", license:"CC BY 4.0", source:"https://sketchfab.com/3d-models/backrooms-entity-6-duller-84d9383ca8dc4bdbbeba87dae49ccecb" },
  deathmoth: { files:["deathmoth.fbx","deathmoth.glb","deathmoth.gltf","deathmoth.obj","deathmoth.usdz"], creator:"Bittergiggle Playz [OFFICIAL]", license:"CC BY 4.0", source:"https://sketchfab.com/3d-models/deathmoth-backrooms-6101e3e3991545d6a8cce026fb2a51b2" },
  faceling: { files:["faceling.fbx","faceling.glb","faceling.gltf","faceling.obj","faceling.usdz"], creator:"TacoModels / original model by AlanH1213", license:"CC BY 4.0", source:"https://sketchfab.com/3d-models/backrooms-faceling-ps1psx-style-76ff872b6d12402ba6d363c6d16f64c7" },
  partygoer: { files:["partygoer.fbx","partygoer.glb","partygoer.gltf","partygoer.obj","partygoer.usdz"], creator:"bigdowsey", license:"CC BY 4.0", source:"https://sketchfab.com/3d-models/the-partygoer-backrooms-entity-0593ef4788b146e4b2f820b10245a948" },
  bacteria: { files:["bacteria.fbx","bacteria.glb","bacteria.gltf","bacteria.obj","bacteria.usdz"], creator:"DocoDummy", license:"CC BY 4.0", source:"https://sketchfab.com/3d-models/backrooms-custom-bacteria-lifeform-fb79a5140b144362abdaca43c0effb5c" }
});

function normalizeClipName(name){ return String(name||"").toLowerCase().replace(/[^a-z0-9]/g,""); }
function pickClip(clips,names){
  const wanted=names.map(normalizeClipName);
  return clips.find(c=>wanted.some(n=>normalizeClipName(c.name).includes(n)))||null;
}

function asLoadedAsset(root,animations=[],format,file){
  return {scene:root,animations:Array.isArray(animations)?animations:[],format,file};
}

function loadWith(loader,url){
  return new Promise((resolve,reject)=>{
    loader.load(url,asset=>resolve(asset),undefined,error=>reject(error||new Error("Model failed to load: "+url)));
  });
}

export class EntityModelLibrary{
  constructor(game){
    this.game=game;
    this.gltfLoader=new GLTFLoader();
    this.fbxLoader=new FBXLoader();
    this.objLoader=new OBJLoader();
    this.mtlLoader=new MTLLoader();
    this.usdLoader=new USDLoader();
    this.cache=new Map();
  }

  async loadOne(file){
    const url=new URL(file,MODEL_BASE).href;
    const format=file.split(".").pop().toLowerCase();
    if(format==="glb"||format==="gltf"){
      const asset=await loadWith(this.gltfLoader,url);
      return asLoadedAsset(asset.scene,asset.animations,"gltf",file);
    }
    if(format==="fbx"){
      const asset=await loadWith(this.fbxLoader,url);
      return asLoadedAsset(asset,asset.animations||[],"fbx",file);
    }
    if(format==="obj"){
      // OBJ is static. If a matching MTL exists, use it so downloaded
      // Sketchfab OBJ packages keep their original materials/textures.
      const mtlFile=file.replace(/\.obj$/i,".mtl");
      try{
        const materials=await loadWith(this.mtlLoader,new URL(mtlFile,MODEL_BASE).href);
        materials.preload();
        this.objLoader.setMaterials(materials);
      }catch{
        // A standalone OBJ is valid too. OBJLoader will use its fallback material.
        this.objLoader.setMaterials(null);
      }
      const asset=await loadWith(this.objLoader,url);
      return asLoadedAsset(asset,[],"obj",file);
    }
    if(format==="usdz"){
      const asset=await loadWith(this.usdLoader,url);
      return asLoadedAsset(asset,[],"usdz",file);
    }
    throw new Error("Unsupported entity model format: "+format);
  }

  async load(type){
    const source=ENTITY_MODEL_SOURCES[type];
    if(!source?.files?.length)return null;
    if(this.cache.has(type))return this.cache.get(type);

    const promise=(async()=>{
      const errors=[];
      // Prefer FBX first because it is the most likely of these downloads
      // to preserve the rig/animation clips, then use the web-friendly formats.
      const files=[...source.files].sort((a,b)=>{
        const ai=DEFAULT_FILE_ORDER.indexOf(a.split(".").pop().toLowerCase());
        const bi=DEFAULT_FILE_ORDER.indexOf(b.split(".").pop().toLowerCase());
        return ai-bi;
      });
      for(const file of files){
        try{
          const asset=await this.loadOne(file);
          console.info("[Backrooms] Loaded entity model:",type,file,asset.format,asset.animations.length?"with animations":"static");
          return asset;
        }catch(error){
          errors.push(file+": "+(error?.message||error));
        }
      }
      console.warn("[Backrooms] No supported entity model found; using procedural fallback:",type,errors);
      return null;
    })();

    this.cache.set(type,promise);
    return promise;
  }

  async attach(entity){
    const asset=await this.load(entity.type);
    if(!asset||!entity.group.parent)return false;

    let root,container,model;
    try{
      if(!asset.scene?.isObject3D)throw new Error("Loaded asset has no valid Three.js scene");
      // Clone cached content per entity. Never re-parent the shared cached scene.
      root=cloneSkeleton(asset.scene);
      if(!root?.isObject3D)throw new Error("Could not clone the loaded scene");

      const isVisibleRenderableMesh=object=>{
        if(!object.isMesh||!object.geometry?.attributes?.position?.count)return false;
        let ancestor=object;
        while(ancestor){
          if(!ancestor.visible)return false;
          if(ancestor===root)break;
          ancestor=ancestor.parent;
        }
        const materials=Array.isArray(object.material)?object.material:[object.material];
        return !(materials.length&&materials.every(material=>!material||material.visible===false||(material.opacity??1)<=0));
      };

      let meshCount=0;
      const visibleRenderableMeshes=[];
      root.traverse(object=>{
        if(!isVisibleRenderableMesh(object))return;
        meshCount++;
        visibleRenderableMeshes.push(object);
        object.castShadow=false;
        object.receiveShadow=true;
        object.frustumCulled=true;
        const materials=Array.isArray(object.material)?object.material:[object.material];
        for(const material of materials){
          if(!material)continue;
          if(material.map)material.map.colorSpace=THREE.SRGBColorSpace;
          material.needsUpdate=true;
        }
      });
      if(meshCount===0)throw new Error("Loaded model contains no visible renderable mesh geometry");

      // Work in the importer's original world transform before choosing a scale.
      root.updateMatrixWorld(true);
      const visibleBounds=new THREE.Box3();
      root.traverse(object=>{
        if(!isVisibleRenderableMesh(object))return;
        // Skinned meshes need precise vertex bounds; their bind-pose box can badly misrepresent the animated creature.
        const meshBounds=new THREE.Box3().setFromObject(object,object.isSkinnedMesh===true);
        if(!meshBounds.isEmpty())visibleBounds.union(meshBounds);
      });
      if(visibleBounds.isEmpty())throw new Error("Loaded model has empty visible bounds");

      const size=visibleBounds.getSize(new THREE.Vector3());
      if(!Number.isFinite(size.y)||size.y<=.001)throw new Error("Loaded model has no usable visible height");

      // Source models use inconsistent authoring scales. Normalize height and
      // (for Bacteria) the horizontal footprint independently.
      const targetHeight=ENTITY_MODEL_TARGET_HEIGHTS[entity.type]||Math.max(.55,entity.group.userData.height||1.8);
      const targetWidth=ENTITY_MODEL_TARGET_WIDTHS[entity.type]||null;
      const heightScale=targetHeight/size.y;
      const sourceHorizontalSize=Math.max(size.x,size.z);
      if(!Number.isFinite(heightScale)||heightScale<=0)throw new Error("Loaded model has an invalid height scale");
      if(!Number.isFinite(sourceHorizontalSize)||sourceHorizontalSize<=.001)throw new Error("Loaded model has no usable horizontal bounds");
      const horizontalScale=targetWidth?Math.max(heightScale,targetWidth/sourceHorizontalSize):heightScale;
      if(!Number.isFinite(horizontalScale)||horizontalScale<=0)throw new Error("Loaded model has an invalid horizontal scale");
      const displayScaleXZ=horizontalScale*sourceHorizontalSize;
      if(!Number.isFinite(displayScaleXZ)||displayScaleXZ<=0)throw new Error("Loaded model has an invalid display scale");

      // Normalize the imported asset to unit dimensions, then apply the intended
      // in-game display dimensions on the outer container. This keeps displayed
      // scale values meaningful instead of exposing a tiny correction factor
      // caused by the source GLB being authored in unusually large units.
      const sourceCenter=visibleBounds.getCenter(new THREE.Vector3());
      container=new THREE.Group();
      container.scale.set(displayScaleXZ,targetHeight,displayScaleXZ);
      container.rotation.y=ENTITY_MODEL_YAWS[entity.type]??Math.PI;
      const normalizedRoot=new THREE.Group();
      normalizedRoot.scale.set(1/sourceHorizontalSize,1/size.y,1/sourceHorizontalSize);
      normalizedRoot.position.set(-sourceCenter.x/sourceHorizontalSize,-visibleBounds.min.y/size.y,-sourceCenter.z/sourceHorizontalSize);
      normalizedRoot.add(root);
      container.add(normalizedRoot);

      // A scale track on the common parent of every visible mesh is a model
      // transform, not limb animation, and must not shrink the whole entity.
      const isSharedModelTransform=target=>!!target&&visibleRenderableMeshes.every(mesh=>{
        let ancestor=mesh;
        while(ancestor){
          if(ancestor===target)return true;
          ancestor=ancestor.parent;
        }
        return false;
      });

      const sourceClips=Array.isArray(asset.animations)?asset.animations:[];
      let ignoredRootScaleTracks=0;
      // The container owns the model's normalized world scale. Some imported
      // clips also animate the scene/armature root scale, which can shrink an
      // otherwise correctly normalized creature to a tiny figure.
      const clips=sourceClips.map(clip=>{
        const safeClip=clip.clone();
        safeClip.tracks=safeClip.tracks.filter(track=>{
          if(track.name!=="scale"&&!track.name.endsWith(".scale"))return true;
          let target=root;
          if(track.name!=="scale"){
            let parsed;
            try{parsed=THREE.PropertyBinding.parseTrackName(track.name)}catch{return true}
            if(parsed.propertyName!=="scale")return true;
            target=THREE.PropertyBinding.findNode(root,parsed.nodeName);
          }
          // Keep bone-local scale animation; only strip scale keys on a node that
          // is a common transform for every visible mesh, since that key can shrink
          // the entire creature and defeat the display normalization.
          if(!target||!isSharedModelTransform(target))return true;
          ignoredRootScaleTracks++;
          return false;
        });
        safeClip.resetDuration();
        return safeClip;
      }).filter(clip=>clip.tracks.length>0);
      if(ignoredRootScaleTracks)console.info("[Backrooms] Ignored model scale animation tracks:",entity.type,ignoredRootScaleTracks);
      const mixer=clips.length?new THREE.AnimationMixer(root):null;
      model={root,container,mixer,clips,format:asset.format,file:asset.file,targetHeight,targetWidth,scale:targetHeight,horizontalScale:displayScaleXZ,sourceCenter:sourceCenter.clone(),sourceHeight:size.y,sourceHorizontalSize,actions:new Map(),current:null,ready:true,pendingClip:null,pendingTime:0,stableMode:"stalk",pendingMode:"stalk",completedClips:new Set()};
      if(mixer)mixer.addEventListener("finished",event=>{
        const finishedName=normalizeClipName(event.action?.getClip?.().name);
        if(["jumpscare","bendingoverscene","chasesceneend"].includes(finishedName))model.completedClips.add(finishedName);
      });
      if(mixer)for(const clip of clips){
        const action=mixer.clipAction(clip);
        if(entity.type==="bacteria"){
          const clipName=normalizeClipName(clip.name);
          action.timeScale=clipName.includes("stalkingpose")?0.38:clipName.includes("tposelifeform")?0.30:clipName.includes("jumpscare")?0.68:0.48;
          if(clipName.includes("jumpscare")||clipName.includes("bendingoverscene")||clipName.includes("chasesceneend")){
            action.setLoop(THREE.LoopOnce,1);
            action.clampWhenFinished=true;
          }
        }
        model.actions.set(clip.name,action);
      }
    }catch(error){
      // Keep the original procedural children untouched if a GLB is corrupt,
      // empty, unsupported, or otherwise unusable.
      console.warn("[Backrooms] Entity model unusable; preserving procedural fallback:",entity.type,asset.file,error);
      return false;
    }

    // Swap only after cloning, bounds validation, and mixer setup all succeed.
    // A failed model can never erase the built-in procedural entity.
    for(const child of [...entity.group.children])entity.group.remove(child);
    entity.group.add(container);
    entity.model=model;
    entity.group.userData.height=model.targetHeight;
    entity.group.userData.modelWidth=model.targetWidth??null;
    if(model.mixer)this.play(entity,entity.type==="bacteria"?["stalkingpose"]:["idle","stand","breath"]);
    entity.group.userData.realModel=true;
    entity.group.userData.modelFormat=asset.format;
    console.info("[Backrooms] Attached entity model:",entity.type,asset.file,"height",model.targetHeight,"width",model.targetWidth??"auto","units","scaleY",Number(model.container.scale.y.toFixed(3)),"scaleXZ",Number(model.container.scale.x.toFixed(3)),"sourcePivot",model.sourceCenter.toArray().map(v=>Number(v.toFixed(2))));
    return true;
  }

  play(entity,names){
    const model=entity.model;
    if(!model?.mixer)return;
    const clip=pickClip(model.clips,names);
    if(!clip)return;
    if(model.current===model.actions.get(clip.name))return;
    const next=model.actions.get(clip.name);
    if(!next)return;
    const previous=model.current;
    next.reset();
    if(previous)next.crossFadeFrom(previous,entity.type==="bacteria"?0.32:0.12,false).play();
    else next.play();
    model.current=next;
  }

  update(entity,dt){
    const model=entity.model;
    if(!model)return;
    if(model.mixer){
      const state=entity.state;
      if(entity.type==="bacteria"){
        // Line of sight/noise can flicker each frame. Require a stable AI mode before switching clips.
        const observedMode=state==="frenzy"?"frenzy":state==="chase"?"chase":(state==="investigate"||state==="alert")?"investigate":"stalk";
        if(observedMode===model.stableMode){
          model.pendingMode=observedMode;model.pendingTime=0;
        }else if(observedMode!==model.pendingMode){
          model.pendingMode=observedMode;model.pendingTime=0;
        }else{
          model.pendingTime+=dt;
          const stableFor=(observedMode==="chase"||observedMode==="frenzy")?.9:1.15;
          if(model.pendingTime>=stableFor){
            model.stableMode=observedMode;model.pendingTime=0;model.completedClips.clear();
          }
        }
        // These source clips are cinematic one-shots, not walk cycles. Once each
        // has finished, return to the continuous stalking pose until the AI mode changes.
        let desiredName="stalkingpose";
        if(model.stableMode==="chase"&&!model.completedClips.has("chasesceneend"))desiredName="chaseSceneEnd";
        else if(model.stableMode==="investigate"&&!model.completedClips.has("bendingoverscene"))desiredName="bendingOverScene";
        else if(model.stableMode==="frenzy"&&!model.completedClips.has("jumpscare"))desiredName="JUMPSCARE";
        const desired=pickClip(model.clips,[desiredName])||pickClip(model.clips,["stalkingpose"]);
        if(desired)this.play(entity,[desired.name]);
      }else{
        if(state==="chase"||state==="frenzy")this.play(entity,["run","sprint","attack","walk"]);
        else if(state==="investigate"||state==="alert")this.play(entity,["walk","look","idle"]);
        else if(state==="stalk")this.play(entity,["walk","creep","idle"]);
        else this.play(entity,["idle","stand","breath","walk"]);
      }
      model.mixer.update(dt);
    }
  }
}
