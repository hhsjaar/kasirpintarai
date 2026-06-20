// inspect_styles.js
const puppeteer = require('puppeteer');

(async () => {
  try {
    const browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null
    }).catch(async (e) => {
      console.log('Could not connect to port 9222, launching new headless browser...', e.message);
      return await puppeteer.launch({ headless: true });
    });

    const pages = await browser.pages();
    let page = pages.find(p => p.url().includes('localhost:3000'));
    if (!page) {
      page = await browser.newPage();
      await page.goto('http://localhost:3000');
    }

    const result = await page.evaluate(() => {
      const el = document.querySelector('.glass-panel') || document.querySelector('[class*="glass-panel"]');
      if (!el) return { error: '.glass-panel not found' };
      const style = window.getComputedStyle(el);
      return {
        background: style.background,
        backgroundColor: style.backgroundColor,
        border: style.border,
        color: style.color,
        isDarkClassOnHtml: document.documentElement.classList.contains('dark'),
        htmlClassList: document.documentElement.className
      };
    });

    console.log('RESULT_START');
    console.log(JSON.stringify(result, null, 2));
    console.log('RESULT_END');

    await browser.disconnect();
  } catch (err) {
    console.error(err);
  }
})();
