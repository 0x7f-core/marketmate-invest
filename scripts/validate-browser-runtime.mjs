import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const BASE_URL = process.env.APP_BASE_URL ?? "http://127.0.0.1:8787";
const CDP_PORT = Number(process.env.CDP_PORT ?? 9222);
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
const ARTIFACT_DIR = process.env.BROWSER_ARTIFACT_DIR ?? "artifacts/browser-smoke";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status > 0) return response;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError ?? "unknown")}`);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const executable = candidates.find(candidate => existsSync(candidate));
  if (!executable) throw new Error(`Chrome/Chromium not found. Checked: ${candidates.join(", ")}`);
  return executable;
}

class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.webSocketUrl);
    this.ws.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result ?? {});
    });
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", () => reject(new Error("Could not connect to Chrome DevTools Protocol")), { once: true });
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Browser evaluation failed");
    }
    return result.result?.value;
  }

  async waitFor(expression, label, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    let lastValue;
    while (Date.now() < deadline) {
      try {
        lastValue = await this.evaluate(expression);
        if (lastValue) return lastValue;
      } catch {
        // React may be replacing the target node between polls; retry until the deadline.
      }
      await sleep(200);
    }
    throw new Error(`Timed out waiting for ${label}; last value=${JSON.stringify(lastValue)}`);
  }

  async setViewport(width, height, mobile) {
    await this.call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
      screenWidth: width,
      screenHeight: height,
    });
  }

  async navigate(url) {
    await this.call("Page.navigate", { url });
    await this.waitFor("document.readyState === 'complete'", `document load for ${url}`);
  }

  async screenshot(path) {
    const result = await this.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    assert(result.data, `Screenshot data missing for ${path}`);
    writeFileSync(path, Buffer.from(result.data, "base64"));
  }

  close() {
    this.ws?.close();
  }
}

const visibleExpression = selector => `(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
})()`;

const hiddenExpression = selector => `(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) return true;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0;
})()`;

async function main() {
  await waitHttp(BASE_URL);
  console.log(`PASS app ready at ${BASE_URL}`);

  const chrome = findChrome();
  const chromeProcess = spawn(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=/tmp/marketmate-browser-smoke-${process.pid}`,
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let chromeError = "";
  chromeProcess.stderr.on("data", chunk => { chromeError += String(chunk); });

  let client;
  try {
    await waitHttp(`${CDP_URL}/json/version`);
    const targetResponse = await fetch(`${CDP_URL}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
    assert(targetResponse.ok, `Could not create Chrome target: HTTP ${targetResponse.status}`);
    const target = await targetResponse.json();
    assert(target.webSocketDebuggerUrl, "Chrome target did not expose a DevTools WebSocket URL");

    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    mkdirSync(ARTIFACT_DIR, { recursive: true });

    // Unauthenticated desktop shell.
    await client.setViewport(1440, 1000, false);
    await client.navigate(BASE_URL);
    await client.waitFor(visibleExpression(".auth-card"), "desktop auth card");
    const authHeading = await client.evaluate("document.querySelector('.auth-card h1')?.textContent || ''");
    assert(authHeading.includes("친구들과 투자대회 시작하기"), `Unexpected auth heading: ${authHeading}`);
    console.log("PASS desktop unauthenticated render");

    // Create a real local D1 user through the same browser origin so the HttpOnly session cookie is retained.
    const nickname = `브라우저${Date.now().toString().slice(-7)}`;
    const registration = await client.evaluate(`fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: ${JSON.stringify(nickname)}, pin: '2468' })
    }).then(async response => ({ ok: response.ok, status: response.status, body: await response.json() }))`);
    assert(registration?.ok && registration?.body?.user, `Browser registration failed: ${JSON.stringify(registration)}`);
    await client.navigate(BASE_URL);
    await client.waitFor(visibleExpression(".marketmate-v2"), "authenticated dashboard");
    console.log("PASS browser registration + authenticated hydration");

    // Desktop layout and navigation.
    assert(await client.evaluate(visibleExpression(".np-desktop-header")), "Desktop header is not visible at 1440px");
    assert(await client.evaluate(hiddenExpression(".np-mobile-header")), "Mobile header should be hidden at 1440px");
    assert(await client.evaluate(hiddenExpression(".np-mobile-bottom")), "Mobile bottom nav should be hidden at 1440px");
    const desktopOverflow = await client.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
    assert(desktopOverflow <= 1, `Desktop root horizontal overflow detected: ${desktopOverflow}px`);
    console.log("PASS desktop responsive shell + no root overflow");

    // Exercise the real React search UI, then move to Samsung Electronics market view.
    const searchSet = await client.evaluate(`(() => {
      const input = document.querySelector('.np-desktop-header .search-wrap input');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) return false;
      setter.call(input, '삼성전자');
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '삼성전자' }));
      return true;
    })()`);
    assert(searchSet, "Could not enter 삼성전자 into desktop search");
    await client.waitFor(`[...document.querySelectorAll('.np-desktop-header .search-results button')].some(button => button.textContent?.includes('삼성전자'))`, "삼성전자 search result");
    const clickedSamsung = await client.evaluate(`(() => {
      const button = [...document.querySelectorAll('.np-desktop-header .search-results button')].find(item => item.textContent?.includes('삼성전자'));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert(clickedSamsung, "Could not click 삼성전자 search result");
    await client.waitFor(visibleExpression(".np-trading"), "desktop market view");
    await client.waitFor("document.querySelector('.np-quote h1')?.textContent?.includes('삼성전자')", "삼성전자 quote heading");
    await client.waitFor("!document.querySelector('.np-price strong')?.textContent?.includes('시세 확인 중')", "live Samsung quote", 25_000);
    console.log("PASS desktop search → Samsung quote flow");

    // Real browser chart render: external Lightweight Charts script + Naver chart route + responsive canvas.
    await client.waitFor("document.querySelector('.naver-light-chart-canvas canvas') !== null", "Lightweight Charts canvas", 25_000);
    const desktopChart = await client.evaluate(`(() => {
      const stage = document.querySelector('.naver-light-chart-stage');
      const canvas = document.querySelector('.naver-light-chart-canvas canvas');
      const attribution = document.querySelector('.naver-light-chart-attribution');
      if (!stage || !canvas || !attribution) return null;
      const rect = stage.getBoundingClientRect();
      return { width: rect.width, height: rect.height, canvasWidth: canvas.getBoundingClientRect().width, attribution: attribution.textContent || '' };
    })()`);
    assert(desktopChart?.width > 500 && desktopChart?.height > 250 && desktopChart?.canvasWidth > 400, `Desktop chart sizing invalid: ${JSON.stringify(desktopChart)}`);
    assert(desktopChart.attribution.includes("TradingView"), "TradingView attribution is missing");
    assert(await client.evaluate(visibleExpression(".np-news")), "Market news panel is not visible on desktop");
    await client.screenshot(`${ARTIFACT_DIR}/desktop-market.png`);
    console.log(`PASS desktop chart + news render (${Math.round(desktopChart.width)}x${Math.round(desktopChart.height)})`);

    // Switch the same hydrated application to a 390px mobile viewport.
    await client.setViewport(390, 844, true);
    await sleep(700);
    assert(await client.evaluate(hiddenExpression(".np-desktop-header")), "Desktop header should be hidden at 390px");
    assert(await client.evaluate(visibleExpression(".np-mobile-header")), "Mobile header is not visible at 390px");
    assert(await client.evaluate(visibleExpression(".np-mobile-bottom")), "Mobile bottom nav is not visible at 390px");
    const mobileMetrics = await client.evaluate(`(() => ({
      innerWidth: window.innerWidth,
      rootClientWidth: document.documentElement.clientWidth,
      rootScrollWidth: document.documentElement.scrollWidth,
      topNavButtons: document.querySelectorAll('.np-mobile-header nav button').length,
      bottomNavButtons: document.querySelectorAll('.np-mobile-bottom button').length
    }))()`);
    assert(mobileMetrics.innerWidth === 390, `Unexpected mobile viewport width: ${mobileMetrics.innerWidth}`);
    assert(mobileMetrics.rootScrollWidth <= mobileMetrics.rootClientWidth + 1, `Mobile root horizontal overflow: ${mobileMetrics.rootScrollWidth} > ${mobileMetrics.rootClientWidth}`);
    assert(mobileMetrics.topNavButtons === 0 && mobileMetrics.bottomNavButtons === 6, `Unexpected mobile nav counts: ${JSON.stringify(mobileMetrics)}`);
    console.log("PASS mobile shell + nav + no root overflow");

    assert(await client.evaluate(visibleExpression(".np-mobile-search-launch")), "Mobile instrument search launcher is not visible");
    const openedMobileSearch = await client.evaluate(`(() => {
      const button = document.querySelector('.np-mobile-search-launch');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert(openedMobileSearch, "Could not open mobile instrument search");
    await client.waitFor(visibleExpression(".mobile-instrument-search"), "mobile instrument search overlay");
    assert(await client.evaluate(visibleExpression(".mobile-search-input input")), "Mobile instrument search input is not visible");
    const closedMobileSearch = await client.evaluate(`(() => {
      const button = document.querySelector('.mobile-search-back');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert(closedMobileSearch, "Could not close mobile instrument search");
    await client.waitFor(hiddenExpression(".mobile-instrument-search"), "mobile instrument search close");
    console.log("PASS mobile instrument search overlay");
    assert(await client.evaluate(visibleExpression(".np-mobile-order")), "Mobile order panel is not visible");
    assert(await client.evaluate(hiddenExpression(".np-trading > aside")), "Desktop order rail should be hidden on mobile");
    const mobileChart = await client.evaluate(`(() => {
      const chart = document.querySelector('.np-chart');
      const canvas = document.querySelector('.naver-light-chart-canvas canvas');
      if (!chart || !canvas) return null;
      const rect = chart.getBoundingClientRect();
      return { width: rect.width, height: rect.height, canvasWidth: canvas.getBoundingClientRect().width, viewport: window.innerWidth };
    })()`);
    assert(mobileChart?.width <= mobileChart?.viewport + 1 && mobileChart?.width >= 360 && mobileChart?.height >= 400, `Mobile chart sizing invalid: ${JSON.stringify(mobileChart)}`);
    await client.screenshot(`${ARTIFACT_DIR}/mobile-market.png`);
    console.log(`PASS mobile market/search/order/chart render (${Math.round(mobileChart.width)}x${Math.round(mobileChart.height)})`);

    // Portfolio uses a dedicated mobile list instead of the 720px desktop table.
    const clickedMy = await client.evaluate(`(() => {
      const button = [...document.querySelectorAll('.np-mobile-bottom button')].find(item => item.textContent?.includes('MY'));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert(clickedMy, "Could not open mobile MY view");
    await client.waitFor(visibleExpression(".np-portfolio-page"), "mobile portfolio page");
    assert(await client.evaluate(visibleExpression(".mobile-position-list")), "Mobile position list is not visible");
    assert(await client.evaluate(hiddenExpression(".desktop-position-table")), "Desktop holdings table should be hidden on mobile");
    const portfolioOverflow = await client.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
    assert(portfolioOverflow <= 1, `Mobile portfolio horizontal overflow detected: ${portfolioOverflow}px`);
    console.log("PASS mobile portfolio responsive list + no root overflow");

    // Competition action controls should remain touch-sized on mobile.
    const clickedCompetition = await client.evaluate(`(() => {
      const button = [...document.querySelectorAll('.np-mobile-bottom button')].find(item => item.textContent?.includes('대회'));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert(clickedCompetition, "Could not open mobile competition view");
    await client.waitFor(visibleExpression(".np-competition"), "mobile competition page");
    const competitionButtonHeight = await client.evaluate(`(() => {
      const button = document.querySelector('.contest-actions button');
      return button ? button.getBoundingClientRect().height : 0;
    })()`);
    assert(competitionButtonHeight >= 44, `Mobile competition action is too small: ${competitionButtonHeight}px`);
    const competitionOverflow = await client.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
    assert(competitionOverflow <= 1, `Mobile competition horizontal overflow detected: ${competitionOverflow}px`);
    console.log("PASS mobile competition touch target + no root overflow");

    console.log("All desktop/mobile browser runtime smoke checks passed.");
  } finally {
    client?.close();
    chromeProcess.kill("SIGTERM");
    await sleep(250);
    if (!chromeProcess.killed) chromeProcess.kill("SIGKILL");
    if (chromeError && process.env.DEBUG_BROWSER_SMOKE === "1") console.error(chromeError);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
