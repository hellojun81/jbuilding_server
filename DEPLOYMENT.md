# 서버 전환 안내

## 필수 환경변수

`.env.example`을 참고해 운영 서버의 PM2 환경변수 또는 서버 전용 `.env`에 값을 설정한다.

- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `ADMIN_ID`, `ADMIN_PASSWORD`
- `CORS_ORIGINS`: 쉼표로 구분한 클라이언트 origin 목록
- `PORT`: 기본값 `8002`

메일 기능을 사용할 때만 `SMTP_USER`, `SMTP_APP_PASSWORD`, `MAIL_RECEIVER`를 설정한다.

## 배포 전 필수 작업

1. 기존 `lib/database.json`의 DB 비밀번호와 소스에 노출됐던 메일 앱 비밀번호를 폐기하고 새로 발급한다.
2. `lib/database.json`을 Git 추적 대상에서 제거하고 저장소 이력에 남은 비밀정보도 정리한다.
3. `migrations/001_bill_unique_key.sql` 상단의 중복 확인 쿼리를 먼저 실행한다.
4. 중복 데이터가 없다면 고유키 마이그레이션을 적용한다.
5. 클라이언트의 `REACT_APP_API_URL`과 서버의 `CORS_ORIGINS`가 실제 주소와 일치하는지 확인한다.

세션은 현재 서버 메모리에 저장되므로 PM2 재시작 시 다시 로그인해야 한다. 서버를 여러 대 운영할 경우 Redis 세션 저장소로 교체한다.
