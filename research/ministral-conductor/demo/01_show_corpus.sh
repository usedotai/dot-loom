#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
. .venv/bin/activate
python - <<'PY'
import json

manifest = json.load(open("data/manifest.json"))
audit = json.load(open("receipts/independent-label-audit-v2-openai-90-validated.json"))["summary"]
audit_fields = (
    "model",
    "sample_size",
    "agreement_count",
    "agreement_rate",
    "disagreement_count",
    "valid_feasible_alternatives",
    "invalid_or_infeasible_alternatives",
    "oracle_improving_alternatives",
    "no_test_labels_audited",
    "no_user_prompts",
    "revalidated_without_api_calls",
)
print(json.dumps({
    "schema": manifest["schema_version"],
    "no_user_prompts": manifest["no_user_prompts"],
    "license": manifest["license"],
    "splits": manifest["files"],
    "family_leakage": manifest["family_leakage"],
    "label_method": manifest["label_method"],
    "independent_audit": {key: audit[key] for key in audit_fields},
}, indent=2, sort_keys=True))
PY
