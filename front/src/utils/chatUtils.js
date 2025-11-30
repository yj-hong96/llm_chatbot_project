// src/utils/chatUtils.js

// =========================================================
// ✅ 상수 정의
// localStorage 키와 기본 인사말 등을 한곳에서 관리합니다.
// =========================================================
export const STORAGE_KEY_CHAT = "chatConversations_v2";
export const STORAGE_KEY_VOICE = "voiceConversations_v1";
export const VOICE_GREETING_TEXT = "안녕하세요! 말씀해 주시면 듣고 대답해 드립니다.";

// =========================================================
// ✅ 날짜 포맷팅 함수
// 입력: timestamp (밀리초 단위의 숫자)
// 출력: "YYYY. MM. DD. HH:mm" 형식의 문자열
// 역할: 채팅방 목록이나 메시지 시간 표시에 사용됩니다.
// =========================================================
export function formatDateTime(timestamp) {
  if (!timestamp) return "-";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${year}. ${month}. ${day}. ${hour}:${min}`;
}

// =========================================================
// ✅ 초기 상태 로드 함수
// 입력: storageKey (localStorage 키 이름)
// 출력: { conversations, folders, currentId } 형태의 객체
// 역할: 페이지가 처음 로드될 때 브라우저 저장소에서 이전 대화 기록을 불러옵니다.
//       데이터가 없거나 오류가 나면 빈 상태를 반환합니다.
// =========================================================
export function getInitialChatState(storageKey) {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);

        // 신규 구조: 폴더 기능이 포함된 데이터인지 확인
        if (parsed && Array.isArray(parsed.conversations)) {
          const convs = parsed.conversations || [];
          const folders = parsed.folders || [];
          let currentId = parsed.currentId;

          // 현재 선택된 ID가 유효하지 않으면 첫 번째 대화로 설정
          if (
            convs.length > 0 &&
            (!currentId || !convs.some((c) => c.id === currentId))
          ) {
            currentId = convs[0].id;
          }
          return { conversations: convs, folders, currentId };
        }

        // 구버전 구조 호환: 배열만 저장되어 있는 경우 변환
        if (Array.isArray(parsed)) {
          const convs = parsed;
          return {
            conversations: convs,
            folders: [],
            currentId: convs.length > 0 ? convs[0].id : null,
          };
        }
      }
    } catch (e) {
      console.error("저장된 대화 목록을 불러오는 중 오류:", e);
    }
  }
  // 저장된 데이터가 없으면 초기값 반환
  return { conversations: [], folders: [], currentId: null };
}

// =========================================================
// ✅ 새 대화 생성 함수
// 입력: greetingText (첫 봇 메시지 내용)
// 출력: 새로운 대화 객체 (ID, 생성일, 기본 메시지 포함)
// 역할: '새 채팅' 버튼을 누르거나 초기 실행 시 기본 대화방을 만듭니다.
// =========================================================
export function createNewConversation(greetingText = "안녕하세요! 무엇을 도와드릴까요?") {
  const now = Date.now();
  return {
    id: String(now),
    title: "새 대화",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        role: "bot",
        text: greetingText,
      },
    ],
    folderId: null,
  };
}

// =========================================================
// ✅ 제목 요약 함수
// 입력: 메시지 배열
// 출력: 문자열 (요약된 제목)
// 역할: 사용자가 첫 질문을 입력했을 때, 그 내용을 바탕으로 채팅방 제목을 자동 생성합니다.
//       18글자가 넘어가면 '...'으로 줄입니다.
// =========================================================
export function summarizeTitleFromMessages(messages) {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser || !firstUser.text) return "새 대화";
  const t = firstUser.text.trim();
  if (!t) return "새 대화";
  return t.length > 18 ? t.slice(0, 18) + "…" : t;
}

// =========================================================
// ✅ 자동 스크롤 함수
// 입력: container (스크롤할 DOM 요소), clientY (마우스 Y 좌표)
// 역할: 드래그 앤 드롭 중 마우스가 리스트의 상단/하단 끝에 가면
//       자동으로 리스트를 스크롤해주는 UI 편의 기능입니다.
// =========================================================
export function autoScroll(container, clientY) {
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const margin = 36; // 감지 영역 크기
  const maxSpeed = 16; // 최대 스크롤 속도
  let dy = 0;

  if (clientY < rect.top + margin) {
    // 위쪽 영역: 위로 스크롤
    dy = -((rect.top + margin) - clientY) / (margin / maxSpeed);
  } else if (clientY > rect.bottom - margin) {
    // 아래쪽 영역: 아래로 스크롤
    dy = (clientY - (rect.bottom - margin)) / (margin / maxSpeed);
  }

  if (dy !== 0) {
    container.scrollTop += dy;
  }
}

// =========================================================
// ✅ 드래그 데이터 추출 함수들
// 입력: DragEvent
// 출력: ID 문자열
// 역할: 드래그 앤 드롭 이벤트 객체(DataTransfer)에서 채팅 ID나 폴더 ID를 안전하게 꺼냅니다.
// =========================================================
export function getDraggedChatId(e) {
  return (
    e.dataTransfer.getData("application/x-chat-id") ||
    e.dataTransfer.getData("text/x-chat-id") ||
    e.dataTransfer.getData("text/plain") ||
    ""
  );
}

export function getDraggedFolderId(e) {
  return (
    e.dataTransfer.getData("application/x-folder-id") ||
    e.dataTransfer.getData("text/x-folder-id") ||
    e.dataTransfer.getData("text/plain") ||
    ""
  );
}

// =========================================================
// ✅ 에러 정보 파싱 함수 (전체 로직 포함)
// 입력: rawError (에러 객체 또는 문자열)
// 출력: { title, guide, hint, detail, code } 객체
// 역할: API 호출 중 발생한 에러를 분석하여 사용자에게 친절한 안내 문구를 제공합니다.
//       HTTP 상태 코드(404, 500 등)나 특정 에러 메시지를 감지합니다.
// =========================================================
export function makeErrorInfo(rawError) {
  const text =
    typeof rawError === "string" ? rawError : JSON.stringify(rawError, null, 2);

  let errorCode = null;
  // 에러 메시지 텍스트에서 숫자 코드 추출 시도
  const codeMatch =
    text.match(/Error code:\s*(\d{3})/) ||
    text.match(/"status"\s*:\s*(\d{3})/) ||
    text.match(/"statusCode"\s*:\s*(\d{3})/);
  if (codeMatch) errorCode = codeMatch[1];

  const base = { detail: text, code: errorCode };

  // 1. 토큰 한도 초과 (Rate Limit)
  if (
    text.includes("tokens per minute") ||
    text.includes("TPM") ||
    text.includes("rate_limit_exceeded") ||
    text.includes("RateLimit") ||
    text.includes("Too Many Requests") ||
    (text.toLowerCase().includes("quota") && text.toLowerCase().includes("token"))
  ) {
    const code = errorCode || "429";
    return {
      ...base,
      code,
      title: `토큰 사용 한도를 초과했습니다. (에러 코드: ${code})`,
      guide:
        "짧은 시간에 너무 많은 토큰을 사용해서 제한에 걸렸습니다. 질문을 조금 줄이거나, 여러 번으로 나누어서 보내거나, 잠시 후 다시 시도해 주세요.",
      hint:
        "매우 긴 대화 전체를 한 번에 보내기보다, 꼭 필요한 부분만 요약해서 보내면 더 안정적으로 동작합니다.",
    };
  }

  // 2. 컨텍스트 길이 초과 (Too Large)
  if (
    text.includes("Request too large") ||
    text.includes("maximum context length") ||
    text.includes("context length exceeded")
  ) {
    const code = errorCode || "413";
    return {
      ...base,
      code,
      title: `요청 데이터가 너무 큽니다. (에러 코드: ${code})`,
      guide:
        "한 번에 전송하는 텍스트 또는 대화 길이가 모델이나 서버에서 허용하는 범위를 넘었습니다.",
      hint:
        "질문/대화를 여러 번으로 나누거나, 앞부분을 요약해서 보내 주세요. 불필요한 설명을 줄이고 핵심만 적으면 더 안정적으로 동작합니다.",
    };
  }

  // 3. 네트워크 연결 오류
  if (
    text.includes("Failed to fetch") ||
    text.includes("NetworkError") ||
    text.includes("ECONNREFUSED") ||
    text.includes("ENOTFOUND") ||
    text.includes("ERR_CONNECTION") ||
    text.toLowerCase().includes("timeout")
  ) {
    return {
      ...base,
      code: errorCode || "NETWORK",
      title: "서버와 통신하는 데 실패했습니다.",
      guide:
        "인터넷 연결 상태가 불안정하거나 서버에 일시적인 문제가 있을 수 있습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.",
      hint:
        "와이파이·유선 인터넷 연결을 확인하고, 회사/학교 네트워크라면 방화벽이나 VPN 설정도 함께 점검해 주세요.",
    };
  }

  // 4. 인증 실패 (401)
  if (errorCode === "401" || text.includes("Unauthorized")) {
    return {
      ...base,
      code: errorCode || "401",
      title: "인증에 실패했습니다. (에러 코드: 401)",
      guide:
        "필요한 API 키 또는 로그인 정보가 유효하지 않거나 만료되었습니다.",
      hint:
        "백엔드 서버의 환경변수(.env)에 설정된 API 키가 올바른지, 또는 로그인 세션이 유효한지 확인해 주세요.",
    };
  }

  // 5. 권한 없음 (403)
  if (errorCode === "403" || text.includes("Forbidden")) {
    return {
      ...base,
      code: errorCode || "403",
      title: "요청에 대한 권한이 없습니다. (에러 코드: 403)",
      guide:
        "해당 작업을 수행할 권한이 없는 계정으로 요청했거나, 권한 설정이 잘못되었습니다.",
      hint:
        "API 대시보드의 권한 범위를 확인하거나, 관리자에게 접근 권한을 요청해 주세요.",
    };
  }

  // 6. 찾을 수 없음 (404)
  if (errorCode === "404" || text.includes("Not Found")) {
    return {
      ...base,
      code: errorCode || "404",
      title: "요청한 주소를 찾을 수 없습니다. (에러 코드: 404)",
      guide:
        "백엔드의 /chat 같은 엔드포인트 주소가 잘못되었거나, 서버에 해당 경로가 없습니다.",
      hint:
        "fetch에 사용한 URL(포트 포함)과 Flask 라우트(@app.route('/chat'))가 정확히 일치하는지 확인해 주세요.",
    };
  }

  // 7. 잘못된 요청 (400)
  if (errorCode === "400" || text.includes("Bad Request")) {
    return {
      ...base,
      code: errorCode || "400",
      title: "요청 형식이 올바르지 않습니다. (에러 코드: 400)",
      guide:
        "서버가 이해할 수 없는 형식의 데이터를 보냈습니다. JSON 구조나 필수 필드가 빠져 있을 수 있습니다.",
      hint:
        "fetch에서 전송하는 body(JSON.stringify 부분)와 서버에서 기대하는 필드 이름이 일치하는지 확인해 주세요.",
    };
  }

  // 8. 시간 초과 (408)
  if (errorCode === "408") {
    return {
      ...base,
      code: "408",
      title: "요청 시간이 너무 오래 걸립니다. (에러 코드: 408)",
      guide:
        "서버가 지정된 시간 안에 응답하지 못했습니다. 일시적인 지연일 수 있습니다.",
      hint:
        "같은 요청을 여러 번 반복해서 보내지 말고, 잠시 기다렸다가 다시 시도해 보세요.",
    };
  }

  // 9. 데이터 크기 초과 (413 - 중복 체크)
  if (errorCode === "413") {
    return {
      ...base,
      code: "413",
      title: "요청 데이터가 너무 큽니다. (에러 코드: 413)",
      guide:
        "한 번에 전송하는 텍스트 또는 파일 크기가 서버에서 허용하는 범위를 넘었습니다.",
      hint:
        "질문이나 첨부 데이터를 나누어서 여러 번에 걸쳐 전송해 주세요.",
    };
  }

  // 10. 요청 빈도 초과 (429 - 중복 체크)
  if (errorCode === "429") {
    return {
      ...base,
      code: "429",
      title: "요청이 너무 자주 전송되었습니다. (에러 코드: 429)",
      guide:
        "짧은 시간에 너무 많은 요청을 보내서 서버의 제한에 걸렸습니다. 잠시 후 다시 시도해 주세요.",
      hint: "요청 간 간격을 늘리거나, 꼭 필요한 요청만 보내도록 조절해 주세요.",
    };
  }

  // 11. 서버 내부 오류 (500)
  if (errorCode === "500" || text.includes("Internal Server Error")) {
    return {
      ...base,
      code: errorCode || "500",
      title: "서버 내부에서 오류가 발생했습니다. (에러 코드: 500)",
      guide:
        "백엔드 코드나 외부 API에서 예기치 못한 예외가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      hint:
        "개발 중이라면 서버 콘솔 로그를 확인해 실제 스택트레이스를 살펴보는 것이 좋습니다.",
    };
  }

  // 12. 게이트웨이 오류 (502)
  if (errorCode === "502") {
    return {
      ...base,
      code: "502",
      title: "중간 게이트웨이 서버에서 오류가 발생했습니다. (에러 코드: 502)",
      guide:
        "백엔드 서버 또는 그 앞단의 프록시/게이트웨이가 정상적으로 응답하지 못했습니다.",
      hint:
        "클라우드 환경이라면 로드밸런서/프록시 설정과 백엔드 서버 상태를 함께 점검해 주세요.",
    };
  }

  // 13. 서비스 사용 불가 (503)
  if (errorCode === "503") {
    return {
      ...base,
      code: "503",
      title: "서버를 일시적으로 사용할 수 없습니다. (에러 코드: 503)",
      guide:
        "서버가 점검 중이거나 과부하 상태일 수 있습니다. 잠시 후 다시 시도해 주세요.",
      hint:
        "지속적으로 503이 발생한다면, 서버 인스턴스 수를 늘리거나 트래픽을 분산하는 방안을 고려해야 합니다.",
    };
  }

  // 14. 게이트웨이 타임아웃 (504)
  if (errorCode === "504") {
    return {
      ...base,
      code: "504",
      title: "서버 응답 시간이 초과되었습니다. (에러 코드: 504)",
      guide:
        "백엔드 서버에서 처리 시간이 너무 오래 걸려 게이트웨이에서 요청을 중단했습니다.",
      hint:
        "특정 요청에서만 반복된다면, 해당 요청의 처리 로직을 최적화하거나 타임아웃 시간을 조정해야 합니다.",
    };
  }

  // 기본값: 알 수 없는 오류
  return {
    ...base,
    title: errorCode
      ? `알 수 없는 오류가 발생했습니다. (에러 코드: ${errorCode})`
      : "알 수 없는 오류가 발생했습니다.",
    guide:
      "서버에서 예기치 못한 문제가 발생했습니다. 잠시 후 다시 시도하거나, 질문 내용을 조금 수정해서 보내 보세요.",
    hint:
      "계속 같은 오류가 반복된다면, 화면에 보이는 에러 코드와 함께 관리자에게 문의해 주세요.",
  };
}