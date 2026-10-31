import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

import feedback  # noqa: E402

feedback.RULES_PATH = Path("/tmp/grosh/feedback.json")

from main import app  # noqa: E402,F401
