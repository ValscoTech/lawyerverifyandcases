const express = require('express');
const axios = require('axios');
const querystring = require('querystring');
const https = require('https'); // Require the https module for potential SSL agent configuration
// Depending on your proxy provider's SSL setup, you might need a specific agent like https-proxy-agent.
// If standard Axios proxy config has SSL issues, consider `npm install https-proxy-agent`
// and use: const HttpsProxyAgent = require('https-proxy-agent');


const router = express.Router();

// Helper function to extract the session ID
// Note: req.sessionID is usually available if you're using express-session
function getSessionCookie(req) {
  return req.sessionID || null;
}

// Parses raw bench string like "0~Select Bench#1~Allahabad High Court#2~Allahabad High Court Lucknow Bench#"
function parseBenchString(raw) {
  // Ensure raw is a string before splitting
  if (typeof raw !== 'string') {
    console.error('parseBenchString received non-string data:', raw);
    return []; // Return empty array or handle as appropriate
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

// Construct the proxy configuration object for Axios
const proxyConfig = (proxyHost && proxyPort && proxyUser && proxyPass) ? {
  host: proxyHost,
  port: parseInt(proxyPort, 10), // Ensure port is a number
  auth: {
    username: proxyUser,
    password: proxyPass
  },
  // protocol: 'http' or 'https' - Axios often infers this from the target URL,
  // but you might need to specify 'http' here depending on proxy type and setup.
  // Most residential proxies use HTTP protocol for forwarding even HTTPS requests.
  // protocol: 'http'
} : false; // If environment variables are not set, proxyConfig will be false

// --- SSL Certificate Handling (Potential Need) ---
// If you encounter SSL errors (like self-signed certificate errors) even with the proxy,
// you might need to configure a custom HTTPS agent for Axios.
// Consult Bright Data's documentation on SSL/TLS handling with Node.js/Axios.
// A common pattern involves downloading their CA certificate and using it.
/*
let httpsAgent = null;
// Example if Bright Data provides a CA cert and you can include it in your deployment:
// try {
//   const caCert = require('fs').readFileSync('/path/to/brightdata_ca.crt'); // Adjust path
//   httpsAgent = new https.Agent({
//     ca: caCert,
//     // If needed, but less secure: rejectUnauthorized: false,
//   });
// } catch (error) {
//   console.warn("Could not load Bright Data CA certificate:", error.message);
//   // Fallback or handle error
// }

// Example if you need to bypass SSL validation (USE WITH EXTREME CAUTION, NOT RECOMMENDED FOR PRODUCTION):

*/
const agent = new https.Agent({ rejectUnauthorized: false });


router.post('/fetchBenches', async (req, res) => {
  // Note: Accessing 'set-cookie' from req.headers usually only gets *incoming* cookies,
  // not cookies set by the server in a previous response that your client would send.
  // Managing cookies with sessions (as you seem to be doing) is the correct approach.
  // const captchaCookies = req.headers['set-cookie']; // This line might not be needed if using sessions


  try {
    const { selectedHighcourt } = req.body;
    if (!selectedHighcourt) {
      return res.status(400).json({ error: 'No highcourt selected' });
    }

    // Assuming req.session is set up correctly with express-session or similar
    req.session.selectedHighcourt = selectedHighcourt;

    // Use stored captcha cookies from the session
    // Ensure req.session.captchaCookies is a string; default to empty if not set
    const combinedCookie = typeof req.session.captchaCookies === 'string' ? req.session.captchaCookies : '';


    const payload = querystring.stringify({
      action_code: 'fillHCBench',
      state_code: selectedHighcourt,
      appFlag: 'web'
    });

    // Configure headers for the Axios request
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Cookie': combinedCookie, // Send the cookies stored in the session
      'Accept': '*/*',
      // Use a more robust User-Agent to appear more like a browser
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
       // Add other relevant headers if needed, e.g., Referer based on your scraping target
       // 'Referer': 'https://hcservices.ecourts.gov.in/hcservices/cases_qry/'
    };

    const response = await axios.post(
      'https://hcservices.ecourts.gov.in/hcservices/cases_qry/index_qry.php',
      payload,
      {
          headers: headers,
          proxy: proxyConfig, // <-- ADDED: Use the configured proxy
          timeout: 45000, // <-- ADDED: Set a reasonable timeout (e.g., 45 seconds)
          // If using a custom httpsAgent for SSL, add it here:
          // httpsAgent: httpsAgent,
      }
    );

    console.log('Bench raw response status:', response.status); // Log the response status
    console.log('Bench raw response data preview:', String(response.data).substring(0, 200) + '...'); // Log a preview

    // The response.data should be the string to parse
    const benches = parseBenchString(response.data);

    // Assuming req.session is available
    req.session.benches = benches;
    req.session.selectedBench = ''; // Reset selectedBench in session


    res.json({
      // sessionID: getSessionCookie(req), // You might not need to return sessionID to the client like this
      benches: benches // Return the parsed benches
    });
  } catch (error) {
    console.error('Error fetching benches:', error);

    // Provide more detailed error response in development/testing
    if (process.env.NODE_ENV !== 'production' || error.code === 'ETIMEDOUT' || error.syscall === 'connect') {
        console.error('Full Error Details:', error);
        if (error.response) {
            console.error('Error Response Status:', error.response.status);
            console.error('Error Response Data Preview:', String(error.response.data).substring(0, 200) + '...');
            console.error('Error Response Headers:', error.response.headers);
        }
         res.status(500).json({
             error: 'Failed to fetch benches',
             details: error.message, // Include the error message
             code: error.code,       // Include the error code (e.g., ETIMEDOUT)
             syscall: error.syscall, // Include the syscall (e.g., connect)
             address: error.address, // Include the address
             port: error.port        // Include the port
         });
    } else {
        // Generic error in production
        res.status(500).json({ error: 'Failed to fetch benches' });
    }
  }
});

module.exports = router;