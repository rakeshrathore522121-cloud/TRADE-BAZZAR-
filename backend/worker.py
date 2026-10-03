import os

# Tell database.py not to initialize a local SQLite file inside Workers.
os.environ["TRADE_BAZZAR_CLOUDFLARE"] = "1"

from workers import wsgi
from app import app

# Cloudflare's Python Workers runtime provides the WSGI bridge used by Flask.
Default = wsgi.entrypoint(app)
