/**
 * TrackBuilder — Procedural Track Generator
 * Builds geometry, waypoints, collision data, and environment props
 * for all 10 stage environments:
 *  shipyard | downtown | forest | mountain | highway |
 *  coastal  | underground | airport | expressway | finalcircuit
 */

export class TrackBuilder {
  constructor(renderer) {
    this.renderer = renderer;
    this.gl       = renderer?.gl || null;
    this._cache   = new Map();   // trackId → built track data
  }

  async init() {
    // Pre-generate track splines (lightweight, no geometry yet)
    console.log('[TrackBuilder] Initialized ✓');
  }

  async build(event) {
    const trackId = event.track || 'downtown';
    const weather = event.weather || 'overcast';

    // Return cached if available
    const key = `${trackId}_${weather}`;
    if (this._cache.has(key)) return this._cache.get(key);

    console.log(`[TrackBuilder] Building: ${trackId} (${weather})`);

    const def       = TRACK_DEFS[trackId] || TRACK_DEFS.downtown;
    const spline    = this._generateSpline(def);
    const waypoints = this._splineToWaypoints(spline, 40);
    const mesh      = this._buildTrackMesh(spline, def, weather);
    const props     = this._buildEnvironmentProps(def, spline, weather);
    const pbs       = this._placePursuitBreakers(def, spline);

    const track = {
      id:           trackId,
      weather,
      spline,
      waypoints,
      meshes:       [...mesh.meshes, ...props.meshes],
      startPos:     waypoints[0] || [0, 0, 0],
      startHeading: this._waypointHeading(waypoints, 0),
      finishLine:   waypoints[waypoints.length - 1] || [0, 0, 100],
      pursuitBreakers: pbs,
      ambientLight: WEATHER_AMBIENT[weather] || WEATHER_AMBIENT.overcast,
      fogDensity:   WEATHER_FOG[weather]     || 0.002,
    };

    this._cache.set(key, track);
    return track;
  }

  // ─── SPLINE GENERATION ────────────────────────────────────────────────────

  _generateSpline(def) {
    const points   = [];
    const segments = def.segments || 20;
    const style    = def.style    || 'circuit';

    // Generate control points based on track style
    for (let i = 0; i < segments; i++) {
      const t   = i / segments;
      const pt  = def.generator(t, i, segments);
      points.push(pt);
    }

    // Close the loop for circuit
    if (style === 'circuit') points.push({...points[0]});

    return points;
  }

  _splineToWaypoints(spline, count) {
    const waypoints = [];
    for (let i = 0; i < count; i++) {
      const t   = i / count;
      const idx = Math.floor(t * (spline.length - 1));
      const p   = spline[idx] || spline[0];
      waypoints.push([p.x || 0, p.y || 0, p.z || 0]);
    }
    return waypoints;
  }

  _waypointHeading(waypoints, idx) {
    const a = waypoints[idx];
    const b = waypoints[(idx+1) % waypoints.length];
    if (!a || !b) return 0;
    return Math.atan2(b[0]-a[0], b[2]-a[2]);
  }

  // ─── TRACK MESH BUILDER ───────────────────────────────────────────────────

  _buildTrackMesh(spline, def, weather) {
    const meshes  = [];
    const roadW   = def.roadWidth || 12;
    const P=[], N=[], U=[], I=[];

    const isWet   = ['rain','storm'].includes(weather);

    for (let i = 0; i < spline.length - 1; i++) {
      const p0 = spline[i];
      const p1 = spline[i+1];

      const dx  = p1.x - p0.x, dz = p1.z - p0.z;
      const len = Math.sqrt(dx*dx+dz*dz) || 1;
      const rx  = -dz/len, rz = dx/len;   // right vector

      const base = P.length / 3;

      // Road quad
      const verts = [
        [p0.x - rx*roadW/2, p0.y, p0.z - rz*roadW/2],
        [p0.x + rx*roadW/2, p0.y, p0.z + rz*roadW/2],
        [p1.x - rx*roadW/2, p1.y, p1.z - rz*roadW/2],
        [p1.x + rx*roadW/2, p1.y, p1.z + rz*roadW/2],
      ];
      const uvs = [[0,i/spline.length],[1,i/spline.length],[0,(i+1)/spline.length],[1,(i+1)/spline.length]];

      for (let v = 0; v < 4; v++) {
        P.push(...verts[v]);
        N.push(0, 1, 0);
        U.push(...uvs[v]);
      }
      I.push(base,base+1,base+2, base+1,base+3,base+2);

      // Kerb strips (left/right, red/white alternating)
      const kW = 0.8;
      const kVerts = [
        [p0.x - rx*(roadW/2+kW), p0.y+0.02, p0.z - rz*(roadW/2+kW)],
        [p0.x - rx*roadW/2,      p0.y+0.02, p0.z - rz*roadW/2      ],
        [p1.x - rx*(roadW/2+kW), p1.y+0.02, p1.z - rz*(roadW/2+kW)],
        [p1.x - rx*roadW/2,      p1.y+0.02, p1.z - rz*roadW/2      ],
      ];
      const kBase = P.length/3;
      for (const kv of kVerts) { P.push(...kv); N.push(0,1,0); U.push(0,0); }
      I.push(kBase,kBase+1,kBase+2, kBase+1,kBase+3,kBase+2);
    }

    if (this.gl && P.length > 0) {
      const mesh = this._uploadMesh(P, N, U, I);
      const roadMat = {
        albedo:    [0.09, 0.085, 0.08],
        metallic:  0.0,
        roughness: isWet ? 0.05 : 0.92,
        wetFactor: isWet ? 0.9 : 0.0,
        sss:       0.3,  // concrete sub-surface scattering warmth
      };
      meshes.push({ mesh, material: roadMat, matrix: _identity() });
    }

    return { meshes };
  }

  // ─── ENVIRONMENT PROPS ───────────────────────────────────────────────────

  _buildEnvironmentProps(def, spline, weather) {
    const meshes = [];
    const propDefs = def.props || [];

    for (let i = 0; i < spline.length; i += 3) {
      const pt  = spline[i];
      for (const prop of propDefs) {
        if (Math.random() > prop.density) continue;
        const side  = Math.random() > 0.5 ? 1 : -1;
        const dx    = i < spline.length-1 ? spline[i+1].x - pt.x : 0;
        const dz    = i < spline.length-1 ? spline[i+1].z - pt.z : 0;
        const len   = Math.sqrt(dx*dx+dz*dz) || 1;
        const rx    = -dz/len, rz = dx/len;
        const dist  = (def.roadWidth||12)/2 + 3 + Math.random()*15;
        const px    = pt.x + rx*side*dist;
        const pz    = pt.z + rz*side*dist;

        if (this.gl) {
          const mesh = this._buildPropMesh(prop.type, weather);
          if (mesh) {
            meshes.push({
              mesh,
              material: prop.material || { albedo:[0.5,0.5,0.5], roughness:0.8 },
              matrix: _translationMatrix(px, pt.y, pz),
            });
          }
        }
      }
    }

    return { meshes };
  }

  _buildPropMesh(type, weather) {
    switch(type) {
      case 'pine_tree':    return this._buildTree(weather);
      case 'concrete_wall':return this._buildWall();
      case 'streetlight':  return this._buildStreetlight();
      case 'barrier':      return this._buildBarrier();
      default: return null;
    }
  }

  _buildTree(weather) {
    const P=[], N=[], U=[], I=[];
    const trunk_h = 2.5 + Math.random()*2;

    // Trunk cylinder
    const segs = 8;
    for (let s = 0; s <= 1; s++) {
      for (let i = 0; i <= segs; i++) {
        const a = (i/segs)*Math.PI*2;
        const r = s === 0 ? 0.18 : 0.12;
        P.push(Math.cos(a)*r, s*trunk_h, Math.sin(a)*r);
        N.push(Math.cos(a), 0, Math.sin(a));
        U.push(i/segs, s);
      }
    }
    for (let i=0;i<segs;i++) {
      const b=i, c=b+1, d=segs+1+i, e=d+1;
      I.push(b,d,c, c,d,e);
    }

    // Pine cone layers (3)
    const layerBase = P.length/3;
    for (let layer = 0; layer < 3; layer++) {
      const ly    = trunk_h * (0.4 + layer*0.22);
      const lr    = (1.6 - layer*0.45) * (0.9 + Math.random()*0.2);
      const ltop  = ly + 1.8 - layer*0.4;
      const base  = P.length/3;
      P.push(0, ltop, 0); N.push(0,1,0); U.push(0.5,0.5);
      for (let i = 0; i <= segs; i++) {
        const a = (i/segs)*Math.PI*2;
        P.push(Math.cos(a)*lr, ly, Math.sin(a)*lr);
        N.push(Math.cos(a)*0.7, 0.7, Math.sin(a)*0.7);
        U.push(i/segs, 0);
      }
      const tip = base;
      for (let i = 0; i < segs; i++) I.push(tip, base+i+1, base+i+2);
    }

    return this.gl ? this._uploadMesh(P, N, U, I) : null;
  }

  _buildWall() {
    const P=[],N=[],U=[],I=[];
    const W=0.3, H=2.2, D=6;
    const verts=[[-W/2,0,0],[W/2,0,0],[-W/2,H,0],[W/2,H,0],
                 [-W/2,0,D],[W/2,0,D],[-W/2,H,D],[W/2,H,D]];
    const faces=[[0,2,1,3],[4,5,6,7],[0,1,4,5],[2,6,3,7],[0,4,2,6],[1,3,5,7]];
    for(const f of faces){
      const b=P.length/3;
      for(const v of f){P.push(...verts[v]);N.push(0,0,1);U.push(0,0);}
      I.push(b,b+1,b+2,b+1,b+3,b+2);
    }
    return this.gl ? this._uploadMesh(P,N,U,I) : null;
  }

  _buildStreetlight() {
    const P=[],N=[],U=[],I=[];
    const poleH=8, poleR=0.08, armL=2, armR=0.06;
    // Pole
    for(let s=0;s<=1;s++){
      for(let i=0;i<=8;i++){
        const a=(i/8)*Math.PI*2;
        P.push(Math.cos(a)*poleR,s*poleH,Math.sin(a)*poleR);
        N.push(Math.cos(a),0,Math.sin(a));U.push(i/8,s);
      }
    }
    for(let i=0;i<8;i++){const b=i,c=b+1,d=9+i,e=d+1;I.push(b,d,c,c,d,e);}
    return this.gl ? this._uploadMesh(P,N,U,I) : null;
  }

  _buildBarrier() {
    const P=[-0.25,0,0, 0.25,0,0,-0.25,0.9,0, 0.25,0.9,0];
    const N=[0,0,1,0,0,1,0,0,1,0,0,1];
    const U=[0,0,1,0,0,1,1,1];
    const I=[0,1,2,1,3,2];
    return this.gl ? this._uploadMesh(P,N,U,I) : null;
  }

  _placePursuitBreakers(def, spline) {
    const pbs = [];
    const pbDefs = def.pursuitBreakers || [];
    for (let i = 0; i < pbDefs.length; i++) {
      const idx = Math.floor((i+1)/(pbDefs.length+1) * spline.length);
      const pt  = spline[idx] || spline[0];
      pbs.push({
        id:    `pb_${i}`,
        type:  pbDefs[i],
        pos:   [pt.x, pt.y, pt.z],
        radius:12,
        active:true,
      });
    }
    return pbs;
  }

  // ─── MESH UPLOAD ─────────────────────────────────────────────────────────

  _uploadMesh(P, N, U, I) {
    const gl  = this.gl;
    if (!gl)  return null;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    const normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(N), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(U), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(I), gl.STATIC_DRAW);

    gl.bindVertexArray(null);
    return { vao, indexCount: I.length };
  }
}

// ─── TRACK DEFINITIONS ────────────────────────────────────────────────────────

const TRACK_DEFS = {
  shipyard: {
    roadWidth: 14, style: 'circuit', segments: 28,
    generator: (t, i, n) => {
      const angle = t * Math.PI * 2;
      const r = 160 + Math.sin(angle*3)*40 + Math.cos(angle*5)*25;
      return { x: Math.cos(angle)*r, y: 0, z: Math.sin(angle)*r };
    },
    props: [
      { type:'concrete_wall', density:0.4, material:{ albedo:[0.45,0.42,0.40], roughness:0.95, sss:0.4 } },
      { type:'barrier',       density:0.6, material:{ albedo:[0.9,0.1,0.1],   roughness:0.8 } },
      { type:'streetlight',   density:0.3, material:{ albedo:[0.3,0.3,0.32],  roughness:0.5, metallic:0.8 } },
    ],
    pursuitBreakers: ['crane','water_tower','scaffold'],
  },
  downtown: {
    roadWidth: 16, style: 'circuit', segments: 32,
    generator: (t, i, n) => {
      // City block grid pattern
      const seg = Math.floor(t * 8);
      const st  = (t * 8) % 1;
      const dirs = [[1,0],[0,1],[-1,0],[0,-1],[1,0],[0,1],[-0.5,1],[0.5,0]];
      const d = dirs[seg % dirs.length];
      const prev = seg * 60;
      return { x: prev * d[0] + st*60*d[0], y:0, z: prev * d[1] + st*60*d[1] };
    },
    props: [
      { type:'concrete_wall', density:0.5, material:{ albedo:[0.38,0.36,0.35], roughness:0.9, sss:0.5 } },
      { type:'streetlight',   density:0.5, material:{ albedo:[0.25,0.25,0.28], roughness:0.4, metallic:0.9 } },
    ],
    pursuitBreakers: ['donut_stand','scaffold','newsstand'],
  },
  forest: {
    roadWidth: 10, style: 'circuit', segments: 36,
    generator: (t, i, n) => {
      const angle = t * Math.PI * 2;
      const noise = Math.sin(angle*7)*30 + Math.cos(angle*11)*20;
      const r = 180 + noise;
      return { x: Math.cos(angle)*r, y: Math.sin(angle*4)*2, z: Math.sin(angle)*r };
    },
    props: [
      { type:'pine_tree', density:0.7, material:{ albedo:[0.08,0.22,0.06], roughness:0.95 } },
      { type:'barrier',   density:0.3, material:{ albedo:[0.9,0.2,0.2],   roughness:0.8 } },
    ],
    pursuitBreakers: ['log_pile','rock_slide'],
  },
  mountain: {
    roadWidth: 9, style: 'point_to_point', segments: 40,
    generator: (t, i, n) => {
      const angle = t * Math.PI * 1.8;
      return {
        x: Math.cos(angle)*200 + Math.sin(angle*3)*60,
        y: t * 120 + Math.sin(angle*5)*8,
        z: Math.sin(angle)*200 + Math.cos(angle*2)*40,
      };
    },
    props: [
      { type:'barrier',   density:0.5, material:{ albedo:[0.9,0.2,0.2],   roughness:0.7 } },
      { type:'pine_tree', density:0.5, material:{ albedo:[0.06,0.18,0.04], roughness:0.95 } },
    ],
    pursuitBreakers: ['boulder','scaffold'],
  },
  highway: {
    roadWidth: 22, style: 'point_to_point', segments: 30,
    generator: (t, i, n) => ({
      x: Math.sin(t*Math.PI*2)*80 + Math.sin(t*Math.PI*6)*20,
      y: 0,
      z: t * 600,
    }),
    props: [
      { type:'streetlight', density:0.4, material:{ albedo:[0.3,0.3,0.3], roughness:0.5, metallic:0.8 } },
      { type:'barrier',     density:0.3, material:{ albedo:[0.85,0.85,0.2], roughness:0.8 } },
    ],
    pursuitBreakers: ['fuel_tanker','toll_booth'],
  },
  coastal:     { roadWidth:11, style:'circuit', segments:32, generator:(t)=>({ x:Math.cos(t*Math.PI*2)*200+Math.sin(t*Math.PI*8)*40, y:Math.sin(t*Math.PI*4)*3, z:Math.sin(t*Math.PI*2)*200 }), props:[], pursuitBreakers:['dock_crane'] },
  underground: { roadWidth:13, style:'circuit', segments:26, generator:(t)=>({ x:Math.cos(t*Math.PI*2)*120, y:-8+Math.sin(t*Math.PI*6)*4, z:Math.sin(t*Math.PI*2)*120 }), props:[], pursuitBreakers:['blast_door'] },
  airport:     { roadWidth:20, style:'circuit', segments:24, generator:(t)=>({ x:Math.cos(t*Math.PI*2)*180+Math.sin(t*Math.PI*4)*60, y:0, z:Math.sin(t*Math.PI*2)*180 }), props:[], pursuitBreakers:['baggage_cart'] },
  expressway:  { roadWidth:18, style:'circuit', segments:30, generator:(t)=>({ x:(t-0.5)*500+Math.sin(t*Math.PI*10)*30, y:Math.sin(t*Math.PI*5)*5, z:Math.cos(t*Math.PI*2)*150 }), props:[], pursuitBreakers:['overpass','billboard'] },
  finalcircuit:{ roadWidth:14, style:'circuit', segments:40, generator:(t)=>({ x:Math.cos(t*Math.PI*2)*220+Math.sin(t*Math.PI*6)*60, y:Math.sin(t*Math.PI*8)*6, z:Math.sin(t*Math.PI*2)*220 }), props:[], pursuitBreakers:['tower','fuel_depot','scaffold'] },
};

const WEATHER_AMBIENT = {
  overcast: [0.35, 0.38, 0.42],
  dusk:     [0.55, 0.35, 0.22],
  fog:      [0.60, 0.62, 0.65],
  clear:    [0.45, 0.48, 0.55],
  night:    [0.08, 0.08, 0.12],
  windy:    [0.40, 0.42, 0.48],
  rain:     [0.20, 0.22, 0.28],
  storm:    [0.12, 0.12, 0.18],
};

const WEATHER_FOG = {
  overcast:0.0015, dusk:0.002, fog:0.008, clear:0.0008,
  night:0.003, windy:0.001, rain:0.005, storm:0.009,
};

// ─── MATRIX HELPERS ───────────────────────────────────────────────────────────

function _identity() {
  return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
}

function _translationMatrix(x, y, z) {
  const m = _identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}
