const http = require('http');

http.get('http://localhost:3003/api/sync/schema-script', (res) => {
  console.log('Status code:', res.statusCode);
  console.log('Content-Type:', res.headers['content-type']);
  console.log('Content-Disposition:', res.headers['content-disposition']);

  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('SQL Script length:', body.length, 'bytes');
    console.log('First 150 chars:', body.substring(0, 150));
    process.exit(0);
  });
}).on('error', err => {
  console.error('Error downloading script:', err);
  process.exit(1);
});
