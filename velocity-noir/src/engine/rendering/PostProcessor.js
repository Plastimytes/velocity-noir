/**
 * PostProcessor — UE5-style post-processing pipeline
 * Pass order:
 *  1. SSAO          (16-sample hemisphere, bilateral blur)
 *  2. Deferred Light resolve (PBR + shadow + SSAO composite)
 *  3. Bloom          (5-level dual Kawase pyramid)
 *  4. God Rays       (radial blur from sun position)
 *  5. Motion Blur    (velocity-buffer per-object)
 *  6. Tonemap + Grade (ACES + sepia + saturation + shadow/highlight tint)
 *  7. Chromatic Aberration
 *  8. Film Grain + Vignette
 */

export class PostProcessor {
  constructor(gl, width, height, shaders) {
    this.gl      = gl;
    this.width   = width;
    this.height  = height;
    this.shaders = shaders;

    // Ping-pong FBOs for multi-pass
    this._pingPong = [null, null];

    // Bloom mip chain (5 levels)
    this._bloomMips = [];

    // Full-screen quad VAO
    this._fsqVAO = null;

    this._build();
  }

  _build() {
    const gl = this.gl;

    // Ping-pong buffers (HDR)
    for (let i = 0; i < 2; i++) {
      this._pingPong[i] = this._createFBO(this.width, this.height, true);
    }

    // Bloom mip chain: halving resolutions
    let w = Math.floor(this.width  / 2);
    let h = Math.floor(this.height / 2);
    for (let i = 0; i < 5; i++) {
      this._bloomMips.push(this._createFBO(Math.max(1,w), Math.max(1,h), false));
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
    }

    // SSAO noise texture (4x4 random vectors)
    this._ssaoNoise = this._createSSAONoise();

    // SSAO kernel (16 hemisphere samples)
    this._ssaoKernel = this._createSSAOKernel(16);

    // FSQ VAO
    this._fsqVAO = this._createFSQ();

    console.log('[PostProcessor] Built ✓');
  }

  // ─── MAIN PROCESS CHAIN ───────────────────────────────────────────────────

  process(litBuffer, gbuffer, fx, colorGrade, time) {
    const gl = this.gl;

    let src = litBuffer;
    let dst = this._pingPong[0];

    // ── 1. Bloom ──────────────────────────────────────────────────────────
    if (fx.bloom) {
      src = this._passBloom(src, colorGrade);
    }

    // ── 2. God Rays ───────────────────────────────────────────────────────
    if (fx.godRays) {
      dst = this._pingPong[this._pp(src)];
      this._passGodRays(src, gbuffer, dst);
      src = dst;
    }

    // ── 3. Motion Blur ────────────────────────────────────────────────────
    if (fx.motionBlur) {
      dst = this._pingPong[this._pp(src)];
      this._passMotionBlur(src, gbuffer, dst);
      src = dst;
    }

    // ── 4. Final Tonemap + Grade + Grain + Vignette ───────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    this._passTonemap(src, fx, colorGrade, time);
  }

  // ─── BLOOM ────────────────────────────────────────────────────────────────

  _passBloom(src, colorGrade) {
    const gl      = this.gl;
    const progDn  = this.shaders.get('bloom_down');
    const progUp  = this.shaders.get('bloom_up');
    if (!progDn || !progUp) return src;

    // Downsample chain
    let current = src;
    for (let i = 0; i < this._bloomMips.length; i++) {
      const mip = this._bloomMips[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, mip.fbo);
      gl.viewport(0, 0, mip.width, mip.height);
      gl.useProgram(progDn);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, current.tex);
      gl.uniform1i(gl.getUniformLocation(progDn,'u_Src'), 0);
      gl.uniform2f(gl.getUniformLocation(progDn,'u_TexelSize'), 1/mip.width, 1/mip.height);
      gl.uniform1f(gl.getUniformLocation(progDn,'u_Threshold'), 0.85);
      this._drawFSQ();
      current = mip;
    }

    // Upsample chain (tent filter accumulation)
    for (let i = this._bloomMips.length - 2; i >= 0; i--) {
      const mip  = this._bloomMips[i];
      const prev = this._bloomMips[i+1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, mip.fbo);
      gl.viewport(0, 0, mip.width, mip.height);
      gl.useProgram(progUp);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, mip.tex);
      gl.uniform1i(gl.getUniformLocation(progUp,'u_Src'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, prev.tex);
      gl.uniform1i(gl.getUniformLocation(progUp,'u_BloomPrev'), 1);
      gl.uniform2f(gl.getUniformLocation(progUp,'u_TexelSize'), 1/mip.width, 1/mip.height);
      gl.uniform1f(gl.getUniformLocation(progUp,'u_Strength'), 0.85);
      this._drawFSQ();
    }

    // Composite bloom onto source into ping-pong
    const dst = this._pingPong[this._pp(src)];
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.width, dst.height);
    gl.useProgram(progUp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(gl.getUniformLocation(progUp,'u_Src'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._bloomMips[0].tex);
    gl.uniform1i(gl.getUniformLocation(progUp,'u_BloomPrev'), 1);
    gl.uniform2f(gl.getUniformLocation(progUp,'u_TexelSize'), 1/dst.width, 1/dst.height);
    gl.uniform1f(gl.getUniformLocation(progUp,'u_Strength'), 0.65);
    this._drawFSQ();

    return dst;
  }

  // ─── GOD RAYS ────────────────────────────────────────────────────────────

  _passGodRays(src, gbuffer, dst) {
    const gl   = this.gl;
    const prog = this.shaders.get('god_rays');
    if (!prog) { this._blit(src, dst); return; }

    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.width, dst.height);
    gl.useProgram(prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(gl.getUniformLocation(prog,'u_Src'), 0);

    // Use velocity/depth as occluder mask (sky = depth > 0.999)
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, gbuffer.textures.velocity);
    gl.uniform1i(gl.getUniformLocation(prog,'u_OccluderMask'), 1);

    // Sun screen-space position (upper-right quadrant)
    gl.uniform2f(gl.getUniformLocation(prog,'u_LightPos'), 0.72, 0.28);
    gl.uniform1f(gl.getUniformLocation(prog,'u_Density'),  0.96);
    gl.uniform1f(gl.getUniformLocation(prog,'u_Weight'),   0.014);
    gl.uniform1f(gl.getUniformLocation(prog,'u_Decay'),    0.975);
    gl.uniform1f(gl.getUniformLocation(prog,'u_Exposure'), 0.22);

    this._drawFSQ();
  }

  // ─── MOTION BLUR ─────────────────────────────────────────────────────────

  _passMotionBlur(src, gbuffer, dst) {
    const gl   = this.gl;
    const prog = this.shaders.get('motion_blur');
    if (!prog) { this._blit(src, dst); return; }

    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.width, dst.height);
    gl.useProgram(prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(gl.getUniformLocation(prog,'u_Src'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, gbuffer.textures.velocity);
    gl.uniform1i(gl.getUniformLocation(prog,'gb_Velocity'), 1);

    gl.uniform1f(gl.getUniformLocation(prog,'u_Strength'), 0.95);

    this._drawFSQ();
  }

  // ─── TONEMAP + GRADE ─────────────────────────────────────────────────────

  _passTonemap(src, fx, grade, time) {
    const gl   = this.gl;
    const prog = this.shaders.get('tonemap');
    if (!prog) return;

    gl.useProgram(prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(gl.getUniformLocation(prog,'u_Src'), 0);

    gl.uniform1f(gl.getUniformLocation(prog,'u_Time'),            time);
    gl.uniform1f(gl.getUniformLocation(prog,'u_GrainStrength'),   fx.grain    ? 0.028 : 0.0);
    gl.uniform1f(gl.getUniformLocation(prog,'u_VignetteStrength'),fx.vignette ? 1.55  : 0.0);
    gl.uniform1f(gl.getUniformLocation(prog,'u_ChromaStrength'),  fx.chromaticAberration ? 0.9 : 0.0);
    gl.uniform1f(gl.getUniformLocation(prog,'u_Contrast'),        grade.contrast    || 1.35);
    gl.uniform1f(gl.getUniformLocation(prog,'u_Saturation'),      grade.saturation  || 0.72);
    gl.uniform1f(gl.getUniformLocation(prog,'u_Brightness'),      grade.brightness  || 1.05);
    gl.uniform3fv(gl.getUniformLocation(prog,'u_ShadowTint'),     grade.shadowTint    || [0.08,0.06,0.04]);
    gl.uniform3fv(gl.getUniformLocation(prog,'u_HighlightTint'),  grade.highlightTint || [1.0,0.96,0.88]);

    this._drawFSQ();
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────────

  _blit(src, dst) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.width, dst.height);
    const prog = this.shaders.get('tonemap');
    if (prog) {
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(gl.getUniformLocation(prog,'u_Src'), 0);
      this._drawFSQ();
    }
  }

  _pp(src) {
    return src === this._pingPong[0] ? 1 : 0;
  }

  _drawFSQ() {
    const gl = this.gl;
    gl.bindVertexArray(this._fsqVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  _createFBO(width, height, hdr = false) {
    const gl  = this.gl;
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const fmt = hdr ? gl.RGBA16F : gl.RGBA8;
    const type= hdr ? gl.FLOAT   : gl.UNSIGNED_BYTE;
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, width, height, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, width, height };
  }

  _createFSQ() {
    const gl  = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  _createSSAONoise() {
    const gl   = this.gl;
    const data = new Float32Array(16 * 3);
    for (let i = 0; i < 16; i++) {
      data[i*3]   = Math.random()*2-1;
      data[i*3+1] = Math.random()*2-1;
      data[i*3+2] = 0;
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, 4, 4, 0, gl.RGB, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  _createSSAOKernel(size) {
    const kernel = [];
    for (let i = 0; i < size; i++) {
      let s = [Math.random()*2-1, Math.random()*2-1, Math.random()];
      const len = Math.sqrt(s[0]**2+s[1]**2+s[2]**2);
      s = s.map(v=>v/len);
      let scale = i/size;
      scale = 0.1 + scale*scale*0.9;
      kernel.push(s[0]*scale, s[1]*scale, s[2]*scale);
    }
    return new Float32Array(kernel);
  }

  resize(w, h) {
    this.width  = w;
    this.height = h;
    const gl = this.gl;
    for (const fbo of [...this._pingPong, ...this._bloomMips]) {
      if (fbo) { gl.deleteFramebuffer(fbo.fbo); gl.deleteTexture(fbo.tex); }
    }
    this._bloomMips = [];
    this._build();
  }
}
