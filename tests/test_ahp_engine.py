"""Regression tests for the server-side AHP calculation contract."""

from __future__ import annotations

import unittest

import numpy as np

from ahp_engine import AHPValidationError, analyze_matrix, matrix_from_weights, run_ahp
from app import app


class MatrixValidationTests(unittest.TestCase):
    def test_principal_eigenvector_is_normalised_and_verifiable(self) -> None:
        expected = np.array([0.5, 0.3, 0.2])
        matrix = [[float(left / right) for right in expected] for left in expected]

        analysis = analyze_matrix(matrix, ["A", "B", "C"], "Matriks uji")

        np.testing.assert_allclose(analysis["weights"], expected, rtol=1e-10, atol=1e-10)
        self.assertAlmostEqual(analysis["weight_sum"], 1.0, places=12)
        self.assertAlmostEqual(analysis["lambda_max"], 3.0, places=10)
        self.assertAlmostEqual(analysis["cr"], 0.0, places=10)
        self.assertLess(analysis["eigen_residual"], 1e-10)
        self.assertEqual(analysis["priority_method"], "Principal eigenvector (Saaty)")

    def test_matrix_generator_keeps_pairwise_reciprocity(self) -> None:
        matrix = matrix_from_weights([0.5, 0.3, 0.2], precision=6)
        for i, row in enumerate(matrix):
            self.assertAlmostEqual(row[i], 1.0)
            for j in range(i + 1, len(row)):
                self.assertAlmostEqual(row[j] * matrix[j][i], 1.0, places=10)

    def test_rejects_non_reciprocal_matrix(self) -> None:
        with self.assertRaisesRegex(AHPValidationError, "tidak resiprokal"):
            analyze_matrix(
                [[1, 2, 3], [0.4, 1, 2], [1 / 3, 1 / 2, 1]],
                ["A", "B", "C"],
            )

    def test_rejects_non_unit_diagonal_and_out_of_scale_values(self) -> None:
        with self.assertRaisesRegex(AHPValidationError, "diagonal"):
            analyze_matrix(
                [[2, 2, 3], [1 / 2, 1, 2], [1 / 3, 1 / 2, 1]],
                ["A", "B", "C"],
            )

        with self.assertRaisesRegex(AHPValidationError, "skala Saaty"):
            analyze_matrix(
                [[1, 10, 3], [1 / 10, 1, 2], [1 / 3, 1 / 2, 1]],
                ["A", "B", "C"],
            )


class FullAnalysisTests(unittest.TestCase):
    @staticmethod
    def _matrix(weights: list[float]) -> list[list[float]]:
        return [[left / right for right in weights] for left in weights]

    def setUp(self) -> None:
        self.payload = {
            "goal": "Memilih alternatif paling tepat",
            "criteria": ["Biaya", "Mutu", "Kecepatan"],
            "alternatives": ["A", "B", "C"],
            "criteriaMatrix": self._matrix([0.6, 0.3, 0.1]),
            "alternativeMatrices": [
                self._matrix([0.5, 0.3, 0.2]),
                self._matrix([0.2, 0.5, 0.3]),
                self._matrix([0.3, 0.2, 0.5]),
            ],
        }

    def test_full_analysis_is_server_verifiable(self) -> None:
        result = run_ahp(self.payload)

        self.assertEqual(result["goal"], self.payload["goal"])
        self.assertTrue(result["summary"]["allConsistent"])
        self.assertEqual(result["summary"]["consistentMatrices"], 4)
        self.assertAlmostEqual(sum(row["score"] for row in result["ranking"]), 1.0, places=10)
        self.assertTrue(result["calculation"]["serverComputed"])
        self.assertEqual(result["calculation"]["engine"], "Python + NumPy")

    def test_calculation_api_returns_json_safe_verified_result(self) -> None:
        app.config.update(TESTING=True)
        with app.test_client() as client:
            response = client.post("/api/calculate", json=self.payload)

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["ok"])
        self.assertTrue(data["summary"]["allConsistent"])
        self.assertNotIn("matrix_df", data["criteriaAnalysis"])

    def test_calculation_api_refuses_broken_pair(self) -> None:
        self.payload["criteriaMatrix"][1][0] = 0.4
        app.config.update(TESTING=True)
        with app.test_client() as client:
            response = client.post("/api/calculate", json=self.payload)

        self.assertEqual(response.status_code, 400)
        self.assertIn("tidak resiprokal", response.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
