// Built-in preset wrapping the Interstellar-style black hole renderer.
// The blackHole flag turns on the geodesic raymarcher for this preset only.
// The warp equations pull the frame inward (zoom < 1), so light emitted by
// the pulsing disk and photon-ring corona streams toward the hole and is
// absorbed by the shadow; bass hits deepen the pull and flare the corona.
const blackHolePreset = {
  name: "interstellar - gargantua",
  blackHole: true,
  baseVals: {
    decay: 0.97,
    gammaadj: 1.2,
    warp: 0.08,
    warpscale: 1.4,
    zoom: 0.987,
    zoomexp: 1.0,
    rot: 0.015,
    cx: 0.5,
    cy: 0.5,
    wave_a: 0,
    bmotionvectorson: 0,
    wrap: 0,
    ob_a: 0,
    ib_a: 0,
  },
  init_eqs_str: "",
  frame_eqs_str:
    "a.zoom = 0.987 - 0.014 * Math.min(a.bass_att, 2.0);" +
    "a.rot = 0.02 + 0.012 * Math.min(a.mid_att, 2.0);",
  pixel_eqs_str:
    "a.zoom = a.zoom - 0.05 * Math.max(0.65 - a.rad, 0.0);",
  waves: [],
  shapes: [],
  warp: "",
  comp: "",
};

export default blackHolePreset;
