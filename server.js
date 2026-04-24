const axios = require('axios');
const cron = require('node-cron');

const VERSION = '1.2.0';

const fs = require('fs');
const SETTINGS_FILE = './settings.json';

function getSetting(key, defaultVal='') {
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE,'utf8'));
    return data[key] || defaultVal;
  } catch(e) { return defaultVal; }
}

function setSetting(key, value) {
  try {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(SETTINGS_FILE,'utf8')); } catch(e) {}
    data[key] = value;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
  } catch(e) { console.error('Settings error:', e.message); }
}

const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const CHANNEL_ID = process.env.CHANNEL_ID || '';

function getChannels() {
  const extra = process.env.EXTRA_CHANNELS || '';
  const channels = [CHANNEL_ID];
  if(extra) extra.split(',').forEach(c => { if(c.trim()) channels.push(c.trim()); });
  const dbChannels = getSetting ? getSetting('extra_channels','') : '';
  if(dbChannels) dbChannels.split(',').forEach(c => { if(c.trim()) channels.push(c.trim()); });
  return [...new Set(channels.filter(c => c))];
}

const EXCHANGE_API_KEY = process.env.EXCHANGE_API_KEY || '';

async function notifyUpdate(changes) {
  if(!ADMIN_CHAT_ID || !BOT_TOKEN) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: ADMIN_CHAT_ID,
      text: `🚀 <b>تحديث جديد للبوت</b>\n\n📦 الإصدار: <b>${VERSION}</b>\n\n📝 التحديثات:\n${changes}\n\n⏰ ${new Date().toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}`,
      parse_mode: 'HTML'
    });
  } catch(e) { console.error('Notify error:', e.message); }
}

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

    const channels = getChannels();
    for(const ch of channels) {
      try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          chat_id: ch,
          text: msg,
          parse_mode: 'HTML'
        });
        console.log('Sent', period, 'to', ch);
      } catch(e) {
        console.error('Failed to send to', ch, e.message);
      }
    }

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

let botOffset = 0;

async function sendMsg(chatId, text, keyboard) {
  const body = {chat_id: chatId, text: text, parse_mode: 'HTML'};
  if(keyboard) body.reply_markup = {inline_keyboard: keyboard};
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, body);
}

async function pollBot() {
  if(!BOT_TOKEN || !ADMIN_CHAT_ID) return;
  try {
    const r = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${botOffset}&timeout=5&limit=10`, {timeout:10000});
    if(r.data.ok && r.data.result.length) {
      for(const update of r.data.result) {
        botOffset = update.update_id + 1;
        const msg = update.message;
        const cb = update.callback_query;
        const chatId = msg ? msg.chat.id : cb ? cb.message.chat.id : null;
        if(!chatId || String(chatId) !== String(ADMIN_CHAT_ID)) continue;
        if(cb) {
          await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {callback_query_id: cb.id});
        }
        const text = msg ? (msg.text||'') : (cb ? cb.data : '');
        await handleCommand(chatId, text);
      }
    }
  } catch(e) {}
}

async function handleCommand(chatId, text) {
  const awaiting = getSetting('awaiting','');

  if(text === '/start' || text === 'main') {
    await sendMsg(chatId,
      `🤖 <b>بوت سعر الصرف لحظة بلحظة</b>\n📦 الإصدار: ${VERSION}\n\nاختر أمراً:`,
      [[{text:'💱 الأسعار الآن', callback_data:'prices_now'},{text:'📢 اختبار الإرسال', callback_data:'test_send'}],
       [{text:'📋 قنوات النشر', callback_data:'manage_channels'},{text:'ℹ️ معلومات', callback_data:'bot_info'}]]);

  } else if(text === 'prices_now') {
    await sendMsg(chatId, '🔄 جاري جلب الأسعار...');
    try {
      const msg = await buildMessage('update');
      if(msg) await sendMsg(chatId, msg);
      else await sendMsg(chatId, '❌ تعذر جلب الأسعار');
    } catch(e) { await sendMsg(chatId, '❌ خطأ: '+e.message); }

  } else if(text === 'test_send') {
    await sendMsg(chatId, '🔄 جاري إرسال تحديث تجريبي للقنوات...');
    await sendToChannel('update');
    const channels = getChannels();
    await sendMsg(chatId, '✅ تم الإرسال لـ '+channels.length+' قناة:\n'+channels.join('\n'),
      [[{text:'🔙 رجوع', callback_data:'main'}]]);

  } else if(text === 'manage_channels') {
    const channels = getChannels();
    let msg = '📋 <b>قنوات النشر</b>\n\n';
    channels.forEach((c,i) => { msg += (i+1)+'. '+c+'\n'; });
    await sendMsg(chatId, msg,
      [[{text:'➕ إضافة قناة', callback_data:'add_channel'},{text:'🗑️ حذف قناة', callback_data:'del_channel'}],
       [{text:'🔙 رجوع', callback_data:'main'}]]);

  } else if(text === 'add_channel') {
    setSetting('awaiting','add_channel');
    await sendMsg(chatId, '📢 أرسل معرف القناة الجديدة:\nمثال: @mychannel أو -100123456789',
      [[{text:'❌ إلغاء', callback_data:'manage_channels'}]]);

  } else if(text === 'del_channel') {
    const extra = getSetting('extra_channels','');
    const channels = extra ? extra.split(',').filter(c=>c.trim()) : [];
    if(!channels.length) { await sendMsg(chatId, '❌ لا توجد قنوات إضافية للحذف', [[{text:'🔙 رجوع', callback_data:'manage_channels'}]]); return; }
    const keyboard = channels.map((c,i) => [{text:'🗑️ '+c, callback_data:'delch_'+i}]);
    keyboard.push([{text:'🔙 رجوع', callback_data:'manage_channels'}]);
    await sendMsg(chatId, 'اختر القناة للحذف:', keyboard);

  } else if(text.startsWith('delch_')) {
    const idx = parseInt(text.replace('delch_',''));
    const extra = getSetting('extra_channels','');
    const channels = extra.split(',').filter(c=>c.trim());
    const removed = channels.splice(idx,1);
    setSetting('extra_channels', channels.join(','));
    await sendMsg(chatId, '✅ تم حذف '+removed[0], [[{text:'🔙 قنوات النشر', callback_data:'manage_channels'}]]);

  } else if(text === 'bot_info') {
    const channels = getChannels();
    await sendMsg(chatId,
      `ℹ️ <b>معلومات البوت</b>\n\nالإصدار: ${VERSION}\nعدد القنوات: ${channels.length}\nالتحديث: كل ساعة أو عند تغير الأسعار\nأوقات النشر الثابتة: 7ص، 12ظ، 9م`,
      [[{text:'🔙 رجوع', callback_data:'main'}]]);

  } else {
    if(awaiting === 'add_channel') {
      setSetting('awaiting','');
      const ch = text.trim();
      const extra = getSetting('extra_channels','');
      const channels = extra ? extra.split(',').filter(c=>c.trim()) : [];
      if(channels.includes(ch)) { await sendMsg(chatId, '⚠️ القناة موجودة مسبقاً'); return; }
      channels.push(ch);
      setSetting('extra_channels', channels.join(','));
      await sendMsg(chatId, '✅ تمت إضافة '+ch+'\nإجمالي القنوات: '+(channels.length+1),
        [[{text:'🔙 قنوات النشر', callback_data:'manage_channels'}]]);
    }
  }
}

setInterval(pollBot, 2000);

app.listen(PORT, () => console.log('Currency bot running on port', PORT));

// Send immediately on startup for testing
setTimeout(async () => {
  await notifyUpdate('• عرض موحد للعملات مع اليورو والليرة التركية\n• أرقام إنجليزية موحدة\n• سهم أخضر/أحمر عند تغير السعر\n• نشرة ساعية ذكية\n• إدارة قنوات متعددة\n• أوامر تحكم للمسؤول');
  await sendToChannel('morning');
}, 5000);