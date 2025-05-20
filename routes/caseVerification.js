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

// You no longer need getSessionCookie(req) if sessionID comes directly from the frontend
// function getSessionCookie(req) {
//     return req.sessionID || null;
// }

router.post('/', async (req, res) => {
    try {
        console.log("Request Body:", req.body); // Log the entire body to see what's coming from frontend

        // --- IMPORTANT: Receive cookies and sessionId directly from the frontend body ---
        // Assuming the frontend sends a structure like:
        // {
        //   "captcha": "...",
        //   "petres_name": "...",
        //   "cookies": { "PHPSESSID": "...", "some_other_cookie": "..." },
        //   "sessionId": "...", // The specific session ID extracted on the frontend
        //   "highCourtSelectedBench": "...", // For high court, if needed
        //   "selectedDistrictBench": "...", // For district court, if needed
        //   // ... other case search parameters
        // }

        const {
            captcha,
            petres_name,
            rgyear,
            caseStatusSearchType,
            f,
            cookies: frontendCookies, // Get the cookies object from the frontend
            sessionId: frontendSessionId, // Get the sessionId from the frontend
            highCourtSelectedBench, // For high court specific
            selectedDistrictBench // For district court specific
        } = req.body;

        // Determine court_code and state_code based on the type of search
        // You might need more sophisticated logic here depending on how your frontend distinguishes
        // between High Court and District Court searches.
        let court_code, state_code, court_complex_code;

        // Example logic: You might pass a 'courtType' field from frontend
        if (req.body.courtType === 'highcourt') {
            court_code = req.body.court_code; // If court_code is directly sent for HC
            state_code = highCourtSelectedBench; // Use the bench from frontend
            court_complex_code = highCourtSelectedBench; // High court often uses bench as complex code
        } else if (req.body.courtType === 'districtcourt') {
            court_code = req.body.court_code; // If court_code is directly sent for DC
            state_code = req.body.state_code; // If state_code is directly sent for DC
            court_complex_code = selectedDistrictBench; // Use the bench from frontend
        } else {
            // Fallback or error if courtType is not specified
            console.warn("Court type not specified in request body, attempting to use direct values.");
            court_code = req.body.court_code;
            state_code = req.body.state_code;
            court_complex_code = req.body.court_complex_code;
        }

        // Format the cookies object into a string for the 'Cookie' header
        // This is the cookie string you'll send to the eCourts website
        const cookieHeaderString = Object.entries(frontendCookies || {})
            .map(([key, value]) => `${key}=${value}`)
            .join('; ');

        // Debugging missing fields
        console.log({
            captcha, petres_name, rgyear, caseStatusSearchType, f,
            court_code, state_code, court_complex_code,
            received_cookies_from_frontend: frontendCookies,
            formatted_cookie_header_string: cookieHeaderString,
            received_session_id_from_frontend: frontendSessionId
        });

        // Validate required fields
        if (!captcha || !petres_name || !rgyear || !caseStatusSearchType || !f ||
            !court_code || !state_code || !court_complex_code || !cookieHeaderString) {
            console.error('Missing required fields or cookies from frontend for case verification.');
            return res.status(400).json({ error: 'Missing required fields or cookies' });
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
            "Cookie": cookieHeaderString, // CRUCIAL: Use the cookie string sent from the frontend
            "Origin": "https://hcservices.ecourts.gov.in",
            "Referer": "https://hcservices.ecourts.gov.in/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "Sec-GPC": "1",
            "Sec-Ch-Ua": "\"Chromium\";v=\"134\", \"Not:A-Brand\";v=\"24\", \"Brave\";v=\"134\"",
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": "\"Windows\"",
            "X-Requested-With": "XMLHttpRequest"
        };

        // --- ScraperAPI Integration Logic ---
        const targetUrl = 'https://hcservices.ecourts.gov.in/hcservices/cases_qry/index_qry.php';

        const scraperApiParams = {
            api_key: scraperApiKey,
            url: targetUrl,
            // render: 'true', // Uncomment if the target page loads content via JavaScript
            // country_code: 'in', // Potentially useful
            // follow_redirects: 'true', // Potentially useful
        };

        const axiosConfigToScraperAPI = {
            params: scraperApiParams,
            headers: headersToForward,
            timeout: 60000,
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
            response = await axios.post(
                targetUrl,
                payload,
                { headers: headersToForward, timeout: 60000 }
            );
        }
        // --- End ScraperAPI Integration Logic ---

        let govData = response.data;
        console.log('Raw response from govt site:', govData);

        if (typeof govData === 'string') {
            try {
                govData = JSON.parse(govData);
            } catch (jsonErr) {
                console.error('Error parsing main response as JSON, leaving as string:', jsonErr.message);
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

        // Send final response, including the sessionId received from the frontend
        res.json({
            sessionID: frontendSessionId, // Return the sessionId that was passed from the frontend
            data: govData
        });

    } catch (error) {
        console.error('Case verification error:', error);
        if (process.env.NODE_ENV !== 'production' && error.response) {
            console.error('Error Response Status:', error.response.status);
            console.error('Error Response Data Preview:', String(error.response.data).substring(0, 200) + '...');
            console.error('Error Response Headers:', error.response.headers);
        }
        res.status(500).json({ error: 'Case verification failed', details: error.message });
    }
});

module.exports = router;
