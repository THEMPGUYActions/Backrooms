import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { USDLoader } from "three/addons/loaders/USDLoader.js";

const MODEL_BASE = new URL("../assets/entities/", import.meta.url).href;
const SUPPORTED_FORMATS = Object.freeze(["fbx","glb","gltf","obj","usdz"]);
const DEFAULT_FILE_ORDER = Object.freeze(["fbx","glb","gltf","obj","usdz"]);

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

    const root=asset.scene;
    root.traverse(object=>{
      if(object.isMesh){
        object.castShadow=false;
        object.receiveShadow=true;
        object.frustumCulled=true;
        if(object.material){
          const materials=Array.isArray(object.material)?object.material:[object.material];
          for(const material of materials){
            if(material.map)material.map.colorSpace=THREE.SRGBColorSpace;
            material.needsUpdate=true;
          }
        }
      }
    });

    const targetHeight=Math.max(.55,entity.group.userData.height||1.8);
    const box=new THREE.Box3().setFromObject(root);
    const size=box.getSize(new THREE.Vector3());
    if(size.y>0)root.scale.multiplyScalar(targetHeight/size.y);

    const scaledBox=new THREE.Box3().setFromObject(root);
    root.position.y-=scaledBox.min.y;
    root.rotation.y=Math.PI;

    const oldChildren=[...entity.group.children];
    for(const child of oldChildren)entity.group.remove(child);
    entity.group.add(root);

    const clips=asset.animations||[];
    const mixer=clips.length?new THREE.AnimationMixer(root):null;
    entity.model={
      root,mixer,clips,format:asset.format,file:asset.file,
      actions:new Map(),current:null,ready:true
    };
    if(mixer){
      for(const clip of clips)entity.model.actions.set(clip.name,mixer.clipAction(clip));
      this.play(entity,["idle","stand","breath"]);
    }
    entity.group.userData.realModel=true;
    entity.group.userData.modelFormat=asset.format;
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
    next.reset().fadeIn(.12).play();
    if(model.current)model.current.fadeOut(.12);
    model.current=next;
  }

  update(entity,dt){
    const model=entity.model;
    if(!model)return;
    if(model.mixer){
      const state=entity.state;
      if(state==="chase"||state==="frenzy")this.play(entity,["run","sprint","attack","walk"]);
      else if(state==="investigate"||state==="alert")this.play(entity,["walk","look","idle"]);
      else if(state==="stalk")this.play(entity,["walk","creep","idle"]);
      else this.play(entity,["idle","stand","breath","walk"]);
      model.mixer.update(dt);
    }
  }
}
