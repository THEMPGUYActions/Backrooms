import * as THREE from "three";

export function createLevel1PuddleMaterial(){
  return new THREE.ShaderMaterial({
    uniforms:{
      tReflection:{value:null},
      textureMatrix:{value:new THREE.Matrix4()},
      time:{value:0}
    },
    vertexShader:`
      uniform mat4 textureMatrix;
      varying vec3 vWorldPosition;
      varying vec3 vViewDirection;
      varying vec3 vNormal;
      varying vec4 vReflectCoord;
      void main(){
        vec4 worldPosition=modelMatrix*vec4(position,1.0);
        vec4 viewPosition=modelViewMatrix*vec4(position,1.0);
        vWorldPosition=worldPosition.xyz;
        vViewDirection=normalize(-viewPosition.xyz);
        vNormal=normalize(normalMatrix*vec3(0.0,0.0,1.0));
        vReflectCoord=textureMatrix*worldPosition;
        gl_Position=projectionMatrix*viewPosition;
      }
    `,
    fragmentShader:`
      uniform sampler2D tReflection;
      uniform float time;
      varying vec3 vWorldPosition;
      varying vec3 vViewDirection;
      varying vec3 vNormal;
      varying vec4 vReflectCoord;
      void main(){
        vec2 uv=vReflectCoord.xy/max(vReflectCoord.w,0.0001);
        vec2 ripple=vec2(
          sin(vWorldPosition.x*2.1+time*0.72)+cos(vWorldPosition.z*1.7-time*0.54),
          cos(vWorldPosition.z*2.3+time*0.61)-sin(vWorldPosition.x*1.5-time*0.48)
        )*0.0018;
        vec3 reflected=texture2D(tReflection,clamp(uv+ripple,vec2(0.002),vec2(0.998))).rgb;
        float facing=max(dot(normalize(vNormal),normalize(vViewDirection)),0.0);
        float fresnel=pow(1.0-facing,2.2);
        float rippleLight=pow(max(0.0,sin(vWorldPosition.x*3.8+vWorldPosition.z*2.6+time*1.4)),18.0)*0.055;
        vec3 base=vec3(0.012,0.018,0.019);
        vec3 color=mix(base,reflected,0.78+fresnel*0.18);
        color+=vec3(0.28,0.34,0.35)*rippleLight;
        gl_FragColor=vec4(color,0.96);
      }
    `,
    transparent:true,
    depthWrite:false,
    depthTest:true,
    side:THREE.DoubleSide,
    toneMapped:true
  });
}

export class Level1Reflection{
  constructor(renderer,scene,camera,mobile=false){
    this.renderer=renderer;
    this.scene=scene;
    this.sourceCamera=camera;
    this.size=mobile?256:512;
    camera.layers.enable(1);
    this.target=new THREE.WebGLRenderTarget(this.size,this.size,{
      minFilter:THREE.LinearFilter,
      magFilter:THREE.LinearFilter,
      format:THREE.RGBAFormat,
      depthBuffer:true,
      stencilBuffer:false
    });
    this.target.texture.generateMipmaps=false;
    this.camera=new THREE.PerspectiveCamera(camera.fov,camera.aspect,camera.near,camera.far);
    this.camera.matrixAutoUpdate=true;
    this.textureMatrix=new THREE.Matrix4();
    this.bias=new THREE.Matrix4().set(
      .5,0,0,.5,
      0,.5,0,.5,
      0,0,.5,.5,
      0,0,0,1
    );
    this.material=null;
    this.frame=0;
    this.lastTime=-Infinity;
    this.lastPosition=new THREE.Vector3(Infinity,Infinity,Infinity);
    this.lastDirection=new THREE.Vector3(0,0,0);
    this.direction=new THREE.Vector3();
    this.position=new THREE.Vector3();
    this.lookTarget=new THREE.Vector3();
    this.up=new THREE.Vector3();
  }
  setMaterial(material){
    if(this.material===material)return;
    this.material=material;
    material.uniforms.tReflection.value=this.target.texture;
    material.uniforms.textureMatrix.value=this.textureMatrix;
  }
  render(time){
    if(!this.material)return;
    this.material.uniforms.time.value=time;
    if(this.frame++%3!==0)return;

    const renderer=this.renderer,source=this.sourceCamera;
    source.updateMatrixWorld(true);
    source.getWorldDirection(this.direction);
    const moved=this.lastPosition.distanceToSquared(source.position)>.0016;
    const turned=1-this.lastDirection.dot(this.direction)>.00035;
    if(!moved&&!turned&&time-this.lastTime<.32)return;

    this.position.copy(source.position);
    this.position.y=.036-this.position.y;
    this.direction.y=-this.direction.y;
    this.up.copy(source.up);
    this.up.y=-this.up.y;
    this.camera.up.copy(this.up);
    this.camera.position.copy(this.position);
    this.lookTarget.copy(this.position).add(this.direction);
    this.camera.lookAt(this.lookTarget);
    this.camera.fov=source.fov;
    this.camera.aspect=1;
    this.camera.near=source.near;
    this.camera.far=Math.min(source.far,120);
    this.camera.updateProjectionMatrix();
    this.camera.layers.mask=source.layers.mask&~(1<<1);
    this.camera.updateMatrixWorld(true);
    this.textureMatrix.copy(this.bias)
      .multiply(this.camera.projectionMatrix)
      .multiply(this.camera.matrixWorldInverse);

    const previousTarget=renderer.getRenderTarget();
    const previousAutoClear=renderer.autoClear;
    try{
      renderer.autoClear=true;
      renderer.setRenderTarget(this.target);
      renderer.clear();
      renderer.render(this.scene,this.camera);
      this.lastPosition.copy(source.position);
      this.lastDirection.copy(this.direction).setY(-this.direction.y);
      this.lastTime=time;
    }finally{
      renderer.setRenderTarget(previousTarget);
      renderer.autoClear=previousAutoClear;
    }
  }
  dispose(){
    this.target.dispose();
    this.material=null;
  }
}
