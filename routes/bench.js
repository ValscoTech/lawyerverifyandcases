const express = require('express');
const axios = require('axios');
const querystring = require('querystring');
const https = require('https'); // Required for creating custom agents

// You likely need the 'https-proxy-agent' library for proper SSL handling with proxies
// npm install https-proxy-agent
const HttpsProxyAgent = require('https-proxy-agent');


const router = express.Router();

// Helper function to extract the session ID
function getSessionCookie(req) {
  return req.sessionID || null;
}

// Parses raw bench string
function parseBenchString(raw) {
  if (typeof raw !== 'string') {
    console.error('parseBenchString received non-string data:', raw);
    return [];
  }
  const parts = raw.split('#').filter(Boolean);
  return parts.map(chunk => {
    const [id, name] = chunk.split('~');
    return { id, name };
  });
}

// --- Proxy Configuration ---
// Read proxy details from environment variables
const proxyHost = process.env.PROXY_HOST;
const proxyPort = process.env.PROXY_PORT;
const proxyUser = process.env.PROXY_USER;
const proxyPass = process.env.PROXY_PASS;

// Construct the proxy URL for the agent
// Use 'http' protocol here as most residential proxies are HTTP forward proxies
const proxyUrl = (proxyHost && proxyPort && proxyUser && proxyPass) ?
  `http://${encodeURIComponent(proxyUser)}:${encodeURIComponent(proxyPass)}@${proxyHost}:${proxyPort}` :
  null;


// --- SSL Certificate Handling with Proxy Agent ---
let httpsAgent = null;

if (proxyUrl) {
    // --- !!! WARNING: INSECURE FOR PRODUCTION !!! ---
    // This bypasses SSL certificate validation. Use with extreme caution.
    httpsAgent = new HttpsProxyAgent(proxyUrl, {
      rejectUnauthorized: false // DANGER: Do not use in production!
    });
}


router.post('/fetchBenches', async (req, res) => {
  try {
    const { selectedHighcourt } = req.body;
    if (!selectedHighcourt) {
      return res.status(400).json({ error: 'No highcourt selected' });
    }

    req.session.selectedHighcourt = selectedHighcourt;
    const combinedCookie = typeof req.session.captchaCookies === 'string' ? req.session.captchaCookies : '';

    const payload = querystring.stringify({
      action_code: 'fillHCBench',
      state_code: selectedHighcourt,
      appFlag: 'web'
    });

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Cookie': combinedCookie,
      'Accept': '*/*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept-Encoding': 'gzip, deflate, br', // Removed 'compress' as it's less common and might cause issues
    };

    // Axios request configuration
    const axiosConfig = {
        headers: headers,
        timeout: 45000, // Set a reasonable timeout
    };

    // Add the agent configuration if a proxy is configured
    if (httpsAgent) {
        axiosConfig.httpsAgent = httpsAgent;
        // IMPORTANT: When using an agent like HttpsProxyAgent,
        // you should NOT use the standard 'proxy' option in Axios.
        // It's good practice to explicitly disable it to avoid conflicts.
        axiosConfig.proxy = false;
    }
    // Removed the 'else' block that was causing 'proxyConfig is not defined' error,
    // as it's not needed when using HttpsProxyAgent as the primary proxy method.


    const response = await axios.post(
      'https://hcservices.ecourts.gov.in/hcservices/cases_qry/index_qry.php',
      payload,
      axiosConfig // Use the combined configuration
    );

    console.log('Bench raw response status:', response.status);
    console.log('Bench raw response data preview:', String(response.data).substring(0, 200) + '...');

    const benches = parseBenchString(response.data);

    req.session.benches = benches;
    req.session.selectedBench = '';

    res.json({
      benches: benches
    });
  } catch (error) {
    console.error('Error fetching benches:', error);

    if (process.env.NODE_ENV !== 'production' || error.code || error.syscall) {
        console.error('Full Error Details:', error);
        if (error.response) {
            console.error('Error Response Status:', error.response.status);
            console.error('Error Response Data Preview:', String(error.response.data).substring(0, 200) + '...');
            console.error('Error Response Headers:', error.response.headers);
        }
          res.status(500).json({
              error: 'Failed to fetch benches',
              details: error.message,
              code: error.code,
              syscall: error.syscall,
              address: error.address, // May be undefined for SSL errors
              port: error.port        // May be undefined for SSL errors
          });
    } else {
        res.status(500).json({ error: 'Failed to fetch benches' });
    }
  }
});

module.exports = router;