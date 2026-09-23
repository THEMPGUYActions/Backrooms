import { BackroomsGame } from "./game.js?v=20260923-1830";
/* DEV_ADMIN_START */
import { BackroomsAdmin } from "./admin.js?v=20260923-1830";
/* DEV_ADMIN_END */

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
/* DEV_ADMIN_START */
if(game.admin.enabled){
  window.backroomsAdmin=new BackroomsAdmin(game);
  window.backroomsAdmin.activate();
}
/* DEV_ADMIN_END */
game.mount();

window.backrooms=game;