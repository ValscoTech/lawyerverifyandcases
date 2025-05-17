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
             // If the curl works WITH these cookies, they are likely required.
             // Consider making this a fatal error:
             // return res.status(500).json({ error: "Initial eCourts cookies missing from session. Please run fetchBenches first." });
        }

        // Headers to be forwarded by ScraperAPI to the target captcha URL
        // These mimic a browser request and include the necessary cookies and other curl headers.
        const headersToForward = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36', // Updated User-Agent to match curl
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
            responseType: "arraybuffer",
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

        // --- NEW: Log a preview of the raw binary data ---
        if (response.data && response.data.length > 0) {
             const dataPreview = response.data.slice(0, 50).toString('hex') + '...'; // Log first 50 bytes as hex
             console.log("Raw Response Data Preview (Hex):", dataPreview);
        }
        // --- END NEW ---


        // --- Strip charset from Content-Type ---
        let contentType = response.headers["content-type"] || "image/png";
        if (contentType.includes(';')) {
            contentType = contentType.split(';')[0].trim();
            console.log(`Cleaned Content-Type Header for Base64: ${contentType}`);
        }

        if (!contentType.startsWith('image/')) {
            console.error(`🚨 WARNING: Received non-image content type: ${contentType}. Expected image/*.`);
            try {
                const responseText = Buffer.from(response.data).toString('utf8');
                console.error('Non-image response content preview (first 500 chars):', responseText.substring(0, 500));
            } catch (bufferErr) {
                console.error('Could not convert non-image data to string for preview:', bufferErr);
            }
            return res.status(500).json({
                error: "Received non-image data for captcha. Target site might be blocking or returning an error page.",
                contentType: contentType
            });
        }

        // Ensure data is a Buffer before converting to Base64
        const responseBuffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
        const base64Image = responseBuffer.toString("base64");


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
                return res.status(500).json({ error: "Session save failed after fetching captcha" });
            }

            console.log("✅ Captcha Cookies Stored (for subsequent steps):", req.session.captchaCookies);

            // Send the Base64 image in the JSON response
            res.json({
                sessionID: req.sessionID, // Your Express session ID
                captchaImage: `data:${contentType};base64,${base64Image}`, // Use cleaned contentType
            });
        });

    } catch (error) {
        console.error("Captcha fetch error:", error.message);
        if (error.response) {
            console.error('Error Response Status (from Axios):', error.response.status);
            try {
                 const errorResponseData = Buffer.from(error.response.data).toString('utf8');
                 console.error('Error Response Data Preview (from Axios):', errorResponseData.substring(0, 500) + '...');
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
