/* Moon display for the clocks. SunCalc is vendored in assets/vendor/suncalc.js. */

const MOON_LOCATION = {
  name: "Berlin",
  latitude: 52.52,
  longitude: 13.405
};

function describeMoon(phase, fraction) {
  const percentage = Math.round(fraction * 100);
  let name;

  if (percentage <= 1) name = "Neumond";
  else if (percentage >= 99) name = "Vollmond";
  else if (phase < 0.5) {
    name = percentage < 48 ? "Zunehmende Sichel" : percentage <= 52 ? "Zunehmender Halbmond" : "Zunehmender Mond";
  } else {
    name = percentage < 48 ? "Abnehmende Sichel" : percentage <= 52 ? "Abnehmender Halbmond" : "Abnehmender Mond";
  }

  return name + " – " + percentage + " % beleuchtet";
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
  const symbol = document.createElement("span");
  symbol.className = "moon-phase";
  symbol.setAttribute("role", "img");
  symbol.title = "Mondphase für " + location.name;
  container.appendChild(symbol);

  function render() {
    const state = getMoonState(new Date(), location);
    symbol.setAttribute("aria-label", state.label);
    symbol.title = state.label;
    symbol.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<circle class="moon-phase__shadow" cx="12" cy="12" r="10"></circle>' +
        '<g transform="rotate(' + state.rotation.toFixed(2) + ' 12 12)">' +
          '<path class="moon-phase__light" d="' + moonPath(state.fraction, state.waxing) + '"></path>' +
        '</g>' +
        '<circle class="moon-phase__rim" cx="12" cy="12" r="10"></circle>' +
      '</svg>';
  }

  render();
  window.setInterval(render, 60 * 1000);
}
