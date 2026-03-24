import fetch from 'node-fetch';
import { writeFileSync, mkdirSync } from 'fs';

const OPENROUTER_API_KEY = "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"; // openrouter.ai/keys

mkdirSync('./public', { recursive: true });

let state = {
  DegenGPT: { positions: [], pnl: 1000, thought: '' },
  BoomerAI:  { positions: [], pnl: 1000, thought: '' }
};
let battleCount = 0;
let history = [];

// ─── BINANCE TOP 200 ──────────────────────────────────────────────────
async function fetchPrices() {
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/24hr");
    const text = await res.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("Response is not array");
    let coins = {};
    data
      .filter(c => c.symbol.endsWith('USDT') && parseFloat(c.quoteVolume) > 1000000)
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 200)
      .forEach(c => {
        const sym = c.symbol.replace('USDT', '');
        coins[sym] = {
          price: parseFloat(c.lastPrice),
          change24h: parseFloat(c.priceChangePercent),
          volume: parseFloat(c.quoteVolume)
        };
      });
    console.log(`✅ Fetched ${Object.keys(coins).length} coins from Binance`);
    return coins;
  } catch (e) {
    console.log("⚠️ Binance error:", e.message);
    return {
      BTC:  { price: 70000, change24h: 1.5,  volume: 2e9 },
      ETH:  { price: 3500,  change24h: 2.1,  volume: 1e9 },
      SOL:  { price: 180,   change24h: 3.5,  volume: 5e8 },
      DOGE: { price: 0.15,  change24h: -1.2, volume: 3e8 },
      PEPE: { price: 0.000012, change24h: 5, volume: 2e8 }
    };
  }
}

// ─── ASK AI FOR PERP POSITIONS ────────────────────────────────────────
async function askAI(name, personality, coins) {
  const top50 = Object.entries(coins)
    .slice(0, 50)
    .map(([s, d]) => `${s}:$${d.price.toFixed(4)}(${d.change24h > 0 ? '+' : ''}${d.change24h.toFixed(1)}%)`)
    .join(', ');

  const prompt = `You are ${name}. ${personality}

PERPETUAL FUTURES TRADING — $1000 budget.
Rules:
- Long = profit when price goes UP
- Short = profit when price goes DOWN  
- Leverage 1x-50x (higher = bigger gains AND losses)
- margin = how much USDT you risk per position
- notional = margin × leverage (your actual exposure)
- Total margin of all positions MUST be ≤ 1000 USDT
- You can open 1-5 positions

Current top 50 coins by volume:
${top50}

Reply ONLY with raw JSON, no markdown, no explanation outside JSON:
{"positions":[{"coin":"SOL","direction":"long","leverage":20,"margin":400},{"coin":"BTC","direction":"short","leverage":5,"margin":200}],"thought":"one sentence about your strategy"}`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://aideathmatch.vercel.app",
        "X-Title": "AI Deathmatch"
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.85,
        max_tokens: 400
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.log(`❌ OpenRouter ${res.status}: ${err.slice(0, 150)}`);
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    console.log(`🤖 ${name}: ${text.slice(0, 250)}`);

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON found");
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.positions) || parsed.positions.length === 0) throw new Error("No positions");

    // Validate and sanitize positions
    let totalMargin = 0;
    const valid = [];
    for (const p of parsed.positions) {
      if (!p.coin || !coins[p.coin]) continue;
      const margin = Math.min(Math.max(10, parseInt(p.margin) || 100), 1000 - totalMargin);
      const leverage = Math.min(Math.max(1, parseInt(p.leverage) || 1), 50);
      const direction = p.direction === 'short' ? 'short' : 'long';
      if (totalMargin + margin > 1000) break;
      valid.push({ coin: p.coin, direction, leverage, margin, entryPrice: coins[p.coin].price, notional: margin * leverage });
      totalMargin += margin;
      if (valid.length >= 5) break;
    }

    if (valid.length === 0) throw new Error("No valid positions after sanitize");
    return { positions: valid, thought: parsed.thought || 'Positions set' };

  } catch (e) {
    console.log(`⚠️ ${name} fallback: ${e.message}`);
    return fallback(name, coins);
  }
}

// ─── SMART FALLBACK ───────────────────────────────────────────────────
function fallback(name, coins) {
  const syms = Object.keys(coins);

  if (name === "DegenGPT") {
    const alts = syms.slice(15, 100).sort(() => Math.random() - 0.5).slice(0, 3);
    const thoughts = ["Max leverage on hot altcoins, LFG!", "Riding momentum with high leverage plays", "Degen mode: 3 altcoins, max risk max reward"];
    return {
      positions: alts.map((coin, i) => ({
        coin, direction: coins[coin].change24h > 0 ? 'long' : 'short',
        leverage: [25, 15, 10][i], margin: [400, 350, 250][i],
        entryPrice: coins[coin].price, notional: [400,350,250][i] * [25,15,10][i]
      })),
      thought: thoughts[Math.floor(Math.random() * thoughts.length)]
    };
  } else {
    const btcDir = (coins.BTC?.change24h || 0) > 0 ? 'long' : 'short';
    const ethDir = (coins.ETH?.change24h || 0) > 0 ? 'long' : 'short';
    const solDir = (coins.SOL?.change24h || 0) > 0 ? 'long' : 'short';
    return {
      positions: [
        { coin: 'BTC', direction: btcDir, leverage: 5, margin: 400, entryPrice: coins.BTC?.price || 70000, notional: 2000 },
        { coin: 'ETH', direction: ethDir, leverage: 5, margin: 350, entryPrice: coins.ETH?.price || 3500, notional: 1750 },
        { coin: 'SOL', direction: solDir, leverage: 3, margin: 250, entryPrice: coins.SOL?.price || 180, notional: 750 }
      ],
      thought: `Following 24h trend: BTC ${btcDir}, ETH ${ethDir}, SOL ${solDir} with moderate leverage`
    };
  }
}

// ─── PnL CALCULATION ─────────────────────────────────────────────────
function calcPnL(agentName, coins) {
  const agent = state[agentName];
  let totalChange = 0;

  const positions = agent.positions.map(pos => {
    const current = coins[pos.coin]?.price || pos.entryPrice;
    const pct = (current - pos.entryPrice) / pos.entryPrice;
    const raw = pct * pos.notional * (pos.direction === 'long' ? 1 : -1);
    const capped = Math.max(raw, -pos.margin); // liquidation = lose margin only
    const liquidated = raw <= -pos.margin;
    totalChange += capped;
    return {
      ...pos, currentPrice: current,
      pnl: parseFloat(capped.toFixed(2)),
      pnlPct: parseFloat((capped / pos.margin * 100).toFixed(1)),
      liquidated
    };
  });

  return {
    total: parseFloat((1000 + totalChange).toFixed(2)),
    change: parseFloat(totalChange.toFixed(2)),
    positions
  };
}

// ─── SAVE STATE ───────────────────────────────────────────────────────
function saveState(coins, phase) {
  const d = calcPnL("DegenGPT", coins);
  const b = calcPnL("BoomerAI", coins);
  state.DegenGPT.pnl = d.total;
  state.BoomerAI.pnl  = b.total;

  const winner = d.total >= b.total ? "DegenGPT" : "BoomerAI";

  const displayPrices = {};
  ['BTC','ETH','SOL','BNB','DOGE','XRP','PEPE','AVAX'].forEach(s => {
    if (coins[s]) displayPrices[s] = coins[s].price;
  });

  const out = {
    phase, battleCount,
    timestamp: new Date().toISOString(),
    prices: displayPrices,
    agents: {
      DegenGPT: { pnl: d.total, change: d.change, thought: state.DegenGPT.thought, positions: d.positions },
      BoomerAI:  { pnl: b.total, change: b.change, thought: state.BoomerAI.thought,  positions: b.positions }
    },
    winner,
    market: {
      question: `Battle #${battleCount}: Will DegenGPT beat BoomerAI? (${winner} winning)`,
      yesPrice: 0.45, noPrice: 0.55,
      volume: Math.floor(Math.random() * 80000) + 20000
    },
    history: history.slice(-10)
  };

  writeFileSync('./public/market.json', JSON.stringify(out, null, 2));
  return out;
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────
async function runBattle() {
  battleCount++;
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`⚔️  PERP BATTLE #${battleCount} — ${new Date().toLocaleTimeString()}`);
  console.log('═'.repeat(55));

  state.DegenGPT = { positions: [], pnl: 1000, thought: '' };
  state.BoomerAI  = { positions: [], pnl: 1000, thought: '' };

  const coins = await fetchPrices();

  console.log("🤖 Generating perp strategies...");
  const [degen, boomer] = await Promise.all([
    askAI("DegenGPT", "You are a reckless degen who loves high leverage on altcoins. You NEVER touch BTC or ETH alone. You mix longs and shorts based on momentum. You use 10x-50x leverage.", coins),
    askAI("BoomerAI",  "You are a macro-aware trader. You hedge: long strong coins, short weak ones. You mix BTC/ETH with a couple altcoins. You use 3x-15x leverage max.", coins)
  ]);

  state.DegenGPT.positions = degen.positions;
  state.DegenGPT.thought   = degen.thought;
  state.BoomerAI.positions  = boomer.positions;
  state.BoomerAI.thought    = boomer.thought;

  console.log(`\n🔴 DegenGPT: "${degen.thought}"`);
  degen.positions.forEach(p => console.log(`   ${p.direction.toUpperCase()} ${p.coin} ${p.leverage}x — margin: $${p.margin} | notional: $${p.notional}`));

  console.log(`\n🔵 BoomerAI: "${boomer.thought}"`);
  boomer.positions.forEach(p => console.log(`   ${p.direction.toUpperCase()} ${p.coin} ${p.leverage}x — margin: $${p.margin} | notional: $${p.notional}`));

  saveState(coins, "live");

  // Live PnL every 10s for 2 min
  for (let i = 1; i <= 12; i++) {
    await new Promise(r => setTimeout(r, 10000));
    const live = await fetchPrices();
    const snap = saveState(live, "live");
    console.log(`⏱️  [${i*10}s] 🔴 $${snap.agents.DegenGPT.pnl} | 🔵 $${snap.agents.BoomerAI.pnl} | 🏆 ${snap.winner}`);
  }

  const final = saveState(await fetchPrices(), "final");
  console.log(`\n🏆 WINNER: ${final.winner}`);
  console.log(`🔴 DegenGPT: $${final.agents.DegenGPT.pnl} (${final.agents.DegenGPT.change >= 0 ? '+' : ''}${final.agents.DegenGPT.change})`);
  console.log(`🔵 BoomerAI: $${final.agents.BoomerAI.pnl} (${final.agents.BoomerAI.change >= 0 ? '+' : ''}${final.agents.BoomerAI.change})`);

  history.push({
    battle: battleCount, winner: final.winner,
    degenPnL: final.agents.DegenGPT.pnl,
    boomerPnL: final.agents.BoomerAI.pnl,
    degenPos: degen.positions.map(p => `${p.direction[0].toUpperCase()} ${p.coin} ${p.leverage}x`).join(' | '),
    boomerPos: boomer.positions.map(p => `${p.direction[0].toUpperCase()} ${p.coin} ${p.leverage}x`).join(' | '),
    time: new Date().toISOString()
  });

  console.log(`\n⏳ Next battle in 30s...`);
  await new Promise(r => setTimeout(r, 30000));
}

// Init placeholder
writeFileSync('./public/market.json', JSON.stringify({
  phase: "waiting", battleCount: 0,
  agents: {
    DegenGPT: { pnl: 1000, change: 0, thought: 'Calculating perp strategy...', positions: [] },
    BoomerAI:  { pnl: 1000, change: 0, thought: 'Analyzing markets...', positions: [] }
  },
  winner: null, market: { question: 'Perp battle loading...', volume: 0 }
}, null, 2));

(async () => {
  console.log("⚔️  AI DEATHMATCH — PERP EDITION");
  console.log("📡 Binance 200 coins | Longs/Shorts | Up to 50x leverage\n");
  while (true) {
    try { await runBattle(); }
    catch (e) {
      console.error("💥 Error:", e.message);
      await new Promise(r => setTimeout(r, 15000));
    }
  }
})();