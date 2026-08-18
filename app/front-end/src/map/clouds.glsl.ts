/* The cloud shader, rev 6. Kept as a string in its own module rather than
   inline in the component, so the GLSL is readable as GLSL and the React
   file stays about lifecycle.

   Technique is Inigo Quilez's dynamic-clouds method
   (https://iquilezles.org/articles/dynclouds/): four octaves of value noise
   at halving weights, each advected at its own speed so the fractal keeps
   its structure instead of sliding as one rigid sheet, then a threshold
   remap of density into alpha.

   Deliberately NOT volumetric raymarching. That is the photoreal way to do
   this (Worley plus Perlin, Beer-Lambert absorption, a phase function), and
   it would mean a 3D shader inside the scene, which is the second render
   stack this project has turned down twice. It would also look wrong:
   photoreal cloud over a flat-shaded vector city reads as two different
   pictures. */

export const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

export const FRAG = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform float uTime;      // seconds
uniform vec2  uRes;
uniform vec3  uCloud;     // cloud body colour, from --ink-soft
uniform vec3  uFog;       // distance haze colour, from --paper
uniform float uCoverage;  // 0 = overcast, 1 = clear
uniform float uOpacity;
uniform float uWind;      // multiplier on every octave's drift

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

/* Value noise with a smoothstep fade. Cheaper than gradient noise and
   indistinguishable once four octaves are stacked and blurred by the
   threshold remap below. */
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

/* Four octaves, weights 0.5 / 0.25 / 0.125 / 0.0625, each drifting faster
   than the last. The differing speeds are the whole trick: equal speeds
   translate one frozen shape across the screen, which reads as a printed
   sheet being dragged. Normalised by the weight sum so the result is 0..1. */
float fbm(vec2 p) {
  float t = uTime * uWind;
  float v = 0.0;
  v += 0.5000 * noise(p * 1.0 + vec2(t * 0.010, t * 0.004));
  v += 0.2500 * noise(p * 2.0 + vec2(t * 0.021, t * 0.009));
  v += 0.1250 * noise(p * 4.0 + vec2(t * 0.044, t * 0.017));
  v += 0.0625 * noise(p * 8.0 + vec2(t * 0.092, t * 0.035));
  return v / 0.9375;
}

void main() {
  vec2 uv = vUv;
  uv.x *= uRes.x / uRes.y;   // keep the noise square on any viewport

  /* A cloud deck lying flat between the camera and the ground, seen from a
     pitched camera, so it recedes toward the top of the frame. Dividing by
     the distance to the top edge is the standard infinite-plane projection
     and gives the convergence for free.

     Approximation, and worth naming: the real mapping depends on the
     camera's pitch and field of view. This assumes both are fixed, which
     they are here (pitch is one of two button-set values and every rotate
     gesture is disabled), so a screen-space stand-in holds. If the camera
     ever becomes continuous, this is the line that has to become real. */
  float horizon = max(0.08, 1.0 - vUv.y);
  vec2 deck = vec2(uv.x / horizon, 1.0 / horizon) * 1.6;

  float density = fbm(deck);

  // Threshold remap: everything under uCoverage is clear sky, the rest is
  // rescaled to fill 0..1 so the surviving cloud keeps its full range
  // instead of being a washed-out top slice of the noise.
  density = clamp((density - uCoverage) / max(0.001, 1.0 - uCoverage), 0.0, 1.0);
  density = smoothstep(0.0, 0.7, density);

  /* Two fades, both needed:
     - near: the deck passes under the camera at the bottom of the frame, so
       cloud there would be a smear across the foreground rather than
       something the viewer is looking through.
     - far: at the top the deck compresses toward a singularity, and without
       this the noise aliases into a hard band. */
  float near = smoothstep(0.0, 0.42, vUv.y);
  float far = 1.0 - smoothstep(0.72, 1.0, vUv.y);
  density *= near * far;

  /* Distance haze, independent of the cloud: the far half of the frame
     fades toward the ground colour so the city recedes instead of staying
     equally crisp to the top of the screen. This is the part that actually
     reads as depth. */
  float haze = smoothstep(0.35, 1.0, vUv.y) * 0.55;

  // Cloud over haze, one premultiplied result. The cloud's own alpha is
  // additive on top of the haze so an overcast patch still darkens.
  float alpha = clamp(haze + density * uOpacity, 0.0, 1.0);
  vec3 rgb = mix(uFog, uCloud, density);

  outColor = vec4(rgb, alpha);
}`
