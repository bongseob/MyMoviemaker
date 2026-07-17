# Windows PowerShell 포터블 실행파일 빌드 방법

이 문서는 Windows PowerShell에서 Electron 앱의 포터블 `.exe` 파일을 만드는 절차를 기록합니다.

## 기본 명령

PowerShell에서 `npm`을 직접 실행하면 `npm.ps1` 실행 정책 문제로 막힐 수 있습니다. 그럴 때는 `cmd /c`로 npm과 npx를 실행합니다.

```powershell
cmd /c "npm run build && npx electron-builder --win portable --x64"
```

이 명령은 다음 순서로 동작합니다.

1. `npm run build`로 TypeScript와 Vite 프로덕션 빌드를 실행합니다.
2. `npx electron-builder --win portable --x64`로 Windows x64 포터블 실행파일을 패키징합니다.

## PowerShell 전용 대안

`cmd /c`를 쓰지 않고 PowerShell에서 명령을 나누어 실행하려면 `.cmd` 파일을 명시합니다.

```powershell
npm.cmd run build
if ($LASTEXITCODE -eq 0) {
  npx.cmd electron-builder --win portable --x64
}
```

## 산출물 위치

빌드가 성공하면 `release` 폴더에 포터블 실행파일이 생성됩니다.

```text
release\AntigravityMovieMaker-0.0.0-windows-x64.exe
```

최신본을 고정된 이름으로 보관하려면 다음 명령으로 복사합니다.

```powershell
Copy-Item -LiteralPath "release\AntigravityMovieMaker-0.0.0-windows-x64.exe" -Destination "release\AntigravityMovieMaker-0.0.0-windows-x64-portable-latest.exe" -Force
```

## 자주 보이는 비치명 경고

다음 경고는 현재 프로젝트에서 포터블 실행파일 생성 자체를 막지 않는 것으로 봅니다.

- `description is missed in the package.json`
- `author is missed in the package.json`
- `default Electron icon is used`
- `cannot find path for dependency name=undefined reference=undefined`

포터블 패키징 단계는 출력 없이 오래 걸릴 수 있습니다. `building target=portable file=release\AntigravityMovieMaker-0.0.0-windows-x64.exe` 로그가 나온 뒤에도 몇 분 정도 더 걸릴 수 있습니다.
