const axios = require('axios');
const cron = require('node-cron');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const CHANNEL_ID = process.env.CHANNEL_ID || '';
const EXCHANGE_API_KEY = process.env.EXCHANGE_API_KEY || '';

let previousRates = {SYP: 0, SAR: 0, IQD: 0, EUR: 0, TRY: 0};
let previousMetals = {gold: 0, silver: 0};

async function getRates() {
  try {
    // Get USD base rates
    const r = await axios.get(`https://v6.exchangerate-api.com/v6/${EXCHANGE_API_KEY}/latest/USD`, {timeout:10000});
    const rates = r.data.conversion_rates;
    return {
      SYP: rates.SYP || 0,
      SAR: rates.SAR || 0,
      IQD: rates.IQD || 0,
      EUR: rates.EUR || 0,
      TRY: rates.TRY || 0,
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

function getArrow(current, previous) {
  if(!previous || previous === 0) return '';
  if(current > previous) return ' 🟢↑';
  if(current < previous) return ' 🔴↓';
  return '';
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
    evening: '🌙 أسعار الإغلاق - المساء',
    update: '🔔 تحديث فوري - تغير في الأسعار'
  }[period] || '📊 تحديث الأسعار';

  const goldGram = metals.gold ? (metals.gold / 31.1035) : 0;
  const silverGram = metals.silver ? (metals.silver / 31.1035) : 0;

  const EUR = rates.EUR || 0;
  const TRY = rates.TRY || 0;

  function crossRate(base, target) {
    if(!base || !target) return 0;
    return target / base;
  }

  let msg = `${periodLabel}\n`;
  msg += `📅 ${now}\n`;
  msg += `━━━━━━━━━━━━━━━\n\n`;

  msg += `🇸🇾 <b>الليرة السورية</b>\n`;
  msg += `┌─────────────────────\n`;
  msg += `│ 🇺🇸 دولار:  1 = <b>${formatNumber(rates.SYP, 0)}</b> ل.س${getArrow(rates.SYP, previousRates.SYP)}\n`;
  if(EUR) msg += `│ 🇪🇺 يورو:   1 = <b>${formatNumber(rates.SYP / EUR, 0)}</b> ل.س\n`;
  if(TRY) msg += `│ 🇹🇷 ليرة تركية: 1 = <b>${formatNumber(rates.SYP / TRY, 0)}</b> ل.س\n`;
  msg += `│ 🇸🇦 ريال سعودي: 1 = <b>${formatNumber(rates.SYP / rates.SAR, 0)}</b> ل.س\n`;
  msg += `└─────────────────────\n\n`;

  msg += `🇸🇦 <b>الريال السعودي</b>\n`;
  msg += `┌─────────────────────\n`;
  msg += `│ 🇺🇸 دولار:  1 = <b>${formatNumber(rates.SAR, 4)}</b> ر.س${getArrow(rates.SAR, previousRates.SAR)}\n`;
  if(EUR) msg += `│ 🇪🇺 يورو:   1 = <b>${formatNumber(rates.SAR / EUR, 4)}</b> ر.س\n`;
  if(TRY) msg += `│ 🇹🇷 ليرة تركية: 1 = <b>${formatNumber(rates.SAR / TRY, 4)}</b> ر.س\n`;
  msg += `│ 1 ر.س = <b>${formatNumber(1/rates.SAR, 4)}</b> دولار\n`;
  msg += `└─────────────────────\n\n`;

  msg += `🇮🇶 <b>الدينار العراقي</b>\n`;
  msg += `┌─────────────────────\n`;
  msg += `│ 🇺🇸 دولار:  1 = <b>${formatNumber(rates.IQD, 0)}</b> د.ع${getArrow(rates.IQD, previousRates.IQD)}\n`;
  if(EUR) msg += `│ 🇪🇺 يورو:   1 = <b>${formatNumber(rates.IQD / EUR, 0)}</b> د.ع\n`;
  if(TRY) msg += `│ 🇹🇷 ليرة تركية: 1 = <b>${formatNumber(rates.IQD / TRY, 0)}</b> د.ع\n`;
  msg += `│ 🇸🇦 ريال سعودي: 1 = <b>${formatNumber(rates.IQD / rates.SAR, 0)}</b> د.ع\n`;
  msg += `└─────────────────────\n\n`;

  msg += `━━━━━━━━━━━━━━━\n\n`;

  msg += `🥇 <b>الذهب والفضة</b>\n`;
  msg += `┌─────────────────────\n`;
  if(metals.gold > 0) {
    msg += `│ 🥇 الذهب${getArrow(metals.gold, previousMetals.gold)}\n`;
    msg += `│ الأوقية: <b>${formatNumber(metals.gold)}</b> 🇺🇸\n`;
    msg += `│ الغرام:  <b>${formatNumber(goldGram)}</b> 🇺🇸\n`;
    msg += `│ الغرام:  <b>${formatNumber(goldGram * rates.SAR)}</b> 🇸🇦\n`;
    msg += `│ الغرام:  <b>${formatNumber(goldGram * rates.SYP, 0)}</b> 🇸🇾\n`;
    msg += `│ الغرام:  <b>${formatNumber(goldGram * rates.IQD, 0)}</b> 🇮🇶\n`;
  }
  if(metals.silver > 0) {
    msg += `│ 🥈 الفضة${getArrow(metals.silver, previousMetals.silver)}\n`;
    msg += `│ الأوقية: <b>${formatNumber(metals.silver)}</b> 🇺🇸\n`;
    msg += `│ الغرام:  <b>${formatNumber(silverGram)}</b> 🇺🇸\n`;
  }
  msg += `└─────────────────────\n\n`;

  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `🔄 تحديث فوري عند تغير الأسعار\n`;
  msg += `📢 <a href="https://t.me/ExchangeMoment">سعر الصرف لحظة بلحظة</a>`;

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

    const newRates = await getRates();
    const newMetals = await getGoldSilver();
    if(newRates) previousRates = {SYP: newRates.SYP, SAR: newRates.SAR, IQD: newRates.IQD, EUR: newRates.EUR, TRY: newRates.TRY};
    if(newMetals) previousMetals = {gold: newMetals.gold, silver: newMetals.silver};
  } catch(e) {
    console.error('Send error:', e.message);
  }
}

// Check every hour and only send if rates changed significantly
cron.schedule('0 * * * *', async () => {
  const newRates = await getRates();
  const newMetals = await getGoldSilver();
  if(!newRates) return;

  const sypChange = previousRates.SYP ? Math.abs(newRates.SYP - previousRates.SYP) / previousRates.SYP : 1;
  const sarChange = previousRates.SAR ? Math.abs(newRates.SAR - previousRates.SAR) / previousRates.SAR : 1;
  const iqdChange = previousRates.IQD ? Math.abs(newRates.IQD - previousRates.IQD) / previousRates.IQD : 1;
  const goldChange = previousMetals.gold ? Math.abs(newMetals.gold - previousMetals.gold) / previousMetals.gold : 1;

  const hasChange = sypChange > 0.001 || sarChange > 0.001 || iqdChange > 0.001 || goldChange > 0.001;

  const hour = new Date().toLocaleString('en-US', {timeZone:'Asia/Riyadh', hour:'numeric', hour12:false});
  const hourNum = parseInt(hour);

  const scheduledHours = [7, 12, 21];
  const isScheduled = scheduledHours.includes(hourNum);

  if(isScheduled || hasChange) {
    const period = hourNum === 7 ? 'morning' : hourNum === 12 ? 'midday' : hourNum === 21 ? 'evening' : 'update';
    console.log('Sending update. Scheduled:', isScheduled, 'Change detected:', hasChange);
    await sendToChannel(period);
  }
}, {timezone: 'Asia/Riyadh'});

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