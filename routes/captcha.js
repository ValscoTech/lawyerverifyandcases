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

        // --- Retrieve initial eCourts cookies from session (set by fetchBenches) ---
        // These are the general session cookies for ecourts.gov.in that fetchBenches acquired.
        const initialEcourtsCookies = req.session.initialEcourtsCookies || '';
        if (!initialEcourtsCookies) {
            console.warn("⚠️ Initial eCourts cookies not found in session for fetchCaptcha. This might be a problem if fetchBenches is a required preceding step.");
            // OPTION: If fetchBenches *must* always precede this, you can return an error here.
            // return res.status(400).json({ error: "Initial eCourts session not established. Please fetch benches first." });
        } else {
            console.log("✅ Using initial eCourts cookies for captcha request:", initialEcourtsCookies);
        }

        // Headers to be forwarded by ScraperAPI (or directly) to the target captcha URL
        const headersToForward = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Referer': 'https://hcservices.ecourts.gov.in/',
            'Cookie': initialEcourtsCookies, // <--- CRUCIAL: Send the initial cookies with the captcha request
            'priority': 'i',
            'sec-ch-ua': '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'image',
            'sec-fetch-mode': 'no-cors',
            'sec-fetch-site': 'same-origin',
            'sec-gpc': '1',
        };

        const axiosConfig = {
            responseType: "arraybuffer", // Get raw binary data
            timeout: 45000,
        };

        let response;
        if (scraperApiKey) {
            console.log('Attempting to fetch captcha via ScraperAPI...');
            axiosConfig.params = {
                api_key: scraperApiKey,
                url: targetCaptchaUrl,
                'country_code': 'in', // Consider adding if needed
            };
            axiosConfig.headers = headersToForward;
            response = await axios.get(
                scraperApiEndpoint,
                axiosConfig
            );
        } else {
            console.log('Attempting to fetch captcha directly (ScraperAPI key not set)...');
            axiosConfig.headers = headersToForward;
            response = await axios.get(
                targetCaptchaUrl,
                axiosConfig
            );
        }

        console.log("--- ScraperAPI/Direct Captcha Response Details ---");
        console.log("Status:", response.status);
        console.log("Status Text:", response.statusText);
        console.log("Original Content-Type Header:", response.headers["content-type"]);
        console.log("Response Data Length:", response.data ? response.data.length : 'No data');
        console.log("Set-Cookie Header(s):", response.headers["set-cookie"]);

        if (response.data && Buffer.isBuffer(response.data) && response.data.length > 0) {
            const dataPreviewHex = response.data.slice(0, 64).toString('hex');
            console.log("Raw Response Data Preview (Original Hex):", dataPreviewHex + '...');
            try {
                const dataPreviewText = Buffer.from(response.data.slice(0, 200)).toString('utf8').replace(/[\r\n]+/g, ' ');
                console.log("Raw Response Data Preview (Original Text):", dataPreviewText + '...');
            } catch(e) {
                console.log("Could not decode original raw data preview as text.");
            }
        } else {
            console.log("Raw Response Data is empty or not a Buffer.");
        }

        let contentType = response.headers["content-type"] || "image/png";
        if (contentType.includes(';')) {
            contentType = contentType.split(';')[0].trim();
            console.log(`Cleaned Content-Type Header for Base64: ${contentType}`);
        }

        if (!contentType.startsWith('image/')) {
            console.error(`🚨 WARNING: Received non-image content type: ${contentType}. Expected image/*.`);
            try {
                const responseText = Buffer.from(response.data).toString('utf8');
                console.error('Non-image response content preview (full):', responseText);
            } catch (bufferErr) {
                console.error('Could not convert non-image data to string for preview:', bufferErr);
            }
            return res.status(500).json({
                error: "Received non-image data for captcha. Target site might be blocking or returning an error page.",
                contentType: contentType
            });
        }

        const responseBuffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
        const base64Image = responseBuffer.toString("base64");

        // --- Capture and Store the NEW Cookies from the Captcha Response ---
        // These are the specific cookies issued by the captcha service,
        // which are likely required for the final case submission.
        const setCookieHeadersFromCaptcha = response.headers["set-cookie"] || [];
        const captchaSpecificCookies = setCookieHeadersFromCaptcha.map((c) => c.split(";")[0]).join("; ");

        if (!captchaSpecificCookies) {
            console.warn("⚠️ No NEW cookies received from captcha response. This is unusual and might indicate a problem for subsequent steps.");
            // If the captcha service doesn't issue a cookie, it's possible
            // that the initialEcourtsCookies are sufficient for api/case.
            // But if it *should* issue one, this is a flag.
            // For now, we'll proceed but log the warning.
            req.session.captchaCookies = req.session.initialEcourtsCookies || ''; // Fallback
        } else {
            // Store the NEW cookies from the captcha response in session for subsequent calls (like /api/case)
            req.session.captchaCookies = captchaSpecificCookies;
            console.log("✅ Captcha-specific Cookies Stored (for subsequent steps):", req.session.captchaCookies);
        }

        req.session.save((err) => {
            if (err) {
                console.error("⚠️ Error saving session after fetchCaptcha:", err);
            }
            res.json({
                sessionID: req.sessionID, // Your Express session ID
                captchaImage: `data:${contentType};base64,${base64Image}`,
                // You can optionally return the captcha-specific cookies here for debugging,
                // but they are primarily for server-side use in api/case
                // captchaCookies: req.session.captchaCookies
            });
        });

    } catch (error) {
        console.error("Captcha fetch error:", error.message);
        if (error.response) {
            console.error('Error Response Status (from Axios):', error.response.status);
            try {
                const errorResponseData = Buffer.from(error.response.data).toString('utf8');
                console.error('Error Response Data Preview (from Axios):', errorResponseData);
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
