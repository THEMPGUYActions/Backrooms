import { BackroomsGame } from "./game.js";

const registerCache=async()=>{
  if(!("serviceWorker" in navigator))return;
  try{
    const registration=await navigator.serviceWorker.register("./sw.js",{scope:"./"});
    await navigator.serviceWorker.ready;
    registration.active?.postMessage({type:"WARM_ASSETS"});
  }catch(error){
    console.warn("[Backrooms] Asset cache unavailable:",error);
  }
};

registerCache();
const game = new BackroomsGame();
game.mount();

window.backrooms = game;
