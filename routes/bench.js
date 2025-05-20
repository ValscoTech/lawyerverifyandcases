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

        const payload = querystring.stringify({
            action_code: 'fillHCBench',
            state_code: selectedHighcourt,
            appFlag: 'web'
        });

        const targetUrl = 'https://hcservices.ecourts.gov.in/hcservices/cases_qry/index_qry.php';

        const headersToForward = {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Accept': '*/*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept-Encoding': 'gzip, deflate, br',
            // It's good practice to add Origin and Referer for web scraping
            'Origin': 'https://hcservices.ecourts.gov.in',
            'Referer': 'https://hcservices.ecourts.gov.in/'
        };

        const axiosConfig = {
            timeout: 45000,
        };

        let response;
        if (scraperApiKey) {
            console.log('Attempting to fetch benches via ScraperAPI...');
            // When using ScraperAPI, the target URL goes into the 'url' parameter
            axiosConfig.params = {
                api_key: scraperApiKey,
                url: targetUrl,
            };
            axiosConfig.headers = headersToForward; // These headers are passed to ScraperAPI to forward
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

        console.log('Bench raw response status:', response.status);
        console.log('Bench raw response data preview:', String(response.data).substring(0, 200) + '...');

        // --- FIX: Capture and Store Initial Cookies from the eCourts Response ---
        const setCookieHeaders = response.headers["set-cookie"] || [];
        if (setCookieHeaders.length > 0) {
            // Join all set-cookie headers into a single string suitable for a 'Cookie' header
            const initialEcourtsCookies = setCookieHeaders.map(c => c.split(';')[0]).join('; ');
            req.session.initialEcourtsCookies = initialEcourtsCookies; // Store in session
            console.log('✅ Initial eCourts Cookies Captured and Stored:', req.session.initialEcourtsCookies);
        } else {
            console.warn('⚠️ No initial eCourts cookies received from fetchBenches response.');
            // Ensure the session variable is at least an empty string if no cookies were received
            req.session.initialEcourtsCookies = '';
        }
        // --- END FIX ---

        const benches = parseBenchString(response.data);

        req.session.benches = benches;
        req.session.selectedBench = ''; // This will be set by the client after selection

        // Save the session after updating it
        req.session.save((err) => {
            if (err) {
                console.error("⚠️ Error saving session after fetchBenches:", err);
                return res.status(500).json({ error: "Session save failed after fetching benches" });
            }
            res.json({
                benches: benches,
                sessionID: getSessionCookie(req), // Include the Express session ID
                // No need to send initialEcourtsCookies back to the client directly,
                // as they are stored in the session for subsequent server-side use.
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
