import ShaderUtils from "../shaders/shaderUtils";

// Real-time adaptation of the Interstellar/DNGR black hole renderer
// (James, von Tunzelmann, Franklin & Thorne, "Gravitational Lensing by
// Spinning Black Holes in Astrophysics, and in the Movie Interstellar",
// Class. Quantum Grav. 32 (2015) 065001).
//
// DNGR traces ray bundles backward from the camera through the Kerr metric.
// Here we restrict to a non-spinning hole, where null geodesics reduce
// exactly (Binet equation u'' + u = (3/2) rs u^2) to the Cartesian ODE
//   d2x/dl2 = -(3/2) h^2 x / r^5,   h = |x × v| conserved,
// in units of the Schwarzschild radius rs = 1.
//
// All light in the scene is emitted by the pulse: a colossal storm of dots
// linked by electric lines (old Windows Media Player style) blazing far
// behind the hole. Every ray is traced through the geodesic integration, so
// the storm's light feels the gravitation — smeared into Einstein arcs
// around the shadow — before the preset's inward warp swallows it.
export default class BlackHole {
  constructor(gl, opts) {
    this.gl = gl;

    this.texsizeX = opts.texsizeX;
    this.texsizeY = opts.texsizeY;

    this.enabled = false;
    this.intensity = 0;

    // audio-driven state, smoothed on the JS side
    this.pulse = 0;
    this.smoothBass = 1;
    this.smoothMid = 1;
    this.smoothTreb = 1;

    this.positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    this.vertexBuf = this.gl.createBuffer();

    this.floatPrecision = ShaderUtils.getFragmentFloatPrecision(this.gl);
    this.createShader();
  }

  updateGlobals(opts) {
    this.texsizeX = opts.texsizeX;
    this.texsizeY = opts.texsizeY;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  createShader() {
    this.shaderProgram = this.gl.createProgram();

    const vertShader = this.gl.createShader(this.gl.VERTEX_SHADER);
    this.gl.shaderSource(
      vertShader,
      `#version 300 es
       const vec2 halfmad = vec2(0.5);
       in vec2 aPos;
       out vec2 uv;
       void main(void) {
         gl_Position = vec4(aPos, 0.0, 1.0);
         uv = aPos * halfmad + halfmad;
       }`
    );
    this.gl.compileShader(vertShader);

    if (!this.gl.getShaderParameter(vertShader, this.gl.COMPILE_STATUS)) {
      console.error(
        "BlackHole vertex shader failed to compile:",
        this.gl.getShaderInfoLog(vertShader)
      );
    }

    const fragShader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
    this.gl.shaderSource(
      fragShader,
      `#version 300 es
       precision highp float;
       precision highp int;
       precision mediump sampler2D;

       in vec2 uv;
       out vec4 fragColor;

       uniform vec4 texsize;
       uniform float uTime;
       uniform float uIntensity;
       uniform float uPulse;
       uniform vec3 uTint;
       uniform sampler2D uBackground;

       // units: Schwarzschild radius rs = 1, so M = 1/2
       const float HORIZON = 1.0;
       const float CAM_DIST = 16.5;
       const float FOCAL = 1.7;
       const float ESCAPE_R = 40.0;
       const int   STEPS = 96;

       // accretion disk span: ISCO to outer edge, in rs units
       const float DISK_IN = 3.0;
       const float DISK_OUT = 12.0;

       // fixed upside-down view with a 20-degree disk-plane tilt
       const float ROLL = 3.14159265 + 0.34906585;

       float hash12(vec2 p) {
         vec3 p3 = fract(vec3(p.xyx) * 0.1031);
         p3 += dot(p3, p3.yzx + 33.33);
         return fract((p3.x + p3.y) * p3.z);
       }

       float sdSegment(vec2 p, vec2 a, vec2 b) {
         vec2 pa = p - a;
         vec2 ba = b - a;
         float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
         return length(pa - ba * h);
       }

       // Accretion disk painted by the source itself: the crossing point
       // samples the preset's frame in Kepler-sheared polar coordinates, so
       // the disk's glow is literally the preset's light dragged around the
       // hole, then beamed by the (approximate) relativistic Doppler factor.
       vec3 diskEmission(vec3 pos, vec3 dir) {
         float r = length(pos.xz);
         if (r < DISK_IN || r > DISK_OUT) {
           return vec3(0.0);
         }

         float phi = atan(pos.z, pos.x);
         // Omega = sqrt(M/r^3), M = 1/2: differential Keplerian rotation
         float omega = inversesqrt(2.0 * r * r * r);
         float x = (r - DISK_IN) / (DISK_OUT - DISK_IN);

         // co-rotating azimuth: a feature at constant co orbits at Omega(r)
         float co = phi - omega * uTime * 6.0;

         // nothing procedural: structure and light both come from the frame
         // behind the hole. A fine co-rotating tap carries the frame's own
         // grain -- each radius orbits at its own Omega, so that pattern
         // shears into disk texture -- and a wide mip tap adds the
         // integrated glow of everything the shadow occludes.
         vec2 srcUV = vec2(0.5) + vec2(cos(co), sin(co)) * (0.06 + 0.3 * x);
         vec3 fine = texture(uBackground, srcUV).rgb;
         vec3 wide = textureLod(uBackground, srcUV, 3.5).rgb;
         vec3 src = fine * 1.4 + wide * 0.6;

         // emissivity ~ T^4 ~ r^-3 (Shakura-Sunyaev): dense, hot inner disk
         float bright = pow(DISK_IN / r, 2.2) * smoothstep(0.0, 0.045, x)
           * smoothstep(1.0, 0.82, x) * 5.5;

         // grazing rays cross more of the thin disk: path length ~ 1/|cos|
         float grazing = clamp(0.35 / max(abs(dir.y), 0.06), 1.0, 6.0);
         bright *= grazing;

         // disk material circular velocity: beta = sqrt(M/r)/sqrt(1 - 2M/r)
         float beta = min(
           inversesqrt(2.0 * r) * inversesqrt(1.0 - 1.0 / r),
           0.99
         );
         vec3 vDir = normalize(vec3(-pos.z, 0.0, pos.x));
         float gGrav = sqrt(max(0.0, 1.0 - 1.0 / r));
         float gDopp = sqrt(1.0 - beta * beta)
           / (1.0 - beta * dot(vDir, dir));
         float g = gGrav * gDopp;

         // no self-emission: the disk only re-radiates the light behind it,
         // filtered (not fed) by the music tint
         return src * mix(vec3(1.0), uTint, 0.4) * 1.4 * bright
           * pow(g, 2.0) * (0.7 + 0.6 * uPulse);
       }

       // The pulse: a colossal storm of dots linked by electric lines far
       // behind the hole, flashing with the beat. q is the gnomonic
       // (direction-space) coordinate of the escaped ray, so this light
       // has felt the full gravitational deflection on its way in.
       vec3 stormLight(vec2 q) {
         float seed = floor(uTime * 6.0);
         const int NP = 14;
         vec2 pts[NP];
         for (int i = 0; i < NP; i++) {
           float fi = float(i);
           float a = 6.2831853 * fi / float(NP)
             + 0.9 * hash12(vec2(seed, fi));
           float rad = (0.6 + 2.6 * hash12(vec2(fi + 31.0, seed)))
             * (0.8 + 0.4 * uPulse);
           pts[i] = vec2(cos(a), sin(a)) * rad;
         }
         float storm = 0.0;
         for (int i = 0; i < NP; i++) {
           vec2 p1 = pts[i];
           vec2 p2 = pts[(i + 1) % NP];
           vec2 p3 = pts[(i + 5) % NP];
           float gate = step(0.35, hash12(vec2(seed + 7.0, float(i))));
           float dl = min(sdSegment(q, p1, p2), sdSegment(q, p1, p3));
           storm += gate * exp(-dl * 22.0) * 0.6;
           storm += exp(-length(q - p1) * 14.0) * 1.4;
         }
         return uTint * storm * (0.15 + 1.2 * uPulse);
       }

       void main(void) {
         float aspect = texsize.x / texsize.y;
         vec2 s = uv * 2.0 - 1.0;
         s.x *= aspect;

         // slow orbit around the hole, camera near the equatorial plane
         float az = uTime * 0.04;
         float el = 0.045 + 0.02 * sin(uTime * 0.11);
         vec3 ro = CAM_DIST * vec3(
           cos(el) * cos(az),
           sin(el),
           cos(el) * sin(az)
         );

         vec3 fwd = normalize(-ro);
         vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
         vec3 up = cross(right, fwd);

         float rc = cos(ROLL);
         float rs = sin(ROLL);
         vec3 rolledRight = right * rc + up * rs;
         up = -right * rs + up * rc;
         right = rolledRight;

         float focal = FOCAL * (1.0 + 0.03 * uPulse);
         vec3 rd = normalize(fwd * focal + right * s.x + up * s.y);

         // integrate d2x/dl2 = -1.5 h^2 x / r^5 (symplectic Euler)
         vec3 pos = ro;
         vec3 vel = rd;
         vec3 hv = cross(pos, vel);
         float h2 = dot(hv, hv);

         vec3 emission = vec3(0.0);
         float transmit = 1.0;
         bool captured = false;

         float prevY = pos.y;
         vec3 prevPos = pos;

         for (int i = 0; i < STEPS; i++) {
           float r = length(pos);
           if (r > ESCAPE_R && dot(pos, vel) > 0.0) {
             break;
           }
           if (r < HORIZON * 1.02) {
             captured = true;
             break;
           }

           // finer steps deep in the potential well
           float dt = 0.16 + 0.11 * max(r - 2.0, 0.0);

           vec3 accel = -1.5 * h2 * pos / pow(r * r, 2.5);
           vel += accel * dt;
           pos += vel * dt;

           // equatorial plane crossing -> lensed accretion disk sample
           if (prevY * pos.y < 0.0 && transmit > 0.02) {
             float f = prevY / (prevY - pos.y);
             vec3 hit = mix(prevPos, pos, f);
             vec3 dirToCam = -normalize(vel);
             emission += diskEmission(hit, dirToCam) * transmit;
             transmit *= 0.55;
           }

           prevY = pos.y;
           prevPos = pos;
         }

         vec3 col = emission;

         if (!captured) {
           vec3 dir = normalize(vel);
           float bx = dot(dir, right);
           float by = dot(dir, up);
           float bz = dot(dir, fwd);

           // gnomonic projection; strongly bent rays (bz small or negative)
           // are clamped so every escaped direction still lands on light
           vec2 q = vec2(bx, by) / max(bz, 0.05);
           col += stormLight(q);

           // the source preset fills the whole sky behind the hole: every
           // photon it emits reaches us on a bent geodesic. Mirror-wrap the
           // frame so rays deflected past its edges keep sampling light
           // instead of leaving offset dark circles around the shadow
           vec2 buv = q * focal;
           vec2 backUV = vec2((buv.x / aspect) * 0.5 + 0.5, buv.y * 0.5 + 0.5);
           backUV = abs(fract(backUV * 0.5) * 2.0 - 1.0);
           col += texture(uBackground, backUV).rgb;
         }

         fragColor = vec4(col, uIntensity);
       }`
    );
    this.gl.compileShader(fragShader);

    if (!this.gl.getShaderParameter(fragShader, this.gl.COMPILE_STATUS)) {
      console.error(
        "BlackHole fragment shader failed to compile:",
        this.gl.getShaderInfoLog(fragShader)
      );
    }

    this.gl.attachShader(this.shaderProgram, vertShader);
    this.gl.attachShader(this.shaderProgram, fragShader);
    this.gl.linkProgram(this.shaderProgram);

    if (!this.gl.getProgramParameter(this.shaderProgram, this.gl.LINK_STATUS)) {
      console.error(
        "BlackHole program failed to link:",
        this.gl.getProgramInfoLog(this.shaderProgram)
      );
    }

    this.positionLocation = this.gl.getAttribLocation(
      this.shaderProgram,
      "aPos"
    );
    this.texsizeLoc = this.gl.getUniformLocation(this.shaderProgram, "texsize");
    this.timeLoc = this.gl.getUniformLocation(this.shaderProgram, "uTime");
    this.intensityLoc = this.gl.getUniformLocation(
      this.shaderProgram,
      "uIntensity"
    );
    this.pulseLoc = this.gl.getUniformLocation(this.shaderProgram, "uPulse");
    this.tintLoc = this.gl.getUniformLocation(this.shaderProgram, "uTint");
    this.backgroundLoc = this.gl.getUniformLocation(
      this.shaderProgram,
      "uBackground"
    );
  }

  updateAudio(audioLevels, fps) {
    const effectiveFPS = Number.isFinite(fps) && fps > 15 ? fps : 30;
    const smooth = (prev, next, rate) => {
      const adjRate = rate ** (30 / effectiveFPS);
      return prev * adjRate + next * (1 - adjRate);
    };

    this.smoothBass = smooth(this.smoothBass, audioLevels.bass_att, 0.85);
    this.smoothMid = smooth(this.smoothMid, audioLevels.mid_att, 0.85);
    this.smoothTreb = smooth(this.smoothTreb, audioLevels.treb_att, 0.85);

    // bass hits above the running average kick the pulse, then it decays
    this.pulse *= 0.94 ** (30 / effectiveFPS);
    const kick = audioLevels.bass - 1.15;
    if (kick > 0) {
      this.pulse = Math.max(this.pulse, Math.min(kick * 1.2, 1.0));
    }

    const fadeRate = 0.92 ** (30 / effectiveFPS);
    const target = this.enabled ? 1 : 0;
    this.intensity = this.intensity * fadeRate + target * (1 - fadeRate);
  }

  // storm light color follows the spectrum: bass warms the reds, mid feeds
  // the greens/yellows, treble pushes toward blue-white
  getTint() {
    const b = Math.max(this.smoothBass, 0);
    const m = Math.max(this.smoothMid, 0);
    const t = Math.max(this.smoothTreb, 0);
    const total = b + m + t + 1e-6;

    const r = 0.55 + 0.75 * (b / total);
    const g = 0.45 + 0.7 * (m / total);
    const bl = 0.35 + 0.85 * (t / total);
    const maxC = Math.max(r, g, bl);
    return [r / maxC, g / maxC, bl / maxC];
  }

  drawBlackHole(time, backgroundTexture) {
    if (this.intensity < 0.01) {
      return;
    }

    this.gl.useProgram(this.shaderProgram);

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuf);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      this.positions,
      this.gl.STATIC_DRAW
    );

    this.gl.vertexAttribPointer(
      this.positionLocation,
      2,
      this.gl.FLOAT,
      false,
      0,
      0
    );
    this.gl.enableVertexAttribArray(this.positionLocation);

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, backgroundTexture);
    this.gl.uniform1i(this.backgroundLoc, 0);

    this.gl.uniform4fv(
      this.texsizeLoc,
      new Float32Array([
        this.texsizeX,
        this.texsizeY,
        1.0 / this.texsizeX,
        1.0 / this.texsizeY,
      ])
    );
    this.gl.uniform1f(this.timeLoc, time);
    this.gl.uniform1f(this.intensityLoc, this.intensity);
    this.gl.uniform1f(this.pulseLoc, this.pulse);
    this.gl.uniform3fv(this.tintLoc, new Float32Array(this.getTint()));

    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }
}
