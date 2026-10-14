/**
 * presets.js
 * ----------
 * Konfigurasi data uji / studi kasus instan untuk wizard AHP.
 *
 * Dua preset tersedia:
 *   1. "Pemilihan Rumah di Semarang" (studi kasus Dr. Hozairi - Universitas Islam Madura)
 *      -> alternatif Taman Bukit Asri (TBA) menang dengan skor 0.333
 *   2. "Pemilihan Mobil Terbaik" (Avanza, Xenia, Ertiga, Grand Livina)
 *
 * Data ini identik dengan PRESETS pada app.py (endpoint GET /api/presets).
 */
(function (global) {
  "use strict";

  var AHP_PRESETS = [
    {
      id: "rumah-semarang",
      title: "Pemilihan Rumah di Semarang",
      subtitle: "Studi Kasus Dr. Hozairi - Universitas Islam Madura",
      goal: "Memilih rumah tinggal terbaik di Semarang",
      description:
        "Perbandingan empat perumahan di Semarang berdasarkan empat kriteria: " +
        "Lokasi, Harga, Desain, dan Fasilitas. Alternatif Taman Bukit Asri (TBA) " +
        "menjadi pemenang dengan skor 0.333.",
      criteria: ["Lokasi", "Harga", "Desain", "Fasilitas"],
      alternatives: [
        "Taman Bukit Asri (TBA)",
        "Bukit Semarang Baru (BSB)",
        "Ciputra Sunindo (CS)",
        "Tlogosari Regency (TR)",
      ],
      criteriaMatrix: [
        [1, 3, 5, 7],
        [1 / 3, 1, 3, 5],
        [1 / 5, 1 / 3, 1, 3],
        [1 / 7, 1 / 5, 1 / 3, 1],
      ],
      alternativeMatrices: {
        Lokasi: [
          [1, 2, 1, 6],
          [1 / 2, 1, 1, 6],
          [1, 1, 1, 8],
          [1 / 6, 1 / 6, 1 / 8, 1],
        ],
        Harga: [
          [1, 1 / 3, 1 / 2, 3],
          [3, 1, 2, 5],
          [2, 1 / 2, 1, 4],
          [1 / 3, 1 / 5, 1 / 4, 1],
        ],
        Desain: [
          [1, 3, 2, 5],
          [1 / 3, 1, 1 / 2, 3],
          [1 / 2, 2, 1, 4],
          [1 / 5, 1 / 3, 1 / 4, 1],
        ],
        Fasilitas: [
          [1, 2, 3, 5],
          [1 / 2, 1, 2, 4],
          [1 / 3, 1 / 2, 1, 3],
          [1 / 5, 1 / 4, 1 / 3, 1],
        ],
      },
    },
    {
      id: "mobil-terbaik",
      title: "Pemilihan Mobil Terbaik",
      subtitle: "Soal Ujian / Studi Kasus AHP",
      goal: "Memilih mobil terbaik (Avanza vs Xenia vs Ertiga vs Grand Livina)",
      description:
        "Tiga kriteria (Style, Keandalan, Konsumsi Bahan Bakar) dibandingkan " +
        "berpasangan lalu dinilai terhadap empat alternatif mobil.",
      criteria: ["Style", "Keandalan", "Konsumsi Bahan Bakar"],
      alternatives: ["Avanza", "Xenia", "Ertiga", "Grand Livina"],
      criteriaMatrix: [
        [1, 1 / 2, 3],
        [2, 1, 4],
        [1 / 3, 1 / 4, 1],
      ],
      alternativeMatrices: {
        Style: [
          [1, 2, 1 / 3, 1 / 4],
          [1 / 2, 1, 1 / 2, 1 / 5],
          [3, 2, 1, 2],
          [4, 5, 1 / 2, 1],
        ],
        Keandalan: [
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
  ];

  var SAATY_SCALE = [
    { value: 1, meaning: "Sama penting dengan elemen lain" },
    { value: 2, meaning: "Kompromi antara 1 dan 3" },
    { value: 3, meaning: "Sedikit lebih penting" },
    { value: 4, meaning: "Kompromi antara 3 dan 5" },
    { value: 5, meaning: "Lebih penting" },
    { value: 6, meaning: "Kompromi antara 5 dan 7" },
    { value: 7, meaning: "Sangat penting" },
    { value: 8, meaning: "Kompromi antara 7 dan 9" },
    { value: 9, meaning: "Mutlak sangat penting" },
  ];

  var RI_TABLE = {
    1: 0.0,
    2: 0.0,
    3: 0.58,
    4: 0.9,
    5: 1.12,
    6: 1.24,
    7: 1.32,
    8: 1.41,
    9: 1.45,
    10: 1.49,
  };

  global.AHP_PRESETS = AHP_PRESETS;
  global.AHP_SAATY_SCALE = SAATY_SCALE;
  global.AHP_RI_TABLE = RI_TABLE;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { AHP_PRESETS: AHP_PRESETS, AHP_SAATY_SCALE: SAATY_SCALE, AHP_RI_TABLE: RI_TABLE };
  }
})(typeof window !== "undefined" ? window : this);
