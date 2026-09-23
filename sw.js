const CACHE_NAME="backrooms-assets-v6";
const CORE=[
  "index.html",
  "styles.css",
  "src/main.js",
  "src/game.js",
  "src/assets.js",
  "src/audio.js",
  "src/levels.js",
  "src/admin.js",
  "favicon.svg"
];

function scopeUrl(path){
  return new URL(path,self.registration.scope).href;
}

async function cacheCore(){
  const cache=await caches.open(CACHE_NAME);
  await Promise.all(CORE.map(path=>
    cache.add(scopeUrl(path)).catch(error=>{
      console.warn("[Backrooms] Core cache skipped:",path,error);
    })
  ));
}

self.addEventListener("install",event=>{
  event.waitUntil(cacheCore().then(()=>self.skipWaiting()));
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  const sameOrigin=url.origin===self.location.origin;
  const isAsset=sameOrigin&&(
    url.pathname.includes("/assets/pbr/")||
    url.pathname.includes("/assets/audio/")
  );
  if(!sameOrigin&&!url.hostname.includes("cdn.jsdelivr.net"))return;

  if(isAsset){
    event.respondWith(
      caches.match(request).then(cached=>{
        const network=fetch(request).then(response=>{
          if(response.ok){
            const copy=response.clone();
            caches.open(CACHE_NAME).then(cache=>cache.put(request,copy)).catch(()=>{});
          }
          return response;
        }).catch(()=>cached);
        return cached||network;
      })
    );
    return;
  }

  if(sameOrigin){
    event.respondWith(
      fetch(request).then(response=>{
        if(response.ok){
          const copy=response.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put(request,copy)).catch(()=>{});
        }
        return response;
      }).catch(()=>caches.match(request))
    );
  }
});

self.addEventListener("message",event=>{
  if(event.data?.type!=="WARM_ASSETS")return;
  const base=new URL("./",self.registration.scope);
  const pbr=[
    "wallpaper_color.png","wallpaper_rough.png","wallpaper_normal.png",
    "painted_wall_color.png","painted_wall_rough.png","painted_wall_normal.png",
    "carpet_color.png","carpet_rough.png","carpet_normal.png",
    "ceiling_tiles_color.png","ceiling_tiles_rough.png","ceiling_tiles_normal.png"
  ];
  const audio=[
    "ambient_horror.ogg","electric_buzz.ogg",
    "footstep_01.ogg","footstep_02.ogg","footstep_03.ogg",
    "footstep_04.ogg","footstep_05.ogg","footstep_06.ogg"
  ];
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache=>
      Promise.all([
        ...pbr.map(file=>cache.add(new URL("./assets/pbr/"+file,base)).catch(()=>null)),
        ...audio.map(file=>cache.add(new URL("./assets/audio/"+file,base)).catch(()=>null))
      ])
    )
  );
});