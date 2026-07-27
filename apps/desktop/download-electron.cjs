const https = require('https');
const fs = require('fs');
const path = require('path');

const version = '38.4.0';
const filename = `electron-v${version}-win32-x64.zip`;
const url = `https://github.com/electron/electron/releases/download/v${version}/${filename}`;
const destPath = path.join(__dirname, 'temp-electron.zip');

console.log('Downloading:', url);

const file = fs.createWriteStream(destPath);

https.get(url, (res) => {
  if (res.statusCode === 302 || res.statusCode === 301) {
    const redirectUrl = res.headers.location;
    console.log('Redirect to:', redirectUrl);
    https.get(redirectUrl, (res2) => {
      res2.pipe(file);
    }).on('error', (e) => console.error('Redirect error:', e));
  } else {
    res.pipe(file);
  }
}).on('error', (e) => console.error('Download error:', e));

file.on('finish', () => {
  file.close();
  console.log('Download complete:', destPath);
});
