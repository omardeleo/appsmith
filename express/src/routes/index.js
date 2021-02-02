const express = require('express');
const path = require('path');
const fs = require('fs');
const neatCsv = require('neat-csv');
const { parseDomain } = require('parse-domain');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

const stackSampleJSON1 = require('../util/stackshare-response-airbnb.json');
const stackSampleJSON2 = require('../util/stackshare-response-bench.json');
const stackBlankSampleJSON = require('../util/stackshare-response-blank.json');


puppeteer.use(StealthPlugin());
const router = express.Router();

/* GET home page. */
const EMAIL_SELECTOR = '#mat-input-1';
const PASSWORD_SELECTOR = '#mat-input-2';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const saveCSV = (name) => {
  console.log("get csv");
  const filepath = path.join('/csv/');
  const filename = fs.readdirSync(filepath).filter(file => file[0] !== '.')[0];
  const oldPath = `${filepath}${filename}`;
  const newPath = `/saved_csv/${filename.slice(0,-4)}-${name}.csv`;

  fs.readFile(oldPath, function (err, data) {
    if (err) throw err;

    fs.writeFile(newPath, data, function (err) {
        if (err) throw err;
    });

    // Delete the file
    fs.unlink(oldPath, function (err) {
      if (err) throw err;
      console.log('Saved CSV');
    });
  });
}

const parseCSV = (res, location) => {
  const filepath = path.join(location);
  const filename = fs.readdirSync(filepath).filter(file => file[0] !== '.')[0];
  console.log(`READING FILE: ${filepath}${filename}`);
  fs.readFile(`${filepath}${filename}`, 'utf8', async (err, data) => {
    if (err) throw err;
    console.log(`PARSING FILE: ${filepath}${filename}`);
    const parsedCSV = await neatCsv(data);
    const resObj = {};
    parsedCSV.forEach(row => {
      const website = row["Organization Website"];
      if (!resObj[website]) {
        resObj[website] = {
          name: row["Organization Name"],
          website: website,
          data: [row],
          source: 'crunchbase',
        }
      } else {
        resObj[website]["data"].push(row);
      }
    })
    res.json({csv: Object.values(resObj)});
  });
}

const downloadCSV = async (company, res) => {
  console.log('Step 1: Initialize browser');
  const browser = await puppeteer.launch({
    args: [
      // Required for Docker version of Puppeteer
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // This will write shared memory files into /tmp instead of /dev/shm,
      // because Docker’s default for /dev/shm is 64MB
      '--disable-dev-shm-usage'
    ],
    headless: false
  });

  console.log('Step 2: Initialize page');
  const page = await browser.newPage();
  console.log('Step 3: Set CSV download path');
  await page._client.send('Page.setDownloadBehavior', {behavior: 'allow', downloadPath: path.resolve('__dirname', '/csv')});
  console.log('Step 4: Configure viewport');
  await page.setViewport({
    width: 1500,
    height: 800,
    deviceScaleFactor: 1,
  });

  console.log(`Step 5: Navigate to login page: ${process.env.LOGIN_PAGE}`);
  await page.goto(process.env.LOGIN_PAGE);
  await page.screenshot({path: '/screenshots/00-login-page.png'});
  console.log('Step 6: Click email field');
  await page.click(EMAIL_SELECTOR);
  console.log('Step 7: Enter email');
  await page.keyboard.type(process.env.EMAIL, {delay: 100});
  console.log('Step 8: Click password field');
  await page.click(PASSWORD_SELECTOR);
  console.log('Step 9: Enter password')
  await page.keyboard.type(process.env.PASSWORD, {delay: 100});
  console.log('Step 10: Click login button');
  await page.click('button.login');
  await page.waitForNavigation();
  console.log('Step 11: Wait 3 seconds for page load');
  await page.screenshot({path: '/screenshots/01-landing-page.png'});
  await delay(3000);
  console.log(`Step 12: Navigate to search page: ${process.env.SEARCH_PAGE}`);
  await page.goto(process.env.SEARCH_PAGE);
  await page.screenshot({path: '/screenshots/02-saved-search-page.png'});
  await page.waitForSelector("#mat-input-1");
  console.log('Step 13: Click into search field');
  await page.click('#mat-input-1');
  console.log(`Step 14: Enter company name: ${company}`);
  await page.keyboard.type(company, {delay: 100});
  await page.screenshot({path: '/screenshots/03-enter-search-term.png'});
  console.log('Step 15: Wait 2 seconds for menu load');
  await delay(2000);
  await page.waitForSelector('mat-option');
  const optionsText = await page.$$eval('mat-option', nodes => nodes.map(node => node.innerText));

  if (optionsText.length === 1 && optionsText[0].includes('No results matching')) {
    res.json({csv: []});
  }

  await page.waitForSelector('entity-input');
  await page.screenshot({path: '/screenshots/03-search-field-open.png'});
  console.log("Click on menu option 1")
  await page.click('mat-option:nth-of-type(1)');
  await page.screenshot({path: '/screenshots/04-selected-menu-item-1.png'});
  let elementNumber = 2;
  let [i, j] = [2, 2];
  while (elementNumber <= optionsText.length) {
    console.log('Step xx: Click into search field');
    await page.click('#mat-input-1');
    console.log(`Step xx: Enter company name: ${company}`);
    await page.keyboard.type(company, {delay: 100});
    console.log('Step xx: Wait 0.7 seconds for menu load');
    await delay(700);
    await page.waitForSelector('mat-option');
    await page.screenshot({path: `/screenshots/05-selecting-menu-item-${i}.png`});
    console.log(`Click on menu option ${i}`)
    await page.click(`mat-option:nth-of-type(${elementNumber})`);
    await page.screenshot({path: `/screenshots/05-selected-menu-item-${j}.png`});
    i++;
    j++;
    elementNumber++;
  }

  await page.screenshot({path: '/screenshots/06-after-select-all.png'})
  await page.waitForSelector('button[data-cypress-tag="search-results"]');
  console.log('Step 16: Click Search Results Button');
  await page.click('button[data-cypress-tag="search-results"]');
  console.log('Step 17: Click Export CSV Button');
  await page.waitForSelector('export-csv-button');
  await page.click('export-csv-button');
  await page.screenshot({path: '/screenshots/07-all-results.png'})
  console.log('Step 18: Wait 4 seconds for CSV download');
  await delay(4000);
  console.log('Step 19: Close browser');
  await browser.close();
  console.log('Step 20: Parse CSV');
  parseCSV(res, '/csv/');
  console.log('Step 21: Wait 1.5 seconds for CSV parsing');
  await delay(1500)
  saveCSV(company);
  console.log('END SCRIPT');
}

router.get('/debug/stackshare/nodata', (req, res) => {
  res.json(stackBlankSampleJSON);
});

router.get('/debug/stackshare/airbnb', (req, res) => {
  res.json(stackSampleJSON1);
});

router.get('/debug/stackshare/bench', (req, res) => {
  res.json(stackSampleJSON2);
});

router.get('/debug/crunchbase/nodata', (req, res) => {
  res.json({csv: []});
});

router.get('/debug/crunchbase/airbnb', (req, res) => {
  parseCSV(res, '/debug/airbnb/');
});

router.get('/debug/crunchbase/bench', (req, res) => {
  parseCSV(res, '/debug/bench/');
});

router.get('/debug/save/csv', async (req, res) => {
  console.log('Debug route');
  await delay(1500);
  saveCSV('microsoft');
  res.send("Saving CSV");
});

router.get('/debug/crunchbase/radai', (req, res) => {
  console.log('Debug route');
  parseCSV(res, '/debug/radai/');
});

router.get('/:companyUrl', (req, res) => {
  const urlObject = new URL(req.params.companyUrl);
  const searchTerm = parseDomain(urlObject.hostname).domain;

  console.log(`START SCRIPT for company: ${searchTerm}`)
  downloadCSV(searchTerm, res);
});

router.get('/', async function(req, res, next) {
  res.send('P4P3RW4X');
});

module.exports = router;
