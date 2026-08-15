const http = require('http');

http.get('http://localhost:3003/api/dsf/data', (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    const json = JSON.parse(body);
    console.log('DSF data fetched successfully!');
    console.log('Controls count:', json.controls.length);
    console.log('All controls valid?', json.allControlsValid);
    console.log('IS Calculé:', json.tdrf.isCalcule, 'Minimum IS:', json.tdrf.minimumPerceptionIS, 'IS Final:', json.tdrf.isFinal);
    process.exit(0);
  });
}).on('error', err => {
  console.error('Error fetching DSF:', err);
  process.exit(1);
});
