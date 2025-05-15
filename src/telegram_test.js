require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_TOKEN;
const chatId = parseInt(process.env.TELEGRAM_CHAT_ID, 10);

if (!token) {
  console.error('❌ FALTANDO: variável TELEGRAM_TOKEN não definida.');
  process.exit(1);
}
if (!chatId) {
  console.error('❌ FALTANDO: variável TELEGRAM_CHAT_ID não definida ou inválida.');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: false });

async function safeSendMessage(text) {
  // Confirms if the bot is alive
  try {
    const me = await bot.getMe();
    console.log(`🔎 Conectado como @${me.username}`);
  } catch (err) {
    console.error('❌ Não conseguiu validar o bot:', err.response?.body?.description || err.message);
    process.exit(1);
  }

  // Send a message, Flood treat wait
  let attempt = 0;
  while (true) {
    try {
      await bot.sendMessage(chatId, text);
      console.log('✅ Mensagem enviada com sucesso ao Telegram.');
      return;
    } catch (err) {
      const status = err.response?.status;
      const retryAfter = err.response?.body?.parameters?.retry_after;
      if (status === 429 && retryAfter) {
        const waitMs = (retryAfter + 1) * 1000;
        console.warn(`⚠️ Flood Wait detectado, aguardando ${retryAfter}s antes de retry...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      if (attempt < 3) {
        const delay = (attempt + 1) * 1000;
        console.warn(`⚠️ Tentativa ${attempt + 1} falhou (${err.response?.body?.description || err.message}), retry em ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        attempt++;
        continue;
      }
      console.error('❌ Erro final ao enviar mensagem:', status, err.response?.body?.description || err.message);
      process.exit(1);
    }
  }
}

safeSendMessage('✅ Teste de conexão com o Telegram!').catch(() => {
  // Already treated internally
});