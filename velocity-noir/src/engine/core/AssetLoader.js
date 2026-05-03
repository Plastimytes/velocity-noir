/**
 * AssetLoader — LOD streaming, texture atlas management
 * Handles progressive loading so 300 km/h sprints
 * don't bottleneck the GPU with full-res assets.
 */

export class AssetLoader {
  constructor(gl) {
    this.gl       = gl;
    this._textures = new Map();
    this._pending  = new Map();
    this._queue    = [];
    this._loading  = 0;
    this._maxConcurrent = 4;
  }

  // ─── TEXTURE LOADING ─────────────────────────────────────────────────────

  async loadTexture(url, options = {}) {
    if (this._textures.has(url)) return this._textures.get(url);

    return new Promise((resolve) => {
      this._queue.push({ url, options, resolve });
      this._processQueue();
    });
  }

  _processQueue() {
    while (this._loading < this._maxConcurrent && this._queue.length > 0) {
      const item = this._queue.shift();
      this._loading++;
      this._loadOne(item).then(() => {
        this._loading--;
        this._processQueue();
      });
    }
  }

  async _loadOne({ url, options, resolve }) {
    const gl = this.gl;

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((res, rej) => {
        img.onload  = res;
        img.onerror = rej;
        img.src     = url;
      });

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

      if (options.mipmap !== false) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }

      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, options.wrap ?? gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, options.wrap ?? gl.REPEAT);

      // Anisotropic filtering if available
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (ext) {
        const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
        gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
      }

      gl.bindTexture(gl.TEXTURE_2D, null);
      this._textures.set(url, tex);
      resolve(tex);
    } catch(e) {
      console.warn('[AssetLoader] Failed to load:', url);
      resolve(this._createFallbackTexture(options.fallbackColor || [255,0,255,255]));
    }
  }

  // ─── LOD STREAMING ───────────────────────────────────────────────────────

  /**
   * Returns the appropriate LOD mesh based on distance from camera.
   * LOD 0: full detail (< 80m)
   * LOD 1: half detail (80-200m)
   * LOD 2: quarter detail (> 200m)
   */
  selectLOD(meshLODs, distanceFromCamera) {
    if (!meshLODs || meshLODs.length === 0) return null;
    if (distanceFromCamera < 80)  return meshLODs[0];
    if (distanceFromCamera < 200) return meshLODs[Math.min(1, meshLODs.length-1)];
    return meshLODs[meshLODs.length-1];
  }

  // ─── PROCEDURAL TEXTURES ─────────────────────────────────────────────────

  createProceduralTexture(type, size = 256) {
    const gl   = this.gl;
    const data = new Uint8Array(size * size * 4);

    switch(type) {
      case 'asphalt':   this._genAsphalt(data, size);   break;
      case 'concrete':  this._genConcrete(data, size);  break;
      case 'rust':      this._genRust(data, size);      break;
      case 'carbon':    this._genCarbon(data, size);    break;
      default:          this._genChecker(data, size);
    }

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  _genAsphalt(data, size) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i   = (y*size+x)*4;
        const n   = this._noise2D(x*0.05, y*0.05) * 0.5 + 0.5;
        const n2  = this._noise2D(x*0.15, y*0.15) * 0.5 + 0.5;
        const val = Math.floor((0.07 + n*0.04 + n2*0.02)*255);
        data[i]=val; data[i+1]=val; data[i+2]=val; data[i+3]=255;
      }
    }
  }

  _genConcrete(data, size) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i  = (y*size+x)*4;
        const n  = this._noise2D(x*0.03, y*0.03)*0.5+0.5;
        const val= Math.floor((0.55+n*0.15)*255);
        data[i]=val; data[i+1]=Math.floor(val*0.97); data[i+2]=Math.floor(val*0.93); data[i+3]=255;
      }
    }
  }

  _genRust(data, size) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i  = (y*size+x)*4;
        const n  = this._noise2D(x*0.08, y*0.08)*0.5+0.5;
        data[i]=Math.floor((0.5+n*0.4)*255); data[i+1]=Math.floor((0.2+n*0.15)*255);
        data[i+2]=Math.floor(n*0.05*255); data[i+3]=255;
      }
    }
  }

  _genCarbon(data, size) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i  = (y*size+x)*4;
        const cx = x % 8, cy = y % 8;
        const fiber = (cx > 3) === (cy > 3) ? 0.2 : 0.05;
        const sheen = (cx===4||cx===0) && (cy===4||cy===0) ? 0.3 : 0;
        const val= Math.floor((fiber+sheen)*255);
        data[i]=val; data[i+1]=val; data[i+2]=Math.floor(val*1.05); data[i+3]=255;
      }
    }
  }

  _genChecker(data, size) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y*size+x)*4;
        const v = ((Math.floor(x/32)+Math.floor(y/32))%2)*255;
        data[i]=v; data[i+1]=v; data[i+2]=v; data[i+3]=255;
      }
    }
  }

  _noise2D(x, y) {
    return Math.sin(x*127.1+y*311.7)*43758.5 % 1;
  }

  _createFallbackTexture(color) {
    const gl  = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(color));
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  get(url) { return this._textures.get(url) || null; }

  dispose(url) {
    const tex = this._textures.get(url);
    if (tex) { this.gl.deleteTexture(tex); this._textures.delete(url); }
  }
}
