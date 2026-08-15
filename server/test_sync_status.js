const http = require('http');

http.get('http://localhost:3003/api/sync/status', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Sync status response:', data);
    process.exit(0);
  });
}).on('error', err => {
  console.error(err);
  process.exit(1);
});
