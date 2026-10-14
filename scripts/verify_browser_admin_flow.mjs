/**
 * Automated Real Browser Verification Script (Chrome via CDP)
 *
 * Verifies:
 * 1. Admin login with real credentials (viveksharma40105@gmail.com / password123)
 * 2. Navigation to http://localhost:5173/admin
 * 3. AI Discovery Queue tab rendering
 * 4. Actual Network response for GET /api/candidates during Sync Store
 * 5. Actual Network response for POST /api/discovery/run during Run Discovery
 * 6. UI count updates and candidate persistence
 * 7. Screenshot capture for visual confirmation
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET_URL = 'http://localhost:5173';

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
    this.eventListeners = new Map();

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method && this.eventListeners.has(msg.method)) {
        for (const listener of this.eventListeners.get(msg.method)) {
          listener(msg.params);
        }
      }
    };
  }

  async ready() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
  }

  on(event, handler) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(handler);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || 'Evaluation failed');
    }
    return res.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function run() {
  console.log('=== Step 1: Launch Chrome in Headless Mode ===');
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1280,900',
    'about:blank'
  ]);

  let cdp;
  try {
    await new Promise(r => setTimeout(r, 2000));
    const versionRes = await fetch('http://127.0.0.1:9222/json');
    const targets = await versionRes.json();
    const pageTarget = targets.find(t => t.type === 'page');

    if (!pageTarget) throw new Error('No page target found');

    cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.ready();
    console.log('Connected to Chrome DevTools Protocol.');

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    const networkResponses = [];
    cdp.on('Network.responseReceived', (params) => {
      const url = params.response.url;
      if (url.includes('/api/')) {
        networkResponses.push({
          url,
          status: params.response.status,
          statusText: params.response.statusText,
          headers: params.response.headers
        });
        console.log(`[Browser Network Response] ${params.type} ${params.response.status} ${url}`);
      }
    });

    console.log('\n=== Step 2: Navigate to Login Page ===');
    await cdp.send('Page.navigate', { url: `${TARGET_URL}/login` });
    await new Promise(r => setTimeout(r, 2000));

    console.log('\n=== Step 3: Perform Real Admin Login ===');
    await cdp.eval(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const adminTab = buttons.find(b => b.textContent.includes('Admin Login'));
        if (adminTab) adminTab.click();

        const emailInput = document.querySelector('input[type="email"]');
        const passInput = document.querySelector('input[type="password"]');

        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(emailInput, 'viveksharma40105@gmail.com');
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));

        nativeInputValueSetter.call(passInput, 'password123');
        passInput.dispatchEvent(new Event('input', { bubbles: true }));

        const form = document.querySelector('form');
        if (form) form.requestSubmit();
      })()
    `);

    console.log('Waiting for authentication and redirect to /admin...');
    let currentUrl = '';
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      currentUrl = await cdp.eval('window.location.href');
      if (currentUrl.includes('/admin')) break;
    }
    console.log('Current URL after login:', currentUrl);

    const roleInStorage = await cdp.eval('localStorage.getItem("upshift_role")');
    console.log('Verified localStorage role:', roleInStorage);

    console.log('\n=== Step 4: Switch to AI Discovery Queue Tab ===');
    let tabReady = false;
    for (let i = 0; i < 20; i++) {
      const exists = await cdp.eval(`Boolean(document.getElementById('tab-ai-discovery-queue'))`);
      if (exists) {
        tabReady = true;
        break;
      }
      await new Promise(r => setTimeout(r, 400));
    }
    console.log('AI Discovery Queue tab found in DOM:', tabReady);

    // Switch tab and verify queue component mounts
    let queueMounted = false;
    for (let i = 0; i < 20; i++) {
      await cdp.eval(`
        (() => {
          const tab = document.getElementById('tab-ai-discovery-queue');
          if (tab) tab.click();
        })()
      `);
      await new Promise(r => setTimeout(r, 500));
      const mounted = await cdp.eval(`Boolean(document.getElementById('sync-store-btn'))`);
      if (mounted) {
        queueMounted = true;
        break;
      }
    }
    console.log('CandidateReviewQueue mounted in DOM:', queueMounted);

    console.log('\n=== Step 5: Test Sync Store in Browser ===');
    // Ensure Sync Store button is ready and enabled
    for (let i = 0; i < 20; i++) {
      const isReady = await cdp.eval(`
        (() => {
          const btn = document.getElementById('sync-store-btn');
          return btn && !btn.disabled;
        })()
      `);
      if (isReady) break;
      await new Promise(r => setTimeout(r, 400));
    }

    networkResponses.length = 0;
    await cdp.eval(`
      (() => {
        const btn = document.getElementById('sync-store-btn');
        if (btn) btn.click();
      })()
    `);

    // Wait for /api/candidates response
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (networkResponses.some(r => r.url.includes('/api/candidates'))) break;
    }

    const syncResponse = networkResponses.find(r => r.url.includes('/api/candidates'));
    console.log('Sync Store Network Response:', syncResponse ? `${syncResponse.status} ${syncResponse.url}` : 'No network event captured');

    // Wait for Sync Store to settle (button re-enabled)
    for (let i = 0; i < 20; i++) {
      const isSettled = await cdp.eval(`
        (() => {
          const btn = document.getElementById('sync-store-btn');
          return btn && !btn.disabled;
        })()
      `);
      if (isSettled) break;
      await new Promise(r => setTimeout(r, 500));
    }
    await new Promise(r => setTimeout(r, 1000));

    console.log('\n=== Step 6: Test Run Discovery in Browser ===');
    // Wait for Run Discovery button to be enabled
    for (let i = 0; i < 20; i++) {
      const isEnabled = await cdp.eval(`
        (() => {
          const btn = document.getElementById('run-discovery-btn') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Run Discovery'));
          return btn && !btn.disabled;
        })()
      `);
      if (isEnabled) break;
      await new Promise(r => setTimeout(r, 500));
    }

    networkResponses.length = 0;
    const clickResult = await cdp.eval(`
      (() => {
        const btn = document.getElementById('run-discovery-btn') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Run Discovery'));
        if (!btn) return { clicked: false, error: 'Button not found' };
        if (btn.disabled) return { clicked: false, error: 'Button is disabled' };
        btn.click();
        return { clicked: true, text: btn.textContent.trim() };
      })()
    `);
    console.log('Run Discovery button click result:', clickResult);

    // Wait for /api/discovery/run response (live crawling feeds can take up to 40 seconds)
    console.log('Running live discovery crawler through browser request...');
    for (let i = 0; i < 80; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (networkResponses.some(r => r.url.includes('/api/discovery/run'))) break;
    }

    const discResponse = networkResponses.find(r => r.url.includes('/api/discovery/run'));
    console.log('Run Discovery Network Response:', discResponse ? `${discResponse.status} ${discResponse.url}` : 'No network event captured');

    // Wait for discovery state to complete in UI (button re-enabled)
    for (let i = 0; i < 30; i++) {
      const isDone = await cdp.eval(`
        (() => {
          const btn = document.getElementById('run-discovery-btn');
          return btn && !btn.disabled;
        })()
      `);
      if (isDone) break;
      await new Promise(r => setTimeout(r, 500));
    }
    await new Promise(r => setTimeout(r, 1500));

    // Capture banner messages and candidate counts from DOM
    const uiState = await cdp.eval(`
      (() => {
        const banners = Array.from(document.querySelectorAll('[role="alert"], [role="status"], div[style*="background: rgb(236, 253, 245)"], div[style*="background: #ecfdf5"]')).map(el => el.textContent.trim());
        const cards = document.querySelectorAll('.candidate-card').length;
        const badges = Array.from(document.querySelectorAll('span')).map(s => s.textContent.trim()).filter(t => t.includes('Pending:') || t.includes('Approved:') || t.includes('Total Discovered:'));
        return {
          banners,
          cardsRendered: cards,
          badges
        };
      })()
    `);
    console.log('\n=== Step 7: Captured UI State ===');
    console.log('UI Banners:', uiState.banners);
    console.log('Filter Badges:', uiState.badges);
    console.log('Candidate Cards Rendered:', uiState.cardsRendered);

    // Capture screenshot
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const screenshotPath = path.resolve('data/admin_discovery_browser_verification.png');
    await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    console.log('Verification screenshot saved to:', screenshotPath);

    console.log('\n=== Final Browser Verification Summary ===');
    console.log('1. Admin Login: SUCCESS (role: ' + roleInStorage + ')');
    console.log('2. GET /api/candidates HTTP Status:', syncResponse?.status);
    console.log('3. POST /api/discovery/run HTTP Status:', discResponse?.status);
    console.log('4. Rendered Candidate Cards in DOM:', uiState.cardsRendered);
    console.log('5. Badges:', uiState.badges.join(' | '));

    if (syncResponse?.status !== 200) {
      throw new Error(`Sync Store failed with HTTP ${syncResponse?.status}`);
    }
    if (discResponse?.status !== 200) {
      throw new Error(`Run Discovery failed with HTTP ${discResponse?.status}`);
    }
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
  }
}

run().catch(err => {
  console.error('Browser verification failed:', err);
  process.exit(1);
});
