const express = require("express");
const axios = require("axios");

const router = express.Router();

// --- ScraperAPI Configuration ---
const scraperApiKey = process.env.SCRAPERAPI_KEY;
const scraperApiEndpoint = 'http://api.scraperapi.com/';

if (!scraperApiKey) {
    console.warn('WARNING: SCRAPERAPI_KEY environment variable is not set. ScraperAPI will not be used for fetchCaptcha.');
}

router.post("/fetchCaptcha", async (req, res) => {
    try {
        const { selectedBench } = req.body;
        if (!selectedBench) {
            console.error('Validation Error: No bench selected for fetchCaptcha.');
            return res.status(400).json({ error: "No bench selected" });
        }

        req.session.selectedBench = selectedBench;

        const targetCaptchaUrl = "https://hcservices.ecourts.gov.in/hcservices/securimage/securimage_show.php";

        // --- ScraperAPI Integration Logic ---
        const scraperApiParams = {
            api_key: scraperApiKey,
            url: targetCaptchaUrl,
            // 'country_code': 'in', // Consider adding if needed
        };

        // --- Include initial eCourts cookies from session ---
        const initialCookies = req.session.initialEcourtsCookies || '';
        if (!initialCookies) {
             console.warn("⚠️ Initial eCourts cookies not found in session for fetchCaptcha. Request might be blocked.");
             // Based on the curl, these cookies are likely required.
             // Consider making this a fatal error:
             // return res.status(500).json({ error: "Initial eCourts cookies missing from session. Please run fetchBenches first." });
        }

        // Headers to be forwarded by ScraperAPI to the target captcha URL
        const headersToForward = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36', // Match curl
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5', // Added from curl
            'Accept-Encoding': 'gzip, deflate, br',
            'Referer': 'https://hcservices.ecourts.gov.in/',
            'Cookie': initialCookies, // <--- CRUCIAL: Include the initial cookies here
            'priority': 'i', // Added from curl
            'sec-ch-ua': '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"', // Added/Updated from curl
            'sec-ch-ua-mobile': '?0', // Added from curl
            'sec-ch-ua-platform': '"Windows"', // Added from curl
            'sec-fetch-dest': 'image', // Added from curl
            'sec-fetch-mode': 'no-cors', // Added from curl
            'sec-fetch-site': 'same-origin', // Added from curl
            'sec-gpc': '1', // Added from curl
        };

        const axiosConfig = {
            responseType: "arraybuffer", // Get raw binary data
            timeout: 45000,
        };

        let response;

        if (scraperApiKey) {
            console.log('Attempting to fetch captcha via ScraperAPI...');
            axiosConfig.params = scraperApiParams;
            axiosConfig.headers = headersToForward; // Headers for the request to ScraperAPI
            response = await axios.get(
                scraperApiEndpoint, // Request goes to ScraperAPI
                axiosConfig
            );
        } else {
            console.log('Attempting to fetch captcha directly (ScraperAPI key not set)...');
             axiosConfig.headers = headersToForward; // Headers for the direct request
             response = await axios.get(
                targetCaptchaUrl, // Request goes directly to target
                axiosConfig
            );
        }
        // --- End ScraperAPI Integration Logic ---

        console.log("--- ScraperAPI/Direct Captcha Response Details ---");
        console.log("Status:", response.status);
        console.log("Status Text:", response.statusText);
        console.log("Original Content-Type Header:", response.headers["content-type"]);
        console.log("Response Data Length:", response.data ? response.data.length : 'No data');
        console.log("Set-Cookie Header(s):", response.headers["set-cookie"]); // These will be the *new* captcha cookies

        // --- NEW: More detailed raw data logging AND slicing ---
        let responseData = response.data;
        let slicedData = responseData; // Start with original data

        if (responseData && Buffer.isBuffer(responseData) && responseData.length > 0) {
             const dataPreviewHex = responseData.slice(0, 64).toString('hex'); // Log original first 64 bytes as hex
             console.log("Raw Response Data Preview (Original Hex):", dataPreviewHex + '...');

             // Attempt to slice off the first 3 bytes (based on the 'e280b0' prefix observed)
             const sliceOffset = 3; // Number of bytes to slice off
             if (responseData.length > sliceOffset) {
                 slicedData = responseData.slice(sliceOffset);
                 const slicedDataPreviewHex = slicedData.slice(0, 64).toString('hex');
                 console.log(`Raw Response Data Preview (Sliced by ${sliceOffset} bytes, Hex):`, slicedDataPreviewHex + '...');

                 // Check if the sliced data starts with the PNG signature (89 50 4E 47)
                 if (slicedDataPreviewHex.startsWith('89504e47')) {
                     console.log("🎉 Sliced data starts with PNG signature! The issue was likely prepended bytes.");
                 } else {
                      console.warn("⚠️ Sliced data does NOT start with PNG signature. Slicing offset might be wrong, or data is still corrupted.");
                 }

             } else {
                 console.warn(`⚠️ Response data length (${responseData.length}) is too short to slice by ${sliceOffset} bytes.`);
             }

             // Also try logging a small portion as text, just in case it's an error message
             try {
                 const dataPreviewText = responseData.slice(0, 200).toString('utf8').replace(/[\r\n]+/g, ' '); // Log first 200 chars as text, cleaning newlines
                 console.log("Raw Response Data Preview (Original Text):", dataPreviewText + '...');
             } catch(e) {
                 console.log("Could not decode original raw data preview as text.");
             }
        } else {
            console.log("Raw Response Data is empty or not a Buffer.");
        }
        // --- END NEW ---


        // --- Strip charset from Content-Type for the response header ---
        let contentType = response.headers["content-type"] || "image/png";
        if (contentType.includes(';')) {
            contentType = contentType.split(';')[0].trim();
            console.log(`Cleaned Content-Type Header for Response: ${contentType}`);
        }

        if (!contentType.startsWith('image/')) {
            console.error(`🚨 WARNING: Received non-image content type: ${contentType}. Expected image/*.`);
            try {
                const responseText = Buffer.from(responseData).toString('utf8'); // Use original data for full preview
                console.error('Non-image response content preview (full):', responseText);
            } catch (bufferErr) {
                console.error('Could not convert non-image data to string for preview:', bufferErr);
            }
            return res.status(500).json({
                error: "Received non-image data for captcha. Target site might be blocking or returning an error page.",
                contentType: contentType
            });
        }

        // --- Capture and Store the NEW Captcha Cookies ---
        const setCookie = response.headers["set-cookie"] || [];
        const combinedCookies = setCookie.map((c) => c.split(";")[0]).join("; ");

        if (!combinedCookies) {
            console.warn("⚠️ No NEW cookies received from captcha response. This is unusual and might indicate a problem.");
        }

        // Store the NEW cookies from the captcha response in session for subsequent calls (like /api/case)
        req.session.captchaCookies = combinedCookies;

        req.session.save((err) => {
            if (err) {
                console.error("⚠️ Error saving session after fetchCaptcha:", err);
                // Decide if session save failure should prevent sending the image
                // For now, we'll proceed to send the image but log the error.
            }

            console.log("✅ Captcha Cookies Stored (for subsequent steps):", req.session.captchaCookies);

            // --- MODIFIED: Send the SLICED raw response data directly ---
            // Set the Content-Type header to match the image type
            res.setHeader("Content-Type", contentType);
            // Optional: Set cache-control headers to prevent browser caching
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");

            // Send the SLICED binary data as the response body
            res.send(slicedData); // <-- Sending the potentially sliced data
            // --- End MODIFIED ---
        });

    } catch (error) {
        console.error("Captcha fetch error:", error.message);
        if (error.response) {
            console.error('Error Response Status (from Axios):', error.response.status);
            try {
                 const errorResponseData = Buffer.from(error.response.data).toString('utf8');
                 console.error('Error Response Data Preview (from Axios):', errorResponseData); // Log full error response data
            } catch(bufferErr) {
                 console.error('Could not convert error response data to string:', bufferErr);
                 console.error('Error Response Data (Binary/Unknown):', error.response.data);
            }
            console.error('Error Response Headers (from Axios):', error.response.headers);
        } else if (error.code) {
            console.error('Network Error Code:', error.code);
            console.error('Network Error Message:', error.message);
        }
        res.status(500).json({ error: "Failed to fetch captcha", details: error.message });
    }
});

module.exports = router;
