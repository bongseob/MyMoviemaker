const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const url = require('url');
const { shell } = require('electron');
const { google } = require('googleapis');
const { VIDEO_EXTENSIONS, assertExistingFile, assertText, optionalText } = require('../lib/validation.cjs');

function registerYoutubeIpc({ ipcMain, app }) {
    let oauth2Client = null;
    let youtubeClientId = null;
    let youtubeClientSecret = null;
    const tokenPath = path.join(app.getPath('userData'), 'youtube-token.json');

    function clearToken() {
        if (fs.existsSync(tokenPath)) {
            fs.unlinkSync(tokenPath);
        }
    }

    function saveToken(token) {
        fs.writeFileSync(tokenPath, JSON.stringify({
            clientId: youtubeClientId,
            token
        }));
    }

    function loadToken(clientId) {
        if (!fs.existsSync(tokenPath)) {
            return null;
        }

        const saved = JSON.parse(fs.readFileSync(tokenPath));

        // Older app versions stored the raw token without the OAuth client id.
        // Do not reuse it because refresh tokens are bound to the client.
        if (!saved.clientId || saved.clientId !== clientId || !saved.token) {
            clearToken();
            return null;
        }

        return saved.token;
    }

    function isOAuthClientError(error) {
        const code = error?.code || error?.status || error?.response?.status;
        const reason = error?.response?.data?.error || error?.cause?.message || error?.message;

        return code === 401 && ['unauthorized_client', 'invalid_grant'].includes(reason);
    }

    function getUploadErrorMessage(error) {
        if (isOAuthClientError(error)) {
            clearToken();
            oauth2Client = null;
            return 'YouTube 인증 정보가 현재 Client ID/Secret과 맞지 않습니다. 저장된 토큰을 삭제했습니다. Google 로그인을 다시 진행해 주세요.';
        }

        return error instanceof Error ? error.message : String(error);
    }

    ipcMain.handle('youtube-logout', async () => {
        clearToken();
        oauth2Client = null;
        return { success: true, isAuthenticated: false };
    });

    ipcMain.handle('youtube-clear-token', async () => {
        clearToken();
        oauth2Client = null;
        return { success: true, isAuthenticated: false };
    });

    ipcMain.handle('youtube-setup-auth', async (_event, { clientId, clientSecret } = {}) => {
        const finalClientId = clientId || process.env.YOUTUBE_CLIENT_ID;
        const finalClientSecret = clientSecret || process.env.YOUTUBE_CLIENT_SECRET;

        if (!finalClientId || !finalClientSecret) {
            return { isAuthenticated: false, error: 'Missing Client ID or Secret' };
        }

        youtubeClientId = finalClientId;
        youtubeClientSecret = finalClientSecret;
        oauth2Client = new google.auth.OAuth2(
            finalClientId,
            finalClientSecret,
            'http://localhost:3000/callback'
        );

        const token = loadToken(finalClientId);
        if (token) {
            oauth2Client.setCredentials(token);
            return { isAuthenticated: true };
        }
        return { isAuthenticated: false };
    });

    ipcMain.handle('youtube-login', async () => {
        if (!youtubeClientId || !youtubeClientSecret) {
            throw new Error('OAuth2 Client not initialized. Call setup-auth first.');
        }

        return new Promise((resolve, reject) => {
            let settled = false;
            let expectedState = null;
            const server = http.createServer(async (req, res) => {
                try {
                    const requestUrl = new url.URL(req.url, `http://localhost:${server.address().port}`);
                    if (requestUrl.pathname !== '/callback') {
                        res.writeHead(404);
                        res.end('Not found');
                        return;
                    }

                    const code = requestUrl.searchParams.get('code');
                    const state = requestUrl.searchParams.get('state');
                    const error = requestUrl.searchParams.get('error');

                    if (error) {
                        throw new Error(`YouTube authorization failed: ${error}`);
                    }

                    if (!code || state !== expectedState) {
                        throw new Error('Invalid YouTube authorization callback.');
                    }

                    res.end('Authentication successful! You can close this window.');
                    server.close();
                    settled = true;

                    const { tokens } = await oauth2Client.getToken(code);
                    oauth2Client.setCredentials(tokens);
                    saveToken(tokens);
                    resolve({ success: true });
                } catch (error) {
                    res.statusCode = 400;
                    res.end('Authentication failed. You can close this window.');
                    server.close();
                    settled = true;
                    reject(error);
                }
            });

            server.on('error', reject);
            server.listen(0, '127.0.0.1', () => {
                const port = server.address().port;
                const redirectUri = `http://127.0.0.1:${port}/callback`;
                expectedState = crypto.randomBytes(24).toString('hex');

                oauth2Client = new google.auth.OAuth2(
                    youtubeClientId,
                    youtubeClientSecret,
                    redirectUri
                );

                const authUrl = oauth2Client.generateAuthUrl({
                    access_type: 'offline',
                    scope: ['https://www.googleapis.com/auth/youtube.upload'],
                    prompt: 'consent',
                    state: expectedState
                });

                shell.openExternal(authUrl);
            });

            setTimeout(() => {
                if (!settled) {
                    server.close();
                    reject(new Error('YouTube authorization timed out.'));
                }
            }, 5 * 60 * 1000);
        });
    });

    ipcMain.handle('youtube-upload', async (event, { videoPath, title, description, privacyStatus }) => {
        try {
            if (!oauth2Client) throw new Error('Not authenticated');
            const cleanVideoPath = assertExistingFile(videoPath, 'Video file', VIDEO_EXTENSIONS);
            const cleanTitle = assertText(title, 'Video title', 100);
            const cleanDescription = optionalText(description, 'Video description', 5000);
            const cleanPrivacyStatus = ['public', 'private', 'unlisted'].includes(privacyStatus) ? privacyStatus : 'private';

            const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
            const fileSize = fs.statSync(cleanVideoPath).size;

            return await new Promise((resolve, reject) => {
                youtube.videos.insert({
                    part: 'snippet,status',
                    requestBody: {
                        snippet: { title: cleanTitle, description: cleanDescription },
                        status: { privacyStatus: cleanPrivacyStatus }
                    },
                    media: {
                        body: fs.createReadStream(cleanVideoPath)
                    }
                }, {
                    onUploadProgress: (evt) => {
                        const progress = Math.round((evt.bytesRead / fileSize) * 100);
                        event.sender.send('youtube-upload-progress', progress);
                    }
                }, (err, res) => {
                    if (err) reject(err);
                    else resolve({ success: true, data: res.data });
                });
            });
        } catch (error) {
            console.error('Error uploading YouTube video:', error);
            return { success: false, error: getUploadErrorMessage(error), isAuthenticated: Boolean(oauth2Client) };
        }
    });
}

module.exports = { registerYoutubeIpc };
