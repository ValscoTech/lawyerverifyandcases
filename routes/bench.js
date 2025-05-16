const express = require('express');
const axios = require('axios');
const querystring = require('querystring');
// const https = require('https'); // Not needed when using ScraperAPI directly
// const {HttpsProxyAgent} = require('https-proxy-agent'); // Not needed

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

// --- ScraperAPI Configuration ---
// Get your ScraperAPI key from environment variables
// Make sure to set SCRAPERAPI_KEY in your Render environment settings.
const scraperApiKey = process.env.SCRAPERAPI_KEY;

// Check if ScraperAPI key is provided
if (!scraperApiKey) {
    console.warn('WARNING: SCRAPERAPI_KEY environment variable is not set. ScraperAPI will not be used.');
    // You might want to throw an error or handle this more gracefully in production
    // process.exit(1); // Exit if key is missing (for critical applications)
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

        // These headers are for the *original* request to ecourts.gov.in,
        // and ScraperAPI will forward them.
        const originalHeaders = {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Cookie': combinedCookie, // ScraperAPI can handle cookies
            'Accept': '*/*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept-Encoding': 'gzip, deflate, br',
        };

        // --- ScraperAPI Integration Logic ---
        const targetUrl = 'https://hcservices.ecourts.gov.in/hcservices/cases_qry/index_qry.php';
        const scraperApiEndpoint = 'http://api.scraperapi.com/'; // ScraperAPI's base URL

        // Parameters for ScraperAPI itself
        const scraperApiParams = {
            api_key: scraperApiKey,
            url: targetUrl,
            // Add any other ScraperAPI parameters you need here:
            // e.g., 'country_code': 'in',
            //       'render': 'true' if the target site is JavaScript-heavy,
            //       'follow_redirects': 'true'
        };

        // Configuration for the Axios request *to ScraperAPI*
        const axiosConfigToScraperAPI = {
            params: scraperApiParams, // ScraperAPI specific query parameters
            headers: originalHeaders, // Headers to be forwarded to the target URL
            timeout: 45000,           // Timeout for the request to ScraperAPI
            // No 'httpsAgent' or 'proxy' needed here, as ScraperAPI handles it.
        };

        // Make the POST request through ScraperAPI
        const response = await axios.post(
            scraperApiEndpoint,      // Send request to ScraperAPI's endpoint
            payload,                 // Your original form data for the target site
            axiosConfigToScraperAPI  // Configuration for the request to ScraperAPI
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
                address: error.address,
                port: error.port
            });
        } else {
            res.status(500).json({ error: 'Failed to fetch benches' });
        }
    }
});

module.exports = router;