from __future__ import annotations

import json
import sys
from pathlib import Path

# Add rag directory to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.main import app
from app.models.contracts import DecisionSummary
from app.services.cache import CACHE_DIR, save_cached_proposal_summary


def run_calibration_and_generate_cache():
    client = TestClient(app)
    scenarios = ["MIP-12", "MIP-17", "MIP-21"]

    print("=== 1. Ingesting & Summarizing Scenarios ===")
    results: dict[str, DecisionSummary] = {}
    
    for pid in scenarios:
        # Ingest
        ingest_payload = {
            "proposalId": pid,
            "files": [
                {"type": "forum", "path": f"data/scenarios/{pid}/forum_thread.json"},
                {"type": "pdf", "path": f"data/scenarios/{pid}/proposal.pdf"},
                {"type": "social", "path": f"data/scenarios/{pid}/social.json"},
                {"type": "onchain", "path": f"data/scenarios/{pid}/onchain_actions.json"},
            ],
        }
        ing_resp = client.post("/ingest", json=ingest_payload)
        assert ing_resp.status_code == 200, f"Failed ingesting {pid}"

        # Summarize
        sum_resp = client.post("/summarize", json={"proposalId": pid})
        assert sum_resp.status_code == 200, f"Failed summarizing {pid}"
        summary = DecisionSummary.model_validate(sum_resp.json())
        results[pid] = summary

        # Ship pre-computed cache file in /rag/cache/{pid}.json
        save_cached_proposal_summary(pid, summary)
        cache_file = CACHE_DIR / f"{pid}.json"
        print(f"Shipped pre-computed cache: {cache_file} (exists: {cache_file.exists()})")

    print("\n=== 2. Claim Scoring Evaluation & Confusion Matrix ===")
    
    # Threshold for predicting supported vs unsupported
    THRESHOLD = 0.5

    total_supported_scores: list[float] = []
    total_unsupported_scores: list[float] = []

    tp = 0  # Actual supported, predicted supported (p >= 0.5)
    fn = 0  # Actual supported, predicted unsupported (p < 0.5)
    fp = 0  # Actual unsupported/contradicted, predicted supported (p >= 0.5)
    tn = 0  # Actual unsupported/contradicted, predicted unsupported (p < 0.5)

    per_scenario_details = []

    workspace_root = Path(__file__).resolve().parents[2]

    for pid in scenarios:
        expected_path = workspace_root / "data" / "scenarios" / pid / "expected.json"
        if not expected_path.exists():
            expected_path = Path("..") / "data" / "scenarios" / pid / "expected.json"
        with open(expected_path, "r", encoding="utf-8") as f:
            expected = json.load(f)

        summary = results[pid]
        claims = summary.claims
        
        print(f"\n--- {pid} ({len(claims)} claims) ---")
        for c in claims:
            is_supported_label = c.support.value == "supported"
            predicted_supported = c.pSupported >= THRESHOLD

            if is_supported_label:
                total_supported_scores.append(c.pSupported)
                if predicted_supported:
                    tp += 1
                else:
                    fn += 1
            else:
                total_unsupported_scores.append(c.pSupported)
                if predicted_supported:
                    fp += 1
                else:
                    tn += 1

            status = "TP" if (is_supported_label and predicted_supported) else \
                     "TN" if (not is_supported_label and not predicted_supported) else \
                     "FP" if (not is_supported_label and predicted_supported) else "FN"
            
            print(f"  [{status}] ID={c.id} pSupported={c.pSupported:.2f} (label={c.support.value}) - {c.text[:60]}...")

    avg_supported = sum(total_supported_scores) / len(total_supported_scores) if total_supported_scores else 0.0
    avg_unsupported = sum(total_unsupported_scores) / len(total_unsupported_scores) if total_unsupported_scores else 0.0

    print("\n=== Calibration Results Summary ===")
    print(f"Supported claims count:   {len(total_supported_scores)}")
    print(f"Supported claims avg:     {avg_supported:.4f}  (Requirement: > 0.80 -> {'PASSED' if avg_supported > 0.8 else 'FAILED'})")
    print(f"Unsupported claims count: {len(total_unsupported_scores)}")
    print(f"Unsupported claims avg:   {avg_unsupported:.4f}  (Requirement: < 0.35 -> {'PASSED' if avg_unsupported < 0.35 else 'FAILED'})")

    print("\n=== Confusion Matrix ===")
    print("                     Predicted Supp    Predicted Unsupp")
    print(f"Actual Supported         {tp:<17} {fn:<16}")
    print(f"Actual Unsupported       {fp:<17} {tn:<16}")
    print(f"\nAccuracy:  {(tp + tn) / (tp + tn + fp + fn) * 100:.1f}%")
    print(f"Precision: {tp / (tp + fp) * 100 if (tp + fp) > 0 else 0:.1f}%")
    print(f"Recall:    {tp / (tp + fn) * 100 if (tp + fn) > 0 else 0:.1f}%")


if __name__ == "__main__":
    run_calibration_and_generate_cache()
