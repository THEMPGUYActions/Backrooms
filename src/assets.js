import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js";

function noise2d(x,y,s){
  let n=(Math.imul((x+s)|0,374761393)+Math.imul((y+s)|0,668265263))|0;
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967296;
}

function makeCanvas(size,fn){
  const c=document.createElement("canvas");c.width=c.height=size;
  const ctx=c.getContext("2d"), img=ctx.createImageData(size,size), d=img.data;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)fn(x,y,d,(y*size+x)*4);
  ctx.putImageData(img,0,0);return c;
}

function tex(canvas,color=true){
  const t=new THREE.CanvasTexture(canvas);
  t.wrapS=THREE.RepeatWrapping;t.wrapT=THREE.RepeatWrapping;t.anisotropy=2;
  if(color)t.colorSpace=THREE.SRGBColorSpace;
  return t;
}

function normalFromHeight(size,seed){
  const h=[];
  for(let y=0;y<size;y++){h[y]=[];for(let x=0;x<size;x++)h[y][x]=noise2d(x,y,seed)*255}
  return makeCanvas(size,(x,y,d,i)=>{
    const l=h[y][(x+size-1)%size],r=h[y][(x+1)%size],u=h[(y+size-1)%size][x],dn=h[(y+1)%size][x];
    d[i]=Math.max(0,Math.min(255,128+(l-r)*.48));
    d[i+1]=Math.max(0,Math.min(255,128+(u-dn)*.48));
    d[i+2]=255;d[i+3]=255;
  });
}

export function createPBRMaterial({base,seed=1,rough=.9,metal=0,scale=4,normalStrength=.45}){
  const r0=(base>>16)&255,g0=(base>>8)&255,b0=base&255,size=64;
  const baseCanvas=makeCanvas(size,(x,y,d,i)=>{
    const n=noise2d(x>>2,y>>2,seed)*.72+noise2d(x,y,seed+11)*.28;
    const factor=.84+n*.26;
    d[i]=Math.max(0,Math.min(255,r0*factor));
    d[i+1]=Math.max(0,Math.min(255,g0*factor));
    d[i+2]=Math.max(0,Math.min(255,b0*factor));
    d[i+3]=255;
  });
  const roughCanvas=makeCanvas(size,(x,y,d,i)=>{
    const n=noise2d(x,y,seed+73);
    const v=Math.max(25,Math.min(255,rough*255+n*34));
    d[i]=d[i+1]=d[i+2]=v;d[i+3]=255;
  });
  const m=new THREE.MeshStandardMaterial({
    color:0xffffff,roughness:rough,metalness:metal,
    map:tex(baseCanvas,true),roughnessMap:tex(roughCanvas,false),normalMap:tex(normalFromHeight(size,seed+41),false),
    normalScale:new THREE.Vector2(normalStrength,normalStrength)
  });
  m.map.repeat.set(scale,scale);m.roughnessMap.repeat.set(scale,scale);m.normalMap.repeat.set(scale,scale);
  return m;
}

export function makeLibrary(level){
  return {
    floor:createPBRMaterial({base:level.theme.floor,seed:17+Number(level.id),rough:.98,scale:5,normalStrength:.18}),
    wall:createPBRMaterial({base:level.theme.wall,seed:29+Number(level.id),rough:level.theme.wallRough,scale:3.8,normalStrength:.35}),
    concrete:createPBRMaterial({base:level.theme.wall,seed:57+Number(level.id),rough:.97,scale:5.5,normalStrength:.3}),
    ceiling:createPBRMaterial({base:level.theme.ceiling,seed:89+Number(level.id),rough:.88,scale:4,normalStrength:.24}),
    metal:new THREE.MeshStandardMaterial({color:0x3d3f3e,roughness:.62,metalness:.78}),
    cable:new THREE.MeshStandardMaterial({color:0x171817,roughness:.79,metalness:.58}),
    water:new THREE.MeshStandardMaterial({color:0x263236,roughness:.09,metalness:.18,transparent:true,opacity:.72}),
    dark:new THREE.MeshStandardMaterial({color:0x030303,roughness:1,metalness:0}),
    crate:new THREE.MeshStandardMaterial({color:0x6e5132,roughness:.92,metalness:0}),
    exit:new THREE.MeshStandardMaterial({color:0xffffff,roughness:.38,metalness:.1,emissive:level.theme.accent,emissiveIntensity:1.2}),
    light:new THREE.MeshStandardMaterial({color:0xffffff,roughness:.28,metalness:0,emissive:level.theme.light,emissiveIntensity:3}),
    orangeLight:new THREE.MeshStandardMaterial({color:0xffddaa,roughness:.31,metalness:0,emissive:0xff9b52,emissiveIntensity:2.6})
  };
}

export function box(parent,geometry,material,x,y,z,rx=0,ry=0,rz=0){
  const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);parent.add(m);return m;
}

export function makePropSet(parent,level,library,rng,x,z){
  if(rng()<.16 && level.id!=="0"){
    box(parent,new THREE.BoxGeometry(.8,.7,.8),library.crate,x,.35,z);
    box(parent,new THREE.BoxGeometry(.86,.06,.86),library.metal,x,.72,z);
  }
  if(rng()<level.pipeChance){
    const pipe=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,4.4,8),library.metal);
    pipe.rotation.z=Math.PI/2;pipe.position.set(x,2.7,z);parent.add(pipe);
  }
}
