"""
app.py
======
Flask controller + RESTful API for the AHP Decision Support System
(Sistem Pendukung Keputusan berbasis Analytic Hierarchy Process).

Endpoints
---------
    GET  /                  -> renders templates/index.html
    GET  /api/health        -> service liveness probe
    GET  /api/scale         -> Saaty 1-9 scale + Random Index table + CR limit
    GET  /api/presets       -> quick-load case studies (Rumah Semarang & Mobil)
    POST /api/calculate     -> full AHP computation (ahp_engine.run_ahp)

Run locally:
    python app.py
"""

from __future__ import annotations

from typing import Any, Dict

from flask import Flask, jsonify, render_template, request

from ahp_engine import AHPValidationError, CR_THRESHOLD, RI_TABLE, SAATY_SCALE, run_ahp

app = Flask(__name__)


# --------------------------------------------------------------------------- #
# Quick-load presets (same data as static/js/presets.js)
# --------------------------------------------------------------------------- #

PRESETS: Dict[str, Dict[str, Any]] = {
    "rumah-semarang": {
        "id": "rumah-semarang",
        "title": "Pemilihan Rumah di Semarang",
        "subtitle": "Studi Kasus Dr. Hozairi - Universitas Islam Madura",
        "goal": "Memilih rumah tinggal terbaik di Semarang",
        "description": (
            "Perbandingan empat perumahan di Semarang berdasarkan empat kriteria: "
            "Lokasi, Harga, Desain, dan Fasilitas. Alternatif Taman Bukit Asri (TBA) "
            "menjadi pemenang dengan skor 0.333."
        ),
        "criteria": ["Lokasi", "Harga", "Desain", "Fasilitas"],
        "alternatives": [
            "Taman Bukit Asri (TBA)",
            "Bukit Semarang Baru (BSB)",
            "Ciputra Sunindo (CS)",
            "Tlogosari Regency (TR)",
        ],
        "criteriaMatrix": [
            [1, 3, 5, 7],
            [1 / 3, 1, 3, 5],
            [1 / 5, 1 / 3, 1, 3],
            [1 / 7, 1 / 5, 1 / 3, 1],
        ],
        "alternativeMatrices": {
            "Lokasi": [
                [1, 2, 1, 6],
                [1 / 2, 1, 1, 6],
                [1, 1, 1, 8],
                [1 / 6, 1 / 6, 1 / 8, 1],
            ],
            "Harga": [
                [1, 1 / 3, 1 / 2, 3],
                [3, 1, 2, 5],
                [2, 1 / 2, 1, 4],
                [1 / 3, 1 / 5, 1 / 4, 1],
            ],
            "Desain": [
                [1, 3, 2, 5],
                [1 / 3, 1, 1 / 2, 3],
                [1 / 2, 2, 1, 4],
                [1 / 5, 1 / 3, 1 / 4, 1],
            ],
            "Fasilitas": [
                [1, 2, 3, 5],
                [1 / 2, 1, 2, 4],
                [1 / 3, 1 / 2, 1, 3],
                [1 / 5, 1 / 4, 1 / 3, 1],
            ],
        },
    },
    "mobil-terbaik": {
        "id": "mobil-terbaik",
        "title": "Pemilihan Mobil Terbaik",
        "subtitle": "Soal Ujian / Studi Kasus AHP",
        "goal": "Memilih mobil terbaik (Avanza vs Xenia vs Ertiga vs Grand Livina)",
        "description": (
            "Tiga kriteria (Style, Keandalan, Konsumsi Bahan Bakar) dibandingkan "
            "berpasangan lalu dinilai terhadap empat alternatif mobil."
        ),
        "criteria": ["Style", "Keandalan", "Konsumsi Bahan Bakar"],
        "alternatives": ["Avanza", "Xenia", "Ertiga", "Grand Livina"],
        "criteriaMatrix": [
            [1, 1 / 2, 3],
            [2, 1, 4],
            [1 / 3, 1 / 4, 1],
        ],
        "alternativeMatrices": {
            "Style": [
                [1, 2, 1 / 3, 1 / 4],
                [1 / 2, 1, 1 / 2, 1 / 5],
                [3, 2, 1, 2],
                [4, 5, 1 / 2, 1],
            ],
            "Keandalan": [
                [1, 2, 1 / 4, 1 / 3],
                [1 / 2, 1, 1 / 5, 1 / 4],
                [4, 5, 1, 3],
                [3, 4, 1 / 3, 1],
            ],
            "Konsumsi Bahan Bakar": [
                [1, 2, 1 / 2, 4],
                [1 / 2, 1, 2 / 3, 3],
                [2, 1.5, 1, 4],
                [1 / 4, 1 / 3, 1 / 4, 1],
            ],
        },
    },
}


# --------------------------------------------------------------------------- #
# Pages
# --------------------------------------------------------------------------- #

@app.get("/")
def index():
    """Render the single page wizard."""
    return render_template("index.html", presets=list(PRESETS.values()))


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #

@app.get("/api/health")
def health():
    return jsonify(
        {
            "ok": True,
            "service": "ahp-decision-system",
            "method": "Analytic Hierarchy Process (Saaty)",
            "priorityMethod": "Principal eigenvector (Saaty)",
            "serverComputed": True,
            "crThreshold": CR_THRESHOLD,
        }
    )


@app.get("/api/scale")
def scale():
    """Saaty fundamental scale + Random Index reference table."""
    return jsonify(
        {
            "ok": True,
            "scale": SAATY_SCALE,
            "randomIndex": {str(k): v for k, v in RI_TABLE.items()},
            "crThreshold": CR_THRESHOLD,
        }
    )


@app.get("/api/presets")
def presets():
    """Instant case studies usable by the wizard."""
    items = list(PRESETS.values())
    return jsonify({"ok": True, "count": len(items), "presets": items})


@app.post("/api/calculate")
def calculate():
    """
    Compute a complete AHP analysis.

    Payload:
        {
          "criteria": ["..."],
          "alternatives": ["..."],
          "criteriaMatrix": [[...]],
          "alternativeMatrices": [[...], ...]   # or {criterionName: matrix}
        }
    """
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "Body JSON tidak valid."}), 400

    try:
        result = run_ahp(payload)
    except AHPValidationError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except (TypeError, ValueError) as exc:
        return jsonify({"ok": False, "error": f"Data tidak valid: {exc}"}), 400
    except Exception as exc:  # pragma: no cover - defensive last resort
        app.logger.exception("Kesalahan komputasi AHP")
        return jsonify({"ok": False, "error": f"Kesalahan server: {exc}"}), 500

    # The whole server-computed analysis is returned at the top level for the UI.
    return jsonify({**result, "ok": True})


@app.errorhandler(404)
def not_found(_error):
    return jsonify({"ok": False, "error": "Endpoint tidak ditemukan."}), 404


@app.errorhandler(405)
def method_not_allowed(_error):
    return jsonify({"ok": False, "error": "Metode HTTP tidak diizinkan."}), 405


# --------------------------------------------------------------------------- #

if __name__ == "__main__":
    print("=" * 64)
    print(" SPK - Analytic Hierarchy Process (AHP)")
    print(" URL: http://127.0.0.1:5000")
    print("=" * 64)
    app.run(host="127.0.0.1", port=5000, debug=True, use_reloader=True)
