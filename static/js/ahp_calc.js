/**
 * ahp_calc.js
 * ---------------------------------------------------------------------------
 * State manager · dynamic matrix DOM builder · reactive auto-reciprocal
 * · wizard stepper · AJAX (/api/calculate) · results & audit renderer
 * · Chart.js visualisation · CSV export · print helper · theme switch
 *
 * Alur aplikasi:
 *   Step 1  Kriteria & Alternatif (validasi nama, min/max)
 *   Step 2  Matriks perbandingan kriteria (auto-reciprocal realtime)
 *   Step 3  Matriks perbandingan alternatif per kriteria (tab/pills)
 *   Step 4  Hasil komputasi, visualisasi, audit & ekspor
 */
(function () {
  "use strict";

  /* =========================================================================
     1. Konstanta
     ====================================================================== */
  var LIMITS = {
    criteria: { min: 3, max: 10, label: "kriteria" },
    alternatives: { min: 2, max: 10, label: "alternatif" },
  };

  var CR_LIMIT = 0.1;

  /** Skala Saaty 1-9 termasuk nilai kompromi 1.5 beserta resiprokalnya. */
  var SAATY_VALUES = [
    9, 8, 7, 6, 5, 4, 3, 2, 1.5, 1,
    2 / 3, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 6, 1 / 7, 1 / 8, 1 / 9,
  ];

  var SAATY_MEANING = {
    1: "Sama penting",
    2: "Kompromi antara 1 dan 3",
    3: "Sedikit lebih penting",
    4: "Kompromi antara 3 dan 5",
    5: "Lebih penting",
    6: "Kompromi antara 5 dan 7",
    7: "Sangat penting",
    8: "Kompromi antara 7 dan 9",
    9: "Mutlak sangat penting",
  };

  var CHART_COLORS = [
    "#46d5ff", "#8b83ff", "#63e6be", "#ffd166", "#ff7d9e",
    "#59a8ff", "#ab9dff", "#58d1cb", "#ff9b76", "#b6d66d",
  ];

  var STEP_TITLES = ["Decision Dashboard", "Criteria Matrix", "Alternative Lab", "Intelligence Report"];

  /* =========================================================================
     2. Utilitas
     ====================================================================== */
  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function esc(text) {
    var entities = {
      "&": "\u0026amp;",
      "<": "\u0026lt;",
      ">": "\u0026gt;",
      "\"": "\u0026quot;",
      "'": "\u0026#39;",
    };
    return String(text == null ? "" : text).replace(/[&<>"']/g, function (ch) {
      return entities[ch];
    });
  }

  function isClose(a, b, eps) {
    return Math.abs(a - b) < (eps == null ? 1e-9 : eps);
  }

  /** Buang noise floating point & jadikan bulat bila mendekati bilangan bulat. */
  function cleanValue(value) {
    if (!isFinite(value)) return 1;
    if (isClose(value, Math.round(value), 1e-9)) return Math.round(value);
    return value;
  }

  /** Resiprokal aman: 1/x dengan pembulatan bilangan bulat (1/3 -> 3). */
  function reciprocal(value) {
    return cleanValue(1 / value);
  }

  /** Label ramah untuk sebuah nilai (1, 1.5, 1/3, 0.142857 -> 1/7, dst.). */
  function fractionLabel(value) {
    if (isClose(value, 1.5)) return "1.5";
    if (isClose(value, Math.round(value))) return String(Math.round(value));
    for (var d = 2; d <= 9; d++) {
      var n = value * d;
      if (isClose(n, Math.round(n)) && Math.round(n) >= 1 && Math.round(n) <= 9) {
        return Math.round(n) + "/" + d;
      }
    }
    return value.toFixed(3);
  }

  function optionLabel(value) {
    var meaning;
    if (Number.isInteger(value) && SAATY_MEANING[value]) {
      meaning = SAATY_MEANING[value];
    } else if (isClose(value, 1.5)) {
      meaning = "Kompromi antara 1 dan 2";
    } else if (isClose(value * 1.5, 1)) {
      meaning = "Resiprokal dari 1.5";
    } else {
      var inv = 1 / value;
      if (isClose(inv, Math.round(inv)) && SAATY_MEANING[Math.round(inv)]) {
        meaning = "Resiprokal dari " + Math.round(inv);
      } else {
        meaning = "Nilai antara skala Saaty";
      }
    }
    return fractionLabel(value) + " — " + meaning;
  }

  function fmt(value, decimals) {
    var dp = decimals == null ? 4 : decimals;
    var n = Number(value);
    if (!isFinite(n)) return "—";
    return n.toFixed(dp);
  }

  function fmtScore(value) {
    return fmt(value, 3);
  }

  function fmtPercent(value) {
    return fmt(value, 1) + "%";
  }

  function shortLabel(text, max) {
    var limit = max || 20;
    var s = String(text);
    return s.length > limit ? s.slice(0, limit - 1) + "…" : s;
  }

  function clone(data) {
    return JSON.parse(JSON.stringify(data));
  }

  function columnOf(matrix, j) {
    return matrix.map(function (row) {
      return row[j];
    });
  }

  /* =========================================================================
     3. State
     ====================================================================== */
  var state = {
    step: 1,
    maxStep: 1,
    goal: "Menentukan alternatif terbaik",
    criteria: ["Kriteria 1", "Kriteria 2", "Kriteria 3"],
    alternatives: ["Alternatif 1", "Alternatif 2", "Alternatif 3"],
    criteriaMatrix: null,
    altMatrices: [],
    activeTab: 0,
    result: null,
    charts: { rank: null, criteria: null },
    presets: [],
  };

  function makeMatrix(size) {
    var m = [];
    for (var i = 0; i < size; i++) {
      var row = [];
      for (var j = 0; j < size; j++) row.push(1);
      m.push(row);
    }
    return m;
  }

  function resizeMatrix(matrix, size) {
    var out = [];
    for (var i = 0; i < size; i++) {
      var row = [];
      for (var j = 0; j < size; j++) {
        if (matrix && matrix[i] && matrix[i][j] != null) row.push(matrix[i][j]);
        else row.push(1);
      }
      out.push(row);
    }
    return out;
  }

  function removeIndex(matrix, index) {
    var out = [];
    matrix.forEach(function (row, r) {
      if (r === index) return;
      out.push(row.filter(function (_v, c) { return c !== index; }));
    });
    return out;
  }

  function seedMatrices() {
    state.criteriaMatrix = makeMatrix(state.criteria.length);
    var size = state.alternatives.length;
    state.altMatrices = state.criteria.map(function () {
      return makeMatrix(size);
    });
  }

  /* =========================================================================
     4. Toast & feedback
     ====================================================================== */
  var TOAST_ICONS = { success: "fa-circle-check", error: "fa-triangle-exclamation", info: "fa-circle-info" };

  function toast(message, type) {
    var stack = $("#toastStack");
    if (!stack) return;
    var kind = type || "info";
    var el = document.createElement("div");
    el.className = "toast toast-" + kind;
    el.innerHTML =
      '<i class="fa-solid ' + (TOAST_ICONS[kind] || TOAST_ICONS.info) + '"></i>' +
      "<span>" + esc(message) + "</span>";
    stack.appendChild(el);
    window.setTimeout(function () {
      el.classList.add("is-leaving");
      window.setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 320);
    }, 4200);
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    button.classList.toggle("is-busy", !!busy);
    button.disabled = !!busy;
    if (busy) {
      button.dataset.prev = button.innerHTML;
      button.innerHTML = '<i class="fa-solid fa-spinner"></i> ' + esc(label || "Menghitung…");
    } else if (button.dataset.prev) {
      button.innerHTML = button.dataset.prev;
      delete button.dataset.prev;
      updateNav();
    }
  }

  /* =========================================================================
     4b. Progressive motion helpers
     ====================================================================== */
  function replayEntrance(element) {
    if (!element) return;
    element.classList.remove("motion-enter");
    void element.offsetWidth;
    element.classList.add("motion-enter");
  }

  function animateItems(host, selector, limit) {
    if (!host) return;
    var items = $$(selector, host);
    var maximum = limit == null ? items.length : limit;
    items.forEach(function (item, index) {
      item.classList.remove("motion-item");
      item.style.removeProperty("--stagger");
      if (index < maximum) item.style.setProperty("--stagger", String(index));
    });
    void host.offsetWidth;
    items.forEach(function (item, index) {
      if (index < maximum) item.classList.add("motion-item");
    });
  }

  /* =========================================================================
     5. Tema (dark / light)
     ====================================================================== */
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem("ahp-theme", theme);
    } catch (_e) { /* localStorage unavailable */ }
    var btn = $("#themeToggle");
    if (btn) {
      btn.innerHTML =
        theme === "dark"
          ? '<i class="fa-solid fa-sun"></i>'
          : '<i class="fa-solid fa-moon"></i>';
      btn.title = theme === "dark" ? "Ganti ke mode terang" : "Ganti ke mode gelap";
    }
    if (state.result) renderCharts(state.result);
  }

  function initTheme() {
    var saved = null;
    try {
      saved = window.localStorage.getItem("ahp-theme");
    } catch (_e) { /* ignore */ }
    applyTheme(saved === "light" ? "light" : "dark");
  }

  /* =========================================================================
     6. Editor nama (Step 1)
     ====================================================================== */
  function listConfig(kind) {
    return kind === "criteria"
      ? {
          key: "criteria",
          data: state.criteria,
          host: $("#criteriaList"),
          count: $("#criteriaCount"),
          error: $("#criteriaError"),
          add: $("#btnAddCriteria"),
          prefix: "Kriteria",
        }
      : {
          key: "alternatives",
          data: state.alternatives,
          host: $("#altList"),
          count: $("#altCount"),
          error: $("#altError"),
          add: $("#btnAddAlt"),
          prefix: "Alternatif",
        };
  }

  function defaultName(prefix, list) {
    var i = list.length + 1;
    var name = prefix + " " + i;
    while (list.some(function (x) { return x.toLowerCase() === name.toLowerCase(); })) {
      i++;
      name = prefix + " " + i;
    }
    return name;
  }

  function renderNameList(kind) {
    var cfg = listConfig(kind);
    var limits = LIMITS[cfg.key];
    var min = cfg.key === "criteria" ? LIMITS.criteria.min : LIMITS.alternatives.min;

    cfg.host.innerHTML = cfg.data
      .map(function (name, i) {
        var canRemove = cfg.data.length > min;
        return (
          '<li class="name-row">' +
          '<span class="row-index">' + (i + 1) + "</span>" +
          '<input class="text-input" type="text" maxlength="60" data-kind="' + cfg.key +
          '" data-index="' + i + '" value="' + esc(name) + '" placeholder="' + cfg.prefix +
          " " + (i + 1) + '" aria-label="' + cfg.prefix + " " + (i + 1) + '">' +
          '<button type="button" class="icon-btn" data-action="remove" data-kind="' + cfg.key +
          '" data-index="' + i + '" title="Hapus ' + cfg.prefix.toLowerCase() + '"' +
          (canRemove ? "" : " disabled") + '><i class="fa-solid fa-xmark"></i></button>' +
          "</li>"
        );
      })
      .join("");

    if (cfg.count) cfg.count.textContent = cfg.data.length + " / " + limits.max;
    if (cfg.add) cfg.add.disabled = cfg.data.length >= limits.max;
  }

  function renderAllLists() {
    renderNameList("criteria");
    renderNameList("alternatives");
  }

  function markInvalid(kind, indexes) {
    var host = listConfig(kind).host;
    $$(".text-input", host).forEach(function (input) {
      var idx = Number(input.dataset.index);
      input.classList.toggle("is-invalid", indexes.indexOf(idx) !== -1);
    });
  }

  function validateList(kind) {
    var cfg = listConfig(kind);
    var limits = LIMITS[cfg.key];
    var data = cfg.data;
    var message = "";
    var invalid = [];

    if (data.length < limits.min) {
      message = "Minimal " + limits.min + " " + limits.label + " wajib diisi (saat ini " + data.length + ").";
      data.forEach(function (_v, i) { invalid.push(i); });
    } else if (data.length > limits.max) {
      message = "Maksimal " + limits.max + " " + limits.label + " yang didukung.";
      data.forEach(function (_v, i) { invalid.push(i); });
    } else {
      var seen = {};
      data.forEach(function (raw, i) {
        var name = String(raw == null ? "" : raw).trim();
        if (!name) {
          invalid.push(i);
          if (!message) message = "Nama " + limits.label + " #" + (i + 1) + " tidak boleh kosong.";
          return;
        }
        var key = name.toLowerCase();
        if (seen[key] != null) {
          if (invalid.indexOf(i) === -1 && invalid.indexOf(seen[key]) === -1) {
            invalid.push(i);
            invalid.push(seen[key]);
          }
          message = 'Nama "' + name + '" duplikat — gunakan nama lain.';
        } else {
          seen[key] = i;
        }
      });
    }

    markInvalid(kind, invalid);
    if (cfg.error) cfg.error.textContent = message;
    return message === "";
  }

  function validateStep1() {
    var okCriteria = validateList("criteria");
    var okAlternatives = validateList("alternatives");
    return okCriteria && okAlternatives;
  }

  function normalizeNames() {
    state.criteria = state.criteria.map(function (x) { return String(x).trim(); });
    state.alternatives = state.alternatives.map(function (x) { return String(x).trim(); });
  }

  function addName(kind) {
    var cfg = listConfig(kind);
    var limits = LIMITS[cfg.key];
    if (cfg.data.length >= limits.max) {
      toast("Maksimal " + limits.max + " " + limits.label + ".", "info");
      return;
    }
    cfg.data.push(defaultName(cfg.prefix, cfg.data));
    if (cfg.key === "criteria") {
      state.criteriaMatrix = resizeMatrix(state.criteriaMatrix, state.criteria.length);
      state.altMatrices.push(makeMatrix(state.alternatives.length));
    } else {
      state.criteriaMatrix = resizeMatrix(state.criteriaMatrix, state.criteria.length);
      state.altMatrices = state.altMatrices.map(function (m) { return resizeMatrix(m, state.alternatives.length); });
    }
    renderNameList(kind);
    if (cfg.error) cfg.error.textContent = "";
  }

  function removeName(kind, index) {
    var cfg = listConfig(kind);
    var limits = LIMITS[cfg.key];
    if (cfg.data.length <= limits.min) {
      toast("Minimal " + limits.min + " " + limits.label + " harus tetap ada.", "info");
      return;
    }
    cfg.data.splice(index, 1);

    if (cfg.key === "criteria") {
      state.criteriaMatrix = removeIndex(state.criteriaMatrix, index);
      state.altMatrices.splice(index, 1);
      if (state.activeTab >= state.criteria.length) state.activeTab = 0;
    } else {
      state.criteriaMatrix = resizeMatrix(state.criteriaMatrix, state.criteria.length);
      state.altMatrices = state.altMatrices.map(function (m) { return removeIndex(m, index); });
    }

    renderNameList(kind);
    if (cfg.error) cfg.error.textContent = "";
  }

  /* =========================================================================
     7. Pembangun matriks (dropdown skala Saaty + auto-reciprocal)
     ====================================================================== */
  function getMatrixContext(kind) {
    if (kind === "criteria") {
      return { labels: state.criteria, matrix: state.criteriaMatrix };
    }
    return { labels: state.alternatives, matrix: state.altMatrices[state.activeTab] };
  }

  function ensureOption(select, value) {
    var target = String(value);
    for (var i = 0; i < select.options.length; i++) {
      if (select.options[i].value === target) return;
    }
    var opt = document.createElement("option");
    opt.value = target;
    opt.textContent = optionLabel(value);
    select.appendChild(opt);
  }

  function buildSelect(value, i, j, disabled) {
    var select = document.createElement("select");
    select.className = "matrix-select";
    select.dataset.i = String(i);
    select.dataset.j = String(j);
    select.setAttribute("aria-label", "Sel matriks baris " + (i + 1) + " kolom " + (j + 1));

    if (disabled) {
      select.disabled = true;
      var single = document.createElement("option");
      single.value = "1";
      single.textContent = "1 — diagonal";
      select.appendChild(single);
      select.value = "1";
      return select;
    }

    SAATY_VALUES.forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = String(v);
      opt.textContent = optionLabel(v);
      select.appendChild(opt);
    });
    ensureOption(select, value);
    select.value = String(value);
    if (select.value === "") {
      select.value = "1";
    }
    return select;
  }

  function flashCell(element) {
    var td = element.closest("td");
    if (!td) return;
    td.classList.remove("cell-flash");
    void td.offsetWidth;
    td.classList.add("cell-flash");
  }

  /**
   * Render matriks interaktif ke dalam host.
   * opts: { kind, editable }
   */
  function renderMatrixTable(host, opts) {
    var ctx = getMatrixContext(opts.kind);
    if (!ctx.matrix) return;
    var labels = ctx.labels;
    var matrix = ctx.matrix;

    var html = '<table class="table matrix-table"><thead><tr><th class="corner"></th>';
    labels.forEach(function (label) {
      html += '<th title="' + esc(label) + '">' + esc(shortLabel(label, 16)) + "</th>";
    });
    html += "</tr></thead><tbody>";

    matrix.forEach(function (row, i) {
      html += '<tr><th title="' + esc(labels[i]) + '">' + esc(shortLabel(labels[i], 18)) + "</th>";
      row.forEach(function (value, j) {
        var cls = i === j ? "diag" : j > i ? "upper" : "lower";
        html += '<td class="' + cls + '" data-cell="' + i + "-" + j + '"></td>';
      });
      html += "</tr>";
    });
    html += "</tbody></table>";
    host.innerHTML = html;

    matrix.forEach(function (row, i) {
      row.forEach(function (value, j) {
        var td = host.querySelector('td[data-cell="' + i + "-" + j + '"]');
        if (!td) return;
        td.appendChild(buildSelect(value, i, j, i === j || !opts.editable));
      });
    });
  }

  function onMatrixChange(event) {
    var select = event.target;
    if (!select || !select.classList || !select.classList.contains("matrix-select")) return;
    var host = select.closest("[data-kind]");
    if (!host) return;

    var kind = host.dataset.kind;
    var i = Number(select.dataset.i);
    var j = Number(select.dataset.j);
    var ctx = getMatrixContext(kind);
    if (!ctx.matrix || !ctx.matrix[i]) return;

    var value = parseFloat(select.value);
    if (!(value > 0)) value = 1;
    value = cleanValue(value);

    ensureOption(select, value);
    select.value = String(value);
    ctx.matrix[i][j] = value;
    flashCell(select);

    if (i !== j) {
      var rev = reciprocal(value);
      ctx.matrix[j][i] = rev;
      var mirror = host.querySelector(
        '.matrix-select[data-i="' + j + '"][data-j="' + i + '"]'
      );
      if (mirror) {
        ensureOption(mirror, rev);
        mirror.value = String(rev);
        flashCell(mirror);
      }
    }
  }

  /* =========================================================================
     8. Tab kriteria (Step 3)
     ====================================================================== */
  function renderTabs() {
    var host = $("#altTabs");
    if (!host) return;
    host.innerHTML = state.criteria
      .map(function (name, i) {
        var active = i === state.activeTab;
        return (
          '<button type="button" class="tab-pill' + (active ? " is-active" : "") +
          '" role="tab" aria-selected="' + active + '" data-tab="' + i + '">' +
          esc(name) + '<span class="tab-status" aria-hidden="true"></span></button>'
        );
      })
      .join("");
  }

  function renderAltMatrix() {
    renderTabs();
    var title = $("#altMatrixTitle");
    var host = $("#altMatrixHost");
    if (title) {
      var name = state.criteria[state.activeTab] || "Kriteria";
      title.innerHTML = '<i class="fa-solid fa-table-list"></i> Matriks Alternatif — ' + esc(name);
    }
    if (host) renderMatrixTable(host, { kind: "alt", editable: true });
    renderComparisonProgress();
  }

  function renderComparisonProgress() {
    var host = $("#comparisonProgress");
    if (!host) return;
    var criteriaPairs = (state.criteria.length * (state.criteria.length - 1)) / 2;
    var alternativePairs = (state.alternatives.length * (state.alternatives.length - 1)) / 2;
    var totalPairs = criteriaPairs + alternativePairs * state.criteria.length;
    host.innerHTML =
      '<span class="completion-icon"><i class="fa-solid fa-list-check"></i></span>' +
      '<div><strong>' + totalPairs + ' pasangan perbandingan siap diaudit</strong>' +
      '<span>' + criteriaPairs + ' pasangan kriteria + ' + alternativePairs +
      ' pasangan alternatif untuk setiap dari ' + state.criteria.length +
      ' kriteria. Nilai awal 1 berarti setara penting.</span></div>';
  }

  function renderCriteriaMatrix() {
    var host = $("#criteriaMatrixHost");
    if (host) renderMatrixTable(host, { kind: "criteria", editable: true });
  }

  /* =========================================================================
     9. Navigasi wizard
     ====================================================================== */
  function updateNav() {
    var step = state.step;
    $("#progressFill").style.width = (step / 4) * 100 + "%";
    var progress = $("#progress");
    if (progress) progress.setAttribute("aria-valuenow", String(step));

    $$(".stepper-item").forEach(function (item) {
      var n = Number(item.dataset.step);
      item.classList.toggle("is-active", n === step);
      item.classList.toggle("is-done", n < step);
    });

    var meta = $("#wizardMeta");
    if (meta) meta.textContent = "Langkah " + step + " dari 4 · " + STEP_TITLES[step - 1];

    var workspaceStep = $("#workspaceStep");
    if (workspaceStep) {
      workspaceStep.textContent = "0" + step + " — " + STEP_TITLES[step - 1];
    }

    var prev = $("#btnPrev");
    var next = $("#btnNext");
    if (prev) prev.disabled = step === 1;
    if (next) {
      if (step === 3) next.innerHTML = 'Hitung & Analisis <i class="fa-solid fa-calculator"></i>';
      else if (step === 4) next.innerHTML = 'Selesai <i class="fa-solid fa-check"></i>';
      else next.innerHTML = 'Lanjut <i class="fa-solid fa-arrow-right"></i>';
      next.disabled = step === 4;
    }
  }

  function goToStep(target) {
    var step = Math.max(1, Math.min(4, target));
    state.step = step;
    state.maxStep = Math.max(state.maxStep, step);

    $$(".step-panel").forEach(function (panel) {
      var n = Number(panel.dataset.step);
      var active = n === step;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
      if (active) replayEntrance(panel);
    });

    if (step === 2) renderCriteriaMatrix();
    if (step === 3) renderAltMatrix();

    updateNav();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function nextStep() {
    if (state.step === 1) {
      if (!validateStep1()) {
        toast("Periksa kembali nama kriteria & alternatif.", "error");
        return;
      }
      normalizeNames();
      renderAllLists();
      goToStep(2);
      return;
    }
    if (state.step === 2) {
      goToStep(3);
      return;
    }
    if (state.step === 3) {
      calculate();
    }
  }

  function prevStep() {
    goToStep(state.step - 1);
  }

  /* =========================================================================
     10. Preset
     ====================================================================== */
  function populatePresets() {
    var presets = window.AHP_PRESETS || [];
    state.presets = presets;
    var select = $("#presetSelect");
    if (!select) return;
    select.innerHTML = presets
      .map(function (p, i) {
        return '<option value="' + i + '">' + esc(p.title) + "</option>";
      })
      .join("");
    updatePresetDesc();
  }

  function updatePresetDesc() {
    var select = $("#presetSelect");
    var desc = $("#presetDesc");
    if (!select || !desc) return;
    var preset = state.presets[Number(select.value) || 0];
    if (!preset) return;
    desc.textContent = preset.title + " — " + preset.description;
  }

  function loadPreset(preset, jumpToMatrix) {
    if (!preset) return;
    state.criteria = preset.criteria.slice();
    state.alternatives = preset.alternatives.slice();
    state.criteriaMatrix = clone(preset.criteriaMatrix);
    state.goal = preset.goal || "Menentukan alternatif terbaik";
    var goalInput = $("#goalInput");
    if (goalInput) goalInput.value = state.goal;
    state.activeTab = 0;
    state.result = null;

    state.altMatrices = state.criteria.map(function (name) {
      var m = preset.alternativeMatrices[name];
      return m ? clone(m) : makeMatrix(state.alternatives.length);
    });

    renderAllLists();
    $("#criteriaError").textContent = "";
    $("#altError").textContent = "";
    ["#decisionVerdict", "#resultAlerts", "#summaryCards", "#leaderboardHost", "#synthesisHost", "#auditHost"].forEach(
      function (sel) {
        var el = $(sel);
        if (el) el.innerHTML = "";
      }
    );

    var desc = $("#presetDesc");
    if (desc) desc.textContent = preset.title + " — " + preset.description;

    toast('Preset "' + preset.title + '" berhasil dimuat.', "success");
    if (jumpToMatrix !== false) goToStep(2);
  }

  function loadPresetById(id) {
    var found = state.presets.filter(function (p) { return p.id === id; })[0];
    if (found) loadPreset(found);
    else toast("Preset tidak ditemukan.", "error");
  }

  /* =========================================================================
     11. Perhitungan (AJAX)
     ====================================================================== */
  function buildPayload() {
    var goalInput = $("#goalInput");
    state.goal = String(goalInput ? goalInput.value : state.goal).trim() || "Menentukan alternatif terbaik";
    return {
      goal: state.goal,
      criteria: state.criteria.map(function (x) { return String(x).trim(); }),
      alternatives: state.alternatives.map(function (x) { return String(x).trim(); }),
      criteriaMatrix: clone(state.criteriaMatrix),
      alternativeMatrices: state.altMatrices.map(function (m) { return clone(m); }),
    };
  }

  async function calculate() {
    if (!validateStep1()) {
      goToStep(1);
      return;
    }
    normalizeNames();

    var next = $("#btnNext");
    setBusy(next, true, "Menghitung…");

    try {
      var payload = buildPayload();
      var response = await fetch("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      var data = await response.json().catch(function () { return {}; });

      if (!response.ok || data.ok === false) {
        /* GitHub Pages hosts files only, so /api/calculate is intentionally
           absent there. A 404/405 transparently activates the audited static
           engine; validation errors (400) are never hidden by a fallback. */
        if ((response.status === 404 || response.status === 405) && window.AHPStaticEngine) {
          data = window.AHPStaticEngine.calculate(payload);
        } else {
          var responseError = new Error((data && data.error) || "Permintaan gagal (HTTP " + response.status + ")");
          responseError.isServerResponse = true;
          throw responseError;
        }
      }

      state.result = data;
      renderResults(data);
      goToStep(4);
      if (data.summary.allConsistent) {
        celebrate();
        toast("Analisis tervalidasi. Pemenang: " + (data.summary.winner || "-"), "success");
      } else {
        toast("Peringkat dihitung, tetapi ada matriks yang harus dikalibrasi sebelum keputusan dipakai.", "info");
      }
    } catch (error) {
      /* A network failure also occurs on a Pages preview opened from a local
         file. Prefer a real Flask response when it exists; otherwise keep the
         published demo usable without sending the user's data anywhere. */
      try {
        if (error && error.isServerResponse) throw error;
        if (!window.AHPStaticEngine) throw error;
        var localData = window.AHPStaticEngine.calculate(buildPayload());
        state.result = localData;
        renderResults(localData);
        goToStep(4);
        if (localData.summary.allConsistent) celebrate();
        toast("Dihitung di browser untuk GitHub Pages. Tidak ada data yang dikirim ke server.", "info");
      } catch (_fallbackError) {
        toast(error.message || "Gagal menghubungi server perhitungan.", "error");
      }
    } finally {
      setBusy(next, false);
    }
  }

  /* =========================================================================
     12. Renderer hasil (Step 4)
     ====================================================================== */
  function crBadge(cr) {
    var ok = cr <= CR_LIMIT;
    return (
      '<span class="badge ' + (ok ? "badge-ok" : "badge-bad") + '">' +
      '<i class="fa-solid ' + (ok ? "fa-circle-check" : "fa-triangle-exclamation") + '"></i> ' +
      (ok ? "KONSISTEN" : "TIDAK KONSISTEN") + " · CR " + fmt(cr, 4) +
      "</span>"
    );
  }

  function renderAlerts(result) {
    var host = $("#resultAlerts");
    if (!host) return;
    var analyses = [result.criteriaAnalysis].concat(result.alternativeAnalyses);
    var bad = analyses.filter(function (a) { return !a.is_consistent; });
    var html = "";

    if (bad.length) {
      html +=
        '<div class="alert alert-warn"><i class="fa-solid fa-triangle-exclamation"></i>' +
        '<div><div class="alert-title">' + bad.length +
        " matriks TIDAK KONSISTEN (CR > 10%)</div>" +
        '<div class="alert-body">Penilaian perbandingan berpasangan berikut perlu ditinjau ulang karena melebihi ambang konsistensi 10%.' +
        "<ul>" +
        bad
          .map(function (a) {
            return "<li>" + esc(a.label) + " — CR " + fmt(a.cr, 4) + " (" + fmt(a.cr * 100, 2) + "%)</li>";
          })
          .join("") +
        "</ul></div></div></div>";
    } else {
      html +=
        '<div class="alert alert-success"><i class="fa-solid fa-circle-check"></i>' +
        '<div><div class="alert-title">Semua matriks KONSISTEN / VALID</div>' +
        '<div class="alert-body">Seluruh ' + result.summary.totalMatrices +
        " matriks lolos uji konsistensi (CR ≤ 10%). Hasil analisis dapat diandalkan.</div></div></div>";
    }

    if (result.summary.winner) {
      html +=
        '<div class="alert alert-info"><i class="fa-solid ' + (result.summary.allConsistent ? "fa-trophy" : "fa-flask") + '"></i>' +
        '<div><div class="alert-title">' + (result.summary.allConsistent ? "Keputusan terverifikasi: " : "Peringkat sementara: ") + esc(result.summary.winner) + "</div>" +
        '<div class="alert-body">Skor sintesis <strong>' + fmtScore(result.summary.winnerScore) +
        "</strong> (" + fmtPercent(result.summary.winnerScore * 100) + "), unggul " +
        fmtScore(result.summary.margin) + " poin atas " + esc(result.summary.runnerUp || "-") +
        (result.summary.allConsistent ? "." : ". Tinjau matriks yang ditandai sebelum menjadikan peringkat ini keputusan final.") + "</div></div></div>";
    }

    host.innerHTML = html;
    animateItems(host, ".alert", 3);
  }

  function renderSummary(result) {
    var host = $("#summaryCards");
    if (!host) return;
    var s = result.summary;
    var cards = [
      {
        cls: s.allConsistent ? "is-success" : "is-warning",
        icon: s.allConsistent ? "fa-trophy" : "fa-flask",
        label: s.allConsistent ? "Pemenang Terverifikasi" : "Kandidat Teratas",
        value: s.winner || "—",
        sub: "Peringkat 1 dari " + s.totalAlternatives + " alternatif",
      },
      {
        cls: "",
        icon: "fa-star",
        label: "Skor Tertinggi",
        value: fmtScore(s.winnerScore),
        sub: "Persentase " + fmtPercent((s.winnerScore || 0) * 100) + " · selisih " + fmtScore(s.margin),
      },
      {
        cls: "is-warning",
        icon: "fa-scale-balanced",
        label: "Matriks Konsisten",
        value: s.consistentMatrices + " / " + s.totalMatrices,
        sub: "CR maksimum " + fmt(s.maxCr, 4) + " (batas 0.10)",
      },
      {
        cls: s.allConsistent ? "is-success" : "is-danger",
        icon: s.allConsistent ? "fa-circle-check" : "fa-triangle-exclamation",
        label: "Status Uji Konsistensi",
        value: s.allConsistent ? "KONSISTEN" : "TIDAK KONSISTEN",
        sub: s.allConsistent
          ? "Seluruh CR ≤ 0.10"
          : "Periksa matriks dengan CR > 0.10",
      },
    ];

    host.innerHTML = cards
      .map(function (c) {
        return (
          '<article class="summary-card ' + c.cls + '">' +
          '<span class="sc-icon"><i class="fa-solid ' + c.icon + '"></i></span>' +
          '<div class="sc-label">' + esc(c.label) + "</div>" +
          '<div class="sc-value">' + esc(c.value) + "</div>" +
          '<div class="sc-sub">' + esc(c.sub) + "</div>" +
          "</article>"
        );
      })
      .join("");
    animateItems(host, ".summary-card", 4);
  }

  function renderDecisionVerdict(result) {
    var host = $("#decisionVerdict");
    if (!host) return;
    var verified = result.summary.allConsistent;
    host.className = "decision-verdict " + (verified ? "is-verified" : "needs-review");
    var calculation = result.calculation || {};
    var serverComputed = calculation.serverComputed !== false;
    host.innerHTML =
      '<span class="verdict-icon"><i class="fa-solid ' + (verified ? "fa-shield-heart" : "fa-triangle-exclamation") + '"></i></span>' +
      '<div><span class="verdict-eyebrow">' + (verified ? "Verified decision" : "Review required") + "</span>" +
      "<h3>" + (verified ? "Siap dijadikan dasar keputusan" : "Belum aman dijadikan keputusan final") + "</h3>" +
      "<p>" + esc(result.goal || state.goal) + ". " +
      (verified
        ? "Seluruh matriks lulus uji konsistensi CR ≤ 0.10 dan bobot dihitung oleh " + (serverComputed ? "engine Python." : "engine browser GitHub Pages.")
        : "Peringkat tetap ditampilkan untuk analisis, namun setidaknya satu matriks melewati batas CR 0.10.") +
      "</p></div>" +
      '<span class="verdict-meta"><i class="fa-solid ' + (serverComputed ? "fa-server" : "fa-globe") + '"></i> ' +
      esc((calculation.engine || "Python + NumPy") + " · " + (calculation.priorityMethod || "Principal eigenvector (Saaty)")) + "</span>";
  }

  function renderLeaderboard(result) {
    var host = $("#leaderboardHost");
    if (!host) return;
    var medals = ["fa-crown", "fa-medal", "fa-medal"];
    var colors = ["#fbbf24", "#94a3b8", "#d97706"];
    var max = result.ranking.length ? result.ranking[0].score : 1;

    host.innerHTML =
      '<div class="card-head"><h3><i class="fa-solid fa-ranking-star"></i> Podium & Leaderboard Peringkat Akhir</h3>' +
      '<span class="chip chip-soft"><i class="fa-solid fa-arrow-down-wide-short"></i> Terurut menurun</span></div>' +
      '<div class="leaderboard">' +
      result.ranking
        .map(function (row, idx) {
          var winner = idx === 0;
          var width = max > 0 ? Math.max(4, (row.score / max) * 100) : 0;
          return (
            '<div class="leader-row' + (winner ? " is-winner" : "") + '" style="animation-delay:' +
            idx * 70 + 'ms">' +
            '<span class="leader-rank">' + row.rank + "</span>" +
            '<div class="leader-name-wrap">' +
            '<div class="leader-name">' +
            (winner ? '<i class="fa-solid ' + medals[0] + ' crown"></i>' : "") +
            esc(row.name) +
            (winner ? ' <span class="badge badge-ok">JUARA</span>' : "") +
            "</div>" +
            '<div class="leader-bar"><span style="width:' + width.toFixed(2) + '%"></span></div>' +
            "</div>" +
            '<div class="leader-score" style="color:' + (winner ? colors[0] : "inherit") + '">' +
            fmtScore(row.score) +
            "<small>" + fmtPercent(row.percentage) + "</small></div>" +
            "</div>"
          );
        })
        .join("") +
      "</div>";
    animateItems(host, ".leader-row", 10);
  }

  function renderSynthesis(result) {
    var host = $("#synthesisHost");
    if (!host) return;
    var criteria = result.criteria;
    var altNames = result.alternatives;
    var values = result.weightsMatrix.values;
    var critWeights = result.criteriaAnalysis.weights;

    var order = altNames
      .map(function (name, i) { return { name: name, index: i }; })
      .sort(function (a, b) {
        var ra = result.ranking.filter(function (r) { return r.name === a.name; })[0];
        var rb = result.ranking.filter(function (r) { return r.name === b.name; })[0];
        return (ra ? ra.rank : 99) - (rb ? rb.rank : 99);
      });

    var html =
      '<div class="card-head"><h3><i class="fa-solid fa-square-root-variable"></i> Tabel Sintesis Perkalian Matriks Skor Akhir</h3>' +
      '<span class="chip chip-soft">S<sub>i</sub> = Σ (w<sub>A,k</sub> × w<sub>k</sub>)</span></div>' +
      '<div class="table-scroll"><table class="table synthesis-table"><thead><tr><th>Alternatif</th>';

    criteria.forEach(function (c, k) {
      html += '<th title="' + esc(c) + '">' + esc(shortLabel(c, 14)) + "<br><small>w=" + fmt(critWeights[k], 3) + "</small></th>";
    });
    html += "<th>Skor S<sub>i</sub></th><th>Peringkat</th></tr></thead><tbody>";

    order.forEach(function (entry) {
      var i = entry.index;
      var rank = result.ranking.filter(function (r) { return r.name === entry.name; })[0];
      var isWinner = rank && rank.rank === 1;
      html +=
        '<tr class="' + (isWinner ? "is-winner" : "") + '"><th title="' + esc(entry.name) + '">' +
        esc(entry.name) + "</th>";
      values[i].forEach(function (w, k) {
        html += '<td><span class="weight-inline" title="kontribusi ' + fmt(w * critWeights[k], 4) +
          '">' + fmt(w, 4) + "</span></td>";
      });
      html +=
        '<td class="score-cell">' + fmtScore(rank ? rank.score : 0) + "</td>" +
        "<td><strong>#" + (rank ? rank.rank : "-") + "</strong></td></tr>";
    });

    html += '<tr class="tot-row"><th>Bobot Kriteria (w)</th>';
    critWeights.forEach(function (w) {
      html += '<td class="tot">' + fmt(w, 4) + "</td>";
    });
    html += '<td class="tot">' + fmt(result.criteriaAnalysis.weight_sum, 3) + "</td><td></td></tr>";

    html += "</tbody></table></div>";
    host.innerHTML = html;
    animateItems(host, "tr", 10);
  }

  function auditCardHtml(analysis) {
    var labels = analysis.labels;
    var html =
      '<article class="card glass audit-card">' +
      '<div class="card-head"><h3><i class="fa-solid fa-table"></i> ' + esc(analysis.label) + "</h3>" +
      crBadge(analysis.cr) +
      "</div>";

    /* Matriks awal + total kolom + prioritas */
    html +=
      '<div class="sub-table-title"><i class="fa-solid fa-table-cells"></i> Matriks Awal · Total Kolom (C) · Prioritas Vektor (w)</div>' +
      '<div class="table-scroll"><table class="table matrix-with-totals"><thead><tr><th></th>';
    labels.forEach(function (l) {
      html += '<th title="' + esc(l) + '">' + esc(shortLabel(l, 14)) + "</th>";
    });
    html += "<th>Bobot eigen w</th></tr></thead><tbody>";

    analysis.matrix.forEach(function (row, i) {
      html += '<tr><th title="' + esc(labels[i]) + '">' + esc(shortLabel(labels[i], 16)) + "</th>";
      row.forEach(function (v) {
        html += "<td>" + fmt(v, 3) + "</td>";
      });
      html += '<td class="w-cell">' + fmt(analysis.weights[i], 4) + "</td></tr>";
    });

    html += '<tr class="tot-row"><th>Σ Kolom (C<sub>j</sub>)</th>';
    analysis.column_totals.forEach(function (t) {
      html += '<td class="tot">' + fmt(t, 4) + "</td>";
    });
    html += '<td class="tot">' + fmt(analysis.weight_sum, 3) + "</td></tr>";
    html += "</tbody></table></div>";

    /* Matriks ternormalisasi */
    html +=
      '<div class="sub-table-title"><i class="fa-solid fa-divide"></i> Matriks Ternormalisasi (A′<sub>ij</sub> = A<sub>ij</sub> / C<sub>j</sub>)</div>' +
      '<div class="table-scroll"><table class="table matrix-with-totals"><thead><tr><th></th>';
    labels.forEach(function (l) {
      html += '<th title="' + esc(l) + '">' + esc(shortLabel(l, 14)) + "</th>";
    });
    html += "<th>Rata-rata baris</th></tr></thead><tbody>";

    analysis.normalized.forEach(function (row, i) {
      html += '<tr><th title="' + esc(labels[i]) + '">' + esc(shortLabel(labels[i], 16)) + "</th>";
      row.forEach(function (v) {
        html += "<td>" + fmt(v, 4) + "</td>";
      });
      html += '<td class="w-cell">' + fmt((analysis.normalized_row_averages || [])[i], 4) + "</td></tr>";
    });
    html += "</tbody></table></div>";

    /* Statistik */
    var n = analysis.n;
    html += '<div class="stat-grid">';
    html += '<div class="stat"><div class="st-label">Ukuran (n)</div><div class="st-value">' + n + "</div></div>";
    html += '<div class="stat"><div class="st-label">λ maks</div><div class="st-value">' + fmt(analysis.lambda_max, 4) + "</div></div>";
    html += '<div class="stat"><div class="st-label">CI</div><div class="st-value">' + fmt(analysis.ci, 4) + "</div></div>";
    html += '<div class="stat"><div class="st-label">RI</div><div class="st-value">' + fmt(analysis.ri, 2) + "</div></div>";
    html +=
      '<div class="stat ' + (analysis.is_consistent ? "is-ok" : "is-bad") + '">' +
      '<div class="st-label">CR (≤ 0.10)</div><div class="st-value">' + fmt(analysis.cr, 4) + "</div></div>";
    html += '<div class="stat ' + (analysis.is_consistent ? "is-ok" : "is-bad") + '">' +
      '<div class="st-label">Status</div><div class="st-value" style="font-size:13px">' + esc(analysis.status) + "</div></div>";
    html += '<div class="stat is-ok"><div class="st-label">Residu eigen</div><div class="st-value">' + fmt(analysis.eigen_residual, 8) + "</div></div>";
    html += "</div></article>";

    return html;
  }

  function renderAudit(result) {
    var host = $("#auditHost");
    if (!host) return;
    var html =
      '<div class="card glass" style="margin-top:18px">' +
      '<div class="card-head"><h3><i class="fa-solid fa-clipboard-check"></i> Audit Perhitungan Langkah demi Langkah</h3>' +
      '<span class="chip chip-soft"><i class="fa-solid fa-book"></i> λ<sub>max</sub> · CI · RI · CR</span></div>' +
      '<div id="auditList">' +
      auditCardHtml(result.criteriaAnalysis) +
      result.alternativeAnalyses.map(auditCardHtml).join("") +
      "</div></div>";

    html +=
      '<div class="print-footer">Dokumen dihasilkan oleh Sistem Pendukung Keputusan AHP · ' +
      new Date().toLocaleString("id-ID") + "</div>";

    host.innerHTML = html;
    animateItems(host, ".audit-card", 6);
  }

  function renderResults(result) {
    renderDecisionVerdict(result);
    renderAlerts(result);
    renderSummary(result);
    renderLeaderboard(result);
    renderSynthesis(result);
    renderAudit(result);
    renderCharts(result);
    replayEntrance($("#decisionVerdict"));
  }

  /* =========================================================================
     13. Chart.js
     ====================================================================== */
  function themeText() {
    return getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#e2e8f0";
  }

  function destroyChart(key) {
    if (state.charts[key]) {
      state.charts[key].destroy();
      state.charts[key] = null;
    }
  }

  function renderCharts(result) {
    if (typeof window.Chart === "undefined") return;

    var text = themeText();
    Chart.defaults.font.family = "'Manrope', system-ui, sans-serif";
    Chart.defaults.color = text;

    destroyChart("rank");
    destroyChart("criteria");

    var rankCanvas = $("#rankChart");
    var criteriaCanvas = $("#criteriaChart");
    if (!rankCanvas || !criteriaCanvas) return;

    var names = result.ranking.map(function (r) { return r.name; });
    var scores = result.ranking.map(function (r) { return r.score; });
    var colors = result.ranking.map(function (r, i) {
      return i === 0 ? "#f3bf58" : i === 1 ? "#ff6f48" : i === 2 ? "#6888ff" : "#918981";
    });

    state.charts.rank = new Chart(rankCanvas, {
      type: "bar",
      data: {
        labels: names,
        datasets: [
          {
            label: "Skor Akhir",
            data: scores,
            backgroundColor: colors,
            borderRadius: 8,
            borderSkipped: false,
            barThickness: 26,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 900, easing: "easeOutQuart" },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return " Skor " + fmtScore(ctx.parsed.x) + " (" + fmtPercent(ctx.parsed.x * 100) + ")";
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            max: Math.max(0.0001, Math.ceil(Math.max.apply(null, scores) * 10) / 10),
            grid: { color: "rgba(148,163,184,0.14)" },
            ticks: { callback: function (v) { return Number(v).toFixed(2); } },
          },
          y: { grid: { display: false } },
        },
      },
    });

    state.charts.criteria = new Chart(criteriaCanvas, {
      type: "doughnut",
      data: {
        labels: result.criteria,
        datasets: [
          {
            label: "Bobot Kriteria",
            data: result.criteriaAnalysis.weights,
            backgroundColor: result.criteria.map(function (_c, i) { return CHART_COLORS[i % CHART_COLORS.length]; }),
            borderColor: "rgba(0,0,0,0)",
            hoverOffset: 10,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "58%",
        animation: { duration: 900, easing: "easeOutQuart" },
        plugins: {
          legend: { position: "bottom", labels: { padding: 14, usePointStyle: true } },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return " " + ctx.label + ": " + fmtScore(ctx.parsed) + " (" + fmtPercent(ctx.parsed * 100) + ")";
              },
            },
          },
        },
      },
    });
  }

  /* =========================================================================
     14. Konfeti selebrasi
     ====================================================================== */
  function celebrate() {
    if (typeof window.confetti !== "function") return;
    var colors = ["#ff6f48", "#6888ff", "#f3bf58", "#f178b6", "#9ad19a"];
    confetti({ particleCount: 170, spread: 95, startVelocity: 42, origin: { y: 0.62 }, colors: colors });

    var end = Date.now() + 900;
    (function frame() {
      confetti({ particleCount: 4, angle: 60, spread: 55, origin: { x: 0 }, colors: colors });
      confetti({ particleCount: 4, angle: 120, spread: 55, origin: { x: 1 }, colors: colors });
      if (Date.now() < end) window.requestAnimationFrame(frame);
    })();
  }

  /* =========================================================================
     15. Ekspor CSV & cetak
     ====================================================================== */
  function csvCell(value) {
    var s = value == null ? "" : String(value);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function exportCSV() {
    var result = state.result;
    if (!result) {
      toast("Belum ada hasil untuk diekspor. Selesaikan perhitungan terlebih dahulu.", "error");
      return;
    }

    var rows = [];
    rows.push(["LAPORAN ANALISIS AHP (ANALYTIC HIERARCHY PROCESS)"]);
    rows.push(["Tanggal Export", new Date().toLocaleString("id-ID")]);
    rows.push(["Tujuan Keputusan", result.goal || state.goal]);
    rows.push(["Engine", (result.calculation && result.calculation.engine) || "Python + NumPy"]);
    rows.push(["Metode Prioritas", (result.calculation && result.calculation.priorityMethod) || "Principal eigenvector (Saaty)"]);
    rows.push(["Total Kriteria", result.summary.totalCriteria]);
    rows.push(["Total Alternatif", result.summary.totalAlternatives]);
    rows.push(["Status Konsistensi", result.summary.allConsistent ? "KONSISTEN / TERVALIDASI" : "PERLU TINJAU ULANG"]);
    rows.push(["CR Maksimum", result.summary.maxCr]);
    rows.push([]);

    rows.push(["RINGKASAN PERINGKAT AKHIR"]);
    rows.push(["Peringkat", "Alternatif", "Skor", "Persentase (%)"]);
    result.ranking.forEach(function (r) {
      rows.push([r.rank, r.name, r.score.toFixed(6), r.percentage.toFixed(4)]);
    });
    rows.push([]);

    function pushAnalysis(analysis) {
      rows.push(["MATRIKS: " + analysis.label]);
      rows.push(["Metode", analysis.priority_method || "Principal eigenvector (Saaty)"]);
      rows.push(["λ maks", analysis.lambda_max, "CI", analysis.ci, "RI", analysis.ri, "CR", analysis.cr, "Residu eigen", analysis.eigen_residual, "Status", analysis.status]);
      rows.push(["Baris / Kolom"].concat(analysis.labels).concat(["Bobot eigen (w)"]));
      analysis.matrix.forEach(function (row, i) {
        rows.push([analysis.labels[i]].concat(row.map(function (v) { return Number(v).toFixed(6); })).concat([analysis.weights[i].toFixed(6)]));
      });
      rows.push(["Σ Kolom (C)"].concat(analysis.column_totals.map(function (v) { return Number(v).toFixed(6); })).concat([analysis.weight_sum.toFixed(6)]));
      rows.push(["Matriks Ternormalisasi"]);
      rows.push(["Baris / Kolom"].concat(analysis.labels));
      analysis.normalized.forEach(function (row, i) {
        rows.push([analysis.labels[i]].concat(row.map(function (v) { return Number(v).toFixed(6); })));
      });
      rows.push([]);
    }

    rows.push(["BOBOT KRITERIA"]);
    rows.push(["Kriteria", "Bobot (w)"]);
    result.criteria.forEach(function (c, i) {
      rows.push([c, result.criteriaAnalysis.weights[i].toFixed(6)]);
    });
    rows.push([]);

    pushAnalysis(result.criteriaAnalysis);

    result.alternativeAnalyses.forEach(function (a) {
      pushAnalysis(a);
    });

    rows.push(["SINTESIS SKOR AKHIR (S_i = Σ w_Aik × w_k)"]);
    rows.push(["Alternatif"].concat(result.criteria).concat(["Skor S", "Peringkat"]));
    var rankMap = {};
    result.ranking.forEach(function (r) { rankMap[r.name] = r; });
    result.alternatives.forEach(function (name, i) {
      var r = rankMap[name] || { score: 0, rank: "-" };
      rows.push(
        [name]
          .concat(result.weightsMatrix.values[i].map(function (v) { return Number(v).toFixed(6); }))
          .concat([r.score.toFixed(6), r.rank])
      );
    });

    var csv = "\uFEFF" + rows.map(function (row) { return row.map(csvCell).join(","); }).join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "laporan-ahp-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    toast("Laporan CSV berhasil diunduh.", "success");
  }

  function copySummary() {
    var result = state.result;
    if (!result) {
      toast("Belum ada hasil untuk disalin.", "error");
      return;
    }
    var status = result.summary.allConsistent ? "TERVERIFIKASI (semua CR ≤ 0.10)" : "PERLU TINJAU ULANG (ada CR > 0.10)";
    var lines = [
      "RINGKASAN KEPUTUSAN AHP",
      "Tujuan: " + (result.goal || state.goal),
      "Status: " + status,
      "Kandidat teratas: " + (result.summary.winner || "-"),
      "Skor: " + fmtScore(result.summary.winnerScore) + " (" + fmtPercent((result.summary.winnerScore || 0) * 100) + ")",
      "CR maksimum: " + fmt(result.summary.maxCr, 4),
      "Metode: " + ((result.calculation && result.calculation.priorityMethod) || "Principal eigenvector (Saaty)"),
    ];
    var text = lines.join("\n");

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast("Ringkasan keputusan disalin ke clipboard.", "success"); },
        function () { toast("Clipboard tidak tersedia. Gunakan ekspor CSV sebagai gantinya.", "info"); }
      );
      return;
    }
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
      toast("Ringkasan keputusan disalin ke clipboard.", "success");
    } catch (_error) {
      toast("Tidak dapat mengakses clipboard.", "info");
    }
    document.body.removeChild(area);
  }

  /* =========================================================================
     16. Inisialisasi & event wiring
     ====================================================================== */
  function wireEvents() {
    /* Stepper */
    $$(".stepper-item").forEach(function (item) {
      item.addEventListener("click", function () {
        var target = Number(item.dataset.step);
        if (target > state.maxStep) {
          toast("Selesaikan langkah saat ini terlebih dahulu.", "info");
          return;
        }
        if (target > state.step && state.step === 1 && !validateStep1()) return;
        goToStep(target);
      });
    });

    /* Navigasi */
    $("#btnPrev").addEventListener("click", prevStep);
    $("#btnNext").addEventListener("click", nextStep);

    /* Editor nama */
    $("#btnAddCriteria").addEventListener("click", function () { addName("criteria"); });
    $("#btnAddAlt").addEventListener("click", function () { addName("alternatives"); });

    ["criteriaList", "altList"].forEach(function (id) {
      var host = $("#" + id);
      host.addEventListener("input", function (event) {
        var input = event.target;
        if (!input.classList.contains("text-input")) return;
        var kind = input.dataset.kind;
        var index = Number(input.dataset.index);
        var list = kind === "criteria" ? state.criteria : state.alternatives;
        list[index] = input.value;
        input.classList.remove("is-invalid");
        var err = listConfig(kind).error;
        if (err) err.textContent = "";
      });

      host.addEventListener("click", function (event) {
        var button = event.target.closest('button[data-action="remove"]');
        if (!button) return;
        removeName(button.dataset.kind, Number(button.dataset.index));
      });
    });

    /* Matriks (delegated change -> auto-reciprocal realtime) */
    var criteriaHost = $("#criteriaMatrixHost");
    var altHost = $("#altMatrixHost");
    criteriaHost.dataset.kind = "criteria";
    altHost.dataset.kind = "alt";
    criteriaHost.addEventListener("change", onMatrixChange);
    altHost.addEventListener("change", onMatrixChange);

    /* Tab kriteria */
    $("#altTabs").addEventListener("click", function (event) {
      var pill = event.target.closest(".tab-pill");
      if (!pill) return;
      state.activeTab = Number(pill.dataset.tab);
      renderAltMatrix();
    });

    /* Preset */
    $("#presetSelect").addEventListener("change", updatePresetDesc);
    $("#btnLoadPreset").addEventListener("click", function () {
      var preset = state.presets[Number($("#presetSelect").value) || 0];
      loadPreset(preset);
    });
    $("#btnQuickMobil").addEventListener("click", function () {
      loadPresetById("mobil-terbaik");
    });

    /* Aksi hasil */
    $("#btnCopySummary").addEventListener("click", copySummary);
    $("#btnExport").addEventListener("click", exportCSV);
    $("#btnPrint").addEventListener("click", function () { window.print(); });
    $("#btnRecalc").addEventListener("click", function () { goToStep(3); });

    /* Tema */
    $("#themeToggle").addEventListener("click", function () {
      var current = document.documentElement.getAttribute("data-theme");
      applyTheme(current === "dark" ? "light" : "dark");
    });
  }

  function init() {
    initTheme();
    seedMatrices();
    renderAllLists();
    populatePresets();
    renderComparisonProgress();
    wireEvents();
    updateNav();
    goToStep(1);
    window.requestAnimationFrame(function () {
      document.documentElement.classList.add("motion-ready");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
