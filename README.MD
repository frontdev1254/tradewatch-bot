# 🟢 Tradewatch Bot

A robust and production-grade trading bot built with **Node.js** that:

- Monitors a **Google Sheets** spreadsheet for new trade entries  
- Sends **automated trade cards** to a specific **Telegram topic**  
- Monitors live prices via the **Bybit API**  
- Automatically updates trade statuses with stop-loss and target logic  

---

## ✅ Features
- **Google Sheets Integration**  
  Reads and updates spreadsheet data in real time using a **Service Account** (no OAuth needed).

- **Telegram Integration**  
  Sends trade alerts, updates, and closures to a **forum topic inside a Telegram supergroup**.

- **Live Price Monitoring**  
  Continuously polls **Bybit** for market price updates to trigger targets and stop-loss events.

- **Persistent Tracking**  
  Prevents duplicate messages using local JSON caches (`sent_trades.json`, `processed_trades.json`).

- **Resilience & Retry**  
  Uses exponential backoff + jitter for all API calls to handle rate limits and connection errors gracefully.

---

## 🛠 Tech Stack
- Node.js
- Google Sheets API (via Service Account)
- Telegram Bot API (`node-telegram-bot-api`)
- Bybit API
- Docker + Docker Compose
- PM2 Runtime

---

## ⚙️ Environment Variables
Create a `.env` file in the root directory with the following variables:

```env
# Path to your Service Account credentials JSON
GOOGLE_CREDENTIALS_PATH=./secrets/tradewatch-key.json

# ID of the Google Spreadsheet to monitor
SPREADSHEET_ID=your_google_sheet_id_here

# Telegram bot token
TELEGRAM_TOKEN=your_telegram_bot_token_here

# Telegram group or channel ID
TELEGRAM_CHAT_ID=-100xxxxxxxxxx

# Telegram topic/thread ID (optional)
TELEGRAM_TOPIC_ID=123456

# Bybit API URL (optional override)
BYBIT_BASE_URL=https://api.bybit.com/v5/market/tickers?category=linear&symbol=
```

🔐 **Important:** Ensure the Google Sheet is shared with the Service Account email (xxx@project.iam.gserviceaccount.com).

---

## 📁 File Structure
tradewatch-bot/
├── src/
│   ├── index.js              # Main bot logic
│   └── sheets.js             # Google Sheets wrapper (Service Account auth)
├── data/
│   ├── sent_trades.json      # JSON cache of sent trades
│── secrets/
│   └── tradewatch-key.json   # Service Account JSON (excluded from Git)
├── .env                      # Environment variables
├── Dockerfile                # Docker build config
├── docker-compose.yml        # Docker service config
├── ecosystem.config.js       # PM2 process manager config
├── package.json              # Project metadata
└── README.md                 # This file

---

## 🧪 Running Locally
```bash
# Clone the repo
git clone https://github.com/YOUR_USER/tradewatch-bot.git
cd tradewatch-bot

# Install dependencies
npm install

# Run the bot
node src/index.js
```
---

## 🐳 Running with Docker
```bash
# Build and start the container in detached mode
docker-compose up -d --build

# View logs
docker logs -f tradewatch
```

---

## 🩺 Healthcheck
The bot exposes a healthcheck endpoint at:

http://<your-ip>:3000/health

---

## 👨‍💻 Author
Igor Souza
GitHub: @frontdev1254


## 📝 License
This project is licensed under the MIT License. See LICENSE for details.