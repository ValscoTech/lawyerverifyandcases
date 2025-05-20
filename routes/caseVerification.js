const express = require('express');
const axios = require('axios');
const querystring = require('querystring');

const router = express.Router();

// --- ScraperAPI Configuration (Copy from previous files) ---
const scraperApiKey = process.env.SCRAPERAPI_KEY;
const scraperApiEndpoint = 'http://api.scraperapi.com/'; // ScraperAPI's base URL

// Check if ScraperAPI key is provided
if (!scraperApiKey) {
    console.warn('WARNING: SCRAPERAPI_KEY environment variable is not set. ScraperAPI will not be used for main verification route.');
}

function getSessionCookie(req) {
    return req.sessionID || null;
}

router.post('/', async (req, res) => {
    try {
        console.log("Request Cookies:", req.cookies);
        console.log("Session Data Before Update:", req.session);

       
        if (req.body.captchaCookies) {
          req.session.captchaCookies = req.body.captchaCookies;
        }

        console.log("Updated captchaCookies (from session):", req.session.captchaCookies); // Should now be populated by bench.js

        // Extract fields from request body
        const { captcha, petres_name, rgyear, caseStatusSearchType, f } = req.body;
        const court_code = req.body.court_code || req.session.selectedHighcourt;
        const state_code = req.body.state_code || req.session.selectedBench;
        const court_complex_code = req.body.court_complex_code || req.session.selectedBench;
        const captchaCookies = req.session.captchaCookies; // Retrieve stored cookies from session

        // Debugging missing fields
        console.log({
            captcha, petres_name, rgyear, caseStatusSearchType, f, 
            court_code, state_code, court_complex_code, captchaCookies
        });

        // Validate required fields
        if (!captcha || !petres_name || !rgyear || !caseStatusSearchType || !f || 
            !court_code || !state_code || !court_complex_code || !captchaCookies) {
            console.error('Missing required fields or session data for case verification.');
            return res.status(400).json({ error: 'Missing required fields or session data' });
        }

        // Construct payload for the eCourts site
        const payload = querystring.stringify({
            action_code: 'showRecords',
            court_code,
            state_code,
            court_complex_code,
            captcha,
            petres_name,
            rgyear,
            caseStatusSearchType,
            f,
            appFlag: 'web'
        });

        // Headers to be forwarded by ScraperAPI to the target eCourts site
        const headersToForward = {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Accept-Language": "en-US,en;q=0.5",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Connection": "keep-alive",
            "Cookie": captchaCookies, // CRUCIAL: Pass the session-stored captcha cookies
            "Origin": "https://hcservices.ecourts.gov.in", // Set to target origin, not localhost
            "Referer": "https://hcservices.ecourts.gov.in/", // Set to target referer, not localhost
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin", // Corrected as request will be same-origin from ScraperAPI's perspective
            "Sec-GPC": "1",
            "Sec-Ch-Ua": "\"Chromium\";v=\"134\", \"Not:A-Brand\";v=\"24\", \"Brave\";v=\"134\"",
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": "\"Windows\"",
            "X-Requested-With": "XMLHttpRequest"
        };

        // --- ScraperAPI Integration Logic ---
        const targetUrl = 'https://hcservices.ecourts.gov.in/hcservices/cases_qry/index_qry.php';

        // Parameters for ScraperAPI itself
        const scraperApiParams = {
            api_key: scraperApiKey,
            url: targetUrl,
            // Consider adding 'render': 'true' if the eCourts site loads content via JavaScript.
            // If the site uses client-side rendering heavily, this can be critical.
            // 'country_code': 'in' could be useful for India-specific IP addresses.
            // 'follow_redirects': 'true' can be useful if the endpoint redirects.
        };

        // Configuration for the Axios request *to ScraperAPI*
        const axiosConfigToScraperAPI = {
            params: scraperApiParams,        // ScraperAPI specific query parameters
            headers: headersToForward,       // Headers to be forwarded to the target URL
            timeout: 60000,                  // Increased timeout as this is a complex request
        };

        let response;
        if (scraperApiKey) {
            console.log('Fetching case verification via ScraperAPI...');
            response = await axios.post(
                scraperApiEndpoint,
                payload, // The original form data to send to the target
                axiosConfigToScraperAPI
            );
        } else {
            console.log('Fetching case verification directly (ScraperAPI key not set)...');
            // Fallback to direct request if ScraperAPI key is not set
            response = await axios.post(
                targetUrl,
                payload,
                { headers: headersToForward, timeout: 60000 }
            );
        }
        // --- End ScraperAPI Integration Logic ---

        let govData = response.data;
        console.log('Raw response from govt site:', govData);

        // Attempt JSON parsing if response is a string
        if (typeof govData === 'string') {
            try {
                govData = JSON.parse(govData);
            } catch (jsonErr) {
                console.error('Error parsing main response as JSON, leaving as string:', jsonErr.message);
                // Leave as string if JSON.parse fails
            }
        }

        // Handle special parsing for `govData.con`
        if (govData && govData.con && Array.isArray(govData.con) && typeof govData.con[0] === 'string') {
            try {
                govData.con = JSON.parse(govData.con[0]);
            } catch (err) {
                console.error('Error parsing govData.con:', err);
            }
        }

        // Send final response
        res.json({
            sessionID: getSessionCookie(req),
            data: govData
        });

    } catch (error) {
        console.error('Case verification error:', error);
        // Provide more detailed error info for debugging
        if (process.env.NODE_ENV !== 'production' && error.response) {
            console.error('Error Response Status:', error.response.status);
            console.error('Error Response Data Preview:', String(error.response.data).substring(0, 200) + '...');
            console.error('Error Response Headers:', error.response.headers);
        }
        res.status(500).json({ error: 'Case verification failed', details: error.message });
    }
});

module.exports = router;
