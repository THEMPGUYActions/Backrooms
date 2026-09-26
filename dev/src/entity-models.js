import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MODEL_BASE = new URL("../assets/entities/", import.meta.url).href;

export const ENTITY_MODEL_SOURCES = Object.freeze({
  smiler: {
    file: "smiler.glb",
    creator: "🇧🇷 Fog 🇧🇷",
    license: "CC BY 4.0",
    source: "https://sketchfab.com/3d-models/smiler-entity3-backrooms-994d17d347da4806968bb8ed9af5dedd"
  },
  hound: {
    file: "hound.glb",
    creator: "🇧🇷 Fog 🇧🇷",
    license: "CC BY 4.0",
    source: "https://sketchfab.com/3d-models/hound-backrooms-b835cbb0440942a0856da6cefd365d38"
  },
  skinstealer: {
    file: "skinstealer.glb",
    creator: "Speed12 / RocketOfficial",
    license: "CC BY 4.0",
    source: "https://sketchfab.com/3d-models/skin-stealer-the-backrooms-blender-302-c0db7c843ce44bb0a86a0b3a7d7884e1"
  },
  partygoer: {
    file: "partygoer.glb",
    creator: "Community model; replace with a licensed source file before shipping",
    license: "REQUIRES SOURCE LICENSE",
    source: ""
  }
});

function normalizeClipName(name){
  return String(name||"").toLowerCase().replace(/[^a-z0-9]/g,"");
}

function pickClip(clips,names){
  const wanted=names.map(normalizeClipName);
  return clips.find(c=>wanted.some(n=>normalizeClipName(c.name).includes(n)))||null;
}

export class EntityModelLibrary{
  constructor(game){
    this.game=game;
    this.loader=new GLTFLoader();
    this.cache=new Map();
  }

  async load(type){
    const source=ENTITY_MODEL_SOURCES[type];
    if(!source?.file)return null;
    if(this.cache.has(type))return this.cache.get(type);
    const promise=new Promise(resolve=>{
      this.loader.load(
        MODEL_BASE+source.file,
        gltf=>resolve(gltf),
        undefined,
        error=>{
          console.warn("[Backrooms] Entity model unavailable; using procedural fallback:",type,error);
          resolve(null);
        }
      );
    });
    this.cache.set(type,promise);
    return promise;
  }

  async attach(entity){
    const gltf=await this.load(entity.type);
    if(!gltf||!entity.group.parent)return false;

    const root=gltf.scene;
    root.traverse(object=>{
      if(object.isMesh){
        object.castShadow=false;
        object.receiveShadow=true;
        object.frustumCulled=true;
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

    if(gltf.animations?.length){
      const mixer=new THREE.AnimationMixer(root);
      const clips=gltf.animations;
      entity.model={
        root,
        mixer,
        clips,
        actions:new Map(),
        current:null,
        ready:true
      };
      for(const clip of clips)entity.model.actions.set(clip.name,mixer.clipAction(clip));
      this.play(entity,["idle","stand","breath"]);
    }
    entity.group.userData.realModel=true;
    return true;
  }

  play(entity,names){
    const model=entity.model;
    if(!model)return;
    const clip=pickClip(model.clips,names);
    if(!clip)return;
    if(model.current===clip)return;
    const next=model.actions.get(clip.name);
    if(!next)return;
    next.reset().fadeIn(.12).play();
    if(model.current){
      model.current.fadeOut(.12);
    }
    model.current=next;
  }

  update(entity,dt){
    const model=entity.model;
    if(!model)return;
    const state=entity.state;
    if(state==="chase"||state==="frenzy")this.play(entity,["run","sprint","attack"]);
    else if(state==="investigate"||state==="alert")this.play(entity,["walk","look","idle"]);
    else if(state==="stalk")this.play(entity,["walk","creep","idle"]);
    else this.play(entity,["idle","stand","breath"]);
    model.mixer.update(dt);
  }
}
