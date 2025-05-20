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

/**
 * Parses a cookie string into an object, handling potential duplicates by taking the last value.
 * Also extracts common session IDs.
 * @param {string} cookieString - The raw Cookie header string.
 * @returns {{parsedCookies: object, sessionId: string|null}}
 */
function parseCookieString(cookieString) {
    const parsedCookies = {};
    let sessionId = null;

    if (!cookieString) {
        return { parsedCookies: {}, sessionId: null };
    }

    // Split by '; ' to get individual cookie parts
    cookieString.split('; ').forEach(part => {
        const [name, value] = part.split('=');
        if (name && value) {
            // Assign the value. If there are duplicates, the last one wins (as in browser behavior).
            parsedCookies[name.trim()] = value.trim();

            // Check for common session cookie names
            const lowerCaseName = name.trim().toLowerCase();
            if (lowerCaseName === 'phpsessid' ||
                lowerCaseName.startsWith('asp.net_sessionid') ||
                lowerCaseName.startsWith('jsessionid') ||
                lowerCaseName.includes('session') || // Generic check
                lowerCaseName === 'hcservices_sessid' // Specific to your case
            ) {
                sessionId = value.trim();
            }
        }
    });

    // Prioritize specific session IDs if present in the final parsed set
    if (parsedCookies['JSESSIONID']) {
        sessionId = parsedCookies['JSESSIONID'];
    } else if (parsedCookies['PHPSESSID']) {
        sessionId = parsedCookies['PHPSESSID'];
    } else if (parsedCookies['HCSERVICES_SESSID']) { // Specific to your case
        sessionId = parsedCookies['HCSERVICES_SESSID'];
    }

    return { parsedCookies, sessionId };
}

router.post('/', async (req, res) => {
    try {
        console.log("Request Body:", req.body); // Log the entire body to see what's coming from frontend

        // Destructure parameters from the JSON body
        const {
            captcha,
            petres_name,
            rgyear,
            caseStatusSearchType,
            f,
            court_code, // Directly from frontend JSON
            state_code, // Directly from frontend JSON
            court_complex_code, // Directly from frontend JSON
            cookies: frontendCookiesString, // Receive the cookies as a STRING from frontend
            sessionId: frontendSessionId // Receive the sessionId (optional, can be derived)
        } = req.body;

        // Parse the incoming cookie string into an object and extract session ID
        const { parsedCookies: actualFrontendCookies, sessionId: derivedSessionId } = parseCookieString(frontendCookiesString);

        // If frontendSessionId was not explicitly provided, use the derived one
        const finalSessionId = frontendSessionId || derivedSessionId;


        // Format the parsed cookies object back into a string for the 'Cookie' header
        // This ensures proper formatting for the header, even if duplicates were in the original string
        const cookieHeaderString = Object.entries(actualFrontendCookies || {})
            .map(([key, value]) => `${key}=${value}`)
            .join('; ');

        // Debugging missing fields
        console.log({
            captcha, petres_name, rgyear, caseStatusSearchType, f,
            court_code, state_code, court_complex_code,
            received_cookies_string_from_frontend: frontendCookiesString,
            parsed_cookies_object: actualFrontendCookies,
            formatted_cookie_header_string: cookieHeaderString,
            final_session_id_for_response: finalSessionId
        });

        // Validate required fields
        if (!captcha || !petres_name || !rgyear || !caseStatusSearchType || !f ||
            !court_code || !state_code || !court_complex_code || !cookieHeaderString) {
            console.error('Missing required fields or cookies string from frontend for case verification.');
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
            "Cookie": cookieHeaderString, // CRUCIAL: Use the cookie string derived from frontend input
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
                payload,
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

        if (govData && govData.con && Array.isArray(govData.con) && typeof govData.con[0] === 'string') {
            try {
                govData.con = JSON.parse(govData.con[0]);
            } catch (err) {
                console.error('Error parsing govData.con:', err);
            }
        }

        res.json({
            sessionID: finalSessionId, // Send back the derived session ID
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
