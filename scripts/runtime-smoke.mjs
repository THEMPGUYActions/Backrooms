import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createServer as createNetServer } from "node:net";

const root=resolve("dist");
const chrome=process.env.CHROME_BIN||process.env.CHROMIUM_BIN||"/usr/bin/chromium";
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

  const command=(method,params={})=>new Promise((resolveCommand,rejectCommand)=>{
    const id=++commandId;
    pending.set(id,message=>resolveCommand(message));
    ws.send(JSON.stringify({id,method,params}));
    setTimeout(()=>{
      if(pending.has(id)){
        pending.delete(id);
        rejectCommand(new Error("CDP timeout: "+method));
      }
    },10000);
  });

  await command("Runtime.enable");
  await command("Page.enable");
  await command("Runtime.evaluate",{expression:"location.href='http://127.0.0.1:"+port+"/index.html'",returnByValue:true});
  await delay(2500);

  const readyResult=await command("Runtime.evaluate",{
    expression:"JSON.stringify({backrooms:!!window.backrooms,mounted:!!window.backrooms?.mounted,canvas:!!document.querySelector('canvas')})",
    returnByValue:true
  });
  const ready=JSON.parse(readyResult.result?.result?.value||"{}");
  if(!ready.backrooms||!ready.mounted||!ready.canvas)throw new Error("Game bootstrap did not finish: "+JSON.stringify(ready));

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
    expression:"JSON.stringify({running:window.backrooms.running,paused:window.backrooms.paused,introActive:window.backrooms.introActive,runtimeFaulted:window.backrooms.runtimeFaulted,mobileDisplay:getComputedStyle(document.getElementById('mobile-controls')).display,hud:getComputedStyle(document.getElementById('hud')).display})",
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

  console.log("RUNTIME SMOKE PASS");
  console.log(JSON.stringify({desktopUi,state,errors:0}));
}finally{
  ws?.close();
  if(browser&&!browser.killed)browser.kill("SIGKILL");
  await rm(profile,{recursive:true,force:true}).catch(()=>{});
  await new Promise(resolveServer=>server.close(resolveServer));
}
