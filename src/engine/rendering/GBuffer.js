/**
 * GBuffer — Deferred Rendering Geometry Buffer
 * MRT layout:
 *   Attachment 0 : Albedo   (RGBA16F) — rgb=albedo, a=AO
 *   Attachment 1 : Normal   (RGBA16F) — rgb=world-normal, a=SSS
 *   Attachment 2 : Material (RGBA16F) — r=metallic, g=roughness, b=emissive, a=wet
 *   Attachment 3 : Velocity (RGBA16F) — rg=screen-space velocity, b=depth, a=unused
 *   Depth         : DEPTH24_STENCIL8
 */

export class GBuffer {
  constructor(gl, width, height) {
    this.gl     = gl;
    this.width  = width;
    this.height = height;
    this.fbo    = null;
    this.textures = {};   // albedo | normal | material | velocity
    this.depth    = null;
    this._build();
  }

  _build() {
    const gl = this.gl;

    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);

    const attachmentDefs = [
      { name: 'albedo',   attachment: gl.COLOR_ATTACHMENT0 },
      { name: 'normal',   attachment: gl.COLOR_ATTACHMENT1 },
      { name: 'material', attachment: gl.COLOR_ATTACHMENT2 },
      { name: 'velocity', attachment: gl.COLOR_ATTACHMENT3 },
    ];

    for (const def of attachmentDefs) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F,
        this.width, this.height, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, def.attachment, gl.TEXTURE_2D, tex, 0);
      this.textures[def.name] = tex;
    }

    // Depth+Stencil renderbuffer
    this.depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, this.width, this.height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this.depth);

    // Draw buffers
    gl.drawBuffers([
      gl.COLOR_ATTACHMENT0,
      gl.COLOR_ATTACHMENT1,
      gl.COLOR_ATTACHMENT2,
      gl.COLOR_ATTACHMENT3,
    ]);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('[GBuffer] Framebuffer incomplete:', status);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    console.log('[GBuffer] Built ✓', this.width, 'x', this.height);
  }

  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.drawBuffers([
      gl.COLOR_ATTACHMENT0,
      gl.COLOR_ATTACHMENT1,
      gl.COLOR_ATTACHMENT2,
      gl.COLOR_ATTACHMENT3,
    ]);
  }

  unbind() {
    this.gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  bindTextures(startUnit = 0) {
    const gl     = this.gl;
    const order  = ['albedo', 'normal', 'material', 'velocity'];
    for (let i = 0; i < order.length; i++) {
      gl.activeTexture(gl.TEXTURE0 + startUnit + i);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[order[i]]);
    }
    return startUnit + order.length;
  }

  resize(w, h) {
    this.width  = w;
    this.height = h;
    // Destroy and rebuild
    const gl = this.gl;
    gl.deleteFramebuffer(this.fbo);
    for (const tex of Object.values(this.textures)) gl.deleteTexture(tex);
    gl.deleteRenderbuffer(this.depth);
    this._build();
  }

  getDepthTexture() { return this.textures.velocity; } // velocity.b = depth
}
