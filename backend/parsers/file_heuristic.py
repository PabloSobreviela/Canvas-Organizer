# backend/parsers/file_heuristic.py
import re

KEYWORDS = [
    r"syllabus",
    r"schedule",
    r"calendar",
    r"course\s*outline",
    r"weekly\s*plan",
    r"grading",
    r"assessment"
]

def score_filename(name: str) -> int:
    name = name.lower()
    score = 0
    for pattern in KEYWORDS:
        if re.search(pattern, name):
            score += 1
    return score

def is_candidate(name: str) -> bool:
    return score_filename(name) > 0
