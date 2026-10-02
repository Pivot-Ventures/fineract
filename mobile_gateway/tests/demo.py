"""Run the gateway against the in-memory fake core banking from the tests — for trying the app on a
phone without touching any Fineract tenant. Never use in production.

    docker run --rm -p 8700:8000 -v "$PWD":/src -w /src python:3.12-slim \
      sh -c "pip install -q -r requirements-dev.txt && python -m tests.demo"

Staff credentials for the admin endpoints: teller / secret.
Mobile-money deposits use the sandbox provider: approved after ~6 s; a number ending 000 is
declined, one ending 999 never answers.
"""
import os

os.environ.setdefault("FINERACT_URL", "http://core")
os.environ.setdefault("FINERACT_USER", "demo")
os.environ.setdefault("FINERACT_PASSWORD", "demo")
os.environ.setdefault("MOMO_PROVIDER", "sandbox")

import httpx  # noqa: E402
import uvicorn  # noqa: E402

from app import main  # noqa: E402
from app.fineract import Fineract  # noqa: E402
from app.store import Store  # noqa: E402
from tests.test_gateway import FakeCore  # noqa: E402

core = FakeCore()
core.savings[3] = {"id": 3, "accountNo": "000000003", "clientId": 1, "balance": 250000.0}
# Kept next to the code (git-ignored) so phone registrations survive a restart.
main.configure(Store(os.environ.get("DEMO_DB", "demo.sqlite3")),
               Fineract("http://core", "default", "demo", "demo", transport=httpx.MockTransport(core.handler)))
uvicorn.run(main.app, host="0.0.0.0", port=8000)
