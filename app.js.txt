// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);

const fmtMoney = (n) => Number.isFinite(n)
  ? n.toLocaleString(undefined, { style: "currency", currency: "USD" })
  : "—";

const fmtNum = (n, d = 2) => Number.isFinite(n)
  ? n.toLocaleString(undefined, { maximumFractionDigits: d })
  : "—";

function parseNum(v){
  const x = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(x) ? x : NaN;
}

function setText(id, text){
  const el = $(id);
  if (el) el.textContent = text;
}

function setHTML(id, html){
  const el = $(id);
  if (el) el.innerHTML = html;
}

function showWarn(boxId, textId, msg){
  const box = $(boxId);
  const txt = $(textId);
  if (!box || !txt) return;
  box.style.display = msg ? "block" : "none";
  txt.textContent = msg || "";
}

// ---------- Tabs ----------
function initTabs(){
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const panels = {
    pos: $("panel-pos"),
    bs: $("panel-bs"),
  };

  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      tabs.forEach(t => {
        t.classList.toggle("active", t === btn);
        t.setAttribute("aria-selected", t === btn ? "true" : "false");
      });

      const tab = btn.dataset.tab;
      panels.pos?.classList.toggle("active", tab === "pos");
      panels.bs?.classList.toggle("active", tab === "bs");

      if (tab === "pos") calcPosition();
      if (tab === "bs") calcBS();
    });
  });
}

// ---------- Position Sizing ----------
function setStrategyUI(){
  const s = $("strategy")?.value;
  const conditionalRow = $("conditionalRow");
  const costBasisWrap = $("costBasisWrap");
  const riskCapWrap = $("riskCapWrap");
  const spreadWrap = $("spreadWrap");

  const showCostBasis = (s === "SHORT_CALL_COV");
  const showRiskCap = (s === "SHORT_CALL_NAKED" || s === "SHORT_PUT_NAKED");
  const showSpread = (s === "VERTICAL_CREDIT" || s === "VERTICAL_DEBIT");

  if (conditionalRow) conditionalRow.style.display = (showCostBasis || showRiskCap || showSpread) ? "grid" : "none";
  if (costBasisWrap) costBasisWrap.style.display = showCostBasis ? "block" : "none";
  if (riskCapWrap) riskCapWrap.style.display = showRiskCap ? "block" : "none";
  if (spreadWrap) spreadWrap.style.display = showSpread ? "block" : "none";
}

function calcPosition(){
  setStrategyUI();
  showWarn("posWarn", "posWarnText", "");

  setText("contracts", "—");
  setText("capitalReq", "—");
  setText("riskAmt", "—");
  setText("riskPer", "Risk per contract: —");
  setText("capitalHint", "Depends on strategy (premium, collateral, margin, etc.)");
  setHTML("posPills", "");

  const account = parseNum($("acc")?.value);
  const riskPct = parseNum($("riskPct")?.value);
  const strike  = parseNum($("strike")?.value);
  const prem    = parseNum($("prem")?.value);
  const mult    = parseNum($("mult")?.value);
  const stopPrem= parseNum($("stopPrem")?.value);
  const strategy= $("strategy")?.value;

  if (!(account > 0) || !(riskPct > 0) || !(strike > 0) || !(prem >= 0) || !(mult > 0) || !strategy){
    showWarn("posWarn", "posWarnText", "Enter valid positive numbers (account, risk %, strike, premium, multiplier).");
    return;
  }

  const riskBudget = account * (riskPct / 100);
  const hasStop = Number.isFinite(stopPrem) && stopPrem >= 0;

  let riskPerContract = NaN;
  let capPerContract = NaN;
  let capHint = "";
  let riskHint = "";

  // ---- Long options ----
  if (strategy === "LONG_CALL" || strategy === "LONG_PUT"){
    if (hasStop){
      riskPerContract = Math.max(0, (prem - stopPrem)) * mult;
      riskHint = "Long (stop-based risk)";
    } else {
      riskPerContract = prem * mult;
      riskHint = "Long (max loss = premium paid)";
    }
    capPerContract = prem * mult;
    capHint = "Debit (premium paid)";
  }

  // ---- Cash-secured put ----
  if (strategy === "SHORT_PUT_CSP"){
    if (hasStop){
      riskPerContract = Math.max(0, (stopPrem - prem)) * mult;
      riskHint = "CSP (stop-based buyback loss)";
    } else {
      riskPerContract = Math.max(0, (strike - prem)) * mult; // conservative to zero
      riskHint = "CSP (worst-case to zero)";
    }
    capPerContract = strike * mult; // typical collateral
    capHint = "Collateral ≈ strike × multiplier";
  }

  // ---- Covered call ----
  if (strategy === "SHORT_CALL_COV"){
    const costBasis = parseNum($("costBasis")?.value);
    if (!(costBasis > 0)){
      showWarn("posWarn", "posWarnText", "Covered call selected: enter a valid stock cost basis.");
      return;
    }
    if (hasStop){
      riskPerContract = Math.max(0, (stopPrem - prem)) * mult;
      riskHint = "Covered call (stop-based buyback loss)";
    } else {
      riskPerContract = Math.max(0, (costBasis - prem)) * mult; // to zero, offset by premium
      riskHint = "Covered call (worst-case to zero)";
    }
    capPerContract = costBasis * mult; // stock capital
    capHint = "Covered by shares ≈ cost basis × multiplier";
  }

  // ---- Naked shorts (must define risk) ----
  if (strategy === "SHORT_CALL_NAKED" || strategy === "SHORT_PUT_NAKED"){
    const riskCap = parseNum($("riskCap")?.value);

    if (!hasStop && !(riskCap > 0)){
      showWarn("posWarn", "posWarnText", "Naked short selected: set a Risk Cap per Contract, or use Stop Premium.");
      return;
    }

    if (hasStop){
      riskPerContract = Math.max(0, (stopPrem - prem)) * mult;
      riskHint = "Naked short (stop-based buyback loss)";
    } else {
      riskPerContract = riskCap;
      riskHint = "Naked short (user-defined risk cap)";
    }

    capPerContract = NaN;
    capHint = "Margin varies by broker (not computed)";
    showWarn("posWarn", "posWarnText", "Reminder: naked short risk can be very large (calls can be unlimited). Use strict rules + broker margin awareness.");
  }

  // ---- Spreads (defined risk) ----
  if (strategy === "VERTICAL_CREDIT" || strategy === "VERTICAL_DEBIT"){
    const w = parseNum($("spreadWidth")?.value);
    if (!(w > 0)){
      showWarn("posWarn", "posWarnText", "Spread selected: enter a valid Spread Width ($).");
      return;
    }

    if (strategy === "VERTICAL_CREDIT"){
      // Risk per spread ≈ (width - credit) * mult
      riskPerContract = Math.max(0, (w - prem)) * mult;
      capPerContract = w * mult; // rough collateral requirement
      riskHint = "Credit spread (defined risk)";
      capHint = "Collateral ≈ spread width × multiplier";
    } else {
      // Debit spread max loss ≈ debit paid
      riskPerContract = prem * mult;
      capPerContract = prem * mult;
      riskHint = "Debit spread (max loss = debit)";
      capHint = "Debit (premium paid)";
    }
  }

  if (!Number.isFinite(riskPerContract) || riskPerContract < 0){
    showWarn("posWarn", "posWarnText", "Could not compute risk per contract — check inputs.");
    return;
  }

  // Important: show 0 correctly (not "—")
  if (riskPerContract === 0){
    setText("contracts", "0");
    setText("riskAmt", fmtMoney(0));
    setText("riskPer", `Risk per contract: ${fmtMoney(0)} • ${riskHint}`);
    setText("capitalReq", fmtMoney(0));
    setText("capitalHint", capHint || "—");
    setHTML("posPills", `<span class="pill">Risk budget: ${fmtMoney(riskBudget)}</span><span class="pill warnBox">Risk per contract is 0 — check stop/premium</span>`);
    return;
  }

  const contracts = Math.floor(riskBudget / riskPerContract);
  const totalRisk = contracts * riskPerContract;

  setText("contracts", contracts.toLocaleString());
  setText("riskAmt", fmtMoney(totalRisk));
  setText("riskPer", `Risk per contract: ${fmtMoney(riskPerContract)} • ${riskHint}`);

  if (Number.isFinite(capPerContract)){
    setText("capitalReq", fmtMoney(contracts * capPerContract));
  } else {
    setText("capitalReq", "Varies");
  }
  setText("capitalHint", capHint || "—");

  const usedPct = (totalRisk / account) * 100;

  setHTML("posPills", `
    <span class="pill">Risk budget: ${fmtMoney(riskBudget)}</span>
    <span class="pill">Risk used: ${fmtNum(usedPct, 2)}%</span>
    <span class="pill">Multiplier: ${fmtNum(mult, 0)}</span>
    ${contracts <= 0 ? `<span class="pill warnBox">Risk budget too small for 1 contract</span>` : ``}
  `);
}

// ---------- Black–Scholes ----------
function normPDF(x){
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Abramowitz & Stegun erf approx
function erf(x){
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429;
  const p=0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5*t + a4)*t + a3)*t + a2)*t + a1)*t) * Math.exp(-x*x);
  return sign * y;
}
function normCDF(x){
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function bs({S,K,T,r,sigma,type}){
  if (!(S>0) || !(K>0) || !(T>0) || !(sigma>0)) return null;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S/K) + (r + 0.5*sigma*sigma)*T) / (sigma*sqrtT);
  const d2 = d1 - sigma*sqrtT;

  let price;
  if (type === "CALL"){
    price = S*normCDF(d1) - K*Math.exp(-r*T)*normCDF(d2);
  } else {
    price = K*Math.exp(-r*T)*normCDF(-d2) - S*normCDF(-d1);
  }

  const delta = type === "CALL" ? normCDF(d1) : (normCDF(d1) - 1);
  const gamma = normPDF(d1) / (S*sigma*sqrtT);
  const vega  = S*normPDF(d1)*sqrtT; // per 1.00 vol
  const theta = type === "CALL"
    ? (-(S*normPDF(d1)*sigma)/(2*sqrtT) - r*K*Math.exp(-r*T)*normCDF(d2))
    : (-(S*normPDF(d1)*sigma)/(2*sqrtT) + r*K*Math.exp(-r*T)*normCDF(-d2));

  return {price, delta, gamma, vega, theta};
}

function updateSliderBadges(){
  setText("sSliderVal", `$${fmtNum(parseNum($("sSlider").value),2)}`);
  setText("ivSliderVal", `${fmtNum(parseNum($("ivSlider").value),1)}%`);
  setText("dteSliderVal", `${fmtNum(parseNum($("dteSlider").value),0)}d`);
}

function syncInputsFromSliders(){
  setText("bsS", null);
  $("bsS").value = fmtNum(parseNum($("sSlider").value), 2);
  $("bsIV").value = fmtNum(parseNum($("ivSlider").value), 1);
  $("bsDTE").value = fmtNum(parseNum($("dteSlider").value), 0);
}

function syncSlidersFromInputs(){
  const S = parseNum($("bsS")?.value);
  const IV = parseNum($("bsIV")?.value);
  const DTE = parseNum($("bsDTE")?.value);

  if (Number.isFinite(S)) $("sSlider").value = String(Math.min(1000, Math.max(1, S)));
  if (Number.isFinite(IV)) $("ivSlider").value = String(Math.min(250, Math.max(1, IV)));
  if (Number.isFinite(DTE)) $("dteSlider").value = String(Math.min(365, Math.max(1, DTE)));
}

function calcBS(){
  showWarn("bsWarn", "bsWarnText", "");

  const type = $("bsType")?.value;
  const S = parseNum($("bsS")?.value);
  const K = parseNum($("bsK")?.value);
  const IVpct = parseNum($("bsIV")?.value);
  const DTE = parseNum($("bsDTE")?.value);
  const rPct = parseNum($("bsR")?.value);

  if (!type || !(S>0) || !(K>0) || !(IVpct>0) || !(DTE>0) || !Number.isFinite(rPct)){
    setText("bsPrice", "—");
    setText("bsMeta", "—");
    setHTML("greeks", `<span class="pill warnBox">Enter valid inputs</span>`);
    showWarn("bsWarn", "bsWarnText", "Please enter valid positive numbers for S, K, IV, and DTE.");
    return;
  }

  const sigma = IVpct / 100;
  const T = DTE / 365;
  const r = rPct / 100;

  const out = bs({S,K,T,r,sigma,type});
  if (!out){
    setText("bsPrice", "—");
    setText("bsMeta", "—");
    setHTML("greeks", `<span class="pill warnBox">Could not compute</span>`);
    return;
  }

  setText("bsPrice", fmtMoney(out.price));
  setText("bsMeta", `S=${fmtNum(S,2)} • K=${fmtNum(K,2)} • IV=${fmtNum(IVpct,1)}% • DTE=${fmtNum(DTE,0)} • r=${fmtNum(rPct,2)}%`);

  const thetaPerDay = out.theta / 365;
  const vegaPer1pct = out.vega * 0.01;

  setHTML("greeks", `
    <span class="pill mono">Δ ${fmtNum(out.delta,4)}</span>
    <span class="pill mono">Γ ${fmtNum(out.gamma,6)}</span>
    <span class="pill mono">Θ/day ${fmtNum(thetaPerDay,4)}</span>
    <span class="pill mono">Vega/1% ${fmtNum(vegaPer1pct,4)}</span>
  `);
}

// ---------- PWA (optional) ----------
async function registerServiceWorker(){
  const status = $("pwaStatus");
  if (!("serviceWorker" in navigator)) {
    if (status) status.textContent = "";
    return;
  }

  try {
    const reg = await navigator.serviceWorker.register("./service-worker.js");
    if (status) status.textContent = "Offline-ready (PWA cache enabled).";
    // optional: listen for updates
    reg.addEventListener("updatefound", () => {
      if (status) status.textContent = "Update found… refresh to use the latest version.";
    });
  } catch (e) {
    if (status) status.textContent = "PWA cache not enabled (service worker registration failed).";
  }
}

// ---------- Init ----------
function initExpiryDefault(){
  const exp = $("expiry");
  if (!exp) return;
  const d = new Date();
  d.setDate(d.getDate() + 30);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  exp.value = `${yyyy}-${mm}-${dd}`;
}

window.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initExpiryDefault();
  setStrategyUI();

  // Position listeners
  $("calcPos")?.addEventListener("click", calcPosition);
  ["acc","riskPct","strategy","strike","expiry","prem","mult","stopPrem","costBasis","riskCap","spreadWidth"]
    .forEach(id => $(id)?.addEventListener("input", calcPosition));
  ["strategy"].forEach(id => $(id)?.addEventListener("change", calcPosition));

  // BS listeners
  $("calcBS")?.addEventListener("click", calcBS);
  ["bsType","bsS","bsK","bsIV","bsDTE","bsR"].forEach(id => {
    $(id)?.addEventListener("input", () => {
      syncSlidersFromInputs();
      updateSliderBadges();
      calcBS();
    });
  });

  ["sSlider","ivSlider","dteSlider"].forEach(id => {
    $(id)?.addEventListener("input", () => {
      syncInputsFromSliders();
      updateSliderBadges();
      calcBS();
    });
  });

  // Initial compute
  syncSlidersFromInputs();
  updateSliderBadges();
  calcPosition();
  calcBS();

  // PWA
  registerServiceWorker();
});
