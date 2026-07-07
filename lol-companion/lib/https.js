// Minimal HTTPS JSON helper built on node:https so we can talk to the
// League Client / Live Client APIs, which use self-signed certificates
// (Node's global fetch can't relax TLS per-request without undici config).
import https from 'node:https';

export function httpsJson({ host, port, path, headers = {}, timeout = 4000 }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        port,
        path,
        method: 'GET',
        headers,
        rejectUnauthorized: false, // Riot local APIs use self-signed certs
        timeout
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(body ? JSON.parse(body) : null);
            } catch (err) {
              reject(new Error(`Bad JSON from ${host}:${port}${path}: ${err.message}`));
            }
          } else {
            const err = new Error(`HTTP ${res.statusCode} from ${host}:${port}${path}`);
            err.status = res.statusCode;
            reject(err);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error(`Timeout talking to ${host}:${port}`)));
    req.on('error', reject);
    req.end();
  });
}
