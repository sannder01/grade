/*
 * Position/velocity variables and their ping-pong dependencies adapt the official
 * Three.js webgl_gpgpu_birds example and GPUComputationRenderer (same 0.186.1).
 * Copyright 2010-2026 three.js authors, MIT: /assets/three.LICENSE.txt.
 * Grade supplies spring/flow forces, screen-space history and the sculpture target.
 * Reference: docs/design/references/particle-interaction/three/.
 */
const positionShader=/* glsl */`
  uniform float uDelta;
  void main() {
    vec2 uv=gl_FragCoord.xy/resolution.xy;
    vec4 p=texture2D(texturePosition,uv);
    vec3 velocity=texture2D(textureVelocity,uv).xyz;
    gl_FragColor=vec4(p.xyz+velocity*uDelta,p.w);
  }
`
const velocityShader=/* glsl */`
  uniform sampler2D uHome;
  uniform sampler2D uScatter;
  uniform sampler2D uField;
  uniform float uDelta;
  uniform float uTime;
  uniform float uAssembly;
  uniform float uDispersion;
  uniform float uCoreCount;
  uniform mat4 uModel;
  uniform mat4 uInverseModel;
  uniform mat4 uViewProjection;
  uniform vec4 uCanvasRect;
  uniform vec2 uViewport;
  uniform vec2 uFieldSize;
  uniform vec3 uRayOrigin;
  uniform vec3 uRayDirection;
  uniform vec3 uScreenRight;
  uniform vec3 uScreenUp;
  uniform float uPointerActive;
  uniform float uPointerSpeed;
  vec3 bounded(vec3 v,float maximum) { return v*min(1.0,maximum/max(length(v),.0001)); }
  void main() {
    vec2 uv=gl_FragCoord.xy/resolution.xy;
    float index=floor(gl_FragCoord.y)*resolution.x+floor(gl_FragCoord.x);
    vec4 home=texture2D(uHome,uv);
    vec3 position=texture2D(texturePosition,uv).xyz;
    vec3 velocity=texture2D(textureVelocity,uv).xyz;
    float dust=step(uCoreCount,index), seed=home.w;
    float phase=clamp((uAssembly-seed*.14)/.86,0.0,1.0);
    float gather=phase*phase*(3.0-2.0*phase);
    vec3 target=mix(texture2D(uScatter,uv).xyz,home.xyz,gather);
    target+=vec3(2.5+(seed-.25)*8.0,sin(seed*37.0)*2.8,(seed-.35)*7.0)*uDispersion;
    target=mix(target,home.xyz,dust);
    vec3 flow=vec3(sin(seed*47.0+uTime*.72+home.y*.7),cos(seed*31.0+uTime*.63+home.z),sin(seed*63.0+uTime*.81+home.x*.6));
    target+=flow*mix(.055,.16,dust);
    vec3 world=mix((uModel*vec4(position,1.0)).xyz,position,dust);
    vec4 projected=uViewProjection*vec4(world,1.0);
    vec2 canvasUV=projected.xy/max(projected.w,.001)*.5+.5;
    vec2 client=uCanvasRect.xy+vec2(canvasUV.x,1.0-canvasUV.y)*uCanvasRect.zw;
    vec2 fieldUV=vec2(client.x/max(uViewport.x,1.0),1.0-client.y/max(uViewport.y,1.0));
    float inViewport=step(0.0,fieldUV.x)*step(fieldUV.x,1.0)*step(0.0,fieldUV.y)*step(fieldUV.y,1.0)*step(.001,projected.w);
    vec3 field=texture2D(uField,fieldUV).rgb;
    vec2 texel=1.0/max(uFieldSize,vec2(1.0));
    vec2 gradient=vec2(texture2D(uField,fieldUV-vec2(texel.x,0.0)).r-texture2D(uField,fieldUV+vec2(texel.x,0.0)).r,
      texture2D(uField,fieldUV-vec2(0.0,texel.y)).r-texture2D(uField,fieldUV+vec2(0.0,texel.y)).r);
    gradient/=max(length(gradient),.025);
    vec2 fieldVelocity=clamp((field.gb*255.0-128.0)/127.0,-1.0,1.0);
    float history=field.r*inViewport;
    vec3 trailDirection=uScreenRight*fieldVelocity.x-uScreenUp*fieldVelocity.y;
    vec3 gradientDirection=uScreenRight*gradient.x+uScreenUp*gradient.y;
    vec3 fromRay=world-uRayOrigin;
    vec3 radial=fromRay-uRayDirection*max(0.0,dot(fromRay,uRayDirection));
    float radius=mix(.63,.9,dust);
    float direct=exp(-dot(radial,radial)/(radius*radius)*2.0)*uPointerActive;
    radial=bounded(radial,1.0)/max(length(radial),.06);
    vec3 force=radial*direct*(5.5+uPointerSpeed*16.0);
    force+=gradientDirection*history*(9.0+uPointerSpeed*8.0)+trailDirection*history*7.0;
    force+=cross(uRayDirection,radial)*direct*(1.4+uPointerSpeed*3.5);
    force+=cross(uRayDirection,trailDirection)*history*2.6;
    force-=uRayDirection*(direct*(1.8+uPointerSpeed*4.0)+history*2.3)*sin(seed*47.0);
    force=bounded(force,25.0);
    force=mix((uInverseModel*vec4(force,0.0)).xyz,force,dust);
    float assembled=smoothstep(.8,1.0,uAssembly);
    float spring=mix(mix(80.0,40.0,assembled),8.0,dust), damping=mix(mix(12.0,8.2,assembled),3.6,dust);
    vec3 acceleration=(target-position)*spring+force+flow*mix(.15,.3,dust);
    velocity=(velocity+acceleration*uDelta)*exp(-damping*uDelta);
    velocity=bounded(velocity,mix(mix(20.0,5.0,assembled),3.0,dust));
    gl_FragColor=vec4(velocity,1.0);
  }
`

let sequence=0
export function createParticleSimulation(T,renderer,{positions,scatter,seeds,dustPositions,assembly=1,input}) {
  const coreCount=seeds.length, dustCount=dustPositions.length/3, count=coreCount+dustCount
  const size=Math.ceil(Math.sqrt(count)), compute=new T.GPUComputationRenderer(size,size,renderer)
  const gl=renderer.getContext()
  if (!gl.getExtension('EXT_color_buffer_float')) { compute.dispose(); throw new Error('simulation-fbo') }
  const initialPosition=compute.createTexture(), initialVelocity=compute.createTexture()
  const home=compute.createTexture(), scattered=compute.createTexture()
  const coreUV=new Float32Array(coreCount*2), dustUV=new Float32Array(dustCount*2)
  for(let i=0;i<size*size;i++) {
    const dust=i>=coreCount, local=dust ? i-coreCount : i, valid=i<count
    const uv=dust ? dustUV : coreUV
    if(valid) { uv[local*2]=(i%size+.5)/size; uv[local*2+1]=(Math.floor(i/size)+.5)/size }
    const seed=dust ? ((local*7919)%65536)/65536 : seeds[i]
    const phase=Math.max(0,Math.min(1,(assembly-seed*.14)/.86)), gather=phase*phase*(3-2*phase)
    for(let axis=0;axis<3;axis++) {
      const rest=valid ? (dust ? dustPositions : positions)[local*3+axis] : 0
      const start=dust || !valid ? rest : scatter[local*3+axis]
      home.image.data[i*4+axis]=rest; scattered.image.data[i*4+axis]=start
      initialPosition.image.data[i*4+axis]=start+(rest-start)*gather
    }
    home.image.data[i*4+3]=valid ? seed : 0
    initialPosition.image.data[i*4+3]=valid ? (dust ? 1 : 0) : -1
  }
  const field=new T.CanvasTexture(input.canvas)
  field.minFilter=field.magFilter=T.LinearFilter; field.generateMipmaps=false
  const position=compute.addVariable('texturePosition',positionShader,initialPosition)
  const velocity=compute.addVariable('textureVelocity',velocityShader,initialVelocity)
  compute.setVariableDependencies(position,[position,velocity]); compute.setVariableDependencies(velocity,[position,velocity])
  position.material.uniforms.uDelta={value:1/60}
  const uniforms=velocity.material.uniforms
  Object.assign(uniforms,{
    uHome:{value:home},uScatter:{value:scattered},uField:{value:field},uDelta:{value:1/60},uTime:{value:0},
    uAssembly:{value:assembly},uDispersion:{value:0},uCoreCount:{value:coreCount},
    uModel:{value:new T.Matrix4()},uInverseModel:{value:new T.Matrix4()},uViewProjection:{value:new T.Matrix4()},
    uCanvasRect:{value:new T.Vector4()},uViewport:{value:new T.Vector2()},uFieldSize:{value:new T.Vector2()},
    uRayOrigin:{value:new T.Vector3()},uRayDirection:{value:new T.Vector3(0,0,-1)},
    uScreenRight:{value:new T.Vector3(1,0,0)},uScreenUp:{value:new T.Vector3(0,1,0)},
    uPointerActive:{value:0},uPointerSpeed:{value:0},
  })
  let disposed=false, step=0, time=0, revision=-1
  const texture={value:null}, ray=new T.Vector3(), cameraRight=new T.Vector3(), cameraUp=new T.Vector3()
  const dispose=() => { if(disposed)return; disposed=true; compute.dispose(); home.dispose(); scattered.dispose(); field.dispose() }
  try {
    const error=compute.init(); if(error)throw new Error('simulation-fbo')
    const previous=renderer.getRenderTarget()
    renderer.setRenderTarget(compute.getCurrentRenderTarget(position))
    const complete=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE
    renderer.setRenderTarget(previous)
    if(!complete)throw new Error('simulation-fbo')
    texture.value=compute.getCurrentRenderTarget(position).texture
  } catch(error) { dispose(); throw error }
  const id=++sequence
  const targets={position:position.renderTargets,velocity:velocity.renderTargets}
  return {
    id,texture,coreUV,dustUV,dispose,
    update(now,delta,{camera,sculpture,bounds,assembly,dispersion}) {
      if(disposed)return
      input.update(now)
      if(revision!==input.revision) { field.needsUpdate=true; revision=input.revision }
      camera.updateMatrixWorld(); sculpture.updateMatrixWorld()
      uniforms.uModel.value.copy(sculpture.matrixWorld); uniforms.uInverseModel.value.copy(sculpture.matrixWorld).invert()
      uniforms.uViewProjection.value.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
      uniforms.uCanvasRect.value.set(bounds.left,bounds.top,bounds.width,bounds.height)
      uniforms.uViewport.value.set(innerWidth,innerHeight); uniforms.uFieldSize.value.set(input.canvas.width,input.canvas.height)
      const pointer=input.pointer, inside=pointer.active && pointer.x>=bounds.left && pointer.x<=bounds.right && pointer.y>=bounds.top && pointer.y<=bounds.bottom
      ray.set((pointer.x-bounds.left)/Math.max(1,bounds.width)*2-1,1-(pointer.y-bounds.top)/Math.max(1,bounds.height)*2,.5).unproject(camera).sub(camera.position)
      if(ray.lengthSq()>.000001)ray.normalize(); else ray.set(0,0,-1)
      uniforms.uRayOrigin.value.copy(camera.position); uniforms.uRayDirection.value.copy(ray)
      cameraRight.setFromMatrixColumn(camera.matrixWorld,0).normalize(); cameraUp.setFromMatrixColumn(camera.matrixWorld,1).normalize()
      uniforms.uScreenRight.value.copy(cameraRight); uniforms.uScreenUp.value.copy(cameraUp)
      uniforms.uPointerActive.value=inside ? 1 : 0; uniforms.uPointerSpeed.value=Math.max(0,Math.min(1,pointer.speed || 0))
      uniforms.uAssembly.value=assembly; uniforms.uDispersion.value=dispersion
      const dt=Math.max(.001,Math.min(.05,delta/1000))
      uniforms.uDelta.value=position.material.uniforms.uDelta.value=dt; time+=dt; uniforms.uTime.value=time
      compute.compute(); step++; texture.value=compute.getCurrentRenderTarget(position).texture
    },
    snapshot() {
      return {id,step,time,width:size,height:size,targets,positionTarget:compute.getCurrentRenderTarget(position),velocityTarget:compute.getCurrentRenderTarget(velocity),
        renderer,coreCount,dustCount,homeTexture:home,scatterTexture:scattered,dataType:T.FloatType,
        matrixWorld:uniforms.uModel.value.toArray(),viewProjection:uniforms.uViewProjection.value.toArray(),
        pointerActive:uniforms.uPointerActive.value,pointerSpeed:uniforms.uPointerSpeed.value,ray:ray.toArray(),inputRevision:revision}
    },
  }
}
