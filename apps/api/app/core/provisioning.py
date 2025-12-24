from __future__ import annotations

import hashlib
import secrets
import re
from datetime import date


_CYR_TO_LAT = {
    "а": "a",
    "б": "b",
    "в": "v",
    "г": "g",
    "д": "d",
    "е": "e",
    "ё": "e",
    "ж": "zh",
    "з": "z",
    "и": "i",
    "й": "i",
    "к": "k",
    "л": "l",
    "м": "m",
    "н": "n",
    "о": "o",
    "п": "p",
    "р": "r",
    "с": "s",
    "т": "t",
    "у": "u",
    "ф": "f",
    "х": "h",
    "ц": "ts",
    "ч": "ch",
    "ш": "sh",
    "щ": "shch",
    "ъ": "",
    "ы": "y",
    "ь": "",
    "э": "e",
    "ю": "yu",
    "я": "ya",
    # Kyrgyz-specific
    "ң": "n",
    "ө": "o",
    "ү": "u",
}


def translit_to_ascii(value: str) -> str:
    s = (value or "").strip().lower()
    out: list[str] = []
    for ch in s:
        if "a" <= ch <= "z" or "0" <= ch <= "9":
            out.append(ch)
            continue
        if ch in (" ", "-", "_", "."):
            out.append("-")
            continue
        mapped = _CYR_TO_LAT.get(ch)
        if mapped is not None:
            out.append(mapped)
            continue
        # drop anything else
    res = "".join(out)
    res = re.sub(r"-+", "-", res).strip("-")
    return res


def slug_piece(value: str) -> str:
    s = translit_to_ascii(value)
    s = re.sub(r"[^a-z0-9-]", "", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def full_name_from_parts(*, last_name: str, first_name: str, middle_name: str | None) -> str:
    parts = [last_name.strip(), first_name.strip()]
    if middle_name and middle_name.strip():
        parts.append(middle_name.strip())
    return " ".join([p for p in parts if p])


def password_fingerprint(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def generate_numeric_password(max_len: int = 12) -> str:
    # Up to 12 digits, digits-only.
    length = max(6, min(12, max_len))
    # Prefer 12 digits ("до 12") for better entropy.
    length = 12 if length >= 12 else length
    first_digit = str(1 + secrets.randbelow(9))
    rest = "".join(str(secrets.randbelow(10)) for _ in range(length - 1))
    return first_digit + rest


def username_base(*, role: str, first_name: str, last_name: str, birth_date: date) -> str:
    year = birth_date.year
    first = slug_piece(first_name)
    last = slug_piece(last_name)
    last3 = (last[:3] if last else "")
    tail = f"{last3}{year}" if last3 else str(year)
    return f"{role}-{first}-{tail}".strip("-")
