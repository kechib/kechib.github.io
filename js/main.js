/* ==========================================================================
   Ingressible — site interactions
   Purpose: small, purposeful, accessibility-first.
   Dependencies: js/vendor/motion.js (window.Motion), vendored locally.
   Motion policy: two equal experiences — "Vivid" and "No motion".
     * Vivid  = coordinated, expressive animation (default, follows OS
                setting when the visitor has made no explicit choice).
     * No motion = all nonessential animation removed. Content, color,
                composition, and functionality stay identical.
     * The site control stops all nonessential CSS/JS animation.
     * Applies on <html data-motion="vivid|reduced">; CSS + JS honor it.
     * Stored in localStorage where available; fails safely (follow OS)
       and keeps the page fully usable when JS or storage fail.
   ========================================================================== */

(function () {
  "use strict";

  var STORAGE_KEY = "ingressible-motion";

  /* ---------- Motion preference ---------- */
  var motionButtons = Array.prototype.slice.call(document.querySelectorAll('[data-motion]'));
  var root = document.documentElement;

  function motionPrefersReduced() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function applyMotion(pref) {
    if (pref !== "vivid" && pref !== "reduced") return;
    root.setAttribute("data-motion", pref);
    motionButtons.forEach(function (btn) {
      var selected = btn.getAttribute("data-motion") === pref;
      btn.classList.toggle("is-selected", selected);
      btn.setAttribute("aria-checked", selected ? "true" : "false");
    });
    document.dispatchEvent(new CustomEvent("motionchanged", { detail: pref }));
  }

  function setMotion(pref) {
    applyMotion(pref);
    try { localStorage.setItem(STORAGE_KEY, pref); } catch (e) { /* storage unavailable */ }
  }

  var stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) { /* storage unavailable */ }

  // No explicit choice? Follow the OS setting, and keep tracking it live.
  var initial = stored === "vivid" || stored === "reduced" ? stored : (motionPrefersReduced() ? "reduced" : "vivid");
  applyMotion(initial);

  motionButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      setMotion(btn.getAttribute("data-motion"));
    });
  });

  if (stored !== "vivid" && stored !== "reduced" && window.matchMedia) {
    window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", function (evt) {
      setMotion(evt.matches ? "reduced" : "vivid");
    });
  }

  // One shared policy check for JS animations.
  function shouldAnimate() {
    return root.getAttribute("data-motion") !== "reduced" && !motionPrefersReduced();
  }

  /* ---------- Motion-powered reveals ----------
     Coordinated but respectful: elements start visible for no-motion /
     no-JS, and JS only layers a gentle reveal when both conditions allow.  */
  var Motion = window.Motion;
  if (Motion && Motion.inView) {
    var reveals = Array.prototype.slice.call(document.querySelectorAll("[data-reveal]"));
    reveals.forEach(function (el) {
      var stopped = el.getAttribute("data-reveal") === "stop";
      if (stopped || !shouldAnimate()) return;
      Motion.inView(el, function () {
        // Content is never hidden: sections are always fully opaque and only
        // rise a few pixels into place so nothing waits on animation.
        Motion.animate(el, { opacity: [1, 1], y: [12, 0] }, { duration: 0.6, ease: "easeOut" });
      });
    });
  }

  /* ---------- Card entrance animations ----------
     Staggered rise-in for role cards and capability cards.
     Content stays immediately readable; only the card containers animate.  */
  if (Motion && Motion.inView) {
    var cardGroups = Array.prototype.slice.call(document.querySelectorAll(".role-cards, .cap-grid"));
    cardGroups.forEach(function (group) {
      var cards = Array.prototype.slice.call(group.querySelectorAll(".role-card, .cap-card"));
      if (!cards.length || !shouldAnimate()) return;
      Motion.inView(group, function () {
        cards.forEach(function (card, i) {
          Motion.animate(card, { opacity: [0, 1], y: [18, 0] }, { duration: 0.5, delay: i * 0.1, ease: "easeOut" });
        });
      });
    });

    /* ---------- Flow graphic entrance ----------
       The CSS handles line-drawing, station reveals, pulsing, and the
       travelling dot.  JS adds is-inview to trigger those CSS animations
       when the graphic scrolls into the viewport.  The graphic is always
       below the fold, so a short delay after page load is sufficient;
       IntersectionObserver and scroll listeners are unreliable inside
       the overflow:hidden card in some environments.                   */
    var flowGraphic = document.querySelector(".deliverable__flow");
    if (flowGraphic) {
      if (shouldAnimate()) {
        setTimeout(function () { flowGraphic.classList.add("is-inview"); }, 1200);
        Motion.inView(flowGraphic, function () {
          flowGraphic.classList.add("is-inview");
          Motion.animate(flowGraphic, { opacity: [0.85, 1], scale: [0.97, 1] }, { duration: 0.6, ease: "easeOut" });
        });
      } else {
        flowGraphic.classList.add("is-inview");
      }
    }
  }

  // Stop decorative animation while the page is hidden, resume when visible.
  document.addEventListener("visibilitychange", function () {
    document.dispatchEvent(new CustomEvent("motionchanged", { detail: root.getAttribute("data-motion") }));
  });

  /* ---------- Hero entrance (Home) ----------
     One-shot, finishes well inside 5s. The approved logo reveals with a
     gentle rise, the existing arch and orbs ease into place, then a
     restrained rose dust flourish drifts beside the artwork. Nothing
     loops, nothing follows the cursor, and nothing runs in reduced mode —
     the static composition is identical to the finished end state.          */
  var heroScene = document.querySelector(".hero__logo-scene");
  if (heroScene && Motion && Motion.animate) {
    var heroArch = document.querySelector(".hero__art .arch");
    var heroOrbs = Array.prototype.slice.call(document.querySelectorAll(".hero__art .orb"));
    var heroDust = Array.prototype.slice.call(heroScene.querySelectorAll(".hero__dust"));
    var heroControls = [];

    function heroMotionStop() {
      heroControls.forEach(function (c) {
        try { c.complete(); } catch (err) { try { c.stop(); } catch (err2) {} }
      });
      heroControls = [];
      heroDust.forEach(function (p) { p.style.opacity = 0; });
    }

    function heroMotionPlay() {
      heroMotionStop();
      if (!shouldAnimate()) return;
      // The approved logo stays still and readable at all times; only the
      // surrounding artwork (orbs, arch, dispersed dust) receives the motion.
      heroOrbs.forEach(function (orb, i) {
        var target = orb.classList.contains("orb--orchid") ? 0.92 : 0.9;
        heroControls.push(Motion.animate(
          orb, { opacity: [0, target] },
          { duration: 0.9, delay: 0.1 + i * 0.08, ease: "easeOut" }
        ));
      });
      if (heroArch) {
        heroControls.push(Motion.animate(
          heroArch, { opacity: [0, 1], y: [12, 0] },
          { duration: 0.9, delay: 0.2, ease: "easeOut" }
        ));
      }
      heroDust.forEach(function (p, i) {
        var drift = (i % 2 ? 7 : -7) + Math.sin((i + 1) * 2) * 4;
        heroControls.push(Motion.animate(
          p, { opacity: [0, 0.85, 0], y: [6, -24 - (i % 3) * 10], x: [0, drift] },
          { duration: 1.5 + (i % 3) * 0.25, delay: 0.55 + i * 0.12, ease: "easeOut" }
        ));
      });
    }

    heroMotionPlay();
    document.addEventListener("motionchanged", function (evt) {
      if (evt.detail === "reduced") heroMotionStop();
    });
  }

  /* ---------- Business constellation depth ----------
     Pointer movement changes only the presentation of the already-visible
     composition. It is deliberately subtle, desktop-only, frame-throttled,
     and immediately reset by either reduced-motion preference. */
  var constellation = document.querySelector("[data-constellation]");
  if (constellation && window.matchMedia) {
    var hoverCapable = window.matchMedia("(hover: hover) and (pointer: fine)");
    var constellationFrame = null;
    var constellationX = 0;
    var constellationY = 0;

    function resetConstellation() {
      if (constellationFrame) cancelAnimationFrame(constellationFrame);
      constellationFrame = null;
      constellation.style.setProperty("--tilt-x", "0deg");
      constellation.style.setProperty("--tilt-y", "0deg");
    }

    function renderConstellationTilt() {
      constellation.style.setProperty("--tilt-x", constellationX.toFixed(2) + "deg");
      constellation.style.setProperty("--tilt-y", constellationY.toFixed(2) + "deg");
      constellationFrame = null;
    }

    constellation.addEventListener("pointermove", function (evt) {
      if (!shouldAnimate() || !hoverCapable.matches) {
        resetConstellation();
        return;
      }
      var bounds = constellation.getBoundingClientRect();
      constellationX = ((evt.clientY - bounds.top) / bounds.height - 0.5) * -4;
      constellationY = ((evt.clientX - bounds.left) / bounds.width - 0.5) * 5;
      if (!constellationFrame) constellationFrame = requestAnimationFrame(renderConstellationTilt);
    });
    constellation.addEventListener("pointerleave", resetConstellation);
    document.addEventListener("motionchanged", function (evt) {
      if (evt.detail === "reduced") resetConstellation();
    });
  }

  /* ---------- Founder decorative accent ----------
     Static by default and in reduced mode; in vivid it gets a one-shot
     entrance plus a slow drift, paused whenever the section is offscreen.
     CSS gates the animation by motion policy; this only toggles classes. */
  var founderGlitter = document.querySelector(".founder-glitter");
  if (founderGlitter && "IntersectionObserver" in window) {
    var founderScope = founderGlitter.closest(".founder") || founderGlitter;
    var founderObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          founderGlitter.classList.add("entered", "is-inview");
        } else {
          founderGlitter.classList.remove("is-inview");
        }
      });
    }, { rootMargin: "-12% 0px -12% 0px" });
    founderObserver.observe(founderScope);
  }

  /* ---------- Mobile navigation ---------- */
  var navToggle = document.querySelector(".nav-toggle");
  var navClose = document.querySelector(".nav-close");
  var nav = document.getElementById("site-nav");
  var mobileActions = nav ? nav.querySelector(".site-nav__mobile-actions") : null;

  function setTriggerLabels(open) {
    if (!navToggle) return;
    navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }

  function openNav() {
    nav.classList.add("is-open");
    navToggle.setAttribute("aria-expanded", "true");
    setTriggerLabels(true);
    if (mobileActions) mobileActions.setAttribute("aria-hidden", "false");
    var firstLink = nav.querySelector("a");
    if (firstLink) firstLink.focus();
    document.body.style.overflow = "hidden";
  }

  function closeNav() {
    nav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
    setTriggerLabels(false);
    if (mobileActions) mobileActions.setAttribute("aria-hidden", "true");
    navToggle.focus();
    document.body.style.overflow = "";
  }

  if (navToggle && nav) {
    navToggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      if (open) {
        openNav();
      } else {
        closeNav();
      }
    });

    if (navClose) {
      navClose.addEventListener("click", closeNav);
    }

    document.addEventListener("keydown", function (evt) {
      if (evt.key === "Escape" && nav.classList.contains("is-open")) {
        closeNav();
      }
    });

    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        if (nav.classList.contains("is-open")) {
          closeNav();
        }
      });
    });

    // Close on click outside
    document.addEventListener("click", function (evt) {
      if (nav.classList.contains("is-open") &&
          !nav.contains(evt.target) &&
          !navToggle.contains(evt.target)) {
        closeNav();
      }
    });
  }

  /* ---------- Explore the Beauty Experience (tabs) ---------- */
  var tablist = document.querySelector('[role="tablist"]');
  if (tablist) {
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
    var panels = Array.prototype.slice.call(document.querySelectorAll('[role="tabpanel"]'));
    var focusedIndex = Math.max(
      tabs.findIndex(function (t) { return t.getAttribute("aria-selected") === "true"; }),
      0
    );

    function selectTab(tab) {
      tabs.forEach(function (t, i) {
        var selected = t === tab;
        t.setAttribute("aria-selected", selected ? "true" : "false");
        t.tabIndex = selected ? 0 : -1;
        var panel = document.getElementById(t.getAttribute("aria-controls"));
        if (panel) panel.hidden = !selected;
      });
    }

    function focusTab(tab) {
      focusedIndex = tabs.indexOf(tab);
      tab.focus();
    }

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        focusTab(tab);
        selectTab(tab);
      });
    });

    tablist.addEventListener("keydown", function (evt) {
      var count = tabs.length;
      var next = null;
      if (evt.key === "ArrowRight") next = tabs[(focusedIndex + 1) % count];
      else if (evt.key === "ArrowLeft") next = tabs[(focusedIndex - 1 + count) % count];
      else if (evt.key === "Home") next = tabs[0];
      else if (evt.key === "End") next = tabs[count - 1];
      if (next) {
        evt.preventDefault();
        focusTab(next);
        selectTab(next);
      }
    });

    tabs.forEach(function (t) { t.tabIndex = t.getAttribute("aria-selected") === "true" ? 0 : -1; });
    panels.forEach(function (p) { if (!p.hasAttribute("hidden")) p.hidden = false; });
    selectTab(tabs[focusedIndex]);
  }

  /* ---------- Accordions (shared disclosure component) ----------
     Semantic headings containing real buttons, with accurate
     aria-expanded/aria-controls and unique panel IDs. Collapsed panels are
     removed from the tab order via the hidden attribute. Closed stays
     neutral; the approved pink treatment appears only while expanded.       */
  var disclosureToggles = Array.prototype.slice.call(document.querySelectorAll(".disclosure__toggle"));
  disclosureToggles.forEach(function (btn) {
    var wrap = btn.closest(".disclosure");
    var panel = document.getElementById(btn.getAttribute("aria-controls"));
    function render() {
      var open = btn.getAttribute("aria-expanded") === "true";
      if (wrap) wrap.classList.toggle("is-open", open);
      if (panel) panel.hidden = !open;
    }
    btn.addEventListener("click", function () {
      var open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", open ? "false" : "true");
      render();
    });
    render();
  });

  /* ---------- Contact forms ----------
     Accessible validation with clear messaging. Forms submit to their
     Formspree endpoint via POST (native action fallback if JS fails),
     reply-to comes from the "email" field, "_gotcha" is the honeypot.
     Success is announced only after Formspree confirms acceptance;
     failures keep the visitor's details on the page and always offer a
     direct email alternative. No fake success, ever.                    */
  function escapeStatus(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /* Field-specific error copy. Consulting ("c-") fields use the approved
     messages; employment ("e-") fields follow the same pattern. The email
     format hint links to the example address so it can be copied. */
  var FIELD_MESSAGES = {
    "c-name": { required: "Enter your name." },
    "c-email": {
      required: "Enter your email address so we can reply.",
      email: 'Enter an email address in the format <a href="mailto:name@example.com">name@example.com</a>.'
    },
    "c-service": { required: "Choose the service you would like to discuss." },
    "c-message": { required: "Tell us briefly what you need help with. Include the service, product, website, app, or experience you want us to review." },
    "e-name": { required: "Enter your name." },
    "e-email": {
      required: "Enter your email address so we can reply.",
      email: 'Enter an email address in the format <a href="mailto:name@example.com">name@example.com</a>.'
    },
    "e-type": { required: "Choose the role type you are inquiring about." },
    "e-focus": { required: "Choose the focus area for the role." },
    "e-message": { required: "Tell us briefly what you need help with. Include the role, the team, and the type of work you want to discuss." }
  };

  function wireForm(wrap) {
    var form = wrap && wrap.tagName === "FORM" ? wrap : (wrap ? wrap.querySelector("form") : null);
    if (!form) return;
    var fields = Array.prototype.slice.call(form.querySelectorAll("[required]"));
    var summary = form.querySelector(".form-error-summary");
    var summaryList = summary ? summary.querySelector("ul") : null;

    function errorMessageFor(input, isEmpty) {
      var map = FIELD_MESSAGES[input.id] || {};
      if (isEmpty) return map.required || "This field is required.";
      if (input.type === "email" && !EMAIL_RE.test((input.value || "").trim())) {
        return map.email || "Enter a valid email address.";
      }
      return "";
    }

    function setFieldState(input, errorMsg) {
      var group = input.closest(".form-group");
      var error = group ? group.querySelector(".form-error") : null;
      if (errorMsg) {
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", error ? error.id : "");
        if (error) {
          error.innerHTML = errorMsg;
          error.classList.add("is-visible");
        }
      } else {
        input.removeAttribute("aria-invalid");
        input.removeAttribute("aria-describedby");
        if (error) {
          error.textContent = "";
          error.classList.remove("is-visible");
        }
      }
    }

    function validateField(input) {
      var message = errorMessageFor(input, !(input.value || "").trim());
      setFieldState(input, message);
      return !message;
    }

    function refreshSummary() {
      if (!summary || !summaryList) return;
      var invalid = fields.filter(function (f) { return f.getAttribute("aria-invalid") === "true"; });
      summaryList.innerHTML = "";
      invalid.forEach(function (f) {
        var group = f.closest(".form-group");
        var error = group ? group.querySelector(".form-error") : null;
        var li = document.createElement("li");
        var link = document.createElement("a");
        link.href = "#" + f.id;
        link.textContent = error ? error.textContent : "";
        li.appendChild(link);
        summaryList.appendChild(li);
      });
      summary.hidden = invalid.length === 0;
    }

    fields.forEach(function (field) {
      field.addEventListener("blur", function () { validateField(field); refreshSummary(); });
      field.addEventListener("input", function () {
        if (field.getAttribute("aria-invalid") === "true") { validateField(field); refreshSummary(); }
      });
      var ensure = field.form.querySelector('[data-ensure-field="' + field.id + '"]');
      if (ensure) {
        ensure.addEventListener("input", function () { validateField(field); refreshSummary(); });
      }
    });

    form.addEventListener("submit", function (evt) {
      evt.preventDefault();
      var firstInvalid = null;
      fields.forEach(function (field) {
        if (!validateField(field) && !firstInvalid) firstInvalid = field;
      });

      var requiredIf = form.querySelectorAll("[data-required-if]");
      requiredIf.forEach(function (field) {
        var dep = document.getElementById(field.getAttribute("data-required-if"));
        if (dep && dep.value) {
          var required = !(field.value || "").trim();
          if (required && !firstInvalid) firstInvalid = field;
          setFieldState(field, required ? errorMessageFor(field, true) : "");
        } else {
          setFieldState(field, "");
        }
      });

      refreshSummary();

      if (firstInvalid) {
        if (summary) summary.focus();
        return;
      }

      // Duplicate-submission guard: ignore further submits while one is in flight.
      if (form.classList.contains("is-submitting")) return;

      var submitButton = form.querySelector('button[type="submit"]');
      form.classList.add("is-submitting");
      if (submitButton) submitButton.disabled = true;
      setStatus(form, "Sending your inquiry… please keep this page open.", "pending");

      var endpoint = form.getAttribute("action");
      var directEmail = form.getAttribute("data-direct-email") || "";
      var emailAddress = directEmail || "the email address shown for this pathway";

      function fail(message) {
        form.classList.remove("is-submitting");
        if (submitButton) submitButton.disabled = false;
        setStatus(form, message, "error");
      }

      var payload;
      try {
        payload = new FormData(form);
      } catch (e) {
        fail("Something went wrong preparing your inquiry, so nothing was sent. Your details are still here — please try again, or email us directly at " + emailAddress + ".");
        return;
      }

      fetch(endpoint, {
        method: "POST",
        body: payload,
        headers: { Accept: "application/json" }
      }).then(function (res) {
        if (res.ok) {
          // Success only after Formspree confirms acceptance.
          form.reset();
          form.querySelectorAll("[aria-invalid]").forEach(function (f) {
            f.removeAttribute("aria-invalid");
            f.removeAttribute("aria-describedby");
          });
          form.querySelectorAll(".form-error.is-visible").forEach(function (e) { e.classList.remove("is-visible"); });
          if (summary) summary.hidden = true;
          if (summaryList) summaryList.innerHTML = "";
          form.classList.remove("is-submitting");
          if (submitButton) submitButton.disabled = false;
          setStatus(form, "Thank you — your inquiry was accepted and is on its way. We'll reply using the email address you provided.", "success");
        } else if (res.status === 429) {
          fail("We hit a temporary submission limit and couldn't accept your inquiry. Your details have been kept on this page. Please try again shortly, or email us directly at " + emailAddress + ".");
        } else {
          fail("Your inquiry couldn't be accepted right now. Nothing was sent and your details are still here — please try again in a moment, or email us directly at " + emailAddress + ".");
        }
      }).catch(function () {
        fail("We couldn't reach the delivery service, so nothing was sent. Your details are still here — please try again, or email us directly at " + emailAddress + ".");
      });
    });

    function setStatus(form, message, kind) {
      var el = form.querySelector(".form-status");
      if (!el) return;
      // Announce via the live region without moving focus.
      el.innerHTML = '<p role="status" class="status-' + kind + '">' + escapeStatus(message) + "</p>";
    }
  }

  wireForm(document.getElementById("consulting-form"));
  wireForm(document.getElementById("employment-form"));

  /* ---------- Decorative zones (Home page) ----------
     All decoration is aria-hidden and pointer-events-free (see CSS).
     One-shot entrances run via CSS when a shape enters the viewport;
     looping effects are paused offscreen and while the tab is hidden.
     Reduced motion already stops everything via the CSS global override;
     this code only toggles classes, it never starts JS-only timers.     */
  var decoSelectors =
    ".deco, .glitter-rain, .pixie, .scene, .fx-decor, .head-motif, .work-card__visual, .founder-card__photo";
  var decoZones = Array.prototype.slice.call(document.querySelectorAll(decoSelectors));
  if (decoZones.length && "IntersectionObserver" in window) {
    var decoObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        entry.target.classList.toggle("is-inview", entry.isIntersecting);
      });
    }, { rootMargin: "15% 0px 15% 0px" });
    decoZones.forEach(function (zone) { decoObserver.observe(zone); });
  }

  /* ---------- Enchanted ambient field ----------
     A fixed, decorative layer of fine pixie dust and soft glow behind the
     page. Purely cosmetic. In vivid the motes float and shimmer through CSS
     loops that pause while the tab is hidden; in reduced motion the exact
     same static composition simply stays put. Positions use a fixed seed so
     the look is stable across reloads. No content is ever dependent on it. */
  function buildAmbient() {
    var ambient = document.createElement("div");
    ambient.className = "ambient";
    ambient.setAttribute("aria-hidden", "true");
    var seed = 20260913;
    function rand() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }
    var i, mote, size, dur, delay, sway;
    for (i = 0; i < 40; i++) {
      mote = document.createElement("i");
      mote.className = "mote" + (i % 3 === 0 ? " mote--wander" : "");
      size = (2.5 + rand() * 4).toFixed(1);
      dur = (11 + rand() * 11).toFixed(1);
      delay = (rand() * 7).toFixed(1);
      sway = ((rand() * 2 - 1) * 12).toFixed(1);
      mote.style.cssText =
        "left:" + (rand() * 100).toFixed(1) + "%;" +
        "top:" + (rand() * 100).toFixed(1) + "%;" +
        "width:" + size + "px;height:" + size + "px;" +
        "--mt:" + dur + "s;--md:" + delay + "s;--sway:" + sway + "px;";
      ambient.appendChild(mote);
    }
    var glowA = document.createElement("i");
    glowA.className = "ambient__glow";
    glowA.style.cssText = "top:12%;left:6%;width:46vmin;height:46vmin;--gl:17s;";
    var glowB = document.createElement("i");
    glowB.className = "ambient__glow";
    glowB.style.cssText = "bottom:6%;right:0%;width:42vmin;height:42vmin;--gl:21s;";
    ambient.appendChild(glowA);
    ambient.appendChild(glowB);
    document.body.appendChild(ambient);
  }
  buildAmbient();

  /* ---------- Cursor pixie dust ----------
     A soft glow trails the pointer and tiny motes rise from it in vivid
     motion on pointing devices. Whole field is aria-hidden, pointer-events
     none, painted behind content (z-index -1 so text is never washed), and
     entirely absent under reduced motion. */
  function initCursorDust() {
    var vivid = document.documentElement.getAttribute("data-motion") === "vivid";
    if (!vivid || !window.matchMedia("(hover: hover)").matches) return;
    var field = document.createElement("div");
    field.className = "cursor-field";
    field.setAttribute("aria-hidden", "true");
    var glow = document.createElement("i");
    glow.className = "cursor-glow";
    field.appendChild(glow);
    document.body.appendChild(field);
    var lastX = -1, lastY = -1, active = 0;
    var MAX = 14;
    Array.prototype.forEach.call(document.querySelectorAll(".work-card"), function (card) {
      card.addEventListener("pointermove", function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
        card.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
      });
    });
    window.addEventListener("pointermove", function (e) {
      if (document.documentElement.getAttribute("data-motion") !== "vivid") return;
      var cx = e.clientX, cy = e.clientY;
      glow.style.transform = "translate3d(" + cx + "px," + cy + "px,0)";
      if (lastX < 0 || Math.hypot(cx - lastX, cy - lastY) > 46) {
        lastX = cx; lastY = cy;
        if (active >= MAX) {
          var old = field.querySelector(".cursor-dust");
          if (old) { old.remove(); active--; }
        }
        var dust = document.createElement("i");
        dust.className = "cursor-dust";
        var s = (3 + Math.random() * 3).toFixed(1);
        dust.style.cssText =
          "left:" + cx + "px;top:" + cy + "px;" +
          "width:" + s + "px;height:" + s + "px;" +
          "--dr:" + ((Math.random() * 24 - 12)).toFixed(1) + "px;";
        field.appendChild(dust);
        active++;
        dust.addEventListener("animationend", function () { dust.remove(); active--; });
      }
    });
  }
  initCursorDust();

  document.addEventListener("visibilitychange", function () {
    document.documentElement.classList.toggle("deco-paused", document.hidden);
  });
})();
