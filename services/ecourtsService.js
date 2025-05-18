const axios = require('axios');
require('dotenv').config();
const cheerio = require('cheerio');
const { URLSearchParams } = require('url');

// --- ScraperAPI Configuration ---
const scraperApiKey = process.env.SCRAPERAPI_KEY;
const scraperApiEndpoint = 'http://api.scraperapi.com/';

// Check if ScraperAPI key is provided
if (!scraperApiKey) {
    console.warn('WARNING: SCRAPERAPI_KEY environment variable is not set. ScraperAPI will not be used for ecourtsService requests.');
}

// Base URL for the main eCourts portal
const ECOURTS_MAIN_PORTAL_URL = 'https://ecourts.gov.in/ecourts_home/index.php';
const ECOURTS_BASE_DOMAIN = 'https://ecourts.gov.in'; // Added base domain for link construction


// Common headers based on your curl requests - adjust as needed
const commonHeaders = {
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8', // Default for HTML pages
    'accept-language': 'en-US,en;q=0.5',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36', // Matching curl
    'sec-ch-ua': '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"', // Matching curl
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"', // Matching curl
    'sec-fetch-dest': 'document', // Default for HTML pages
    'sec-fetch-mode': 'navigate', // Default for HTML pages
    'sec-fetch-site': 'same-origin', // Default for initial requests
    'sec-fetch-user': '?1', // Default for user-initiated navigation
    'upgrade-insecure-requests': '1', // Default for initial HTML requests
    'sec-gpc': '1', // Matching curl
};

// Headers specifically for admin-ajax.php POST requests
const ajaxHeaders = {
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.7',
    'Connection': 'keep-alive',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors', // Often 'cors' for AJAX, but check if 'no-cors' is needed via ScraperAPI
    'Sec-Fetch-Site': 'same-origin', // Correct for requests from ScraperAPI to target
    'Sec-GPC': '1',
    'User-Agent': commonHeaders['user-agent'],
    'X-Requested-With': 'XMLHttpRequest', // Important for AJAX requests
    'sec-ch-ua': commonHeaders['sec-ch-ua'],
    'sec-ch-ua-mobile': commonHeaders['sec-ch-ua-mobile'],
    'sec-ch-ua-platform': commonHeaders['sec-ch-ua-platform'],
    // Origin and Referer must be set dynamically
    // Cookie must be set dynamically
};


// Function to extract cookies from response headers
function extractCookies(setCookieHeader) {
    if (!setCookieHeader) {
        console.log('[Service - Cookies] No Set-Cookie header found.');
        return '';
    }
    console.log('[Service - Cookies] Raw Set-Cookie header:', setCookieHeader);

    // Extract session cookies (like PHPSESSID) and others needed
    const cookies = setCookieHeader
        .map(c => c.split(';')[0]);

    console.log('[Service - Cookies] Extracted cookies (name=value):', cookies);

    return cookies.join('; ');
}

// Helper to merge new cookies into existing ones, prioritizing new ones by name
function mergeCookies(existingCookies, newCookiesString) {
    console.log('[Service - Cookies] Merging cookies...');
    console.log('[Service - Cookies] Existing cookies:', existingCookies);
    console.log('[Service - Cookies] New cookies string:', newCookiesString);

    if (!newCookiesString) {
         console.log('[Service - Cookies] No new cookies to merge.');
         return existingCookies;
    }

    const existingCookieMap = new Map();
    existingCookies.split('; ').forEach(c => {
        const [name, ...rest] = c.split('=');
        if (name) existingCookieMap.set(name, `${name}=${rest.join('=')}`);
    });
    console.log('[Service - Cookies] Existing cookies map:', existingCookieMap);


    newCookiesString.split('; ').forEach(c => {
        const [name, ...rest] = c.split('=');
        if (name) {
            existingCookieMap.set(name, `${name}=${rest.join('=')}`); // New cookies overwrite existing ones with the same name
            console.log(`[Service - Cookies] Merged/Overwrote cookie: ${name}`);
        }
    });
    console.log('[Service - Cookies] Merged cookies map:', existingCookieMap);


    const mergedCookies = Array.from(existingCookieMap.values()).join('; ');
    console.log('[Service - Cookies] Final merged cookies string:', mergedCookies);

    return mergedCookies;
}


// --- Helper function to make requests via ScraperAPI or directly ---
// Keeping this for other requests, but captcha will use direct axios call
async function makeRequest(method, targetUrl, payload, headersToForward, responseType = 'text', timeout = 60000) {
    const axiosConfig = {
        method: method,
        responseType: responseType,
        timeout: timeout,
        maxRedirects: 5, // Keep maxRedirects
    };

    let response;

    if (scraperApiKey) {
        console.log(`[Service] Attempting to make ${method} request via ScraperAPI to: ${targetUrl}`);
        const scraperApiParams = {
            api_key: scraperApiKey,
            url: targetUrl,
            // Add other ScraperAPI parameters if needed for specific URLs
            // 'country_code': 'in', // Example
            // 'render': 'true' // Example for JS-heavy pages
        };

        axiosConfig.params = scraperApiParams; // ScraperAPI params go in query string
        axiosConfig.headers = headersToForward; // Headers to be forwarded by ScraperAPI

        // For POST requests via ScraperAPI, the original payload goes in the body
        if (method.toLowerCase() === 'post') {
            axiosConfig.data = payload;
        }

        response = await axios(scraperApiEndpoint, axiosConfig); // Request goes to ScraperAPI endpoint

    } else {
        console.log(`[Service] Attempting to make ${method} request directly to: ${targetUrl}`);
        axiosConfig.headers = headersToForward; // Headers for the direct request

        // For direct requests, the payload goes in the data property for POST
        if (method.toLowerCase() === 'post') {
            axiosConfig.data = payload;
        }
        axiosConfig.url = targetUrl; // Target URL for direct request

        response = await axios(axiosConfig); // Request goes directly to target URL
    }

    return response;
}


// --- Replicate Curl 1: Get States and their District Court Links ---
async function getStatesAndDistrictLinks() {
    console.log('[Service] Attempting to get states and district links...');
    const url = ECOURTS_MAIN_PORTAL_URL;

    const headersToForward = {
        ...commonHeaders,
        'cache-control': 'max-age=0',
        'priority': 'u=0, i',
        'Cookie': '' // Start with no cookies for the initial request
    };

    try {
        const response = await makeRequest('GET', url, null, headersToForward);

        console.log('[Service] Initial GET status:', response.status);

        // Extract cookies from the response
        const cookies = extractCookies(response.headers['set-cookie']);
        console.log('[Service] Initial cookies obtained:', cookies);

        const $ = cheerio.load(response.data);

        const states = [];
        // Selector needs to be verified based on actual HTML
        $('a[href*="?p=dist_court/"]').each((i, el) => {
            const link = $(el).attr('href');
            const text = $(el).text().trim();
            if (link && text) {
                const stateCodeMatch = link.match(/\?p=dist_court\/([a-z]+)/i);
                if (stateCodeMatch && stateCodeMatch[1]) {
                    // FIX: Correct link construction to avoid duplication
                    const correctedLink = `${ECOURTS_BASE_DOMAIN}${link}`; // Append to base domain
                    states.push({ name: text, link: correctedLink, state_code: stateCodeMatch[1] });
                }
            }
        });

        if (states.length === 0) {
            console.warn('[Service] Could not find any state links on the initial page.');
        } else {
             console.log(`[Service] Found ${states.length} states.`);
        }

        return { states, cookies };

    } catch (error) {
        console.error('[Service] Error in getStatesAndDistrictLinks:', error.message);
        if (error.response) {
            console.error("eCourts Response Status:", error.response.status);
            // console.error("eCourts Response Data:", error.response.data); // Avoid logging large HTML
        }
        throw new Error(`Failed to fetch states and district links: ${error.message}`);
    }
}

// --- Replicate Curl 2: Get Districts for a State ---
async function getDistrictsForState(stateLink, cookies) {
    console.log(`[Service] Fetching districts from state link: ${stateLink}`);

    const headersToForward = {
        ...commonHeaders,
        'referer': ECOURTS_MAIN_PORTAL_URL, // Referer is main portal URL
        'Cookie': cookies // Use cookies from the initial request
    };

    try {
        const response = await makeRequest('GET', stateLink, null, headersToForward);

        console.log('[Service] State page status:', response.status);

        // Update cookies from this response
        const updatedCookies = mergeCookies(cookies, extractCookies(response.headers['set-cookie']));
        console.log('[Service] Updated cookies after state page:', updatedCookies);


        const $ = cheerio.load(response.data);

        const districts = [];
        // Selector needs to be verified based on actual HTML (e.g., select#district_code or table)

        // Example 1: Districts in a <select> dropdown (common)
        // UPDATED SELECTOR based on screenshot
        $('select[name="sateist"] option').each((i, el) => {
             const value = $(el).val();
             const text = $(el).text().trim();
             // Exclude empty or placeholder options, and the "Please Select" option
             if (value && value !== '' && text && !text.includes('Please Select')) {
                 districts.push({ code: value, name: text });
             }
         });


        if (districts.length === 0) {
            console.warn(`[Service] Could not find any district options on the page: ${stateLink}`);
        } else {
             console.log(`[Service] Found ${districts.length} districts.`);
        }

        return { districts, cookies: updatedCookies };

    } catch (error) {
        console.error(`[Service] Error in getDistrictsForState (${stateLink}):`, error.message);
         if (error.response) {
             console.error("eCourts Response Status:", error.response.status);
             // console.error("eCourts Response Data:", error.response.data); // Avoid logging large HTML
         }
        throw new Error(`Failed to fetch districts for state (${stateLink}): ${error.message}`);
    }
}


// --- Replicate Curl 3: Get Case Status Page Data (scid and token) ---
async function getCaseSearchPageData(districtCourtBaseUrl, cookies) {
    console.log(`[Service] Fetching case search page data from: ${districtCourtBaseUrl}`);
    const searchPageUrl = `${districtCourtBaseUrl}/case-status-search-by-petitioner-respondent/`; // Matching curl 3 URL structure
    const refererUrl = districtCourtBaseUrl + '/'; // Referer is often the base URL + /

    const headersToForward = {
        ...commonHeaders,
        'accept-language': 'en-US,en;q=0.7', // Matching curl 3
        'referer': refererUrl,
        'Cookie': cookies // Use cookies from previous steps
    };

    let response;
    try {
        response = await makeRequest('GET', searchPageUrl, null, headersToForward);

        console.log('[Service] Case search page status:', response.status);

         // Update cookies from this response
        const updatedCookies = mergeCookies(cookies, extractCookies(response.headers['set-cookie']));
        console.log('[Service] Updated cookies after case search page:', updatedCookies);


        const $ = cheerio.load(response.data);

        // Extract scid and token name/value from hidden inputs
        // Selectors based on screenshot: input with name="scid" and input with name starting with "tok_"
        const scid = $('input[name="scid"]').val();
        let tokenName = null;
        let tokenValue = null;

        $('input[type="hidden"]').each((i, el) => {
            const name = $(el).attr('name');
            const value = $(el).val();
            if (name && name.startsWith('tok_')) {
                tokenName = name;
                tokenValue = value;
                return false; // Stop iteration once found
            }
        });

        if (!scid || !tokenName || !tokenValue) {
            console.error('[Service] Could not find scid or token input on the case search page.');
            // --- NEW: Log response data if scid or token are not found ---
            if (response && response.data) {
                 try {
                     console.error("eCourts Response Data (HTML) when scid/token not found:", Buffer.from(response.data).toString('utf8'));
                 } catch(e) {
                     console.error("Could not convert response data to string for logging when scid/token not found.");
                     console.error("eCourts Response Data (Binary/Unknown) when scid/token not found:", response.data);
                 }
            }
            // --- END NEW ---
            throw new Error('Could not extract scid or token from case search page.');
        }

        console.log('[Service] Extracted scid:', scid);
        console.log('[Service] Extracted token:', { name: tokenName, value: tokenValue });

        return {
            scid,
            token: { name: tokenName, value: tokenValue },
            cookies: updatedCookies
        };

    } catch (error) {
        console.error(`[Service] Error in getCaseSearchPageData (${districtCourtBaseUrl}):`, error.message);
         if (error.response) {
             console.error("eCourts Response Status:", error.response.status);
             // Log response data for non-image requests if not already logged above
             if (!error.message.includes('Could not extract scid or token')) {
                 try {
                     console.error("eCourts Response Data:", Buffer.from(error.response.data).toString('utf8'));
                 } catch(e) {
                     console.error("Could not convert error response data to string.");
                     console.error("eCourts Response Data (Binary/Unknown):", error.response.data);
                 }
             }
         }
        throw new Error(`Failed to fetch case search page data: ${error.message}`);
    }
}

// --- Replicate Curl 4: Get Captcha Image (Direct Axios Call & Base64 Output) ---
async function getCaptchaImage(captchaUrl, cookies) { // Expects the full captcha URL
    console.log(`[Service] Fetching captcha image from URL: ${captchaUrl} using direct axios call.`);
    // We need the districtCourtBaseUrl for the Referer header.
    // Extract it from the captchaUrl.
    const districtCourtBaseUrlMatch = captchaUrl.match(/^(https?:\/\/[^\/]+)/);
    const districtCourtBaseUrl = districtCourtBaseUrlMatch ? districtCourtBaseUrlMatch[1] : null;

    if (!districtCourtBaseUrl) {
         console.error('[Service] Could not extract districtCourtBaseUrl from captchaUrl:', captchaUrl);
         throw new Error('Invalid captcha URL provided.');
    }

    const refererUrl = `${districtCourtBaseUrl}/case-status-search-by-petitioner-respondent/`;

    // --- Explicitly add pll_language=en to the cookies ---
    let cookiesToSend = cookies;
    if (!cookiesToSend.includes('pll_language=')) {
        cookiesToSend = `pll_language=en${cookiesToSend ? '; ' + cookiesToSend : ''}`;
        console.log('[Service] Added pll_language=en to cookies being sent.');
    }
    // --- END Explicitly add pll_language=en ---

    // --- Construct headers explicitly matching the curl command ---
    const explicitCaptchaHeaders = {
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.7',
        'Connection': 'keep-alive',
        'Referer': refererUrl, // Referer is the search page
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors', // Matching curl
        'Sec-Fetch-Site': 'same-origin', // Matching curl
        'Sec-GPC': '1', // Matching curl
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36', // Matching curl
        'sec-ch-ua': '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"', // Matching curl
        'sec-ch-ua-mobile': '?0', // Matching curl
        'sec-ch-ua-platform': '"Windows"', // Matching curl
        'Cookie': cookiesToSend // Use the modified cookies string
    };
    // --- END Construct headers explicitly matching the curl command ---


    // --- Log cookies being sent ---
    console.log('[Service] Sending Cookies with Captcha Request:', explicitCaptchaHeaders['Cookie']);
    // --- END Log cookies being sent ---

    // --- Check for specific cookies ---
    const hasPHPSESSID = cookiesToSend.includes('PHPSESSID=');
    const hasPllLanguage = cookiesToSend.includes('pll_language=');
    if (!hasPHPSESSID || !hasPllLanguage) {
        console.warn(`⚠️ Missing expected cookies for captcha request. PHPSESSID: ${hasPHPSESSID}, pll_language: ${hasPllLanguage}`);
        // This warning indicates a likely problem upstream in cookie capture/session management.
        // The request will still be made with whatever cookies are present.
    } else {
        console.log('✅ Expected cookies (PHPSESSID, pll_language) are present in the cookie string.');
    }
    // --- END Check for specific cookies ---


    try {
        // --- Direct Axios call for captcha ---
        const response = await axios.get(captchaUrl, {
            headers: explicitCaptchaHeaders,
            responseType: 'arraybuffer', // responseType: 'arraybuffer' for image
            timeout: 60000,
            maxRedirects: 5,
            // If using ScraperAPI for this specific call, configure it here
            // params: scraperApiKey ? { api_key: scraperApiKey, url: captchaUrl } : undefined,
            // url: scraperApiKey ? scraperApiEndpoint : captchaUrl, // Target ScraperAPI if key exists
        });
        // --- END Direct Axios call for captcha ---


        console.log('[Service] Captcha image status:', response.status);

         // Update cookies from this response (less likely for image requests to set significant cookies)
        const updatedCookies = mergeCookies(cookiesToSend, extractCookies(response.headers['set-cookie'])); // Merge with cookiesToSend
        console.log('[Service] Updated cookies after captcha request:', updatedCookies);

        // --- Basic validation if data looks like an image ---
        const contentType = response.headers["content-type"] || "image/png";
         if (!contentType.startsWith('image/')) {
             console.error(`🚨 WARNING: Received non-image content type for captcha: ${contentType}. Expected image/*.`);
             // Attempt to log non-image data preview
             try {
                 const responseText = Buffer.from(response.data).toString('utf8');
                 console.error('Non-image captcha response content preview (first 500 chars):', responseText.substring(0, 500));
             } catch(e) {
                 console.error('Could not convert non-image captcha data to string for preview.');
             }
             // Decide if this should throw an error or return null/error indicator
             throw new Error(`Received non-image data for captcha: ${contentType}`);
         }

        // --- Robust PNG signature check and data slicing with increased limit ---
        let imageData = response.data; // Start with the raw data
        const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]); // PNG signature bytes
        const searchLimit = Math.min(imageData.length, 2000); // Increased search limit to 2000 bytes

        if (imageData && Buffer.isBuffer(imageData) && imageData.length > 8) { // PNG signature is 8 bytes
            console.log("Total Captcha Image Data Length:", imageData.length, "bytes"); // Log total length
            let dataPreviewHex = imageData.slice(0, 16).toString('hex'); // Log first 16 bytes as hex
            console.log("Raw Captcha Image Data Preview (Hex):", dataPreviewHex + '...');

            let pngStartIndex = -1;
            // Look for the PNG signature within the increased search limit
            for (let i = 0; i <= searchLimit - pngSignature.length; i++) {
                if (imageData.slice(i, i + pngSignature.length).equals(pngSignature)) {
                    pngStartIndex = i;
                    break;
                }
            }

            if (pngStartIndex !== -1) {
                console.log(`🎉 Found PNG signature at offset ${pngStartIndex}. Slicing data.`);
                imageData = imageData.slice(pngStartIndex); // Slice the data
                console.log("Sliced Captcha Image Data Preview (Hex):", imageData.slice(0, 16).toString('hex') + '...');
                // No need to return here, the rest of the function uses the 'imageData' variable

            } else {
                 console.warn(`⚠️ Captcha image data does NOT contain PNG signature (89504e47) within the first ${searchLimit} bytes. Data might be corrupted or not a PNG.`);
                 // Log full response data as string if not a PNG
                 try {
                     const fullResponseText = Buffer.from(imageData).toString('utf8');
                     console.error("Full Captcha Response Data (String) when not PNG:", fullResponseText);
                 } catch(e) {
                     console.error("Could not convert full captcha response data to string for logging.");
                 }
                 throw new Error("Received data is not a valid PNG image.");
            }
        } else {
            console.log("Raw Captcha Image Data is empty or too short for PNG check.");
             if (imageData && Buffer.isBuffer(imageData)) {
                  try {
                     const fullResponseText = Buffer.from(imageData).toString('utf8');
                     console.error("Full Captcha Response Data (String) when empty/short:", fullResponseText);
                 } catch(e) {
                     console.error("Could not convert full captcha response data to string for logging.");
                 }
             }
            throw new Error("Received empty or invalid data for captcha.");
        }
        // --- END Robust PNG signature check and data slicing with increased limit ---

        // --- NEW: Convert sliced image data to Base64 ---
        const base64ImageData = imageData.toString('base64');
        console.log('[Service] Converted image data to Base64 string.');
        // --- END NEW ---


        return { imageData: base64ImageData, cookies: updatedCookies }; // Return the Base64 string

    } catch (error) {
        console.error('[Service] Error in getCaptchaImage:', error.message);
         if (error.response) {
             console.error("eCourts Response Status:", error.response.status);
             // Log response data for non-image requests if not already logged above
             if (!error.message.includes('Received non-image content type') && !error.message.includes('Captcha image data does NOT contain PNG signature')) {
                  try {
                     const errorResponseData = Buffer.from(error.response.data).toString('utf8');
                     console.error("eCourts Response Data:", errorResponseData);
                 } catch(e) {
                     console.error("Could not convert error response data to string.");
                     console.error("eCourts Response Data (Binary/Unknown):", error.response.data);
                 }
             }
         }
        throw new Error(`Failed to fetch captcha image: ${error.message}`);
    }
}


// --- Replicate Curl 5 (Search by Litigant Name etc.): Submit Case Search Form ---
async function submitCaseSearch(districtCourtBaseUrl, scid, token, captchaValue, searchParams, cookies) {
    console.log(`[Service] Submitting litigant search to: ${districtCourtBaseUrl}`);
    const url = `${districtCourtBaseUrl}/wp-admin/admin-ajax.php`; // Matching curl 5 URL
    const refererUrl = `${districtCourtBaseUrl}/case-status-search-by-petitioner-respondent/`;

    const params = new URLSearchParams();
    params.append('action', 'get_parties'); // Specific action for this search type
    params.append('es_ajax_request', '1');
    params.append('submit', 'Search');

    // Append search parameters provided by the user
    params.append('service_type', searchParams.service_type);
    params.append('est_code', searchParams.est_code);
    params.append('litigant_name', searchParams.litigant_name);
    params.append('reg_year', searchParams.reg_year);
    params.append('case_status', searchParams.case_status);

    // Append extracted scid and token name/value
    params.append('scid', scid);
    params.append(token.name, token.value); // Use the dynamic token name

    // Append the captcha value provided by the user
    params.append('siwp_captcha_value', captchaValue);

    const headersToForward = {
        ...ajaxHeaders, // Use common AJAX headers
        'Origin': districtCourtBaseUrl, // Origin is the district court base URL
        'Referer': refererUrl, // Referer is the search page
        'Cookie': cookies // Use cookies from previous steps
    };

    try {
        const response = await makeRequest('POST', url, params.toString(), headersToForward, 'json'); // responseType: 'json'

        console.log('[Service] Litigant search submit status:', response.status);

        // Update cookies from this response
        const updatedCookies = mergeCookies(cookies, extractCookies(response.headers['set-cookie']));
        console.log('[Service] Updated cookies after litigant search submit:', updatedCookies);

        // The response data should be the search results (often JSON)
        return { results: response.data, cookies: updatedCookies };

    } catch (error) {
        console.error('[Service] Error in submitCaseSearch (litigant):', error.message);
         if (error.response) {
             console.error("eCourts Response Status:", error.response.status);
             // Log response data for non-image requests
             try {
                 const errorResponseData = Buffer.from(error.response.data).toString('utf8');
                 console.error("eCourts Response Data:", errorResponseData);
             } catch(e) {
                 console.error("Could not convert error response data to string.");
                 console.error("eCourts Response Data (Binary/Unknown):", error.response.data);
             }
         }
        throw new Error(`Failed to submit litigant case search: ${error.message}`);
    }
}


// --- New Function (based on the new curl): Search by CIN ---
async function searchCaseByCin(districtCourtBaseUrl, cino, cookies) {
    console.log(`[Service] Submitting CIN search for CIN: ${cino} to: ${districtCourtBaseUrl}`);
    const url = `${districtCourtBaseUrl}/wp-admin/admin-ajax.php`; // Same URL as other searches
    const refererUrl = `${districtCourtBaseUrl}/case-status-search-by-petitioner-respondent/`; // Referer from the new curl

    const params = new URLSearchParams();
    params.append('cino', cino); // CIN value
    params.append('action', 'get_cnr_details'); // Specific action for CIN search
    params.append('es_ajax_request', '1'); // Always 1 for AJAX requests

    const headersToForward = {
        ...ajaxHeaders, // Use common AJAX headers
        'Origin': districtCourtBaseUrl, // Origin is the district court base URL
        'Referer': refererUrl, // Referer from the new curl
        'Cookie': cookies // Use cookies from previous steps
    };

    try {
        const response = await makeRequest('POST', url, params.toString(), headersToForward, 'json'); // responseType: 'json'

        console.log('[Service] CIN search submit status:', response.status);

        // Update cookies from this response
        const updatedCookies = mergeCookies(cookies, extractCookies(response.headers['set-cookie']));
        console.log('[Service] Updated cookies after CIN search submit:', updatedCookies);


        // The response data should be the search results for the CIN
        return { results: response.data, cookies: updatedCookies };

    } catch (error) {
        console.error('[Service] Error in searchCaseByCin:', error.message);
         if (error.response) {
             console.error("eCourts Response Status:", error.response.status);
             // Log response data for non-image requests
             try {
                 const errorResponseData = Buffer.from(error.response.data).toString('utf8');
                 console.error("eCourts Response Data:", errorResponseData);
             } catch(e) {
                 console.error("Could not convert error response data to string.");
                 console.error("eCourts Response Data (Binary/Unknown):", error.response.data);
             }
         }
        throw new Error(`Failed to submit CIN case search: ${error.message}`);
    }
}


module.exports = {
    getStatesAndDistrictLinks,
    getDistrictsForState,
    getCaseSearchPageData, // Needed for litigant search flow and possibly getting initial cookies for CIN search
    getCaptchaImage, // Only for litigant search flow
    submitCaseSearch, // Search by Litigant Name etc.
    searchCaseByCin // New function for search by CIN
};
