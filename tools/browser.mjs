// One place to start headless Chrome for the render tools, on Windows, macOS or Linux.
// Set CHROME=/path/to/chrome to override the executable.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CANDIDATES = {
  win32: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};

export function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const found = (CANDIDATES[process.platform] ?? []).find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome not found: set CHROME=/path/to/chrome');
  return found;
}

export function launch(extraArgs = []) {
  // the GPU path: D3D11 through ANGLE on Windows, Metal/GL defaults elsewhere
  const gpu = process.platform === 'win32' ? ['--use-angle=d3d11'] : [];
  return puppeteer.launch({
    executablePath: chromePath(), headless: 'new',
    args: [...gpu, '--ignore-gpu-blocklist', '--enable-gpu', ...extraArgs],
  });
}
