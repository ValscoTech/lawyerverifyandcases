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
            'Origin': 'https://hcservices.ecourts.gov.in',
            'Referer': 'https://hcservices.ecourts.gov.in/'
        };

        const axiosConfig = {
            timeout: 90000,
        };

        let response;
        if (scraperApiKey) {
            console.log('Attempting to fetch benches via ScraperAPI...');
            axiosConfig.params = {
                api_key: scraperApiKey,
                url: targetUrl,
            };
            axiosConfig.headers = headersToForward;
            response = await axios.post(
                scraperApiEndpoint,
                payload,
                axiosConfig
            );
        } else {
            console.log('Attempting to fetch benches directly (ScraperAPI key not set)...');
            axiosConfig.headers = headersToForward;
            response = await axios.post(
                targetUrl,
                payload,
                axiosConfig
            );
        }

        console.log('Bench raw response status:', response.status);
        console.log('Bench raw response data preview:', String(response.data).substring(0, 200) + '...');

        const setCookieHeaders = response.headers["set-cookie"] || [];
        let initialEcourtsCookies = ''; // Initialize as empty string

        if (setCookieHeaders.length > 0) {
            initialEcourtsCookies = setCookieHeaders.map(c => c.split(';')[0]).join('; ');
            req.session.initialEcourtsCookies = initialEcourtsCookies; // Store in session
            console.log('✅ Initial eCourts Cookies Captured and Stored:', req.session.initialEcourtsCookies);
        } else {
            console.warn('⚠️ No initial eCourts cookies received from fetchBenches response. Ensuring session variable is empty or retained.');
            // Ensure the session variable is at least an empty string if no cookies were received,
            // or retain any existing ones if that's your intended fallback.
            // For now, let's explicitly set it to an empty string if none are received.
            req.session.initialEcourtsCookies = '';
        }

        const benches = parseBenchString(response.data);

        req.session.benches = benches;
        req.session.selectedBench = '';

        // Save the session after updating it
        req.session.save((err) => {
            if (err) {
                console.error("⚠️ Error saving session after fetchBenches:", err);
                return res.status(500).json({ error: "Session save failed after fetching benches" });
            }
            // --- MODIFIED: Include initialEcourtsCookies in the JSON response ---
            res.json({
                benches: benches,
                sessionID: getSessionCookie(req), // Express session ID
                initialEcourtsCookies: initialEcourtsCookies // The actual cookies from ecourts.gov.in
            });
            // --- END MODIFIED ---
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
