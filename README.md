# Antigravity Movie Maker

![Application Preview](./screenshots/app_preview.png)

이미지와 오디오를 결합하여 고품질 MP4 영상을 생성하는 Electron 기반 데스크톱 애플리케이션입니다.

## 주요 기능
- **미디어 관리**: 다중 이미지 업로드 및 오디오(MP3) 연동
- **렌더링 엔진**: 고성능 FFmpeg 기반 비디오 인코딩
- **UI/UX**: 최신 글래스모피즘(Glassmorphism) 테마 및 다크 모드
- **자동 동기화**: 영상의 길이를 오디오 길이에 맞춰 자동 조절

## 사용 방법
1. **의존성 설치**: `npm install`
2. **개발 서버 시작**: `npm run dev`
3. **Electron 앱 실행**: `npm run electron:dev`

## FFmpeg 인코딩 설정 (Technical Specs)
이 프로젝트에서 사용된 핵심 FFmpeg 옵션 및 필터 설정은 다음과 같습니다:

### 1. 비디오 필터 구성 (`filter_complex`)
- **Concat**: `[v:0][v:1]...concat=n={count}:v=1:a=0[v1]` - 여러 장의 이미지를 하나의 비디오 스트림으로 연결합니다.
- **Scaling/Padding**: `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2` - 이미지의 비율을 유지하며 화면을 채우고, 부족한 부분은 검은색 여백(Letterbox)으로 처리합니다.
- **Pixel Format**: `format=yuv420p` - 다양한 재생 기기와의 호환성을 보장합니다.

### 2. 오디오 처리
- **Codec**: `aac` - 고품질 오디오 압축을 위해 사용됩니다.
- **Mapping**: 영상 필터 출력(`[vout]`)과 오디오 필터 출력(`[aout]`)을 명시적으로 매핑하여 스트림 누락을 방지합니다.

### 3. 출력 제어 옵션
- **Duration Control**: `-t {duration}` - `ffprobe-static`으로 측정된 오디오 길이를 기반으로 영상의 끝을 정확히 지정합니다.
- **Shortest**: `-shortest` - 오디오나 영상 중 짧은 스트림을 기준으로 최종 파일을 마감하여 싱크 문제를 해결합니다.
- **Video Codec**: `libx264` - 가장 대중적인 고효율 비디오 코덱을 사용합니다.

## 기술 스택
- **Frontend**: React 19, Vite 7, Tailwind CSS v4, Lucide React
- **Backend**: Electron 40, FFmpeg (via fluent-ffmpeg), ffmpeg-static, ffprobe-static

## FFmpeg 명령어 발전 기록
- **자막이 추가된 옵션값 (한글 깨짐)**
```bash
FFmpeg started: ffmpeg -loop 1 -i C:\Users\USER\Downloads\112.png -i C:\Users\USER\Downloads\111.mp3 -y -filter_complex [0:v]null[v1]; [v1]drawtext=fontfile='C\\:/Windows/Fonts/malgun.ttf':text='?닿쾬? ?붾㈃???먮쭑?낅땲??':fontcolor=white:fontsize=80:x=(w-text_w)/2:y=h-th-150:borderw=3:bordercolor=black[vtext]; [vtext]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=yuv420p[vout]; [1:a]anull[aout] -acodec aac -vcodec libx264 -t 37.8 -map [vout] -map [aout] -pix_fmt yuv420p -t 37.8 -shortest C:\Users\USER\Downloads\output.mp4
```

- **자막의 세로 정렬, 한 줄 길이 계산 후 줄 바꿈 처리 (한글)**
```bash
FFmpeg started: ffmpeg -loop 1 -i C:\Users\USER\Downloads\112.png -i C:\Users\USER\Downloads\111.mp3 -y -filter_complex [0:v]null[v1]; [v1]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=yuv420p[vscaled]; [vscaled]drawtext=fontfile='C\:/Windows/Fonts/malgun.ttf':text='?곕━???먮옉?ㅻ윴 ???誘쇨뎅??臾닿턿??諛쒖ㄽ??琉쇳빐???щ윭 ?좎벖??':fontcolor=white:fontsize=100:x=(w-text_w)/2:y=(h-th)/2:borderw=4:bordercolor=black:fix_bounds=true:text_align=center:line_spacing=20[vout]; [1:a]anull[aout] -acodec aac -vcodec libx264 -t 37.8 -map [vout] -map [aout] -pix_fmt yuv420p -t 37.8 -shortest C:\Users\USER\Downloads\output.mp4
```
