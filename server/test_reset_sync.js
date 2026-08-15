const http = require('http');
const data = JSON.stringify({ autoSync: true });

const req = http.request('http://localhost:3003/api/sync/config', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('Reset response:', body);
    process.exit(0);
  });
});

req.write(data);
req.end();
