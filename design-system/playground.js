(function () {
  "use strict";

  var gate = document.getElementById("preview-gate");
  var form = document.getElementById("gate-form");
  var keyInput = document.getElementById("preview-key");
  var error = document.getElementById("gate-error");
  var playground = document.getElementById("playground");
  var motionToggle = document.getElementById("motion-toggle");
  var root = document.documentElement;
  var SESSION_KEY = "ingressible-design-preview";
  var EXPECTED_HASH = "235f53e5afcf22c7b9cf036994f3963f0dc9d3f2aba2797e59200359314d2caa";

  function showPlayground() {
    gate.hidden = true;
    playground.hidden = false;
    var heading = document.getElementById("hero-title");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus();
    }
  }

  function bytesToHex(bytes) {
    return Array.prototype.map.call(bytes, function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
  }

  async function digest(value) {
    var data = new TextEncoder().encode(value);
    var result = await window.crypto.subtle.digest("SHA-256", data);
    return bytesToHex(new Uint8Array(result));
  }

  try {
    if (sessionStorage.getItem(SESSION_KEY) === "granted") showPlayground();
  } catch (storageError) {
    /* A blocked storage API leaves the accessible gate available. */
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    error.hidden = true;
    var supplied = keyInput.value.trim();
    if (!supplied) {
      error.textContent = "Enter the preview phrase.";
      error.hidden = false;
      keyInput.focus();
      return;
    }

    try {
      if (await digest(supplied) === EXPECTED_HASH) {
        try { sessionStorage.setItem(SESSION_KEY, "granted"); } catch (storageError) {}
        showPlayground();
      } else {
        error.textContent = "The preview phrase does not match.";
        error.hidden = false;
        keyInput.select();
      }
    } catch (cryptoError) {
      error.textContent = "This browser cannot verify the preview phrase.";
      error.hidden = false;
    }
  });

  function setReduced(reduced) {
    root.setAttribute("data-motion", reduced ? "reduced" : "vivid");
    motionToggle.setAttribute("aria-pressed", reduced ? "true" : "false");
    motionToggle.textContent = reduced ? "Use full motion" : "Reduce motion";
  }

  var osReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  setReduced(osReduced);

  motionToggle.addEventListener("click", function () {
    setReduced(root.getAttribute("data-motion") !== "reduced");
  });
})();
