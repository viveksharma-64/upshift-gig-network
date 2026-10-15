import './src/server/config.js';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { handleCandidateApiRequest, handleDiscoveryRunRequest, handleJobStatusRequest } from './src/server/candidateApiHandler.js';

function candidateApiPlugin() {
  return {
    name: 'candidate-api-server',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const parsedUrl = new URL(req.url, 'http://localhost');
        if (parsedUrl.pathname === '/api/candidates') {
          handleCandidateApiRequest(req, res).catch(err => {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          });
          return;
        }
        if (parsedUrl.pathname === '/api/discovery/run') {
          handleDiscoveryRunRequest(req, res).catch(err => {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          });
          return;
        }
        if (parsedUrl.pathname === '/api/discovery/status' || parsedUrl.pathname === '/api/discovery/jobs') {
          handleJobStatusRequest(req, res).catch(err => {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          });
          return;
        }
        next();
      });
    }
  };
}

export default defineConfig({
  server: {
    cors: false,
    host: '127.0.0.1',
    headers: {
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    }
  },
  plugins: [react(), candidateApiPlugin()],
});

