"""Parity checks for the browser AHP engine used by the GitHub Pages build."""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

from ahp_engine import run_ahp


ROOT = Path(__file__).resolve().parents[1]


class StaticPagesEngineTests(unittest.TestCase):
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

    def _run_browser_engine(self) -> dict:
        script = (
            "const engine=require('./static/js/ahp_static_engine.js');"
            "let body='';process.stdin.on('data',chunk=>body+=chunk);"
            "process.stdin.on('end',()=>console.log(JSON.stringify(engine.calculate(JSON.parse(body)))));"
        )
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            input=json.dumps(self.payload),
            text=True,
            capture_output=True,
            check=True,
        )
        return json.loads(result.stdout)

    def test_browser_engine_matches_python_for_a_valid_case(self) -> None:
        python_result = run_ahp(self.payload)
        browser_result = self._run_browser_engine()

        self.assertFalse(browser_result["calculation"]["serverComputed"])
        self.assertEqual(browser_result["ranking"], python_result["ranking"])
        self.assertEqual(browser_result["summary"]["allConsistent"], python_result["summary"]["allConsistent"])
        self.assertAlmostEqual(
            browser_result["criteriaAnalysis"]["lambda_max"],
            python_result["criteriaAnalysis"]["lambda_max"],
            places=10,
        )
        for browser_weight, python_weight in zip(
            browser_result["criteriaAnalysis"]["weights"],
            python_result["criteriaAnalysis"]["weights"],
        ):
            self.assertAlmostEqual(browser_weight, python_weight, places=10)

    def test_pages_entrypoint_is_static(self) -> None:
        index = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("{{", index)
        self.assertIn("static/js/ahp_static_engine.js", index)
        self.assertTrue((ROOT / ".github" / "workflows" / "deploy-pages.yml").is_file())

    def test_browser_engine_rejects_non_reciprocal_input(self) -> None:
        self.payload["criteriaMatrix"][1][0] = 0.4
        script = (
            "const engine=require('./static/js/ahp_static_engine.js');"
            "let body='';process.stdin.on('data',chunk=>body+=chunk);"
            "process.stdin.on('end',()=>{try{engine.calculate(JSON.parse(body));process.exit(2)}"
            "catch(error){console.log(error.message)}});"
        )
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            input=json.dumps(self.payload),
            text=True,
            capture_output=True,
            check=True,
        )
        self.assertIn("tidak resiprokal", result.stdout)


if __name__ == "__main__":
    unittest.main()
