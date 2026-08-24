import sys
from pathlib import Path
from fastapi import Request

# Add project root directory to sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.main import app

@app.middleware("http")
async def fix_vercel_path(request: Request, call_next):
    path = request.scope.get("path", "")
    if path.startswith("/api/index.py"):
        request.scope["path"] = path.replace("/api/index.py", "", 1) or "/"
    elif path.startswith("/index.py"):
        request.scope["path"] = path.replace("/index.py", "", 1) or "/"
    return await call_next(request)
