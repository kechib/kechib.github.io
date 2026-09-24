/* ==========================================================================
   Ingressible Consultation Intake
   Multi-stage guided consultation with AI-assisted scoping.
   ========================================================================== */
(function () {
  "use strict";

  /* ---------- Service Definitions ---------- */
  var SERVICES = {
    physical: {
      label: "Physical / Beauty",
      items: [
        { id: "fragrance", label: "Fragrance", desc: "Bottle, atomizer, cap, carton, discovery, replenishment" },
        { id: "makeup", label: "Makeup", desc: "Shades, compacts, palettes, applicators, identification" },
        { id: "body-care", label: "Body Care", desc: "Pumps, jars, tubes, wet handling, dispensing" },
        { id: "other-beauty", label: "Other Beauty Product", desc: "Hair, nails, skincare, tools, accessories" },
        { id: "packaging", label: "Packaging / Component", desc: "Cartons, seals, caps, labels, instructions" },
        { id: "prototype", label: "Prototype / Concept", desc: "Early-stage concepts, design alternatives" }
      ]
    },
    retail: {
      label: "Retail / Experience",
      items: [
        { id: "retail", label: "In-Store / Retail", desc: "Store navigation, displays, testers, checkout" },
        { id: "customer-service", label: "Customer Service", desc: "Assisted experience, staff interaction, support" },
        { id: "connected-journey", label: "Connected Customer Journey", desc: "Cross-channel, omnichannel flows" }
      ]
    },
    digital: {
      label: "Digital",
      items: [
        { id: "web", label: "Website", desc: "Desktop web, ecommerce, content, forms" },
        { id: "mobile-web", label: "Mobile Web", desc: "Responsive, mobile browser experience" },
        { id: "ios", label: "Native iOS App", desc: "VoiceOver, Dynamic Type, gestures" },
        { id: "android", label: "Native Android App", desc: "TalkBack, font scaling, accessibility services" }
      ]
    },
    accessibility: {
      label: "Accessibility Services",
      items: [
        { id: "assessment", label: "Accessibility Assessment", desc: "Expert evaluation against standards" },
        { id: "remediation", label: "Accessibility Remediation", desc: "Guidance for fixing identified issues" },
        { id: "retest", label: "Retest / Verification", desc: "Verify fixes against original findings" }
      ]
    },
    consulting: {
      label: "Consulting",
      items: [
        { id: "strategy", label: "Strategy / Advisory", desc: "Strategic guidance on accessibility and inclusion" },
        { id: "training", label: "Training / Workshop", desc: "Team education, demonstrations, working sessions" },
        { id: "research", label: "Participant Research", desc: "User-informed evidence and perspective gathering" },
        { id: "custom", label: "Custom Engagement", desc: "Tailored to your specific needs" }
      ]
    }
  };

  var ORG_TYPES = [
    "Emerging / independent beauty brand",
    "Growth-stage beauty brand",
    "Established beauty brand",
    "Enterprise beauty company",
    "Retailer",
    "Manufacturer / supplier",
    "Agency / consultancy",
    "Technology / platform company",
    "Other"
  ];

  var PROJECT_STAGES = [
    "Early concept",
    "Product development",
    "Prototype",
    "Pre-launch / unreleased",
    "Live / currently available",
    "Redesign",
    "Accessibility remediation",
    "Retesting",
    "Not sure"
  ];

  var CUSTOMER_TASKS = [
    { label: "Discover", desc: "Find and learn about the product or experience for the first time" },
    { label: "Identify", desc: "Recognize the product, shade, variant, or version they need" },
    { label: "Compare", desc: "Weigh options side by side to make an informed choice" },
    { label: "Search", desc: "Look up products, shades, stores, or information" },
    { label: "Navigate", desc: "Move through a store, website, or app to reach their goal" },
    { label: "Select", desc: "Choose a specific product, shade, size, or option" },
    { label: "Open", desc: "Unseal, unlock, or access the product or its packaging" },
    { label: "Dispense", desc: "Get the right amount of product out of its container" },
    { label: "Apply", desc: "Use the product as intended on skin, hair, or body" },
    { label: "Read information", desc: "Access ingredients, instructions, warnings, or shade names" },
    { label: "Complete form", desc: "Fill in checkout, account, or contact details" },
    { label: "Authenticate", desc: "Log in, verify identity, or access a secure area" },
    { label: "Add to cart", desc: "Place items in a shopping bag for purchase" },
    { label: "Checkout", desc: "Complete payment and finalize an order" },
    { label: "Manage account", desc: "Update profile, orders, subscriptions, or preferences" },
    { label: "Use tester", desc: "Try a sample or in-store tester before buying" },
    { label: "Request assistance", desc: "Get help from staff, chat, or customer support" },
    { label: "Refill", desc: "Replenish a reusable container or component" },
    { label: "Replenish", desc: "Reorder or restock a finished product" },
    { label: "Return / exchange", desc: "Send back or swap a product after purchase" }
  ];

  var DELIVERABLES = [
    { label: "Assessment report", desc: "Full written evaluation with evidence, findings, and prioritized recommendations" },
    { label: "Executive brief", desc: "Concise summary for leadership with key outcomes and next steps" },
    { label: "Findings register", desc: "Structured list of every observation with severity and location" },
    { label: "Remediation plan", desc: "Step-by-step guidance for fixing identified accessibility issues" },
    { label: "Developer handoff", desc: "Technical specifications, code-level fixes, and testing notes for engineers" },
    { label: "Design handoff", desc: "Visual and interaction guidance for designers to resolve findings" },
    { label: "Product-team recommendations", desc: "Actionable priorities aligned to your roadmap and business goals" },
    { label: "Accessible data tables", desc: "Findings formatted for screen readers and assistive technology" },
    { label: "Executive presentation / readout", desc: "Live walkthrough of results with Q&A for stakeholders" },
    { label: "Retest report", desc: "Verification of fixes against original findings with pass/fail status" },
    { label: "Research summary", desc: "Participant-informed insights and observed customer perspectives" },
    { label: "Strategy workshop", desc: "Collaborative session to plan accessibility and inclusion strategy" },
    { label: "Custom deliverable", desc: "Tailored format to match your team's tools and workflows" }
  ];

  var FRAGRANCE_COMPONENTS = ["bottle", "outer carton", "seal", "cap", "atomizer", "refill system", "digital discovery", "ecommerce purchase journey"];
  var FRAGRANCE_MOMENTS = ["Discover", "Open", "Identify", "Orient", "Hold", "Spray / Apply", "Store", "Travel", "Refill", "Replenish"];
  var MAKEUP_AREAS = ["shade identification", "shade comparison", "product differentiation", "compact opening", "palette opening", "applicator handling", "quantity control", "application guidance", "digital shade selector", "replenishment"];
  var BODYAREAS = ["pump lock", "seal", "lid", "tube", "jar", "opening", "dispensing", "quantity control", "container stability", "wet handling", "refill", "replenishment"];
  var COMPONENTS = ["carton", "seal", "cap", "atomizer", "pump", "jar", "tube", "compact", "palette", "applicator", "refill", "other"];
  var CONDITIONS = ["dry hands", "wet hands", "product-coated hands", "one-handed interaction", "repeated opening/closing", "travel", "storage", "refill/replenishment"];
  var WEB_STANDARDS = ["WCAG 2.2 A", "WCAG 2.2 AA", "Section 508", "Client-specific", "Not sure / recommend scope"];

  /* Draft storage keys — must precede state init (loadDraft uses them). */
  var DRAFT_KEY = "ingressible-intake";
  var SUBMITTED_KEY = "ingressible-submitted";
  var DRAFT_SCHEMA = 1;

  /* ---------- State ---------- */
  var state = loadDraft() || {
    step: 0,
    brand: { company: "", contactName: "", role: "", email: "", website: "", orgType: "", brandIntention: "" },
    project: { stage: "", businessDecision: "" },
    selectedServices: [],
    connectedJourney: "",
    customerTasks: [],
    customerTasksFree: "",
    products: [{ name: "", category: "", sku: "", version: "", prototypeVersion: "", stage: "", variants: "", packagingType: "", components: [], conditions: [], notes: "" }],
    physicalScope: { testArticle: false, photography: false, video: false, measurement: false, destructive: false, confidential: false, ndaRequired: false },
    fragranceScope: { moments: [], components: [], questions: "" },
    makeupScope: { areas: [], similarDistinguishable: "", questions: "" },
    bodyCareScope: { areas: [], questions: "" },
    packagingScope: { components: [], questions: "" },
    retailScope: { storeType: "", locations: "", numLocations: "", authorizationStatus: "", areas: "", restrictions: "", photography: false, staffParticipation: false, digitalKiosks: false, excludedAreas: "" },
    webScope: { prodUrl: "", stagingUrl: "", authenticated: false, testAccount: "", cms: "", designSystem: "", thirdParty: "", criticalFlows: "", browsers: "", standards: "" },
    mobileWebScope: { responsiveUrl: "", criticalJourneys: "", targetBrowsers: "", targetDevices: "", orientation: "", textResizing: "" },
    iosScope: { appName: "", appStoreUrl: "", buildInfo: "", version: "", buildNumber: "", targetDevices: "", targetIos: "", authentication: "", testAccount: "", criticalWorkflows: "" },
    androidScope: { appName: "", playStoreUrl: "", buildInfo: "", version: "", buildNumber: "", targetDevices: "", targetAndroid: "", authentication: "", testAccount: "", criticalWorkflows: "" },
    remediationScope: { issuesIdentified: "", identifiedBy: "", existingReport: "", implementers: "", sourceAccess: "", designAccess: "", handoffAudiences: [] },
    retestScope: { originalAudit: "", findingIds: "", originalVersion: "", newVersion: "", fixSummary: "", targetEnvironments: "", targetAt: "", reproduceConditions: false },
    researchScope: { decision: "", experiencePart: "", perspectives: "", existingProcedures: "", scopeSupport: "" },
    deliverables: [],
    timeline: { desired: "", launchDate: "", hardDeadline: "", confidential: false, ndaRequired: false, sampleShipping: false, storeAccess: false, digitalCredentials: "" },
    stakeholders: "",
    decisionMaker: "",
    procurement: "",
    budgetPreference: "",
    files: [],
    aiScopeSummary: null,
    aiSuggestedModules: [],
    aiWorkstreams: [],
    consent: false,
    submissionId: null,
    status: "draft",
    downstreamFailure: null
  };

  var currentStep = state.step;
  var totalSteps = 11;
  var isSubmitting = false;

  /* ---------- DOM ---------- */
  var root = document.getElementById("intake-root");
  if (!root) return;

  /* ---------- Utility ---------- */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "className") e.className = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    if (children) {
      if (typeof children === "string") e.innerHTML = children;
      else if (Array.isArray(children)) children.forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
      else e.appendChild(children);
    }
    return e;
  }
  function uuid() { return "xxxx-xxxx".replace(/x/g, function () { return ((Math.random() * 16) | 0).toString(16); }); }
  function escapeHtml(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  /* ---------- Analytics ---------- */
  function track(event, data) {
    if (window.gtag) window.gtag("event", event, data || {});
    window.dispatchEvent(new CustomEvent("intake-analytics", { detail: { event: event, data: data } }));
  }

  /* ---------- Draft persistence ----------
     Drafts persist in localStorage under DRAFT_KEY.
     Submitted confirmations persist under SUBMITTED_KEY so that
     refresh after success restores confirmation (never resubmits).
     Corrupt / foreign / wrong-version payloads are discarded safely —
     existing data is never overwritten with an empty draft.
     (Keys declared above state init; loadDraft depends on them.) */

  function saveDraft() {
    try {
      state.step = currentStep;
      state.schemaVersion = DRAFT_SCHEMA;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
    } catch (e) {}
  }
  function loadDraft() {
    var raw = null;
    try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) { return null; }
    if (!raw) return null;
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { return null; }
    if (!parsed || typeof parsed !== "object") return null;
    /* Schema check: reject foreign or incompatible payloads. */
    if (parsed.schemaVersion && parsed.schemaVersion !== DRAFT_SCHEMA) return null;
    /* Structural sanity: must have the core containers. */
    if (!parsed.brand || !parsed.project || !Array.isArray(parsed.selectedServices)) return null;
    /* Bounds-check the saved step (12 stages: 0-11, 12 = success). */
    if (typeof parsed.step !== "number" || parsed.step < 0 || parsed.step > 12) parsed.step = 0;
    return parsed;
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }
  function saveSubmittedSnapshot() {
    try {
      localStorage.setItem(SUBMITTED_KEY, JSON.stringify({
        submissionId: state.submissionId,
        brand: state.brand.company,
        contact: state.brand.contactName,
        selectedServices: state.selectedServices.slice(),
        projectStage: state.project.stage,
        businessDecision: state.project.businessDecision,
        connectedJourney: state.connectedJourney,
        timeline: state.timeline.desired,
        deliverables: state.deliverables.slice(),
        submittedAt: new Date().toISOString(),
        schemaVersion: DRAFT_SCHEMA
      }));
    } catch (e) {}
  }
  function loadSubmittedSnapshot() {
    try {
      var raw = localStorage.getItem(SUBMITTED_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !s.submissionId) return null;
      return s;
    } catch (e) { return null; }
  }

  /* ---------- Deep linking ---------- */
  function parseDeepLink() {
    var params = new URLSearchParams(window.location.search);
    var svc = params.get("services");
    if (!svc) return;
    var ids = svc.split(",").map(function (s) { return s.trim().toLowerCase(); });
    var allIds = [];
    Object.keys(SERVICES).forEach(function (g) { SERVICES[g].items.forEach(function (i) { allIds.push(i.id); }); });
    ids.forEach(function (id) {
      if (allIds.indexOf(id) !== -1 && state.selectedServices.indexOf(id) === -1) {
        state.selectedServices.push(id);
      }
    });
  }

  /* ---------- Validation ----------
     Each error carries: field (key), msg (what failed), fix (how to fix),
     targetId (element id for aria-describedby + focus). */
  function validateStep(step) {
    var errors = [];
    if (step === 1) {
      if (!state.brand.company) errors.push({ field: "company", targetId: "brand-company",
        msg: "Brand or company name is missing.",
        fix: "Enter your brand or company name in the Brand / Company field." });
      if (!state.brand.contactName) errors.push({ field: "contactName", targetId: "brand-contact",
        msg: "Primary contact name is missing.",
        fix: "Enter the full name of your primary contact." });
      if (!state.brand.email) errors.push({ field: "email", targetId: "brand-email",
        msg: "Work email is missing.",
        fix: "Enter a valid work email address, for example name@company.com." });
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.brand.email)) errors.push({ field: "email", targetId: "brand-email",
        msg: "Work email address is not valid.",
        fix: "Check for typos — an email needs an @ sign and a domain, for example name@company.com." });
    }
    if (step === 2) {
      if (!state.brand.brandIntention) errors.push({ field: "brandIntention", targetId: "brand-intention",
        msg: "Brand intention is missing.",
        fix: "Describe in a sentence or two what customers should feel or experience with your brand." });
      if (!state.project.stage) errors.push({ field: "projectStage", targetId: "projectStage",
        msg: "No project stage is selected.",
        fix: "Choose the option that best matches where your work stands — for example Live, Prototype, or Not sure." });
    }
    if (step === 3) {
      if (state.selectedServices.length === 0) errors.push({ field: "services", targetId: "services",
        msg: "No services are selected.",
        fix: "Select at least one service card, or use Select all then remove any you do not need." });
    }
    if (step === 10) {
      if (!state.consent) errors.push({ field: "consent", targetId: "consent-check",
        msg: "Confirmation is required before submitting.",
        fix: "Check the confirmation box to allow Ingressible to evaluate and prepare your consultation." });
    }
    return errors;
  }

  /* Apply visual + programmatic error state to each failed field. */
  function markFieldErrors(errors) {
    /* Clear previous error state first. */
    $$(".intake-field--error", root).forEach(function (f) { f.classList.remove("intake-field--error"); });
    $$("[aria-invalid=\"true\"]", root).forEach(function (el) { el.removeAttribute("aria-invalid"); });
    $$(".intake-inline-error", root).forEach(function (el) { el.remove(); });

    errors.forEach(function (e) {
      var sel = FIELD_TARGETS[e.field];
      var target = sel ? root.querySelector(sel) : null;
      if (!target) target = root.querySelector("#" + e.targetId);
      if (!target) return;

      /* Programmatic state for assistive technology. */
      target.setAttribute("aria-invalid", "true");
      var errId = "error-" + e.field;
      target.setAttribute("aria-describedby", errId);
      target.setAttribute("data-error-id", errId);

      /* Visual inline error message. */
      var inline = document.createElement("p");
      inline.className = "intake-inline-error";
      inline.id = errId;
      inline.setAttribute("role", "alert");
      var icon = document.createElement("span");
      icon.className = "intake-inline-error__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "!";
      var text = document.createElement("span");
      text.innerHTML = "<strong>" + escapeHtml(e.msg) + "</strong> " + escapeHtml(e.fix);
      inline.appendChild(icon);
      inline.appendChild(text);

      /* Place inline error after the control (or after its group). */
      var wrap = target.closest ? target.closest(".intake-field, .intake-radio-group, .service-groups, .intake-consent") : null;
      if (wrap) {
        wrap.classList.add("intake-field--error");
        wrap.appendChild(inline);
      } else if (target.parentNode) {
        target.parentNode.insertBefore(inline, target.nextSibling);
      }
    });
  }

  function clearFieldErrors() {
    $$(".intake-field--error", root).forEach(function (f) { f.classList.remove("intake-field--error"); });
    $$("[aria-invalid=\"true\"]", root).forEach(function (el) { el.removeAttribute("aria-invalid"); el.removeAttribute("aria-describedby"); });
    $$(".intake-inline-error", root).forEach(function (el) { el.remove(); });
    var summary = $(".intake-error-summary", root);
    if (summary) summary.remove();
  }

  /* Maps validation field keys to focusable element selectors. */
  var FIELD_TARGETS = {
    company: "#brand-company",
    contactName: "#brand-contact",
    email: "#brand-email",
    brandIntention: "#brand-intention",
    projectStage: "[data-radio-group=\"projectStage\"]",
    services: ".service-card",
    consent: "#consent-check"
  };

  function focusErrorTarget(field) {
    var sel = FIELD_TARGETS[field];
    var target = null;
    if (sel) target = root.querySelector(sel);
    if (!target) target = root.querySelector("[name=\"" + field + "\"]") || root.querySelector("#" + field);
    if (!target) return;
    /* Make non-focusable containers focusable temporarily. */
    var needsTabindex = !target.hasAttribute("tabindex") &&
      !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(target.tagName);
    if (needsTabindex) target.setAttribute("tabindex", "-1");
    try { target.scrollIntoView({ behavior: "smooth", block: "center" }); }
    catch (e) { try { target.scrollIntoView(); } catch (e2) {} }
    try { target.focus({ preventScroll: true }); } catch (e) { try { target.focus(); } catch (e2) {} }
    /* Highlight the field briefly for sighted users. */
    var fieldWrap = target.closest ? target.closest(".intake-field") : null;
    if (fieldWrap) {
      fieldWrap.classList.add("intake-field--error");
      setTimeout(function () { fieldWrap.classList.remove("intake-field--error"); }, 2500);
    }
  }

  function showErrors(errors) {
    clearFieldErrors();
    if (errors.length === 0) return;
    /* Mark each field visually + programmatically. */
    markFieldErrors(errors);
    /* Error summary with count, what failed, and how to fix. */
    var heading = errors.length === 1
      ? "There is 1 problem to fix:"
      : "There are " + errors.length + " problems to fix:";
    var summary = el("div", { className: "intake-error-summary", tabindex: "-1", role: "alert", "aria-labelledby": "error-summary-heading" }, [
      el("h3", { id: "error-summary-heading", text: heading }),
      el("ul", {}, errors.map(function (e) {
        var link = el("a", { href: "#", onclick: function (ev) {
          ev.preventDefault();
          focusErrorTarget(e.field);
        }});
        var strong = document.createElement("strong");
        strong.textContent = e.msg + " ";
        var span = document.createElement("span");
        span.textContent = e.fix;
        link.appendChild(strong);
        link.appendChild(span);
        return el("li", {}, [link]);
      }))
    ]);
    var stage = root.querySelector(".intake-stage");
    if (stage) stage.insertBefore(summary, stage.firstChild);
    summary.focus();
    track("intake_validation_failed", { step: currentStep, count: errors.length });
  }

  /* ---------- AI / Scope Assistant ---------- */
  function analyzeScope() {
    var svcs = state.selectedServices;
    var digitalSvcs = svcs.filter(function (s) { return ["web", "mobile-web", "ios", "android"].indexOf(s) !== -1; });
    var physicalSvcs = svcs.filter(function (s) { return ["fragrance", "makeup", "body-care", "other-beauty", "packaging", "prototype"].indexOf(s) !== -1; });
    var retailSvcs = svcs.filter(function (s) { return ["retail", "customer-service", "connected-journey"].indexOf(s) !== -1; });
    var missing = [];
    var suggestions = [];
    var workstreams = [];
    var journey = [];

    if (svcs.length === 0) return { summary: "Select services to begin scoping.", modules: [], workstreams: [], missing: [], suggestions: [] };

    if (digitalSvcs.length > 1 && !state.connectedJourney) {
      suggestions.push({ id: "connected-journey", question: "You selected multiple digital surfaces. Should Ingressible examine how the same customer journey moves between them?", whyItMatters: "A connected journey analysis reveals handoff friction between platforms that single-platform testing misses." });
    }
    if (physicalSvcs.length > 0 && digitalSvcs.length > 0 && !state.connectedJourney) {
      suggestions.push({ id: "cross-platform", question: "You selected both physical and digital services. Would you like Ingressible to map the complete customer journey from discovery through physical use?", whyItMatters: "Cross-platform journeys often reveal accessibility gaps at the transitions between digital and physical." });
    }
    if (svcs.indexOf("remediation") !== -1 && !state.remediationScope.issuesIdentified) {
      missing.push({ field: "remediationScope.issuesIdentified", reason: "Remediation requires knowing what issues have been identified.", requiredForScope: true });
    }
    if (svcs.indexOf("retest") !== -1 && !state.retestScope.originalVersion) {
      missing.push({ field: "retestScope.originalVersion", reason: "Retesting requires the original and new version/build information.", requiredForScope: true });
    }
    if (svcs.indexOf("web") !== -1 && !state.webScope.prodUrl) {
      missing.push({ field: "webScope.prodUrl", reason: "Website assessment requires a production URL.", requiredForScope: true });
    }
    if (svcs.indexOf("ios") !== -1 && !state.iosScope.appName) {
      missing.push({ field: "iosScope.appName", reason: "iOS assessment benefits from knowing the app name and version.", requiredForScope: false });
    }
    if (physicalSvcs.length > 0 && !state.timeline.sampleShipping) {
      missing.push({ field: "timeline.sampleShipping", reason: "Physical product assessment requires test article logistics.", requiredForScope: true });
    }

    if (digitalSvcs.length > 0) {
      var dw = { name: "Digital Assessment", modules: digitalSvcs, reason: "Digital surfaces require platform-specific evaluation." };
      workstreams.push(dw);
    }
    if (physicalSvcs.length > 0) {
      workstreams.push({ name: "Physical Product Assessment", modules: physicalSvcs, reason: "Physical products require hands-on evaluation of tangible interactions." });
    }
    if (retailSvcs.length > 0) {
      workstreams.push({ name: "Retail Experience Assessment", modules: retailSvcs, reason: "Retail environments require on-site observation and interaction testing." });
    }
    if (svcs.indexOf("assessment") !== -1 || svcs.indexOf("remediation") !== -1 || svcs.indexOf("retest") !== -1) {
      workstreams.push({ name: "Accessibility Services", modules: svcs.filter(function (s) { return ["assessment", "remediation", "retest"].indexOf(s) !== -1; }), reason: "Accessibility services address standards compliance and issue resolution." });
    }

    if (state.project.stage === "Early concept" || state.project.stage === "Prototype") {
      journey = ["Concept", "Prototype Review", "Design Alternatives", "Recommendations"];
    } else if (physicalSvcs.length > 0 && digitalSvcs.length > 0) {
      journey = ["Discover", "Research", "Compare", "Select", "Purchase", "Receive", "Open", "Use", "Replenish"];
    } else if (digitalSvcs.length > 0) {
      journey = ["Discover", "Navigate", "Interact", "Complete Task", "Return"];
    } else if (physicalSvcs.length > 0) {
      journey = ["Discover", "Identify", "Open", "Use", "Store", "Replenish"];
    }

    var summary = svcs.length + " service" + (svcs.length > 1 ? "s" : "") + " selected across " +
      (digitalSvcs.length > 0 ? "digital" : "") +
      (physicalSvcs.length > 0 ? (digitalSvcs.length > 0 ? ", " : "") + "physical" : "") +
      (retailSvcs.length > 0 ? ((digitalSvcs.length > 0 || physicalSvcs.length > 0) ? ", " : "") + "retail" : "") +
      " surfaces.";

    return { summary: summary, modules: suggestions, workstreams: workstreams, missing: missing, suggestions: suggestions, journey: journey };
  }

  function renderAiPanel() {
    var analysis = analyzeScope();
    if (analysis.suggestions.length === 0 && analysis.missing.length === 0) return null;

    var body = el("div", { className: "ai-panel__body" });
    if (analysis.summary) body.appendChild(el("p", { text: analysis.summary }));

    if (analysis.missing.length > 0) {
      var missingList = el("p", { html: "<strong>Information needed for scoping:</strong>" });
      body.appendChild(missingList);
      var ul = el("ul", { style: "margin:0.4rem 0 0;padding-left:1.2rem;" });
      analysis.missing.forEach(function (m) {
        ul.appendChild(el("li", { text: m.reason + (m.requiredForScope ? " (required)" : " (helpful)") }));
      });
      body.appendChild(ul);
    }

    analysis.suggestions.forEach(function (s) {
      var sug = el("div", { className: "ai-panel__suggestion" });
      sug.appendChild(el("p", { text: s.question }));
      var actions = el("div", { className: "ai-panel__actions" });
      actions.appendChild(el("button", { className: "ai-btn--yes", type: "button", text: "Yes", onclick: function () {
        if (s.id === "connected-journey" || s.id === "cross-platform") state.connectedJourney = "connected";
        track("intake_clarification_answered", { question: s.id, answer: "yes" });
        render();
      }}));
      actions.appendChild(el("button", { className: "ai-btn--no", type: "button", text: "No", onclick: function () {
        track("intake_clarification_answered", { question: s.id, answer: "no" });
        render();
      }}));
      actions.appendChild(el("button", { className: "ai-btn--discuss", type: "button", text: "Discuss during consultation", onclick: function () {
        state.connectedJourney = "discuss";
        track("intake_clarification_answered", { question: s.id, answer: "discuss" });
        render();
      }}));
      sug.appendChild(actions);
      body.appendChild(sug);
    });

    var panel = el("div", { className: "ai-panel", role: "region", "aria-label": "Ingressible Scope Assistant" }, [
      el("div", { className: "ai-panel__head" }, [
        el("div", { className: "ai-panel__icon", "aria-hidden": "true", text: "IA" }),
        el("div", { className: "ai-panel__title", text: "Ingressible Intake Assistant" })
      ]),
      body
    ]);
    return panel;
  }

  /* ---------- Rendering ---------- */
  /* Hydration flag: autosave is suppressed until the initial render
     completes, preventing empty defaults from overwriting a restored draft. */
  var hasHydrated = false;

  function render() {
    /* Skip autosave on the very first render — state was just loaded,
       there is nothing new to persist yet. */
    if (hasHydrated) {
      saveDraft();
    } else {
      hasHydrated = true;
    }
    track("intake_step_completed", { step: currentStep });
    var html = renderProgress() + renderStage();
    root.innerHTML = html;
    attachEvents();
    window.scrollTo({ top: 0, behavior: "smooth" });
    var firstInput = root.querySelector("input:not([type=hidden]), select, textarea, button.btn--primary");
    if (firstInput) setTimeout(function () { firstInput.focus(); }, 100);
  }

  function renderProgress() {
    var pct = Math.round((currentStep / totalSteps) * 100);
    var stepLabels = ["Welcome", "Brand", "Project", "Services", "Journey", "Tasks", "Scope", "Deliverables", "Logistics", "Files", "Review", "Submit"];
    return "<div class=\"intake-progress\" role=\"group\" aria-label=\"Consultation progress\">" +
      "<div class=\"intake-progress__inner\">" +
      "<span class=\"intake-progress__label\">Step " + (currentStep + 1) + " of " + totalSteps + "</span>" +
      "<div class=\"intake-progress__bar\" role=\"progressbar\" aria-valuenow=\"" + pct + "\" aria-valuemin=\"0\" aria-valuemax=\"100\">" +
      "<div class=\"intake-progress__fill\" style=\"width:" + pct + "%\"></div></div>" +
      "<span class=\"intake-progress__step\">" + (stepLabels[currentStep] || "") + "</span>" +
      "</div></div>";
  }

  function renderStage() {
    var stages = [
      renderWelcome, renderBrand, renderProject, renderServices,
      renderConnectedJourney, renderTasks, renderScope,
      renderDeliverables, renderLogistics, renderFiles,
      renderReview, renderSubmit
    ];
    /* Success screen renders after submission completes (step beyond stages). */
    if (currentStep > totalSteps) {
      return "<div class=\"intake-stage\">" + renderSuccess() + "</div>";
    }
    if (currentStep >= 0 && currentStep < stages.length) {
      return "<div class=\"intake-stage\">" + stages[currentStep]() + "</div>";
    }
    return "";
  }

  function backBtn() {
    return "<button type=\"button\" class=\"intake-nav__back\" data-action=\"back\">" +
      "<svg viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M10 3L5 8l5 5\"/></svg> Back</button>";
  }
  function nextBtn(label) {
    return "<button type=\"button\" class=\"btn--primary\" data-action=\"next\">" + (label || "Continue") + "</button>";
  }
  function navButtons(back, next, centered) {
    if (centered) {
      return "<div class=\"intake-nav intake-nav--center\"><div>" + next + "</div></div>";
    }
    return "<div class=\"intake-nav\">" + (back !== false ? backBtn() : "<span></span>") + "<div>" + next + "</div></div>";
  }

  /* --- Stage 0: Welcome --- */
  function renderWelcome() {
    return "<div class=\"intake-welcome\">" +
      "<p class=\"intake-welcome__brand\">Ingressible</p>" +
      "<p class=\"intake-welcome__tagline\">Preserving the Vision. Expanding the Experience.</p>" +
      "<h1>Tell us what experience you want to expand.</h1>" +
      "<p class=\"intake-welcome__desc\">Ingressible works across beauty products, packaging, retail, websites, mobile experiences, native apps, remediation, prototypes, and connected customer journeys.</p>" +
      "<ul class=\"intake-welcome__notes\">" +
      "<li>The intake adapts to your selections.</li>" +
      "<li>Multiple services can be selected.</li>" +
      "<li>Confidential and unreleased projects are welcome.</li>" +
      "<li>NDA requirements can be identified.</li>" +
      "<li>The intake helps prepare a focused consultation.</li>" +
      "</ul>" +
      "</div>" +
      navButtons(false, "<button type=\"button\" class=\"btn--primary\" data-action=\"next\">Begin Your Consultation</button>", true);
  }

  /* --- Stage 1: Brand --- */
  function renderBrand() {
    var b = state.brand;
    var h = stageHeader("About Your Brand", "Tell us about your organization and who we'll work with.");
    h += "<div class=\"intake-field\"><label for=\"brand-company\">Brand / Company <span class=\"intake-required\" aria-label=\"required\">*</span></label>" +
      "<input type=\"text\" id=\"brand-company\" name=\"company\" value=\"" + escapeHtml(b.company) + "\" autocomplete=\"organization\"></div>";
    h += "<div class=\"intake-field intake-field--half\">" +
      "<div><label for=\"brand-contact\">Primary Contact <span class=\"intake-required\" aria-label=\"required\">*</span></label>" +
      "<input type=\"text\" id=\"brand-contact\" name=\"contactName\" value=\"" + escapeHtml(b.contactName) + "\" autocomplete=\"name\"></div>" +
      "<div><label for=\"brand-role\">Role / Title <span class=\"intake-optional\">Optional</span></label>" +
      "<input type=\"text\" id=\"brand-role\" name=\"role\" value=\"" + escapeHtml(b.role) + "\" autocomplete=\"organization-title\"></div></div>";
    h += "<div class=\"intake-field intake-field--half\">" +
      "<div><label for=\"brand-email\">Work Email <span class=\"intake-required\" aria-label=\"required\">*</span></label>" +
      "<input type=\"email\" id=\"brand-email\" name=\"email\" value=\"" + escapeHtml(b.email) + "\" autocomplete=\"email\"></div>" +
      "<div><label for=\"brand-website\">Website <span class=\"intake-optional\">Optional</span></label>" +
      "<input type=\"url\" id=\"brand-website\" name=\"website\" value=\"" + escapeHtml(b.website) + "\" placeholder=\"https://\" autocomplete=\"url\"></div></div>";
    h += "<div class=\"intake-field\"><label for=\"brand-orgtype\">Organization Type <span class=\"intake-optional\">Optional</span></label>" +
      "<select id=\"brand-orgtype\" name=\"orgType\"><option value=\"\">Select&hellip;</option>";
    ORG_TYPES.forEach(function (t) {
      h += "<option value=\"" + escapeHtml(t) + "\"" + (b.orgType === t ? " selected" : "") + ">" + escapeHtml(t) + "</option>";
    });
    h += "</select></div>";
    h += navButtons(false, nextBtn());
    return h;
  }

  /* --- Stage 2: Project --- */
  function renderProject() {
    var p = state.project;
    var b = state.brand;
    var h = stageHeader("Your Project", "Help us understand the experience you want to expand.");
    h += "<div class=\"intake-field\"><label for=\"brand-intention\">What do you want customers to feel or experience when they interact with your brand? <span class=\"intake-required\" aria-label=\"required\">*</span></label>" +
      "<textarea id=\"brand-intention\" name=\"brandIntention\" rows=\"4\">" + escapeHtml(b.brandIntention) + "</textarea>" +
      "<p class=\"intake-hint\">Describe the feeling, experience, or outcome your brand is designed to create.</p></div>";
    h += "<div class=\"intake-field\"><label>What stage is this work currently in? <span class=\"intake-required\" aria-label=\"required\">*</span></label>";
    h += "<div class=\"intake-radio-group\" role=\"radiogroup\" aria-label=\"Project stage\">";
    PROJECT_STAGES.forEach(function (s, i) {
      var checked = p.stage === s;
      h += "<label class=\"intake-radio-card\"" + (checked ? " aria-checked=\"true\" style=\"border-color:var(--berry);background:rgba(145,61,102,0.06)\"" : " aria-checked=\"false\"") +
        " data-radio-group=\"projectStage\" data-value=\"" + escapeHtml(s) + "\" tabindex=\"0\" role=\"radio\">" +
        "<input type=\"radio\" name=\"projectStage\" value=\"" + escapeHtml(s) + "\"" + (checked ? " checked" : "") + "> " + escapeHtml(s) + "</label>";
    });
    h += "</div></div>";
    h += "<div class=\"intake-field\"><label for=\"business-decision\">What decision should this work help your team make? <span class=\"intake-optional\">Optional</span></label>" +
      "<textarea id=\"business-decision\" name=\"businessDecision\" rows=\"3\">" + escapeHtml(p.businessDecision) + "</textarea>" +
      "<p class=\"intake-hint\">Examples: evaluate packaging options, understand accessibility friction, prepare for launch, improve digital accessibility.</p></div>";
    h += navButtons(true, nextBtn());
    return h;
  }

/* --- Stage 3: Services --- */
  function renderServices() {
    var h = stageHeader("What We'll Explore", "Select everything you'd like Ingressible to explore. You can choose more than one.");
    h += "<div class=\"service-groups\">";
    Object.keys(SERVICES).forEach(function (g) {
      var group = SERVICES[g];
      h += "<div class=\"service-group\"><p class=\"service-group__title\">" + escapeHtml(group.label) + "</p><div class=\"service-grid\">";
      group.items.forEach(function (svc) {
        var sel = state.selectedServices.indexOf(svc.id) !== -1;
        var hasScopeData = hasServiceScopeData(svc.id);
        h += "<button type=\"button\" class=\"service-card\" aria-pressed=\"" + sel + "\" data-service=\"" + svc.id + "\"" + (hasScopeData ? " data-has-scope=\"true\"" : "") + ">" +
          escapeHtml(svc.label) + "<span class=\"service-card__desc\">" + escapeHtml(svc.desc) + "</span></button>";
      });
      h += "</div></div>";
    });
    h += "</div>";
    h += "<div class=\"service-actions\">" +
      "<button type=\"button\" data-action=\"select-all\">Select all</button>" +
      "<button type=\"button\" data-action=\"clear-services\">Clear selections</button></div>";
    h += "<p class=\"intake-status\" aria-live=\"polite\">" + state.selectedServices.length + " service" + (state.selectedServices.length !== 1 ? "s" : "") + " selected</p>";
    h += navButtons(true, nextBtn());
    return h;
  }

  /* --- Stage 4: Connected Journey --- */
  function renderConnectedJourney() {
    var svcs = state.selectedServices;
    var digitalCount = svcs.filter(function (s) { return ["web", "mobile-web", "ios", "android"].indexOf(s) !== -1; }).length;
    var physicalCount = svcs.filter(function (s) { return ["fragrance", "makeup", "body-care", "other-beauty", "packaging", "prototype"].indexOf(s) !== -1; }).length;

    if (digitalCount < 2 && physicalCount < 2 && !(digitalCount > 0 && physicalCount > 0)) {
      currentStep++;
      saveDraft();
      render();
      return "";
    }

    var h = stageHeader("The Customer Journey", "You selected multiple customer-facing surfaces. How should Ingressible approach them?");
    h += "<div class=\"intake-radio-group\" role=\"radiogroup\" aria-label=\"Journey approach\">";
    var options = [
      { value: "separate", label: "Separate workstreams", desc: "Evaluate each surface independently." },
      { value: "connected", label: "One connected customer journey", desc: "Map how the experience moves between surfaces." },
      { value: "both", label: "Both", desc: "Independent evaluation plus connected journey analysis." },
      { value: "discuss", label: "Discuss during consultation", desc: "Help Ingressible recommend the right approach." }
    ];
    options.forEach(function (o) {
      var checked = state.connectedJourney === o.value;
      h += "<label class=\"intake-radio-card\"" + (checked ? " aria-checked=\"true\" style=\"border-color:var(--berry);background:rgba(145,61,102,0.06)\"" : " aria-checked=\"false\"") +
        " data-radio-group=\"connectedJourney\" data-value=\"" + o.value + "\" tabindex=\"0\" role=\"radio\">" +
        "<input type=\"radio\" name=\"connectedJourney\" value=\"" + o.value + "\"" + (checked ? " checked" : "") + "> " +
        "<strong>" + escapeHtml(o.label) + "</strong><br><span style=\"font-size:var(--text-xs);color:var(--text-soft)\">" + escapeHtml(o.desc) + "</span></label>";
    });
    h += "</div>";
    h += navButtons(true, nextBtn());
    return h;
  }

  /* --- Stage 5: Customer Tasks --- */
  function renderTasks() {
    var h = stageHeader("Customer Tasks", "What should a customer be able to do? Select all that apply.");
    h += "<div class=\"intake-check-group\">";
    CUSTOMER_TASKS.forEach(function (t) {
      var checked = state.customerTasks.indexOf(t.label) !== -1;
      h += "<div class=\"intake-check-item\"><input type=\"checkbox\" id=\"task-" + t.label.replace(/[^a-z]/gi, "") + "\" value=\"" + escapeHtml(t.label) + "\"" + (checked ? " checked" : "") + ">" +
        "<label for=\"task-" + t.label.replace(/[^a-z]/gi, "") + "\"><strong>" + escapeHtml(t.label) + "</strong><br><span style=\"font-size:var(--text-xs);color:var(--text-soft)\">" + escapeHtml(t.desc) + "</span></label></div>";
    });
    h += "</div>";
    h += "<div class=\"service-actions\" style=\"margin-top:var(--space-2)\">" +
      "<button type=\"button\" data-action=\"select-all-tasks\">Select all</button>" +
      "<button type=\"button\" data-action=\"clear-tasks\">Clear selections</button></div>";
    h += "<div class=\"intake-field\"><label for=\"tasks-free\">Additional tasks or context <span class=\"intake-optional\">Optional</span></label>" +
      "<textarea id=\"tasks-free\" name=\"customerTasksFree\" rows=\"3\">" + escapeHtml(state.customerTasksFree) + "</textarea></div>";
    h += navButtons(true, nextBtn());
    return h;
  }

  /* --- Stage 6: Scope Details --- */
  function renderScope() {
    var svcs = state.selectedServices;
    var h = stageHeader("Scope Details", "Provide details for each selected service area.");
    var hasPhysical = svcs.some(function (s) { return ["fragrance", "makeup", "body-care", "other-beauty", "packaging", "prototype"].indexOf(s) !== -1; });
    var hasDigital = svcs.some(function (s) { return ["web", "mobile-web", "ios", "android"].indexOf(s) !== -1; });
    var hasAccessibility = svcs.some(function (s) { return ["assessment", "remediation", "retest"].indexOf(s) !== -1; });
    var hasResearch = svcs.indexOf("research") !== -1;

    if (hasPhysical) h += renderPhysicalScopes(svcs);
    if (hasDigital) h += renderDigitalScopes(svcs);
    if (hasAccessibility) h += renderAccessibilityScopes(svcs);
    if (hasResearch) h += renderResearchScope();
    if (svcs.indexOf("retail") !== -1) h += renderRetailScope();

    if (!hasPhysical && !hasDigital && !hasAccessibility && !hasResearch && svcs.indexOf("retail") === -1) {
      h += "<p style=\"color:var(--text-soft)\">No detailed scope questions for your selected services. Continue to deliverables.</p>";
    }
    h += navButtons(true, nextBtn());
    return h;
  }

  function renderPhysicalScopes(svcs) {
    var h = "";
    h += "<div class=\"scope-section\"><div class=\"scope-section__head\"><div class=\"scope-section__icon\" aria-hidden=\"true\">&#x1F3FA;</div><h3 class=\"scope-section__title\">Physical Product Details</h3></div>";
    h += scopeProductsSection();
    if (svcs.indexOf("fragrance") !== -1) h += renderFragranceScope();
    if (svcs.indexOf("makeup") !== -1) h += renderMakeupScope();
    if (svcs.indexOf("body-care") !== -1) h += renderBodyCareScope();
    h += physicalTestOptions();
    h += "</div>";
    return h;
  }

  function scopeProductsSection() {
    var h = "<div class=\"intake-section-label\">Products / Experiences</div>";
    state.products.forEach(function (prod, i) {
      var hasContent = prod.name || prod.category || prod.sku || prod.version || prod.prototypeVersion || prod.stage || prod.variants || prod.packagingType || (prod.components && prod.components.length) || (prod.conditions && prod.conditions.length) || prod.notes;
      h += "<div style=\"background:var(--ivory);border:1px solid var(--line);border-radius:var(--radius);padding:0.85rem 1rem;margin-bottom:0.5rem;position:relative;\">" +
        "<div class=\"intake-field intake-field--half\">" +
        "<div><label for=\"prod-name-" + i + "\">Product Name</label>" +
        "<input type=\"text\" id=\"prod-name-" + i + "\" data-product=\"" + i + "\" data-field=\"name\" value=\"" + escapeHtml(prod.name) + "\"></div>" +
        "<div><label for=\"prod-cat-" + i + "\">Category</label>" +
        "<input type=\"text\" id=\"prod-cat-" + i + "\" data-product=\"" + i + "\" data-field=\"category\" value=\"" + escapeHtml(prod.category) + "\" placeholder=\"e.g. Eau de Parfum\"></div></div>" +
        "<div class=\"intake-field intake-field--half\">" +
        "<div><label for=\"prod-sku-" + i + "\">SKU <span class=\"intake-optional\">Optional</span></label>" +
        "<input type=\"text\" id=\"prod-sku-" + i + "\" data-product=\"" + i + "\" data-field=\"sku\" value=\"" + escapeHtml(prod.sku) + "\"></div>" +
        "<div><label for=\"prod-version-" + i + "\">Version / Stage</label>" +
        "<input type=\"text\" id=\"prod-version-" + i + "\" data-product=\"" + i + "\" data-field=\"version\" value=\"" + escapeHtml(prod.version) + "\"></div></div>" +
        "<div class=\"intake-field\"><label for=\"prod-notes-" + i + "\">Notes <span class=\"intake-optional\">Optional</span></label>" +
        "<textarea id=\"prod-notes-" + i + "\" data-product=\"" + i + "\" data-field=\"notes\" rows=\"2\">" + escapeHtml(prod.notes) + "</textarea></div>" +
        (state.products.length > 1 ? "<button type=\"button\" class=\"btn--secondary\" data-action=\"remove-product\" data-product-index=\"" + i + "\" style=\"font-size:var(--text-xs);position:absolute;top:0.5rem;right:0.5rem;padding:0.25rem 0.5rem;\" " + (hasContent ? "data-has-content=\"true\"" : "") + ">Remove</button>" : "") +
        "</div>";
    });
    h += "<button type=\"button\" class=\"btn--secondary\" data-action=\"add-product\" style=\"font-size:var(--text-xs)\">+ Add another product / experience</button>";
    return h;
  }

  function renderFragranceScope() {
    var fs = state.fragranceScope;
    var h = "<div class=\"scope-divider\"></div><div class=\"intake-section-label\">Fragrance Experience</div>";
    h += "<p style=\"font-size:var(--text-sm);color:var(--text-soft);margin-bottom:0.5rem\">Select the experience moments relevant to this fragrance.</p>";
    h += "<div class=\"intake-check-group\">";
    FRAGRANCE_MOMENTS.forEach(function (m) {
      var id = "frag-moment-" + m.replace(/[^a-z]/gi, "");
      h += "<div class=\"intake-check-item\"><input type=\"checkbox\" id=\"" + id + "\" value=\"" + escapeHtml(m) + "\"" + (fs.moments.indexOf(m) !== -1 ? " checked" : "") + ">" +
        "<label for=\"" + id + "\">" + escapeHtml(m) + "</label></div>";
    });
    h += "</div>";
    h += "<div class=\"intake-check-group\"><div class=\"intake-check-group__title\">Components</div>";
    FRAGRANCE_COMPONENTS.forEach(function (c) {
      var id = "frag-comp-" + c.replace(/[^a-z]/gi, "");
      h += "<div class=\"intake-check-item\"><input type=\"checkbox\" id=\"" + id + "\" value=\"" + escapeHtml(c) + "\"" + (fs.components.indexOf(c) !== -1 ? " checked" : "") + ">" +
        "<label for=\"" + id + "\">" + escapeHtml(c) + "</label></div>";
    });
    h += "</div>";
    h += "<div class=\"intake-field\"><label for=\"frag-questions\">Additional fragrance questions <span class=\"intake-optional\">Optional</span></label>" +
      "<textarea id=\"frag-questions\" rows=\"2\">" + escapeHtml(fs.questions) + "</textarea></div>";
    return h;
  }

  function renderMakeupScope() {
    var ms = state.makeupScope;
    var h = "<div class=\"scope-divider\"></div><div class=\"intake-section-label\">Makeup Experience</div>";
    h += "<div class=\"intake-check-group\"><div class=\"intake-check-group__title\">Relevant areas</div>";
    MAKEUP_AREAS.forEach(function (a) {
      var id = "makeup-" + a.replace(/[^a-z]/gi, "");
      h += "<div class=\"intake-check-item\"><input type=\"checkbox\" id=\"" + id + "\" value=\"" + escapeHtml(a) + "\"" + (ms.areas.indexOf(a) !== -1 ? " checked" : "") + ">" +
        "<label for=\"" + id + "\">" + escapeHtml(a) + "</label></div>";
    });
    h += "</div>";
    h += "<div class=\"intake-field\"><label for=\"makeup-distinguish\">Do similar shades / products need to be distinguishable without relying entirely on color? <span class=\"intake-optional\">Optional</span></label>" +
      "<textarea id=\"makeup-distinguish\" rows=\"2\">" + escapeHtml(ms.similarDistinguishable) + "</textarea></div>";
    return h;
  }

  function renderBodyCareScope() {
    var bs = state.bodyCareScope;
    var h = "<div class=\"scope-divider\"></div><div class=\"intake-section-label\">Body Care Experience</div>";
    h += "<div class=\"intake-check-group\"><div class=\"intake-check-group__title\">Relevant areas</div>";
    BODYAREAS.forEach(function (a) {
      var id = "body-" + a.replace(/[^a-z]/gi, "");
      h += "<div class=\"intake-check-item\"><input type=\"checkbox\" id=\"" + id + "\" value=\"" + escapeHtml(a) + "\"" + (bs.areas.indexOf(a) !== -1 ? " checked" : "") + ">" +
        "<label for=\"" + id + "\">" + escapeHtml(a) + "</label></div>";
    });
    h += "</div>";
    return h;
  }

  function physicalTestOptions() {
    var ps = state.physicalScope;
    var h = "<div class=\"scope-divider\"></div><div class=\"intake-section-label\">Test Conditions</div>";
    var opts = [
      { key: "testArticle", label: "Test articles will be supplied" },
      { key: "photography", label: "Photography permitted" },
      { key: "video", label: "Video permitted" },
      { key: "measurement", label: "Measurement permitted" },
      { key: "destructive", label: "Destructive testing permitted" },
      { key: "confidential", label: "Product is unreleased / confidential" },
      { key: "ndaRequired", label: "NDA required before testing" }
    ];
    opts.forEach(function (o) {
      h += "<div class=\"intake-check-item\"><input type=\"checkbox\" id=\"phys-" + o.key + "\"" + (ps[o.key] ? " checked" : "") + " data-physical=\"" + o.key + "\">" +
        "<label for=\"phys-" + o.key + "\">" + o.label + "</label></div>";
    });
    return h;
  }

  function renderDigitalScopes(svcs) {
    var h = "<div class=\"scope-section\"><div class=\"scope-section__head\"><div class=\"scope-section__icon\" aria-hidden=\"true\">&#x1F4F1;</div><h3 class=\"scope-section__title\">Digital Surface Details</h3></div>";
    if (svcs.indexOf("web") !== -1) h += renderWebScope();
    if (svcs.indexOf("mobile-web") !== -1) h += renderMobileWebScope();
    if (svcs.indexOf("ios") !== -1) h += renderIosScope();
    if (svcs.indexOf("android") !== -1) h += renderAndroidScope();
    h += "</div>";
    return h;
  }

  function renderWebScope() {
    var ws = state.webScope;
    var h = "<div class=\"intake-section-label\">Website</div>";
    h += "<div class=\"intake-field intake-field--half\">" +
      "<div><label for=\"web-prod\">Production URL <span class=\"intake-required\" aria-label=\"required\">*</span></label>" +
      "<input type=\"url\" id=\"web-prod\" value=\"" + escapeHtml(ws.prodUrl) + "\" placeholder=\"https://\"></div>" +
      "<div><label for=\"web-stage\">Staging URL <span class=\"intake-optional\">Optional</span></label>" +
      "<input type=\"url\" id=\"web-stage\" value=\"" + escapeHtml(ws.stagingUrl) + "\" placeholder=\"https://\"></div></div>";
    h += "<div class=\"intake-field\"><label for=\"web-critical\">Critical flows / tasks</label>" +
      "<textarea id=\"web-critical\" rows=\"2\">" + escapeHtml(ws.criticalFlows) + "</textarea></div>";
    h += "<div class=\"intake-field\"><label for=\"web-standards\">Accessibility standard</label>" +
      "<select id=\"web-standards\"><option value=\"\">Select&hellip;</option>";
    WEB_STANDARDS.forEach(function (s) {
      h += "<option value=\"" + escapeHtml(s) + "\"" + (ws.standards === s ? " selected" : "") + ">" + escapeHtml(s) + "</option>";
    });
    h += "</select></div>";
    h += "<div class=\"intake-check-item\"><input type=\"checkbox\" id=\"web-auth\"" + (ws.authenticated ? " checked" : "") + ">" +
      "<label for=\"web-auth\">Authenticated / login areas</label></div>";
    return h;
  }

  function renderMobileWebScope() {
    var mws = state.mobileWebScope;
    var h = "<div class=\"scope-divider\"></div><div class=\"intake-section-label\">Mobile Web</div>";
    h += "<div class=\"intake-field\"><label for=\"mweb-url\">Responsive URL</label>" +
      "<input type=\"url\" id=\"mweb-url\" value=\"" + escapeHtml(mws.responsiveUrl) + "\" placeholder=\"https://\"></div>";
    h += "<div class=\"intake-field\"><label for=\"mweb-journeys\">Critical mobile journeys</label>" +
      "<textarea id=\"mweb-journeys\" rows=\"2\">" + escapeHtml(mws.criticalJourneys) + "</textarea></div>";
    h += "<div class=\"intake-field\"><label for=\"mweb-browsers\">Target browsers / devices</label>" +
      "<input type=\"text\" id=\"mweb-browsers\" value=\"" + escapeHtml(mws.targetBrowsers) + "\"></div>";
    return h;
  }

  function renderIosScope() {
    var ios = state.iosScope;
    var h = "<div class=\"scope-divider\"></div><div class=\"intake-section-label\">Native iOS App</div>";
    h += "<div class=\"intake-field intake-field--half\">" +
      "<div><label for=\"ios-name\">App Name</label>" +
      "<input type=\"text\" id=\"ios-name\" value=\"" + escapeHtml(ios.appName) + "\"></div>" +
      "<div><label for=\"ios-version\">Version / Build</label>" +
      "<input type=\"text\" id=\"ios-version\" value=\"" + escapeHtml(ios.version) + " " + escapeHtml(ios.buildNumber) + "\"></div></div>";
    h += "<div class=\"intake-field\"><label for=\"ios-url\">App Store URL <span class=\"intake-optional\">Optional</span></label>" +
      "<input type=\"url\" id=\"ios-url\" value=\"" + escapeHtml(ios.appStoreUrl) + "\" placeholder=\"https://\"></div>";
    h += "<div class=\"intake-field\"><label for=\"ios-workflows\">Critical workflows</label>" +
      "<textarea id=\"ios-workflows\" rows=\"2\">" + escapeHtml(ios.criticalWorkflows) + "</textarea></div>";
    h += "<div class=\"intake-check-item\"><input type=\"checkbox\" id=\"ios-auth\"" + (ios.authentication ? " checked" : "") + ">" +
      "<label for=\"ios-auth\">Authentication / login required</label></div>";
    return h;
  }

  function renderAndroidScope() {
    var and = state.androidScope;
    var h = "<div class=\"scope-divider\"></div><div class=\"intake-section-label\">Native Android App</div>";
    h += "<div class=\"intake-field intake-field--half\">" +
      "<div><label for=\"and-name\">App Name</label>" +
      "<input type=\"text\" id=\"and-name\" value=\"" + escapeHtml(and.appName) + "\"></div>" +
      "<div><label for=\"and-version\">Version / Build</label>" +
      "<input type=\"text\" id=\"and-version\" value=\"" + escapeHtml(and.version) + " " + escapeHtml(and.buildNumber) + "\"></div></div>";
    h += "<div class=\"intake-field\"><label for=\"and-url\">Google Play URL <span class=\"intake-optional\">Optional</span></label>" +
      "<input type=\"url\" id=\"and-url\" value=\"" + escapeHtml(and.playStoreUrl) + "\" placeholder=\"https://\"></div>";
    h += "<div class=\"intake-field\"><label for=\"and-workflows\">Critical workflows</label>" +
      "<textarea id=\"and-workflows\" rows=\"2\">" + escapeHtml(and.criticalWorkflows) + "</textarea></div>";
    h += "<div class=\"intake-check-item\"><input type=\"checkbox\" id=\"and-auth\"" + (and.authentication ? " checked" : "") + ">" +
      "<label for=\"and-auth\">Authentication / login required</label></div>";
    return h;
  }

  function renderRetailScope() {
    var rs = state.retailScope;
    var h = "<div class=\"scope-section\"><div class=\"scope-section__head\"><div class=\"scope-section__icon\" aria-hidden=\"true\">&#x1F3EA;</div><h3 class=\"scope-section__title\">Retail / In-Store Details</h3></div>";
    h += "<div class=\"intake-field intake-field--half\">" +
      "<div><label for=\"retail-type\">Store / boutique type</label>" +
      "<input type=\"text\" id=\"retail-type\" value=\"" + escapeHtml(rs.storeType) + "\"></div>" +
      "<div><label for=\"retail-locations\">Location(s)</label>" +
      "<input type=\"text\" id=\"retail-locations\" value=\"" + escapeHtml(rs.locations) + "\"></div></div>";
    h += "<div class=\"intake-field\"><label for=\"retail-areas\">Relevant store areas</label>" +
      "<textarea id=\"retail-areas\" rows=\"2\">" + escapeHtml(rs.areas) + "</textarea></div>";
    h += "<div class=\"intake-field\"><label for=\"retail-restrictions\">Visit restrictions / permissions</label>" +
      "<textarea id=\"retail-restrictions\" rows=\"2\">" + escapeHtml(rs.restrictions) + "</textarea></div>";
    h += "<div class=\"intake-check-item\"><input type=\"checkbox\" id=\"retail-photo\"" + (rs.photography ? " checked" : "") + ">" +
      "<label for=\"retail-photo\">Photography permitted</label></div>";
    h += "<div class=\"intake-check-item\"><input type=\"checkbox\" id=\"retail-staff\"" + (rs.staffParticipation ? " checked" : "") + ">" +
      "<label for=\"retail-staff\">Staff participation available</label></div>";
    h += "</div>";
    return h;
  }

  function renderAccessibilityScopes(svcs) {
    var h = "<div class=\"scope-section\"><div class=\"scope-section__head\"><div class=\"scope-section__icon\" aria-hidden=\"true\">&#x2713;</div><h3 class=\"scope-section__title\">Accessibility Services</h3></div>";
    if (svcs.indexOf("remediation") !== -1) {
      var rs = state.remediationScope;
      h += "<div class=\"intake-section-label\">Remediation</div>";
      h += "<div class=\"intake-field\"><label for=\"rem-issues\">Have accessibility issues already been identified?</label>" +
        "<textarea id=\"rem-issues\" rows=\"2\">" + escapeHtml(rs.issuesIdentified) + "</textarea></div>";
      h += "<div class=\"intake-field\"><label for=\"rem-who\">Who identified them?</label>" +
        "<input type=\"text\" id=\"rem-who\" value=\"" + escapeHtml(rs.identifiedBy) + "\"></div>";
      h += "<div class=\"intake-check-item\"><input type=\"checkbox\" id=\"rem-report\"" + (rs.existingReport ? " checked" : "") + ">" +
        "<label for=\"rem-report\">Existing report available for upload</label></div>";
      h += "<div class=\"intake-field\"><label for=\"rem-source\">Source access available?</label>" +
        "<input type=\"text\" id=\"rem-source\" value=\"" + escapeHtml(rs.sourceAccess) + "\"></div>";
    }
    if (svcs.indexOf("retest") !== -1) {
      var rt = state.retestScope;
      h += "<div class=\"scope-divider\"></div><div class=\"intake-section-label\">Retest / Verification</div>";
      h += "<div class=\"intake-field intake-field--half\">" +
        "<div><label for=\"rt-original\">Original version / build</label>" +
        "<input type=\"text\" id=\"rt-original\" value=\"" + escapeHtml(rt.originalVersion) + "\"></div>" +
        "<div><label for=\"rt-new\">New version / build</label>" +
        "<input type=\"text\" id=\"rt-new\" value=\"" + escapeHtml(rt.newVersion) + "\"></div></div>";
      h += "<div class=\"intake-field\"><label for=\"rt-fixes\">Fix / change summary</label>" +
        "<textarea id=\"rt-fixes\" rows=\"2\">" + escapeHtml(rt.fixSummary) + "</textarea></div>";
    }
    h += "</div>";
    return h;
  }

  function renderResearchScope() {
    var rs = state.researchScope;
    var h = "<div class=\"scope-section\"><div class=\"scope-section__head\"><div class=\"scope-section__icon\" aria-hidden=\"true\">&#x1F50D;</div><h3 class=\"scope-section__title\">Participant Research</h3></div>";
    h += "<div class=\"intake-field\"><label for=\"res-decision\">What decision should participant research support?</label>" +
      "<textarea id=\"res-decision\" rows=\"2\">" + escapeHtml(rs.decision) + "</textarea></div>";
    h += "<div class=\"intake-field\"><label for=\"res-perspectives\">Which customer perspectives are relevant?</label>" +
      "<textarea id=\"res-perspectives\" rows=\"2\">" + escapeHtml(rs.perspectives) + "</textarea></div>";
    h += "<div class=\"intake-check-item\"><input type=\"checkbox\" id=\"res-procedures\"" + (rs.existingProcedures ? " checked" : "") + ">" +
      "<label for=\"res-procedures\">Client has approved recruiting / consent procedures</label></div>";
    h += "</div>";
    return h;
  }

  /* --- Stage 7: Deliverables --- */
  function renderDeliverables() {
    var h = stageHeader("What You'll Receive", "Select the deliverables that would be most valuable.");
    h += "<div class=\"intake-check-group\">";
    DELIVERABLES.forEach(function (d) {
      var id = "del-" + d.label.replace(/[^a-z]/gi, "");
      h += "<div class=\"intake-check-item\"><input type=\"checkbox\" id=\"" + id + "\" value=\"" + escapeHtml(d.label) + "\"" + (state.deliverables.indexOf(d.label) !== -1 ? " checked" : "") + ">" +
        "<label for=\"" + id + "\"><strong>" + escapeHtml(d.label) + "</strong><br><span style=\"font-size:var(--text-xs);color:var(--text-soft)\">" + escapeHtml(d.desc) + "</span></label></div>";
    });
    h += "</div>";
    h += "<div class=\"service-actions\" style=\"margin-top:var(--space-2)\">" +
      "<button type=\"button\" data-action=\"select-all-deliverables\">Select all</button>" +
      "<button type=\"button\" data-action=\"clear-deliverables\">Clear selections</button></div>";
    h += navButtons(true, nextBtn());
    return h;
  }

  /* --- Stage 8: Logistics --- */
  function renderLogistics() {
    var tl = state.timeline;
    var h = stageHeader("Timeline & Logistics", "Help us understand your timeline and requirements.");
    h += "<div class=\"intake-field\"><label for=\"tl-desired\">Desired timeline</label>" +
      "<input type=\"text\" id=\"tl-desired\" value=\"" + escapeHtml(tl.desired) + "\" placeholder=\"e.g. 4-6 weeks\"></div>";
    h += "<div class=\"intake-field intake-field--half\">" +
      "<div><label for=\"tl-launch\">Launch date <span class=\"intake-optional\">Optional</span></label>" +
      "<input type=\"text\" id=\"tl-launch\" value=\"" + escapeHtml(tl.launchDate) + "\"></div>" +
      "<div><label for=\"tl-deadline\">Hard deadline <span class=\"intake-optional\">Optional</span></label>" +
      "<input type=\"text\" id=\"tl-deadline\" value=\"" + escapeHtml(tl.hardDeadline) + "\"></div></div>";
    h += "<div class=\"intake-check-item\"><input type=\"checkbox\" id=\"tl-confidential\"" + (tl.confidential ? " checked" : "") + ">" +
      "<label for=\"tl-confidential\">Project is confidential / unreleased</label></div>";
    h += "<div class=\"intake-check-item\"><input type=\"checkbox\" id=\"tl-nda\"" + (tl.ndaRequired ? " checked" : "") + ">" +
      "<label for=\"tl-nda\">NDA required</label></div>";
    h += "<div class=\"intake-check-item\"><input type=\"checkbox\" id=\"tl-shipping\"" + (tl.sampleShipping ? " checked" : "") + ">" +
      "<label for=\"tl-shipping\">Sample shipping required</label></div>";
    h += "<div class=\"intake-field\"><label for=\"tl-budget\">Investment range <span class=\"intake-optional\">Optional</span></label>" +
      "<select id=\"tl-budget\"><option value=\"\">Prefer not to say</option>" +
      "<option value=\"recommend\"" + (tl.budgetPreference === "recommend" ? " selected" : "") + ">I'd like Ingressible to recommend scope and investment</option>" +
      "<option value=\"under-5k\"" + (tl.budgetPreference === "under-5k" ? " selected" : "") + ">Under $5,000</option>" +
      "<option value=\"5k-10k\"" + (tl.budgetPreference === "5k-10k" ? " selected" : "") + ">$5,000 - $10,000</option>" +
      "<option value=\"10k-25k\"" + (tl.budgetPreference === "10k-25k" ? " selected" : "") + ">$10,000 - $25,000</option>" +
      "<option value=\"25k-50k\"" + (tl.budgetPreference === "25k-50k" ? " selected" : "") + ">$25,000 - $50,000</option>" +
      "<option value=\"50k+\"" + (tl.budgetPreference === "50k+" ? " selected" : "") + ">$50,000+</option>" +
      "<option value=\"discuss\"" + (tl.budgetPreference === "discuss" ? " selected" : "") + ">Prefer to discuss</option></select></div>";
    h += "<div class=\"intake-field\"><label for=\"tl-stakeholders\">Internal stakeholders <span class=\"intake-optional\">Optional</span></label>" +
      "<textarea id=\"tl-stakeholders\" rows=\"2\">" + escapeHtml(state.stakeholders) + "</textarea></div>";
    h += navButtons(true, nextBtn());
    return h;
  }

  /* --- Stage 9: Files --- */
  function renderFiles() {
    var h = stageHeader("Supporting Files", "Upload any relevant documents. All uploads are optional.");
    h += "<div class=\"file-upload-zone\" tabindex=\"0\" role=\"button\" aria-label=\"Upload files\">" +
      "<div class=\"file-upload-zone__icon\" aria-hidden=\"true\">&#x1F4C1;</div>" +
      "<p class=\"file-upload-zone__text\"><strong>Click to upload</strong> or drag and drop</p>" +
      "<p class=\"file-upload-zone__text\" style=\"font-size:var(--text-xs)\">PDF, DOC, DOCX, PNG, JPG, SVG up to 10MB each</p>" +
      "<input type=\"file\" id=\"file-input\" multiple accept=\".pdf,.doc,.docx,.png,.jpg,.jpeg,.svg\"></div>";
    h += "<div class=\"file-list\" id=\"file-list\"></div>";
    h += navButtons(true, nextBtn());
    return h;
  }

  function renderFileList() {
    var list = $("#file-list");
    if (!list) return;
    list.innerHTML = "";
    state.files.forEach(function (f, i) {
      var item = el("div", { className: "file-item" }, [
        el("span", { className: "file-item__name", text: f.name }),
        el("span", { className: "file-item__size", text: formatSize(f.size) }),
        el("button", { className: "file-item__remove", type: "button", text: "Remove", "aria-label": "Remove " + f.name, onclick: function () {
          state.files.splice(i, 1); renderFileList(); saveDraft();
        }})
      ]);
      list.appendChild(item);
    });
  }
  function formatSize(b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }

  /* --- Stage 10: Review --- */
  function renderReview() {
    var h = stageHeader("Review Your Consultation", "Review everything before submitting. Edit any section if needed.");
    h += renderAiPanelHtml();
    h += reviewSection("Brand & Contact", 1, [
      ["Brand", state.brand.company],
      ["Contact", state.brand.contactName + (state.brand.role ? ", " + state.brand.role : "")],
      ["Email", state.brand.email],
      ["Website", state.brand.website],
      ["Organization", state.brand.orgType]
    ]);
    h += reviewSection("Project Goals", 2, [
      ["Brand Intention", state.brand.brandIntention],
      ["Project Stage", state.project.stage],
      ["Business Decision", state.project.businessDecision]
    ]);
    h += reviewSection("Selected Services", 3, null, renderServiceTags());
    if (state.connectedJourney) {
      h += reviewSection("Connected Journey", 4, [["Approach", state.connectedJourney]]);
    }
    h += reviewSection("Deliverables", 7, [["Deliverables", state.deliverables.join(", ") || "None selected"]]);
    h += reviewSection("Timeline", 8, [
      ["Timeline", state.timeline.desired],
      ["Launch Date", state.timeline.launchDate],
      ["Confidential", state.timeline.confidential ? "Yes" : "No"],
      ["NDA Required", state.timeline.ndaRequired ? "Yes" : "No"],
      ["Budget", state.budgetPreference || "Prefer not to say"]
    ]);
    if (state.files.length > 0) {
      h += reviewSection("Files", 9, [["Files", state.files.map(function (f) { return f.name; }).join(", ")]]);
    }
    h += renderExperienceMap();
    h += "<div class=\"intake-consent\">" +
      "<label><input type=\"checkbox\" id=\"consent-check\"" + (state.consent ? " checked" : "") + "> " +
      "I confirm that the information provided may be used by Ingressible to evaluate and prepare this consultation.</label></div>";
    h += navButtons(true, "<button type=\"button\" class=\"btn--primary\" data-action=\"submit\">Submit Consultation</button>");
    return h;
  }

  function reviewSection(title, step, items, customHtml) {
    var h = "<div class=\"review-section\"><div class=\"review-section__head\">" +
      "<h3 class=\"review-section__title\">" + escapeHtml(title) + "</h3>" +
      "<button type=\"button\" class=\"review-edit-btn\" data-action=\"edit\" data-step=\"" + step + "\">Edit</button></div>";
    h += "<div class=\"review-section__body\">";
    if (customHtml) { h += customHtml; }
    else if (items) {
      h += "<dl>";
      items.forEach(function (item) {
        if (item[1]) { h += "<dt>" + escapeHtml(item[0]) + "</dt><dd>" + escapeHtml(item[1]) + "</dd>"; }
      });
      h += "</dl>";
    }
    h += "</div></div>";
    return h;
  }

  function renderServiceTags() {
    var h = "<div class=\"review-services\">";
    state.selectedServices.forEach(function (id) {
      var svc = findService(id);
      if (svc) h += "<span class=\"review-service-tag\">" + escapeHtml(svc.label) + "</span>";
    });
    h += "</div>";
    return h;
  }

  function findService(id) {
    var all = [];
    Object.keys(SERVICES).forEach(function (g) { SERVICES[g].items.forEach(function (i) { all.push(i); }); });
    for (var i = 0; i < all.length; i++) { if (all[i].id === id) return all[i]; }
    return null;
  }

  function renderAiPanelHtml() {
    var analysis = analyzeScope();
    if (analysis.suggestions.length === 0 && analysis.missing.length === 0 && analysis.workstreams.length <= 1) return "";
    var body = "<div class=\"ai-panel__body\">";
    body += "<p>" + escapeHtml(analysis.summary) + "</p>";
    if (analysis.workstreams.length > 0) {
      body += "<p><strong>Possible workstreams:</strong></p><ul style=\"margin:0.3rem 0;padding-left:1.2rem\">";
      analysis.workstreams.forEach(function (w) {
        body += "<li>" + escapeHtml(w.name) + " — " + escapeHtml(w.reason) + "</li>";
      });
      body += "</ul>";
    }
    if (analysis.missing.length > 0) {
      body += "<p><strong>Missing information:</strong></p><ul style=\"margin:0.3rem 0;padding-left:1.2rem\">";
      analysis.missing.forEach(function (m) {
        body += "<li>" + escapeHtml(m.reason) + (m.requiredForScope ? " (required)" : "") + "</li>";
      });
      body += "</ul>";
    }
    body += "</div>";
    return "<div class=\"ai-panel\"><div class=\"ai-panel__head\">" +
      "<div class=\"ai-panel__icon\" aria-hidden=\"true\">IA</div>" +
      "<div class=\"ai-panel__title\">Scope Summary</div></div>" + body + "</div>";
  }

  function renderExperienceMap() {
    var svcs = state.selectedServices;
    if (svcs.length === 0) return "";
    var steps = [];
    if (svcs.indexOf("web") !== -1 || svcs.indexOf("mobile-web") !== -1) steps.push({ label: "Discover", platforms: "Web" });
    if (svcs.indexOf("ios") !== -1 || svcs.indexOf("android") !== -1) steps.push({ label: "Engage", platforms: "Mobile App" });
    if (svcs.indexOf("retail") !== -1) steps.push({ label: "Visit", platforms: "In-Store" });
    if (svcs.some(function (s) { return ["fragrance", "makeup", "body-care"].indexOf(s) !== -1; })) steps.push({ label: "Experience", platforms: "Physical Product" });
    if (steps.length === 0) steps.push({ label: "Engage", platforms: svcs.length + " services" });

    var h = "<div class=\"experience-map\"><p class=\"experience-map__title\">Your Experience Map</p><div class=\"experience-map__flow\">";
    steps.forEach(function (s, i) {
      h += "<div class=\"experience-map__step\"><div class=\"experience-map__node\">" + (i + 1) + "</div>" +
        "<div><div class=\"experience-map__label\">" + escapeHtml(s.label) + "</div>" +
        "<div class=\"experience-map__platforms\">" + escapeHtml(s.platforms) + "</div></div></div>";
      if (i < steps.length - 1) h += "<div class=\"experience-map__arrow\" aria-hidden=\"true\"></div>";
    });
    h += "</div></div>";
    return h;
  }

  /* --- Stage 11: Submit --- */
  function renderSubmit() {
    return "<div class=\"intake-stage__header\" aria-busy=\"true\" aria-live=\"polite\">" +
      "<h2>Submitting your consultation&hellip;</h2></div>" +
      "<p style=\"color:var(--text-soft)\" role=\"status\">Please keep this page open while we securely save your consultation.</p>";
  }

  /* --- Success --- */
  function renderSuccess() {
    var sid = state.submissionId || uuid();
    var ref = state.publicReference || sid;
    var svcs = state.selectedServices.map(function (id) { var s = findService(id); return s ? s.label : id; });
    /* Preserve a submitted snapshot for refresh-restore, then clear the
       editable draft so a stale draft can never overwrite the confirmation. */
    saveSubmittedSnapshot();
    clearDraft();
    return "<div class=\"intake-success\">" +
      "<div class=\"intake-success__icon\" aria-hidden=\"true\">&#x2713;</div>" +
      "<h1>Your consultation request has been received.</h1>" +
      "<p class=\"intake-success__id\">Reference " + escapeHtml(ref) + "</p>" +
      "<div class=\"intake-success__details\"><dl>" +
      "<dt>Brand</dt><dd>" + escapeHtml(state.brand.company) + "</dd>" +
      "<dt>Services</dt><dd>" + escapeHtml(svcs.join(", ")) + "</dd>" +
      "<dt>Project Stage</dt><dd>" + escapeHtml(state.project.stage) + "</dd>" +
      "</dl></div>" +
      "<div class=\"intake-success__next\"><p><strong>What happens next</strong></p>" +
      "<p>I&rsquo;ll review the information you shared and follow up by email to discuss fit, scheduling, and next steps.</p>" +
      "<p class=\"intake-hint\">Submitting a consultation request does not create a binding engagement or require payment.</p>" +
      "<p class=\"intake-hint\"><a href=\"index.html\" class=\"btn--secondary\" style=\"text-decoration:none\">Return Home</a></p>" +
      "</div>";
  }

  /* Render confirmation from a saved snapshot (refresh after submit).
     Never resubmits, never fires IntakeSubmittedEvent. */
  function renderSuccessFromSnapshot(snap) {
    var svcLabels = (snap.selectedServices || []).map(function (id) {
      var s = findService(id); return s ? s.label : id;
    });
    var h = "<div class=\"intake-success\">" +
      "<div class=\"intake-success__icon\" aria-hidden=\"true\">&#x2713;</div>" +
      "<h1 tabindex=\"-1\" id=\"success-restored-heading\">Your consultation request has been received.</h1>" +
      "<p class=\"intake-success__id\">Reference " + escapeHtml(snap.submissionId || "") + "</p>" +
      "<div class=\"intake-success__details\"><dl>" +
      "<dt>Brand</dt><dd>" + escapeHtml(snap.brand || "") + "</dd>" +
      "<dt>Services</dt><dd>" + escapeHtml(svcLabels.join(", ")) + "</dd>" +
      "<dt>Project Stage</dt><dd>" + escapeHtml(snap.projectStage || "") + "</dd>" +
      "</dl></div>" +
      "<div class=\"intake-success__next\"><p><strong>What happens next</strong></p>" +
      "<p>I&rsquo;ll review the information you shared and follow up by email to discuss fit, scheduling, and next steps.</p>" +
      "<p class=\"intake-hint\">Submitting a consultation request does not create a binding engagement or require payment.</p>" +
      "<p class=\"intake-hint\"><a href=\"index.html\" class=\"btn--secondary\" style=\"text-decoration:none\">Return Home</a></p>" +
      "</div>";
    return h;
  }

  /* --- Helper --- */
  function stageHeader(title, desc) {
    return "<div class=\"intake-stage__header\"><h2>" + escapeHtml(title) + "</h2>" +
      (desc ? "<p>" + escapeHtml(desc) + "</p>" : "") + "</div>";
  }

  /* ---------- Event Attachment ---------- */
  function attachEvents() {
    root.addEventListener("click", handleClick);
    root.addEventListener("change", handleChange);
    root.addEventListener("input", handleInput);
    root.addEventListener("keydown", handleKeydown);
  }

  function handleClick(e) {
    var target = e.target.closest("[data-action]");
    if (!target) {
      var card = e.target.closest(".service-card");
      if (card) { toggleService(card); return; }
      var rc = e.target.closest(".intake-radio-card");
      if (rc) { selectRadio(rc); return; }
      var zone = e.target.closest(".file-upload-zone");
      if (zone) { zone.querySelector("input[type=file]").click(); return; }
      return;
    }
    var action = target.getAttribute("data-action");
    if (action === "next") goNext();
    else if (action === "back") goBack();
    else if (action === "select-all") selectAllServices();
    else if (action === "clear-services") clearServices();
    else if (action === "select-all-tasks") selectAllTasks();
    else if (action === "clear-tasks") clearTasks();
    else if (action === "select-all-deliverables") selectAllDeliverables();
    else if (action === "clear-deliverables") clearDeliverables();
    else if (action === "add-product") addProduct();
    else if (action === "remove-product") removeProduct(target);
    else if (action === "submit") submitIntake();
    else if (action === "retry-submit") { isSubmitting = false; markSubmissionStatus("draft"); currentStep = 10; render(); setTimeout(submitIntake, 150); }
    else if (action === "back-to-review") { isSubmitting = false; markSubmissionStatus("draft"); currentStep = 10; render(); }
    else if (action === "edit") { currentStep = parseInt(target.getAttribute("data-step"), 10); render(); }
  }

  function clearSingleFieldError(target) {
    if (!target) return;
    target.removeAttribute("aria-invalid");
    target.removeAttribute("aria-describedby");
    /* Remove the inline error associated with this control. */
    var describedBy = target.getAttribute("data-error-id");
    var inline = null;
    if (describedBy) inline = root.querySelector("#" + describedBy);
    if (!inline) {
      var wrap = target.closest ? target.closest(".intake-field, .intake-radio-group, .service-groups, .intake-consent") : null;
      if (wrap) inline = wrap.querySelector(".intake-inline-error");
    }
    if (inline && inline.parentNode) inline.parentNode.removeChild(inline);
    var wrap2 = target.closest ? target.closest(".intake-field--error") : null;
    if (wrap2 && !wrap2.querySelector(".intake-inline-error")) wrap2.classList.remove("intake-field--error");
    /* If no inline errors remain, remove the summary too. */
    if (!root.querySelector(".intake-inline-error")) {
      var summary = root.querySelector(".intake-error-summary");
      if (summary) summary.remove();
    }
  }

  function handleChange(e) {
    var t = e.target;
    if (t.type === "file") { handleFiles(t.files); return; }
    if (t.getAttribute("aria-invalid") === "true" && (t.checked || t.value)) clearSingleFieldError(t);
    saveFieldValues();
  }

  function handleInput(e) {
    var t = e.target;
    if (t.getAttribute("aria-invalid") === "true" && t.value) clearSingleFieldError(t);
  }

  function handleKeydown(e) {
    if (e.key === "Enter" && e.target.classList.contains("intake-radio-card")) {
      e.preventDefault();
      selectRadio(e.target);
    }
  }

  function hasServiceScopeData(serviceId) {
    switch (serviceId) {
      case "fragrance":
        return state.fragranceScope.moments.length > 0 || state.fragranceScope.components.length > 0 || state.fragranceScope.questions;
      case "makeup":
        return state.makeupScope.areas.length > 0 || state.makeupScope.similarDistinguishable;
      case "body-care":
        return state.bodyCareScope.areas.length > 0;
      case "packaging":
        return state.packagingScope.components.length > 0 || state.packagingScope.questions;
      case "web":
        return state.webScope.prodUrl || state.webScope.stagingUrl || state.webScope.criticalFlows;
      case "mobile-web":
        return state.mobileWebScope.responsiveUrl || state.mobileWebScope.criticalJourneys;
      case "ios":
        return state.iosScope.appName || state.iosScope.criticalWorkflows;
      case "android":
        return state.androidScope.appName || state.androidScope.criticalWorkflows;
      case "remediation":
        return state.remediationScope.issuesIdentified || state.remediationScope.existingReport;
      case "retest":
        return state.retestScope.originalAudit || state.retestScope.findingIds;
      case "retail":
        return state.retailScope.storeType || state.retailScope.locations || state.retailScope.areas;
      case "customer-service":
      case "connected-journey":
      case "prototype":
      case "other-beauty":
      case "assessment":
      case "strategy":
      case "training":
      case "research":
      case "custom":
        return false;
      default:
        return false;
    }
  }

  function toggleService(card) {
    var id = card.getAttribute("data-service");
    var idx = state.selectedServices.indexOf(id);
    if (idx === -1) {
      state.selectedServices.push(id);
      card.setAttribute("aria-pressed", "true");
      track("intake_service_selected", { service: id });
    } else {
      var hasScope = hasServiceScopeData(id);
      if (hasScope) {
        if (!confirm("Removing \"" + getServiceLabel(id) + "\" will discard its scope details. Continue?")) {
          return;
        }
        clearServiceScopeData(id);
      }
      state.selectedServices.splice(idx, 1);
      card.setAttribute("aria-pressed", "false");
      track("intake_service_removed", { service: id });
    }
    var count = root.querySelector(".intake-status");
    if (count) count.textContent = state.selectedServices.length + " service" + (state.selectedServices.length !== 1 ? "s" : "") + " selected";
    saveDraft();
  }

  function getServiceLabel(id) {
    var allServices = [];
    Object.keys(SERVICES).forEach(function (g) { SERVICES[g].items.forEach(function (i) { allServices.push(i); }); });
    var svc = allServices.find(function (s) { return s.id === id; });
    return svc ? svc.label : id;
  }

  function clearServiceScopeData(id) {
    switch (id) {
      case "fragrance":
        state.fragranceScope = { moments: [], components: [], questions: "" };
        break;
      case "makeup":
        state.makeupScope = { areas: [], similarDistinguishable: "", questions: "" };
        break;
      case "body-care":
        state.bodyCareScope = { areas: [], questions: "" };
        break;
      case "packaging":
        state.packagingScope = { components: [], questions: "" };
        break;
      case "web":
        state.webScope = { prodUrl: "", stagingUrl: "", authenticated: false, testAccount: "", cms: "", designSystem: "", thirdParty: "", criticalFlows: "", browsers: "", standards: "" };
        break;
      case "mobile-web":
        state.mobileWebScope = { responsiveUrl: "", criticalJourneys: "", targetBrowsers: "", targetDevices: "", orientation: "", textResizing: "" };
        break;
      case "ios":
        state.iosScope = { appName: "", appStoreUrl: "", buildInfo: "", version: "", buildNumber: "", targetDevices: "", targetIos: "", authentication: "", testAccount: "", criticalWorkflows: "" };
        break;
      case "android":
        state.androidScope = { appName: "", playStoreUrl: "", buildInfo: "", version: "", buildNumber: "", targetDevices: "", targetAndroid: "", authentication: "", testAccount: "", criticalWorkflows: "" };
        break;
      case "remediation":
        state.remediationScope = { issuesIdentified: "", identifiedBy: "", existingReport: "", implementers: "", sourceAccess: "", designAccess: "", handoffAudiences: [] };
        break;
      case "retest":
        state.retestScope = { originalAudit: "", findingIds: "", originalVersion: "", newVersion: "", fixSummary: "", targetEnvironments: "", targetAt: "", reproduceConditions: false };
        break;
      case "retail":
        state.retailScope = { storeType: "", locations: "", numLocations: "", authorizationStatus: "", areas: "", restrictions: "", photography: false, staffParticipation: false, digitalKiosks: false, excludedAreas: "" };
        break;
    }
  }

  function selectRadio(card) {
    var group = card.getAttribute("data-radio-group");
    var value = card.getAttribute("data-value");
    $$("[data-radio-group=\"" + group + "\"]", root).forEach(function (c) {
      c.setAttribute("aria-checked", "false");
      c.style.borderColor = "";
      c.style.background = "";
    });
    card.setAttribute("aria-checked", "true");
    card.style.borderColor = "var(--berry)";
    card.style.background = "rgba(145, 61, 102, 0.06)";
    var input = card.querySelector("input");
    if (input) input.checked = true;
    state[group] = value;
    saveDraft();
  }

  function selectAllServices() {
    var allIds = [];
    Object.keys(SERVICES).forEach(function (g) { SERVICES[g].items.forEach(function (i) { allIds.push(i.id); }); });
    state.selectedServices = allIds;
    $$(".service-card", root).forEach(function (c) { c.setAttribute("aria-pressed", "true"); });
    var count = root.querySelector(".intake-status");
    if (count) count.textContent = allIds.length + " services selected";
    track("intake_service_selected", { service: "all" });
    saveDraft();
  }

  function clearServices() {
    state.selectedServices = [];
    $$(".service-card", root).forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
    var count = root.querySelector(".intake-status");
    if (count) count.textContent = "0 services selected";
    saveDraft();
  }

  function selectAllTasks() {
    state.customerTasks = CUSTOMER_TASKS.map(function (t) { return t.label; });
    $$("input[type=checkbox][id^=\"task-\"]", root).forEach(function (cb) { cb.checked = true; });
    track("intake_tasks_selected", { count: state.customerTasks.length });
    saveDraft();
  }

  function clearTasks() {
    state.customerTasks = [];
    $$("input[type=checkbox][id^=\"task-\"]", root).forEach(function (cb) { cb.checked = false; });
    track("intake_tasks_cleared", {});
    saveDraft();
  }

  function selectAllDeliverables() {
    state.deliverables = DELIVERABLES.map(function (d) { return d.label; });
    $$("input[type=checkbox][id^=\"del-\"]", root).forEach(function (cb) { cb.checked = true; });
    track("intake_deliverables_selected", { count: state.deliverables.length });
    saveDraft();
  }

  function clearDeliverables() {
    state.deliverables = [];
    $$("input[type=checkbox][id^=\"del-\"]", root).forEach(function (cb) { cb.checked = false; });
    track("intake_deliverables_cleared", {});
    saveDraft();
  }

  function addProduct() {
    state.products.push({ name: "", category: "", sku: "", version: "", prototypeVersion: "", stage: "", variants: "", packagingType: "", components: [], conditions: [], notes: "" });
    saveDraft();
    render();
  }

  function removeProduct(btn) {
    var index = parseInt(btn.getAttribute("data-product-index"), 10);
    var hasContent = btn.getAttribute("data-has-content") === "true";
    if (hasContent) {
      if (!confirm("This product has details entered. Removing it will discard all its data. Continue?")) {
        return;
      }
    }
    state.products.splice(index, 1);
    saveDraft();
    render();
  }

  function handleFiles(fileList) {
    Array.prototype.forEach.call(fileList, function (f) {
      if (f.size > 10 * 1024 * 1024) return;
      state.files.push({ name: f.name, size: f.size, type: f.type });
    });
    saveDraft();
    renderFileList();
  }

  /* ---------- Field Value Capture ---------- */
  /* Only update state for fields actually present in the DOM.
     Never overwrite stored values with blanks from other steps. */
  function saveFieldValues() {
    var b = state.brand;
    var get = function (id) { return root.querySelector("#" + id); };
    var setVal = function (obj, key, id) {
      var el = get(id);
      if (el && typeof el.value !== "undefined") obj[key] = el.value;
    };
    var setChecked = function (obj, key, id) {
      var el = get(id);
      if (el && typeof el.checked !== "undefined") obj[key] = el.checked;
    };
    setVal(b, "company", "brand-company");
    setVal(b, "contactName", "brand-contact");
    setVal(b, "role", "brand-role");
    setVal(b, "email", "brand-email");
    setVal(b, "website", "brand-website");
    setVal(b, "orgType", "brand-orgtype");
    setVal(b, "brandIntention", "brand-intention");
    var stageCards = $$("[data-radio-group=\"projectStage\"]", root);
    if (stageCards.length > 0) {
      state.project.stage = "";
      stageCards.forEach(function (rc) {
        if (rc.getAttribute("aria-checked") === "true") state.project.stage = rc.getAttribute("data-value");
      });
    }
    setVal(state.project, "businessDecision", "business-decision");
    var journeyCards = $$("[data-radio-group=\"connectedJourney\"]", root);
    if (journeyCards.length > 0) {
      state.connectedJourney = "";
      journeyCards.forEach(function (rc) {
        if (rc.getAttribute("aria-checked") === "true") state.connectedJourney = rc.getAttribute("data-value");
      });
    }
    setVal(state, "customerTasksFree", "tasks-free");
    var taskBoxes = $$("input[type=checkbox][id^=\"task-\"]", root);
    if (taskBoxes.length > 0) {
      state.customerTasks = [];
      taskBoxes.forEach(function (cb) { if (cb.checked) state.customerTasks.push(cb.value); });
    }
    var delBoxes = $$("input[type=checkbox][id^=\"del-\"]", root);
    if (delBoxes.length > 0) {
      state.deliverables = [];
      delBoxes.forEach(function (cb) { if (cb.checked) state.deliverables.push(cb.value); });
    }
    setVal(state.timeline, "desired", "tl-desired");
    setVal(state.timeline, "launchDate", "tl-launch");
    setVal(state.timeline, "hardDeadline", "tl-deadline");
    setChecked(state.timeline, "confidential", "tl-confidential");
    setChecked(state.timeline, "ndaRequired", "tl-nda");
    setChecked(state.timeline, "sampleShipping", "tl-shipping");
    setVal(state, "budgetPreference", "tl-budget");
    setVal(state, "stakeholders", "tl-stakeholders");
    setChecked(state, "consent", "consent-check");
    saveScopeValues();
  }

  function saveScopeValues() {
    var get = function (id) { return root.querySelector("#" + id); };
    var v = function (id) { var el = get(id); return el ? el.value : null; };
    var c = function (id) { var el = get(id); return el ? el.checked : null; };
    var setV = function (obj, key, id) { var val = v(id); if (val !== null) obj[key] = val; };
    var setC = function (obj, key, id) { var val = c(id); if (val !== null) obj[key] = val; };
    var ch = function (prefix) {
      var boxes = $$("input[type=checkbox][id^=\"" + prefix + "\"]", root);
      if (boxes.length === 0) return null;
      var arr = [];
      boxes.forEach(function (cb) { if (cb.checked) arr.push(cb.value); });
      return arr;
    };
    var setCh = function (obj, key, prefix) { var val = ch(prefix); if (val !== null) obj[key] = val; };
    setCh(state.fragranceScope, "moments", "frag-moment-");
    setCh(state.fragranceScope, "components", "frag-comp-");
    setV(state.fragranceScope, "questions", "frag-questions");
    setCh(state.makeupScope, "areas", "makeup-");
    setV(state.makeupScope, "similarDistinguishable", "makeup-distinguish");
    setCh(state.bodyCareScope, "areas", "body-");
    setC(state.physicalScope, "testArticle", "phys-testArticle");
    setC(state.physicalScope, "photography", "phys-photography");
    setC(state.physicalScope, "video", "phys-video");
    setC(state.physicalScope, "measurement", "phys-measurement");
    setC(state.physicalScope, "destructive", "phys-destructive");
    setC(state.physicalScope, "confidential", "phys-confidential");
    setC(state.physicalScope, "ndaRequired", "phys-ndaRequired");
    setV(state.webScope, "prodUrl", "web-prod");
    setV(state.webScope, "stagingUrl", "web-stage");
    setV(state.webScope, "criticalFlows", "web-critical");
    setV(state.webScope, "standards", "web-standards");
    setC(state.webScope, "authenticated", "web-auth");
    setV(state.mobileWebScope, "responsiveUrl", "mweb-url");
    setV(state.mobileWebScope, "criticalJourneys", "mweb-journeys");
    setV(state.mobileWebScope, "targetBrowsers", "mweb-browsers");
    setV(state.iosScope, "appName", "ios-name");
    setV(state.iosScope, "appStoreUrl", "ios-url");
    setV(state.iosScope, "criticalWorkflows", "ios-workflows");
    setC(state.iosScope, "authentication", "ios-auth");
    setV(state.androidScope, "appName", "and-name");
    setV(state.androidScope, "playStoreUrl", "and-url");
    setV(state.androidScope, "criticalWorkflows", "and-workflows");
    setC(state.androidScope, "authentication", "and-auth");
    setV(state.remediationScope, "issuesIdentified", "rem-issues");
    setV(state.remediationScope, "identifiedBy", "rem-who");
    setC(state.remediationScope, "existingReport", "rem-report");
    setV(state.remediationScope, "sourceAccess", "rem-source");
    setV(state.retestScope, "originalVersion", "rt-original");
    setV(state.retestScope, "newVersion", "rt-new");
    setV(state.retestScope, "fixSummary", "rt-fixes");
    setV(state.researchScope, "decision", "res-decision");
    setV(state.researchScope, "perspectives", "res-perspectives");
    setC(state.researchScope, "existingProcedures", "res-procedures");
    setV(state.retailScope, "storeType", "retail-type");
    setV(state.retailScope, "locations", "retail-locations");
    setV(state.retailScope, "areas", "retail-areas");
    setV(state.retailScope, "restrictions", "retail-restrictions");
    setC(state.retailScope, "photography", "retail-photo");
    setC(state.retailScope, "staffParticipation", "retail-staff");
    state.products.forEach(function (p, i) {
      var pe = root.querySelector("[data-product=\"" + i + "\"]");
      if (!pe) return;
      var container = pe.closest("[style*=\"background\"]") || pe.closest("div");
      if (container) {
        var inputs = container.querySelectorAll("input, textarea");
        inputs.forEach(function (inp) {
          var field = inp.getAttribute("data-field");
          if (field) state.products[i][field] = inp.value;
        });
      }
    });
  }

  /* ---------- Navigation ---------- */
  function goNext() {
    saveFieldValues();
    var errors = validateStep(currentStep);
    if (errors.length > 0) { showErrors(errors); return; }
    if (currentStep < totalSteps - 1) {
      currentStep++;
      track("intake_step_completed", { step: currentStep });
      render();
    }
  }

  function goBack() {
    saveFieldValues();
    if (currentStep > 0) { currentStep--; render(); }
  }

  /* ---------- Submission ---------- */
  /* ==========================================================================
     Event-Driven Intake Workflow
     --------------------------------------------------------------------------
     Lifecycle:
       Website submission
       -> IntakeSubmittedEvent (after persistence, idempotent)
       -> preliminary scope

       Google Meet (later)
       -> meeting notes / transcript
       -> ConsultationMeetingProcessedEvent (enrichment, never overwrites)
       -> Kechi review -> approved scope -> proposal

     Downstream processing is triggered ONLY by IntakeSubmittedEvent.
     Never triggered for: page load, draft, autosave, step completion,
     service selection/removal, AI clarification, review opening, abandonment.

     Submission ID is the idempotency key. A submission triggers downstream
     processing only once unless an authorized retry is explicitly required.
     ========================================================================== */

  /* ---------- Intake Event Bus ----------
     Local pub/sub for lifecycle events. Server-side listeners (webhooks,
     queue consumers) subscribe to IntakeSubmittedEvent externally. */
  var IntakeEventBus = (function () {
    var listeners = {};
    var processedIds = {};
    try {
      var saved = localStorage.getItem("ingressible-processed-events");
      if (saved) processedIds = JSON.parse(saved) || {};
    } catch (e) {}
    function persistProcessed() {
      try { localStorage.setItem("ingressible-processed-events", JSON.stringify(processedIds)); } catch (e) {}
    }
    return {
      on: function (eventType, handler) {
        if (!listeners[eventType]) listeners[eventType] = [];
        listeners[eventType].push(handler);
      },
      emit: function (event) {
        if (!event || !event.type) return;
        /* Idempotency: IntakeSubmittedEvent processes once per submission ID. */
        if (event.type === "IntakeSubmittedEvent" && event.submissionId) {
          var key = "submitted:" + event.submissionId;
          if (processedIds[key] && !event.authorizedRetry) return false;
          processedIds[key] = { at: new Date().toISOString(), status: event.status || "submitted" };
          persistProcessed();
        }
        var handlers = listeners[event.type] || [];
        handlers.forEach(function (h) {
          try { h(event); } catch (e) {}
        });
        /* Also dispatch as DOM event for external integrations. */
        window.dispatchEvent(new CustomEvent(event.type, { detail: event }));
        track("intake_event_" + event.type.toLowerCase(), { submissionId: event.submissionId || null });
        return true;
      },
      wasProcessed: function (submissionId) {
        return !!processedIds["submitted:" + submissionId];
      },
      markStatus: function (submissionId, status) {
        var key = "submitted:" + submissionId;
        if (!processedIds[key]) processedIds[key] = {};
        processedIds[key].status = status;
        processedIds[key].updatedAt = new Date().toISOString();
        persistProcessed();
      }
    };
  })();

  /* ---------- Meeting Enrichment ----------
     ConsultationMeetingProcessedEvent is a SEPARATE event from submission.
     Meeting artifacts (notes/transcripts) are source material only — never
     accessibility findings, never evidence of a Barrier. Original website
     submission is preserved. Conflicts require Kechi review. */
  var MeetingEnrichment = {
    process: function (submissionId, artifacts) {
      /* artifacts: { notes: string, transcript: string, source: "google-meet", recordedAt, attendees } */
      if (!submissionId || !IntakeEventBus.wasProcessed(submissionId)) return null;
      var enrichment = {
        type: "ConsultationMeetingProcessedEvent",
        submissionId: submissionId,
        engagementId: submissionId,
        recordedAt: (artifacts && artifacts.recordedAt) || new Date().toISOString(),
        source: (artifacts && artifacts.source) || "google-meet",
        proposedUpdates: [],
        conflicts: [],
        newInformation: { services: [], products: [], platforms: [], timelines: [], deliverables: [], decisions: [] },
        unresolvedQuestions: [],
        requiresKechiReview: true,
        automatedScope: false
      };
      IntakeEventBus.emit(enrichment);
      return enrichment;
    },
    flag: function (submissionId, kind, detail) {
      var e = {
        type: "ConsultationMeetingProcessedEvent",
        submissionId: submissionId,
        kind: kind,
        detail: detail || {},
        requiresKechiReview: true,
        recordedAt: new Date().toISOString()
      };
      IntakeEventBus.emit(e);
      return e;
    }
  };
  window.IngressibleMeetingEnrichment = MeetingEnrichment;
  window.IngressibleIntakeEvents = IntakeEventBus;

  /* ---------- Status helpers ----------
     Statuses: draft, submitted, needs_review, processing_failed,
     consultation_scheduled, proposal_ready, closed. */
  function markSubmissionStatus(status) {
    state.status = status;
    if (state.submissionId) IntakeEventBus.markStatus(state.submissionId, status);
    saveDraft();
  }

  function submitIntake() {
    saveFieldValues();
    var errors = validateStep(currentStep);
    if (errors.length > 0) { showErrors(errors); return; }
    if (isSubmitting) return;
    /* Do not create a duplicate: if already submitted with this ID, show success. */
    if (state.submissionId && state.status !== "draft" && IntakeEventBus.wasProcessed(state.submissionId)) {
      currentStep = totalSteps + 1;
      render();
      return;
    }
    isSubmitting = true;
    /* Stable submission ID = idempotency key. Generated once, preserved. */
    if (!state.submissionId) state.submissionId = uuid();
    markSubmissionStatus("submitted");
    track("intake_submitted", { services: state.selectedServices, brand: state.brand.company });
    var submitBtn = root.querySelector("[data-action=\"submit\"]");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting\u2026";
      submitBtn.setAttribute("aria-busy", "true");
    }
    /* Announce busy state to assistive technology. */
    var stageEl = root.querySelector(".intake-stage");
    if (stageEl) stageEl.setAttribute("aria-busy", "true");

    var payload;
    try {
      payload = buildSubmissionPayload(state.submissionId);
    } catch (buildErr) {
      /* Payload build failure -> reset, keep data, show retry. Never hang. */
      isSubmitting = false;
      markSubmissionStatus("draft");
      showSubmissionError("build");
      return;
    }

    /* AbortController with timeout: no external dependency may leave the
       user-facing request Pending forever. 30s is generous for Formspree. */
    var controller = null;
    var timeoutId = null;
    try {
      if (typeof AbortController !== "undefined") {
        controller = new AbortController();
        timeoutId = setTimeout(function () {
          try { controller.abort(); } catch (e) {}
        }, 30000);
      }
    } catch (e) { controller = null; }

    function settle() {
      isSubmitting = false;
      if (timeoutId) { try { clearTimeout(timeoutId); } catch (e) {} }
      var btn = root.querySelector("[data-action=\"submit\"]");
      if (btn) btn.removeAttribute("aria-busy");
      var st = root.querySelector(".intake-stage");
      if (st) st.removeAttribute("aria-busy");
    }

    // Production Edge Function endpoint (Supabase public API).
// This URL is safe to expose in the browser; the function is designed for
// anonymous use and CORS is configured on the server side.
const SUBMIT_CONSULTATION_ENDPOINT =
  "https://hnldnxbwxwrkpjarykyf.supabase.co/functions/v1/submit-consultation";

var endpoint = SUBMIT_CONSULTATION_ENDPOINT;

    var fetchOpts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    };
    if (controller) fetchOpts.signal = controller.signal;

    fetch(endpoint, fetchOpts).then(function (r) {
      settle();
      if (r && r.ok) {
        return r.json().then(function (data) {
          if (data && data.success && data.submissionId && data.publicReference) {
            state.publicReference = data.publicReference;
            try {
              onSubmissionPersisted(data.submissionId);
            } catch (persistErr) {
              try { onDownstreamFailure(data.submissionId, "event_emit_failed"); } catch (e) {}
            }
            currentStep = totalSteps + 1;
            render();
            moveFocusToSuccess();
          } else {
            markSubmissionStatus("draft");
            showSubmissionError("unexpected_response");
          }
        });
      } else {
        /* Persistence failed -> keep draft, allow retry, no downstream trigger. */
        markSubmissionStatus("draft");
        showSubmissionError(r && r.status ? ("http_" + r.status) : "http");
      }
    }).catch(function (fetchErr) {
      settle();
      /* Network failure / timeout / abort -> keep intake, never erase. */
      markSubmissionStatus("draft");
      var reason = (fetchErr && fetchErr.name === "AbortError") ? "timeout" : "network";
      showSubmissionError(reason);
    });
  }

  function moveFocusToSuccess() {
    setTimeout(function () {
      var h = root.querySelector(".intake-success h1");
      if (h) {
        if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1");
        try { h.focus({ preventScroll: true }); } catch (e) { try { h.focus(); } catch (e2) {} }
        try { h.scrollIntoView({ block: "start" }); } catch (e) {}
      }
    }, 100);
  }

  function buildSubmissionPayload(submissionId) {
    var snap = JSON.parse(JSON.stringify(state));
    delete snap.files;
    delete snap.step;
    return {
      _subject: "[Ingressible Intake] " + (state.brand.company || "Unknown") + " \u2014 New Consultation",
      submissionId: submissionId,
      idempotencyKey: submissionId,
      schemaVersion: 1,
      status: "submitted",
      brand: state.brand.company,
      contact: state.brand.contactName,
      email: state.brand.email,
      services: state.selectedServices.join(", "),
      projectStage: state.project.stage,
      brandIntention: state.brand.brandIntention,
      businessDecision: state.project.businessDecision,
      budget: state.budgetPreference,
      timeline: state.timeline.desired,
      confidential: state.timeline.confidential,
      nda: state.timeline.ndaRequired,
      deliverables: state.deliverables.join(", "),
      fullIntake: JSON.stringify(snap)
    };
  }

  /* Fired ONLY after successful persistence. This is the sole trigger for
     downstream processing (scope agent, notifications, handoff). */
  function onSubmissionPersisted(submissionId) {
    var event = {
      type: "IntakeSubmittedEvent",
      submissionId: submissionId,
      idempotencyKey: submissionId,
      brand: state.brand.company,
      contact: state.brand.contactName,
      selectedServices: state.selectedServices.slice(),
      projectStage: state.project.stage,
      persistedAt: new Date().toISOString(),
      schemaVersion: 1
    };
    var emitted = IntakeEventBus.emit(event);
    if (emitted) {
      markSubmissionStatus("submitted");
    }
    /* Show success in both cases (first emit or idempotent duplicate). */
    currentStep = totalSteps + 1;
    render();
    moveFocusToSuccess();
  }

  /* Called if a downstream AI/agent step fails AFTER persistence.
     Keeps the submitted intake, marks needs_review, never asks for resubmit. */
  function onDownstreamFailure(submissionId, reason) {
    IntakeEventBus.markStatus(submissionId, "needs_review");
    state.downstreamFailure = { reason: reason || "processing_failed", at: new Date().toISOString() };
    saveDraft();
  }
  window.IngressibleDownstreamFailure = onDownstreamFailure;

  /* Accessible submission error. Preserves every answer, allows in-place
     retry (no reload, no data loss). Focus moves to the error heading. */
  function showSubmissionError(reason) {
    var stage = root.querySelector(".intake-stage");
    if (!stage) return;
    var detail = "Your answers are saved on this device. Nothing was lost.";
    if (reason === "timeout") {
      detail = "The save request timed out after 30 seconds. Your answers are saved on this device. Nothing was lost.";
    } else if (reason === "network") {
      detail = "We could not reach the submission service. Check your connection. Your answers are saved on this device. Nothing was lost.";
    } else if (reason && reason.indexOf("http_") === 0) {
      detail = "The service returned an error (" + escapeHtml(reason.slice(5)) + "). Your answers are saved on this device. Nothing was lost.";
    }
    stage.innerHTML = "<div class=\"intake-stage__header\"><h2 tabindex=\"-1\" id=\"submit-error-heading\">We could not submit your consultation</h2>" +
      "<p>" + escapeHtml(detail) + "</p></div>" +
      "<div style=\"display:flex;gap:0.75rem;flex-wrap:wrap;margin-top:1rem\" role=\"alert\">" +
      "<button type=\"button\" class=\"btn--primary\" data-action=\"retry-submit\">Try Again</button>" +
      "<button type=\"button\" class=\"btn--secondary\" data-action=\"back-to-review\">Back to Review</button>" +
      "<a href=\"mailto:hello@ingressible.com?subject=Consultation%20Intake%20-%20" + encodeURIComponent(state.brand.company || "") + "\" class=\"btn--secondary\" style=\"text-decoration:none\">Email hello@ingressible.com</a></div>";
    var h = stage.querySelector("#submit-error-heading");
    if (h) { try { h.focus(); } catch (e) {} }
    track("intake_submit_failed", { reason: reason || "unknown" });
  }

  /* ---------- Init ----------
     Restoration order:
     1. Submitted snapshot (no draft) -> confirmation, never resubmit.
     2. Draft with step > 0 -> restore step + notice.
     3. Fresh -> welcome. Deep links apply only when no restored state. */
  var restoredSnapshot = null;
  var restoredDraftNotice = false;
  (function initRestore() {
    var snap = loadSubmittedSnapshot();
    if (snap) {
      var draftStatus = null;
      try {
        var d = localStorage.getItem(DRAFT_KEY);
        if (d) draftStatus = (JSON.parse(d) || {}).status || null;
      } catch (e) {}
      /* Snapshot wins when there is no editable draft, or the draft itself
         is already in submitted state (stale draft after success). */
      if (!draftStatus || draftStatus === "submitted") {
        restoredSnapshot = snap;
        return;
      }
    }
    /* Only claim restoration when actual draft values exist — not merely
       because a step number was stored. Requires at least one of:
       brand company, contact name, email, or selected services. */
    if (currentStep > 0 && currentStep <= totalSteps) {
      var hasData = false;
      try {
        hasData = !!(
          (state.brand && (state.brand.company || state.brand.contactName || state.brand.email)) ||
          (state.selectedServices && state.selectedServices.length > 0) ||
          (state.brand && state.brand.brandIntention) ||
          (state.products && state.products.length > 0 && state.products[0].name)
        );
      } catch (e) { hasData = false; }
      if (hasData) restoredDraftNotice = true;
    }
  })();

  function renderRestored() {
    if (restoredSnapshot) {
      var html = "<div class=\"intake-stage\">" + renderSuccessFromSnapshot(restoredSnapshot) + "</div>";
      root.innerHTML = html;
      attachEvents();
      var h = root.querySelector("#success-restored-heading");
      if (h) { try { h.focus(); } catch (e) {} }
      window.scrollTo(0, 0);
      return true;
    }
    return false;
  }

  function renderDraftNotice() {
    if (!restoredDraftNotice) return "";
    return "<div class=\"intake-status intake-status--success\" role=\"status\" style=\"margin-bottom:1rem\">" +
      "Your consultation draft has been restored.</div>";
  }

  parseDeepLink();
  if (!renderRestored()) {
    render();
    if (restoredDraftNotice) {
      var stage = root.querySelector(".intake-stage");
      if (stage) {
        var notice = document.createElement("div");
        notice.innerHTML = renderDraftNotice();
        stage.insertBefore(notice.firstChild, stage.firstChild);
      }
    }
  }

  /* Start-new action from restored confirmation. */
  root.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("[data-action=\"start-new\"]") : null;
    if (t) {
      try { localStorage.removeItem(SUBMITTED_KEY); } catch (e2) {}
      try { localStorage.removeItem(DRAFT_KEY); } catch (e2) {}
      location.reload();
    }
  });

})();
