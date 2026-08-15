const http = require('http');

http.get('http://localhost:3003/api/dsf/data', (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('Raw response:', body.substring(0, 300));
    process.exit(0);
  });
}).on('error', err => {
  console.error('Error:', err);
  process.exit(1);
});
