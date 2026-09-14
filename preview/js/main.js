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
        Motion.animate(el, { opacity: [0, 1], y: [14, 0] }, { duration: 0.6, ease: "easeOut" });
      });
    });
  }

  // Stop decorative animation while the page is hidden, resume when visible.
  document.addEventListener("visibilitychange", function () {
    document.dispatchEvent(new CustomEvent("motionchanged", { detail: root.getAttribute("data-motion") }));
  });

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
  var nav = document.getElementById("site-nav");

  if (navToggle && nav) {
    navToggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
      navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      if (open) {
        var firstLink = nav.querySelector("a");
        if (firstLink) firstLink.focus();
      } else {
        navToggle.focus();
      }
    });

    document.addEventListener("keydown", function (evt) {
      if (evt.key === "Escape" && nav.classList.contains("is-open")) {
        nav.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
        navToggle.focus();
      }
    });

    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        if (nav.classList.contains("is-open")) {
          nav.classList.remove("is-open");
          navToggle.setAttribute("aria-expanded", "false");
        }
      });
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

  function wireForm(wrap) {
    var form = wrap && wrap.tagName === "FORM" ? wrap : (wrap ? wrap.querySelector("form") : null);
    if (!form) return;
    var fields = Array.prototype.slice.call(form.querySelectorAll("[required]"));

    function setFieldState(input, errorMsg) {
      var group = input.closest(".form-group");
      var error = group ? group.querySelector(".form-error") : null;
      if (errorMsg) {
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", error ? error.id : "");
        if (error) {
          error.textContent = errorMsg;
          error.classList.add("is-visible");
        }
      } else {
        input.removeAttribute("aria-invalid");
        if (error) error.classList.remove("is-visible");
      }
    }

    function validateField(input) {
      var message = "";
      var value = (input.value || "").trim();
      if (!value) {
        message = "This field is required.";
      } else if (input.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        message = "Please enter a valid email address.";
      }
      setFieldState(input, message);
      return !message;
    }

    fields.forEach(function (field) {
      field.addEventListener("blur", function () { validateField(field); });
      field.addEventListener("input", function () {
        if (field.getAttribute("aria-invalid") === "true") validateField(field);
      });
      var ensure = field.form.querySelector('[data-ensure-field="' + field.id + '"]');
      if (ensure) {
        ensure.addEventListener("input", function () { validateField(field); });
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
          if (!(field.value || "").trim() && !firstInvalid) firstInvalid = field;
          setFieldState(field, field.value ? "" : "This field is required once you select an option above.");
        } else {
          setFieldState(field, "");
        }
      });

      if (firstInvalid) {
        firstInvalid.focus();
        setStatus(form, "Some required fields are missing or need attention. Please review the highlighted fields.", "error");
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
          form.querySelectorAll("[aria-invalid]").forEach(function (f) { f.removeAttribute("aria-invalid"); });
          form.querySelectorAll(".form-error.is-visible").forEach(function (e) { e.classList.remove("is-visible"); });
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
})();