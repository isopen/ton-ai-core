// Try HTTP long polling (POST to https://host:443/apiw1)
import https from 'https';

const body = Buffer.alloc(0);
const url = new URL('https://venus.web.telegram.org:443/apiw1');

const req = https.request({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': '0',
    },
}, (res) => {
    console.log('Status:', res.statusCode);
    let data: Buffer[] = [];
    res.on('data', (chunk) => data.push(chunk));
    res.on('end', () => {
        const buf = Buffer.concat(data);
        console.log('Response length:', buf.length);
        console.log('Hex:', buf.toString('hex'));
    });
});

req.on('error', (e) => console.log('Error:', e.message));
req.end();

setTimeout(() => { console.log('Timeout'); process.exit(1); }, 10000);
