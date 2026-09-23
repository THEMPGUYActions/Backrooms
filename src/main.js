import { BackroomsGame } from "./game.js?v=20260923-1245";

const registerCache=async()=>{
  if(!("serviceWorker" in navigator))return;
  try{
    const workerUrl=new URL("../sw.js",import.meta.url);
    const scopeUrl=new URL("../",import.meta.url);
    const registrations=await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations
      .filter(reg=>reg.scope===scopeUrl.href&&reg.active?.scriptURL!==workerUrl.href)
      .map(reg=>reg.unregister()));
    const registration=await navigator.serviceWorker.register(workerUrl,{scope:scopeUrl});
    await navigator.serviceWorker.ready;
    (registration.active||registration.waiting)?.postMessage({type:"WARM_ASSETS"});
  }catch(error){
    console.warn("[Backrooms] Asset cache unavailable:",error);
  }
};

registerCache();
const game=new BackroomsGame();
game.mount().then(async()=>{
  /* DEV_ADMIN_START */
  if(new URLSearchParams(location.search).get("admin")!=="1")return;
  try{
    const {BackroomsAdmin}=await import("./admin.js?v=20260923-1205");
    window.backroomsAdmin=new BackroomsAdmin(game);
    window.backroomsAdmin.activate();
  }catch(error){
    console.warn("[Backrooms] Admin module unavailable:",error);
  }
  /* DEV_ADMIN_END */
});

window.backrooms=game;