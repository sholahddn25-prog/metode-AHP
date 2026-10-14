"""
ahp_engine.py
=============
Pure computation engine for the Analytic Hierarchy Process (AHP).

The engine uses Saaty's principal-eigenvector method as the authoritative
source of priorities.  Column normalisation is retained as an auditable
teaching view, but it is never used to silently replace the eigenvector.

This module contains NO web logic. It is intentionally kept free of any
Flask/FastAPI dependency so it can be unit-tested in isolation.

Mathematical flow:

    1. Column totals            C_j = sum_i A_ij
    2. Normalized matrix        A'_ij = A_ij / C_j
    3. Priority vector           A w = lambda_max w, sum(w) = 1
    4. Verification              ||Aw - lambda_max w||_inf is reported
    5. Consistency Index        CI = (lambda_max - n) / (n - 1)   (n <= 2 -> CI = 0)
    6. Consistency Ratio        CR = CI / RI                      (RI == 0 -> CR = 0)
    7. Validity                 CR <= 0.10 -> CONSISTENT, else INCONSISTENT
    8. Global synthesis         S_i = sum_k (w_A_i,k * w_k), sorted descending
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Sequence

import numpy as np

__all__ = [
    "AHPValidationError",
    "RI_TABLE",
    "CR_THRESHOLD",
    "SAATY_SCALE",
    "validate_pairwise_matrix",
    "column_totals",
    "normalize_matrix",
    "priority_vector",
    "consistency_analysis",
    "analyze_matrix",
    "synthesize_scores",
    "run_ahp",
    "matrix_from_weights",
]

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

#: Saaty Random Index (RI) table for n = 1 .. 10
RI_TABLE: Dict[int, float] = {
    1: 0.00,
    2: 0.00,
    3: 0.58,
    4: 0.90,
    5: 1.12,
    6: 1.24,
    7: 1.32,
    8: 1.41,
    9: 1.45,
    10: 1.49,
}

#: Maximum tolerable consistency ratio (10 %)
CR_THRESHOLD: float = 0.10

#: Fundamental pairwise comparison scale of Saaty (1-9)
SAATY_SCALE: List[Dict[str, Any]] = [
    {"value": 1, "label": "Sama penting dengan"},
    {"value": 2, "label": "Kompromi antara 1 dan 3"},
    {"value": 3, "label": "Sedikit lebih penting"},
    {"value": 4, "label": "Kompromi antara 3 dan 5"},
    {"value": 5, "label": "Lebih penting"},
    {"value": 6, "label": "Kompromi antara 5 dan 7"},
    {"value": 7, "label": "Sangat lebih penting"},
    {"value": 8, "label": "Kompromi antara 7 dan 9"},
    {"value": 9, "label": "Mutlak sangat penting"},
]

#: Numerical guard against division by zero / floating point noise
_EPS: float = 1e-12

#: Tolerance for a pair a_ij, a_ji to be considered reciprocal.  Incoming
#: JSON values such as 1 / 3 are binary floats, hence exact equality is not
#: a safe validation strategy.
_RECIPROCAL_RTOL: float = 1e-8
_RECIPROCAL_ATOL: float = 1e-10

#: Decimal places used when serializing results (keeps JSON compact & stable)
_PRECISION: int = 12


class AHPValidationError(ValueError):
    """Raised when the payload sent to the engine is structurally invalid."""


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _sanitize(value: float) -> float:
    """Round a float and remove negative zero / tiny floating point noise."""
    rounded = round(float(value), _PRECISION)
    if rounded == 0:
        return 0.0
    if abs(rounded) < _EPS:
        return 0.0
    # avoid "-0.0" in JSON payloads
    return rounded + 0.0


def _sanitize_array(values: Sequence[float]) -> List[float]:
    return [_sanitize(v) for v in values]


def _sanitize_matrix(values: np.ndarray) -> List[List[float]]:
    return [[_sanitize(v) for v in row] for row in np.asarray(values, dtype=float)]


def _random_index(n: int) -> float:
    """Return RI for n; for n > 10 extrapolate linearly, for n < 1 use 0."""
    if n in RI_TABLE:
        return RI_TABLE[n]
    if n <= 0:
        return 0.0
    # Extrapolation (Saaty) for matrices larger than 10x10
    return 1.98 * (n - 2) / n


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #

def validate_pairwise_matrix(
    matrix: Any,
    expected_size: Optional[int] = None,
    label: str = "Matriks",
) -> np.ndarray:
    """
    Validate and convert a raw pairwise-comparison matrix.

    Besides its shape, positivity and finiteness, a valid AHP matrix must use
    the Saaty 1/9--9 range, have 1 on the diagonal, and be reciprocal
    (a_ij * a_ji = 1).  Enforcing these invariants on the server keeps a
    crafted request from producing a mathematically invalid decision.

    Raises AHPValidationError with a human readable (Indonesian) message
    whenever the structure or the values are invalid.
    """
    if matrix is None:
        raise AHPValidationError(f"{label} tidak boleh kosong.")

    if isinstance(matrix, Mapping):
        raise AHPValidationError(f"{label} harus berupa matriks 2 dimensi (list of list).")

    try:
        arr = np.asarray(matrix, dtype=float)
    except (TypeError, ValueError) as exc:
        raise AHPValidationError(f"{label} mengandung nilai bukan angka.") from exc

    if arr.ndim != 2:
        raise AHPValidationError(f"{label} harus berupa matriks 2 dimensi (list of list).")

    if arr.shape[0] != arr.shape[1]:
        raise AHPValidationError(
            f"{label} harus persegi. Ditemukan {arr.shape[0]}x{arr.shape[1]}."
        )

    n = arr.shape[0]
    if n < 1:
        raise AHPValidationError(f"{label} minimal berukuran 1x1.")
    if n > 10:
        raise AHPValidationError(f"{label} maksimal berukuran 10x10.")
    if expected_size is not None and n != expected_size:
        raise AHPValidationError(
            f"{label} harus {expected_size}x{expected_size}, ditemukan {n}x{n}."
        )
    if not np.all(np.isfinite(arr)):
        raise AHPValidationError(f"{label} mengandung nilai NaN/Inf.")

    if np.any(arr <= 0):
        bad = np.argwhere(arr <= 0)
        cells = ", ".join(f"({int(i)}, {int(j)})" for i, j in bad[:4])
        raise AHPValidationError(
            f"{label} mengandung nilai <= 0 pada sel {cells}. "
            "Skala Saaty hanya menerima nilai positif (1/9 - 9)."
        )

    if np.any(arr < (1.0 / 9.0) - _RECIPROCAL_ATOL) or np.any(arr > 9.0 + _RECIPROCAL_ATOL):
        raise AHPValidationError(
            f"{label} berisi nilai di luar skala Saaty yang didukung (1/9 sampai 9)."
        )

    diagonal = np.diag(arr)
    if not np.allclose(diagonal, 1.0, rtol=_RECIPROCAL_RTOL, atol=_RECIPROCAL_ATOL):
        bad = np.where(~np.isclose(diagonal, 1.0, rtol=_RECIPROCAL_RTOL, atol=_RECIPROCAL_ATOL))[0]
        cells = ", ".join(f"({int(i)}, {int(i)})" for i in bad[:4])
        raise AHPValidationError(f"{label} harus bernilai 1 pada diagonal: {cells}.")

    for i in range(n):
        for j in range(i + 1, n):
            product = float(arr[i, j] * arr[j, i])
            if not np.isclose(product, 1.0, rtol=_RECIPROCAL_RTOL, atol=_RECIPROCAL_ATOL):
                raise AHPValidationError(
                    f"{label} tidak resiprokal pada pasangan ({i}, {j}) dan ({j}, {i}). "
                    "Nilai bawah diagonal harus 1/x dari nilai atas diagonal."
                )
    return arr


def _validate_names(names: Any, field: str, minimum: int, maximum: int) -> List[str]:
    if names is None or not isinstance(names, (list, tuple)):
        raise AHPValidationError(f"Daftar {field} tidak valid.")
    cleaned: List[str] = []
    for idx, raw in enumerate(names):
        text = str(raw).strip()
        if not text:
            raise AHPValidationError(f"Nama {field} #{idx + 1} tidak boleh kosong.")
        if len(text) > 60:
            raise AHPValidationError(
                f"Nama {field} \"{text[:20]}...\" terlalu panjang (maks 60 karakter)."
            )
        if text.casefold() in {c.casefold() for c in cleaned}:
            raise AHPValidationError(f"Nama {field} \"{text}\" duplikat.")
        cleaned.append(text)

    if len(cleaned) < minimum:
        raise AHPValidationError(f"Minimal {minimum} {field} diperlukan.")
    if len(cleaned) > maximum:
        raise AHPValidationError(f"Maksimal {maximum} {field} yang didukung.")
    return cleaned


# --------------------------------------------------------------------------- #
# Core AHP math (stages A - C)
# --------------------------------------------------------------------------- #

def column_totals(matrix: np.ndarray) -> np.ndarray:
    """C_j = sum_i A_ij  (with division-by-zero guard)."""
    totals = matrix.sum(axis=0)
    if np.any(totals <= _EPS):
        raise AHPValidationError(
            "Total kolom matriks bernilai nol - pembagian nol terdeteksi."
        )
    return totals


def normalize_matrix(matrix: np.ndarray, totals: Optional[np.ndarray] = None):
    """
    Stage B.1 / B.2 : A'_ij = A_ij / C_j.

    Returns (normalized_matrix, column_totals).
    """
    if totals is None:
        totals = column_totals(matrix)
    normalized = matrix / totals[np.newaxis, :]
    return normalized, totals


def priority_vector(
    matrix: np.ndarray,
    normalized: Optional[np.ndarray] = None,
    totals: Optional[np.ndarray] = None,
):
    """
    Return the principal right eigenvector, normalised so sum(w) == 1.

    The optional normalisation inputs are retained for API compatibility and
    for the audit table rendered by the UI.  They do not affect the priority
    calculation: a principal eigenvector is the canonical AHP priority vector
    and produces a lambda_max consistent with the displayed CI / CR.

    Returns (weights, normalized_matrix, column_totals).
    """
    if totals is None:
        normalized, totals = normalize_matrix(matrix)
    elif normalized is None:
        normalized, totals = normalize_matrix(matrix, totals)

    try:
        eigenvalues, eigenvectors = np.linalg.eig(matrix)
    except np.linalg.LinAlgError as exc:  # pragma: no cover - defensive
        raise AHPValidationError("Eigenvector matriks tidak dapat dihitung.") from exc

    # A positive reciprocal matrix has a unique positive Perron vector.  The
    # small real/imaginary conversion is expected numerical noise only.
    index = int(np.argmax(eigenvalues.real))
    candidate = np.real_if_close(eigenvectors[:, index], tol=1000).real
    candidate = np.abs(candidate)
    total = float(candidate.sum())
    if not np.all(np.isfinite(candidate)) or total <= _EPS:
        raise AHPValidationError("Vektor prioritas matriks tidak valid.")
    weights = candidate / total
    return weights, normalized, totals


def consistency_analysis(
    matrix: np.ndarray,
    weights: np.ndarray,
    totals: np.ndarray,
) -> Dict[str, Any]:
    """
    Stage C : lambda_max, CI, RI, CR and the validity flag.
    """
    n = matrix.shape[0]
    weighted_sum = matrix @ weights
    if np.any(weights <= _EPS):  # pragma: no cover - guaranteed by Perron vector
        raise AHPValidationError("Vektor prioritas memuat bobot nol.")
    lambda_components = weighted_sum / weights
    lambda_max = float(np.mean(lambda_components))
    residual = float(np.max(np.abs(weighted_sum - lambda_max * weights)))

    if n <= 2:
        ci = 0.0  # n <= 2 -> CI = 0 by definition
    else:
        ci = (lambda_max - float(n)) / float(n - 1)
        # lambda_max >= n mathematically; clamp tiny negative fp noise
        if ci < 0:
            ci = 0.0 if abs(ci) < 1e-9 else ci

    ri = _random_index(n)
    cr = 0.0 if ri <= _EPS else ci / ri

    return {
        "n": int(n),
        "lambda_max": _sanitize(lambda_max),
        "ci": _sanitize(ci),
        "ri": _sanitize(ri),
        "cr": _sanitize(cr),
        "eigen_residual": _sanitize(residual),
        "is_consistent": bool(cr <= CR_THRESHOLD),
    }


def analyze_matrix(matrix: Any, labels: Sequence[str], label: str = "Matriks") -> Dict[str, Any]:
    """
    Full single-matrix AHP breakdown:
    original matrix, column totals, normalized matrix, a principal priority
    vector, lambda_max, CI, RI, CR and a numerical verification residual.
    """
    labels = [str(x) for x in labels]
    arr = validate_pairwise_matrix(matrix, expected_size=len(labels), label=label)

    weights, normalized, totals = priority_vector(arr)
    stats = consistency_analysis(arr, weights, totals)

    normalized_row_averages = normalized.mean(axis=1)

    return {
        "label": label,
        "labels": labels,
        "n": stats["n"],
        "matrix": _sanitize_matrix(arr),
        "column_totals": _sanitize_array(totals.tolist()),
        "normalized": _sanitize_matrix(normalized),
        "normalized_row_averages": _sanitize_array(normalized_row_averages.tolist()),
        "weights": _sanitize_array(weights.tolist()),
        "weight_sum": _sanitize(float(weights.sum())),
        "priority_method": "Principal eigenvector (Saaty)",
        "lambda_max": stats["lambda_max"],
        "ci": stats["ci"],
        "ri": stats["ri"],
        "cr": stats["cr"],
        "eigen_residual": stats["eigen_residual"],
        "is_consistent": stats["is_consistent"],
        "status": "KONSISTEN" if stats["is_consistent"] else "TIDAK KONSISTEN",
    }


# --------------------------------------------------------------------------- #
# Stage D : global synthesis
# --------------------------------------------------------------------------- #

def synthesize_scores(
    criteria_weights: Sequence[float],
    alternative_weights: Sequence[Sequence[float]],
    alternatives: Sequence[str],
) -> List[Dict[str, Any]]:
    """
    S_i = sum_k ( w_A_i,k * w_k ), sorted from highest to lowest.
    """
    w = np.asarray(criteria_weights, dtype=float)
    alt_w = np.asarray(alternative_weights, dtype=float)

    if w.ndim != 1 or not np.all(np.isfinite(w)) or np.any(w < 0):
        raise AHPValidationError("Bobot kriteria tidak valid.")
    if alt_w.ndim != 2 or not np.all(np.isfinite(alt_w)) or np.any(alt_w < 0):
        raise AHPValidationError("Matriks bobot alternatif tidak valid.")
    if alt_w.shape[1] != w.shape[0]:
        raise AHPValidationError(
            "Jumlah kolom bobot alternatif tidak sama dengan jumlah kriteria."
        )
    if alt_w.shape[0] != len(alternatives):
        raise AHPValidationError("Jumlah bobot alternatif tidak cocok dengan daftar alternatif.")

    scores = alt_w @ w  # S_i = sum_k (w_A_i,k * w_k)

    # normalize so the scores always sum to exactly 1.0
    total = float(scores.sum())
    if total <= _EPS:
        raise AHPValidationError("Total skor sintesis bernilai nol.")
    scores = scores / total

    order = np.argsort(-scores, kind="stable")
    ranking: List[Dict[str, Any]] = []
    for rank, idx in enumerate(order, start=1):
        ranking.append(
            {
                "rank": int(rank),
                "name": str(alternatives[int(idx)]),
                "score": _sanitize(float(scores[int(idx)])),
                "percentage": _sanitize(float(scores[int(idx)]) * 100.0),
            }
        )
    return ranking


# --------------------------------------------------------------------------- #
# Main entry point
# --------------------------------------------------------------------------- #

def run_ahp(payload: Mapping[str, Any]) -> Dict[str, Any]:
    """
    Compute a complete AHP analysis from an API payload.

    Expected payload shape
    ----------------------
    {
      "criteria":    ["Lokasi", "Harga", ...],           # 3 - 10 names
      "alternatives": ["TBA", "BSB", ...],               # 2 - 10 names
      "criteriaMatrix": [[...n x n...]],
      "alternativeMatrices": [ [...m x m...], ... ]      # one per criterion
    }
    ``alternativeMatrices`` may also be a mapping keyed by criterion name.
    """
    if not isinstance(payload, Mapping):
        raise AHPValidationError("Payload harus berupa objek JSON.")

    raw_goal = payload.get("goal")
    if raw_goal is not None and not isinstance(raw_goal, str):
        raise AHPValidationError("Tujuan keputusan harus berupa teks.")
    goal = (raw_goal or "Menentukan alternatif terbaik").strip()
    if not goal:
        goal = "Menentukan alternatif terbaik"
    if len(goal) > 160:
        raise AHPValidationError("Tujuan keputusan maksimal 160 karakter.")

    criteria = _validate_names(payload.get("criteria"), "kriteria", 3, 10)
    alternatives = _validate_names(payload.get("alternatives"), "alternatif", 2, 10)

    n = len(criteria)
    m = len(alternatives)

    criteria_result = analyze_matrix(payload.get("criteriaMatrix"), criteria, "Matriks Kriteria")

    raw_alternative = payload.get("alternativeMatrices")
    if isinstance(raw_alternative, Mapping):
        alt_list = [raw_alternative.get(name) for name in criteria]
    elif isinstance(raw_alternative, (list, tuple)):
        alt_list = list(raw_alternative)
    else:
        raise AHPValidationError(
            "Field 'alternativeMatrices' tidak valid (harus list atau object)."
        )

    if len(alt_list) != n:
        raise AHPValidationError(
            f"Dibutuhkan {n} matriks alternatif (satu per kriteria), "
            f"diterima {len(alt_list)}."
        )

    alternative_results: List[Dict[str, Any]] = []
    for idx, criterion in enumerate(criteria):
        alternative_results.append(
            analyze_matrix(alt_list[idx], alternatives, f"Matriks Alternatif - {criterion}")
        )

    # Build the m x n synthesis matrix: row i = alternative i,
    # column k = priority of alternative i w.r.t. criterion k.
    alternative_weight_matrix = [
        [alternative_results[k]["weights"][i] for k in range(n)]
        for i in range(m)
    ]
    ranking = synthesize_scores(criteria_result["weights"], alternative_weight_matrix, alternatives)

    all_consistent = bool(criteria_result["is_consistent"]) and all(
        res["is_consistent"] for res in alternative_results
    )

    highest = ranking[0] if ranking else None
    lowest = ranking[-1] if ranking else None

    result: Dict[str, Any] = {
        "goal": goal,
        "criteria": criteria,
        "alternatives": alternatives,
        "criteriaAnalysis": _public_analysis(criteria_result),
        "alternativeAnalyses": [_public_analysis(res) for res in alternative_results],
        "weightsMatrix": {
            # m rows (alternatives) x n cols (criteria)
            "rows": alternatives,
            "cols": criteria,
            "values": alternative_weight_matrix,
        },
        "ranking": ranking,
        "winner": highest,
        "calculation": {
            "serverComputed": True,
            "engine": "Python + NumPy",
            "priorityMethod": "Principal eigenvector (Saaty)",
            "consistencyRule": "CR <= 0.10",
        },
        "summary": {
            "totalCriteria": n,
            "totalAlternatives": m,
            "allConsistent": all_consistent,
            "consistentMatrices": int(criteria_result["is_consistent"])
            + sum(1 for res in alternative_results if res["is_consistent"]),
            "totalMatrices": 1 + len(alternative_results),
            "crCriteria": criteria_result["cr"],
            "maxCr": _sanitize(
                max(
                    [criteria_result["cr"]]
                    + [res["cr"] for res in alternative_results]
                )
            ),
            "winner": highest["name"] if highest else None,
            "winnerScore": highest["score"] if highest else None,
            "runnerUp": ranking[1]["name"] if len(ranking) > 1 else None,
            "margin": _sanitize(highest["score"] - ranking[1]["score"])
            if len(ranking) > 1
            else 0.0,
            "lowest": lowest["name"] if lowest else None,
        },
    }
    return result


def _public_analysis(analysis: Mapping[str, Any]) -> Dict[str, Any]:
    """Return only JSON-safe values from a matrix analysis."""
    return dict(analysis)


# --------------------------------------------------------------------------- #
# Convenience: build a perfectly consistent matrix from a weight vector
# --------------------------------------------------------------------------- #

def matrix_from_weights(weights: Sequence[float], precision: int = 4) -> List[List[float]]:
    """a_ij = w_i / w_j - useful for building presets/demos (CR == 0)."""
    w = np.asarray(weights, dtype=float)
    if w.ndim != 1 or w.size < 1 or not np.all(np.isfinite(w)) or np.any(w <= 0):
        raise AHPValidationError("Bobot harus berupa daftar angka positif.")
    if precision < 0:
        raise AHPValidationError("Presisi tidak boleh negatif.")
    w = w / w.sum()
    size = len(w)
    matrix = np.ones((size, size), dtype=float)
    for i in range(size):
        for j in range(i + 1, size):
            value = round(float(w[i] / w[j]), precision)
            if value <= 0:  # pragma: no cover - defensive for extreme rounding
                value = float(w[i] / w[j])
            matrix[i, j] = value
            # Do not round the reciprocal independently: exact reciprocity is
            # more important than symmetric-looking decimal formatting.
            matrix[j, i] = 1.0 / value
    return _sanitize_matrix(matrix)


if __name__ == "__main__":  # pragma: no cover - manual smoke test
    demo = [
        ["Lokasi", "Harga", "Desain", "Fasilitas"],
        [[1, 3, 5, 7], [1 / 3, 1, 3, 5], [1 / 5, 1 / 3, 1, 3], [1 / 7, 1 / 5, 1 / 3, 1]],
    ]
    out = analyze_matrix(demo[1], demo[0], "Matriks Kriteria")
    print("w      =", out["weights"], "sum =", out["weight_sum"])
    print("lambda =", out["lambda_max"], "CI =", out["ci"], "CR =", out["cr"])
