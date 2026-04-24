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

const cheerio = require('cheerio');

async function scrapeSPToday() {
  try {
    const r = await axios.get('https://sp-today.com/en', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ar,en;q=0.9'
      }
    });
    const $ = cheerio.load(r.data);
    const data = {
      currencies: {},
      gold: {},
      fuel: {}
    };

    $('table tr, .currency-row, .rate-row').each((i, row) => {
      const text = $(row).text();
      const cells = $(row).find('td, .value');
      if(cells.length >= 2) {
        const name = $(cells[0]).text().trim();
        const buy = parseFloat($(cells[1]).text().replace(/[^0-9.]/g,''));
        const sell = cells.length >= 3 ? parseFloat($(cells[2]).text().replace(/[^0-9.]/g,'')) : buy;
        if(name && buy > 0) {
          if(name.includes('دولار') || name.includes('Dollar') || name.includes('USD')) data.currencies.USD = {buy, sell, name:'دولار'};
          else if(name.includes('يورو') || name.includes('Euro') || name.includes('EUR')) data.currencies.EUR = {buy, sell, name:'يورو'};
          else if(name.includes('تركي') || name.includes('Turkish') || name.includes('TRY')) data.currencies.TRY = {buy, sell, name:'ليرة تركية'};
          else if(name.includes('ريال سعودي') || name.includes('SAR')) data.currencies.SAR = {buy, sell, name:'ريال سعودي'};
        }
      }
    });

    const apiR = await axios.get('https://sp-today.com/api/currencies', {
      timeout: 10000,
      headers: {'User-Agent': 'Mozilla/5.0'}
    }).catch(() => null);

    if(apiR && apiR.data) {
      const apiData = apiR.data;
      if(Array.isArray(apiData)) {
        apiData.forEach(item => {
          if(item.code === 'USD' || item.symbol === '$') data.currencies.USD = {buy: item.buy || item.rate, sell: item.sell || item.rate, name:'دولار'};
          if(item.code === 'EUR' || item.symbol === '€') data.currencies.EUR = {buy: item.buy || item.rate, sell: item.sell || item.rate, name:'يورو'};
          if(item.code === 'TRY') data.currencies.TRY = {buy: item.buy || item.rate, sell: item.sell || item.rate, name:'ليرة تركية'};
          if(item.code === 'SAR') data.currencies.SAR = {buy: item.buy || item.rate, sell: item.sell || item.rate, name:'ريال سعودي'};
        });
      }
    }

    $('*').each((i, el) => {
      const text = $(el).text();
      const val = parseFloat(text.replace(/[^0-9.]/g,''));
      if(val > 50000 && val < 5000000) {
        if(text.includes('24') || text.includes('عيار 24')) data.gold.k24 = val;
        else if(text.includes('21') || text.includes('عيار 21')) data.gold.k21 = val;
        else if(text.includes('18') || text.includes('عيار 18')) data.gold.k18 = val;
        else if(text.includes('14') || text.includes('عيار 14')) data.gold.k14 = val;
      }
    });

    console.log('SP Today scraped:', JSON.stringify(data.currencies), 'Gold:', JSON.stringify(data.gold));
    return data;
  } catch(e) {
    console.error('SP Today scrape error:', e.message);
    return null;
  }
}

function getSyriaFuelPrices() {
  return {
    gasoline95: parseInt(getSetting('fuel_gas95', '22000')),
    gasoline90: parseInt(getSetting('fuel_gas90', '18000')),
    diesel: parseInt(getSetting('fuel_diesel', '8000')),
    gas_home: parseInt(getSetting('fuel_gas_home', '85000')),
    gas_industrial: parseInt(getSetting('fuel_gas_ind', '280000')),
    elec_home: getSetting('fuel_elec_home', '75 ل.س/كيلوواط'),
    elec_industrial: getSetting('fuel_elec_ind', '150 ل.س/كيلوواط')
  };
}

async function getSyrianOfficialRates() {
  try {
    const r = await axios.get('https://www.cb.gov.sy/index.php?page=list&ex=2&dir=exchangerate&lang=1&service=2', {
      timeout: 15000,
      headers: {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    });
    const $ = cheerio.load(r.data);
    const rates = {};
    $('table tr').each((i, row) => {
      const cells = $(row).find('td');
      if(cells.length >= 3) {
        const currency = $(cells[0]).text().trim();
        const buy = parseFloat($(cells[1]).text().replace(/,/g,'').trim());
        const sell = parseFloat($(cells[2]).text().replace(/,/g,'').trim());
        if(currency.includes('دولار') || currency.includes('USD')) {
          rates.USD = {buy, sell};
        } else if(currency.includes('يورو') || currency.includes('EUR')) {
          rates.EUR = {buy, sell};
        } else if(currency.includes('تركي') || currency.includes('TRY')) {
          rates.TRY = {buy, sell};
        } else if(currency.includes('ريال') || currency.includes('SAR')) {
          rates.SAR = {buy, sell};
        }
      }
    });
    if(Object.keys(rates).length > 0) {
      console.log('Syrian official rates fetched:', Object.keys(rates));
      return rates;
    }
    return null;
  } catch(e) {
    console.error('Syrian rates error:', e.message);
    return null;
  }
}

async function getIraqiOfficialRates() {
  try {
    const r = await axios.get('https://cbi.iq/page/144', {
      timeout: 15000,
      headers: {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    });
    const $ = cheerio.load(r.data);
    const rates = {};
    $('table tr').each((i, row) => {
      const cells = $(row).find('td');
      if(cells.length >= 3) {
        const currency = $(cells[0]).text().trim();
        const buy = parseFloat($(cells[1]).text().replace(/,/g,'').trim());
        const sell = parseFloat($(cells[2]).text().replace(/,/g,'').trim());
        if(currency.includes('دولار') || currency.includes('USD') || currency.includes('Dollar')) {
          rates.USD = {buy, sell};
        } else if(currency.includes('يورو') || currency.includes('EUR')) {
          rates.EUR = {buy, sell};
        } else if(currency.includes('تركي') || currency.includes('TRY')) {
          rates.TRY = {buy, sell};
        } else if(currency.includes('ريال') || currency.includes('SAR')) {
          rates.SAR = {buy, sell};
        }
      }
    });
    if(!rates.USD) {
      rates.USD = {buy: 1305, sell: 1310};
    }
    console.log('Iraqi official rates fetched:', Object.keys(rates));
    return rates;
  } catch(e) {
    console.error('Iraqi rates error:', e.message);
    return {USD: {buy: 1305, sell: 1310}};
  }
}

function getSaudiOfficialRates() {
  return {
    USD: {buy: 3.7498, sell: 3.7502},
    EUR: null,
    TRY: null
  };
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
  if(!num || num === 0) return 'N/A';
  return '‎' + num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

async function buildMessage(period, changedCurrencies) {
  const rates = await getRates();
  const metals = await getGoldSilver();
  const spData = await scrapeSPToday();
  const fuel = getSyriaFuelPrices();

  if(!rates) return null;

  const now = new Date();
  const nowDate = now.toLocaleDateString('ar-SA', {
    timeZone: 'Asia/Riyadh',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const nowTime = now.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const timeStr = nowTime;
  const periodLabel = {
    morning: `🌅 نشرة الصباح - ${timeStr}`,
    midday: `☀️ نشرة الظهيرة - ${timeStr}`,
    evening: `🌙 نشرة المساء - ${timeStr}`,
    update: `🔔 نشرة الساعة ${timeStr}`
  }[period] || `📊 نشرة الساعة ${timeStr}`;

  const EUR = rates.EUR || 0;
  const TRY = rates.TRY || 0;
  const goldGram = metals.gold ? (metals.gold / 31.1035) : 0;
  const silverGram = metals.silver ? (metals.silver / 31.1035) : 0;

  const sypUSD = spData?.currencies?.USD?.buy || rates.SYP || 0;
  const sypUSD_sell = spData?.currencies?.USD?.sell || Math.round(sypUSD*1.007);
  const sypEUR = spData?.currencies?.EUR?.buy || (EUR ? rates.SYP/EUR : 0);
  const sypEUR_sell = spData?.currencies?.EUR?.sell || Math.round(sypEUR*1.007);
  const sypTRY = spData?.currencies?.TRY?.buy || (TRY ? rates.SYP/TRY : 0);
  const sypTRY_sell = spData?.currencies?.TRY?.sell || Math.round(sypTRY*1.007);
  const sypSAR = spData?.currencies?.SAR?.buy || (rates.SAR ? rates.SYP/rates.SAR : 0);
  const sypSAR_sell = spData?.currencies?.SAR?.sell || Math.round(sypSAR*1.007);

  let msg = '';

  if(changedCurrencies && changedCurrencies.length > 0) {
    msg += `<b>`;
    changedCurrencies.forEach(ch => {
      msg += `${ch.arrow} ${ch.name} ${ch.pct > 0 ? '+' : ''}${ch.pct}%  `;
    });
    msg += `</b>\n\n`;
  }

  msg += `${periodLabel}\n`;
  msg += `📅 ${nowDate} - ${nowTime}\n`;
  msg += `━━━━━━━━━━━━━━━\n\n`;

  msg += `🇸🇾 <b>الليرة السورية</b>\n`;
  msg += `┌─────────────────────\n`;
  if(sypUSD > 0) msg += `│ 🇺🇸 1 دولار  | شراء: ‎${formatNumber(sypUSD,0)} | بيع: ‎${formatNumber(sypUSD_sell,0)} ل.س${getArrow(sypUSD, previousRates.SYP)}\n`;
  if(sypEUR > 0) msg += `│ 🇪🇺 1 يورو   | شراء: ‎${formatNumber(sypEUR,0)} | بيع: ‎${formatNumber(sypEUR_sell,0)} ل.س\n`;
  if(sypTRY > 0) msg += `│ 🇹🇷 1 ليرة   | شراء: ‎${formatNumber(sypTRY,0)} | بيع: ‎${formatNumber(sypTRY_sell,0)} ل.س\n`;
  if(sypSAR > 0) msg += `│ 🇸🇦 1 ريال   | شراء: ‎${formatNumber(sypSAR,0)} | بيع: ‎${formatNumber(sypSAR_sell,0)} ل.س\n`;
  msg += `└─────────────────────\n\n`;

  const sarMid = rates.SAR;
  msg += `🇸🇦 <b>الريال السعودي</b>\n`;
  msg += `┌─────────────────────\n`;
  msg += `│ 🇺🇸 1 دولار  | شراء: ‎${formatNumber(sarMid*0.9993,4)} | بيع: ‎${formatNumber(sarMid*1.0007,4)} ر.س${getArrow(rates.SAR, previousRates.SAR)}\n`;
  if(EUR) msg += `│ 🇪🇺 1 يورو   | شراء: ‎${formatNumber(sarMid/EUR*0.993,4)} | بيع: ‎${formatNumber(sarMid/EUR*1.007,4)} ر.س\n`;
  if(TRY) msg += `│ 🇹🇷 1 ليرة   | شراء: ‎${formatNumber(sarMid/TRY*0.993,4)} | بيع: ‎${formatNumber(sarMid/TRY*1.007,4)} ر.س\n`;
  msg += `│ 🇮🇶 1 دينار  | شراء: ‎${formatNumber(sarMid/rates.IQD*0.993,6)} | بيع: ‎${formatNumber(sarMid/rates.IQD*1.007,6)} ر.س\n`;
  msg += `└─────────────────────\n\n`;

  const iqdMid = rates.IQD;
  msg += `🇮🇶 <b>الدينار العراقي</b>\n`;
  msg += `┌─────────────────────\n`;
  msg += `│ 🇺🇸 1 دولار  | شراء: ‎${formatNumber(Math.round(iqdMid*0.997),0)} | بيع: ‎${formatNumber(Math.round(iqdMid*1.003),0)} د.ع${getArrow(rates.IQD, previousRates.IQD)}\n`;
  if(EUR) msg += `│ 🇪🇺 1 يورو   | شراء: ‎${formatNumber(Math.round(iqdMid/EUR*0.997),0)} | بيع: ‎${formatNumber(Math.round(iqdMid/EUR*1.003),0)} د.ع\n`;
  if(TRY) msg += `│ 🇹🇷 1 ليرة   | شراء: ‎${formatNumber(Math.round(iqdMid/TRY*0.997),0)} | بيع: ‎${formatNumber(Math.round(iqdMid/TRY*1.003),0)} د.ع\n`;
  msg += `│ 🇸🇦 1 ريال   | شراء: ‎${formatNumber(Math.round(iqdMid/rates.SAR*0.997),0)} | بيع: ‎${formatNumber(Math.round(iqdMid/rates.SAR*1.003),0)} د.ع\n`;
  msg += `└─────────────────────\n\n`;

  msg += `━━━━━━━━━━━━━━━\n\n`;
  msg += `🥇 <b>الذهب والفضة</b>\n`;
  msg += `┌─────────────────────\n`;
  if(metals.gold > 0) {
    const g24 = spData?.gold?.k24 || Math.round(goldGram * sypUSD);
    const g21 = spData?.gold?.k21 || Math.round(g24 * 0.875);
    const g18 = spData?.gold?.k18 || Math.round(g24 * 0.75);
    const g14 = spData?.gold?.k14 || Math.round(g24 * 0.585);
    msg += `│ 🥇 الذهب${getArrow(metals.gold, previousMetals.gold)}\n`;
    msg += `│ 1 أوقية = ‎${formatNumber(metals.gold,2)} دولار\n`;
    msg += `│ 1 غرام  = ‎${formatNumber(goldGram,2)} دولار\n`;
    msg += `│ 1 غرام  = ‎${formatNumber(goldGram*rates.SAR,2)} ريال\n`;
    msg += `│ 1 غرام  = ‎${formatNumber(goldGram*rates.IQD,0)} دينار\n`;
    msg += `│\n│ ✨ عيار 24 = ‎${formatNumber(g24,0)} ل.س/غرام\n`;
    msg += `│ ✨ عيار 21 = ‎${formatNumber(g21,0)} ل.س/غرام\n`;
    msg += `│ ✨ عيار 18 = ‎${formatNumber(g18,0)} ل.س/غرام\n`;
    msg += `│ ✨ عيار 14 = ‎${formatNumber(g14,0)} ل.س/غرام\n`;
  }
  if(metals.silver > 0) {
    msg += `│\n│ 🥈 الفضة${getArrow(metals.silver, previousMetals.silver)}\n`;
    msg += `│ 1 أوقية = ‎${formatNumber(metals.silver,2)} دولار\n`;
    msg += `│ 1 غرام  = ‎${formatNumber(silverGram,4)} دولار\n`;
    msg += `│ 1 غرام  = ‎${formatNumber(silverGram*rates.SAR,2)} ريال\n`;
    msg += `│ 1 غرام  = ‎${formatNumber(silverGram*sypUSD,0)} ل.س\n`;
    msg += `│ 1 غرام  = ‎${formatNumber(silverGram*rates.IQD,0)} دينار\n`;
  }
  msg += `└─────────────────────\n\n`;

  msg += `━━━━━━━━━━━━━━━\n\n`;
  msg += `⛽ <b>أسعار الوقود والطاقة في سوريا</b>\n`;
  msg += `┌─────────────────────\n`;
  msg += `│ ⛽ بنزين 95      | ‎${formatNumber(fuel.gasoline95,0)} ل.س/لتر\n`;
  msg += `│ ⛽ بنزين 90      | ‎${formatNumber(fuel.gasoline90,0)} ل.س/لتر\n`;
  msg += `│ 🚛 مازوت        | ‎${formatNumber(fuel.diesel,0)} ل.س/لتر\n`;
  msg += `│ 🏠 غاز منزلي    | ‎${formatNumber(fuel.gas_home,0)} ل.س/أسطوانة\n`;
  msg += `│ 🏭 غاز صناعي    | ‎${formatNumber(fuel.gas_industrial,0)} ل.س/أسطوانة\n`;
  msg += `│ 💡 كهرباء منزلية | ${fuel.elec_home}\n`;
  msg += `│ 🏭 كهرباء صناعية | ${fuel.elec_industrial}\n`;
  msg += `└─────────────────────\n\n`;

  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `🔄 تحديث فوري عند تغير الأسعار\n`;
  msg += `📢 <a href="https://t.me/ExchangeMoment">سعر الصرف لحظة بلحظة</a>`;

  return msg;
}

async function sendToChannel(period, changedCurrencies) {
  try {
    const msg = await buildMessage(period, changedCurrencies);
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

let lastRates = {USD: 0, EUR: 0, TRY: 0, SAR: 0};

cron.schedule('0 * * * *', async () => {
  const spData = await scrapeSPToday();
  if(!spData || !spData.currencies) return;

  const changedCurrencies = [];
  const currencies = [
    {key:'USD', name:'🇺🇸 دولار', current: spData.currencies.USD?.buy},
    {key:'EUR', name:'🇪🇺 يورو', current: spData.currencies.EUR?.buy},
    {key:'TRY', name:'🇹🇷 ليرة تركية', current: spData.currencies.TRY?.buy},
    {key:'SAR', name:'🇸🇦 ريال', current: spData.currencies.SAR?.buy}
  ];

  currencies.forEach(c => {
    if(!c.current || !lastRates[c.key]) return;
    const change = (c.current - lastRates[c.key]) / lastRates[c.key];
    if(Math.abs(change) > 0.001) {
      changedCurrencies.push({
        name: c.name,
        arrow: change > 0 ? '↑' : '↓',
        pct: (change * 100).toFixed(2)
      });
    }
  });

  currencies.forEach(c => { if(c.current) lastRates[c.key] = c.current; });

  const hour = parseInt(new Date().toLocaleString('en-US', {timeZone:'Asia/Riyadh', hour:'numeric', hour12:false}));
  const isScheduled = [7,12,21].includes(hour);
  const hasChange = changedCurrencies.length > 0;

  if(isScheduled || hasChange) {
    const period = hour===7?'morning':hour===12?'midday':hour===21?'evening':'update';
    await sendToChannel(period, hasChange ? changedCurrencies : null);
  }
}, {timezone:'Asia/Riyadh'});

// Keep alive
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3001;

app.get('/', (req,res) => res.json({status:'alive', service:'Currency Bot'}));
app.get('/send/:period', async(req,res) => {
  await sendToChannel(req.params.period);
  res.json({sent: true});
});

app.get('/api/test/syria', async(req,res) => {
  try {
    const data = await scrapeSPToday();
    res.json({
      success: !!data,
      currencies: data?.currencies || 'FAILED',
      gold: data?.gold || 'FAILED',
      source: 'sp-today.com'
    });
  } catch(e) {
    res.json({success: false, error: e.message});
  }
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
       [{text:'📋 قنوات النشر', callback_data:'manage_channels'},{text:'⛽ أسعار الوقود', callback_data:'fuel_settings'}],
       [{text:'ℹ️ معلومات', callback_data:'bot_info'}]]);

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

  } else if(text === 'fuel_settings') {
    const fuel = getSyriaFuelPrices();
    await sendMsg(chatId,
      `⛽ <b>أسعار الوقود الحالية</b>\n\nبنزين 95: ${fuel.gasoline95}\nبنزين 90: ${fuel.gasoline90}\nمازوت: ${fuel.diesel}\nغاز منزلي: ${fuel.gas_home}\nغاز صناعي: ${fuel.gas_industrial}`,
      [[{text:'✏️ تعديل الأسعار', callback_data:'edit_fuel'},{text:'🔙 رجوع', callback_data:'main'}]]);

  } else if(text === 'edit_fuel') {
    setSetting('awaiting','edit_fuel');
    await sendMsg(chatId, 'أرسل الأسعار الجديدة بهذا الشكل:\n95:8000\n90:5000\ndiesel:3000\ngas_home:20000\ngas_ind:80000',
      [[{text:'❌ إلغاء', callback_data:'main'}]]);

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
    } else if(awaiting === 'edit_fuel') {
      setSetting('awaiting','');
      const lines = text.split('\n');
      lines.forEach(line => {
        const [key, val] = line.split(':');
        if(key && val) {
          const k = key.trim();
          const v = val.trim();
          if(k === '95') setSetting('fuel_gas95', v);
          else if(k === '90') setSetting('fuel_gas90', v);
          else if(k === 'diesel') setSetting('fuel_diesel', v);
          else if(k === 'gas_home') setSetting('fuel_gas_home', v);
          else if(k === 'gas_ind') setSetting('fuel_gas_ind', v);
        }
      });
      await sendMsg(chatId, '✅ تم تحديث أسعار الوقود', [[{text:'🔙 رجوع', callback_data:'main'}]]);
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