# TRADE BAZZAR

Mobile-first paper-trading web application rebuilt around the supplied TRADE BAZZAR screenshots.

## UI
- Light/off-white default theme with brown/gold accent.
- Five fixed bottom tabs: WATCHLIST, TRADE, POSITIONS, ORDERS, SETTINGS.
- Screenshot-style balance, watchlist, transaction, positions, orders and settings screens.
- Stock details and BUY/SELL order flow.
- Deposit/Withdraw screens with UPI + QR and admin review flow.
- Settings: account, ledger, rejection logs, bill download, password, T&C, theme, hide balances, sounds, number size and bold numbers.
- Optional dark mode is available from Settings but Light is the default.

## Accounts
There is no public registration. Users are created by the administrator.

Default admin:
- ID: `admin`
- Password: `Admin@123`

Change the admin password before production use.

## Run locally

```powershell
cd "TRADE_BAZZAR\backend"
pip install -r requirements.txt
python app.py
```

Open:
- User login: `http://127.0.0.1:5000/`
- Admin: `http://127.0.0.1:5000/admin`

## Important
- User balances start at ₹0.
- Deposits remain pending until an admin approves them.
- Withdrawals remain pending until an admin approves them.
- Market prices use the backend market provider and may be unavailable/delayed.
- Paper orders are not connected to a stock exchange.
- Admin payment settings control the UPI ID and QR shown on the user Deposit screen.

## Project
```text
TRADE_BAZZAR/
├── backend/
├── data/
└── frontend/
```
