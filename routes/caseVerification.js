const express = require('express');
const axios = require('axios');
const querystring = require('querystring');

const router = express.Router();

// --- ScraperAPI Configuration (Copy from previous files) ---
const scraperApiKey = process.env.SCRAPERAPI_KEY;
const scraperApiEndpoint = 'http://api.scraperapi.com/'; // ScraperAPI's base URL

// Check if ScraperAPI key is provided
if (!scraperApiKey) {
    console.warn(`[${new Date().toISOString()}] WARNING: SCRAPERAPI_KEY environment variable is not set. ScraperAPI will not be used for main verification route.`);
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
        console.log(`[${new Date().toISOString()}] parseCookieString: Received empty cookie string.`);
        return { parsedCookies: {}, sessionId: null };
    }

    console.log(`[${new Date().toISOString()}] parseCookieString: Attempting to parse cookie string: "${cookieString}"`);

    // Split by '; ' to get individual cookie parts
    cookieString.split('; ').forEach(part => {
        const [name, value] = part.split('=');
        if (name && value) {
            const trimmedName = name.trim();
            const trimmedValue = value.trim();
            // Assign the value. If there are duplicates, the last one wins (as in browser behavior).
            parsedCookies[trimmedName] = trimmedValue;
            console.log(`[${new Date().toISOString()}]   Parsed cookie: ${trimmedName}=${trimmedValue}`);


            // Check for common session cookie names
            const lowerCaseName = trimmedName.toLowerCase();
            if (lowerCaseName === 'phpsessid' ||
                lowerCaseName.startsWith('asp.net_sessionid') ||
                lowerCaseName.startsWith('jsessionid') ||
                lowerCaseName.includes('session') || // Generic check
                lowerCaseName === 'hcservices_sessid' // Specific to your case
            ) {
                sessionId = trimmedValue;
                console.log(`[${new Date().toISOString()}]   Identified potential session cookie: ${trimmedName}`);
            }
        } else {
            console.warn(`[${new Date().toISOString()}]   parseCookieString: Skipping malformed cookie part: "${part}"`);
        }
    });

    // Prioritize specific session IDs if present in the final parsed set
    if (parsedCookies['JSESSIONID']) {
        sessionId = parsedCookies['JSESSIONID'];
        console.log(`[${new Date().toISOString()}] parseCookieString: Prioritizing JSESSIONID: ${sessionId}`);
    } else if (parsedCookies['PHPSESSID']) {
        sessionId = parsedCookies['PHPSESSID'];
        console.log(`[${new Date().toISOString()}] parseCookieString: Prioritizing PHPSESSID: ${sessionId}`);
    } else if (parsedCookies['HCSERVICES_SESSID']) { // Specific to your case
        sessionId = parsedCookies['HCSERVICES_SESSID'];
        console.log(`[${new Date().toISOString()}] parseCookieString: Prioritizing HCSERVICES_SESSID: ${sessionId}`);
    }

    console.log(`[${new Date().toISOString()}] parseCookieString: Final parsed cookies:`, parsedCookies);
    console.log(`[${new Date().toISOString()}] parseCookieString: Final identified sessionId: ${sessionId}`);

    return { parsedCookies, sessionId };
}

router.post('/', async (req, res) => {
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] --- Incoming request to case verification route ---`);
    console.log(`[${timestamp}] Request Method: ${req.method}`);
    console.log(`[${timestamp}] Request URL: ${req.originalUrl}`);
    console.log(`[${timestamp}] Request Body:`, req.body); // Log the entire body to see what's coming from frontend

    try {
        // Destructure parameters from the JSON body
        const {
            captcha,
            petres_name,
            rgyear,
            caseStatusSearchType,
            f,
            court_code,
            state_code,
            court_complex_code,
            cookies: frontendCookiesString, // Receive the cookies as a STRING from frontend
            sessionId: frontendSessionId // Receive the sessionId (optional, can be derived)
        } = req.body;

        console.log(`[${timestamp}] Received parameters:`);
        console.log(`  - Captcha: ${captcha}`);
        console.log(`  - Petitioner/Respondent Name: ${petres_name}`);
        console.log(`  - Registration Year: ${rgyear}`);
        console.log(`  - Search Type: ${caseStatusSearchType}`);
        console.log(`  - F value: ${f}`);
        console.log(`  - Court Code: ${court_code}`);
        console.log(`  - State Code: ${state_code}`);
        console.log(`  - Court Complex Code: ${court_complex_code}`);
        console.log(`  - Raw Cookies String from Frontend: "${frontendCookiesString}"`);
        console.log(`  - Session ID from Frontend (if provided): ${frontendSessionId}`);


        // Parse the incoming cookie string into an object and extract session ID
        const { parsedCookies: actualFrontendCookies, sessionId: derivedSessionId } = parseCookieString(frontendCookiesString);
        console.log(`[${timestamp}] Cookies string parsed from frontend:`, actualFrontendCookies);
        console.log(`[${timestamp}] Session ID derived from frontend cookies: ${derivedSessionId}`);

        // If frontendSessionId was not explicitly provided, use the derived one
        const finalSessionId = frontendSessionId || derivedSessionId;
        console.log(`[${timestamp}] Final Session ID to be used for response: ${finalSessionId}`);

        // Format the parsed cookies object back into a string for the 'Cookie' header
        const cookieHeaderString = Object.entries(actualFrontendCookies || {})
            .map(([key, value]) => `${key}=${value}`)
            .join('; ');
        console.log(`[${timestamp}] Formatted Cookie header string for external request: "${cookieHeaderString}"`);

        // Validate required fields
        console.log(`[${timestamp}] Validating required fields...`);
        if (!captcha || !petres_name || !rgyear || !caseStatusSearchType || !f ||
            !court_code || !state_code || !court_complex_code || !cookieHeaderString) {
            const missingFields = [];
            if (!captcha) missingFields.push('captcha');
            if (!petres_name) missingFields.push('petres_name');
            if (!rgyear) missingFields.push('rgyear');
            if (!caseStatusSearchType) missingFields.push('caseStatusSearchType');
            if (!f) missingFields.push('f');
            if (!court_code) missingFields.push('court_code');
            if (!state_code) missingFields.push('state_code');
            if (!court_complex_code) missingFields.push('court_complex_code');
            if (!cookieHeaderString) missingFields.push('cookiesString');

            console.error(`[${timestamp}] ERROR: Missing required fields for case verification: ${missingFields.join(', ')}`);
            return res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` });
        }
        console.log(`[${timestamp}] All required fields are present.`);

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
        console.log(`[${timestamp}] Constructed payload for eCourts site: "${payload}"`);

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
        console.log(`[${timestamp}] Headers to be sent to external site:`, headersToForward);

        // --- ScraperAPI Integration Logic ---
        const targetUrl = 'https://hcservices.ecourts.gov.in/hcservices/cases_qry/index_qry.php';
        console.log(`[${timestamp}] Target eCourts URL: ${targetUrl}`);

        let response;
        if (scraperApiKey) {
            console.log(`[${timestamp}] ScraperAPI key is set. Fetching case verification via ScraperAPI...`);
            const scraperApiParams = {
                api_key: scraperApiKey,
                url: targetUrl,
            };
            const axiosConfigToScraperAPI = {
                params: scraperApiParams,
                headers: headersToForward,
                timeout: 60000,
            };
            console.log(`[${timestamp}] ScraperAPI request parameters:`, scraperApiParams);
            console.log(`[${timestamp}] ScraperAPI axios config (headers to forward, timeout):`, axiosConfigToScraperAPI);

            response = await axios.post(
                scraperApiEndpoint,
                payload,
                axiosConfigToScraperAPI
            );
            console.log(`[${timestamp}] Received response from ScraperAPI. Status: ${response.status}`);
            console.log(`[${timestamp}] Response Headers from ScraperAPI:`, response.headers);

        } else {
            console.log(`[${timestamp}] ScraperAPI key not set. Fetching case verification directly from eCourts site...`);
            response = await axios.post(
                targetUrl,
                payload,
                { headers: headersToForward, timeout: 60000 }
            );
            console.log(`[${timestamp}] Received response directly from eCourts site. Status: ${response.status}`);
            console.log(`[${timestamp}] Response Headers from eCourts site:`, response.headers);
        }
        // --- End ScraperAPI Integration Logic ---

        let govData = response.data;
        console.log(`[${timestamp}] Raw response data from govt site (first 500 chars): ${String(govData).substring(0, 500)}...`);

        if (typeof govData === 'string') {
            try {
                govData = JSON.parse(govData);
                console.log(`[${timestamp}] Successfully parsed main response data as JSON.`);
            } catch (jsonErr) {
                console.error(`[${timestamp}] ERROR: Error parsing main response as JSON, leaving as string: ${jsonErr.message}`);
            }
        }

        if (govData && govData.con && Array.isArray(govData.con) && typeof govData.con[0] === 'string') {
            console.log(`[${timestamp}] Attempting to parse govData.con[0] as JSON...`);
            try {
                govData.con = JSON.parse(govData.con[0]);
                console.log(`[${timestamp}] Successfully parsed govData.con[0] as JSON.`);
            } catch (err) {
                console.error(`[${timestamp}] ERROR: Error parsing govData.con[0]: ${err.message}`);
            }
        }

        console.log(`[${timestamp}] Final processed data to send to frontend:`, govData);

        res.json({
            sessionID: finalSessionId, // Send back the derived session ID
            data: govData
        });
        console.log(`[${timestamp}] Response sent successfully to frontend.`);

    } catch (error) {
        const timestampError = new Date().toISOString();
        console.error(`[${timestampError}] FATAL ERROR in case verification route: ${error.message}`);
        if (error.response) {
            console.error(`[${timestampError}] Error Response Status: ${error.response.status}`);
            console.error(`[${timestampError}] Error Response Data Preview: ${String(error.response.data).substring(0, 500)}...`);
            console.error(`[${timestampError}] Error Response Headers:`, error.response.headers);
        } else if (error.request) {
            console.error(`[${timestampError}] No response received from target server.`);
            console.error(`[${timestampError}] Request details:`, error.request);
        } else {
            console.error(`[${timestampError}] Error setting up the request: ${error.message}`);
        }
        res.status(500).json({ error: 'Case verification failed', details: error.message });
        console.log(`[${timestampError}] Sent 500 Internal Server Error response to frontend.`);
    } finally {
        console.log(`[${new Date().toISOString()}] --- Request processing finished for case verification route ---`);
    }
});

module.exports = router;
