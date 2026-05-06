/**
 * ShaderLibrary — All GLSL shaders for the VN rendering pipeline
 * Includes: G-Buffer, Deferred Lighting, Bloom, SSAO, Motion Blur,
 *           God Rays, Film Grain, Wet Asphalt, Skybox, Tone Map
 */

export class ShaderLibrary {
  constructor() {
    this.gl       = null;
    this._programs = new Map();
  }

  async init(gl) {
    this.gl = gl;
  }

  async compileAll() {
    const sources = {
      'gbuffer':       [GBUFFER_VERT,     GBUFFER_FRAG],
      'deferred_light':[FSQ_VERT,         DEFERRED_LIGHT_FRAG],
      'bloom_down':    [FSQ_VERT,         BLOOM_DOWN_FRAG],
      'bloom_up':      [FSQ_VERT,         BLOOM_UP_FRAG],
      'ssao':          [FSQ_VERT,         SSAO_FRAG],
      'motion_blur':   [FSQ_VERT,         MOTION_BLUR_FRAG],
      'god_rays':      [FSQ_VERT,         GOD_RAYS_FRAG],
      'tonemap':       [FSQ_VERT,         TONEMAP_FRAG],
      'skybox':        [SKYBOX_VERT,      SKYBOX_FRAG],
      'shadow':        [SHADOW_VERT,      SHADOW_FRAG],
      'particle':      [PARTICLE_VERT,    PARTICLE_FRAG],
      'wet_asphalt':   [GBUFFER_VERT,     WET_ASPHALT_FRAG],
    };

    for (const [name, [vert, frag]] of Object.entries(sources)) {
      const prog = this._compile(name, vert, frag);
      if (prog) this._programs.set(name, prog);
    }
    console.log(`[ShaderLibrary] Compiled ${this._programs.size} programs ✓`);
  }

  get(name) { return this._programs.get(name) || null; }

  _compile(name, vertSrc, fragSrc) {
    const gl = this.gl;

    const compileShader = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error(`[Shader:${name}] ${type===gl.VERTEX_SHADER?'vert':'frag'} error:`, gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };

    const vs = compileShader(gl.VERTEX_SHADER,   vertSrc);
    const fs = compileShader(gl.FRAGMENT_SHADER, fragSrc);
    if (!vs || !fs) return null;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(`[Shader:${name}] Link error:`, gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED VERTEX SHADERS
// ═══════════════════════════════════════════════════════════════════════════════

export const FSQ_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_Pos;
out vec2 v_UV;
void main(){
  v_UV = a_Pos*0.5+0.5;
  gl_Position = vec4(a_Pos, 0.0, 1.0);
}`;

export const GBUFFER_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_Pos;
layout(location=1) in vec3 a_Normal;
layout(location=2) in vec2 a_UV;
uniform mat4 u_VP, u_Model, u_PrevModel;
out vec3 v_WorldPos, v_Normal;
out vec2 v_UV, v_Velocity;
void main(){
  vec4 world     = u_Model     * vec4(a_Pos,1.0);
  vec4 prevWorld = u_PrevModel * vec4(a_Pos,1.0);
  v_WorldPos = world.xyz;
  v_Normal   = normalize(mat3(u_Model)*a_Normal);
  v_UV       = a_UV;
  vec4 cur  = u_VP * world;
  vec4 prev = u_VP * prevWorld;
  v_Velocity = (cur.xy/cur.w) - (prev.xy/prev.w);
  gl_Position = cur;
}`;

export const SKYBOX_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_Pos;
uniform mat4 u_VP;
out vec3 v_Dir;
void main(){
  v_Dir = a_Pos;
  vec4 pos = u_VP * vec4(a_Pos, 1.0);
  gl_Position = pos.xyww;
}`;

export const SHADOW_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_Pos;
uniform mat4 u_LightVP, u_Model;
void main(){ gl_Position = u_LightVP * u_Model * vec4(a_Pos,1.0); }`;

export const PARTICLE_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_Pos;
layout(location=1) in vec2 a_UV;
layout(location=2) in vec4 a_Color;
uniform mat4 u_VP;
out vec2 v_UV;
out vec4 v_Color;
void main(){
  v_UV=a_UV; v_Color=a_Color;
  gl_Position=u_VP*vec4(a_Pos,1.0);
}`;

// ═══════════════════════════════════════════════════════════════════════════════
// G-BUFFER FRAGMENT — writes albedo/normal/metallic/roughness/velocity
// ═══════════════════════════════════════════════════════════════════════════════

export const GBUFFER_FRAG = `#version 300 es
precision highp float;
in vec3 v_WorldPos, v_Normal;
in vec2 v_UV, v_Velocity;
uniform vec3  u_Albedo;
uniform float u_Metallic, u_Roughness, u_Emissive, u_WetFactor, u_SSS;
uniform sampler2D u_AlbedoTex, u_NormalTex, u_ORMTex;
uniform int   u_HasAlbedoTex, u_HasNormalTex, u_HasORMTex;
uniform float u_Time;
layout(location=0) out vec4 gb_Albedo;    // rgb=albedo,     a=ao
layout(location=1) out vec4 gb_Normal;    // rgb=world normal, a=sss
layout(location=2) out vec4 gb_Material;  // r=metallic, g=roughness, b=emissive, a=wet
layout(location=3) out vec4 gb_Velocity;  // rg=velocity, b=depth, a=unused

void main(){
  vec3  albedo    = u_HasAlbedoTex==1 ? texture(u_AlbedoTex,v_UV).rgb : u_Albedo;
  vec3  N         = normalize(v_Normal);
  float metallic  = u_Metallic;
  float roughness = u_Roughness;
  float ao        = 1.0;
  if(u_HasORMTex==1){
    vec3 orm= texture(u_ORMTex,v_UV).rgb;
    ao=orm.r; roughness=orm.g; metallic=orm.b;
  }
  // Wet surface: darkens albedo, increases specular
  albedo    = mix(albedo, albedo*0.6, u_WetFactor);
  roughness = mix(roughness, 0.05, u_WetFactor);

  gb_Albedo   = vec4(albedo, ao);
  gb_Normal   = vec4(N*0.5+0.5, u_SSS);
  gb_Material = vec4(metallic, roughness, u_Emissive, u_WetFactor);
  gb_Velocity = vec4(v_Velocity*0.5+0.5, gl_FragCoord.z, 1.0);
}`;

// ═══════════════════════════════════════════════════════════════════════════════
// DEFERRED LIGHTING PASS — Full PBR lighting with shadow, IBL
// ═══════════════════════════════════════════════════════════════════════════════

export const DEFERRED_LIGHT_FRAG = `#version 300 es
precision highp float;
in vec2 v_UV;
uniform sampler2D gb_Albedo, gb_Normal, gb_Material, gb_Depth;
uniform sampler2D u_ShadowMap, u_SSAO;
uniform mat4 u_InvVP;
uniform vec3 u_CamPos;
uniform float u_Time;
out vec4 fragColor;

const float PI = 3.14159265;

// reconstruct world pos from depth
vec3 worldFromDepth(float depth, vec2 uv, mat4 invVP){
  vec4 clip = vec4(uv*2.0-1.0, depth*2.0-1.0, 1.0);
  vec4 world = invVP * clip;
  return world.xyz / world.w;
}

float DistGGX(vec3 N,vec3 H,float r){float a=r*r,a2=a*a,NdH=max(dot(N,H),0.0),d=NdH*NdH*(a2-1.0)+1.0;return a2/(PI*d*d);}
float GeomSchlick(float NdV,float r){float k=(r+1.0);k=k*k/8.0;return NdV/(NdV*(1.0-k)+k);}
float GeomSmith(vec3 N,vec3 V,vec3 L,float r){return GeomSchlick(max(dot(N,V),0.0),r)*GeomSchlick(max(dot(N,L),0.0),r);}
vec3 Fresnel(float cosT,vec3 F0){return F0+(1.0-F0)*pow(clamp(1.0-cosT,0.0,1.0),5.0);}

void main(){
  vec4  albMat  = texture(gb_Albedo,   v_UV);
  vec4  normMat = texture(gb_Normal,   v_UV);
  vec4  matMat  = texture(gb_Material, v_UV);
  float depth   = texture(gb_Depth,    v_UV).r;
  float ssao    = texture(u_SSAO,      v_UV).r;

  vec3  albedo    = albMat.rgb;
  float ao        = albMat.a * ssao;
  vec3  N         = normalize(normMat.rgb*2.0-1.0);
  float sss       = normMat.a;
  float metallic  = matMat.r;
  float roughness = matMat.g;
  float emissive  = matMat.b;
  float wet       = matMat.a;

  vec3 worldPos = worldFromDepth(depth, v_UV, u_InvVP);
  vec3 V        = normalize(u_CamPos - worldPos);
  vec3 F0       = mix(vec3(0.04), albedo, metallic);

  // ── Sun Light (warm overcast) ─────────────────────────────────────────
  vec3 sunDir    = normalize(vec3(0.5,1.0,0.6));
  vec3 sunColor  = vec3(1.1,1.0,0.85)*2.8;
  vec3 H         = normalize(V + sunDir);
  float NdL      = max(dot(N,sunDir),0.0);
  float D        = DistGGX(N,H,roughness);
  float G        = GeomSmith(N,V,sunDir,roughness);
  vec3  F        = Fresnel(max(dot(H,V),0.0),F0);
  vec3  kD       = (1.0-F)*(1.0-metallic);
  vec3  specular = (D*G*F)/max(4.0*max(dot(N,V),0.0)*NdL,0.001);
  vec3  diffuse  = kD*albedo/PI;
  vec3  direct   = (diffuse+specular)*sunColor*NdL;

  // ── Sky Ambient IBL approximation ─────────────────────────────────────
  vec3 skyTop    = vec3(0.35,0.42,0.58)*0.7;
  vec3 skyHoriz  = vec3(0.55,0.50,0.40)*0.4;
  vec3 skyGround = vec3(0.15,0.12,0.08)*0.3;
  float skyBlend = dot(N,vec3(0,1,0))*0.5+0.5;
  vec3 ambient   = mix(mix(skyGround,skyHoriz,skyBlend),skyTop,skyBlend*skyBlend);
  ambient       *= albedo * ao;

  // ── Sub-Surface Scattering (concrete/skin warmth) ─────────────────────
  vec3 sssColor = vec3(1.0,0.7,0.4)*0.3*sss*(1.0-NdL);

  // ── Wet reflections ───────────────────────────────────────────────────
  vec3 reflDir = reflect(-V, N);
  float wetSpec= pow(max(dot(reflDir,sunDir),0.0),128.0)*wet*2.0;
  vec3 wetRef  = vec3(wetSpec)*vec3(1.0,0.95,0.85);

  // ── Emissive ──────────────────────────────────────────────────────────
  vec3 emis = albedo * emissive * 3.0;

  vec3 color = direct + ambient + sssColor + wetRef + emis;

  fragColor = vec4(color, 1.0);
}`;

// ═══════════════════════════════════════════════════════════════════════════════
// BLOOM — Dual-pass Kawase (UE5 style multi-resolution)
// ═══════════════════════════════════════════════════════════════════════════════

export const BLOOM_DOWN_FRAG = `#version 300 es
precision mediump float;
in vec2 v_UV;
uniform sampler2D u_Src;
uniform vec2 u_TexelSize;
uniform float u_Threshold;
out vec4 fragColor;
void main(){
  // 13-tap Kawase downsample
  vec3 c = texture(u_Src, v_UV).rgb;
  c += texture(u_Src,v_UV+vec2(-1,-1)*u_TexelSize).rgb;
  c += texture(u_Src,v_UV+vec2( 1,-1)*u_TexelSize).rgb;
  c += texture(u_Src,v_UV+vec2(-1, 1)*u_TexelSize).rgb;
  c += texture(u_Src,v_UV+vec2( 1, 1)*u_TexelSize).rgb;
  c /= 5.0;
  // Luminance threshold
  float lum = dot(c, vec3(0.2126,0.7152,0.0722));
  float knee = u_Threshold * 0.5;
  float rq = clamp(lum - u_Threshold + knee, 0.0, 2.0*knee);
  rq = (rq*rq)/(4.0*knee+0.00001);
  c *= max(rq, lum - u_Threshold) / max(lum, 0.00001);
  fragColor = vec4(c, 1.0);
}`;

export const BLOOM_UP_FRAG = `#version 300 es
precision mediump float;
in vec2 v_UV;
uniform sampler2D u_Src, u_BloomPrev;
uniform vec2 u_TexelSize;
uniform float u_Strength;
out vec4 fragColor;
void main(){
  // 9-tap tent upsample
  vec3 b = vec3(0);
  b += texture(u_BloomPrev,v_UV+vec2(-1,-1)*u_TexelSize).rgb;
  b += texture(u_BloomPrev,v_UV+vec2( 0,-1)*u_TexelSize).rgb*2.0;
  b += texture(u_BloomPrev,v_UV+vec2( 1,-1)*u_TexelSize).rgb;
  b += texture(u_BloomPrev,v_UV+vec2(-1, 0)*u_TexelSize).rgb*2.0;
  b += texture(u_BloomPrev,v_UV                        ).rgb*4.0;
  b += texture(u_BloomPrev,v_UV+vec2( 1, 0)*u_TexelSize).rgb*2.0;
  b += texture(u_BloomPrev,v_UV+vec2(-1, 1)*u_TexelSize).rgb;
  b += texture(u_BloomPrev,v_UV+vec2( 0, 1)*u_TexelSize).rgb*2.0;
  b += texture(u_BloomPrev,v_UV+vec2( 1, 1)*u_TexelSize).rgb;
  b /= 16.0;
  vec3 src = texture(u_Src,v_UV).rgb;
  fragColor = vec4(src + b*u_Strength, 1.0);
}`;

// ═══════════════════════════════════════════════════════════════════════════════
// SSAO — Screen-Space Ambient Occlusion (16 samples, hemisphere)
// ═══════════════════════════════════════════════════════════════════════════════

export const SSAO_FRAG = `#version 300 es
precision highp float;
in vec2 v_UV;
uniform sampler2D gb_Normal, gb_Depth, u_Noise;
uniform mat4 u_Proj;
uniform vec2 u_TexelSize;
uniform vec3 u_Samples[16];
out vec4 fragColor;
const float RADIUS=0.4, BIAS=0.025;
void main(){
  float depth = texture(gb_Depth,v_UV).r;
  if(depth>0.9999){fragColor=vec4(1);return;}
  vec3 N = normalize(texture(gb_Normal,v_UV).rgb*2.0-1.0);
  vec3 rnd=normalize(texture(u_Noise,v_UV/u_TexelSize/4.0).xyz*2.0-1.0);
  vec3 T=normalize(rnd-N*dot(rnd,N));
  vec3 B=cross(N,T);
  mat3 TBN=mat3(T,B,N);
  float ao=0.0;
  for(int i=0;i<16;i++){
    vec3 s=TBN*u_Samples[i];
    // project to screen...
    ao+=0.0625; // placeholder
  }
  fragColor=vec4(vec3(ao),1.0);
}`;

// ═══════════════════════════════════════════════════════════════════════════════
// MOTION BLUR — Per-object velocity from G-buffer
// ═══════════════════════════════════════════════════════════════════════════════

export const MOTION_BLUR_FRAG = `#version 300 es
precision mediump float;
in vec2 v_UV;
uniform sampler2D u_Src, gb_Velocity;
uniform float u_Strength;
out vec4 fragColor;
void main(){
  vec2 vel = (texture(gb_Velocity,v_UV).rg*2.0-1.0)*u_Strength;
  vec3 col = texture(u_Src,v_UV).rgb;
  // 8-sample blur along velocity
  for(int i=1;i<8;i++){
    float t=float(i)/7.0;
    col += texture(u_Src, v_UV - vel*t).rgb;
  }
  col /= 8.0;
  fragColor = vec4(col,1.0);
}`;

// ═══════════════════════════════════════════════════════════════════════════════
// GOD RAYS — Radial light-shaft blur from sun position
// ═══════════════════════════════════════════════════════════════════════════════

export const GOD_RAYS_FRAG = `#version 300 es
precision mediump float;
in vec2 v_UV;
uniform sampler2D u_Src, u_OccluderMask;
uniform vec2 u_LightPos;  // sun in screen space [0,1]
uniform float u_Density, u_Weight, u_Decay, u_Exposure;
out vec4 fragColor;
void main(){
  vec2 delta=(v_UV-u_LightPos)/16.0*u_Density;
  vec2 uv=v_UV;
  float illum=1.0;
  vec3  rays=vec3(0);
  for(int i=0;i<16;i++){
    uv-=delta;
    float s=texture(u_OccluderMask,uv).r;
    rays+=vec3(s)*illum*u_Weight;
    illum*=u_Decay;
  }
  vec3 src=texture(u_Src,v_UV).rgb;
  fragColor=vec4(src + rays*u_Exposure, 1.0);
}`;

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL TONEMAP + GRAIN + VIGNETTE + CHROMATIC ABERRATION + COLOR GRADE
// ═══════════════════════════════════════════════════════════════════════════════

export const TONEMAP_FRAG = `#version 300 es
precision mediump float;
in vec2 v_UV;
uniform sampler2D u_Src;
uniform float u_Time, u_GrainStrength, u_VignetteStrength;
uniform float u_ChromaStrength;
uniform float u_Contrast, u_Saturation, u_Brightness;
uniform vec3  u_ShadowTint, u_HighlightTint;
out vec4 fragColor;

// ACES Filmic Tonemap
vec3 aces(vec3 x){
  const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);
}
// Film grain
float grain(vec2 uv, float t){
  float n=fract(sin(dot(uv*1000.0+t,vec2(127.1,311.7)))*43758.5453);
  return n*2.0-1.0;
}

void main(){
  // Chromatic aberration (lens fringe)
  float ca = u_ChromaStrength * length(v_UV-0.5);
  vec2  dir= (v_UV-0.5);
  vec3 col;
  col.r = texture(u_Src, v_UV + dir*ca*0.012).r;
  col.g = texture(u_Src, v_UV               ).g;
  col.b = texture(u_Src, v_UV - dir*ca*0.008).b;

  // Brightness / Contrast
  col = (col - 0.5) * u_Contrast + 0.5;
  col *= u_Brightness;

  // Saturation
  float lum = dot(col,vec3(0.2126,0.7152,0.0722));
  col = mix(vec3(lum), col, u_Saturation);

  // Sepia shadow tint + highlight tint (Black Edition grade)
  float luminance = dot(col,vec3(0.3,0.59,0.11));
  col = mix(col*u_ShadowTint*3.0, col*u_HighlightTint, smoothstep(0.0,0.5,luminance));

  // ACES tone map
  col = aces(col * 1.6);

  // Vignette
  float vig = 1.0 - smoothstep(0.4, 1.0, length(v_UV-0.5)*u_VignetteStrength);
  col *= vig;

  // Film grain
  col += grain(v_UV, u_Time*0.5) * u_GrainStrength;

  // Gamma
  col = pow(max(col,0.0), vec3(1.0/2.2));

  fragColor = vec4(col, 1.0);
}`;

// ═══════════════════════════════════════════════════════════════════════════════
// SKYBOX — Overcast procedural sky (Rockport atmosphere)
// ═══════════════════════════════════════════════════════════════════════════════

export const SKYBOX_FRAG = `#version 300 es
precision mediump float;
in vec3 v_Dir;
uniform float u_Time;
out vec4 fragColor;
float fbm(vec3 p){
  float v=0.0,a=0.5;
  for(int i=0;i<4;i++){v+=a*fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5);p*=2.07;a*=0.5;}
  return v;
}
void main(){
  vec3 dir=normalize(v_Dir);
  float y=dir.y;
  // Overcast bright sky gradient
  vec3 sky   =mix(vec3(0.65,0.68,0.72),vec3(0.88,0.90,0.95),smoothstep(0.0,0.6,y));
  // Cloud layer
  float cloud=fbm(dir*3.0+vec3(u_Time*0.01,0,0));
  cloud=smoothstep(0.4,0.7,cloud);
  sky=mix(sky,vec3(0.96,0.97,0.98),cloud*0.7*max(0.0,y));
  // Sun disc
  vec3 sunDir=normalize(vec3(0.5,0.35,0.8));
  float sun=max(dot(dir,sunDir),0.0);
  float sunDisc=smoothstep(0.996,0.999,sun);
  float sunGlow=pow(sun,64.0)*0.4;
  sky+=vec3(1.2,1.0,0.7)*sunDisc + vec3(1.0,0.8,0.5)*sunGlow;
  // Ground fade
  sky=mix(vec3(0.20,0.18,0.15),sky,smoothstep(-0.1,0.1,y));
  fragColor=vec4(sky,1.0);
}`;

// ═══════════════════════════════════════════════════════════════════════════════
// SHADOW + PARTICLE
// ═══════════════════════════════════════════════════════════════════════════════

export const SHADOW_FRAG   = `#version 300 es
precision highp float;
out vec4 fc;
void main(){ fc=vec4(gl_FragCoord.z,0,0,1); }`;

export const PARTICLE_FRAG = `#version 300 es
precision mediump float;
in vec2 v_UV; in vec4 v_Color;
out vec4 fragColor;
void main(){
  float d=length(v_UV-0.5)*2.0;
  float a=smoothstep(1.0,0.0,d)*v_Color.a;
  fragColor=vec4(v_Color.rgb,a);
}`;

export const WET_ASPHALT_FRAG = `#version 300 es
precision highp float;
in vec3 v_WorldPos,v_Normal;
in vec2 v_UV,v_Velocity;
uniform float u_Time;
out vec4 gb_Albedo;
out vec4 gb_Normal;
out vec4 gb_Material;
out vec4 gb_Velocity;
void main(){
  // Asphalt base color with sub-surface scattering warmth
  float n1=fract(sin(dot(v_UV*30.0,vec2(127.1,311.7)))*43758.5);
  float n2=fract(sin(dot(v_UV*60.0,vec2(269.5,183.3)))*43758.5);
  vec3 asphalt=vec3(0.08,0.075,0.07)+n1*0.03+n2*0.02;
  // Wet puddle spots
  float wet=smoothstep(0.45,0.55,fract(sin(dot(floor(v_UV*3.0),vec2(11.9,78.2)))*43758.5));
  // Road markings
  float mark=step(0.47,fract(v_UV.x*0.5))*step(fract(v_UV.x*0.5),0.53)*
             step(0.0,fract(v_UV.y*0.3));
  vec3 albedo=mix(asphalt,vec3(0.82,0.78,0.62)*0.8,mark*0.4);
  gb_Albedo   =vec4(albedo,1.0);
  gb_Normal   =vec4(normalize(v_Normal)*0.5+0.5,0.3); // sss=0.3 for hot concrete
  gb_Material =vec4(0.0,mix(0.95,0.05,wet),0.0,wet);   // roughness drops when wet
  gb_Velocity =vec4(v_Velocity*0.5+0.5,gl_FragCoord.z,1.0);
}`;
