const express = require("express");
const asyncHandler = require('express-async-handler');
const ecourtsService = require('../services/ecourtsService'); // Corrected service file name

const router = express.Router();

// --- 1. Get States (Replicates Curl 1) ---
router.get('/states', asyncHandler(async (req, res) => {
    console.log('[Server] GET /states');
    try {
        // Call the service function to get states and initial cookies
        const { states, cookies } = await ecourtsService.getStatesAndDistrictLinks();

        // Initialize or reset the ecourtsState in session
        req.session.ecourtsState = {
            cookies: cookies, // Initial cookies from the main portal
            states: states,
            selectedStateLink: null,
            selectedDistrictCourtUrl: null, // This will be set later
            districts: null, // Store districts after fetching
            scid: null, // For litigant search
            token: null, // For litigant search
            captchaValue: null, // For litigant search
            searchResults: null // For storing search results
        };

        // Save the session (good practice)
        req.session.save(err => {
            if (err) {
                console.error('[Server] Error saving session after state fetch:', err);
                // Depending on criticality, you might return an error here
            }
            console.log('[Server] Session initialized with states and cookies.');
            // Send the states back to the client (only necessary fields)
            res.json({ states: states.map(s => ({ name: s.name, state_code: s.state_code })) });
        });

    } catch (error) {
        console.error('[Server] Error in /states route:', error.message);
        // Provide more details in non-production environments if available
        const errorMessage = process.env.NODE_ENV !== 'production' && error.message ? error.message : 'Failed to fetch states from eCourts';
        res.status(error.status || 500).json({ error: errorMessage });
    }
}));

// --- 2. Get Districts (Replicates Curl 2) ---
router.post('/districts', asyncHandler(async (req, res) => {
    console.log('[Server] POST /districts');
    const { state_code } = req.body;

    // --- Inline Session Check: Requires ecourtsState and states array ---
    if (!req.session.ecourtsState || !req.session.ecourtsState.states || !req.session.ecourtsState.cookies) {
        console.warn('[Server] Session check failed for /districts: Missing ecourtsState, states, or cookies.');
        return res.status(401).json({ error: 'Session expired or not initialized. Please fetch states first.' });
    }

    if (!state_code) {
        console.warn('[Server] Validation Error: Missing state_code in request body for /districts.');
        return res.status(400).json({ error: 'State code is required' });
    }

    const states = req.session.ecourtsState.states;
    const currentCookies = req.session.ecourtsState.cookies;

    const selectedState = states.find(s => s.state_code === state_code);

    if (!selectedState) {
        console.warn(`[Server] Invalid state_code received for /districts: ${state_code}`);
        return res.status(400).json({ error: 'Invalid state_code' });
    }

    try {
        // Call the service function to get districts for the selected state
        // Pass the stateLink and the current cookies from session
        const { districts, cookies: updatedCookies } = await ecourtsService.getDistrictsForState(selectedState.link, currentCookies);

        // --- Update session with new data and cookies ---
        req.session.ecourtsState.selectedStateLink = selectedState.link; // Store the link used
        req.session.ecourtsState.cookies = updatedCookies; // Update cookies with any new ones from this request
        req.session.ecourtsState.districts = districts; // Store the fetched districts

        // Save the session
        req.session.save(err => {
            if (err) {
                console.error('[Server] Error saving session after district fetch:', err);
                // Continue anyway, client has the districts
            }
            console.log('[Server] Session updated with districts and selected state link.');
            // Send the districts back to the client
            res.json({ districts: districts });
        });

    } catch (error) {
        console.error('[Server] Error in /districts route:', error.message);
        const errorMessage = process.env.NODE_ENV !== 'production' && error.message ? error.message : 'Failed to fetch districts for state';
        res.status(error.status || 500).json({ error: errorMessage });
    }
}));


// --- Route to Set District Court URL (Manual step needed based on curl analysis) ---
// This is a necessary intermediate step to store the .dcourts.gov.in URL in the session
// after the user selects a district from the list obtained via /districts.
router.post('/select-district-court', asyncHandler(async (req, res) => {
    console.log('[Server] POST /select-district-court');
    const { districtCourtBaseUrl } = req.body;

    // --- Inline Session Check: Requires ecourtsState ---
    if (!req.session.ecourtsState) {
        console.warn('[Server] Session check failed for /select-district-court: Missing ecourtsState.');
        return res.status(401).json({ error: 'Session expired or not initialized. Please fetch states first.' });
    }

    if (!districtCourtBaseUrl) {
        console.warn('[Server] Validation Error: Missing districtCourtBaseUrl in request body for /select-district-court.');
        return res.status(400).json({ error: 'District court base URL is required' });
    }

    // Optionally, you might want to perform a GET request to the districtCourtBaseUrl
    // here to get initial cookies specific to that domain, although the curls
    // imply cookies from ecourts.gov.in might transfer or new ones are set
    // on the first request to the .dcourts.gov.in domain (like /case-status-search...).
    // For simplicity, we'll just store the URL and rely on subsequent calls
    // (like /case-search-init or /search-case-by-cin) to handle cookies.

    // --- Update session with the selected district court URL ---
    req.session.ecourtsState.selectedDistrictCourtUrl = districtCourtBaseUrl;

    // Save the session
    req.session.save(err => {
        if (err) {
            console.error('[Server] Error saving session after setting district court URL:', err);
            // Continue anyway
        }
        console.log('[Server] Session updated with selected district court URL:', districtCourtBaseUrl);
        res.json({ message: 'District court URL set successfully.' });
    });
}));


// --- 3. Initialize Case Search (Replicates Curl 3) ---
// This route is primarily for the litigant search flow to get scid and token.
// It requires the districtCourtBaseUrl to be set in the session.
router.post('/case-search-init', asyncHandler(async (req, res) => {
    console.log('[Server] POST /case-search-init');

    // --- Inline Session Check: Requires ecourtsState, selectedDistrictCourtUrl, and cookies ---
    if (!req.session.ecourtsState || !req.session.ecourtsState.selectedDistrictCourtUrl || !req.session.ecourtsState.cookies) {
        console.warn('[Server] Session check failed for /case-search-init: Missing required session data.');
        return res.status(401).json({ error: 'Session expired or district court not selected. Please select a district first.' });
    }

    const districtCourtBaseUrl = req.session.ecourtsState.selectedDistrictCourtUrl;
    const currentCookies = req.session.ecourtsState.cookies;

    try {
        // Call the service function to get scid and token from the search page
        const { scid, token, cookies: updatedCookies } = await ecourtsService.getCaseSearchPageData(districtCourtBaseUrl, currentCookies);

        // --- Update session with new data and cookies ---
        req.session.ecourtsState.scid = scid; // Store scid
        req.session.ecourtsState.token = token; // Store token object {name, value}
        req.session.ecourtsState.cookies = updatedCookies; // Update cookies

        // Save the session
        req.session.save(err => {
            if (err) {
                console.error('[Server] Error saving session after case search init:', err);
                // Continue anyway, client has scid and token name
            }
            console.log('[Server] Session updated with scid, token, and updated cookies.');
            // Return scid and token name to the client (token value is sensitive)
            res.json({ scid: scid, tokenName: token.name });
        });

    } catch (error) {
        console.error('[Server] Error in /case-search-init route:', error.message);
        const errorMessage = process.env.NODE_ENV !== 'production' && error.message ? error.message : 'Failed to initialize case search';
        res.status(error.status || 500).json({ error: errorMessage });
    }
}));


// --- 4. Get Captcha Image (Replicates Curl 4) ---
// Only needed for the litigant search flow.
// This route is called by the client to display the captcha image.
router.get('/captcha/:scid', asyncHandler(async (req, res) => {
    console.log('[Server] GET /captcha');
    const requestedScid = req.params.scid; // Get scid from URL parameter

    // --- Inline Session Check: Requires ecourtsState, selectedDistrictCourtUrl, scid, and cookies ---
    if (!req.session.ecourtsState || !req.session.ecourtsState.selectedDistrictCourtUrl || !req.session.ecourtsState.scid || !req.session.ecourtsState.cookies) {
        console.warn('[Server] Session check failed for /captcha: Missing required session data.');
        return res.status(401).json({ error: 'Session expired or case search not initialized. Please start over.' });
    }

    const { selectedDistrictCourtUrl, scid: sessionScid, cookies } = req.session.ecourtsState;

    // Optional: Verify scid matches the one generated for the session
    if (sessionScid !== requestedScid) {
        console.warn('[Server] Captcha request scid mismatch with session.');
        return res.status(400).json({ error: 'Invalid scid or session mismatch.' });
    }

    // Construct the full captcha URL using the stored district court base URL and scid
    const captchaUrl = `${selectedDistrictCourtUrl}/?_siwp_captcha&id=${sessionScid}`;


    try {
        // Call the service function to get the captcha image data
        // Pass the constructed captchaUrl and the cookies from session
        const { imageData, cookies: updatedCookies } = await ecourtsService.getCaptchaImage(captchaUrl, cookies);

        // --- Update session with new cookies from captcha request ---
        req.session.ecourtsState.cookies = updatedCookies; // Update cookies

        // Save the session
        req.session.save(err => {
            if (err) {
                console.error('[Server] Error saving session after captcha fetch:', err);
                // Continue anyway, the client is getting the image
            }
            console.log('[Server] Session updated after captcha request.');
            // Send the image data directly
            res.setHeader('Content-Type', 'image/png'); // Assuming PNG, verify actual type if needed
            res.send(imageData);
        });


    } catch (error) {
        console.error('[Server] Error in /captcha/:scid route:', error.message);
        const errorMessage = process.env.NODE_ENV !== 'production' && error.message ? error.message : 'Failed to fetch captcha image';
        res.status(error.status || 500).json({ error: errorMessage });
    }
}));


// --- 5. Submit Litigant Search Form (Replicates Curl 5) ---
router.post('/search-case', asyncHandler(async (req, res) => {
    console.log('[Server] POST /search-case (Litigant Search)');
    const { captchaValue, ...searchParams } = req.body; // Extract captchaValue and other search parameters

    // --- Inline Session Check: Requires ecourtsState, selectedDistrictCourtUrl, scid, token, and cookies ---
    if (!req.session.ecourtsState || !req.session.ecourtsState.selectedDistrictCourtUrl || !req.session.ecourtsState.scid || !req.session.ecourtsState.token || !req.session.ecourtsState.cookies) {
        console.warn('[Server] Session check failed for /search-case: Missing required session data.');
        return res.status(401).json({ error: 'Session expired or case search not initialized. Please start over.' });
    }

    const { selectedDistrictCourtUrl, scid, token, cookies } = req.session.ecourtsState;

    if (!captchaValue || Object.keys(searchParams).length === 0) {
        console.warn('[Server] Validation Error: Missing captchaValue or search parameters in request body for /search-case.');
        return res.status(400).json({ error: 'Missing captcha value or search parameters' });
    }

    try {
        // Call the service function to submit the litigant search form
        const { results, cookies: updatedCookies } = await ecourtsService.submitCaseSearch(
            selectedDistrictCourtUrl,
            scid,
            token,
            captchaValue,
            searchParams,
            cookies
        );

        // --- Update session with search results and new cookies ---
        req.session.ecourtsState.searchResults = results; // Store results (optional, depends on flow)
        req.session.ecourtsState.cookies = updatedCookies; // Update cookies

        // Save the session
        req.session.save(err => {
            if (err) {
                console.error('[Server] Error saving session after litigant search submit:', err);
                // Continue anyway, client has the results
            }
            console.log('[Server] Session updated after litigant search submit.');
            // Send the search results back to the client
            res.json({ results: results });
        });

    } catch (error) {
        console.error('[Server] Error in /search-case route (litigant):', error.message);
        const errorMessage = process.env.NODE_ENV !== 'production' && error.message ? error.message : 'Failed to submit litigant case search';
        res.status(error.status || 500).json({ error: errorMessage });
    }
}));


// --- New Route: Search by CIN ---
// This route will call the new service function for CIN search.
// It requires districtCourtBaseUrl and cookies to be set in the session.
router.post('/search-case-by-cin', asyncHandler(async (req, res) => {
    console.log('[Server] POST /search-case-by-cin');
    const { cino } = req.body; // Client provides the CIN

    // --- Inline Session Check: Requires ecourtsState, selectedDistrictCourtUrl, and cookies ---
    if (!req.session.ecourtsState || !req.session.ecourtsState.selectedDistrictCourtUrl || !req.session.ecourtsState.cookies) {
        console.warn('[Server] Session check failed for /search-case-by-cin: Missing required session data.');
        return res.status(401).json({ error: 'Session expired or district court not selected. Please select a district first.' });
    }

    if (!cino) {
        console.warn('[Server] Validation Error: Missing cino in request body for /search-case-by-cin.');
        return res.status(400).json({ error: 'CIN is required' });
    }

    const { selectedDistrictCourtUrl, cookies } = req.session.ecourtsState;

    try {
        // Call the new service function for CIN search
        const { results, cookies: updatedCookies } = await ecourtsService.searchCaseByCin(
            selectedDistrictCourtUrl,
            cino,
            cookies
        );

        // --- Update session with new cookies ---
        req.session.ecourtsState.cookies = updatedCookies; // Update cookies
        // Optionally store CIN results: req.session.ecourtsState.cinSearchResults = results;

        // Save the session
        req.session.save(err => {
            if (err) {
                console.error('[Server] Error saving session after CIN search submit:', err);
                // Continue anyway, client has the results
            }
            console.log('[Server] Session updated after CIN search submit.');
            // Send the search results back to the client
            res.json({ results: results });
        });

    } catch (error) {
        console.error('[Server] Error in /search-case-by-cin route:', error.message);
        const errorMessage = process.env.NODE_ENV !== 'production' && error.message ? error.message : 'Failed to submit CIN case search';
        res.status(error.status || 500).json({ error: errorMessage });
    }
}));


module.exports = router;
