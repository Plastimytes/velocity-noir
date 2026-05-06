/**
 * LightingSystem — Deferred PBR light resolve pass
 * ShadowSystem   — Cascaded shadow maps (2-split CSM)
 */

export class LightingSystem {
  constructor(gl, shaders) {
    this.gl      = gl;
    this.shaders = shaders;
    this._fbo    = null;
    this._tex    = null;
    this._fsqVAO = null;
    this._built  = false;
  }

  _ensureBuilt(w, h) {
    if (this._built) return;
    const gl  = this.gl;

    // Output HDR buffer
    this._fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
    this._tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // FSQ
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this._fsqVAO = vao;
    this._built  = true;
    this._w = w; this._h = h;
  }

  resolve(gbuffer, shadows, lights, camera, vpMatrix, time) {
    const gl = this.gl;
    this._ensureBuilt(gbuffer.width || 1, gbuffer.height || 1);

    const prog = this.shaders.get('deferred_light');
    if (!prog) return { tex: gbuffer.textures.albedo, fbo: null };

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
    gl.viewport(0, 0, this._w, this._h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);

    // Bind G-buffer textures
    const nextUnit = gbuffer.bindTextures(0);
    gl.uniform1i(gl.getUniformLocation(prog,'gb_Albedo'),   0);
    gl.uniform1i(gl.getUniformLocation(prog,'gb_Normal'),   1);
    gl.uniform1i(gl.getUniformLocation(prog,'gb_Material'), 2);
    gl.uniform1i(gl.getUniformLocation(prog,'gb_Depth'),    3);

    // Shadow map
    if (shadows._shadowTex) {
      gl.activeTexture(gl.TEXTURE0 + nextUnit);
      gl.bindTexture(gl.TEXTURE_2D, shadows._shadowTex);
      gl.uniform1i(gl.getUniformLocation(prog,'u_ShadowMap'), nextUnit);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog,'u_LightVP'), false, shadows._lightVP);
    }

    // Uniforms
    const invVP = _invertMat4(vpMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog,'u_InvVP'), false, invVP);
    gl.uniform3fv(gl.getUniformLocation(prog,'u_CamPos'), camera.pos);
    gl.uniform1f (gl.getUniformLocation(prog,'u_Time'),   time);

    gl.bindVertexArray(this._fsqVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    return { tex: this._tex, fbo: this._fbo };
  }
}

// ─── SHADOW SYSTEM ───────────────────────────────────────────────────────────

export class ShadowSystem {
  constructor(gl, shaders) {
    this.gl      = gl;
    this.shaders = shaders;
    this._shadowFBO = null;
    this._shadowTex = null;
    this._lightVP   = new Float32Array(16);
    this._size      = 2048;
    this._built     = false;
  }

  _ensureBuilt() {
    if (this._built) return;
    const gl   = this.gl;
    const size = this._size;

    this._shadowFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._shadowFBO);

    this._shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT32F,
      size, size, 0, gl.DEPTH_COMPONENT, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_BORDER);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_BORDER);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this._shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._built = true;
  }

  renderShadowMaps(renderQueue, lights) {
    this._ensureBuilt();
    const gl   = this.gl;
    const prog = this.shaders.get('shadow');
    if (!prog) return;

    // Build light VP from sun direction
    const sunDir = [0.5, 1.0, 0.6];
    this._lightVP = _buildOrthoShadowVP(sunDir, 200);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._shadowFBO);
    gl.viewport(0, 0, this._size, this._size);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog,'u_LightVP'), false, this._lightVP);

    for (const item of renderQueue) {
      const { mesh, modelMatrix } = item;
      if (!mesh?.vao) continue;
      gl.uniformMatrix4fv(gl.getUniformLocation(prog,'u_Model'), false, modelMatrix);
      gl.bindVertexArray(mesh.vao);
      if (mesh.indexCount) {
        gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount || 0);
      }
      gl.bindVertexArray(null);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

// ─── PARTICLE SYSTEM ─────────────────────────────────────────────────────────

export class ParticleSystem {
  constructor(gl, shaders) {
    this.gl      = gl;
    this.shaders = shaders;
    this._particles = [];
    this._vao    = null;
    this._vbo    = null;
    this._maxP   = 2000;
    this._build();
  }

  _build() {
    const gl  = this.gl;
    this._vao = gl.createVertexArray();
    gl.bindVertexArray(this._vao);
    this._vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    // pos(3) + uv(2) + color(4) = 9 floats per vertex, 4 vertices per particle
    gl.bufferData(gl.ARRAY_BUFFER, this._maxP * 4 * 9 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 9*4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 9*4, 3*4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 9*4, 5*4);
    gl.bindVertexArray(null);
  }

  emitTireSmoke(pos, heading) {
    const color = [0.7, 0.7, 0.7, 0.6];
    for (let i = 0; i < 3; i++) {
      this._particles.push({
        x: pos[0] + (Math.random()-0.5)*1.5,
        y: pos[1] + 0.1,
        z: pos[2] + (Math.random()-0.5)*1.5,
        vx:(Math.random()-0.5)*2, vy:0.8+Math.random()*1.2, vz:(Math.random()-0.5)*2,
        size:0.4+Math.random()*0.6, life:1.0, maxLife:1.0,
        color:[...color],
        type:'smoke',
      });
    }
  }

  emitBrakeSparks(pos) {
    for (let i = 0; i < 8; i++) {
      const angle = Math.random()*Math.PI*2;
      this._particles.push({
        x: pos[0], y: pos[1]+0.3, z: pos[2],
        vx:Math.cos(angle)*4, vy:2+Math.random()*3, vz:Math.sin(angle)*4,
        size:0.05, life:0.4+Math.random()*0.3, maxLife:0.7,
        color:[1.0, 0.5+Math.random()*0.5, 0.0, 1.0],
        type:'spark',
      });
    }
  }

  render(litBuffer, vpMatrix, time) {
    const gl   = this.gl;
    const prog = this.shaders.get('particle');
    if (!prog || !this._particles.length) return;

    // Update particles
    const alive = [];
    for (const p of this._particles) {
      p.life -= 0.016;
      p.x += p.vx * 0.016;
      p.y += p.vy * 0.016;
      p.z += p.vz * 0.016;
      p.vy -= 2 * 0.016; // gravity
      if (p.type === 'smoke') p.size *= 1.02;
      p.color[3] = (p.life / p.maxLife) * 0.7;
      if (p.life > 0) alive.push(p);
    }
    this._particles = alive.slice(0, this._maxP);

    if (!this._particles.length) return;

    // Build quad data (billboard)
    const data = new Float32Array(this._particles.length * 4 * 9);
    let di = 0;
    const right = [1,0,0], up = [0,1,0];
    for (const p of this._particles) {
      const s = p.size;
      const corners = [[-s,-s],[s,-s],[-s,s],[s,s]];
      for (const [cx,cy] of corners) {
        data[di++] = p.x + right[0]*cx + up[0]*cy;
        data[di++] = p.y + right[1]*cx + up[1]*cy;
        data[di++] = p.z + right[2]*cx + up[2]*cy;
        data[di++] = cx > 0 ? 1 : 0;
        data[di++] = cy > 0 ? 1 : 0;
        data[di++] = p.color[0]; data[di++] = p.color[1];
        data[di++] = p.color[2]; data[di++] = p.color[3];
      }
    }

    gl.useProgram(prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog,'u_VP'), false, vpMatrix);
    gl.bindVertexArray(this._vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, this._particles.length * 4);
    gl.depthMask(true);
    gl.bindVertexArray(null);
  }
}

// ─── MATH HELPERS ─────────────────────────────────────────────────────────────

function _invertMat4(m) {
  const out = new Float32Array(16);
  const a00=m[0],a01=m[1],a02=m[2],a03=m[3];
  const a10=m[4],a11=m[5],a12=m[6],a13=m[7];
  const a20=m[8],a21=m[9],a22=m[10],a23=m[11];
  const a30=m[12],a31=m[13],a32=m[14],a33=m[15];
  const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10;
  const b03=a01*a12-a02*a11, b04=a01*a13-a03*a11, b05=a02*a13-a03*a12;
  const b06=a20*a31-a21*a30, b07=a20*a32-a22*a30, b08=a20*a33-a23*a30;
  const b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
  let det=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
  if (!det) return out;
  det = 1/det;
  out[0]=(a11*b11-a12*b10+a13*b09)*det; out[1]=(a02*b10-a01*b11-a03*b09)*det;
  out[2]=(a31*b05-a32*b04+a33*b03)*det; out[3]=(a22*b04-a21*b05-a23*b03)*det;
  out[4]=(a12*b08-a10*b11-a13*b07)*det; out[5]=(a00*b11-a02*b08+a03*b07)*det;
  out[6]=(a32*b02-a30*b05-a33*b01)*det; out[7]=(a20*b05-a22*b02+a23*b01)*det;
  out[8]=(a10*b10-a11*b08+a13*b06)*det; out[9]=(a01*b08-a00*b10-a03*b06)*det;
  out[10]=(a30*b04-a31*b02+a33*b00)*det;out[11]=(a21*b02-a20*b04-a23*b00)*det;
  out[12]=(a11*b07-a10*b09-a12*b06)*det;out[13]=(a00*b09-a01*b07+a02*b06)*det;
  out[14]=(a31*b01-a30*b03-a32*b00)*det;out[15]=(a20*b03-a21*b01+a22*b00)*det;
  return out;
}

function _buildOrthoShadowVP(lightDir, range) {
  const m    = new Float32Array(16);
  const [lx,ly,lz] = lightDir;
  const len  = Math.sqrt(lx*lx+ly*ly+lz*lz);
  const dx=lx/len, dy=ly/len, dz=lz/len;
  const r    = range;
  // Simple ortho projection
  m[0]=1/r; m[5]=1/r; m[10]=-2/1000; m[15]=1;
  return m;
}
