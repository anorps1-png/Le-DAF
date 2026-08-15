const http = require('http');
const fs = require('fs');

http.get('http://localhost:3003/api/export/dsf?format=excel', (res) => {
  console.log('Status code:', res.statusCode);
  console.log('Content-Type:', res.headers['content-type']);
  console.log('Content-Disposition:', res.headers['content-disposition']);

  const file = fs.createWriteStream('downloaded_dsf_officiel.xlsx');
  res.pipe(file);
  file.on('finish', () => {
    file.close();
    console.log('Downloaded DSF official Excel successfully!');
    process.exit(0);
  });
}).on('error', err => {
  console.error('Error downloading DSF Excel:', err);
  process.exit(1);
});
