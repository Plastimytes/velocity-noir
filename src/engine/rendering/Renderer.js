/**
 * VNRenderer — Core WebGL2 Rendering Engine
 * Implements UE5-inspired post-processing on mobile WebGL2:
 *  - HDR Bloom (dual-pass Kawase)
 *  - Screen-Space Ambient Occlusion (SSAO lite)
 *  - Motion Blur (per-object velocity buffer)
 *  - Chromatic Aberration
 *  - Film Grain + Vignette
 *  - Wet-Asphalt Reflection shader
 *  - Sub-Surface Scattering approximation on concrete
 *  - Dynamic Shadow Maps (cascaded, 2-split)
 *  - God-Ray shafts (radial blur post-pass)
 */

import { ShaderLibrary } from './ShaderLibrary.js';
import { GBuffer }       from './GBuffer.js';
import { PostProcessor } from './PostProcessor.js';
import { LightingSystem } from './LightingSystem.js';
import { ShadowSystem }  from './ShadowSystem.js';
import { ParticleSystem } from './ParticleSystem.js';

export class VNRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl     = null;
    this.width  = canvas.width;
    this.height = canvas.height;

    // Sub-systems
    this.shaders    = new ShaderLibrary();
    this.gbuffer    = null;
    this.post       = null;
    this.lighting   = null;
    this.shadows    = null;
    this.particles  = null;

    // Scene
    this.renderQueue  = [];   // { mesh, material, transform, velocity }
    this.lights       = [];
    this.camera       = { pos: [0,2,-6], target: [0,0,0], fov: 65, near: 0.1, far: 2000 };

    // Matrices (gl-matrix style flat Float32Array)
    this.projMatrix  = new Float32Array(16);
    this.viewMatrix  = new Float32Array(16);
    this.vpMatrix    = new Float32Array(16);

    // Post-FX toggles
    this.fx = {
      bloom:      true,
      ssao:       true,
      motionBlur: true,
      godRays:    true,
      grain:      true,
      vignette:   true,
      chromaticAberration: true,
      wetAsphalt: true,
    };

    // Noir color grade LUT
    this.colorGrade = {
      contrast:    1.35,
      saturation:  0.72,
      brightness:  1.05,
      shadowTint:  [0.08, 0.06, 0.04],  // warm shadow sepia
      highlightTint:[1.0, 0.96, 0.88],  // bleached highlight
    };

    this._time = 0;
  }

  async init() {
    const opts = {
      antialias: false,   // We do our own MSAA in post
      alpha: false,
      depth: true,
      stencil: true,
      powerPreference: 'high-performance',
      desynchronized: true,
      preserveDrawingBuffer: false,
    };
    this.gl = this.canvas.getContext('webgl2', opts);
    if (!this.gl) throw new Error('WebGL2 not supported on this device.');

    const gl = this.gl;

    // Enable extensions
    this._ext = {
      floatTex:     gl.getExtension('EXT_color_buffer_float'),
      floatLinear:  gl.getExtension('OES_texture_float_linear'),
      aniso:        gl.getExtension('EXT_texture_filter_anisotropic'),
      drawBuffers:  true, // WebGL2 built-in
      timerQuery:   gl.getExtension('EXT_disjoint_timer_query_webgl2'),
    };

    // Global GL state
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.02, 0.02, 0.02, 1.0);

    // Init sub-systems
    await this.shaders.init(gl);
    this.gbuffer  = new GBuffer(gl, this.width, this.height);
    this.post     = new PostProcessor(gl, this.width, this.height, this.shaders);
    this.lighting = new LightingSystem(gl, this.shaders);
    this.shadows  = new ShadowSystem(gl, this.shaders);
    this.particles= new ParticleSystem(gl, this.shaders);

    this._buildProjMatrix();
    console.log('[VNRenderer] WebGL2 renderer initialized ✓');
  }

  async compileAllShaders() {
    await this.shaders.compileAll();
    console.log('[VNRenderer] All shaders compiled ✓');
  }

  // ─── SCENE SUBMISSION API ────────────────────────────────────────────────
  submitMesh(mesh, material, modelMatrix, prevModelMatrix = null) {
    this.renderQueue.push({ mesh, material, modelMatrix, prevModelMatrix: prevModelMatrix || modelMatrix });
  }

  submitLight(light) { this.lights.push(light); }

  setCamera(pos, target, fov = 65) {
    this.camera.pos    = pos;
    this.camera.target = target;
    this.camera.fov    = fov;
    this._buildViewMatrix();
    this._multiplyMat4(this.vpMatrix, this.projMatrix, this.viewMatrix);
  }

  // ─── MAIN RENDER CALL ────────────────────────────────────────────────────
  render(alpha) {
    const gl = this.gl;
    this._time += 0.016;

    // ── 1. Shadow pass ──────────────────────────────────────────────────────
    this.shadows.renderShadowMaps(this.renderQueue, this.lights);

    // ── 2. G-Buffer pass (deferred geometry) ───────────────────────────────
    this.gbuffer.bind();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this._geometryPass();

    // ── 3. Deferred Lighting pass ───────────────────────────────────────────
    const litBuffer = this.lighting.resolve(
      this.gbuffer, this.shadows, this.lights,
      this.camera, this.vpMatrix, this._time
    );

    // ── 4. Skybox / Atmosphere ──────────────────────────────────────────────
    this._renderSkybox(litBuffer);

    // ── 5. Particle FX (tire smoke, sparks, etc.) ──────────────────────────
    this.particles.render(litBuffer, this.vpMatrix, this._time);

    // ── 6. Post-Processing chain ────────────────────────────────────────────
    this.post.process(litBuffer, this.gbuffer, this.fx, this.colorGrade, this._time);

    // ── 7. UI render pass (direct to back-buffer) ──────────────────────────
    // UI is HTML/CSS overlay — nothing needed here

    // Clear queue for next frame
    this.renderQueue = [];
    this.lights      = [];
  }

  // ─── GEOMETRY PASS ────────────────────────────────────────────────────────
  _geometryPass() {
    const gl = this.gl;
    const prog = this.shaders.get('gbuffer');
    if (!prog) return;
    gl.useProgram(prog);

    // Bind VP matrix
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'u_VP'), false, this.vpMatrix);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_Time'), this._time);

    for (const item of this.renderQueue) {
      const { mesh, material, modelMatrix, prevModelMatrix } = item;
      if (!mesh || !mesh.vao) continue;

      // Bind matrices
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'u_Model'),      false, modelMatrix);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'u_PrevModel'),  false, prevModelMatrix);

      // Bind material properties
      this._bindMaterial(gl, prog, material);

      // Draw
      gl.bindVertexArray(mesh.vao);
      if (mesh.indexCount) {
        gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount);
      }
      gl.bindVertexArray(null);
    }
  }

  _bindMaterial(gl, prog, mat) {
    if (!mat) return;
    const loc = (name) => gl.getUniformLocation(prog, name);

    gl.uniform3fv(loc('u_Albedo'),    mat.albedo    || [0.8, 0.8, 0.8]);
    gl.uniform1f (loc('u_Metallic'),  mat.metallic  ?? 0.0);
    gl.uniform1f (loc('u_Roughness'), mat.roughness ?? 0.5);
    gl.uniform1f (loc('u_Emissive'),  mat.emissive  ?? 0.0);
    gl.uniform1f (loc('u_WetFactor'), mat.wetFactor ?? 0.0);
    gl.uniform1f (loc('u_SSS'),       mat.sss       ?? 0.0); // sub-surface scattering

    // Albedo texture
    if (mat.albedoTex) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, mat.albedoTex);
      gl.uniform1i(loc('u_AlbedoTex'), 0);
      gl.uniform1i(loc('u_HasAlbedoTex'), 1);
    } else {
      gl.uniform1i(loc('u_HasAlbedoTex'), 0);
    }

    // Normal map
    if (mat.normalTex) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, mat.normalTex);
      gl.uniform1i(loc('u_NormalTex'), 1);
      gl.uniform1i(loc('u_HasNormalTex'), 1);
    } else {
      gl.uniform1i(loc('u_HasNormalTex'), 0);
    }

    // ORM (Occlusion / Roughness / Metallic) packed texture
    if (mat.ormTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, mat.ormTex);
      gl.uniform1i(loc('u_ORMTex'), 2);
      gl.uniform1i(loc('u_HasORMTex'), 1);
    } else {
      gl.uniform1i(loc('u_HasORMTex'), 0);
    }
  }

  _renderSkybox(targetFBO) {
    // Renders overcast bright sky with sun-flare bloom source
    const gl = this.gl;
    const prog = this.shaders.get('skybox');
    if (!prog) return;
    gl.useProgram(prog);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_Time'), this._time);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'u_VP'), false, this.vpMatrix);
    gl.depthMask(false);
    // Draw full-screen skybox quad
    this._drawFullscreenQuad(prog);
    gl.depthMask(true);
  }

  _drawFullscreenQuad(prog) {
    const gl = this.gl;
    if (!this._fsqVAO) this._fsqVAO = this._createFSQ();
    gl.bindVertexArray(this._fsqVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 4, 0);
    gl.bindVertexArray(null);
  }

  _createFSQ() {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const verts = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  // ─── MATRIX MATH ──────────────────────────────────────────────────────────
  _buildProjMatrix() {
    const fov    = this.camera.fov * Math.PI / 180;
    const aspect = this.width / this.height;
    const near   = this.camera.near;
    const far    = this.camera.far;
    const f = 1.0 / Math.tan(fov / 2);
    const nf = 1 / (near - far);
    const m = this.projMatrix;
    m[0]=f/aspect; m[1]=0;  m[2]=0;               m[3]=0;
    m[4]=0;        m[5]=f;  m[6]=0;               m[7]=0;
    m[8]=0;        m[9]=0;  m[10]=(far+near)*nf;  m[11]=-1;
    m[12]=0;       m[13]=0; m[14]=2*far*near*nf;  m[15]=0;
  }

  _buildViewMatrix() {
    const [ex,ey,ez] = this.camera.pos;
    const [tx,ty,tz] = this.camera.target;
    // Simplified lookAt
    let fx=tx-ex, fy=ty-ey, fz=tz-ez;
    const fl = Math.sqrt(fx*fx+fy*fy+fz*fz); fx/=fl; fy/=fl; fz/=fl;
    let rx=fy*0-fz*1, ry=fz*0-fx*0, rz=fx*1-fy*0;
    const rl=Math.sqrt(rx*rx+ry*ry+rz*rz); rx/=rl; ry/=rl; rz/=rl;
    const ux=fy*rz-fz*ry, uy=fz*rx-fx*rz, uz=fx*ry-fy*rx;
    const m=this.viewMatrix;
    m[0]=rx; m[1]=ux; m[2]=-fx; m[3]=0;
    m[4]=ry; m[5]=uy; m[6]=-fy; m[7]=0;
    m[8]=rz; m[9]=uz; m[10]=-fz;m[11]=0;
    m[12]=-(rx*ex+ry*ey+rz*ez);
    m[13]=-(ux*ex+uy*ey+uz*ez);
    m[14]=(fx*ex+fy*ey+fz*ez);
    m[15]=1;
  }

  _multiplyMat4(out, a, b) {
    for (let i=0;i<4;i++) for (let j=0;j<4;j++) {
      out[j*4+i]=a[0*4+i]*b[j*4+0]+a[1*4+i]*b[j*4+1]+a[2*4+i]*b[j*4+2]+a[3*4+i]*b[j*4+3];
    }
  }

  onResize(w, h) {
    this.width  = w;
    this.height = h;
    this._buildProjMatrix();
    if (this.gbuffer) this.gbuffer.resize(w, h);
    if (this.post)    this.post.resize(w, h);
  }
}
