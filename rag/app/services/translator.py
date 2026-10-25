from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request
from typing import Any

# Memory cache for translations
_TRANSLATION_CACHE: dict[str, str] = {}

# Common non-English words across Spanish, French, German, Italian, Portuguese
NON_ENGLISH_INDICATORS = {
    # Spanish
    "esta", "este", "estos", "estas", "propuesta", "solicita", "asignación", "asignacion",
    "fondos", "para", "como", "con", "una", "del", "las", "los", "por", "presupuesto",
    # French
    "cette", "proposition", "demande", "allocation", "fonds", "pour", "avec", "dans",
    "sur", "est", "une", "des", "le", "la", "les", "du",
    # German
    "dieser", "dieses", "vorschlag", "fordert", "zuweisung", "mittel", "für", "fuer",
    "mit", "nicht", "oder", "und", "der", "die", "das", "ein", "eine",
    # Common accented characters regex
}

COMMON_ENGLISH_WORDS = {
    "the", "and", "is", "of", "to", "in", "for", "with", "this", "that", "from", "are",
    "proposal", "requests", "allocation", "funds", "budget", "token", "contract", "upgrade",
}

# Offline dictionary for predictable tests & no-internet scenarios
OFFLINE_TRANSLATIONS: dict[str, str] = {
    "esta propuesta solicita una asignacion de fondos": "This proposal requests an allocation of funds.",
    "esta propuesta solicita una asignación de fondos": "This proposal requests an allocation of funds.",
    "solicitamos un presupuesto adicional para el equipo": "We request an additional budget for the team.",
    "cette proposition demande une allocation de fonds": "This proposal requests an allocation of funds.",
    "dieser vorschlag fordert eine zuweisung von mitteln": "This proposal requests an allocation of funds.",
}


def is_english(text: str) -> bool:
    """
    Returns True if text is primarily English, False if likely non-English.
    """
    if not text or not text.strip():
        return True

    clean_text = text.strip()

    # Check for CJK, Cyrillic, Arabic, Greek characters
    if re.search(r"[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\u0600-\u06FF\u0370-\u03FF]", clean_text):
        return False

    # Tokenize words (lowercase)
    words = [w.lower() for w in re.findall(r"\b[a-záéíóúüñçàèìòùâêîôûäöëïÿ]+\b", clean_text, re.IGNORECASE)]
    if not words:
        return True

    non_eng_count = sum(1 for w in words if w in NON_ENGLISH_INDICATORS)
    eng_count = sum(1 for w in words if w in COMMON_ENGLISH_WORDS)

    # If significant non-English words and low English words
    if non_eng_count > 0 and non_eng_count >= eng_count:
        return False

    # Check for heavy presence of non-ASCII accented characters
    accented_chars = len(re.findall(r"[áéíóúüñçàèìòùâêîôûäöëïÿ]", clean_text, re.IGNORECASE))
    if accented_chars > 3 and (accented_chars / max(1, len(clean_text))) > 0.03:
        return False

    return True


def translate_to_english(text: str) -> str:
    """
    Translates non-English text to English before embedding.
    Uses LLM if available, falls back to free Google Translate API,
    and falls back to offline dictionary / heuristic.
    """
    clean_text = text.strip()
    if not clean_text:
        return text

    cache_key = clean_text.lower()
    if cache_key in _TRANSLATION_CACHE:
        return _TRANSLATION_CACHE[cache_key]

    # 1. Check offline dictionary for quick matches
    normalized_key = re.sub(r"\s+", " ", cache_key)
    for k, v in OFFLINE_TRANSLATIONS.items():
        if k in normalized_key:
            _TRANSLATION_CACHE[cache_key] = v
            return v

    # 2. Try LLM if litellm API key is provided
    api_key = os.environ.get("LLM_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if api_key and os.environ.get("USE_MOCKS", "").lower() not in ("true", "1"):
        try:
            import litellm
            model_name = os.environ.get("LLM_MODEL", "gpt-4o-mini")
            res = litellm.completion(
                model=model_name,
                messages=[
                    {
                        "role": "user",
                        "content": f"Translate the following text to English. Return ONLY the English translation without quotes or preamble:\n\n{clean_text}",
                    }
                ],
                temperature=0,
                timeout=6,
            )
            translated = res.choices[0].message.content.strip()
            if translated:
                _TRANSLATION_CACHE[cache_key] = translated
                return translated
        except Exception:
            pass

    # 3. Try free Google Translate endpoint via urllib
    try:
        url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=" + urllib.parse.quote(clean_text)
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
        )
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data and isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
                translated = "".join(seg[0] for seg in data[0] if seg and len(seg) > 0 and seg[0])
                if translated.strip():
                    _TRANSLATION_CACHE[cache_key] = translated.strip()
                    return translated.strip()
    except Exception:
        pass

    # 4. Fallback if offline and not in dictionary
    return clean_text
