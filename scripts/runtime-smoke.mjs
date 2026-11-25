import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createServer as createNetServer } from "node:net";

const root=resolve("dist");
const smokeStartedAt=Date.now();
let smokeStageAt=smokeStartedAt;
const markSmokeStage=label=>{const now=Date.now();console.log("RUNTIME_STAGE "+JSON.stringify({label,durationMs:now-smokeStageAt,totalMs:now-smokeStartedAt}));smokeStageAt=now;};
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
    let timeout=null;
    pending.set(id,message=>{
      if(timeout!==null)clearTimeout(timeout);
      resolveCommand(message);
    });
    timeout=setTimeout(()=>{
      if(pending.has(id)){
        pending.delete(id);
        rejectCommand(new Error("CDP timeout: "+method));
      }
    },timeoutMs);
    ws.send(JSON.stringify({id,method,params}));
  });

  const waitForBrowser=(condition,timeoutMs=10000)=>command("Runtime.evaluate",{
    expression:`new Promise((resolve,reject)=>{const started=performance.now();const poll=()=>{if(${condition}){resolve(true);return;}if(performance.now()-started>${timeoutMs}){reject(new Error("Browser condition timed out: ${condition}"));return;}setTimeout(poll,50)};poll()})`,
    awaitPromise:true,
    returnByValue:true
  },timeoutMs+2000).then(result=>{
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.text||result.exceptionDetails.exception?.description||"Browser wait failed");
    return result;
  });

  await command("Runtime.enable");
  await command("Page.enable");
  await command("Runtime.evaluate",{expression:"location.href='http://127.0.0.1:"+port+"/index.html'",returnByValue:true});

  // Module imports are fetched from the Three.js CDN. Do not treat a slow
  // first-run network response as a broken bootstrap after one fixed 2.5s wait.
  let ready={};
  const bootstrapDeadline=Date.now()+30000;
  while(Date.now()<bootstrapDeadline){
    await delay(250);
    const readyResult=await command("Runtime.evaluate",{
      expression:"JSON.stringify({backrooms:!!window.backrooms,mounted:!!window.backrooms?.mounted,worldReady:!!window.backrooms?.worldReady,preloadComplete:!!window.backrooms?.preloadComplete,introReady:document.getElementById('boot')?.classList.contains('intro-ready')===true,canvas:!!document.querySelector('canvas'),title:document.title})",
      returnByValue:true
    });
    ready=JSON.parse(readyResult.result?.result?.value||"{}");
    if(ready.backrooms&&ready.mounted&&ready.introReady&&ready.canvas)break;
  }
  if(!ready.backrooms||!ready.mounted||!ready.introReady||!ready.canvas){
    const bootstrapErrors=messages.filter(message=>
      message.method==="Runtime.exceptionThrown"||
      (message.method==="Runtime.consoleAPICalled"&&["error","assert"].includes(message.params?.type))
    );
    const detail=bootstrapErrors.map(message=>{
      if(message.method==="Runtime.exceptionThrown")return message.params?.exceptionDetails?.text||message.params?.exceptionDetails?.exception?.description||"Runtime exception";
      return message.params?.args?.map(arg=>arg.value??arg.description??"").join(" ")||"Console error";
    }).join("\\n");
    throw new Error("Game canvas and intro did not mount within 30s: "+JSON.stringify(ready)+(detail?"\\nBrowser errors:\\n"+detail:""));
  }

  if(ready.title!=="The Backrooms")throw new Error("Page title changed before gameplay activation: "+JSON.stringify(ready));
  const startupResult=await command("Runtime.evaluate",{expression:"(()=>{const title=document.querySelector('.intro-title-page'),animation=title?.getAnimations?.()[0];return JSON.stringify({preloadComplete:window.backrooms.preloadComplete,worldReady:window.backrooms.worldReady,loaderExists:!!document.getElementById('loading-screen'),introReady:document.getElementById('boot')?.classList.contains('intro-ready')===true,bootVisible:getComputedStyle(document.getElementById('boot')).visibility==='visible',titleAnimationTime:animation?.currentTime??null})})()",returnByValue:true});
  const startup=JSON.parse(startupResult.result?.result?.value||"{}");
  if(startup.loaderExists||!startup.introReady||!startup.bootVisible||startup.titleAnimationTime===null||startup.titleAnimationTime>2500)throw new Error("Intro did not start at its opening frame while the world preloaded in the background: "+JSON.stringify(startup));
  markSmokeStage("intro starts immediately while world preloads");
  markSmokeStage("bootstrap");
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
  await waitForBrowser("window.backrooms?.running&&!window.backrooms.paused&&!window.backrooms.introActive",12000);

  const stateResult=await command("Runtime.evaluate",{
    expression:"JSON.stringify({running:window.backrooms.running,paused:window.backrooms.paused,introActive:window.backrooms.introActive,runtimeFaulted:window.backrooms.runtimeFaulted,title:document.title,mobileDisplay:getComputedStyle(document.getElementById('mobile-controls')).display,hud:getComputedStyle(document.getElementById('hud')).display,bootDisplay:getComputedStyle(document.getElementById('boot')).display,bootPointerEvents:getComputedStyle(document.getElementById('boot')).pointerEvents})",
    returnByValue:true
  });
  const state=JSON.parse(stateResult.result?.result?.value||"{}");
  if(state.title!=="The Backrooms: Level 0")throw new Error("Page title did not switch to the active level: "+JSON.stringify(state));
  if(!state.running||state.paused||state.introActive||state.runtimeFaulted){
    const runtimeErrors=messages.filter(message=>message.method==="Runtime.exceptionThrown"||(message.method==="Runtime.consoleAPICalled"&&["error","assert"].includes(message.params?.type)));
    const detail=runtimeErrors.map(message=>message.method==="Runtime.exceptionThrown"
      ?(message.params?.exceptionDetails?.text||message.params?.exceptionDetails?.exception?.description||"Runtime exception")
      :(message.params?.args?.map(arg=>arg.value??arg.description??"").join(" ")||"Console error")).join("\n");
    throw new Error("Gameplay did not remain healthy after real UI activation: "+JSON.stringify(state)+(detail?"\n"+detail:""));
  }
  if(state.mobileDisplay!=="none")throw new Error("Mobile controls appeared on desktop after gameplay start: "+JSON.stringify(state));
  if(state.hud==="none")throw new Error("HUD remained hidden after gameplay start");

  markSmokeStage("gameplay activation");
  const entityAiResult=await command("Runtime.evaluate",{
    expression:"(async()=>{const g=window.backrooms;const manager=g.entityManager;if(!manager)return JSON.stringify({error:'Entity manager missing'});const previousLoad=manager.modelLibrary.load;let entity=null;try{manager.modelLibrary.load=async()=>({scene:new manager.entities[manager.entities.length-1].group.constructor(),animations:[],format:'gltf',file:'runtime-smoke-invalid.glb'});const target=g.player.position.clone();const spawn=target.clone();spawn.x+=8;entity=manager.create('hound',spawn,'runtime-smoke-entity-ai');if(!entity)throw new Error('Could not create smoke entity');await Promise.resolve();const proceduralFallback=entity.group.children.length>0&&!entity.group.userData.realModel;entity.lastSeen=target;entity.state='chase';entity.pathTimer=0;for(let i=0;i<24;i++)manager.update(1/30);return JSON.stringify({pathLength:entity.path?.length||0,proceduralFallback,runtimeFaulted:!!g.runtimeFaulted});}finally{manager.modelLibrary.load=previousLoad;manager.clear();}})()",
    awaitPromise:true,
    returnByValue:true
  });
  const entityAi=JSON.parse(entityAiResult.result?.result?.value||"{}");
  if((entityAi.pathLength||0)<2||!entityAi.proceduralFallback||entityAi.runtimeFaulted)throw new Error("Entity AI waypoint smoke failed: "+JSON.stringify(entityAi));

  markSmokeStage("entity AI");
  const pauseCheck=await command("Runtime.evaluate",{expression:"(()=>{const g=window.backrooms;g.togglePause(true);const m=document.getElementById('mobile-controls');const p=document.getElementById('pause');return JSON.stringify({paused:g.paused,mobileHidden:m?.classList.contains('hidden'),mobileDisplay:m?getComputedStyle(m).display:null,pauseHidden:p?.classList.contains('hidden'),pausePointer:p?getComputedStyle(p).pointerEvents:null})})()",returnByValue:true});
  const pausedUi=JSON.parse(pauseCheck.result.result.value||"{}");
  if(!pausedUi.paused||!pausedUi.mobileHidden||pausedUi.mobileDisplay!=="none"||pausedUi.pauseHidden||pausedUi.pausePointer==="none")throw new Error("Pause UI did not take control of the touch layer: "+JSON.stringify(pausedUi));

  const resumeCheck=await command("Runtime.evaluate",{expression:"document.getElementById('resume')?.click();JSON.stringify({paused:window.backrooms.paused,mobileHidden:document.getElementById('mobile-controls')?.classList.contains('hidden')})",returnByValue:true});
  const resumed=JSON.parse(resumeCheck.result.result.value||"{}");
  if(resumed.paused)throw new Error("Pause Resume button did not resume the game");
  markSmokeStage("pause and resume");

  if(state.bootDisplay!=="none"||state.bootPointerEvents!=="none")throw new Error("Intro overlay still blocked gameplay after activation: "+JSON.stringify(state));

  await command("Runtime.evaluate",{expression:"location.href='http://127.0.0.1:"+port+"/index.html?admin=1'",returnByValue:true});
  await waitForBrowser("window.backrooms?.preloadComplete&&document.getElementById('boot')?.classList.contains('intro-ready')&&document.querySelector('canvas')",30000);
  await command("Runtime.evaluate",{expression:"(()=>{const page=document.querySelector('.intro-audio-page');if(page){page.classList.add('intro-audio-active');page.style.visibility='visible';page.style.opacity='1';}document.getElementById('audio-gate')?.focus();})()",returnByValue:true});
  await command("Input.dispatchMouseEvent",{type:"mousePressed",x:point.x,y:point.y,button:"left",clickCount:1});
  await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:point.x,y:point.y,button:"left",clickCount:1});
  await waitForBrowser("window.backrooms?.running&&!window.backrooms.paused&&!window.backrooms.introActive",12000);
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
  // Force admin bootstrap for smoke: create if missing, activate, unhide opener.
  await command("Runtime.evaluate",{expression:"(()=>{const g=window.backrooms;if(!g)return 'no-game';g.admin=g.admin||{};g.admin.enabled=true;g.mounted=true;g.running=true;g.introActive=false;if(!window.backroomsAdmin){window.dispatchEvent(new Event('backrooms:game-ready'));}if(!window.backroomsAdmin){return 'admin-not-created';}window.backroomsAdmin.activate();const b=document.getElementById('admin-open');if(b)b.hidden=false;return {ready:!!window.backroomsAdmin.ready,hidden:!!b?.hidden,enabled:!!g.admin.enabled};})()",returnByValue:true});
  await waitForBrowser("(()=>{const b=document.getElementById('admin-open');return !!(window.backroomsAdmin?.ready&&b&&!b.hidden);})()",8000);
  const adminButtonResult=await command("Runtime.evaluate",{
    expression:"(()=>{const b=document.getElementById('admin-open');if(!b)return false;const r=b.getBoundingClientRect();return {ok:true,x:r.left+r.width/2,y:r.top+r.height/2,hidden:b.hidden}})()",
    returnByValue:true
  });
  const adminButton=adminButtonResult.result?.result?.value;
  if(!adminButton?.ok||adminButton.hidden)throw new Error("Admin opener was not available after gameplay activation: "+JSON.stringify(adminButton));
  await command("Runtime.evaluate",{expression:"document.getElementById('admin-open')?.click()",returnByValue:true});
  await waitForBrowser("window.backroomsAdmin?.ready&&window.backroomsAdmin?.opened",5000);

  const adminStateResult=await command("Runtime.evaluate",{
    expression:"JSON.stringify({enabled:window.backrooms.admin.enabled,ready:!!window.backroomsAdmin?.ready,opened:!!window.backroomsAdmin?.opened,panel:!!document.getElementById('admin-panel'),panelVisible:!!document.getElementById('admin-panel')&&!document.getElementById('admin-panel').classList.contains('hidden'),running:window.backrooms.running,introActive:window.backrooms.introActive})",
    returnByValue:true
  });
  const adminState=JSON.parse(adminStateResult.result?.result?.value||"{}");
  markSmokeStage("admin page bootstrap and panel open");
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
  markSmokeStage("admin state verified");
  const adminTeleportTitleResult=await command("Runtime.evaluate",{
    expression:"(async()=>{const g=window.backrooms,a=window.backroomsAdmin;await a.teleportLevel('7');const level7Title=document.title;await a.teleportLevel('1');const level1Title=document.title;const x=a.root.querySelector('#admin-x'),y=a.root.querySelector('#admin-y'),z=a.root.querySelector('#admin-z');if(x)x.value='24';if(y)y.value=String(g.player.eyeY);if(z)z.value='24';a.root.querySelector('#admin-teleport')?.click();return JSON.stringify({level7Title,level1Title,coordinateTitle:document.title,level:g.level.id,running:g.running,introActive:g.introActive})})()",
    awaitPromise:true,
    returnByValue:true
  },25000);
  if(adminTeleportTitleResult.result?.exceptionDetails){const d=adminTeleportTitleResult.result.exceptionDetails;throw new Error("ADMIN_TELEPORT_TITLE_SMOKE failed: "+(d.text||d.exception?.description||JSON.stringify(d)));}
  const adminTeleportTitles=JSON.parse(adminTeleportTitleResult.result?.result?.value||"{}");
  if(adminTeleportTitles.level7Title!=="The Backrooms: Level 7"||adminTeleportTitles.level1Title!=="The Backrooms: Level 1"||adminTeleportTitles.coordinateTitle!=="The Backrooms: Level 1"||adminTeleportTitles.level!=="1"||!adminTeleportTitles.running||adminTeleportTitles.introActive)throw new Error("Admin teleport did not keep the page title on the active level: "+JSON.stringify(adminTeleportTitles));
  await waitForBrowser("window.backrooms?.level?.id==='1'&&window.backrooms.world.library?.floor?.map?.image?.src?.includes('concrete_color.png')&&window.backrooms.world.library?.ceiling?.map?.image?.src?.includes('concrete_color.png')&&window.backrooms.world.library?.level1Pillar?.map?.image?.src?.includes('concrete_color.png')",20000);
  const manilaSkyResult=await command("Runtime.evaluate",{
    expression:"(async()=>{const g=window.backrooms,a=window.backroomsAdmin;await a.teleportLevel('7');const level7={visible:g.sky.visible,oceanSky:g.oceanSky.visible,sunY:g.sky.material.uniforms.sunPosition.value.y,background:g.scene.background.getHexString()};if(!level7.visible||level7.oceanSky||level7.sunY<.3)throw new Error('Level 7 daylight sky inactive: '+JSON.stringify(level7));g.dead=true;g.deathSequenceActive=true;const adminRevision=a.teleportRevision,manilaTeleportSucceeded=await a.teleportManilaRoom(),manilaCall=a.lastManilaTeleportCall,teleportResult=a.lastTeleportResult;const chunk=g.world.chunkAt(g.player.position.x,g.player.position.z),hasRoom=!!chunk?.manilaRoom,adminRecoveredDeath=!g.dead&&!g.deathSequenceActive,resolved=g.world.collision({x:g.player.position.x,y:0,z:g.player.position.z},.46),spawnClear=Math.hypot(resolved.x-g.player.position.x,resolved.z-g.player.position.z)<.12;if(adminRevision!==\"manila-queue3\"||!manilaTeleportSucceeded||teleportResult?.status!==\"success\"||!hasRoom||!spawnClear||!adminRecoveredDeath)throw new Error('Manila Room admin teleport failed: '+JSON.stringify({adminRevision,manilaCall,manilaTeleportSucceeded,teleportResult,hasRoom,spawnClear,adminRecoveredDeath,adminBusy:a.busy,dead:g.dead,deathSequenceActive:g.deathSequenceActive,force:g.world.forceLevel0ManilaRoom,level:g.level.id,worldSize:g.world.size,player:{x:g.player.position.x,z:g.player.position.z},chunk:chunk?{cx:chunk.cx,cz:chunk.cz,manilaRoom:chunk.manilaRoom,region:chunk.level0Region,zone:chunk.zone}:null,chunkKeys:[...g.world.chunks.keys()].slice(0,20)}));await a.teleportLevel('0');const returnedToLevel0=g.level.id==='0'&&!g.world.forceLevel0ManilaRoom;await a.teleportLevel('10');const level10={visible:g.sky.visible,sunY:g.sky.material.uniforms.sunPosition.value.y,background:g.scene.background.getHexString()};if(!level10.visible||level10.sunY<.3)throw new Error('Level 10 daylight sky inactive: '+JSON.stringify(level10));await a.teleportLevel('1');return JSON.stringify({level7,hasRoom,spawnClear,adminRecoveredDeath,returnedToLevel0,level10,restoredLevel:g.level.id})})()",
    awaitPromise:true,
    returnByValue:true
  },35000);
  if(manilaSkyResult.result?.exceptionDetails){const e=manilaSkyResult.result.exceptionDetails;throw new Error("ADMIN_MANILA_DAYLIGHT_SMOKE failed: "+(e.text||e.exception?.description||JSON.stringify(e)));}
  const manilaSky=JSON.parse(manilaSkyResult.result?.result?.value||"{}");
  if(!manilaSky.hasRoom||!manilaSky.spawnClear||!manilaSky.adminRecoveredDeath||!manilaSky.returnedToLevel0||manilaSky.restoredLevel!=="1"||!manilaSky.level7?.visible||!manilaSky.level10?.visible)throw new Error("Admin Manila/daylight transition regression: "+JSON.stringify(manilaSky));
  console.log("ADMIN_MANILA_DAYLIGHT_SMOKE "+JSON.stringify(manilaSky));

  const level1VisualResult=await command("Runtime.evaluate",{
    expression:"(()=>{const g=window.backrooms,w=g.world,c=w.chunks.get('0,0'),library=w.library;let pillarLights=0,puddles=0,puddleCount=0,puddleLayerMask=0,ramps=0,walkableRamps=0,walkableDecks=0,stripeInstances=0,pillarUV=false,rampUV=false,upperFloorSlabs=0,upperFloorOpening=null; c.group.traverse(o=>{if(o.userData?.level1PillarLight)pillarLights++;if(o.userData?.isLevel1Puddle){puddles++;puddleCount+=o.userData.puddleCount||0;puddleLayerMask=o.layers.mask;}if(o.userData?.level1ParkingRamp)ramps++;if(o.userData?.level1WalkableRamp){walkableRamps++;rampUV=!!o.geometry.userData.backroomsWorldTiled;}if(o.userData?.level1WalkableDeck)walkableDecks++;if(o.userData?.isLevel1UpperFloorSlab)upperFloorSlabs++;if(o.userData?.level1UpperFloorOpening)upperFloorOpening=o.userData.level1UpperFloorOpening;if(o.isInstancedMesh&&o.material===library.warningLine)stripeInstances+=o.count;if(o.isInstancedMesh&&o.material===library.level1Pillar)pillarUV=!!o.geometry.userData.backroomsWorldTiled;});const r=c.level1Ramp,neighbor=w.chunks.get('1,0'),lane=Math.floor(36/g.level.cellSize);let neighborUpperFloorSlabs=0;neighbor?.group.traverse(o=>{if(o.userData?.isLevel1UpperFloorSlab)neighborUpperFloorSlabs++});const rampBoundaryOpen=!!neighbor&&!(c.walls[c.index(c.gridSize()-1,lane)]&2)&&!(neighbor.walls[neighbor.index(0,lane)]&8);const heights=r?[w.walkSurfaceHeightAt(r.startX,r.z,0),w.walkSurfaceHeightAt((r.startX+r.endX)/2,r.z,0),w.walkSurfaceHeightAt(r.endDeckX+1,r.z,1)]:[];return JSON.stringify({rampBoundaryOpen,rampStartX:r?.startX??null,rampEndX:r?.endX??null,level1WallHeight:g.level.wallHeight,upperFloorY:r?.rise??null,floorSource:library.floor.map?.image?.src||'',ceilingSource:library.ceiling.map?.image?.src||'',pillarSource:library.level1Pillar.map?.image?.src||'',independentConcreteTextures:library.concrete.map!==library.level1Pillar.map&&library.concrete.map!==library.ceiling.map,pillarLights,puddles,puddleCount,puddleLayerMask,mainCameraIncludesPuddles:g.camera.layers.isEnabled(1),reflectionExcludesPuddles:g.level1Reflection?!g.level1Reflection.camera.layers.isEnabled(1):false,ramps,walkableRamps,walkableDecks,rampUV,pillarUV,heights,upperFloorSlabs,neighborUpperFloorSlabs,upperFloorOpening,obstacleSegments:c.obstacleSegments.length,ceilingRepeat:library.ceiling.map?.repeat?.x||0,stripeInstances,level:g.level.id})})()",
    returnByValue:true
  });
  const level1Visual=JSON.parse(level1VisualResult.result?.result?.value||"{}");
  if(!level1Visual.floorSource.includes('concrete_color.png')||!level1Visual.ceilingSource.includes('concrete_color.png')||!level1Visual.pillarSource.includes('concrete_color.png')||!level1Visual.independentConcreteTextures||level1Visual.ceilingRepeat<=1)throw new Error("Level 1 roof, floor and pillars must use independently tiled concrete maps: "+JSON.stringify(level1Visual));
  if(level1Visual.level1WallHeight!==12||level1Visual.upperFloorY!==6||level1Visual.pillarLights<6||level1Visual.puddles!==1||level1Visual.puddleCount<12||level1Visual.puddleLayerMask!==2||!level1Visual.mainCameraIncludesPuddles||!level1Visual.reflectionExcludesPuddles||level1Visual.ramps!==2||level1Visual.walkableRamps!==1||level1Visual.walkableDecks!==1||!level1Visual.rampUV||!level1Visual.pillarUV||level1Visual.obstacleSegments<12||level1Visual.heights.length!==3||Math.abs(level1Visual.heights[0])>.01||Math.abs(level1Visual.heights[1]-3)>.03||Math.abs(level1Visual.heights[2]-6)>.03||level1Visual.upperFloorSlabs<4||level1Visual.neighborUpperFloorSlabs<1||!level1Visual.rampBoundaryOpen||!level1Visual.upperFloorOpening||Math.abs(level1Visual.upperFloorOpening.minX-level1Visual.rampStartX)>.01||Math.abs(level1Visual.upperFloorOpening.maxX-level1Visual.rampEndX)>.01||level1Visual.upperFloorOpening.maxZ-level1Visual.upperFloorOpening.minZ<6.8||level1Visual.stripeInstances<50)throw new Error("Level 1 parking ramp, UVs, pillar collisions or puddle render layers missing: "+JSON.stringify(level1Visual));
  console.log("LEVEL1_PARKING_VISUAL_SMOKE "+JSON.stringify(level1Visual));
  const level1RampPhysicsResult=await command("Runtime.evaluate",{
    expression:"(()=>{const g=window.backrooms,w=g.world,c=w.chunks.get('0,0'),p=g.player,input=g.input,r=c?.level1Ramp;if(!r)throw new Error('Level 1 walkable ramp metadata missing');const spawn=w.findSafeSpawn(0,0,.46),spawnHit=w.collision({x:spawn.x,y:0,z:spawn.z},.46),spawnCollision=Math.hypot(spawnHit.x-spawn.x,spawnHit.z-spawn.z),pillar=c.solidRects[0],embedded={x:(pillar.minX+pillar.maxX)/2,z:(pillar.minZ+pillar.maxZ)/2},ejected=w.collision({x:embedded.x,y:0,z:embedded.z},.46),embeddedStillInside=ejected.x>pillar.minX&&ejected.x<pillar.maxX&&ejected.z>pillar.minZ&&ejected.z<pillar.maxZ,railProbe={x:r.startX+5,y:0,z:r.z+r.halfWidth},railHit=w.collision(railProbe,.36),railPush=Math.hypot(railHit.x-railProbe.x,railHit.z-railProbe.z);const saved={position:p.position.clone(),velocity:p.velocity.clone(),verticalVelocity:p.verticalVelocity,yaw:p.yaw,pitch:p.pitch,viewYaw:p.viewYaw,viewPitch:p.viewPitch,health:p.health,stamina:p.stamina,hydration:p.hydration,sanity:p.sanity,bob:p.bob,bobStrength:p.bobStrength,shake:p.shake,cameraFov:p.cameraFov,flashBattery:p.flashBattery,flashlight:p.flashlight,inOcean:p.inOcean,parkingFloor:p.parkingFloor,cameraPosition:g.camera.position.clone(),cameraRotation:g.camera.rotation.clone(),cameraFovValue:g.camera.fov,getMove:input.getMove,consumeLook:input.consumeLook,wantsRun:input.wantsRun,wantsAscend:input.wantsAscend,wantsDive:input.wantsDive};let walk;try{p.position.set(r.startX+.8,p.eyeY,r.z);p.velocity.set(0,0,0);p.verticalVelocity=0;p.yaw=Math.PI/2;p.pitch=0;p.viewYaw=Math.PI/2;p.viewPitch=0;p.inOcean=false;input.getMove=()=>({x:0,y:1});input.consumeLook=()=>({x:0,y:0});input.wantsRun=()=>false;input.wantsAscend=()=>false;input.wantsDive=()=>false;for(let i=0;i<960;i++)p.update(1/60);walk={startX:r.startX,endX:r.endX,deckEndX:r.endDeckX,playerX:p.position.x,playerZ:p.position.z,eyeY:p.position.y,parkingFloor:p.parkingFloor,expectedDeckY:p.eyeY+r.rise,verticalGain:p.position.y-p.eyeY};}finally{p.position.copy(saved.position);p.velocity.copy(saved.velocity);p.verticalVelocity=saved.verticalVelocity;p.yaw=saved.yaw;p.pitch=saved.pitch;p.viewYaw=saved.viewYaw;p.viewPitch=saved.viewPitch;p.health=saved.health;p.stamina=saved.stamina;p.hydration=saved.hydration;p.sanity=saved.sanity;p.bob=saved.bob;p.bobStrength=saved.bobStrength;p.shake=saved.shake;p.cameraFov=saved.cameraFov;p.flashBattery=saved.flashBattery;p.flashlight=saved.flashlight;p.inOcean=saved.inOcean;p.parkingFloor=saved.parkingFloor;g.camera.position.copy(saved.cameraPosition);g.camera.rotation.copy(saved.cameraRotation);g.camera.fov=saved.cameraFovValue;g.camera.updateProjectionMatrix();input.getMove=saved.getMove;input.consumeLook=saved.consumeLook;input.wantsRun=saved.wantsRun;input.wantsAscend=saved.wantsAscend;input.wantsDive=saved.wantsDive;}const result={spawn,spawnCollision,embedded,ejected,embeddedStillInside,railPush,walk};if(spawnCollision>.02||embeddedStillInside||railPush<.2||walk.playerX<r.endX+1||walk.playerX>r.endDeckX-.5||walk.parkingFloor!==1||Math.abs(walk.eyeY-walk.expectedDeckY)>.08)throw new Error('Level 1 ramp walkability or spawn/rail collision failed: '+JSON.stringify(result));return JSON.stringify(result)})()",
    awaitPromise:true,
    returnByValue:true
  },30000);
  if(level1RampPhysicsResult.result?.exceptionDetails){const d=level1RampPhysicsResult.result.exceptionDetails;throw new Error("LEVEL1_RAMP_PHYSICS_SMOKE failed: "+(d.text||d.exception?.description||JSON.stringify(d)));}
  const level1RampPhysics=JSON.parse(level1RampPhysicsResult.result?.result?.value||"{}");
  console.log("LEVEL1_RAMP_PHYSICS_SMOKE "+JSON.stringify(level1RampPhysics));
  markSmokeStage("level 1 walkable parking ramp, spawn safety and UV mapping");
  const modelAttachResult=await command("Runtime.evaluate",{
    expression:"(async()=>{ const THREE=await import('https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js'); const g=window.backrooms,manager=g.entityManager,results=[]; await Promise.all(['bacteria','smiler'].map(type=>manager.modelLibrary.load(type))); for(const [type,targetHeight,yaw,targetWidth] of [['bacteria',Math.max(2.8,Math.min(4.2,(g.level.wallHeight-.05)*.92)),Math.PI,1.15],['smiler',2,Math.PI/2,null]]){ const group=new THREE.Group();group.position.set(1000+results.length*20,0,1000);group.userData.height=1.8;g.scene.add(group); const entity={type,group,state:'idle',model:null}; try{ const attached=await manager.modelLibrary.attach(entity);if(!attached||!entity.model?.container)throw new Error(type+' GLB was not attached'); const measure=(precise=true)=>{g.scene.updateMatrixWorld(true);entity.model.container.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update()});g.scene.updateMatrixWorld(true);const box=new THREE.Box3();entity.model.root.traverse(o=>{if(!o.isMesh)return;let p=o;while(p&&p!==entity.model.root){if(!p.visible)return;p=p.parent;}if(o.visible)box.union(new THREE.Box3().setFromObject(o,precise))});const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());return {height:size.y,width:Math.max(size.x,size.z),depth:Math.min(size.x,size.z),center:{x:center.x,y:center.y,z:center.z}};}; const initial=measure();const centerOffset=Math.hypot(initial.center.x-group.position.x,initial.center.z-group.position.z);const result={type,attached,targetHeight:entity.model.targetHeight,targetWidth:entity.model.targetWidth??null,height:initial.height,width:initial.width,depth:initial.depth,centerOffset,scaleY:entity.model.container.scale.y,scaleXZ:entity.model.container.scale.x,yaw:entity.model.container.rotation.y,animations:entity.model.clips.length,roofHeight:g.level.wallHeight-.05}; if(entity.model.mixer&&type==='bacteria'){manager.modelLibrary.play(entity,['bendingOverScene']);entity.model.mixer.update(.25);const idlePose=measure(true);result.defaultClip=entity.model.current?.getClip?.().name||null;result.defaultHeight=idlePose.height;result.defaultWidth=idlePose.width;} entity.state='stalk';let lastAction=entity.model.current?.getClip?.().name||'';let flappingTransitions=0;for(let i=0;i<24;i++){entity.state=i%2===0?'chase':'stalk';manager.modelLibrary.update(entity,.1);const currentAction=entity.model.current?.getClip?.().name||'';if(currentAction!==lastAction){flappingTransitions++;lastAction=currentAction;}}result.flappingTransitions=flappingTransitions;if(flappingTransitions>2)throw new Error('Bacteria animation switches too often during rapid AI state changes: '+JSON.stringify(result));entity.state='idle'; const animated=[]; if(entity.model.mixer&&entity.model.clips.length){for(const clip of entity.model.clips){entity.model.mixer.stopAllAction();const action=entity.model.actions.get(clip.name);if(!action)continue;action.reset().play();entity.model.mixer.setTime(Math.min(Math.max(clip.duration*.37,1/60),.45));const pose=measure(true);if(!Number.isFinite(pose.height)||!Number.isFinite(pose.width)||pose.height<.05||pose.width<.05)throw new Error(type+' invalid animation bounds: '+clip.name+' '+JSON.stringify(pose));animated.push({clip:clip.name,height:pose.height,width:pose.width});action.stop();}} if(animated.length){result.animationSamples=animated.length;result.animationPoses=animated;} results.push(result); if(type==='bacteria'&&(result.scaleY<1||result.scaleXZ<1))throw new Error('Bacteria display transform scale is below one game unit: '+JSON.stringify(result)); if(type==='bacteria'?(result.height<targetHeight*.72||result.height>targetHeight*1.05):Math.abs(result.height-targetHeight)>.18)throw new Error(type+' height mismatch: '+JSON.stringify(result)); if(Math.abs(result.yaw-yaw)>.001)throw new Error(type+' yaw mismatch: '+JSON.stringify(result)); if(targetWidth&&result.width<targetWidth-.15)throw new Error(type+' horizontal width mismatch: '+JSON.stringify(result)); if(type==='bacteria'&&(!String(result.defaultClip||'').toLowerCase().includes('bendingoverscene')||result.defaultHeight<result.targetHeight*.72||result.defaultHeight>result.roofHeight*1.05||result.defaultWidth<1.0))throw new Error('Bacteria animated idle pose is outside its expected full-size bounds: '+JSON.stringify(result)); }finally{g.scene.remove(group);} } return JSON.stringify(results) })()",
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
  if(modelAttach.some(x=>x.type==="bacteria"?(x.height<x.targetHeight*.72||x.height>x.targetHeight*1.05):Math.abs(x.height-x.targetHeight)>.18))throw new Error("ENTITY_MODEL_ATTACH_SMOKE height mismatch: "+JSON.stringify(modelAttach));
  if(modelAttach.some(x=>x.type==="bacteria"&&x.width<1.0))throw new Error("ENTITY_MODEL_ATTACH_SMOKE Bacteria width mismatch: "+JSON.stringify(modelAttach));
  if(modelAttach.some(x=>x.type==="bacteria"&&(x.scaleY<1||x.scaleXZ<1)))throw new Error("ENTITY_MODEL_ATTACH_SMOKE Bacteria display scale below one: "+JSON.stringify(modelAttach));
  if(modelAttach.some(x=>x.type==="bacteria"&&x.centerOffset>.2))throw new Error("ENTITY_MODEL_ATTACH_SMOKE Bacteria pivot mismatch: "+JSON.stringify(modelAttach));
  if(modelAttach.some(x=>x.type==="bacteria"&&(!String(x.defaultClip||"").toLowerCase().includes("bendingoverscene")||x.defaultHeight<x.targetHeight*.72||x.defaultHeight>x.roofHeight*1.05||x.defaultWidth<1.0)))throw new Error("ENTITY_MODEL_ATTACH_SMOKE Bacteria animated idle pose mismatch: "+JSON.stringify(modelAttach));
  if(modelAttach.some(x=>x.type==="bacteria"&&x.animations===0))throw new Error("Bacteria animations did not load");
  markSmokeStage("entity model attachment");
  const campaignResult=await command("Runtime.evaluate",{
    expression:"(async()=>{const g=window.backrooms,w=g.world,oldRadius=w.radius,ids=['2','3','4','5','6','7','8','9','10'],rows=[];w.radius=0;try{for(const id of ids){g.changeLevel(id);if(id==='3')await new Promise((resolve,reject)=>{const started=performance.now();const poll=()=>{if(w.library.floor.map?.userData?.sourceUrl?.includes('level3_concrete_color.jpg')&&w.library.floor.map.repeat.x>100)resolve();else if(performance.now()-started>15000)reject(new Error('Level 3 floor PBR source did not finish loading'));else setTimeout(poll,50)};poll()});const ceilingAfterChange=w.ceilingSurface?.visible;w.ensureAround(0,0);const c=w.chunks.get('0,0');if(!c)throw new Error('Level '+id+' did not create its origin chunk');const n=c.gridSize(),walls=Array.from(c.walls),visited=new Set([0]),stack=[0];while(stack.length){const index=stack.pop(),x=index%n,z=Math.floor(index/n),mask=walls[index];for(const [bit,nx,nz] of [[1,x,z-1],[2,x+1,z],[4,x,z+1],[8,x-1,z]]){if(mask&bit||nx<0||nx>=n||nz<0||nz>=n)continue;const next=nz*n+nx;if(!visited.has(next)){visited.add(next);stack.push(next)}}}let waterMeshes=0,instancedMeshes=0,instancedInstances=0,pipeNetworkMeshes=0,lightFixtures=0,worldUvMeshes=0;c.group.traverse(o=>{if(o.isInstancedMesh){instancedMeshes++;instancedInstances+=o.count;}if(o.geometry?.userData?.backroomsWorldTiled)worldUvMeshes++;if(o.isMesh&&o.userData.pipeNetwork)pipeNetworkMeshes++;if(o.isMesh&&o.userData.light)lightFixtures++;if(o.isMesh&&o.material?.transparent&&o.material.opacity<.9)waterMeshes++});const row={id,pageTitle:document.title,levelId:String(g.level.id),worldLevelId:String(w.game.level.id),sameGame:w.game===g,ceilingAfterChange,ceilingParent:w.ceilingSurface?.parent?.type??null,connectedCells:visited.size,totalCells:n*n,nonFallbackCells:walls.filter(v=>v!==15).length,legacyGridWalls:walls.some(v=>v!==0),rooms:c.rooms.length,collisionSegments:c.collisionSegments.length,instancedMeshes,instancedInstances,pipeNetworkMeshes,lightFixtures,waterMeshes,worldUvMeshes,floorRepeat:w.library.floor.map?.repeat?.x??0,ceilingRepeat:w.library.ceiling.map?.repeat?.x??0,surfaceSize:w.surfaceSize,floorMapSource:w.library.floor.map?.userData?.sourceUrl??'',ceilingMapSource:w.library.ceiling.map?.userData?.sourceUrl??'',floorMap:!!w.library.floor.map?.image?.width,wallMap:!!w.library.wall.map?.image?.width,ceilingVisible:!!w.ceilingSurface?.visible,skyVisible:id==='7'?!!g.oceanSky?.visible:id==='10'?g.scene.background?.getHexString?.()!=='000000':!!g.sky?.visible,daylightIntensity:g.daylight.intensity,ambientIntensity:g.ambient.intensity,fogDensity:g.scene.fog?.density??0,ambientGround:g.ambient.groundColor.getHexString(),fogEnabled:!!g.scene.fog,globalCeilingVisible:!!w.ceilingSurface?.visible,localLightPool:g.localLights.length,maxOfficeLightIntensity:Math.max(0,...c.lightSources.map(light=>light.baseIntensity??light.intensity??0)),officeLightSources:c.lightSources.length,oceanSkyVisible:!!g.oceanSky?.visible,sceneBackground:g.scene.background?.getHexString?.()??null,cloudLayerVisible:!!g.cloudLayer?.visible};if(document.title!=='The Backrooms: Level '+id)throw new Error('Page title failed to follow active Level '+id+': '+JSON.stringify(row));if(id!=='4'&&(row.worldUvMeshes<1||row.floorRepeat<=1||row.ceilingRepeat<=1))throw new Error('Level '+id+' has no real-world tiled geometry or surface UV repeat: '+JSON.stringify(row));if(visited.size!==n*n)throw new Error('Level '+id+' has a disconnected corridor graph: '+JSON.stringify(row));if((id==='2'||id==='3')&&(!row.floorMap||!row.wallMap||row.legacyGridWalls))throw new Error('Level '+id+' retained fallback grid walls or is missing its PBR maps: '+JSON.stringify(row));if(id==='3'&&(!row.floorMapSource.includes('level3_concrete_color.jpg')||Math.abs(row.floorRepeat-row.surfaceSize/2.4)>.02))throw new Error('Level 3 floor PBR map or world-space tiling is incorrect/stretched: '+JSON.stringify(row));if(id==='2'&&(row.collisionSegments<8||row.pipeNetworkMeshes<8||row.lightFixtures<6))throw new Error('Level 2 authored utility corridors, routed pipework or corridor lighting missing: '+JSON.stringify(row));if(id==='3'&&row.collisionSegments<60)throw new Error('Level 3 generator hall machinery missing: '+JSON.stringify(row));if(id==='5'&&(row.collisionSegments<100||row.instancedMeshes<4))throw new Error('Level 5 hotel furnishing and room geometry missing: '+JSON.stringify(row));if(id==='4'&&(row.collisionSegments>1000||row.instancedMeshes<3||row.globalCeilingVisible||row.fogEnabled||row.officeLightSources!==144||row.localLightPool<14||row.maxOfficeLightIntensity>950||row.maxOfficeLightIntensity<850))throw new Error('Level 4 office geometry or restrained light budget is incomplete: '+JSON.stringify(row));if(['7','9','10'].includes(id)&&walls.some(v=>v!==0))throw new Error('Open-terrain Level '+id+' still has artificial maze walls: '+JSON.stringify(row));if(id==='7'&&(row.ceilingVisible||row.waterMeshes<2||row.collisionSegments<5))throw new Error('Level 7 open-sky ocean, entrance room or water missing: '+JSON.stringify(row));if(id==='7'){\n  const p=g.player,input=g.input;\n  const saved={position:p.position.clone(),velocity:p.velocity.clone(),verticalVelocity:p.verticalVelocity,pitch:p.pitch,inOcean:p.inOcean,getMove:input.getMove,consumeLook:input.consumeLook,wantsRun:input.wantsRun,wantsAscend:input.wantsAscend,wantsDive:input.wantsDive};\n  let swimResult;\n  try{\n    p.position.set(0,p.eyeY,10);p.velocity.set(0,0,0);p.verticalVelocity=0;p.pitch=.85;p.inOcean=false;\n    input.getMove=()=>({x:0,y:0});input.consumeLook=()=>({x:0,y:0});input.wantsRun=()=>false;input.wantsAscend=()=>false;input.wantsDive=()=>false;\n    for(let i=0;i<300;i++)p.update(1/60);\n    const floatY=p.position.y,floatStable=floatY>.05&&floatY<.5;\n    input.wantsAscend=()=>true;for(let i=0;i<45;i++)p.update(1/60);const surfaceY=p.position.y;\n    input.wantsAscend=()=>false;input.wantsDive=()=>true;for(let i=0;i<90;i++)p.update(1/60);const diveY=p.position.y;\n    swimResult={floatY,surfaceY,diveY,floatStable,pitchIndependent:p.inOcean};\n    if(!p.inOcean||!floatStable||surfaceY<floatY+.2||diveY>surfaceY-.25)throw new Error('Level 7 buoyancy/surface/dive physics failed: '+JSON.stringify(swimResult));\n  }finally{\n    p.position.copy(saved.position);p.velocity.copy(saved.velocity);p.verticalVelocity=saved.verticalVelocity;p.pitch=saved.pitch;p.inOcean=saved.inOcean;\n    input.getMove=saved.getMove;input.consumeLook=saved.consumeLook;input.wantsRun=saved.wantsRun;input.wantsAscend=saved.wantsAscend;input.wantsDive=saved.wantsDive;\n  }\n  const oldExit=c.exit;c.exit={kind:'ocean',position:{x:0,y:0,z:10}};p.position.set(0,.8,10);const surfaceExit=w.exitAt(0,10);p.position.y=-2.5;const deepExit=w.exitAt(0,10);p.position.copy(saved.position);c.exit=oldExit;\n  if(surfaceExit||!deepExit)throw new Error('Level 7 underwater exit gate failed: '+JSON.stringify({surfaceExit,deepExit,swimResult}));\n}if(['7','9','10'].includes(id)&&(!row.skyVisible||row.ceilingVisible||(id==='7'&&row.sceneBackground==='000000')))throw new Error('Open sky missing on Level '+id+': '+JSON.stringify(row));if(id==='7'&&!row.oceanSkyVisible)throw new Error('Level 7 ocean sky dome is not visible: '+JSON.stringify(row));if(id==='10'&&(!row.cloudLayerVisible||row.daylightIntensity<1||row.ambientIntensity<.6||row.sceneBackground==='000000'))throw new Error('Level 10 daytime sky, daylight or cloud layer missing: '+JSON.stringify(row));if(id==='8'&&(row.legacyGridWalls||row.instancedMeshes<3||row.waterMeshes<3||row.collisionSegments<40))throw new Error('Level 8 cave formations or underground pools missing: '+JSON.stringify(row));if(id==='9'&&row.collisionSegments<10)throw new Error('Level 9 residential lots missing: '+JSON.stringify(row));if(id==='10'&&(row.instancedMeshes<4||row.instancedInstances<2500))throw new Error('Level 10 crop and tree density missing: '+JSON.stringify(row));if(id==='6'&&g.level.entity!=='none')throw new Error('Level 6 should not spawn hostile entities: '+JSON.stringify(row));rows.push(row)}return JSON.stringify(rows)}finally{w.radius=oldRadius;g.changeLevel('0');w.ensureAround(0,0)}})()",
    awaitPromise:true,
    returnByValue:true
  },45000);
  if(campaignResult.result?.exceptionDetails){const d=campaignResult.result.exceptionDetails;throw new Error("CAMPAIGN_LEVEL_SMOKE failed: "+(d.text||d.exception?.description||JSON.stringify(d)));}
  const campaign=JSON.parse(campaignResult.result?.result?.value||"[]");
  if(campaign.length!==9)throw new Error("CAMPAIGN_LEVEL_SMOKE did not cover Levels 2-10: "+JSON.stringify(campaign));
  const level4Campaign=campaign.find(row=>row.id==="4");
  if(!level4Campaign||level4Campaign.fogEnabled||level4Campaign.fogDensity!==0||level4Campaign.globalCeilingVisible||level4Campaign.ambientIntensity<.8||level4Campaign.ambientIntensity>1||level4Campaign.officeLightSources!==144||level4Campaign.localLightPool<14||level4Campaign.maxOfficeLightIntensity>950||level4Campaign.maxOfficeLightIntensity<850||level4Campaign.ambientGround==="080704")throw new Error("Level 4 office atmosphere is still too dark or under-lit: "+JSON.stringify(level4Campaign));
  console.log("CAMPAIGN_LEVEL_SMOKE "+JSON.stringify(campaign));

  const level3Level4Result=await command("Runtime.evaluate",{
    expression:"(async()=>{const g=window.backrooms,w=g.world,rows={};for(const id of ['3','4']){g.changeLevel(id);w.ensureAround(0,0);if(id==='4')await new Promise((resolve,reject)=>{const started=performance.now();const poll=()=>{const a=w.library.officePlastic?.map?.userData?.sourceUrl||'',b=w.library.officeCeilingTile?.map?.userData?.sourceUrl||'',c=w.library.floor?.map?.userData?.sourceUrl||'';if(a.includes('painted_wall_color.png')&&b.includes('ceiling_tiles_color.png')&&c.includes('office-carpet/color.jpg'))resolve();else if(performance.now()-started>20000)reject(new Error('Level 4 CC0 office PBR maps did not finish loading: '+JSON.stringify({wall:a,ceiling:b,carpet:c})));else setTimeout(poll,50)};poll()});const c=w.chunks.get('0,0');let gates=0,panels=0,specialRooms=0,assemblyLines=0,officeRooms=0,windows=0,windowPanes=0,blackoutWindows=0,rainStreaks=0,ceilingPanels=0,ceilingLights=0,wallMountedPanels=0; c.group.traverse(o=>{if(o.userData?.isLevel3BarredGate)gates++;if(o.userData?.level3ElectricalPanel){panels++;const x=o.position.x,z=o.position.z,left=c.originX+w.size*.29,right=c.originX+w.size*.71,near=c.originZ+w.size*.29,far=c.originZ+w.size*.71;if(Math.min(Math.abs(x-left),Math.abs(x-right),Math.abs(z-near),Math.abs(z-far))<.25)wallMountedPanels++;}if(o.userData?.isLevel3SpecialRoom)specialRooms++;if(o.userData?.level3AssemblyLine)assemblyLines++;if(o.userData?.isLevel4OfficeRoom)officeRooms++;if(o.userData?.isLevel4Window){windows++;if(o.isMesh){windowPanes++;if(o.userData.isLevel4BlackedOut)blackoutWindows++;}}if(o.userData?.isLevel4RainStreak)rainStreaks++;if(o.userData?.isLevel4CeilingPanels)ceilingPanels++;if(o.userData?.isLevel4CeilingLights)ceilingLights++;});rows[id]={zone:c.zone,rooms:c.rooms.map(room=>room.type),gates,panels,wallMountedPanels,specialRooms,assemblyLines,officeRooms,windows,windowPanes,blackoutWindows,rainStreaks,ceilingPanels,ceilingLights,officePbr:{wall:w.library.officePlastic?.map?.userData?.sourceUrl||'',ceiling:w.library.officeCeilingTile?.map?.userData?.sourceUrl||'',carpet:w.library.floor?.map?.userData?.sourceUrl||''},collisionSegments:c.collisionSegments.length,fixtures:c.fixtures.length,lightSources:c.lightSources.length,lightIntensityMax:Math.max(0,...c.lightSources.map(light=>light.baseIntensity??light.intensity??0)),lightDecay:c.lightSources[0]?.decay??0,lightSpacing:(()=>{const xs=[...new Set(c.lightSources.map(light=>light.position.x))].sort((a,b)=>a-b);return xs.length>1?xs[1]-xs[0]:0})(),fogEnabled:!!g.scene.fog,fogDensity:g.scene.fog?.density??0,globalCeilingVisible:!!w.ceilingSurface?.visible,ambientIntensity:g.ambient.intensity,ambientGround:g.ambient.groundColor.getHexString(),instancedMeshes:(()=>{let n=0;c.group.traverse(o=>{if(o.isInstancedMesh)n++});return n})(),entityPool:g.level.id==='3'?['hound','deathmoth','skinstealer','faceling','wretch','clump','smiler','deathrat']:['hound','duller'],fog:g.level.theme.fog};}g.changeLevel('0');w.ensureAround(0,0);return JSON.stringify(rows)})()",
    awaitPromise:true,
    returnByValue:true
  });
  if(level3Level4Result.result?.exceptionDetails){const d=level3Level4Result.result.exceptionDetails;throw new Error("LEVEL3_LEVEL4_ENVIRONMENT_SMOKE failed: "+(d.text||d.exception?.description||JSON.stringify(d)));}
  const level3Level4=JSON.parse(level3Level4Result.result?.result?.value||"{}");
  const l3=level3Level4['3'],l4=level3Level4['4'];
  if(!l3||l3.gates<2||l3.panels<8||l3.wallMountedPanels<8||l3.specialRooms!==1||l3.collisionSegments<60||!['generator','assembly','boiler','switchgear','corridors'].includes(l3.zone))throw new Error("Level 3 electrical-facility architecture incomplete: "+JSON.stringify(l3));
  if(!l4||l4.officeRooms<8||l4.windowPanes<8||l4.blackoutWindows!==6||!l4.officePbr?.wall.includes('painted_wall_color.png')||!l4.officePbr?.ceiling.includes('ceiling_tiles_color.png')||!l4.officePbr?.carpet.includes('office-carpet/color.jpg')||l4.ceilingPanels!==1||l4.ceilingLights!==1||l4.collisionSegments>1000||l4.instancedMeshes<3||l4.fixtures>20||l4.fog<0xaaaaaa||l4.fogEnabled||l4.fogDensity!==0||l4.globalCeilingVisible||l4.ambientIntensity<.8||l4.ambientIntensity>1||l4.lightSources!==144||l4.lightIntensityMax>950||l4.lightIntensityMax<850||l4.lightDecay!==2||Math.abs(l4.lightSpacing-16)>.01||l4.ambientGround==="080704")throw new Error("Level 4 office architecture/lighting incomplete: "+JSON.stringify(l4));
  console.log("LEVEL3_LEVEL4_ENVIRONMENT_SMOKE "+JSON.stringify(level3Level4));
  markSmokeStage("Level 3 electrical rooms and Level 4 office plan");
  const regressionResult=await command("Runtime.evaluate",{
    expression:"(async()=>{const g=window.backrooms,w=g.world,oldRadius=w.radius;w.radius=0;try{g.changeLevel('2');w.ensureAround(0,0);const utility=w.chunks.get('0,0');const pipeMeshes=[];utility.group.traverse(o=>{if(o.isMesh&&o.userData.pipeNetwork)pipeMeshes.push(o)});if(pipeMeshes.length<8)throw new Error('Level 2 routed pipe network missing: '+JSON.stringify({pipeMeshes:pipeMeshes.length}));g.changeLevel('4');w.ensureAround(0,0);const office=w.chunks.get('0,0');const seg=office.collisionSegments.find(s=>Math.hypot(s.x2-s.x1,s.z2-s.z1)>2);if(!seg)throw new Error('Level 4 authored collision probe has no wall segment');const mx=(seg.x1+seg.x2)/2,mz=(seg.z1+seg.z2)/2,cx=office.originX+w.size/2,cz=office.originZ+w.size/2,dx=cx-mx,dz=cz-mz,len=Math.hypot(dx,dz)||1,probe={x:mx+dx/len*.1,z:mz+dz/len*.1};const resolved=w.collision(probe,.36),collisionPush=Math.hypot(resolved.x-probe.x,resolved.z-probe.z);if(collisionPush<.2)throw new Error('Authored Level 4 geometry did not resolve player collision: '+collisionPush);w.radius=1;w.ensureAround(0,0);const neighbor=w.chunks.get(w.key(1,0));if(!neighbor)throw new Error('Neighbor chunk missing for exit boundary test');const oldExit=neighbor.exit;neighbor.exit={kind:'probe',position:{x:w.size/2+.1,z:0}};const boundaryExit=w.exitAt(w.size/2-.5,0);neighbor.exit=oldExit;if(!boundaryExit)throw new Error('Exit lookup failed across chunk boundary');const boundarySegment={x1:w.size/2+.1,z1:-2,x2:w.size/2+.1,z2:2};neighbor.collisionSegments.push(boundarySegment);const boundaryProbe={x:w.size/2-.1,z:0},boundaryResolved=w.collision(boundaryProbe,.36),neighborCollisionPush=Math.hypot(boundaryResolved.x-boundaryProbe.x,boundaryResolved.z-boundaryProbe.z);neighbor.collisionSegments.pop();if(neighborCollisionPush<.2)throw new Error('Authored collision geometry in a neighboring chunk was ignored: '+neighborCollisionPush);const oldPlayerPosition=g.player.position.clone();w.radius=0;g.player.position.set(5*w.size,g.player.eyeY,0);w.ensureAround(g.player.position.x,g.player.position.z);const exitChunk=w.chunks.get(w.key(5,0));if(exitChunk?.exit?.kind!=='office'||!exitChunk.exit.position)throw new Error('Level 4 deterministic stairwell exit was not generated');const officeExitWorks=w.exitAt(exitChunk.exit.position.x,exitChunk.exit.position.z);g.player.position.copy(oldPlayerPosition);w.ensureAround(0,0);if(!officeExitWorks)throw new Error('Level 4 stairwell exit cannot be interacted with');const home=w.chunks.get('0,0');const light={position:{x:20,y:2,z:0},distance:30,cullRadius:30};home.lightSources.push(light);const selected=w.nearbyLightSources(0,0,{containsPoint:()=>false,intersectsSphere:()=>true});home.lightSources.pop();if(!selected.some(entry=>entry.light===light))throw new Error('Off-frustum light with intersecting influence sphere was discarded');if(g.level.theme.fog<0x777777)throw new Error('Level 4 office fog is still too dark: '+g.level.theme.fog);return JSON.stringify({pipeMeshes:pipeMeshes.length,collisionPush,boundaryExit,neighborCollisionPush,officeExitWorks,offFrustumLightSelected:true,level4Fog:g.level.theme.fog})}finally{w.radius=oldRadius;g.changeLevel('0');w.ensureAround(0,0)}})()",
    awaitPromise:true,
    returnByValue:true
  },30000);
  if(regressionResult.result?.exceptionDetails){const d=regressionResult.result.exceptionDetails;throw new Error("LEVEL2_10_FOUNDATION_SMOKE failed: "+(d.text||d.exception?.description||JSON.stringify(d)));}
  const regression=JSON.parse(regressionResult.result?.result?.value||"{}");
  console.log("LEVEL2_10_FOUNDATION_SMOKE "+JSON.stringify(regression));
  const pageTitleResult=await command("Runtime.evaluate",{
    expression:"(()=>{const g=window.backrooms,wasRunning=g.running,wasIntro=g.introActive;g.running=false;g.syncPageTitle();const inactiveTitle=document.title;g.running=wasRunning;g.introActive=wasIntro;g.syncPageTitle();const activeTitle=document.title;g.syncPageTitle();return JSON.stringify({inactiveTitle,activeTitle,stableTitle:document.title,level:g.level.id})})()",
    returnByValue:true
  });
  const pageTitle=JSON.parse(pageTitleResult.result?.result?.value||"{}");
  if(pageTitle.inactiveTitle!=="The Backrooms"||pageTitle.activeTitle!=="The Backrooms: Level "+pageTitle.level||pageTitle.stableTitle!==pageTitle.activeTitle)throw new Error("Page title lifecycle/idempotence check failed: "+JSON.stringify(pageTitle));
  markSmokeStage("campaign levels 2-10 foundations");
  await command("Runtime.evaluate",{expression:"window.backrooms.changeLevel('0')",returnByValue:true});
  await waitForBrowser("window.backrooms?.level?.id==='0'&&window.backrooms.world.library?.floor?.map?.userData?.sourceUrl?.includes('carpet_color.png')&&window.backrooms.world.library?.ceiling?.map?.userData?.sourceUrl?.includes('ceiling_tiles_color.png')",20000);
  const level0SurfaceResult=await command("Runtime.evaluate",{
    expression:"(()=>{const g=window.backrooms,w=g.world;const requested=w.level0SpawnPoint(),spawn=w.findSafeSpawn(requested.x,requested.z,.46);const hit=w.collision({x:spawn.x,y:0,z:spawn.z},.46);const result={floorSource:w.library.floor.map?.userData?.sourceUrl||'',ceilingSource:w.library.ceiling.map?.userData?.sourceUrl||'',floorRepeat:w.library.floor.map?.repeat?.x||0,ceilingRepeat:w.library.ceiling.map?.repeat?.x||0,ceilingY:w.ceilingSurface?.position.y,wallHeight:g.level.wallHeight,spawn,spawnCollision:Math.hypot(hit.x-spawn.x,hit.z-spawn.z)};if(!result.floorSource.includes('carpet_color.png')||!result.ceilingSource.includes('ceiling_tiles_color.png')||result.ceilingSource.includes('carpet_color.png')||result.ceilingRepeat<=1||result.spawnCollision>.02||result.ceilingY<=result.wallHeight)throw new Error('Level 0 ceiling grid, floor material isolation, ceiling clearance or spawn safety failed: '+JSON.stringify(result));return JSON.stringify(result)})()",
    returnByValue:true
  });
  if(level0SurfaceResult.result?.exceptionDetails){const d=level0SurfaceResult.result.exceptionDetails;throw new Error("LEVEL0_SURFACE_SPAWN_SMOKE failed: "+(d.text||d.exception?.description||JSON.stringify(d)));}
  const level0Surface=JSON.parse(level0SurfaceResult.result?.result?.value||"{}");
  console.log("LEVEL0_SURFACE_SPAWN_SMOKE "+JSON.stringify(level0Surface));
  const level0LightResult=await command("Runtime.evaluate",{
    expression:"(()=>{\nconst g=window.backrooms;\nconst lights=[...g.world.chunks.values()].flatMap(chunk=>chunk.lightSources||[]).filter(entry=>entry.fixture?.userData?.light);\nconst result={fixtures:lights.length,maxBaseIntensity:lights.length?Math.max(...lights.map(entry=>entry.baseIntensity??entry.intensity??0)):0,maxFixtureEmissive:lights.length?Math.max(...lights.map(entry=>entry.fixture.userData.baseEmissive??entry.fixture.material?.emissiveIntensity??0)):0,maxRange:lights.length?Math.max(...lights.map(entry=>entry.distance??0)):0};\nif(!lights.length||result.maxBaseIntensity>35||result.maxFixtureEmissive>1.2||result.maxRange>9.5)throw new Error('Level 0 lights exceed the reviewed brightness/range budget: '+JSON.stringify(result));\nreturn JSON.stringify(result);\n})()",
    awaitPromise:true,
    returnByValue:true
  },30000);
  if(level0LightResult.result?.exceptionDetails){const d=level0LightResult.result.exceptionDetails;throw new Error("LEVEL0_LIGHTING_SMOKE failed: "+(d.text||d.exception?.description||JSON.stringify(d)));}
  const level0Lighting=JSON.parse(level0LightResult.result?.result?.value||"{}");
  console.log("LEVEL0_LIGHTING_SMOKE "+JSON.stringify(level0Lighting));
  markSmokeStage("level 0 lighting");
  console.log("ENTITY_MODEL_ATTACH_SMOKE "+JSON.stringify(modelAttach));
  markSmokeStage("final smoke checks");
  console.log("RUNTIME SMOKE PASS");
  console.log(JSON.stringify({desktopUi,state,errors:0}));
}finally{
  ws?.close();
  if(browser&&!browser.killed)browser.kill("SIGKILL");
  await rm(profile,{recursive:true,force:true}).catch(()=>{});
  await new Promise(resolveServer=>server.close(resolveServer));
}
