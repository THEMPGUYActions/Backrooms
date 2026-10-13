import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createServer as createNetServer } from "node:net";

const root=resolve("dist");
const chrome=process.env.CHROME_BIN||process.env.CHROMIUM_BIN||"chrome";
const mime={
  ".html":"text/html; charset=utf-8",
  ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".json":"application/json; charset=utf-8",
  ".svg":"image/svg+xml",
  ".png":"image/png",
  ".ogg":"audio/ogg",
  ".ico":"image/x-icon"
};

async function getFreePort(){
  const probe=createNetServer();
  await new Promise(resolveProbe=>probe.listen(0,"127.0.0.1",resolveProbe));
  const port=probe.address().port;
  await new Promise(resolveProbe=>probe.close(resolveProbe));
  return port;
}

const server=createServer(async(req,res)=>{
  try{
    const requestPath=decodeURIComponent((req.url||"/").split("?")[0]);
    const relative=requestPath==="/"?"index.html":requestPath.replace(/^\/+/, "");
    const file=resolve(root,relative);
    if(file!==root&&!file.startsWith(root+"\\")&&!file.startsWith(root+"/")){
      res.writeHead(403);res.end("Forbidden");return;
    }
    const data=await readFile(file);
    res.writeHead(200,{"content-type":mime[extname(file).toLowerCase()]||"application/octet-stream","cache-control":"no-store"});
    res.end(data);
  }catch{
    res.writeHead(404);res.end("Not found");
  }
});

await new Promise(resolveServer=>server.listen(0,"127.0.0.1",resolveServer));
const port=server.address().port;
const debugPort=await getFreePort();
const profile=await mkdtemp(join(tmpdir(),"backrooms-runtime-"));
let browser=null;
let ws=null;

try{
  browser=spawn(chrome,[
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--use-gl=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-dev-shm-usage",
    "--disable-service-worker",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port="+debugPort,
    "--user-data-dir="+profile,
    "about:blank"
  ],{stdio:"ignore"});

  let wsUrl=null;
  for(let i=0;i<150;i++){
    try{
      const pages=await fetch("http://127.0.0.1:"+debugPort+"/json/list").then(r=>r.json());
      wsUrl=pages.find(page=>page.type==="page")?.webSocketDebuggerUrl||null;
      if(wsUrl)break;
    }catch{}
    await delay(100);
  }
  if(!wsUrl)throw new Error("Chromium DevTools endpoint did not become ready");

  ws=new WebSocket(wsUrl);
  const pending=new Map();
  const messages=[];
  let commandId=0;

  ws.onmessage=event=>{
    const message=JSON.parse(event.data);
    if(message.id&&pending.has(message.id)){
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    messages.push(message);
  };

  await new Promise((resolveWs,rejectWs)=>{
    ws.onopen=resolveWs;
    ws.onerror=rejectWs;
  });

  const command=(method,params={},timeoutMs=10000)=>new Promise((resolveCommand,rejectCommand)=>{
    const id=++commandId;
    pending.set(id,message=>resolveCommand(message));
    ws.send(JSON.stringify({id,method,params}));
    setTimeout(()=>{
      if(pending.has(id)){
        pending.delete(id);
        rejectCommand(new Error("CDP timeout: "+method));
      }
    },timeoutMs);
  });

  await command("Runtime.enable");
  await command("Page.enable");
  await command("Runtime.evaluate",{expression:"location.href='http://127.0.0.1:"+port+"/index.html'",returnByValue:true});

  // Module imports are fetched from the Three.js CDN. Do not treat a slow
  // first-run network response as a broken bootstrap after one fixed 2.5s wait.
  let ready={};
  const bootstrapDeadline=Date.now()+15000;
  while(Date.now()<bootstrapDeadline){
    await delay(250);
    const readyResult=await command("Runtime.evaluate",{
      expression:"JSON.stringify({backrooms:!!window.backrooms,mounted:!!window.backrooms?.mounted,canvas:!!document.querySelector('canvas')})",
      returnByValue:true
    });
    ready=JSON.parse(readyResult.result?.result?.value||"{}");
    if(ready.backrooms&&ready.mounted&&ready.canvas)break;
  }
  if(!ready.backrooms||!ready.mounted||!ready.canvas){
    const bootstrapErrors=messages.filter(message=>
      message.method==="Runtime.exceptionThrown"||
      (message.method==="Runtime.consoleAPICalled"&&["error","assert"].includes(message.params?.type))
    );
    const detail=bootstrapErrors.map(message=>{
      if(message.method==="Runtime.exceptionThrown")return message.params?.exceptionDetails?.text||message.params?.exceptionDetails?.exception?.description||"Runtime exception";
      return message.params?.args?.map(arg=>arg.value??arg.description??"").join(" ")||"Console error";
    }).join("\\n");
    throw new Error("Game bootstrap did not finish within 15s: "+JSON.stringify(ready)+(detail?"\\nBrowser errors:\\n"+detail:""));
  }

  const desktopUiResult=await command("Runtime.evaluate",{
    expression:"JSON.stringify({touchClass:document.documentElement.classList.contains('touch-device'),mobileDisplay:getComputedStyle(document.getElementById('mobile-controls')).display,pcPrompt:getComputedStyle(document.querySelector('.audio-prompt-pc')).display,mobilePrompt:getComputedStyle(document.querySelector('.audio-prompt-mobile')).display,pcControls:[...document.querySelectorAll('.control-pc')].filter(e=>getComputedStyle(e).display!=='none').length,mobileControls:[...document.querySelectorAll('.control-mobile')].filter(e=>getComputedStyle(e).display!=='none').length,touchOnly:getComputedStyle(document.querySelector('.control-touch-only')).display})",
    returnByValue:true
  });
  const desktopUi=JSON.parse(desktopUiResult.result?.result?.value||"{}");
  if(desktopUi.touchClass)throw new Error("Desktop smoke browser was classified as a touch device");
  if(desktopUi.mobileDisplay!=="none")throw new Error("Mobile controls are visible on desktop: "+JSON.stringify(desktopUi));
  if(desktopUi.pcPrompt==="none"||desktopUi.mobilePrompt!=="none")throw new Error("Desktop audio prompt routing is wrong: "+JSON.stringify(desktopUi));
  if(desktopUi.pcControls===0||desktopUi.mobileControls!==0||desktopUi.touchOnly!=="none")throw new Error("Desktop control hint routing is wrong: "+JSON.stringify(desktopUi));

  await command("Runtime.evaluate",{expression:"(()=>{const page=document.querySelector('.intro-audio-page');if(page){page.classList.add('intro-audio-active');page.style.visibility='visible';page.style.opacity='1';}document.getElementById('audio-gate')?.focus();})()",returnByValue:true});
  const viewport=await command("Runtime.evaluate",{
    expression:"JSON.stringify({x:innerWidth/2,y:innerHeight/2})",
    returnByValue:true
  });
  const point=JSON.parse(viewport.result?.result?.value||"{\"x\":400,\"y\":300}");
  await command("Input.dispatchMouseEvent",{type:"mousePressed",x:point.x,y:point.y,button:"left",clickCount:1});
  await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:point.x,y:point.y,button:"left",clickCount:1});
  await delay(1500);

  const stateResult=await command("Runtime.evaluate",{
    expression:"JSON.stringify({running:window.backrooms.running,paused:window.backrooms.paused,introActive:window.backrooms.introActive,runtimeFaulted:window.backrooms.runtimeFaulted,mobileDisplay:getComputedStyle(document.getElementById('mobile-controls')).display,hud:getComputedStyle(document.getElementById('hud')).display,bootDisplay:getComputedStyle(document.getElementById('boot')).display,bootPointerEvents:getComputedStyle(document.getElementById('boot')).pointerEvents})",
    returnByValue:true
  });
  const state=JSON.parse(stateResult.result?.result?.value||"{}");
  if(!state.running||state.paused||state.introActive||state.runtimeFaulted){
    const runtimeErrors=messages.filter(message=>message.method==="Runtime.exceptionThrown"||(message.method==="Runtime.consoleAPICalled"&&["error","assert"].includes(message.params?.type)));
    const detail=runtimeErrors.map(message=>message.method==="Runtime.exceptionThrown"
      ?(message.params?.exceptionDetails?.text||message.params?.exceptionDetails?.exception?.description||"Runtime exception")
      :(message.params?.args?.map(arg=>arg.value??arg.description??"").join(" ")||"Console error")).join("\n");
    throw new Error("Gameplay did not remain healthy after real UI activation: "+JSON.stringify(state)+(detail?"\n"+detail:""));
  }
  if(state.mobileDisplay!=="none")throw new Error("Mobile controls appeared on desktop after gameplay start: "+JSON.stringify(state));
  if(state.hud==="none")throw new Error("HUD remained hidden after gameplay start");

  const entityAiResult=await command("Runtime.evaluate",{
    expression:"(async()=>{const g=window.backrooms;const manager=g.entityManager;if(!manager)return JSON.stringify({error:'Entity manager missing'});const previousLoad=manager.modelLibrary.load;let entity=null;try{manager.modelLibrary.load=async()=>({scene:new manager.entities[manager.entities.length-1].group.constructor(),animations:[],format:'gltf',file:'runtime-smoke-invalid.glb'});const target=g.player.position.clone();const spawn=target.clone();spawn.x+=8;entity=manager.create('hound',spawn,'runtime-smoke-entity-ai');if(!entity)throw new Error('Could not create smoke entity');await Promise.resolve();const proceduralFallback=entity.group.children.length>0&&!entity.group.userData.realModel;entity.lastSeen=target;entity.state='chase';entity.pathTimer=0;manager.update(1/60);return JSON.stringify({pathLength:entity.path?.length||0,proceduralFallback,runtimeFaulted:!!g.runtimeFaulted});}finally{manager.modelLibrary.load=previousLoad;manager.clear();}})()",
    awaitPromise:true,
    returnByValue:true
  });
  const entityAi=JSON.parse(entityAiResult.result?.result?.value||"{}");
  if((entityAi.pathLength||0)<2||!entityAi.proceduralFallback||entityAi.runtimeFaulted)throw new Error("Entity AI waypoint smoke failed: "+JSON.stringify(entityAi));

  const pauseCheck=await command("Runtime.evaluate",{expression:"(()=>{const g=window.backrooms;g.togglePause(true);const m=document.getElementById('mobile-controls');const p=document.getElementById('pause');return JSON.stringify({paused:g.paused,mobileHidden:m?.classList.contains('hidden'),mobileDisplay:m?getComputedStyle(m).display:null,pauseHidden:p?.classList.contains('hidden'),pausePointer:p?getComputedStyle(p).pointerEvents:null})})()",returnByValue:true});
  const pausedUi=JSON.parse(pauseCheck.result.result.value||"{}");
  if(!pausedUi.paused||!pausedUi.mobileHidden||pausedUi.mobileDisplay!=="none"||pausedUi.pauseHidden||pausedUi.pausePointer==="none")throw new Error("Pause UI did not take control of the touch layer: "+JSON.stringify(pausedUi));

  const resumeCheck=await command("Runtime.evaluate",{expression:"document.getElementById('resume')?.click();JSON.stringify({paused:window.backrooms.paused,mobileHidden:document.getElementById('mobile-controls')?.classList.contains('hidden')})",returnByValue:true});
  const resumed=JSON.parse(resumeCheck.result.result.value||"{}");
  if(resumed.paused)throw new Error("Pause Resume button did not resume the game");

  if(state.bootDisplay!=="none"||state.bootPointerEvents!=="none")throw new Error("Intro overlay still blocked gameplay after activation: "+JSON.stringify(state));

  await command("Runtime.evaluate",{expression:"location.href='http://127.0.0.1:"+port+"/index.html?admin=1'",returnByValue:true});
  await delay(2500);
  await command("Runtime.evaluate",{expression:"(()=>{const page=document.querySelector('.intro-audio-page');if(page){page.classList.add('intro-audio-active');page.style.visibility='visible';page.style.opacity='1';}document.getElementById('audio-gate')?.focus();})()",returnByValue:true});
  await command("Input.dispatchMouseEvent",{type:"mousePressed",x:point.x,y:point.y,button:"left",clickCount:1});
  await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:point.x,y:point.y,button:"left",clickCount:1});
  await delay(1500);
  const runtimeErrors=messages.filter(message=>
    message.method==="Runtime.exceptionThrown"||
    (message.method==="Runtime.consoleAPICalled"&&["error","assert"].includes(message.params?.type))
  );
  if(runtimeErrors.length){
    const detail=runtimeErrors.map(message=>{
      if(message.method==="Runtime.exceptionThrown")return message.params?.exceptionDetails?.text||message.params?.exceptionDetails?.exception?.description||"Runtime exception";
      return message.params?.args?.map(arg=>arg.value??arg.description??"").join(" ")||"Console error";
    }).join("\n");
    throw new Error("Runtime browser errors:\n"+detail);
  }
  const adminButtonResult=await command("Runtime.evaluate",{
    expression:"(()=>{const b=document.getElementById('admin-open');if(!b)return false;const r=b.getBoundingClientRect();return {ok:true,x:r.left+r.width/2,y:r.top+r.height/2,hidden:b.hidden}})()",
    returnByValue:true
  });
  const adminButton=adminButtonResult.result?.result?.value;
  if(!adminButton?.ok||adminButton.hidden)throw new Error("Admin opener was not available after gameplay activation: "+JSON.stringify(adminButton));
  await command("Runtime.evaluate",{expression:"document.getElementById('admin-open')?.click()",returnByValue:true});
  await delay(250);

  const adminStateResult=await command("Runtime.evaluate",{
    expression:"JSON.stringify({enabled:window.backrooms.admin.enabled,ready:!!window.backroomsAdmin?.ready,opened:!!window.backroomsAdmin?.opened,panel:!!document.getElementById('admin-panel'),panelVisible:!!document.getElementById('admin-panel')&&!document.getElementById('admin-panel').classList.contains('hidden'),running:window.backrooms.running,introActive:window.backrooms.introActive})",
    returnByValue:true
  });
  const adminState=JSON.parse(adminStateResult.result?.result?.value||"{}");
  if(!adminState.enabled||!adminState.ready||!adminState.opened||!adminState.panel||!adminState.panelVisible||!adminState.running||adminState.introActive){
    throw new Error("Admin did not defer safely until gameplay was active: "+JSON.stringify(adminState));
  }

  if(process.env.BACKROOMS_AUDIT_ENTITY_MODELS==="1"){
    const modelAuditResult=await command("Runtime.evaluate",{
      expression:"(async()=>{const THREE=await import('https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js');const g=window.backrooms;const manager=g.entityManager;const types=['bacteria','deathmoth','duller','faceling','hound','partygoer','skinstealer','smiler'];const round=n=>Number.isFinite(n)?Math.round(n*1000)/1000:null;const rows=[];for(const type of types){try{const asset=await manager.modelLibrary.load(type);if(!asset){rows.push({type,error:'No supported model loaded'});continue;}const root=asset.scene;root.updateMatrixWorld(true);const allBox=new THREE.Box3().setFromObject(root);const allSize=allBox.getSize(new THREE.Vector3());const visibleBox=new THREE.Box3();const meshes=[];root.traverse(o=>{if(!o.isMesh||!o.geometry?.attributes?.position)return;let p=o,visible=true;while(p){if(!p.visible){visible=false;break;}if(p===root)break;p=p.parent;}const b=new THREE.Box3().setFromObject(o);const z=b.getSize(new THREE.Vector3());meshes.push({name:o.name||o.type,visible,verts:o.geometry.attributes.position.count,size:[round(z.x),round(z.y),round(z.z)],scale:[round(o.scale.x),round(o.scale.y),round(o.scale.z)],bboxEmpty:b.isEmpty()});if(visible)visibleBox.union(b);});const v=visibleBox.getSize(new THREE.Vector3());rows.push({type,file:asset.file,format:asset.format,animations:asset.animations?.length||0,meshCount:meshes.length,allSize:[round(allSize.x),round(allSize.y),round(allSize.z)],visibleSize:[round(v.x),round(v.y),round(v.z)],visibleToAllHeight:allSize.y?round(v.y/allSize.y):null,largestMeshes:meshes.sort((a,b)=>(b.size[0]*b.size[1]*b.size[2])-(a.size[0]*a.size[1]*a.size[2])).slice(0,5)});}catch(error){rows.push({type,error:String(error?.stack||error)});}}console.log('ENTITY_MODEL_AUDIT '+JSON.stringify(rows));return JSON.stringify(rows)})()",
      awaitPromise:true,
      returnByValue:true
    },180000);
    const modelAudit=JSON.parse(modelAuditResult.result?.result?.value||"[]");
    if(modelAudit.length!==8||modelAudit.some(item=>item.error))throw new Error("Entity GLB audit could not inspect all eight models: "+JSON.stringify(modelAudit));
    console.log("ENTITY_MODEL_AUDIT "+JSON.stringify(modelAudit));
  
  }
  const modelAttachResult=await command("Runtime.evaluate",{
    expression:"(async()=>{ const THREE=await import('https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js'); const g=window.backrooms,manager=g.entityManager,results=[]; for(const [type,targetHeight,yaw,targetWidth] of [['bacteria',8.5,Math.PI,6.5],['smiler',2,Math.PI/2,null]]){ const group=new THREE.Group();group.position.set(1000+results.length*20,0,1000);group.userData.height=1.8;g.scene.add(group); const entity={type,group,state:'idle',model:null}; try{ const attached=await manager.modelLibrary.attach(entity);if(!attached||!entity.model?.container)throw new Error(type+' GLB was not attached'); const measure=(precise=true)=>{g.scene.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(entity.model.container,precise);const size=box.getSize(new THREE.Vector3());return {height:size.y,width:Math.max(size.x,size.z),depth:Math.min(size.x,size.z)};}; const initial=measure();const result={type,attached,targetHeight:entity.model.targetHeight,targetWidth:entity.model.targetWidth??null,height:initial.height,width:initial.width,depth:initial.depth,scaleY:entity.model.container.scale.y,scaleXZ:entity.model.container.scale.x,yaw:entity.model.container.rotation.y,animations:entity.model.clips.length}; if(entity.model.mixer&&type==='bacteria'){manager.modelLibrary.play(entity,['stalkingpose','TposeLifeform']);entity.model.mixer.update(.25);const idlePose=measure(true);result.defaultClip=entity.model.current?.getClip?.().name||null;result.defaultHeight=idlePose.height;result.defaultWidth=idlePose.width;} const animated=[]; if(entity.model.mixer&&entity.model.clips.length){for(const clip of entity.model.clips){entity.model.mixer.stopAllAction();const action=entity.model.actions.get(clip.name);if(!action)continue;action.reset().play();entity.model.mixer.setTime(Math.min(Math.max(clip.duration*.37,1/60),.45));const pose=measure(true);if(!Number.isFinite(pose.height)||!Number.isFinite(pose.width)||pose.height<.05||pose.width<.05)throw new Error(type+' invalid animation bounds: '+clip.name+' '+JSON.stringify(pose));animated.push({clip:clip.name,height:pose.height,width:pose.width});action.stop();}} if(animated.length){result.animationSamples=animated.length;result.animationPoses=animated;} results.push(result); if(Math.abs(result.height-targetHeight)>.18)throw new Error(type+' height mismatch: '+JSON.stringify(result)); if(Math.abs(result.yaw-yaw)>.001)throw new Error(type+' yaw mismatch: '+JSON.stringify(result)); if(targetWidth&&result.width<targetWidth-.15)throw new Error(type+' horizontal width mismatch: '+JSON.stringify(result)); if(type==='bacteria'&&(!String(result.defaultClip||'').toLowerCase().includes('stalkingpose')||result.defaultHeight<2.5||result.defaultWidth<2.3))throw new Error('Bacteria default/stalking pose is not full-size: '+JSON.stringify(result)); }finally{g.scene.remove(group);} } return JSON.stringify(results) })()",
    awaitPromise:true,
    returnByValue:true
  },90000);
  if(modelAttachResult.result?.exceptionDetails){
    const details=modelAttachResult.result.exceptionDetails;
    throw new Error("ENTITY_MODEL_ATTACH_SMOKE browser exception: "+(details.text||details.exception?.description||JSON.stringify(details)));
  }
  const modelAttachValue=modelAttachResult.result?.result?.value;
  const modelAttach=typeof modelAttachValue==="string"?JSON.parse(modelAttachValue):modelAttachValue;
  if(modelAttach.length!==2||modelAttach.some(x=>!x.attached))throw new Error("ENTITY_MODEL_ATTACH_SMOKE failed: "+JSON.stringify(modelAttach));
  if(modelAttach.some(x=>Math.abs(x.height-x.targetHeight)>.18))throw new Error("ENTITY_MODEL_ATTACH_SMOKE height mismatch: "+JSON.stringify(modelAttach));
  if(modelAttach.some(x=>x.type==="bacteria"&&x.width<6.3))throw new Error("ENTITY_MODEL_ATTACH_SMOKE Bacteria width mismatch: "+JSON.stringify(modelAttach));
  if(modelAttach.some(x=>x.type==="bacteria"&&(!String(x.defaultClip||"").toLowerCase().includes("stalkingpose")||x.defaultHeight<6.1||x.defaultWidth<5.5)))throw new Error("ENTITY_MODEL_ATTACH_SMOKE Bacteria default pose mismatch: "+JSON.stringify(modelAttach));
  if(modelAttach.some(x=>x.type==="bacteria"&&x.animations===0))throw new Error("Bacteria animations did not load");
  const level0LightResult=await command("Runtime.evaluate",{
    expression:"(()=>{\nconst g=window.backrooms;\nconst lights=[...g.world.chunks.values()].flatMap(chunk=>chunk.lightSources||[]).filter(entry=>entry.fixture?.userData?.light);\nconst result={fixtures:lights.length,maxBaseIntensity:lights.length?Math.max(...lights.map(entry=>entry.baseIntensity??entry.intensity??0)):0,maxFixtureEmissive:lights.length?Math.max(...lights.map(entry=>entry.fixture.userData.baseEmissive??entry.fixture.material?.emissiveIntensity??0)):0,maxRange:lights.length?Math.max(...lights.map(entry=>entry.distance??0)):0};\nif(!lights.length||result.maxBaseIntensity>35||result.maxFixtureEmissive>1.2||result.maxRange>9.5)throw new Error('Level 0 lights exceed the reviewed brightness/range budget: '+JSON.stringify(result));\nreturn JSON.stringify(result);\n})()",
    awaitPromise:true,
    returnByValue:true
  },30000);
  if(level0LightResult.result?.exceptionDetails){const d=level0LightResult.result.exceptionDetails;throw new Error("LEVEL0_LIGHTING_SMOKE failed: "+(d.text||d.exception?.description||JSON.stringify(d)));}
  const level0Lighting=JSON.parse(level0LightResult.result?.result?.value||"{}");
  console.log("LEVEL0_LIGHTING_SMOKE "+JSON.stringify(level0Lighting));
  console.log("ENTITY_MODEL_ATTACH_SMOKE "+JSON.stringify(modelAttach));
  console.log("RUNTIME SMOKE PASS");
  console.log(JSON.stringify({desktopUi,state,errors:0}));
}finally{
  ws?.close();
  if(browser&&!browser.killed)browser.kill("SIGKILL");
  await rm(profile,{recursive:true,force:true}).catch(()=>{});
  await new Promise(resolveServer=>server.close(resolveServer));
}
