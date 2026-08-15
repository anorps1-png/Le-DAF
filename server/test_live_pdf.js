const http = require('http');
const fs = require('fs');

http.get('http://localhost:3003/api/export/etats-financiers?type=balance&format=pdf', (res) => {
  console.log('Status code:', res.statusCode);
  console.log('Content-Type:', res.headers['content-type']);
  console.log('Content-Disposition:', res.headers['content-disposition']);

  const file = fs.createWriteStream('downloaded_test_balance.pdf');
  res.pipe(file);
  file.on('finish', () => {
    file.close();
    console.log('Downloaded balance PDF successfully!');
    process.exit(0);
  });
}).on('error', (err) => {
  console.error('Error downloading PDF:', err);
  process.exit(1);
});
