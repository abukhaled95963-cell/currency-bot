const axios = require('axios');
const cron = require('node-cron');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const CHANNEL_ID = process.env.CHANNEL_ID || '';
const EXCHANGE_API_KEY = process.env.EXCHANGE_API_KEY || '';

async function getRates() {
  try {
    // Get USD base rates
    const r = await axios.get(`https://v6.exchangerate-api.com/v6/${EXCHANGE_API_KEY}/latest/USD`, {timeout:10000});
    const rates = r.data.conversion_rates;
    return {
      SYP: rates.SYP || 0,  // Syrian Pound
      SAR: rates.SAR || 0,  // Saudi Riyal
      IQD: rates.IQD || 0,  // Iraqi Dinar
      USD: 1
    };
  } catch(e) {
    console.error('Exchange rate error:', e.message);
    return null;
  }
}

async function getGoldSilver() {
  try {
    // Gold price in USD per troy ounce from public API
    const r = await axios.get('https://api.metals.live/v1/spot', {timeout:10000});
    const data = r.data;
    let gold = 0, silver = 0;
    if(Array.isArray(data)) {
      data.forEach(item => {
        if(item.gold) gold = item.gold;
        if(item.silver) silver = item.silver;
      });
    }
    return {gold, silver};
  } catch(e) {
    // Fallback to alternative API
    try {
      const r2 = await axios.get('https://api.gold-api.com/price/XAU', {timeout:10000});
      const r3 = await axios.get('https://api.gold-api.com/price/XAG', {timeout:10000});
      return {gold: r2.data?.price || 0, silver: r3.data?.price || 0};
    } catch(e2) {
      console.error('Gold API error:', e2.message);
      return {gold: 0, silver: 0};
    }
  }
}

function getChangeEmoji(change) {
  if(change > 0) return '📈';
  if(change < 0) return '📉';
  return '➡️';
}

function formatNumber(num, decimals=2) {
  if(!num || num === 0) return 'غير متاح';
  return num.toLocaleString('ar-SA', {minimumFractionDigits: decimals, maximumFractionDigits: decimals});
}

async function buildMessage(period) {
  const rates = await getRates();
  const metals = await getGoldSilver();

  if(!rates) return null;

  const now = new Date().toLocaleString('ar-SA', {
    timeZone: 'Asia/Riyadh',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const periodLabel = {
    morning: '🌅 أسعار الافتتاح - الصباح',
    midday: '☀️ تحديث منتصف اليوم',
    evening: '🌙 أسعار الإغلاق - المساء'
  }[period] || '📊 تحديث الأسعار';

  // Calculate gold price per gram in USD
  const goldGram = metals.gold ? (metals.gold / 31.1035) : 0;
  const silverGram = metals.silver ? (metals.silver / 31.1035) : 0;

  // Gold in Arabic currencies
  const goldSAR = goldGram * rates.SAR;
  const goldSYP = goldGram * rates.SYP;
  const goldIQD = goldGram * rates.IQD;

  let msg = `${periodLabel}\n`;
  msg += `📅 ${now}\n`;
  msg += `━━━━━━━━━━━━━━━\n\n`;

  msg += `💱 <b>أسعار الصرف مقابل الدولار 🇺🇸</b>\n\n`;

  msg += `🇸🇾 <b>الليرة السورية</b>\n`;
  msg += `1 دولار = <b>${formatNumber(rates.SYP, 0)}</b> ليرة\n\n`;

  msg += `🇸🇦 <b>الريال السعودي</b>\n`;
  msg += `1 دولار = <b>${formatNumber(rates.SAR, 4)}</b> ريال\n`;
  msg += `1 ريال = <b>${formatNumber(1/rates.SAR, 4)}</b> دولار\n\n`;

  msg += `🇮🇶 <b>الدينار العراقي</b>\n`;
  msg += `1 دولار = <b>${formatNumber(rates.IQD, 0)}</b> دينار\n\n`;

  msg += `━━━━━━━━━━━━━━━\n\n`;

  msg += `🥇 <b>أسعار المعادن النفيسة</b>\n\n`;

  if(metals.gold > 0) {
    msg += `🥇 <b>الذهب</b>\n`;
    msg += `الأوقية: <b>${formatNumber(metals.gold)}</b> دولار\n`;
    msg += `الغرام: <b>${formatNumber(goldGram)}</b> دولار\n`;
    msg += `الغرام بالريال 🇸🇦: <b>${formatNumber(goldSAR)}</b> ريال\n`;
    msg += `الغرام بالليرة 🇸🇾: <b>${formatNumber(goldSYP, 0)}</b> ليرة\n`;
    msg += `الغرام بالدينار 🇮🇶: <b>${formatNumber(goldIQD, 0)}</b> دينار\n\n`;
  }

  if(metals.silver > 0) {
    msg += `🥈 <b>الفضة</b>\n`;
    msg += `الأوقية: <b>${formatNumber(metals.silver)}</b> دولار\n`;
    msg += `الغرام: <b>${formatNumber(silverGram)}</b> دولار\n\n`;
  }

  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `⚠️ الأسعار تقريبية للاستئناس فقط\n`;
  msg += `🔄 يتم التحديث 3 مرات يومياً`;

  return msg;
}

async function sendToChannel(period) {
  try {
    const msg = await buildMessage(period);
    if(!msg) { console.log('Failed to build message'); return; }

    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHANNEL_ID,
      text: msg,
      parse_mode: 'HTML'
    });
    console.log('Sent', period, 'update to channel');
  } catch(e) {
    console.error('Send error:', e.message);
  }
}

// Schedule: 7 AM, 12 PM, 9 PM Riyadh time
cron.schedule('0 7 * * *', () => sendToChannel('morning'), {timezone: 'Asia/Riyadh'});
cron.schedule('0 12 * * *', () => sendToChannel('midday'), {timezone: 'Asia/Riyadh'});
cron.schedule('0 21 * * *', () => sendToChannel('evening'), {timezone: 'Asia/Riyadh'});

// Keep alive
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3001;

app.get('/', (req,res) => res.json({status:'alive', service:'Currency Bot'}));
app.get('/send/:period', async(req,res) => {
  await sendToChannel(req.params.period);
  res.json({sent: true});
});

app.listen(PORT, () => console.log('Currency bot running on port', PORT));

// Send immediately on startup for testing
setTimeout(() => sendToChannel('morning'), 5000);