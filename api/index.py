import sys
from pathlib import Path
from fastapi import Request

# Add project root directory to sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.main import app

@app.middleware("http")
async def normalize_vercel_path(request: Request, call_next):
    """Normalize Vercel Serverless Function rewritten paths so all routes match cleanly."""
    path = request.scope.get("path", "")
    if path.startswith("/api/index.py"):
        new_path = path.replace("/api/index.py", "") or "/"
        request.scope["path"] = new_path
    elif path.startswith("/index.py"):
        new_path = path.replace("/index.py", "") or "/"
        request.scope["path"] = new_path
    
    response = await call_next(request)
    return response
