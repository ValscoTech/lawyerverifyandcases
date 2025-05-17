const express = require("express");
const asyncHandler = require('express-async-handler');
const ecourtsService = require('../services/ecourtsService'); // Corrected service file name

const router = express.Router();

// --- Utility Function for Session Checks ---
function checkSession(req) {
     if (!req.session.ecourtsState) {
        console.warn('[Server] Missing ecourtsState in session. Session not initialized.');
        return { error: 'Session expired or not initialized. Please start over.', status: 401 };
    }
    // Ensure we have the district court URL and cookies, which should be set
    // after selecting a district or initializing search
    if (!req.session.ecourtsState.selectedDistrictCourtUrl || !req.session.ecourtsState.cookies) {
         console.warn('[Server] Missing districtCourtBaseUrl or cookies in session.');
         return { error: 'District court not selected or session incomplete. Please select a district first.', status: 400 };
    }
    return null;
}

// --- 1. Get States (Replicates Curl 1) ---
router.get('/states', asyncHandler(async (req, res) => {
    console.log('[Server] GET /states');
    try {
        const { states, cookies } = await ecourtsService.getStatesAndDistrictLinks();

        req.session.ecourtsState = {
            cookies: cookies,
            states: states,
            selectedStateLink: null,
            selectedDistrictCourtUrl: null, // This needs to be set when a district court is chosen
            scid: null,
            token: null,
            captchaValue: null,
            searchResults: null
        };

        req.session.save(err => {
            if (err) {
                console.error('[Server] Error saving session after state fetch:', err);
                return res.status(500).json({ error: 'Failed to save session' });
            }
            console.log('[Server] Session initialized with states and cookies.');
            res.json({ states: states.map(s => ({ name: s.name, state_code: s.state_code })) });
        });

    } catch (error) {
        console.error('[Server] Error in /states route:', error.message);
        res.status(500).json({ error: error.message || 'Failed to fetch states from eCourts' });
    }
}));

// --- 2. Get Districts (Replicates Curl 2) ---
// Note: This route gets districts but DOES NOT set the specific district court URL (.dcourts.gov.in).
// You need a way to map the selected district code to its corresponding .dcourts.gov.in URL.
router.post('/districts', asyncHandler(async (req, res) => {
    console.log('[Server] POST /districts');
     const sessionError = checkSession(req); // checkSession needs adjustment if this is the first POST after GET /states
     if (sessionError && sessionError.status !== 400) { // Allow missing districtCourtBaseUrl initially
         return res.status(sessionError.status).json({ error: sessionError.error });
     }


     const { state_code } = req.body;

    if (!state_code) {
        return res.status(400).json({ error: 'Missing state_code in request body' });
    }

    const selectedState = req.session.ecourtsState.states.find(s => s.state_code === state_code);

     if (!selectedState) {
         console.warn(`[Server] Invalid state_code received: ${state_code}`);
         return res.status(400).json({ error: 'Invalid state_code' });
     }

    try {
        const { districts, cookies } = await ecourtsService.getDistrictsForState(selectedState.link, req.session.ecourtsState.cookies);

         req.session.ecourtsState.selectedStateLink = selectedState.link;
         req.session.ecourtsState.cookies = cookies;
         req.session.ecourtsState.districts = districts;


        req.session.save(err => {
            if (err) {
                 console.error('[Server] Error saving session after district fetch:', err);
                 return res.status(500).json({ error: 'Failed to save session' });
            }
            console.log('[Server] Session updated with districts and selected state link.');
            res.json({ districts: districts });
        });

    } catch (error) {
        console.error('[Server] Error in /districts route:', error.message);
        res.status(500).json({ error: error.message || 'Failed to fetch districts for state' });
    }
}));


// --- Route to Set District Court URL (Manual step needed based on curl analysis) ---
// This is a necessary intermediate step to store the .dcourts.gov.in URL in the session
// before attempting any search on that specific court's website.
router.post('/select-district-court', asyncHandler(async (req, res) => {
    console.log('[Server] POST /select-district-court');
    const sessionError = checkSession(req); // checkSession needs adjustment if this is the first POST after GET /districts
    if (sessionError && sessionError.status !== 400) { // Allow missing districtCourtBaseUrl initially
        return res.status(sessionError.status).json({ error: sessionError.error });
    }


    const { districtCourtBaseUrl } = req.body;

    if (!districtCourtBaseUrl) {
        return res.status(400).json({ error: 'Missing districtCourtBaseUrl in request body' });
    }

    // Optionally, you might want to perform a GET request to the districtCourtBaseUrl
    // here to get initial cookies specific to that domain, although the curls
    // imply cookies from ecourts.gov.in might transfer or new ones are set
    // on the first request to the .dcourts.gov.in domain (like /case-status-search...).
    // For simplicity, we'll just store the URL and rely on subsequent calls
    // (like /case-search-init or /search-case-by-cin) to handle cookies.

    req.session.ecourtsState.selectedDistrictCourtUrl = districtCourtBaseUrl;

     req.session.save(err => {
        if (err) {
             console.error('[Server] Error saving session after setting district court URL:', err);
             return res.status(500).json({ error: 'Failed to save session' });
        }
        console.log('[Server] Session updated with selected district court URL:', districtCourtBaseUrl);
        res.json({ message: 'District court URL set successfully.' });
     });
}));


// --- 3. Initialize Case Search (Replicates Curl 3) ---
// This route is primarily for the litigant search flow to get scid and token.
router.post('/case-search-init', asyncHandler(async (req, res) => {
     console.log('[Server] POST /case-search-init');
     const sessionError = checkSession(req);
     if (sessionError) {
         return res.status(sessionError.status).json({ error: sessionError.error });
     }

     const districtCourtBaseUrl = req.session.ecourtsState.selectedDistrictCourtUrl;
     const currentCookies = req.session.ecourtsState.cookies;


    try {
        const { scid, token, cookies } = await ecourtsService.getCaseSearchPageData(districtCourtBaseUrl, currentCookies);

         req.session.ecourtsState.scid = scid;
         req.session.ecourtsState.token = token; // Store token object {name, value}
         req.session.ecourtsState.cookies = cookies; // Update cookies

        req.session.save(err => {
            if (err) {
                 console.error('[Server] Error saving session after case search init:', err);
                 return res.status(500).json({ error: 'Failed to save session' });
            }
            console.log('[Server] Session updated with scid, token, and district court URL.');
            res.json({ scid: scid, tokenName: token.name }); // Return scid and token name
        });

    } catch (error) {
        console.error('[Server] Error in /case-search-init route:', error.message);
         res.status(500).json({ error: error.message || 'Failed to initialize case search' });
    }
}));


// --- 4. Get Captcha Image (Replicates Curl 4) ---
// Only needed for the litigant search flow.
router.get('/captcha/:scid', asyncHandler(async (req, res) => {
     console.log('[Server] GET /captcha');
     const sessionError = checkSession(req);
     if (sessionError) {
         return res.status(sessionError.status).json({ error: sessionError.error });
     }

     const requestedScid = req.params.scid; // Get scid from URL parameter
     const { selectedDistrictCourtUrl, scid: sessionScid, cookies } = req.session.ecourtsState;


     // Optional: Verify scid matches the one generated for the session
     // if (sessionScid !== requestedScid) {
     //      console.warn('[Server] Captcha request scid mismatch with session.');
     //       return res.status(400).json({ error: 'Invalid scid' });
     // }

     if (!sessionScid || !selectedDistrictCourtUrl) {
          console.warn('[Server] Missing scid or districtCourtBaseUrl in session for captcha request.');
          return res.status(400).json({ error: 'Case search not initialized. Please go back and select district.' });
     }

    try {
        const { imageData, cookies: updatedCookies } = await ecourtsService.getCaptchaImage(selectedDistrictCourtUrl, sessionScid, cookies);

         req.session.ecourtsState.cookies = updatedCookies; // Update cookies

        req.session.save(err => {
            if (err) {
                 console.error('[Server] Error saving session after captcha fetch:', err);
                 // Continue anyway
            }
             console.log('[Server] Session updated after captcha request.');
             res.setHeader('Content-Type', 'image/png'); // Assuming PNG, verify actual type
             res.send(imageData);
        });


    } catch (error) {
        console.error('[Server] Error in /captcha route:', error.message);
         res.status(500).json({ error: error.message || 'Failed to fetch captcha image' });
    }
}));


// --- 5. Submit Litigant Search Form (Replicates Curl 5) ---
router.post('/search-case', asyncHandler(async (req, res) => {
     console.log('[Server] POST /search-case (Litigant Search)');
     const sessionError = checkSession(req);
     if (sessionError) {
         return res.status(sessionError.status).json({ error: sessionError.error });
     }

     const { captchaValue, ...searchParams } = req.body;
     const { selectedDistrictCourtUrl, scid, token, cookies } = req.session.ecourtsState;

     if (!selectedDistrictCourtUrl || !scid || !token || !cookies) {
         console.warn('[Server] Missing required data in session for litigant search submission.');
         return res.status(400).json({ error: 'Case search not initialized or session incomplete. Please start over.' });
     }

    if (!captchaValue || Object.keys(searchParams).length === 0) {
        return res.status(400).json({ error: 'Missing captcha value or search parameters in request body' });
    }

    try {
        const { results, cookies: updatedCookies } = await ecourtsService.submitCaseSearch(
            selectedDistrictCourtUrl,
            scid,
            token,
            captchaValue,
            searchParams,
            cookies
        );

         req.session.ecourtsState.searchResults = results;
         req.session.ecourtsState.cookies = updatedCookies;

        req.session.save(err => {
            if (err) {
                 console.error('[Server] Error saving session after litigant search submit:', err);
            }
             console.log('[Server] Session updated after litigant search submit.');
             res.json({ results: results });
        });

    } catch (error) {
        console.error('[Server] Error in /search-case route (litigant):', error.message);
         res.status(500).json({ error: error.message || 'Failed to submit litigant case search' });
    }
}));


// --- New Route: Search by CIN ---
// This route will call the new service function for CIN search.
// It requires districtCourtBaseUrl to be set in the session already.
router.post('/search-case-by-cin', asyncHandler(async (req, res) => {
    console.log('[Server] POST /search-case-by-cin');
    const sessionError = checkSession(req);
     if (sessionError) {
         return res.status(sessionError.status).json({ error: sessionError.error });
     }

    // Client provides the CIN
    const { cino } = req.body;

    if (!cino) {
        return res.status(400).json({ error: 'Missing cino in request body' });
    }

    const { selectedDistrictCourtUrl, cookies } = req.session.ecourtsState;

     if (!selectedDistrictCourtUrl || !cookies) {
          console.warn('[Server] Missing districtCourtBaseUrl or cookies in session for CIN search.');
          return res.status(400).json({ error: 'District court not selected or session incomplete. Please select a district first.' });
     }


    try {
        // Call the new service function for CIN search
        const { results, cookies: updatedCookies } = await ecourtsService.searchCaseByCin(
            selectedDistrictCourtUrl,
            cino,
            cookies
        );

        // Update cookies in session
        req.session.ecourtsState.cookies = updatedCookies;
        // Optionally store CIN results: req.session.ecourtsState.cinSearchResults = results;

        req.session.save(err => {
            if (err) {
                console.error('[Server] Error saving session after CIN search submit:', err);
                // Continue anyway, client has the results
            }
            console.log('[Server] Session updated after CIN search submit.');
            res.json({ results: results });
        });

    } catch (error) {
        console.error('[Server] Error in /search-case-by-cin route:', error.message);
        res.status(500).json({ error: error.message || 'Failed to submit CIN case search' });
    }
}));


module.exports = router;