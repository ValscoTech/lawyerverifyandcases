const express = require('express');
const axios = require('axios');
const querystring = require('querystring');

const router = express.Router();

// --- ScraperAPI Configuration ---
const scraperApiKey = process.env.SCRAPERAPI_KEY;
const scraperApiEndpoint = 'http://api.scraperapi.com/';

if (!scraperApiKey) {
    console.warn('WARNING: SCRAPERAPI_KEY environment variable is not set. ScraperAPI will not be used for fetchBenches.');
}

// Helper function to extract the session ID (for debugging your Express session)
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

router.post('/fetchBenches', async (req, res) => {
    try {
        const { selectedHighcourt } = req.body;
        if (!selectedHighcourt) {
            return res.status(400).json({ error: 'No highcourt selected' });
        }

        req.session.selectedHighcourt = selectedHighcourt;
        // We don't need captchaCookies for THIS request, but we WILL capture
        // the initial cookies from the eCourts response.

        const payload = querystring.stringify({
            action_code: 'fillHCBench',
            state_code: selectedHighcourt,
            appFlag: 'web'
        });

        const targetUrl = 'https://hcservices.ecourts.gov.in/hcservices/cases_qry/index_qry.php';

        // Headers to be forwarded to the target URL via ScraperAPI (or directly)
        // We are NOT including initial cookies here yet, as we GET them from this response.
        const headersToForward = {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Accept': '*/*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept-Encoding': 'gzip, deflate, br',
            // Add other headers to mimic browser if needed, based on curl
            // 'Accept-Language': 'en-US,en;q=0.5',
            // 'Origin': 'https://hcservices.ecourts.gov.in',
            // 'Referer': 'https://hcservices.ecourts.gov.in/',
            // 'sec-ch-ua': '"Chromium";v="...", ...', // Match your browser/curl
            // 'sec-fetch-dest': 'empty', // Adjust based on context if needed
            // 'sec-fetch-mode': 'cors', // Adjust based on context if needed
            // 'sec-fetch-site': 'same-origin', // Adjust based on context if needed
        };

        // --- ScraperAPI Integration Logic ---
        const scraperApiParams = {
            api_key: scraperApiKey,
            url: targetUrl,
            // Add other ScraperAPI parameters if needed
            // 'country_code': 'in',
            // 'render': 'true' // If the bench data requires JS rendering
        };

        const axiosConfig = {
            timeout: 45000,
        };

        let response;
        if (scraperApiKey) {
            console.log('Attempting to fetch benches via ScraperAPI...');
            axiosConfig.params = scraperApiParams;
            axiosConfig.headers = headersToForward; // Headers for the request to ScraperAPI
            response = await axios.post(
                scraperApiEndpoint, // Request goes to ScraperAPI
                payload,            // Original payload for the target URL
                axiosConfig
            );
        } else {
            console.log('Attempting to fetch benches directly (ScraperAPI key not set)...');
            axiosConfig.headers = headersToForward; // Headers for the direct request
            response = await axios.post(
                targetUrl, // Request goes directly to target
                payload,
                axiosConfig
            );
        }
        // --- End ScraperAPI Integration Logic ---


        console.log('Bench raw response status:', response.status);
        console.log('Bench raw response data preview:', String(response.data).substring(0, 200) + '...');

        // --- NEW: Capture and Store Initial Cookies ---
        const setCookieHeaders = response.headers["set-cookie"] || [];
        if (setCookieHeaders.length > 0) {
            // Join all set-cookie headers into a single string suitable for a 'Cookie' header
            const initialCookies = setCookieHeaders.map(c => c.split(';')[0]).join('; ');
            req.session.initialEcourtsCookies = initialCookies;
            console.log('✅ Initial eCourts Cookies Captured and Stored:', req.session.initialEcourtsCookies);
        } else {
            console.warn('⚠️ No initial eCourts cookies received from fetchBenches response.');
            // This might indicate a problem or that this endpoint doesn't issue them.
            // Proceeding, but subsequent steps might fail if cookies are required.
            req.session.initialEcourtsCookies = ''; // Ensure it's not undefined
        }
        // --- END NEW ---


        const benches = parseBenchString(response.data);

        req.session.benches = benches;
        req.session.selectedBench = ''; // Consider setting a default selected bench here if applicable

        // Save the session after updating it
        req.session.save((err) => {
            if (err) {
                console.error("⚠️ Error saving session after fetchBenches:", err);
                return res.status(500).json({ error: "Session save failed after fetching benches" });
            }
            res.json({
                benches: benches
            });
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
