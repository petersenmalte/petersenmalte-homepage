/* Moon display for the clocks. SunCalc is vendored in assets/vendor/suncalc.js.
   The symbol links to SunMoonEarth, a separate 3D application in its own
   repository. Only the anchor lives here: the homepage loads none of its code. */

const APP_URL = "https://lunarcompass.app/";
const APP_NAME = "SunMoonEarth";

const MOON_LOCATION = {
  name: "Berlin",
  latitude: 52.52,
  longitude: 13.405
};

function describeMoon(phase, fraction) {
  const percentage = Math.round(fraction * 100);
  let name;

  if (percentage <= 1) name = "New moon";
  else if (percentage >= 99) name = "Full moon";
  else if (phase < 0.5) {
    name = percentage < 48 ? "Waxing crescent" : percentage <= 52 ? "First quarter" : "Waxing moon";
  } else {
    name = percentage < 48 ? "Waning crescent" : percentage <= 52 ? "Last quarter" : "Waning moon";
  }

  return name + " – " + percentage + "% illuminated";
}

function moonPath(fraction, waxing) {
  const terminatorX = 12 + (waxing ? 1 : -1) * 10 * (1 - 2 * fraction);
  const outerArc = waxing ? "A 10 10 0 0 1 12 22" : "A 10 10 0 0 0 12 22";
  return "M 12 2 " + outerArc + " Q " + terminatorX.toFixed(3) + " 12 12 2 Z";
}

export function getMoonState(date = new Date(), location = MOON_LOCATION) {
  const illumination = window.SunCalc.getMoonIllumination(date);
  const moonPosition = window.SunCalc.getMoonPosition(date, location.latitude, location.longitude);
  const waxing = illumination.phase < 0.5;

  return {
    fraction: illumination.fraction,
    waxing,
    label: describeMoon(illumination.phase, illumination.fraction),
    // SunCalc yields the bright-limb zenith angle anticlockwise. SVG rotates
    // clockwise from its positive x-axis, so invert it and offset right → up.
    rotation: -(illumination.angle - moonPosition.parallacticAngle) * 180 / Math.PI - 90
  };
}

export function mountMoonPhaseSymbol(container, location = MOON_LOCATION) {
  // An anchor, not a span: same tab, keyboard reachable without tabindex,
  // and it carries the moon phase in its accessible name.
  const symbol = document.createElement("a");
  symbol.className = "moon-phase";
  symbol.href = APP_URL;
  symbol.setAttribute("aria-describedby", "moon-phase-tooltip");
  container.appendChild(symbol);

  function render() {
    const state = getMoonState(new Date(), location);
    const label = state.label + " \u00B7 open " + APP_NAME;
    symbol.setAttribute("aria-label", label);
    symbol.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<circle class="moon-phase__shadow" cx="12" cy="12" r="10"></circle>' +
        '<g transform="rotate(' + state.rotation.toFixed(2) + ' 12 12)">' +
          '<path class="moon-phase__light" d="' + moonPath(state.fraction, state.waxing) + '"></path>' +
        '</g>' +
        '<circle class="moon-phase__rim" cx="12" cy="12" r="10"></circle>' +
      '</svg>' +
      '<span id="moon-phase-tooltip" class="moon-phase__tooltip" role="tooltip">' + label + '</span>';
  }

  render();
  window.setInterval(render, 60 * 1000);
}
