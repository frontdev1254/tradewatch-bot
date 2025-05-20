// --- Global Error Handling ----------------------------------
process.on('uncaughtException', err => {
  console.error('Uncaught Exception:', err);
  process.exit(1); // restart on critical failures
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1); // restart on critical failures
});
// -----------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { google } = require('googleapis');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const SENT_TRADES_FILE = path.resolve(__dirname, '../data/sent_trades.json');
let sentTrades = [];
if (fs.existsSync(SENT_TRADES_FILE)) {
  try {
    sentTrades = JSON.parse(fs.readFileSync(SENT_TRADES_FILE, 'utf8'));
  } catch (err) {
    console.error('Erro ao carregar sent_trades.json:', err.message);
    sentTrades = [];
  }
}
function saveSentTrades() {
  if (sentTrades.length > 1000) sentTrades = sentTrades.slice(-1000);
  fs.writeFileSync(SENT_TRADES_FILE, JSON.stringify(sentTrades, null, 2));
}

const requiredEnvs = [
  'SPREADSHEET_ID',
  'TELEGRAM_TOKEN',
  'TELEGRAM_CHAT_ID',
  'TELEGRAM_TOPIC_ID'
];
for (const k of requiredEnvs) {
  if (!process.env[k]) {
    console.error(`Erro: variável de ambiente ${k} não definida.`);
    process.exit(1);
  }
}

const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || path.resolve(__dirname, '../secrets/client_secret.json');
const TOKEN_PATH = path.resolve(__dirname, '../secrets/token.json');
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = parseInt(process.env.TELEGRAM_CHAT_ID, 10);
const TELEGRAM_TOPIC_ID = parseInt(process.env.TELEGRAM_TOPIC_ID, 10);
const CONCURRENCY_LIMIT = 60;
const POLL_INTERVAL_MS = 1000;

let credentials;
try {
  credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
} catch (err) {
  console.error('Erro ao carregar credenciais Google:', err.message);
  process.exit(1);
}
const { client_id, client_secret, redirect_uris } =
  credentials.installed || credentials.web;
const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

// Google Sheets/Drive
async function safeSheetsCall(callFn, maxRetries = 5) {
  let attempt = 0;
  while (true) {
    try {
      return await callFn();
    } catch (err) {
      const code = err.code || err.response?.status;
      const reason = err.errors?.[0]?.reason;

      // 400 / 404
      if (code === 400) {
        console.error(`❌ Google API 400 (${reason}): ${err.errors?.[0]?.message} — pulando.`);
        return;
      }
      if (code === 404) {
        console.error('❌ Google API 404: recurso não encontrado — verifique sheet/id.');
        return;
      }

      const retryableApiErrors = [429, 500, 502, 503, 504];
      const retryableQuota =
        code === 403 &&
        ['rateLimitExceeded','userRateLimitExceeded','sharingRateLimitExceeded','dailyLimitExceeded']
          .includes(reason);

      if ((retryableApiErrors.includes(code) || retryableQuota) && attempt < maxRetries) {
        const delay = Math.min(2 ** attempt * 1000, 64000)
                    + Math.floor(Math.random() * 1000);
        console.warn(`⚠️ Google Sheets erro ${code} (${reason}), retry em ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        attempt++;
        continue;
      }
      if (code === 401 && attempt === 0) {
        console.warn('🔑 Token expirado, renovando credenciais...');
        const { credentials: newTokens } = await oAuth2Client.refreshAccessToken();
        oAuth2Client.setCredentials(newTokens);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(newTokens, null, 2));
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

// Telegram Bot API
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
bot.startPolling({ params: { timeout: 30 } });

// shield against stuck polling
bot.on('polling_error', (err) => {
  const timestamp = new Date().toISOString();
  console.error(`[Polling Error - ${timestamp}] ${err.message}`);
  if (err.code === 'EFATAL') {
    console.error('Erro fatal detectado no polling. Encerrando processo para reinício automático...');
    process.exit(1);
  }
});

// shield against general Telegram errors
bot.on('error', (err) => {
  const timestamp = new Date().toISOString();
  console.error(`[Telegram Error - ${timestamp}] ${err.message}`);
  process.exit(1);
});

async function safeTelegramCall(method, ...args) {
  let attempt = 0;
  while (true) {
    try {
      return await bot[method](...args);
    } catch (err) {
      const status = err.response?.status;
      const retryAfter = err.response?.body?.parameters?.retry_after;

      // Flood-Wait 429
      if (status === 429 && retryAfter) {
        const waitMs = (retryAfter + 1) * 1000;
        console.warn(`⚠️ Telegram Flood Wait, aguardando ${retryAfter}s`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      if (attempt < 5) {
        const delay = Math.min(2 ** attempt * 1000, 64000)
                    + Math.floor(Math.random() * 1000);
        console.warn(`⚠️ Telegram ${method} erro, retry em ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

// Bybit API
async function safeBybitCall(callFn, maxRetries = 5) {
  let attempt = 0;
  while (true) {
    try {
      return await callFn();
    } catch (err) {
      const status = err.response?.status;
      if (status === 429) {
        const ra = parseInt(err.response.headers['retry-after'] || '1', 10);
        await new Promise(r => setTimeout(r, (ra + 1) * 1000));
        continue;
      }
      if ([500, 502, 503, 504].includes(status) && attempt < maxRetries) {
        const delay = Math.min(2 ** attempt * 1000, 64000)
                    + Math.floor(Math.random() * 1000);
        console.warn(`⚠️ Bybit API erro ${status}, retry em ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

const processedTrades = new Set();
const activeMonitors = new Map();
let activeTasks = 0;

function generateTradeId(row, rowNumber) {
  return `${row[0]}::${row[1]}::${row[2]}::${rowNumber}`;
}

function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseRow(row, rowNumber) {
  const [
    Timestamp, Trader, Ativo, Categoria, PosicaoRaw, EntradaRaw, AlavRaw,
    StopRaw, PercentStopRaw, Alvo1Raw, ResAlvo1Raw, Alvo2Raw, ResAlvo2Raw,
    Imagem, Analise, ResFinalRaw, Status, TipoResFinal
  ] = row;
  return {
    rowNumber,
    Timestamp: Timestamp || '',
    Trader: Trader || '',
    Ativo: Ativo || '',
    Categoria: Categoria || '',
    Posicao: (PosicaoRaw || '').toLowerCase(),
    Entrada: parseFloat(EntradaRaw) || 0,
    Alavancagem: parseFloat(AlavRaw) || 0,
    Stop: parseFloat(StopRaw) || 0,
    PercentStop: parseFloat(PercentStopRaw) || 0,
    Alvo1: parseFloat(Alvo1Raw) || 0,
    ResAlvo1: ResAlvo1Raw ? parseFloat(ResAlvo1Raw) : null,
    Alvo2: Alvo2Raw ? parseFloat(Alvo2Raw) : null,
    ResAlvo2: ResAlvo2Raw ? parseFloat(ResAlvo2Raw) : null,
    Imagem: Imagem || '',
    Analise: Analise || '',
    ResFinal: ResFinalRaw ? parseFloat(ResFinalRaw) : null,
    Status: Status || '',
    TipoResFinal: TipoResFinal || ''
  };
}

function getFileIdFromUrl(url) {
  const m = url.match(/[-\w]{25,}/);
  return m ? m[0] : null;
}

function getDirectDriveUrl(driveUrl) {
  const fileId = getFileIdFromUrl(driveUrl);
  return fileId
    ? `https://drive.google.com/uc?export=download&id=${fileId}`
    : driveUrl;
}

function authorize(callback) {
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getAccessToken(callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

function getAccessToken(callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.question('Enter the code from that page here: ', code => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Erro obtendo token de acesso', err);
      oAuth2Client.setCredentials(token);
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
      callback(oAuth2Client);
    });
  });
}

async function scanAndMonitorAllTrades(auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  try {
    const res = await safeSheetsCall(() =>
      sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'A2:R' })
    );
    const rows = res.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const rowNum = i + 2;
      const id = generateTradeId(raw, rowNum);
      if (processedTrades.has(id)) continue;

      const trade = parseRow(raw, rowNum);
      if (!trade.Status) {
        processedTrades.add(id);
        if (!sentTrades.includes(id)) {
          trade.TipoCard = 'open';
          try {
            await sendTradeToTelegram(trade);
          } catch (e) {
            console.error('❌ erro enviando open:', e.message);
          }
          sentTrades.push(id);
          saveSentTrades();
        }
        startMonitor(trade, auth);
      }
    }
  } catch (e) {
    console.error('Erro em scanAndMonitorAllTrades:', e);
  }
}

async function checkNewEntries(auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  while (true) {
    try {
      const res = await safeSheetsCall(() =>
        sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'A2:R' })
      );
      const rows = res.data.values || [];
      if (rows.length) {
        const raw = rows[rows.length - 1];
        const rowNum = rows.length + 1;
        const id = generateTradeId(raw, rowNum);
        if (!processedTrades.has(id) && !sentTrades.includes(id)) {
          const trade = parseRow(raw, rowNum);
          if (!trade.Status) {
            processedTrades.add(id);
            trade.TipoCard = 'open';
            try {
              await sendTradeToTelegram(trade);
            } catch (e) {
              console.error('❌ erro enviando open:', e.message);
            }
            sentTrades.push(id);
            saveSentTrades();
            startMonitor(trade, auth);
          }
        }
      }
    } catch (e) {
      console.error('Erro em checkNewEntries:', e);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS * 2));
  }
}

function startMonitor(trade, auth) {
  const key = trade.rowNumber;
  if (activeMonitors.has(key)) return;
  activeMonitors.set(key, true);
  (async () => {
    while (activeTasks >= CONCURRENCY_LIMIT) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    activeTasks++;
    try {
      await monitorPrice(trade, auth);
    } finally {
      activeMonitors.delete(key);
      activeTasks--;
    }
  })();
}

async function monitorPrice(trade, auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  let { Ativo, Posicao, Entrada, Alavancagem, Stop, Alvo1, Alvo2, rowNumber } = trade;
  const isLong = Posicao === 'long';

  // Symbol correction
  if (!Ativo.toUpperCase().endsWith('USDT')) {
    const sym = Ativo.toUpperCase() + 'USDT';
    await safeSheetsCall(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `C${rowNumber}`,
        valueInputOption: 'RAW',
        resource: { values: [[sym]] }
      })
    );
    console.log(`[Monitor] Símbolo corrigido: ${Ativo} → ${sym}`);
    Ativo = sym;
    trade.Ativo = sym;
  }

  const url = `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${Ativo}`;
  let wasDisconnected = false, price;
  const hasTakenProfit = trade.ResAlvo1 != null;

  while (true) {
  try {
    const resp = await safeBybitCall(() => axios.get(url));

    if (wasDisconnected) {
      console.log(`[Monitor ${Ativo}] Conexão restabelecida com Bybit.`);
      wasDisconnected = false;
    }

    const price = parseFloat(resp.data.result.list[0].lastPrice);
    const pnl = isLong
      ? ((price - Entrada) / Entrada) * 100 * Alavancagem
      : ((Entrada - price) / Entrada) * 100 * Alavancagem;

    const hitStop = isLong ? price <= Stop : price >= Stop;
    const hitT1 = trade.ResAlvo1 == null && (isLong ? price >= Alvo1 : price <= Alvo1);
    const hitT2 = Alvo2 != null && trade.ResAlvo2 == null && (isLong ? price >= Alvo2 : price <= Alvo2);

    if (hitStop) {
      return await closeTrade({ trade, sheets, finalPnl: pnl, tipoFinal: 'Stop Loss' });
    }

    if (hitT1) {
      try {
        await safeSheetsCall(() =>
          sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `K${rowNumber}`,
            valueInputOption: 'RAW',
            resource: { values: [[pnl.toFixed(2)]] }
          })
        );
      } catch (err) {
        console.error(`[Monitor ${Ativo}] Erro ao atualizar Alvo 1: ${err.message}`);
      }

      trade.ResAlvo1 = pnl;
      trade.TipoCard = 'update1';

      if (!Alvo2) {
        return await closeTrade({ trade, sheets, finalPnl: pnl, tipoFinal: 'Profit' });
      }

      try {
        await sendTradeToTelegram(trade);
      } catch (e) {
        console.error(`[Monitor ${Ativo}] Erro ao enviar card de Alvo 1: ${e.message}`);
      }
    }

    if (hitT2) {
      try {
        await safeSheetsCall(() =>
          sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `M${rowNumber}`,
            valueInputOption: 'RAW',
            resource: { values: [[pnl.toFixed(2)]] }
          })
        );
      } catch (err) {
        console.error(`[Monitor ${Ativo}] Erro ao atualizar Alvo 2: ${err.message}`);
      }

      trade.ResAlvo2 = pnl;
      return await closeTrade({ trade, sheets, finalPnl: pnl, tipoFinal: 'Profit' });
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  } catch (err) {
    wasDisconnected = true;
    console.error(`[Monitor ${Ativo}] Erro inesperado no loop de monitoramento: ${err.message}`);
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

}

async function closeTrade({ trade, sheets, finalPnl, tipoFinal }) {
  const { rowNumber, Alvo2 } = trade;

  // Protection: if the stop was hit after Target 1, exit silently
  if (tipoFinal === 'Stop Loss' && trade.ResAlvo1 != null) {
    console.log(`[Monitor ${trade.Ativo}] Stop atingido após Alvo 1 — encerrando silenciosamente.`);
    return; // Does not update spreadsheet or send card
  }

  const updates = [];

  if (tipoFinal === 'Profit' && trade.ResAlvo1 == null) {
    updates.push({ range: `K${rowNumber}`, values: [[finalPnl.toFixed(2)]] });
  }

  if (tipoFinal === 'Profit' && Alvo2 != null && trade.ResAlvo2 == null) {
    updates.push({ range: `M${rowNumber}`, values: [[finalPnl.toFixed(2)]] });
  }

  updates.push({ range: `P${rowNumber}`, values: [[finalPnl.toFixed(2)]] });
  updates.push({ range: `Q${rowNumber}`, values: [['Encerrado']] });
  updates.push({ range: `R${rowNumber}`, values: [[tipoFinal]] });

  await safeSheetsCall(() =>
    sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { valueInputOption: 'RAW', data: updates }
    })
  );

  try {
    await sendTradeToTelegram({ ...trade, TipoCard: 'close', finalPnl, tipoFinal });
  } catch (e) {
    console.error('❌ erro enviando fechamento:', e.message);
  }
}

async function sendTradeToTelegram(trade) {
  const {
    Imagem, Ativo, Categoria, Posicao, Alavancagem, Entrada, Stop,
    Alvo1, Alvo2, Trader, Timestamp, Analise, TipoCard, ResAlvo1,
    ResAlvo2, finalPnl, tipoFinal
  } = trade;

  let header;
  if (TipoCard === 'open') header = '🚨 Novo Trade Detectado!';
  else if (TipoCard === 'update1')
    header = `🚨 Alvo 1 atingido! (${ResAlvo1.toFixed(2)}%)`;
  else {
    header = tipoFinal === 'Profit'
      ? (ResAlvo2 != null
          ? `🚨 Alvo 2 atingido! (${ResAlvo2.toFixed(2)}%)`
          : `🚨 Alvo 1 atingido! (${finalPnl.toFixed(2)}%)`)
      : `🚨 Stop Loss atingido! (${finalPnl.toFixed(2)}%)`;
  }

  const caption = `${header}
Ativo: ${escapeHtml(Ativo)}
Categoria: ${escapeHtml(Categoria)}
Posição: ${Posicao} | Alavancagem: ${Alavancagem}x
🎯 Entrada: ${Entrada} | Stop: ${Stop}
Alvo: ${Alvo1}${Alvo2 ? ` | Alvo 2: ${Alvo2}` : ''}
Trader: ${escapeHtml(Trader)}
Data: ${escapeHtml(Timestamp)}

Análise: ${escapeHtml(Analise)}`;

  const opts = { caption, parse_mode: 'HTML', message_thread_id: TELEGRAM_TOPIC_ID };
  const directUrl = getDirectDriveUrl(Imagem);

  try {
    await safeTelegramCall('sendPhoto', TELEGRAM_CHAT_ID, directUrl, opts);
  } catch {
    try {
      const resp = await axios.get(directUrl, { responseType: 'arraybuffer' });
      const tempPath = path.join(os.tmpdir(), `trade_${Date.now()}.jpg`);
      fs.writeFileSync(tempPath, resp.data);
      await safeTelegramCall('sendPhoto', TELEGRAM_CHAT_ID, fs.createReadStream(tempPath), opts);
      fs.unlinkSync(tempPath);
    } catch (e) {
      console.error('❌ Fallback de imagem falhou:', e.message);
    }
  }
}

// Initialization and Healthcheck
authorize(async auth => {
  console.log('✅ [BOT] Inicializado com sucesso. Monitoramento ativo...');
  await scanAndMonitorAllTrades(auth);
  await checkNewEntries(auth);
});

const express = require('express');
const app = express();
app.get('/health', (_, res) => res.send('OK'));
app.listen(3000, () => console.log('Healthcheck em :3000/health'));
