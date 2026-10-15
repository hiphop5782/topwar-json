# CROSS100 결과 보관 서버

Node.js 18 이상만 있으면 별도 패키지 설치 없이 실행됩니다.

## 실행

PowerShell에서 환경 변수를 지정하고 서버를 시작합니다.

```powershell
$env:INGEST_TOKEN = "충분히-길고-임의적인-비밀값"
$env:HOST = "0.0.0.0"
$env:PORT = "8787"
$env:CORS_ORIGIN = "*"
npm start
```

결과는 기본적으로 `cross-pvp-data/latest.json` 하나에 저장됩니다. 새 결과를 받으면 이전
결과를 안전하게 교체합니다. 저장 위치는 `DATA_DIR`로 변경할 수 있습니다.

## 조사 결과 전송

1. [client/cross100-upload.js](client/cross100-upload.js)의 `API_URL`과 `API_TOKEN`을 서버에 맞게 바꿉니다.
2. 기존 CROSS100 조사 스크립트를 실행합니다.
3. 조사 중 또는 조사 완료 후 `client/cross100-upload.js`를 게임 개발자 콘솔에서 실행합니다.

조사 중 실행해도 완료될 때까지 기다린 뒤 전송합니다. 조사가 중단되었어도 한 명 이상의 결과가
있으면 부분 결과를 보관합니다. 기존 JSON 다운로드 동작은 그대로 유지됩니다.

다른 PC의 게임에서 이 서버에 접속하려면 `HOST=0.0.0.0`으로 실행하고 `API_URL`의
`127.0.0.1`을 서버 PC의 IP 또는 HTTPS 도메인으로 바꾸세요. 외부 인터넷에 공개할 때는 반드시
HTTPS 리버스 프록시를 두고 `INGEST_TOKEN`과 정확한 `CORS_ORIGIN`을 설정하세요.

## API

- `POST /api/cross-pvp/latest`: 최신 조사 결과 저장(기존 결과 교체)
- `GET /api/cross-pvp/latest`: 최신 조사 결과 조회
- `GET /health`: 상태 확인

보호된 API에는 `Authorization: Bearer <INGEST_TOKEN>` 헤더가 필요합니다.
