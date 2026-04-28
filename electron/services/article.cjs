const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const { chromium } = require('playwright');
const { getErrorMessage } = require('../lib/errors.cjs');
const { getOutputDir } = require('../lib/paths.cjs');
const { assertArticleData, assertText } = require('../lib/validation.cjs');

function buildCopyText(articleData) {
    const title = typeof articleData.title === 'string' ? articleData.title.trim() : '';
    const subtopics = Array.isArray(articleData.subtopics)
        ? articleData.subtopics.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    const hashtags = Array.isArray(articleData.hashtags)
        ? articleData.hashtags.map((item) => String(item || '').trim()).filter(Boolean)
        : [];

    return [
        title,
        '',
        ...subtopics.map((item) => `- ${item}`),
        '',
        hashtags.join(' ')
    ].join('\n').trim();
}

function registerArticleIpc({ ipcMain, app, isDev }) {
    // --- OpenAI Article Summarizer ---    
        
        
    ipcMain.handle('process-article', async (event, text) => {
        try {
            const articleText = assertText(text, 'Article text', 50000);
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) {
                throw new Error('OPENAI_API_KEY가 .env 파일에 설정되어 있지 않습니다.');
            }    
            const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';    
        
            const openai = new OpenAI({ apiKey });    
        
            const prompt = `    
    당신은 20년 경력의 인터넷신문 편집기자이다.    
    지자체에서 배포한 보도자료를 읽고 인터넷신문 기사 형식으로 재작성하라.    
    결과는 반드시 JSON 형식으로 응답해야 한다.    
        
    [기본 원칙]    
    - 기사 내용은 반드시 제공된 보도자료 내용만 사용한다    
    - 새로운 사실이나 추측을 추가하지 않는다    
    - 문장을 자연스럽게 다듬는 것만 허용된다    
    - 행정 홍보 문체를 언론 기사 문체로 정리한다    
        
    [출력 형식 (JSON 객체의 Key)]    
    - "title": [제목]    
    - "subtopics": [소주제 배열]    
    - "hashtags": [해시태그 배열]    
    - "summary": [요약기사]    
    - "content": [기사내용]

    - "copyText": [제목, 소주제, 해시태그를 복사하기 좋게 정리한 단일 문자열]

    - "revisionNotes": [수정 내역 배열]
        
    [제목 작성 규칙]    
    - 핵심 키워드 + 정책/사업 + 목적 구조로 작성    
    - 25~60자 사이 권장    
    - 클릭 유도형 문장 금지    
        
    [소주제 작성 규칙]    
    - 기사 핵심 내용을 3개로 정리    
    - 설명 문장이 아니라 주제 형태    
        
    [해시태그 규칙]    
    - 기사 핵심 키워드 3개 추출    
    - 마지막 태그는 반드시 #데일리메이커 (총 4개가 되어도 무방함)    
        
    [기사 작성 규칙]    
    - 첫 문장은 핵심 사실 전달    
    - 육하원칙 중심 작성    
    - 문단은 3~6개    
    - 홍보 문구는 최소화    
        
    [요약기사(summary) 작성 규칙]    
    - 400~420자    
    - 기사 핵심 내용을 간결하게 정리    
    - 마지막 문장은 반드시 "구독, 좋아요"로 끝낸다    
    - 주의: 요약기사 안에서는 "(구청장 박희영)" 등 직함 표기 문구를 반드시 제거한다.    
        
    [기사내용(content) 작성 규칙]    
    - 원문 보도자료의 직함 및 표기(예: "(구청장 박희영)", "박희영 용산구청장" 등)는 절대 제거하지 않고 반드시 기사내용에 포함시켜 유지한다.    
    - 요약기사에서 제거했던 직함이라도, 본문(content)에서는 반드시 포함하여 작성해야 한다.    
    - 단, 문맥상 자연스럽게 표현만 다듬는다.    
        
    [검증 단계]    
    각 항목별로 다음 규칙이 정확히 지켜졌는지 최종 확인하라:    
    1. 요약기사(summary): "(구청장 박희영)" 등 직함 표기 문구가 완전히 제거되었는가?    
    2. 기사내용(content): 원문의 직함 표기(예: "(구청장 박희영)")가 누락되지 않고 본문에 그대로 유지되었는가? (누락되었다면 다시 추가할 것)



    [복사용 텍스트(copyText) 작성 규칙]

    - 제목, 소주제, 해시태그를 하나의 문자열로 작성한다.

    - 제목 다음에는 빈 줄을 1개 삽입한다.

    - 소주제는 각 주제별로 줄을 분리한다.

    - 소주제 다음에는 빈 줄을 1개 삽입한다.

    - 해시태그는 마지막 한 줄에 공백으로 구분해 작성한다.



    [수정 내역(revisionNotes) 작성 규칙]

    - 원문을 기사로 바꾸며 실제로 정리한 내용을 3~5개 항목으로 작성한다.

    - 문체 변경, 문단 재구성, 중복 표현 정리, 직함 표기 처리, 해시태그 추출 등 구체적인 수정 사항을 적는다.
        
    [출력 규칙]    
    - 전체 결과는 지정된 JSON 형식의 코드 블록 하나로 작성한다    
    - 강조 표시(굵게 등)는 사용하지 않는다    
        
    보도자료 원문:
    ${articleText}
    `;
        
            const response = await openai.chat.completions.create({    
                model: model,    
                messages: [{ role: 'user', content: prompt }],    
                response_format: { type: "json_object" }    
            });    
        
            const jsonString = response.choices[0].message.content;    
            const parsedJson = JSON.parse(jsonString);
            parsedJson.copyText = buildCopyText(parsedJson);
            if (!Array.isArray(parsedJson.revisionNotes)) {
                parsedJson.revisionNotes = [];
            }
        
            // Auto-save logic    
            const baseDir = getOutputDir(app, isDev, 'articles');
        
            const date = new Date();    
            const timestamp = date.toISOString().replace(/[:.]/g, '').replace('T', '_').slice(0, 15);    
            const filename = `article_${timestamp}.json`;    
            const filePath = path.join(baseDir, filename);    
        
            fs.writeFileSync(filePath, JSON.stringify(parsedJson, null, 2), 'utf-8');    
        
            return { success: true, data: parsedJson, savedPath: filePath };    
        } catch (error) {
            console.error('Error processing article:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });
        
    // --- Playwright Article Publisher ---    
        
        
    ipcMain.handle('publish-article', async (event, articleData) => {
        try {
            articleData = assertArticleData(articleData);
            const adminId = process.env.ADMIN_USER_ID;
            const adminPw = process.env.ADMIN_USER_PW;
        
            if (!adminId || !adminPw || adminId === 'your_admin_id') {    
                throw new Error('관리자 아이디 또는 비밀번호가 .env 파일에 설정되지 않았습니다. .env 파일을 확인해 주세요.');    
            }    
        
            event.sender.send('publish-status', '브라우저를 열고 있습니다...');    
            const browser = await chromium.launch({ headless: false }); // 과정을 보여주기 위해 창을 띄움    
            const context = await browser.newContext();    
            const page = await context.newPage();    
        
            event.sender.send('publish-status', '로그인 페이지에 접속 중입니다...');    
            await page.goto('https://www.d-maker.kr/admin/adminLoginForm.html');    
                
            event.sender.send('publish-status', '로그인을 시도합니다...');    
            await page.fill('#user_id', adminId);    
            await page.fill('#user_pw', adminPw);    
                
            // 로그인 제출 후 페이지 이동 대기    
            await Promise.all([    
                page.waitForNavigation(),    
                page.click('button[type="submit"]')    
            ]);    
        
            event.sender.send('publish-status', '로그인 완료! 기사 등록 페이지로 이동합니다...');    
                
            // 3. 왼쪽 메뉴의 "기사등록" 누르기 (혹은 직접 URL 이동)    
            // 안전하게 URL로 직접 이동 (혹은 UI 클릭)    
            await page.goto('https://www.d-maker.kr/news/adminArticleWriteForm.html?mode=input');    
            await page.waitForLoadState('networkidle');    
        
            event.sender.send('publish-status', '기사 등록 폼에 내용을 채우고 있습니다...');    
        
            // 4. 데이터 입력    
            // 4-0. 1차 섹션 "뉴스" 자동 선택 (값: S1N1)    
            await page.selectOption('#sectionCode', 'S1N1');    
        
            // 4-1. 기사 제목    
            if (articleData.title) {    
                await page.fill('#title', articleData.title);    
            }    
        
            // 4-2. 부제목 (소주제 배열을 줄바꿈으로 연결하여 입력, 각 항목 앞에 '- ' 추가)    
            if (articleData.subtopics && articleData.subtopics.length > 0) {    
                const subTitleText = articleData.subtopics.map(t => `- ${t}`).join('\n');    
                await page.fill('#subTitle', subTitleText);    
            }    
        
            // 4-3. 키워드 (# 제외하고 하나씩 입력 후 스페이스바) - 먼저 입력    
            if (articleData.hashtags && articleData.hashtags.length > 0) {    
                const tagInputSelector = '.tagit-new input.ui-autocomplete-input';    
                await page.waitForSelector(tagInputSelector, { state: 'visible' });    
        
                for (let tag of articleData.hashtags) {    
                    const cleanTag = tag.replace(/^#/, '').trim();    
                    if (cleanTag) {    
                        await page.fill(tagInputSelector, cleanTag);    
                        await page.press(tagInputSelector, 'Space');    
                        await page.waitForTimeout(100); // UI 반영 대기    
                    }    
                }    
            }    
        
            // 4-4. 기사내용 (CKEditor 텍스트 붙여넣기 팝업 활용) - 가장 마지막에 입력    
            if (articleData.content) {    
                // 에디터가 완전히 로드되어 버튼이 활성화될 때까지 대기    
                await page.waitForSelector('.cke_button__pastetext:not(.cke_button_disabled)', { state: 'visible', timeout: 15000 });    
                    
                // "텍스트로 붙여넣기" 버튼 클릭    
                await page.click('.cke_button__pastetext');    
                    
                // 팝업 창의 iframe 대기 (cke_pasteframe 클래스 사용)    
                await page.waitForSelector('.cke_pasteframe', { state: 'visible' });    
                    
                // iframe 내의 body 요소에 기사 내용만 붙여넣기 (요약 기사 제외)    
                // 엔터(줄바꿈) 값이 완벽하게 유지되도록 Playwright의 insertText(실제 붙여넣기 에뮬레이션) 사용    
                const pasteFrame = page.frameLocator('.cke_pasteframe');    
                await pasteFrame.locator('body').focus();    
                await page.keyboard.insertText(articleData.content);    
                    
                // "확인" 버튼 클릭    
                try {    
                    await page.click('.cke_dialog_ui_button_ok');    
                } catch (_e) {
                    // 클릭 실패시 최후의 수단으로 title 기반 클릭
                    await page.locator('.cke_dialog a[title="확인"]').click();
                }
                    
                // 팝업이 닫힐 때까지 잠시 대기    
                await page.waitForSelector('.cke_pasteframe', { state: 'hidden' });    
                await page.waitForTimeout(500); // UI 반영 대기    
            }    
        
            event.sender.send('publish-status', '내용 입력 완료! 저장 버튼을 클릭합니다...');    
        
            // 저장 시 나타나는 alert 창(예: "등록되었습니다")을 자동으로 수락하도록 핸들러 등록    
            page.once('dialog', async dialog => {    
                console.log('Dialog message:', dialog.message());    
                await dialog.accept();    
            });    
        
            // 5. 저장하기 버튼 클릭    
            await page.click('button[type="submit"].nd-pink');    
                
            // 페이지 이동 또는 저장이 완료될 때까지 잠시 대기    
            await page.waitForTimeout(3000);    
        
            event.sender.send('publish-status', '기사 등록이 완료되었습니다!');    
            // 브라우저를 닫지 않고 유지 (사용자가 등록된 기사를 직접 확인할 수 있도록 함)    
            // await browser.close();    
        
            return { success: true, message: '어드민 페이지에 기사가 성공적으로 자동 등록되었습니다.' };    
        } catch (error) {
            console.error('Error publishing article:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });
}

module.exports = { registerArticleIpc };
