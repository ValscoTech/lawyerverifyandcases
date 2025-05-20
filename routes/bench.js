const express = require('express');
const axios = require('axios');
const querystring = require('querystring');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');

const router = express.Router();

function getSessionCookie(req) {
    return req.sessionID || null;
}

function parseBenchString(raw) {
    if (typeof raw !== 'string') {
        console.error('parseBenchString received non-string data:', raw);
        return [];
    }
    const parts = raw.split('#').filter(Boolean);
    return parts.map(chunk => {
        const [id, name] = chunk.split('~');
        return { id, name };
    });
}

const proxyHost = process.env.PROXY_HOST;
const proxyPort = process.env.PROXY_PORT;
const proxyUser = process.env.PROXY_USER;
const proxyPass = process.env.PROXY_PASS;

const proxyUrl = (proxyHost && proxyPort && proxyUser && proxyPass) ?
    `http://${encodeURIComponent(proxyUser)}:${encodeURIComponent(proxyPass)}@${proxyHost}:${proxyPort}` :
    null;

let httpsAgent = null;

if (proxyUrl) {
    httpsAgent = new HttpsProxyAgent(proxyUrl, {
        rejectUnauthorized: false // DANGER: Do not use in production!
    });
}

router.post('/fetchBenches', async (req, res) => {
    try {
        const { selectedHighcourt } = req.body;
        if (!selectedHighcourt) {
            return res.status(400).json({ error: 'No highcourt selected' });
        }

        req.session.selectedHighcourt = selectedHighcourt;
        // The combinedCookie from captchaCookies is still used for the initial bench fetch
        // because the 'cases_qry/index_qry.php' might still require some form of session.
        // If 'index_qry.php' sets new cookies, we'll capture them below.
        const combinedCookie = typeof req.session.captchaCookies === 'string' ? req.session.captchaCookies : '';

        const payload = querystring.stringify({
            action_code: 'fillHCBench',
            state_code: selectedHighcourt,
            appFlag: 'web'
        });

        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Cookie': combinedCookie, // Use existing cookies for this request
            'Accept': '*/*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept-Encoding': 'gzip, deflate, br',
        };

        const axiosConfig = {
            headers: headers,
            timeout: 45000,
        };

        if (httpsAgent) {
            axiosConfig.httpsAgent = httpsAgent;
            axiosConfig.proxy = false;
        }

        const response = await axios.post(
            'https://hcservices.ecourts.gov.in/hcservices/cases_qry/index_qry.php',
            payload,
            axiosConfig
        );

        console.log('Bench raw response status:', response.status);
        console.log('Bench raw response data preview:', String(response.data).substring(0, 200) + '...');

        // --- NEW: Capture Cookies from the Bench Fetch Response ---
        const setCookieHeaders = response.headers['set-cookie'] || [];
        const newCombinedCookies = setCookieHeaders.map((c) => c.split(';')[0]).join('; ');

        if (newCombinedCookies) {
            req.session.captchaCookies = newCombinedCookies; // Overwrite or set the session cookies
            req.session.save((err) => {
                if (err) {
                    console.error("⚠️ Error saving session after bench fetch:", err);
                    // Decide how to handle this error:
                    // Option 1: return res.status(500).json({ error: "Session save failed after bench fetch" });
                    // Option 2: Just log and continue, hoping the request still works.
                    // For now, we'll log and continue as it might not be critical for this specific step.
                } else {
                    console.log("✅ Cookies from Bench fetch stored:", req.session.captchaCookies);
                }
            });
        } else {
            console.warn("⚠️ No new cookies received from bench response. Retaining previous or using none.");
            // If no new cookies, the existing req.session.captchaCookies will persist.
        }

        const benches = parseBenchString(response.data);

        req.session.benches = benches;
        req.session.selectedBench = ''; // You might want to set this based on selection later

        res.json({
            benches: benches
        });
    } catch (error) {
        console.error('Error fetching benches:', error);
        if (process.env.NODE_ENV !== 'production' || error.code || error.syscall) {
            console.error('Full Error Details:', error);
            if (error.response) {
                console.error('Error Response Status:', error.response.status);
                console.error('Error Response Data Preview:', String(error.response.data).substring(0, 200) + '...');
                console.error('Error Response Headers:', error.response.headers);
            }
            res.status(500).json({
                error: 'Failed to fetch benches',
                details: error.message,
                code: error.code,
                syscall: error.syscall,
                address: error.address,
                port: error.port
            });
        } else {
            res.status(500).json({ error: 'Failed to fetch benches' });
        }
    }
});

module.exports = router;
