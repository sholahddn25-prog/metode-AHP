/**
 * ahp_static_engine.js
 * --------------------------------------------------------------------------
 * Browser-only AHP engine for the GitHub Pages build.
 *
 * GitHub Pages can host static assets but cannot run Flask/Python. This file
 * mirrors the validation contract and principal-eigenvector calculation in
 * ahp_engine.py so the public demo remains functional. The Flask API remains
 * the authoritative server deployment when it is available.
 */
(function (root) {
  "use strict";

  var CR_THRESHOLD = 0.1;
  var EPS = 1e-12;
  var RECIPROCAL_RTOL = 1e-8;
  var RECIPROCAL_ATOL = 1e-10;
  var RI = { 1: 0, 2: 0, 3: 0.58, 4: 0.9, 5: 1.12, 6: 1.24, 7: 1.32, 8: 1.41, 9: 1.45, 10: 1.49 };

  function ValidationError(message) {
    this.name = "AHPValidationError";
    this.message = message;
    if (Error.captureStackTrace) Error.captureStackTrace(this, ValidationError);
  }
  ValidationError.prototype = Object.create(Error.prototype);
  ValidationError.prototype.constructor = ValidationError;

  function sanitize(value) {
    var rounded = Math.round(Number(value) * 1e12) / 1e12;
    return Math.abs(rounded) < EPS ? 0 : rounded;
  }

  function sanitizeArray(values) { return values.map(sanitize); }
  function sanitizeMatrix(values) { return values.map(function (row) { return sanitizeArray(row); }); }

  function isClose(a, b, rtol, atol) {
    return Math.abs(a - b) <= (atol + rtol * Math.abs(b));
  }

  function validateNames(names, field, minimum, maximum) {
    if (!Array.isArray(names)) throw new ValidationError("Daftar " + field + " tidak valid.");
    var cleaned = [];
    names.forEach(function (raw, index) {
      var text = String(raw == null ? "" : raw).trim();
      if (!text) throw new ValidationError("Nama " + field + " #" + (index + 1) + " tidak boleh kosong.");
      if (text.length > 60) throw new ValidationError("Nama " + field + " terlalu panjang (maks 60 karakter).");
      if (cleaned.some(function (name) { return name.toLocaleLowerCase() === text.toLocaleLowerCase(); })) {
        throw new ValidationError("Nama " + field + ' "' + text + '" duplikat.');
      }
      cleaned.push(text);
    });
    if (cleaned.length < minimum) throw new ValidationError("Minimal " + minimum + " " + field + " diperlukan.");
    if (cleaned.length > maximum) throw new ValidationError("Maksimal " + maximum + " " + field + " yang didukung.");
    return cleaned;
  }

  function validateMatrix(matrix, expectedSize, label) {
    if (!Array.isArray(matrix) || !matrix.length || !matrix.every(Array.isArray)) {
      throw new ValidationError(label + " harus berupa matriks 2 dimensi (list of list).");
    }
    var n = matrix.length;
    if (n !== expectedSize) throw new ValidationError(label + " harus " + expectedSize + "x" + expectedSize + ".");
    if (n > 10) throw new ValidationError(label + " maksimal berukuran 10x10.");

    var out = matrix.map(function (row, i) {
      if (row.length !== n) throw new ValidationError(label + " harus persegi.");
      return row.map(function (raw, j) {
        var value = Number(raw);
        if (!Number.isFinite(value)) throw new ValidationError(label + " mengandung nilai bukan angka pada sel (" + i + ", " + j + ").");
        if (value <= 0) throw new ValidationError(label + " hanya menerima nilai positif (1/9 - 9).");
        if (value < (1 / 9) - RECIPROCAL_ATOL || value > 9 + RECIPROCAL_ATOL) {
          throw new ValidationError(label + " berisi nilai di luar skala Saaty yang didukung (1/9 sampai 9).");
        }
        return value;
      });
    });

    for (var i = 0; i < n; i++) {
      if (!isClose(out[i][i], 1, RECIPROCAL_RTOL, RECIPROCAL_ATOL)) {
        throw new ValidationError(label + " harus bernilai 1 pada diagonal: (" + i + ", " + i + ").");
      }
      for (var j = i + 1; j < n; j++) {
        if (!isClose(out[i][j] * out[j][i], 1, RECIPROCAL_RTOL, RECIPROCAL_ATOL)) {
          throw new ValidationError(label + " tidak resiprokal pada pasangan (" + i + ", " + j + ") dan (" + j + ", " + i + "). Nilai bawah diagonal harus 1/x dari nilai atas diagonal.");
        }
      }
    }
    return out;
  }

  function columnTotals(matrix) {
    var totals = Array(matrix.length).fill(0);
    matrix.forEach(function (row) { row.forEach(function (value, j) { totals[j] += value; }); });
    return totals;
  }

  function normalizedMatrix(matrix, totals) {
    return matrix.map(function (row) { return row.map(function (value, j) { return value / totals[j]; }); });
  }

  function multiply(matrix, vector) {
    return matrix.map(function (row) {
      return row.reduce(function (sum, value, j) { return sum + value * vector[j]; }, 0);
    });
  }

  /** Positive AHP matrices converge to their Perron / principal eigenvector. */
  function principalEigenvector(matrix) {
    var n = matrix.length;
    var weights = Array(n).fill(1 / n);
    var iterations = 0;
    for (iterations = 0; iterations < 20000; iterations++) {
      var weighted = multiply(matrix, weights);
      var total = weighted.reduce(function (sum, value) { return sum + value; }, 0);
      if (!Number.isFinite(total) || total <= EPS) throw new ValidationError("Vektor prioritas matriks tidak valid.");
      var next = weighted.map(function (value) { return value / total; });
      var delta = next.reduce(function (max, value, i) { return Math.max(max, Math.abs(value - weights[i])); }, 0);
      weights = next;
      if (delta <= 1e-13) break;
    }
    if (iterations === 20000) throw new ValidationError("Eigenvector matriks tidak konvergen.");
    return weights;
  }

  function randomIndex(n) { return Object.prototype.hasOwnProperty.call(RI, n) ? RI[n] : (n <= 0 ? 0 : 1.98 * (n - 2) / n); }

  function analyzeMatrix(rawMatrix, labels, label) {
    var matrix = validateMatrix(rawMatrix, labels.length, label);
    var totals = columnTotals(matrix);
    var normalized = normalizedMatrix(matrix, totals);
    var normalizedRowAverages = normalized.map(function (row) {
      return row.reduce(function (sum, value) { return sum + value; }, 0) / row.length;
    });
    var weights = principalEigenvector(matrix);
    var weightedSum = multiply(matrix, weights);
    var components = weightedSum.map(function (value, i) { return value / weights[i]; });
    var lambda = components.reduce(function (sum, value) { return sum + value; }, 0) / labels.length;
    var residual = weightedSum.reduce(function (max, value, i) { return Math.max(max, Math.abs(value - lambda * weights[i])); }, 0);
    var ci = labels.length <= 2 ? 0 : (lambda - labels.length) / (labels.length - 1);
    if (ci < 0 && Math.abs(ci) < 1e-9) ci = 0;
    var ri = randomIndex(labels.length);
    var cr = ri <= EPS ? 0 : ci / ri;
    return {
      label: label, labels: labels.slice(), n: labels.length, matrix: sanitizeMatrix(matrix),
      column_totals: sanitizeArray(totals), normalized: sanitizeMatrix(normalized),
      normalized_row_averages: sanitizeArray(normalizedRowAverages), weights: sanitizeArray(weights),
      weight_sum: sanitize(weights.reduce(function (sum, value) { return sum + value; }, 0)),
      priority_method: "Principal eigenvector (Saaty)", lambda_max: sanitize(lambda), ci: sanitize(ci),
      ri: sanitize(ri), cr: sanitize(cr), eigen_residual: sanitize(residual),
      is_consistent: cr <= CR_THRESHOLD, status: cr <= CR_THRESHOLD ? "KONSISTEN" : "TIDAK KONSISTEN",
    };
  }

  function synthesizeScores(criteriaWeights, alternativeWeights, alternatives) {
    var scores = alternativeWeights.map(function (row) {
      return row.reduce(function (sum, weight, k) { return sum + weight * criteriaWeights[k]; }, 0);
    });
    var total = scores.reduce(function (sum, value) { return sum + value; }, 0);
    if (!Number.isFinite(total) || total <= EPS) throw new ValidationError("Total skor sintesis bernilai nol.");
    scores = scores.map(function (score) { return score / total; });
    return scores.map(function (score, index) { return { index: index, score: score }; })
      .sort(function (left, right) { return right.score - left.score || left.index - right.index; })
      .map(function (entry, index) {
        return { rank: index + 1, name: alternatives[entry.index], score: sanitize(entry.score), percentage: sanitize(entry.score * 100) };
      });
  }

  function calculate(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ValidationError("Payload harus berupa objek JSON.");
    if (payload.goal != null && typeof payload.goal !== "string") throw new ValidationError("Tujuan keputusan harus berupa teks.");
    var goal = String(payload.goal || "Menentukan alternatif terbaik").trim() || "Menentukan alternatif terbaik";
    if (goal.length > 160) throw new ValidationError("Tujuan keputusan maksimal 160 karakter.");
    var criteria = validateNames(payload.criteria, "kriteria", 3, 10);
    var alternatives = validateNames(payload.alternatives, "alternatif", 2, 10);
    var criteriaAnalysis = analyzeMatrix(payload.criteriaMatrix, criteria, "Matriks Kriteria");
    var rawAlternatives = payload.alternativeMatrices;
    var matrices = Array.isArray(rawAlternatives) ? rawAlternatives : (rawAlternatives && typeof rawAlternatives === "object" ? criteria.map(function (name) { return rawAlternatives[name]; }) : null);
    if (!matrices) throw new ValidationError("Field 'alternativeMatrices' tidak valid (harus list atau object).");
    if (matrices.length !== criteria.length) throw new ValidationError("Dibutuhkan " + criteria.length + " matriks alternatif (satu per kriteria), diterima " + matrices.length + ".");
    var alternativeAnalyses = matrices.map(function (matrix, index) { return analyzeMatrix(matrix, alternatives, "Matriks Alternatif - " + criteria[index]); });
    var values = alternatives.map(function (_alternative, alternativeIndex) { return alternativeAnalyses.map(function (analysis) { return analysis.weights[alternativeIndex]; }); });
    var ranking = synthesizeScores(criteriaAnalysis.weights, values, alternatives);
    var allAnalyses = [criteriaAnalysis].concat(alternativeAnalyses);
    var allConsistent = allAnalyses.every(function (analysis) { return analysis.is_consistent; });
    var winner = ranking[0] || null;
    var lowest = ranking[ranking.length - 1] || null;
    return {
      ok: true, goal: goal, criteria: criteria, alternatives: alternatives, criteriaAnalysis: criteriaAnalysis,
      alternativeAnalyses: alternativeAnalyses, weightsMatrix: { rows: alternatives, cols: criteria, values: values }, ranking: ranking, winner: winner,
      calculation: { serverComputed: false, engine: "GitHub Pages browser engine", priorityMethod: "Principal eigenvector (Saaty)", consistencyRule: "CR <= 0.10" },
      summary: {
        totalCriteria: criteria.length, totalAlternatives: alternatives.length, allConsistent: allConsistent,
        consistentMatrices: allAnalyses.filter(function (analysis) { return analysis.is_consistent; }).length,
        totalMatrices: allAnalyses.length, crCriteria: criteriaAnalysis.cr,
        maxCr: sanitize(allAnalyses.reduce(function (max, analysis) { return Math.max(max, analysis.cr); }, 0)),
        winner: winner ? winner.name : null, winnerScore: winner ? winner.score : null,
        runnerUp: ranking[1] ? ranking[1].name : null, margin: winner && ranking[1] ? sanitize(winner.score - ranking[1].score) : 0,
        lowest: lowest ? lowest.name : null,
      },
    };
  }

  var api = { AHPValidationError: ValidationError, analyzeMatrix: analyzeMatrix, calculate: calculate };
  root.AHPStaticEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
