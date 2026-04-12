(function () {
  "use strict";

  var CONFIG = {
    pollMs: 5000,
    backoffMaxMs: 60000,
    getApiUrl: function () {
      var el = document.documentElement;
      var fromAttr = el && el.getAttribute("data-api-url");
      if (fromAttr && fromAttr.trim()) {
        return fromAttr.trim();
      }
      try {
        var q = new URLSearchParams(window.location.search).get("api");
        if (q && q.trim()) {
          return q.trim();
        }
      } catch (e) {}
      return "/predict";
    },
  };

  function getConnectionHint() {
    try {
      if (window.location.protocol === "file:") {
        return (
          "Cannot connect to API. Run backend or use ?api=http://127.0.0.1:8000/predict (enable CORS). " +
          "This page is opened as file:// — use a local HTTP server or a full ?api= URL."
        );
      }
    } catch (e) {}
    return (
      "Cannot reach API. Run backend on same origin or pass ?api=http://127.0.0.1:8000/predict (ensure CORS on the server)."
    );
  }

  /** Priority 3 — invalid schema (exact copy for subtitle + log). */
  var INVALID_SCHEMA_MSG = "Unexpected API response";

  /** Dedupe key for schema logs (must stay separate from API keys). */
  var SCHEMA_LOG_KEY = "schema|unexpected";

  var LOG_CAP = 18;

  /** Pending HIGH beep only if user unlocks audio within this window after the transition. */
  var PENDING_HIGH_MAX_MS = 60000;

  /** Master gain cap for alert tones (Web Audio linear gain). */
  var ALERT_MASTER_GAIN = 0.2;

  /**
   * Physical / display range per sensor for progress bars (min–max → 0–100%).
   * Values are clamped to [min, max] before mapping.
   */
  var SENSOR_RANGE = {
    moisture: { min: 0, max: 150 },
    rain: { min: 0, max: 50 },
    humidity: { min: 0, max: 100 },
    tilt: { min: 0, max: 45 },
  };

  var state = {
    lastPayload: null,
    lastPayloadFingerprint: null,
    lastStableRisk: null,
    lastWireStatus: null,
    warningType: null,
    lastApiDedupeKey: null,
    lastSchemaDedupeKey: null,
    lastHighTransitionTime: 0,
    soundEnabled: true,
    audioUnlocked: false,
    pendingHighBeep: false,
    initialDataLogged: false,
    requestId: 0,
    pollAbort: null,
    pollTimerId: null,
    pollInFlight: false,
    consecutiveFetchErrors: 0,
    alertSoundBusy: false,
    alertStopTimerId: null,
    /** @type {OscillatorNode[]} */
    alertOscillators: [],
    /** Dedupe JSON-parse error logs while errors repeat. */
    jsonParseLoggedForStreak: false,
  };

  var els = {};

  function cacheElements() {
    els.connStatus = document.getElementById("conn-status");
    els.soundToggle = document.getElementById("sound-toggle");
    els.audioHint = document.getElementById("audio-hint");
    els.riskLevel = document.getElementById("risk-level");
    els.riskUpdated = document.getElementById("risk-updated");
    els.alertLog = document.getElementById("alert-log");
    els.valMoisture = document.getElementById("val-moisture");
    els.valRain = document.getElementById("val-rain");
    els.valHumidity = document.getElementById("val-humidity");
    els.valTilt = document.getElementById("val-tilt");
    els.meterMoisture = document.getElementById("meter-moisture");
    els.meterRain = document.getElementById("meter-rain");
    els.meterHumidity = document.getElementById("meter-humidity");
    els.meterTilt = document.getElementById("meter-tilt");
    els.meterMoistureWrap = document.getElementById("meter-moisture-wrap");
    els.meterRainWrap = document.getElementById("meter-rain-wrap");
    els.meterHumidityWrap = document.getElementById("meter-humidity-wrap");
    els.meterTiltWrap = document.getElementById("meter-tilt-wrap");
  }

  function normalizeRisk(raw) {
    if (raw == null || raw === "") {
      return null;
    }
    var s = String(raw).trim().toUpperCase();
    if (s === "LOW" || s === "MEDIUM" || s === "HIGH") {
      return s;
    }
    return "UNKNOWN";
  }

  function normalizePayload(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    if (raw.error) {
      return null;
    }
    var risk = normalizeRisk(raw.risk);
    var inner = raw.data && typeof raw.data === "object" ? raw.data : raw;
    var moisture =
      inner.soil_moisture != null
        ? Number(inner.soil_moisture)
        : inner.moisture != null
          ? Number(inner.moisture)
          : null;
    var rain = inner.rain != null ? Number(inner.rain) : null;
    var humidity = inner.humidity != null ? Number(inner.humidity) : null;
    var tilt = inner.tilt != null ? Number(inner.tilt) : null;
    if (risk == null && moisture == null && rain == null && humidity == null && tilt == null) {
      return null;
    }
    return {
      risk: risk,
      soil_moisture: moisture,
      rain: rain,
      humidity: humidity,
      tilt: tilt,
    };
  }

  function buildSubtitle(o) {
    var useCache = !!o.useCache;
    var suffix = useCache ? " · showing last reading" : "";
    if (o.jsonInvalid) {
      return "Invalid JSON from API" + suffix;
    }
    if (o.networkFailure) {
      return getConnectionHint() + suffix;
    }
    if (o.apiMessage) {
      return o.apiMessage + suffix;
    }
    if (o.invalidSchema) {
      return INVALID_SCHEMA_MSG + suffix;
    }
    if (o.success) {
      var line = "Last updated " + new Date().toLocaleTimeString();
      if (o.noNewData) {
        line += " · No new data";
      }
      return line;
    }
    return "Awaiting data…";
  }

  /** Order-stable, normalized fingerprint for “no new data” detection. */
  function payloadFingerprint(n) {
    function rnd(x) {
      if (x == null || !isFinite(Number(x))) {
        return 0;
      }
      return Math.round(Number(x) * 1000) / 1000;
    }
    var stable = {
      risk: String(n.risk || ""),
      soil_moisture: rnd(n.soil_moisture),
      rain: rnd(n.rain),
      humidity: rnd(n.humidity),
      tilt: rnd(n.tilt),
    };
    return JSON.stringify(stable);
  }

  /** Map sensor value to 0–100% using range; clamp input to [min, max] so bars never exceed 100%. */
  function rangeToPct(value, range) {
    if (value == null || !isFinite(value) || !range || range.max <= range.min) {
      return 0;
    }
    var raw = Number(value);
    var v = Math.max(range.min, Math.min(range.max, raw));
    return ((v - range.min) / (range.max - range.min)) * 100;
  }

  function setTextIfChanged(el, next) {
    if (!el) {
      return;
    }
    var s = next == null ? "—" : String(next);
    if (el.textContent !== s) {
      el.textContent = s;
    }
  }

  function setMeter(elFill, elWrap, value, range) {
    var p = rangeToPct(value, range);
    p = Math.min(100, Math.max(0, p));
    if (elFill) {
      var w = p.toFixed(1) + "%";
      if (elFill.style.width !== w) {
        elFill.style.width = w;
      }
    }
    if (elWrap) {
      var v = Math.round(p);
      if (elWrap.getAttribute("aria-valuenow") !== String(v)) {
        elWrap.setAttribute("aria-valuenow", String(v));
      }
    }
  }

  function setDataStatus(level) {
    if (!els.connStatus) {
      return;
    }
    var label =
      level === "active" ? "Data connection: Active" : level === "warning" ? "Data connection: Warning" : "Data connection: Error";
    setTextIfChanged(els.connStatus, label);
    els.connStatus.classList.remove("dash-status--active", "dash-status--warning", "dash-status--error");
    if (level === "active") {
      els.connStatus.classList.add("dash-status--active");
    } else if (level === "warning") {
      els.connStatus.classList.add("dash-status--warning");
    } else {
      els.connStatus.classList.add("dash-status--error");
    }
  }

  function trimLog() {
    if (!els.alertLog) {
      return;
    }
    while (els.alertLog.children.length > LOG_CAP) {
      els.alertLog.removeChild(els.alertLog.lastChild);
    }
  }

  function appendLogItem(message, extraClass) {
    if (!els.alertLog) {
      return;
    }
    var el = els.alertLog;
    var prevScrollTop = el.scrollTop;
    var prevScrollHeight = el.scrollHeight;
    var viewingLatest = prevScrollTop <= 6;

    var li = document.createElement("li");
    li.className = "alert-log__item" + (extraClass ? " " + extraClass : "");
    var time = document.createElement("span");
    time.className = "alert-log__time";
    time.textContent = new Date().toLocaleString();
    var msg = document.createElement("span");
    msg.textContent = message;
    li.appendChild(time);
    li.appendChild(msg);
    el.insertBefore(li, el.firstChild);
    trimLog();

    if (viewingLatest) {
      el.scrollTop = 0;
    } else {
      var delta = el.scrollHeight - prevScrollHeight;
      el.scrollTop = prevScrollTop + delta;
    }
  }

  function appendLogRiskChange(newRisk, oldRisk) {
    var text =
      oldRisk == null ? "Risk level: " + newRisk + "." : "Risk changed from " + oldRisk + " to " + newRisk + ".";
    var cls = newRisk === "HIGH" ? "alert-log__item--high" : "";
    appendLogItem(text, cls);
  }

  function appendLogConnectionFailure() {
    appendLogItem("Connection failed — " + getConnectionHint(), "alert-log__item--conn");
  }

  function appendLogConnectionRestored() {
    appendLogItem("Connection restored.", "alert-log__item--restored");
  }

  function logApiWarningEvent(apiText) {
    var key = "api|" + apiText;
    if (state.lastWireStatus === "warning" && state.warningType === "api" && state.lastApiDedupeKey === key) {
      return;
    }
    appendLogItem("API: " + apiText, "alert-log__item--warn");
    state.lastWireStatus = "warning";
    state.warningType = "api";
    state.lastApiDedupeKey = key;
  }

  /** Deduped with `schema|unexpected` only — separate from API keys; no cross-overwrite. */
  function logSchemaWarningEvent() {
    var key = SCHEMA_LOG_KEY;
    if (state.lastWireStatus === "warning" && state.warningType === "schema" && state.lastSchemaDedupeKey === key) {
      return;
    }
    appendLogItem(
      "Schema [debug]: " +
        INVALID_SCHEMA_MSG +
        " — response did not include usable risk/sensor fields (see API contract).",
      "alert-log__item--schema"
    );
    state.lastWireStatus = "warning";
    state.warningType = "schema";
    state.lastSchemaDedupeKey = key;
  }

  function logConnectionErrorEvent() {
    if (state.lastWireStatus === "error") {
      return;
    }
    appendLogConnectionFailure();
    state.lastWireStatus = "error";
    state.warningType = null;
    state.lastApiDedupeKey = null;
    state.lastSchemaDedupeKey = null;
  }

  function markWireActive() {
    state.lastWireStatus = "active";
    state.warningType = null;
    state.lastApiDedupeKey = null;
    state.lastSchemaDedupeKey = null;
  }

  /**
   * Log recovery once when leaving transport error for a parsed JSON outcome.
   * Call BEFORE mutating lastWireStatus to warning/active.
   */
  function maybeLogConnectionRecovered(nextWireStatus) {
    var prev = state.lastWireStatus;
    if (prev === "error" && nextWireStatus !== "error") {
      appendLogConnectionRestored();
    }
  }

  var audioCtx = null;

  function getAudioContext() {
    if (audioCtx) {
      return audioCtx;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      return null;
    }
    audioCtx = new AC();
    return audioCtx;
  }

  function tryResumeAudio() {
    var ctx = getAudioContext();
    if (!ctx) {
      return Promise.resolve(false);
    }
    if (ctx.state === "running") {
      return Promise.resolve(true);
    }
    return ctx.resume().then(
      function () {
        return ctx.state === "running";
      },
      function () {
        return false;
      }
    );
  }

  function stopAlertSounds() {
    if (state.alertStopTimerId) {
      clearTimeout(state.alertStopTimerId);
      state.alertStopTimerId = null;
    }
    if (state.alertOscillators && state.alertOscillators.length) {
      state.alertOscillators.forEach(function (node) {
        try {
          node.stop(0);
        } catch (e) {}
        try {
          node.disconnect();
        } catch (e2) {}
      });
      state.alertOscillators = [];
    }
    state.alertSoundBusy = false;
  }

  function playAlertBeep() {
    if (!state.soundEnabled || state.alertSoundBusy) {
      return;
    }
    var ctx = getAudioContext();
    if (!ctx || ctx.state !== "running") {
      return;
    }
    stopAlertSounds();
    state.alertSoundBusy = true;
    state.alertOscillators = [];

    var now = ctx.currentTime;
    var master = ctx.createGain();
    master.gain.setValueAtTime(ALERT_MASTER_GAIN, now);
    master.connect(ctx.destination);

    function tone(start, freq, dur) {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, start);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.08, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(start);
      osc.stop(start + dur + 0.02);
      state.alertOscillators.push(osc);
    }

    tone(now, 880, 0.12);
    tone(now + 0.14, 660, 0.14);

    state.alertStopTimerId = setTimeout(function () {
      state.alertSoundBusy = false;
      state.alertOscillators = [];
      state.alertStopTimerId = null;
    }, 400);
  }

  function markAudioUnlocked(ok) {
    state.audioUnlocked = !!ok;
    if (els.audioHint) {
      els.audioHint.hidden = state.audioUnlocked || !state.soundEnabled;
    }
    var ctx = getAudioContext();
    var recent =
      state.lastHighTransitionTime > 0 && Date.now() - state.lastHighTransitionTime <= PENDING_HIGH_MAX_MS;
    var playPending =
      state.audioUnlocked &&
      state.pendingHighBeep &&
      recent &&
      state.soundEnabled &&
      state.lastStableRisk === "HIGH" &&
      ctx &&
      ctx.state === "running";
    if (playPending) {
      playAlertBeep();
    }
    state.pendingHighBeep = false;
  }

  function unlockAudioFromUser() {
    tryResumeAudio().then(function (ok) {
      markAudioUnlocked(ok);
    });
  }

  function handleHighSoundOnStableTransition(prevStable, newRisk) {
    if (newRisk !== "HIGH") {
      state.pendingHighBeep = false;
      return;
    }
    if (prevStable === "HIGH") {
      state.pendingHighBeep = false;
      return;
    }
    if (!state.soundEnabled) {
      return;
    }
    state.lastHighTransitionTime = Date.now();
    var ctx = getAudioContext();
    if (state.audioUnlocked && ctx && ctx.state === "running") {
      playAlertBeep();
    } else {
      state.pendingHighBeep = true;
    }
  }

  function applyRiskClass(el, risk) {
    if (!el) {
      return;
    }
    el.classList.remove("dash-risk--low", "dash-risk--medium", "dash-risk--high");
    if (risk === "LOW") {
      el.classList.add("dash-risk--low");
    } else if (risk === "MEDIUM") {
      el.classList.add("dash-risk--medium");
    } else if (risk === "HIGH") {
      el.classList.add("dash-risk--high");
    }
  }

  function updateUI(data, meta) {
    var status = meta.status;
    var subtitle = meta.subtitle;
    setDataStatus(status);

    var display = data || state.lastPayload;

    if (!display) {
      setTextIfChanged(els.riskLevel, "—");
      applyRiskClass(els.riskLevel, null);
      setTextIfChanged(els.riskUpdated, subtitle);
      if (!state.lastPayload) {
        setTextIfChanged(els.valMoisture, null);
        setTextIfChanged(els.valRain, null);
        setTextIfChanged(els.valHumidity, null);
        setTextIfChanged(els.valTilt, null);
        setMeter(els.meterMoisture, els.meterMoistureWrap, null, SENSOR_RANGE.moisture);
        setMeter(els.meterRain, els.meterRainWrap, null, SENSOR_RANGE.rain);
        setMeter(els.meterHumidity, els.meterHumidityWrap, null, SENSOR_RANGE.humidity);
        setMeter(els.meterTilt, els.meterTiltWrap, null, SENSOR_RANGE.tilt);
      }
      return;
    }

    if (data) {
      state.lastPayload = data;
    }

    var riskLabel = display.risk === "UNKNOWN" ? "UNKNOWN" : display.risk;
    setTextIfChanged(els.riskLevel, riskLabel || "—");
    applyRiskClass(els.riskLevel, display.risk);
    setTextIfChanged(els.riskUpdated, subtitle);

    function fmtNum(v) {
      if (v == null || !isFinite(v)) {
        return "—";
      }
      return Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
    }

    setTextIfChanged(els.valMoisture, fmtNum(display.soil_moisture));
    setTextIfChanged(els.valRain, fmtNum(display.rain));
    setTextIfChanged(els.valHumidity, fmtNum(display.humidity));
    setTextIfChanged(els.valTilt, fmtNum(display.tilt));

    setMeter(els.meterMoisture, els.meterMoistureWrap, display.soil_moisture, SENSOR_RANGE.moisture);
    setMeter(els.meterRain, els.meterRainWrap, display.rain, SENSOR_RANGE.rain);
    setMeter(els.meterHumidity, els.meterHumidityWrap, display.humidity, SENSOR_RANGE.humidity);
    setMeter(els.meterTilt, els.meterTiltWrap, display.tilt, SENSOR_RANGE.tilt);
  }

  function nextBackoffMs() {
    var n = Math.max(1, state.consecutiveFetchErrors);
    return Math.min(CONFIG.backoffMaxMs, CONFIG.pollMs * Math.pow(2, n));
  }

  /**
   * Schedule the next poll only for the latest non-stale response (`responseId === requestId`).
   * Never use finally; never schedule from stale or AbortError paths.
   */
  function scheduleNextPoll(ms, responseId) {
    if (responseId != null && responseId !== state.requestId) {
      return;
    }
    if (document.hidden) {
      return;
    }
    if (state.pollTimerId) {
      clearTimeout(state.pollTimerId);
      state.pollTimerId = null;
    }
    state.pollTimerId = setTimeout(runPollCycle, ms);
  }

  /**
   * Fetch + parse with AbortController + monotonic requestId (ignore stale / aborted).
   */
  function safeFetchJson(url, id, signal) {
    return fetch(url, { method: "GET", cache: "no-store", signal: signal }).then(function (res) {
      if (id !== state.requestId) {
        return { stale: true };
      }
      if (!res.ok) {
        throw new Error("HTTP " + res.status);
      }
      return res.text().then(function (text) {
        if (id !== state.requestId) {
          return { stale: true };
        }
        try {
          return { stale: false, raw: JSON.parse(text) };
        } catch (parseErr) {
          var e = new Error("JSON parse failed");
          e.jsonParse = true;
          throw e;
        }
      });
    });
  }

  function runPollCycle() {
    state.pollTimerId = null;
    if (document.hidden) {
      state.pollInFlight = false;
      return;
    }

    state.requestId++;
    var id = state.requestId;
    if (state.pollAbort) {
      try {
        state.pollAbort.abort();
      } catch (abortErr) {}
    }
    state.pollAbort = new AbortController();
    var signal = state.pollAbort.signal;
    state.pollInFlight = true;

    var url = CONFIG.getApiUrl();

    safeFetchJson(url, id, signal)
      .then(function (box) {
        if (box.stale || id !== state.requestId) {
          state.pollInFlight = false;
          return;
        }

        state.consecutiveFetchErrors = 0;
        state.jsonParseLoggedForStreak = false;
        var raw = box.raw;

        var useCache = !!state.lastPayload;
        var hasApiError = raw && typeof raw === "object" && "error" in raw && raw.error;

        if (hasApiError) {
          maybeLogConnectionRecovered("warning");
          var apiMsg = String(raw.error);
          logApiWarningEvent(apiMsg);
          updateUI(null, {
            status: "warning",
            subtitle: buildSubtitle({
              networkFailure: false,
              apiMessage: apiMsg,
              invalidSchema: false,
              success: false,
              useCache: useCache,
            }),
          });
          state.pollInFlight = false;
          scheduleNextPoll(CONFIG.pollMs, id);
          return;
        }

        var normalized = normalizePayload(raw);
        if (!normalized) {
          maybeLogConnectionRecovered("warning");
          logSchemaWarningEvent();
          updateUI(null, {
            status: "warning",
            subtitle: buildSubtitle({
              networkFailure: false,
              apiMessage: null,
              invalidSchema: true,
              success: false,
              useCache: useCache,
            }),
          });
          state.pollInFlight = false;
          scheduleNextPoll(CONFIG.pollMs, id);
          return;
        }

        maybeLogConnectionRecovered("active");
        markWireActive();

        var prevStable = state.lastStableRisk;
        var nextRisk = normalized.risk;

        handleHighSoundOnStableTransition(prevStable, nextRisk);

        if (prevStable !== nextRisk && nextRisk) {
          appendLogRiskChange(nextRisk, prevStable);
        }

        state.lastStableRisk = nextRisk;

        if (!state.initialDataLogged) {
          state.initialDataLogged = true;
          appendLogItem("Initial data received.", "alert-log__item--restored");
        }

        var fp = payloadFingerprint(normalized);
        var noNewData = state.lastPayloadFingerprint !== null && fp === state.lastPayloadFingerprint;
        state.lastPayloadFingerprint = fp;

        updateUI(normalized, {
          status: "active",
          subtitle: buildSubtitle({
            networkFailure: false,
            apiMessage: null,
            invalidSchema: false,
            success: true,
            useCache: false,
            noNewData: noNewData,
          }),
        });

        state.pollInFlight = false;
        scheduleNextPoll(CONFIG.pollMs, id);
      })
      .catch(function (err) {
        state.pollInFlight = false;
        if (err && err.name === "AbortError") {
          return;
        }
        if (id !== state.requestId) {
          return;
        }

        state.consecutiveFetchErrors++;
        var useCache = !!state.lastPayload;
        var isParse = !!(err && err.jsonParse);

        if (isParse) {
          if (!state.jsonParseLoggedForStreak) {
            appendLogItem("API response was not valid JSON.", "alert-log__item--conn");
            state.jsonParseLoggedForStreak = true;
          }
        } else {
          state.jsonParseLoggedForStreak = false;
          logConnectionErrorEvent();
        }

        var sub = isParse
          ? buildSubtitle({
              jsonInvalid: true,
              useCache: useCache,
            })
          : buildSubtitle({
              networkFailure: true,
              useCache: useCache,
            });

        updateUI(null, {
          status: "error",
          subtitle: sub,
        });

        scheduleNextPoll(nextBackoffMs(), id);
      });
  }

  function syncSoundToggle() {
    if (!els.soundToggle) {
      return;
    }
    var on = state.soundEnabled;
    els.soundToggle.setAttribute("aria-pressed", on ? "true" : "false");
    els.soundToggle.setAttribute("aria-label", on ? "Alert sound on" : "Alert sound off");
    els.soundToggle.textContent = on ? "Sound: ON" : "Sound: OFF";
    if (!on) {
      state.pendingHighBeep = false;
      stopAlertSounds();
    }
    if (els.audioHint) {
      els.audioHint.hidden = state.audioUnlocked || !on;
    }
  }

  function init() {
    cacheElements();
    if (els.connStatus) {
      els.connStatus.textContent = "Data connection: …";
      els.connStatus.classList.remove("dash-status--active", "dash-status--warning", "dash-status--error");
    }
    syncSoundToggle();

    document.addEventListener(
      "pointerdown",
      function once() {
        unlockAudioFromUser();
      },
      { once: true, passive: true }
    );

    if (els.soundToggle) {
      els.soundToggle.addEventListener("click", function () {
        state.soundEnabled = !state.soundEnabled;
        syncSoundToggle();
        unlockAudioFromUser();
      });
    }

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (state.pollTimerId) {
          clearTimeout(state.pollTimerId);
          state.pollTimerId = null;
        }
        if (state.pollAbort) {
          try {
            state.pollAbort.abort();
          } catch (e) {}
        }
        state.pollInFlight = false;
        return;
      }
      if (!state.pollInFlight) {
        scheduleNextPoll(0, null);
      }
    });

    scheduleNextPoll(0, null);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
