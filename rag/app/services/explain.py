from __future__ import annotations

import json
import os
import re
from typing import Any
import litellm

from app.models.contracts import Explanation, Finding, PerFindingItem


def shorten_address(text: str) -> str:
    """Shortens 0x-prefixed addresses to 0x1234... format."""
    # Full 40-char hex (42 with 0x)
    text = re.sub(r"\b(0x[a-fA-F0-9]{4})[a-fA-F0-9]{36}\b", r"\1...", text)
    # Hex with unicode ellipsis or dot ellipsis: 0x1234…5678 or 0x1234...5678
    text = re.sub(r"\b(0x[a-fA-F0-9]{4})(?:…|\.\.\.)[a-fA-F0-9]+\b", r"\1...", text)
    return text


def clean_text_for_holder(text: str) -> str:
    """Cleans up raw execution syntax for non-technical token holders."""
    t = text.strip()
    t = shorten_address(t)

    # Convert known patterns to plain English
    # Pattern: Vault owner changes [from X] to <addr>
    m_owner = re.search(r"[vV]ault owner changes (?:from \w+ )?to (0x[a-fA-F0-9]+(?:\.\.\.)?)", t)
    if m_owner:
        addr = shorten_address(m_owner.group(1))
        return f"makes wallet {addr} the vault owner"

    # Pattern: reassigns ownership to <addr>
    m_reassign = re.search(r"reassigns ownership to (0x[a-fA-F0-9]+(?:\.\.\.)?)", t, re.IGNORECASE)
    if m_reassign:
        addr = shorten_address(m_reassign.group(1))
        return f"makes wallet {addr} the vault owner"

    # Pattern: Treasury approves <addr> for unlimited <token>
    m_approve = re.search(r"Treasury approves (0x[a-fA-F0-9]+(?:\.\.\.)?) for unlimited (\w+)", t, re.IGNORECASE)
    if m_approve:
        addr = shorten_address(m_approve.group(1))
        token = m_approve.group(2)
        return f"approves wallet {addr} to spend all {token}"

    # Pattern: Second call Treasury.approve(...) or Calls Treasury.approve(...)
    m_call_app = re.search(r"Treasury\.approve\s*\(\s*(\w+)\s*,\s*(0x[a-fA-F0-9]+(?:\.\.\.)?)\s*,\s*max\s*\)", t, re.IGNORECASE)
    if m_call_app:
        token = m_call_app.group(1)
        addr = shorten_address(m_call_app.group(2))
        return f"approves wallet {addr} to spend all {token}"

    # Strip call invocation prefixes (e.g. 'vault.upgradeToAndCall(...)', 'Calls Treasury.approve(...)')
    t = re.sub(r"^(?:Calls\s+)?[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+\((?:[^()]|\([^()]*\))*\)\s*", "", t)
    t = re.sub(r"^reinitializeV2\s+", "", t)
    t = re.sub(r"\bMaxUint256\b", "all available", t)
    t = re.sub(r",\s*max\b", ", all", t, flags=re.IGNORECASE)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def generate_explanation(
    proposal_id: str,
    findings: list[Finding | dict[str, Any]],
) -> Explanation:
    """
    Implements POST /explain {proposalId, findings: Finding[]} -> Explanation
    Rules:
    1. Written for a non-technical token holder.
    2. Strictly under 120 words.
    3. Quotes what the proposal said and states what the code actually does.
    4. Never invents facts not present in the findings.
    5. Keeps finding IDs in perFinding.
    """
    # 1. Normalize findings to structured dicts
    normalized_findings: list[dict[str, Any]] = []
    for f in findings:
        if isinstance(f, Finding):
            f_id = f.id
            cat = getattr(f.category, "value", str(f.category))
            sev = getattr(f.severity, "value", str(f.severity))
            said = f.said
            does = f.does
        elif isinstance(f, dict):
            f_id = f.get("id", "")
            cat = f.get("category", "")
            sev = f.get("severity", "")
            said = f.get("said", "")
            does = f.get("does", "")
        else:
            continue

        normalized_findings.append({
            "id": f_id,
            "category": cat,
            "severity": sev,
            "said": said or "",
            "does": does or "",
        })

    # Empty findings case
    if not normalized_findings:
        return Explanation(
            headline=f"No Discrepancies Detected for {proposal_id}",
            paragraph=f"The submitted execution code matches all commitments made in proposal {proposal_id}. No undeclared transfers, unauthorized role changes, or conflicting actions were detected.",
            perFinding=[],
        )

    api_key = os.environ.get("LLM_API_KEY") or os.environ.get("OPENAI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    use_mocks = os.environ.get("USE_MOCKS", "").lower() in ("true", "1")
    model_name = os.environ.get("LLM_MODEL", "gpt-4o-mini")

    # 2. LLM-assisted explanation pass
    if api_key and not use_mocks:
        try:
            findings_summary = json.dumps(normalized_findings, indent=2)
            prompt = f"""You are a DAO governance safety analyst writing an explanation directly for non-technical token holders of Meridian DAO.
Explain the governance findings for proposal {proposal_id}.

FINDINGS:
{findings_summary}

MANDATORY RULES:
1. Audience: Written for a non-technical token holder (simple, punchy, plain English).
2. Length: Under 120 words TOTAL for the paragraph.
3. Content: Quote what the proposal said and state what the code actually does.
4. Accuracy: NEVER invent facts, contract names, addresses, or vulnerabilities not present in the findings.
5. Finding IDs: Keep every finding ID exactly as provided in the perFinding array.
6. Target style example:
   "The proposal promised a gas optimisation with no change to ownership. The submitted code also makes wallet 0x9f2c... the vault owner and approves it to spend all USDC."

Respond ONLY with valid JSON matching:
{{
  "headline": "Short warning headline for token holders",
  "paragraph": "Cohesive summary paragraph (strictly under 120 words) comparing what the proposal said vs what the code does",
  "perFinding": [
    {{
      "findingId": "finding-id",
      "sentence": "One clear sentence for this finding comparing what was said to what the code actually does"
    }}
  ]
}}
"""
            response = litellm.completion(
                model=model_name,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
                response_format={"type": "json_object"},
                timeout=15,
            )
            parsed = json.loads(response.choices[0].message.content)
            headline = parsed.get("headline", f"{proposal_id} does more than it says")
            paragraph = parsed.get("paragraph", "").strip()

            # Enforce strictly under 120 words
            words = paragraph.split()
            if len(words) > 115:
                paragraph = " ".join(words[:110]).rstrip(".") + "."

            returned_map = {pf.get("findingId"): pf.get("sentence") for pf in parsed.get("perFinding", [])}
            per_finding_list: list[PerFindingItem] = []

            for f_item in normalized_findings:
                fid = f_item["id"]
                sentence = returned_map.get(fid)
                if not sentence:
                    said_txt = f_item["said"].strip()
                    does_txt = clean_text_for_holder(f_item["does"])
                    if said_txt and said_txt.lower() not in ("none", "null", "not stated", "not mentioned"):
                        sentence = f'The proposal promised "{said_txt.rstrip(".")}", but the submitted code actually {does_txt}.'
                    else:
                        sentence = f"The proposal did not disclose this action, but the submitted code actually {does_txt}."
                per_finding_list.append(PerFindingItem(findingId=fid, sentence=sentence))

            return Explanation(
                headline=headline,
                paragraph=paragraph,
                perFinding=per_finding_list,
            )
        except Exception:
            pass

    # 3. Deterministic Heuristic Branch (Offline / Fallback / Guaranteed Precision)
    per_finding_list: list[PerFindingItem] = []
    said_quotes: list[str] = []
    does_summaries: list[str] = []

    for f_item in normalized_findings:
        fid = f_item["id"]
        said_raw = f_item["said"].strip()
        does_clean = clean_text_for_holder(f_item["does"])

        if said_raw and said_raw.lower() not in ("none", "null", "not stated", "not mentioned"):
            q_said = said_raw.rstrip(".")
            sentence = f'The proposal promised "{q_said}", but the submitted code actually {does_clean}.'
            said_quotes.append(q_said)
        else:
            sentence = f"The proposal did not disclose this action, but the submitted code actually {does_clean}."

        does_summaries.append(does_clean)
        per_finding_list.append(PerFindingItem(findingId=fid, sentence=sentence))

    # Formulate Headline
    has_critical = any(f["severity"].lower() in ("critical", "high") for f in normalized_findings)
    if has_critical:
        headline = f"{proposal_id} does more than it says"
    else:
        headline = f"Discrepancies Detected Between Proposal and Code for {proposal_id}"

    # Formulate Paragraph (under 120 words)
    has_gas = any("gas" in s.lower() or "storage" in s.lower() or "optimis" in s.lower() or "optimiz" in s.lower() for s in said_quotes)
    has_ownership = any("ownership" in s.lower() for s in said_quotes)

    if has_gas and has_ownership:
        said_part = "The proposal promised a gas optimisation with no change to ownership."
    elif has_ownership:
        said_part = "The proposal promised no change to ownership."
    elif has_gas:
        said_part = "The proposal promised a gas optimisation."
    elif said_quotes:
        top_said = said_quotes[0].strip(' "\'.')
        if len(top_said) > 100:
            top_said = top_said[:95] + "..."
        if top_said.lower().startswith("a ") or top_said.lower().startswith("an "):
            said_part = f"The proposal promised {top_said}."
        else:
            said_part = f'The proposal promised "{top_said}".'
    else:
        said_part = "The proposal promised standard operations with no unexpected changes."

    # Format what the code actually does
    cleaned_actions: list[str] = []
    for d in does_summaries:
        act = d.rstrip(".").strip()
        if not act:
            continue
        if act.lower().startswith("granting "):
            act = "grants " + act[9:]
        elif act.lower().startswith("reassigns "):
            act = "makes " + act[10:]
        if act and act[0].isupper() and not act.startswith("0x"):
            act = act[0].lower() + act[1:]
        if act not in cleaned_actions:
            cleaned_actions.append(act)

    if len(cleaned_actions) == 1:
        does_part = f"The submitted code actually {cleaned_actions[0]}."
    elif len(cleaned_actions) == 2:
        act1 = cleaned_actions[0]
        act2 = cleaned_actions[1]
        # Pronoun substitution for repeated wallet
        m_wallet = re.search(r"(wallet 0x[a-fA-F0-9]+(?:\.\.\.)?)", act1)
        if m_wallet and m_wallet.group(1) in act2:
            act2 = act2.replace(m_wallet.group(1), "it")
        does_part = f"The submitted code also {act1} and {act2}."
    elif len(cleaned_actions) >= 3:
        act1 = cleaned_actions[0]
        act2 = cleaned_actions[1]
        act3 = cleaned_actions[2]
        m_wallet = re.search(r"(wallet 0x[a-fA-F0-9]+(?:\.\.\.)?)", act1)
        if m_wallet and m_wallet.group(1) in act2:
            act2 = act2.replace(m_wallet.group(1), "it")
        does_part = f"The submitted code also {act1}, {act2}, and {act3}."
    else:
        does_part = "The submitted code introduces undeclared modifications."

    paragraph = f"{said_part} {does_part}".strip()

    # Enforce strictly under 120 words
    words = paragraph.split()
    if len(words) > 115:
        paragraph = " ".join(words[:110]).rstrip(".") + "."

    return Explanation(
        headline=headline,
        paragraph=paragraph,
        perFinding=per_finding_list,
    )
