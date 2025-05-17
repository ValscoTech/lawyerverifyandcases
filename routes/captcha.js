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

        const scraperApiParams = {
            api_key: scraperApiKey,
            url: targetCaptchaUrl,
        };

        const headersToForward = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Referer': 'https://hcservices.ecourts.gov.in/',
        };

        const axiosConfigToScraperAPI = {
            params: scraperApiParams,
            headers: headersToForward,
            responseType: "arraybuffer",
            timeout: 45000,
        };

        let captchaResponse;

        if (scraperApiKey) {
            console.log('Attempting to fetch captcha via ScraperAPI...');
            captchaResponse = await axios.get(
                scraperApiEndpoint,
                axiosConfigToScraperAPI
            );
        } else {
            console.log('Attempting to fetch captcha directly (ScraperAPI key not set)...');
            captchaResponse = await axios.get(
                targetCaptchaUrl,
                { responseType: "arraybuffer", headers: headersToForward, timeout: 45000 }
            );
        }

        console.log("--- ScraperAPI/Direct Captcha Response Details ---");
        console.log("Status:", captchaResponse.status);
        console.log("Status Text:", captchaResponse.statusText);
        console.log("Original Content-Type Header:", captchaResponse.headers["content-type"]); // Log original
        console.log("Response Data Length:", captchaResponse.data ? captchaResponse.data.length : 'No data');
        console.log("Set-Cookie Header(s):", captchaResponse.headers["set-cookie"]);

        // --- MODIFIED PART: Strip charset from Content-Type ---
        let contentType = captchaResponse.headers["content-type"] || "image/png";
        if (contentType.includes(';')) {
            contentType = contentType.split(';')[0].trim(); // Take only the MIME type part
            console.log(`Cleaned Content-Type Header for Base64: ${contentType}`);
        }
        // --- END MODIFIED PART ---

        if (!contentType.startsWith('image/')) {
            console.error(`🚨 WARNING: Received non-image content type: ${contentType}. Expected image/*.`);
            try {
                const responseText = Buffer.from(captchaResponse.data).toString('utf8');
                console.error('Non-image response content preview (first 500 chars):', responseText.substring(0, 500));
            } catch (bufferErr) {
                console.error('Could not convert non-image data to string for preview:', bufferErr);
            }
            return res.status(500).json({ 
                error: "Received non-image data for captcha. Target site might be blocking or returning an error page.",
                contentType: contentType 
            });
        }

        const base64Image = Buffer.from(captchaResponse.data, "binary").toString("base64");

        const setCookie = captchaResponse.headers["set-cookie"] || [];
        const combinedCookies = setCookie.map((c) => c.split(";")[0]).join("; ");

        if (!combinedCookies) {
            console.warn("⚠️ No cookies received from captcha response. This is often required for subsequent requests.");
            return res.status(500).json({ error: "Failed to fetch captcha cookies. It's possible the request was blocked." });
        }

        req.session.captchaCookies = combinedCookies;
        req.session.save((err) => {
            if (err) {
                console.error("⚠️ Error saving session:", err);
                return res.status(500).json({ error: "Session save failed" });
            }

            console.log("✅ Captcha Cookies Stored:", req.session.captchaCookies);

            res.json({
                sessionID: req.sessionID,
                captchaImage: `data:${contentType};base64,${base64Image}`, // Use cleaned contentType
            });
        });
    } catch (error) {
        console.error("Captcha fetch error:", error.message);
        if (error.response) {
            console.error('Error Response Status (from Axios):', error.response.status);
            console.error('Error Response Data Preview (from Axios):', String(error.response.data).substring(0, 500) + '...');
            console.error('Error Response Headers (from Axios):', error.response.headers);
        } else if (error.code) {
            console.error('Network Error Code:', error.code);
            console.error('Network Error Message:', error.message);
        }
        res.status(500).json({ error: "Failed to fetch captcha", details: error.message });
    }
});

module.exports = router;
