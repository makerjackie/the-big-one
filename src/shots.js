// THE BIG ONE — story beats and shot list.
// A tiny robot fisherman dozes in a little red boat on a blazing summer sea.
// Something bites. The boat is towed across the ocean by something enormous;
// it is the Lord of the Sea . It rises, looks at the little robot... and
// later hands back the straw hat it blew away, on the hook. Then it waves goodbye.

export const FPS = 24;
export const DURATION = 39.0;

// Story beats in film seconds. Picture and sound both lock to these.
export const CUES = {
  titleIn: 0.6, titleOut: 3.8,
  nod1: 5.2, nod2: 6.4,          // robot's head nods while dozing
  nibble: 8.1,                   // bobber dips once
  bite: 8.9,                     // bobber plunges under
  jolt: 9.7,                     // robot jolts awake, "!" pops
  reel: 10.0,                    // reel starts screaming, boat starts to move
  tow: 12.0,                     // boat towed at speed (aerial)
  below: 15.6,                   // cut underwater
  eye: 16.8,                     // the giant eye glides into view
  look: 17.8,                    // the eye turns up to look at the boat
  calm: 19.0,                    // the line goes slack, the sea goes still
  bubbles: 20.2,                 // bubbles boil up around the boat
  rise: 21.4,                    // the Lord breaches, head rising out of the sea
  hatOff: 23.2,                  // the robot's straw hat is blown away
  peak: 24.6,                    // head at full height, water sheeting off
  blink: 26.7,                   // giant eye blinks (CU)
  gulp: 28.0,                    // robot gulps, sweat drop
  topple: 28.8,                  // the Lord leans back and falls
  splash: 30.6,                  // its body hits the sea: giant splash
  wave: 31.8,                    // the boat climbs the swell
  air: 33.2,                     // the boat flies off the crest
  land: 33.9,                    // smack down
  hat: 35.6,                     // the hat comes up out of the sea on the hook
  hatOn: 36.8,                   // the robot puts the hat back on
  farewell: 37.2,                // a distant fluke rises and waves
  fin: 37.6,                     // end card
};

// Shots: [id, name, start, end, set]. Sets: sea (above water), under.
export const SHOTS = [
  ['s01', 'open', 0.0, 4.2, 'sea'],
  ['s02', 'fisher', 4.2, 7.4, 'sea'],
  ['s03', 'bobber', 7.4, 9.6, 'sea'],
  ['s04', 'strike', 9.6, 12.0, 'sea'],
  ['s05', 'towed', 12.0, 15.6, 'sea'],
  ['s06', 'below', 15.6, 19.0, 'under'],
  ['s07', 'calm', 19.0, 21.0, 'sea'],
  ['s08', 'rise', 21.0, 26.0, 'sea'],
  ['s09', 'eye', 26.0, 27.6, 'sea'],
  ['s10', 'react', 27.6, 28.8, 'sea'],
  ['s11', 'dive', 28.8, 31.8, 'sea'],
  ['s12', 'wave', 31.8, 34.4, 'sea'],
  ['s13', 'catch', 34.4, 39.0, 'sea'],
].map(([id, name, t0, t1, set]) => ({ id, name, t0, t1, set }));

export function shotAt(t) {
  for (const s of SHOTS) if (t >= s.t0 && t < s.t1) return s;
  return SHOTS[SHOTS.length - 1];
}
