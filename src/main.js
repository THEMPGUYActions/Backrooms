import { BackroomsGame } from "./game.js";
import { BackroomsAdmin } from "./admin.js";

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
const game = new BackroomsGame();
game.mount();

window.backrooms = game;
window.backroomsAdmin = new BackroomsAdmin(game);
