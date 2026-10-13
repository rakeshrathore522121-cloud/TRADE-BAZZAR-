TRADE BAZZAR — NSE Option Chain fix

1. Make a backup of your current backend/app.py.
2. Replace ONLY backend/app.py with the app.py included in this ZIP.
3. Keep database.py and all frontend files unchanged.
4. Stop the running Flask server with Ctrl+C.
5. From PowerShell run:
   cd "C:\Users\SKC\Desktop\TRADE_BAZZAR\backend"
   python app.py
6. Log in at http://127.0.0.1:5000/dashboard.html and open F&O.
7. If contracts are still empty, inspect the PowerShell terminal. NSE can block/rate-limit automated requests, so this code logs the request failure instead of fabricating market data.

No GitHub push or Render deployment is performed.
