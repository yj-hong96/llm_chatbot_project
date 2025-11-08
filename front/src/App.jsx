// 메인/채팅 라우팅 + 대화 상태/저장 + 사이드바/드래그 정렬
// + 로딩/에러 모달 + 삭제/이름변경 모달 + 사이드바 토글
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import "./App.css";

const STORAGE_KEY = "chatConversations_v2";

// 사이드바 폭 설정값
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_INIT_WIDTH = 220;

// 새 대화(기본 인사 포함) 하나 생성
function createNewConversation() {
  const now = Date.now();
  return {
    id: String(now),
    title: "새 대화",
    createdAt: now,
    updatedAt: now,
    messages: [{ role: "bot", text: "안녕하세요! 무엇을 도와드릴까요?" }],
    folderId: null,
  };
}

// localStorage에서 대화 리스트 불러오기
function getInitialChatState() {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);

        // 새 구조 { conversations, folders, currentId }
        if (
          parsed &&
          Array.isArray(parsed.conversations) &&
          parsed.conversations.length > 0
        ) {
          const convs = parsed.conversations || [];
          const folders = parsed.folders || [];
          let currentId = parsed.currentId;
          if (!currentId || !convs.some((c) => c.id === currentId)) {
            currentId = convs[0].id;
          }
          return {
            conversations: convs,
            folders,
            currentId,
          };
        }

        // 예전 구조: 배열만 저장돼 있었던 경우
        if (Array.isArray(parsed) && parsed.length > 0) {
          const convs = parsed;
          return {
            conversations: convs,
            folders: [],
            currentId: convs[0].id,
          };
        }
      }
    } catch (e) {
      console.error("저장된 대화 목록을 불러오는 중 오류:", e);
    }
  }
  const conv = createNewConversation();
  return { conversations: [conv], folders: [], currentId: conv.id };
}

function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="page home-page">
      <header className="app-header">
        <div className="logo-box" onClick={() => window.location.reload()}>
          <h1 className="logo-text">챗봇</h1>
        </div>
      </header>

      <main className="home-main">
        <div className="hero-image">
          <img className="hero-bg" src="/img/homepage.jpg" alt="홈 배경" />
        </div>

        <button className="start-chat-btn" onClick={() => navigate("/chat")}>
          채팅 시작 하기
        </button>
      </main>
    </div>
  );
}

// 에러 텍스트 -> 한글 안내 + 해결책 + 상세정보
function makeErrorInfo(rawError) {
  const text =
    typeof rawError === "string" ? rawError : JSON.stringify(rawError, null, 2);

  let errorCode = null;
  const codeMatch =
    text.match(/Error code:\s*(\d{3})/) ||
    text.match(/"status"\s*:\s*(\d{3})/) ||
    text.match(/"statusCode"\s*:\s*(\d{3})/);
  if (codeMatch) {
    errorCode = codeMatch[1];
  }

  const base = { detail: text, code: errorCode };

  if (
    text.includes("tokens per minute") ||
    text.includes("TPM") ||
    text.includes("rate_limit_exceeded") ||
    text.includes("RateLimit") ||
    text.includes("Too Many Requests") ||
    (text.toLowerCase().includes("quota") &&
      text.toLowerCase().includes("token"))
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

  if (errorCode === "404" || text.includes("Not Found")) {
    return {
      ...base,
      code: errorCode || "404",
      title: "요청한 주소를 찾을 수 없습니다. (에러 코드: 404)",
      guide:
        "백엔드의 /chat 같은 엔드포인트 주소가 잘못되었거나, 서버에 해당 경로가 없습니다.",
      hint:
        "fetch에 사용한 URL(포트 번호 포함)과 Flask 라우트(@app.route('/chat'))가 정확히 일치하는지 확인해 주세요.",
    };
  }

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

// 첫 번째 사용자 메시지로 사이드바 제목 요약
function summarizeTitleFromMessages(messages) {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser || !firstUser.text) return "새 대화";
  const t = firstUser.text.trim();
  if (!t) return "새 대화";
  return t.length > 18 ? t.slice(0, 18) + "…" : t;
}

function ChatPage() {
  const navigate = useNavigate();

  const [chatState, setChatState] = useState(getInitialChatState);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorInfo, setErrorInfo] = useState(null);

  // 채팅용 더보기 메뉴
  const [menuOpenId, setMenuOpenId] = useState(null); // 열려있는 대화 ID
  const [menuPosition, setMenuPosition] = useState(null); // {x, y}
  const [menuInFolder, setMenuInFolder] = useState(false); // 폴더 안 대화인지 여부

  // 폴더용 더보기 메뉴
  const [folderMenuOpenId, setFolderMenuOpenId] = useState(null);
  const [folderMenuPosition, setFolderMenuPosition] = useState(null);

  const [confirmDelete, setConfirmDelete] = useState(null); // {id, title}
  const [renameInfo, setRenameInfo] = useState(null); // {id, value}

  const [confirmFolderDelete, setConfirmFolderDelete] = useState(null); // {id, name}
  const [folderCreateModalOpen, setFolderCreateModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderRenameInfo, setFolderRenameInfo] = useState(null); // {id, value}
  const [pendingFolderConvId, setPendingFolderConvId] = useState(null); // 새 폴더 생성 후 넣을 대화 ID

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // 선택된 폴더 id
  const [selectedFolderId, setSelectedFolderId] = useState(null);

  // 사이드바 폭 & 리사이즈 상태
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_INIT_WIDTH);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const sidebarResizeRef = useRef(null);

  // 드래그 상태
  const [draggingId, setDraggingId] = useState(null); // 채팅 드래그 중인 ID
  const [dragOverId, setDragOverId] = useState(null); // 채팅 위로 드래그 중
  
  const [dragOverFolderId, setDragOverFolderId] = useState(null); // 채팅을 폴더 위로 드래그
  const [folderDraggingId, setFolderDraggingId] = useState(null); // 폴더 드래그 중
  const [folderDragOverId, setFolderDragOverId] = useState(null); // 폴더 순서 변경용 드래그 오버

  // chatState 분해
  const conversations = chatState.conversations || [];
  const folders = chatState.folders || [];
  const currentId = chatState.currentId;
  const currentConv =
    conversations.find((c) => c.id === currentId) || conversations[0];
  const messages = currentConv ? currentConv.messages : [];

  // 대화 목록 + 폴더 저장
  useEffect(() => {
    try {
      const payload = {
        conversations,
        folders,
        currentId,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.error("대화 목록 저장 중 오류:", e);
    }
  }, [conversations, folders, currentId]);

  // 채팅창 끝으로 스크롤
  const messagesEndRef = useRef(null);
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }
  }, [messages, loading]);

  // 빈 곳 클릭 시 더보기 메뉴 닫기
  useEffect(() => {
    const handleWindowClick = () => {
      setMenuOpenId(null);
      setFolderMenuOpenId(null);
    };
    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  // 엔터키로 모달의 기본 동작(변경/삭제/예)을 수행
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== "Enter") return;

      if (confirmDelete) {
        e.preventDefault();
        handleDeleteConversation(confirmDelete.id);
        setConfirmDelete(null);
        return;
      }
      if (confirmFolderDelete) {
        e.preventDefault();
        handleDeleteFolder(confirmFolderDelete.id);
        setConfirmFolderDelete(null);
        return;
      }
      if (folderRenameInfo) {
        e.preventDefault();
        handleRenameFolderConfirm();
        return;
      }
      if (renameInfo) {
        e.preventDefault();
        handleRenameConversation(renameInfo.id, renameInfo.value);
        setRenameInfo(null);
        return;
      }
    };

    if (
      confirmDelete ||
      confirmFolderDelete ||
      folderRenameInfo ||
      renameInfo
    ) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [
    confirmDelete,
    confirmFolderDelete,
    folderRenameInfo,
    folderRenameInfo?.value,
    renameInfo,
    renameInfo?.value,
  ]);

  // Delete 키: 선택된 폴더 있으면 폴더 삭제 모달 / 없으면 현재 대화 삭제 모달
  useEffect(() => {
    const handleDeleteKey = (e) => {
      if (e.key !== "Delete") return;

      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable)
      ) {
        // 입력창에 포커스 있으면 무시
        return;
      }

      // 폴더가 선택돼 있으면 폴더 삭제 모달
      if (selectedFolderId) {
        const folder = folders.find((f) => f.id === selectedFolderId);
        if (!folder) return;
        setConfirmFolderDelete({ id: folder.id, name: folder.name });
        return;
      }

      // 그 외에는 현재 대화 삭제
      if (!currentConv) return;

      setConfirmDelete({
        id: currentConv.id,
        title: currentConv.title,
      });
    };

    window.addEventListener("keydown", handleDeleteKey);
    return () => window.removeEventListener("keydown", handleDeleteKey);
  }, [currentConv, selectedFolderId, folders]);

  // 사이드바 드래그 리사이즈
  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMouseMove = (e) => {
      const data = sidebarResizeRef.current;
      if (!data) return;
      const delta = e.clientX - data.startX;
      let nextWidth = data.startWidth + delta;

      if (nextWidth < SIDEBAR_MIN_WIDTH) nextWidth = SIDEBAR_MIN_WIDTH;
      if (nextWidth > SIDEBAR_MAX_WIDTH) nextWidth = SIDEBAR_MAX_WIDTH;

      setSidebarWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      sidebarResizeRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingSidebar]);

  const handleSidebarResizeMouseDown = (e) => {
    if (sidebarCollapsed) return;
    e.preventDefault();
    sidebarResizeRef.current = {
      startX: e.clientX,
      startWidth: sidebarWidth,
    };
    setIsResizingSidebar(true);
  };

  // 새 채팅 (루트) - 항상 맨 마지막에 추가
  const handleNewChat = () => {
    const newConv = createNewConversation();
    setChatState((prev) => {
      const prevList = prev.conversations || [];
      const newList = [...prevList, newConv]; // 맨 뒤에 추가
      return {
        ...prev,
        conversations: newList,
        currentId: newConv.id,
      };
    });
    setSelectedFolderId(null); // 폴더 선택 해제
    setErrorInfo(null);
    setInput("");
    setMenuOpenId(null);
    setFolderMenuOpenId(null);
  };

  // 특정 대화 선택
  const handleSelectConversation = (id) => {
    setChatState((prev) => ({
      ...prev,
      currentId: id,
    }));
    setSelectedFolderId(null); // 폴더 선택 해제
    setErrorInfo(null);
    setInput("");
    setMenuOpenId(null);
    setFolderMenuOpenId(null);
  };

    // 대화 삭제
    const handleDeleteConversation = (id) => {
      setChatState((prev) => {
        const list = prev.conversations || [];

        // 삭제하려는 대화가 현재 전체 목록에서 몇 번째인지
        const deleteIndex = list.findIndex((c) => c.id === id);

        // 실제로 삭제된 목록
        let filtered = list.filter((c) => c.id !== id);
        let newCurrentId = prev.currentId;

        if (filtered.length === 0) {
          // 남은 대화가 없으면 새 대화 하나 만들고 그걸 선택
          const newConv = createNewConversation();
          filtered = [newConv];
          newCurrentId = newConv.id;
        } else if (prev.currentId === id) {
          // 지금 보고 있던 대화를 삭제한 경우에만 포커스 이동

          // 1) 원래 삭제된 위치와 같은 위치에 있는 대화가 있으면 그걸 선택
          //    (아래에 있던 대화가 당겨져 올라온 자리)
          // 2) 없다면(마지막을 지운 경우) 맨 마지막(=바로 위에 있던) 대화를 선택
          const samePosIndex =
            deleteIndex >= 0 && deleteIndex < filtered.length
              ? deleteIndex
              : filtered.length - 1;

          newCurrentId = filtered[samePosIndex].id;
        }

        return {
          ...prev,
          conversations: filtered,
          currentId: newCurrentId,
        };
      });

      setMenuOpenId(null);
      setFolderMenuOpenId(null);
    };

  // 실제 이름 변경 로직 (대화)
  const handleRenameConversation = (id, newTitle) => {
    const trimmed = (newTitle || "").trim();
    if (!trimmed) return;

    setChatState((prev) => ({
      ...prev,
      conversations: (prev.conversations || []).map((c) =>
        c.id === id ? { ...c, title: trimmed, updatedAt: Date.now() } : c
      ),
    }));
    setMenuOpenId(null);
    setFolderMenuOpenId(null);
  };

  // 대화 삭제 모달 열기
  const openDeleteConfirmModal = (id, title) => {
    setConfirmDelete({ id, title });
    setMenuOpenId(null);
    setFolderMenuOpenId(null);
  };

  // 폴더 삭제 모달 열기
  const openFolderDeleteConfirmModal = (id, name) => {
    setConfirmFolderDelete({ id, name });
    setFolderMenuOpenId(null);
    setMenuOpenId(null);
  };

  // 대화 이름 변경 모달 열기
  const openRenameModal = (id, title) => {
    setRenameInfo({ id, value: title || "" });
    setMenuOpenId(null);
    setFolderMenuOpenId(null);
  };

  // 새 폴더 생성 버튼 클릭 → 모달 열기
  const handleCreateFolder = () => {
    setNewFolderName("");
    setFolderCreateModalOpen(true);
    setPendingFolderConvId(null);
  };

  // 새 폴더 생성 확정
  const handleCreateFolderConfirm = () => {
    const trimmed = (newFolderName || "").trim();
    if (!trimmed) return;

    const now = Date.now();
    const folderId = String(now);
    const newFolder = {
      id: folderId,
      name: trimmed,
      createdAt: now,
    };

    setChatState((prev) => {
      const nextFolders = [...(prev.folders || []), newFolder];
      let nextConversations = prev.conversations || [];

      if (pendingFolderConvId) {
        nextConversations = nextConversations.map((c) =>
          c.id === pendingFolderConvId ? { ...c, folderId } : c
        );
      }

      return {
        ...prev,
        folders: nextFolders,
        conversations: nextConversations,
      };
    });
    setFolderCreateModalOpen(false);
    setNewFolderName("");
    setPendingFolderConvId(null);
  };

  // 폴더 이름 변경 모달 열기
  const handleRenameFolder = (folderId) => {
    const target = folders.find((f) => f.id === folderId);
    setFolderRenameInfo({ id: folderId, value: target?.name || "" });
    setFolderMenuOpenId(null);
    setMenuOpenId(null);
  };

  // 폴더 이름 변경 확정
  const handleRenameFolderConfirm = () => {
    if (!folderRenameInfo) return;
    const trimmed = (folderRenameInfo.value || "").trim();
    if (!trimmed) return;

    setChatState((prev) => ({
      ...prev,
      folders: (prev.folders || []).map((f) =>
        f.id === folderRenameInfo.id ? { ...f, name: trimmed } : f
      ),
    }));
    setFolderRenameInfo(null);
  };

  // 폴더 삭제 (안의 채팅은 폴더 밖으로 이동)
  const handleDeleteFolder = (folderId) => {
    setChatState((prev) => ({
      ...prev,
      folders: (prev.folders || []).filter((f) => f.id !== folderId),
      conversations: (prev.conversations || []).map((c) =>
        c.folderId === folderId ? { ...c, folderId: null } : c
      ),
    }));
    setSelectedFolderId((prev) => (prev === folderId ? null : prev)); // 선택 해제
  };

  // 폴더 위로 드래그 중일 때 (채팅 or 폴더)
  const handleFolderDragOver = (e, folderId) => {
    e.preventDefault();
    if (folderDraggingId) {
      setFolderDragOverId(folderId);
    } else {
      setDragOverFolderId(folderId);
    }
  };

  // 폴더에 드롭 → (1) 폴더 순서 변경 or (2) 채팅을 폴더로 이동 (+ 폴더를 맨 위로)
  const handleFolderDrop = (e, folderId) => {
    e.preventDefault();

    if (folderDraggingId) {
      // 폴더 순서 변경 (fromIndex → toIndex 패턴)
      setChatState((prev) => {
        const list = [...(prev.folders || [])];
        const fromIndex = list.findIndex((f) => f.id === folderDraggingId);
        const toIndex = list.findIndex((f) => f.id === folderId);
        if (fromIndex === -1 || toIndex === -1) return prev;

        const [moved] = list.splice(fromIndex, 1);
        list.splice(toIndex, 0, moved);

        return { ...prev, folders: list };
      });

      setFolderDraggingId(null);
      setFolderDragOverId(null);
      setDragOverFolderId(null);
      return;
    }

    // 채팅을 폴더로 이동 (폴더 안→폴더, 채팅→폴더 모두)
    const convId = draggingId || e.dataTransfer.getData("text/plain");
    if (!convId) {
      setDraggingId(null);
      setDragOverId(null);
      setDragOverFolderId(null);
      return;
    }

    setChatState((prev) => {
      const nextConversations = (prev.conversations || []).map((c) =>
        c.id === convId ? { ...c, folderId } : c
      );

      // 채팅을 옮긴 폴더를 폴더 목록 맨 위로 이동
      const foldersCopy = [...(prev.folders || [])];
      const idx = foldersCopy.findIndex((f) => f.id === folderId);
      if (idx > 0) {
        const [f] = foldersCopy.splice(idx, 1);
        foldersCopy.unshift(f);
      }

      return {
        ...prev,
        conversations: nextConversations,
        folders: foldersCopy,
      };
    });

    setDraggingId(null);
    setDragOverId(null);
    setDragOverFolderId(null);
  };

  // 폴더 안 채팅을 폴더 밖(채팅 구역)으로 이동 (더보기 메뉴용)
  const handleMoveConversationToRoot = (id) => {
    setChatState((prev) => ({
      ...prev,
      conversations: (prev.conversations || []).map((c) =>
        c.id === id ? { ...c, folderId: null } : c
      ),
    }));
    setMenuOpenId(null);
    setFolderMenuOpenId(null);
  };

  // 드래그 시작 (폴더)
  const handleFolderItemDragStart = (e, folderId) => {
    setFolderDraggingId(folderId);
    setSelectedFolderId(folderId); // 드래그 시작 시 해당 폴더 선택
    setFolderDragOverId(null);
    setDragOverFolderId(null);
    setDraggingId(null);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", folderId);
  };

  const handleFolderItemDragEnd = () => {
    setFolderDraggingId(null);
    setFolderDragOverId(null);
    setDragOverFolderId(null);
  };

  // 드래그 시작 (채팅)
  const handleDragStart = (e, id) => {
    setDraggingId(id);
    setDragOverId(null);
    setDragOverFolderId(null);
    setFolderDraggingId(null);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (e, id) => {
    e.preventDefault();
    if (id !== dragOverId) {
      setDragOverId(id);
    }
  };

  // 채팅 아이템 위로 드롭 (채팅 구역) → 순서 변경 + 폴더 해제
  // 폴더 이동과 동일하게 fromIndex/toIndex 스왑 패턴 사용
  const handleDropOnRootItem = (e, targetConvId) => {
    e.preventDefault();
    e.stopPropagation();

    const convId = draggingId || e.dataTransfer.getData("text/plain");

    if (
      !convId ||
      convId === targetConvId ||
      !(conversations || []).some((c) => c.id === convId)
    ) {
      setDraggingId(null);
      setDragOverId(null);
      setDragOverFolderId(null);
      return;
    }

    setChatState((prev) => {
      const list = [...(prev.conversations || [])];
      const fromIndex = list.findIndex((c) => c.id === convId);
      const toIndex = list.findIndex((c) => c.id === targetConvId);
      if (fromIndex === -1 || toIndex === -1) return prev;

      const [movedRaw] = list.splice(fromIndex, 1);
      const moved =
        movedRaw.folderId !== null ? { ...movedRaw, folderId: null } : movedRaw;

      const newToIndex = list.findIndex((c) => c.id === targetConvId);
      const insertIndex = newToIndex === -1 ? list.length : newToIndex;

      list.splice(insertIndex, 0, moved);

      return { ...prev, conversations: list };
    });

    setDraggingId(null);
    setDragOverId(null);
    setDragOverFolderId(null);
  };

  // 폴더 안 채팅 위로 드롭 → 같은 폴더/다른 폴더로 이동 & 순서 변경
  const handleDropOnFolderChat = (e, targetConvId, folderId) => {
    e.preventDefault();
    e.stopPropagation();

    const convId = draggingId || e.dataTransfer.getData("text/plain");

    if (
      !convId ||
      convId === targetConvId ||
      !(conversations || []).some((c) => c.id === convId)
    ) {
      setDraggingId(null);
      setDragOverId(null);
      setDragOverFolderId(null);
      return;
    }

    setChatState((prev) => {
      const list = [...(prev.conversations || [])];
      const fromIndex = list.findIndex((c) => c.id === convId);
      const toIndex = list.findIndex((c) => c.id === targetConvId);
      if (fromIndex === -1 || toIndex === -1) return prev;

      const [movedRaw] = list.splice(fromIndex, 1);
      const moved = { ...movedRaw, folderId };

      const newToIndex = list.findIndex((c) => c.id === targetConvId);
      const insertIndex = newToIndex === -1 ? list.length : newToIndex;

      list.splice(insertIndex, 0, moved);

      return { ...prev, conversations: list };
    });

    setDraggingId(null);
    setDragOverId(null);
    setDragOverFolderId(null);
  };

  // 채팅 리스트 전체(빈 공간 포함)를 드롭존으로 → 맨 아래로 이동 + 폴더 해제
  const handleRootListDragOver = (e) => {
    e.preventDefault();
    setDragOverFolderId(null);
  };

  const handleRootListDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();

    // 폴더를 채팅 구역에 드롭하면 아무 일도 안 하도록
    if (folderDraggingId) {
      setFolderDraggingId(null);
      setFolderDragOverId(null);
      setDragOverFolderId(null);
      setDraggingId(null);
      setDragOverId(null);
      return;
    }

    const convId = draggingId || e.dataTransfer.getData("text/plain");
    if (!convId || !(conversations || []).some((c) => c.id === convId)) {
      setDraggingId(null);
      setDragOverId(null);
      setDragOverFolderId(null);
      return;
    }

    setChatState((prev) => {
      const list = [...(prev.conversations || [])];
      const fromIndex = list.findIndex((c) => c.id === convId);
      if (fromIndex === -1) return prev;

      const [movedRaw] = list.splice(fromIndex, 1);
      const moved =
        movedRaw.folderId !== null ? { ...movedRaw, folderId: null } : movedRaw;

      list.push(moved);
      return { ...prev, conversations: list };
    });

    setDraggingId(null);
    setDragOverId(null);
    setDragOverFolderId(null);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverId(null);
    setDragOverFolderId(null);
    setFolderDraggingId(null);
    setFolderDragOverId(null);
  };

  // Flask 서버로 질문 보내기
  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading || !currentConv) return;

    setErrorInfo(null);
    setInput("");
    setLoading(true);
    setMenuOpenId(null);
    setFolderMenuOpenId(null);

    setChatState((prev) => {
      const now = Date.now();
      const updated = (prev.conversations || []).map((conv) => {
        if (conv.id !== prev.currentId) return conv;
        const newMessages = [...conv.messages, { role: "user", text: trimmed }];

        const hasUserBefore = conv.messages.some((m) => m.role === "user");
        const newTitle = hasUserBefore
          ? conv.title
          : summarizeTitleFromMessages(newMessages);

        return {
          ...conv,
          messages: newMessages,
          updatedAt: now,
          title: newTitle,
        };
      });
      return { ...prev, conversations: updated };
    });

    try {
      const res = await fetch("http://127.0.0.1:5000/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: trimmed }),
      });

      const data = await res.json();
      console.log("test.py 응답:", data);

      if (data.error) {
        const info = makeErrorInfo(data.error);

        setChatState((prev) => {
          const now = Date.now();
          const updated = (prev.conversations || []).map((conv) => {
            if (conv.id !== prev.currentId) return conv;
            const newMessages = [
              ...conv.messages,
              {
                role: "bot",
                text:
                  "죄송합니다. 오류 때문에 지금은 답변을 생성하지 못했습니다. " +
                  "화면 가운데 나타난 오류 안내 창을 확인해 주세요.",
              },
            ];
            return { ...conv, messages: newMessages, updatedAt: now };
          });
          return { ...prev, conversations: updated };
        });

        setErrorInfo(info);
      } else {
        const answer = data.answer || "(응답이 없습니다)";
        setChatState((prev) => {
          const now = Date.now();
          const updated = (prev.conversations || []).map((conv) => {
            if (conv.id !== prev.currentId) return conv;
            const newMessages = [
              ...conv.messages,
              {
                role: "bot",
                text: answer,
              },
            ];
            return { ...conv, messages: newMessages, updatedAt: now };
          });
          return { ...prev, conversations: updated };
        });
      }
    } catch (err) {
      console.error("요청 실패:", err);
      const info = makeErrorInfo(err?.message || err);

      setChatState((prev) => {
        const now = Date.now();
        const updated = (prev.conversations || []).map((conv) => {
          if (conv.id !== prev.currentId) return conv;
          const newMessages = [
            ...conv.messages,
            {
              role: "bot",
              text:
                "서버에 연결하는 중 오류가 발생했습니다. 화면 가운데 오류 안내 창을 확인해 주세요.",
            },
          ];
          return { ...conv, messages: newMessages, updatedAt: now };
        });
        return { ...prev, conversations: updated };
      });

      setErrorInfo(info);
    } finally {
      setLoading(false);
    }
  };

  const handleInputKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // 오류 상세 새 창
  const openErrorDetailWindow = () => {
    if (!errorInfo) return;
    try {
      const win = window.open(
        "",
        "_blank",
        "width=720,height=600,scrollbars=yes"
      );
      if (!win) {
        alert(
          "팝업 차단으로 인해 새로운 창을 열 수 없습니다. 브라우저 팝업 설정을 확인해 주세요."
        );
        return;
      }

      const escapeHtml = (str) =>
        String(str)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

      win.document.write(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>오류 상세 정보</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif;
      padding: 16px;
      white-space: pre-wrap;
      background: #ffffff;
      color: #222;
    }
    h1 { font-size: 18px; margin-bottom: 8px; }
    h2 { font-size: 14px; margin-top: 16px; margin-bottom: 4px; }
    p  { margin: 4px 0; }
    pre {
      font-size: 12px;
      background: #f7f7f7;
      padding: 12px;
      border-radius: 8px;
      max-height: 420px;
      overflow-y: auto;
      overflow-x: hidden;
      white-space: pre-wrap;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(errorInfo.title)}</h1>
  <p>${escapeHtml(errorInfo.guide)}</p>
  <p style="color:#666;">${escapeHtml(errorInfo.hint)}</p>
  <h2>원본 오류 메시지</h2>
  <pre>${escapeHtml(errorInfo.detail)}</pre>
</body>
</html>`);
      win.document.close();
    } catch (e) {
      console.error("오류 상세 창 생성 중 오류:", e);
    }
  };

  // 폴더에 들어가지 않은 루트 채팅 목록
  const rootConversations = conversations.filter((c) => !c.folderId);

  // 전역 더보기용 활성 대화 / 폴더
  const activeMenuConversation = menuOpenId
    ? conversations.find((c) => c.id === menuOpenId)
    : null;
  const activeMenuFolder = folderMenuOpenId
    ? folders.find((f) => f.id === folderMenuOpenId)
    : null;

  return (
    <div className="page chat-page">
      {/* (현재는 기능 없음, 레이아웃 유지용) */}
      <button
        className="sidebar-toggle-btn"
        onClick={(e) => {
          e.stopPropagation();
          setSidebarOpen((prev) => !prev);
        }}
      ></button>

      <div className="chat-layout">
        {/* ===== 좌측: 사이드바 ===== */}
        <aside
          className={"chat-sidebar" + (sidebarCollapsed ? " collapsed" : "")}
          style={
            !sidebarCollapsed
              ? { flex: `0 0 ${sidebarWidth}px` }
              : undefined
          }
        >
          <div className="sidebar-top">
            {/* 햄버거 메뉴 아이콘 */}
            <button
              className="sidebar-menu-toggle"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
            >
              <img src="/img/menu.png" alt="사이드바 접기" />
            </button>

            {/* 펼쳐져 있을 때만 새 채팅 버튼 */}
            {!sidebarCollapsed && (
              <button className="sidebar-new-chat-btn" onClick={handleNewChat}>
                새 채팅
              </button>
            )}
          </div>

          {/* 펼쳐져 있을 때만 폴더/채팅 목록 */}
          {!sidebarCollapsed && (
            <>
              {/* ================== 폴더 섹션 ================== */}
              <div className="sidebar-section-title">폴더</div>

              <div className="sidebar-folder-list">
                {folders.length === 0 ? (
                  <div
                    className="sidebar-folder-empty"
                    onDragOver={(e) => {
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      // 폴더가 하나도 없을 때: 채팅을 끌어와 드롭하면 새 폴더 만들기 모달
                      e.preventDefault();
                      const convId =
                        draggingId || e.dataTransfer.getData("text/plain");
                      if (!convId) return;
                      setPendingFolderConvId(convId);
                      setFolderCreateModalOpen(true);
                    }}
                  >
                    폴더가 없습니다.
                  </div>
                ) : (
                  folders.map((folder) => {
                    const childConvs = conversations.filter(
                      (c) => c.folderId === folder.id
                    );
                    return (
                      <div
                        key={folder.id}
                        className={
                          "sidebar-folder-item" +
                          (selectedFolderId === folder.id ? " selected" : "") +
                          (folderDraggingId === folder.id ? " dragging" : "") +
                          (dragOverFolderId === folder.id ||
                          folderDragOverId === folder.id
                            ? " drag-over"
                            : "")
                        }
                        draggable
                        onDragStart={(e) =>
                          handleFolderItemDragStart(e, folder.id)
                        }
                        onDragOver={(e) => handleFolderDragOver(e, folder.id)}
                        onDrop={(e) => handleFolderDrop(e, folder.id)}
                        onDragEnd={handleFolderItemDragEnd}
                      >
                        <div
                          className="sidebar-folder-header"
                          onClick={(e) => {
                            e.stopPropagation();
                            // 폴더 클릭 → 선택만 (삭제는 Delete 키나 더보기 메뉴)
                            setSelectedFolderId(folder.id);
                          }}
                        >
                          <span className="sidebar-folder-name">
                            {folder.name}
                          </span>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            {childConvs.length > 0 && (
                              <span className="sidebar-folder-count">
                                {childConvs.length}
                              </span>
                            )}
                            <button
                              className="sidebar-chat-more"
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect =
                                  e.currentTarget.getBoundingClientRect();
                                const menuWidth = 160;
                                const viewportWidth =
                                  window.innerWidth ||
                                  document.documentElement.clientWidth;
                                const x = Math.min(
                                  rect.right,
                                  viewportWidth - menuWidth - 8
                                );
                                const y = rect.bottom + 4;
                                setFolderMenuPosition({ x, y });
                                setMenuOpenId(null); // 채팅 더보기 닫기
                                setFolderMenuOpenId((prev) =>
                                  prev === folder.id ? null : folder.id
                                );
                              }}
                            >
                              ⋯
                            </button>
                          </div>
                        </div>

                        {childConvs.length > 0 && (
                          <div className="sidebar-folder-chats">
                            {childConvs.map((conv) => {
                              const isDragging = draggingId === conv.id;
                              const isDragOver = dragOverId === conv.id;

                              return (
                                <div
                                  key={conv.id}
                                  className={
                                    "sidebar-folder-chat-row" +
                                    (isDragging ? " dragging" : "") +
                                    (isDragOver ? " drag-over" : "")
                                  }
                                  // 드롭 영역은 row에 유지
                                  onDragOver={(e) =>
                                    handleDragOver(e, conv.id)
                                  }
                                  onDrop={(e) =>
                                    handleDropOnFolderChat(
                                      e,
                                      conv.id,
                                      folder.id
                                    )
                                  }
                                >
                                  {/* 버튼 자체를 드래그 가능하게 */}
                                  <button
                                    className={
                                      "sidebar-folder-chat" +
                                      (conv.id === currentId ? " active" : "")
                                    }
                                    onClick={() =>
                                      handleSelectConversation(conv.id)
                                    }
                                    draggable
                                    onDragStart={(e) =>
                                      handleDragStart(e, conv.id)
                                    }
                                    onDragEnd={handleDragEnd}
                                  >
                                    {conv.title}
                                  </button>

                                  <button
                                    className="sidebar-chat-more"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const rect =
                                        e.currentTarget.getBoundingClientRect();
                                      const menuWidth = 160;
                                      const viewportWidth =
                                        window.innerWidth ||
                                        document.documentElement.clientWidth;
                                      const x = Math.min(
                                        rect.right,
                                        viewportWidth - menuWidth - 8
                                      );
                                      const y = rect.bottom + 4;
                                      setMenuPosition({ x, y });
                                      setMenuInFolder(true);
                                      setFolderMenuOpenId(null); // 폴더 더보기 닫기
                                      setMenuOpenId((prev) =>
                                        prev === conv.id ? null : conv.id
                                      );
                                    }}
                                  >
                                    ⋯
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}

                <button
                  className="sidebar-new-folder-btn"
                  onClick={handleCreateFolder}
                  // 채팅을 끌어서 +새 폴더 위에 드롭하면 새 폴더 만들기 모달
                  onDragOver={(e) => {
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const convId =
                      draggingId || e.dataTransfer.getData("text/plain");
                    if (!convId) return;
                    setPendingFolderConvId(convId);
                    setFolderCreateModalOpen(true);
                  }}
                >
                  + 새 폴더
                </button>
              </div>

              {/* ================== 채팅 섹션 ================== */}
              <div
                className="sidebar-chat-section"
                onDragOver={handleRootListDragOver}
                onDrop={handleRootListDrop}
              >
                <div className="sidebar-section-title">채팅</div>

                <div
                  className={
                    "sidebar-chat-list" +
                    (rootConversations.length > 20
                      ? " sidebar-chat-list-limit"
                      : "")
                  }
                  onDragOver={handleRootListDragOver}
                  onDrop={handleRootListDrop}
                >
                  {rootConversations.map((conv, idx) => {
                    const isActive = conv.id === currentId;
                    const isDragging = conv.id === draggingId;
                    const isDragOver = conv.id === dragOverId;

                    return (
                      <div
                        key={conv.id}
                        className={
                          "sidebar-chat-item" +
                          (isActive ? " active" : "") +
                          (isDragging ? " dragging" : "") +
                          (isDragOver ? " drag-over" : "")
                        }
                        draggable
                        onDragStart={(e) => handleDragStart(e, conv.id)}
                        onDragOver={(e) => handleDragOver(e, conv.id)}
                        onDrop={(e) => handleDropOnRootItem(e, conv.id)}
                        onDragEnd={handleDragEnd}
                      >
                        <button
                          className="sidebar-chat-main"
                          onClick={() => handleSelectConversation(conv.id)}
                        >
                          <span className="sidebar-chat-index">
                            {idx + 1}
                          </span>
                          <span className="sidebar-chat-title">
                            {conv.title}
                          </span>
                        </button>

                        <button
                          className="sidebar-chat-more"
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect =
                              e.currentTarget.getBoundingClientRect();
                            const menuWidth = 160;
                            const viewportWidth =
                              window.innerWidth ||
                              document.documentElement.clientWidth;
                            const x = Math.min(
                              rect.right,
                              viewportWidth - menuWidth - 8
                            );
                            const y = rect.bottom + 4;
                            setMenuPosition({ x, y });
                            setMenuInFolder(false);
                            setFolderMenuOpenId(null); // 폴더 더보기 닫기
                            setMenuOpenId((prev) =>
                              prev === conv.id ? null : conv.id
                            );
                          }}
                        >
                          ⋯
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* 사이드바 리사이즈 핸들 */}
          {!sidebarCollapsed && (
            <div
              className="sidebar-resize-handle"
              onMouseDown={handleSidebarResizeMouseDown}
            />
          )}
        </aside>

        {/* ===== 우측: 실제 챗봇 화면 ===== */}
        <div className="chat-shell">
          <header className="app-header chat-header">
            <div className="logo-box" onClick={() => navigate("/")}>
              <h1 className="logo-text small">챗봇</h1>
            </div>
          </header>

          <main className="chat-main">
            <div className="chat-container">
              <div className="chat-messages">
                {messages.map((m, idx) => (
                  <div
                    key={idx}
                    className={`message ${
                      m.role === "bot" ? "bot" : "user"
                    }`}
                  >
                    {m.text}
                  </div>
                ))}

                {loading && (
                  <div className="message bot loading-message">
                    <div className="loading-main-row">
                      <span className="loading-title">
                        챗봇이 답변을 준비하고 있어요
                      </span>
                      <span className="typing-dots">
                        <span className="dot" />
                        <span className="dot" />
                        <span className="dot" />
                      </span>
                    </div>
                    <div className="loading-subtext">
                      질문을 이해하고, 관련 데이터를 검색한 뒤 가장 알맞은
                      내용을 정리하고 있습니다.
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              <div className="chat-input-area">
                <input
                  className="chat-input"
                  type="text"
                  placeholder={
                    loading
                      ? "응답을 기다리는 중입니다..."
                      : "메시지를 입력하세요..."
                  }
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  disabled={loading}
                />
                <button
                  className="chat-send-btn"
                  onClick={sendMessage}
                  disabled={loading}
                >
                  <img
                    src="/img/trans_message.png"
                    alt="전송"
                    className="send-icon"
                  />
                </button>
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* ===== 전역 채팅 더보기 메뉴 ===== */}
      {activeMenuConversation && menuPosition && (
        <div
          className="sidebar-chat-menu"
          style={{
            top: menuPosition.y,
            left: menuPosition.x,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              openDeleteConfirmModal(
                activeMenuConversation.id,
                activeMenuConversation.title
              );
              setMenuOpenId(null);
            }}
          >
            대화 삭제
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openRenameModal(
                activeMenuConversation.id,
                activeMenuConversation.title
              );
              setMenuOpenId(null);
            }}
          >
            이름 변경하기
          </button>
          {menuInFolder && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleMoveConversationToRoot(activeMenuConversation.id);
                setMenuOpenId(null);
              }}
            >
              채팅 목록으로 이동
            </button>
          )}
        </div>
      )}

      {/* ===== 전역 폴더 더보기 메뉴 ===== */}
      {activeMenuFolder && folderMenuPosition && (
        <div
          className="sidebar-chat-menu"
          style={{
            top: folderMenuPosition.y,
            left: folderMenuPosition.x,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleRenameFolder(activeMenuFolder.id);
              setFolderMenuOpenId(null);
            }}
          >
            폴더 이름 변경
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openFolderDeleteConfirmModal(
                activeMenuFolder.id,
                activeMenuFolder.name
              );
              setFolderMenuOpenId(null);
            }}
          >
            폴더 삭제
          </button>
        </div>
      )}

      {/* ===== 대화 삭제 확인 모달 ===== */}
      {confirmDelete && (
        <div
          className="error-modal-overlay"
          onClick={(e) => {
            if (e.target.classList.contains("error-modal-overlay")) {
              setConfirmDelete(null);
            }
          }}
        >
          <div className="error-modal">
            <div className="error-modal-header">
              <span className="error-modal-title">대화 삭제</span>
            </div>
            <div className="error-modal-body">
              <p className="error-modal-guide">
                이 대화를 정말 삭제하시겠습니까? 삭제하면 되돌릴 수 없습니다.
              </p>
              <p className="error-modal-hint">
                대화 제목: {confirmDelete.title || "제목 없음"}
              </p>
            </div>
            <div className="error-modal-footer">
              <button
                className="error-modal-secondary"
                onClick={() => setConfirmDelete(null)}
              >
                아니요
              </button>
              <button
                className="error-modal-primary"
                onClick={() => {
                  handleDeleteConversation(confirmDelete.id);
                  setConfirmDelete(null);
                }}
              >
                예
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 폴더 삭제 확인 모달 ===== */}
      {confirmFolderDelete && (
        <div
          className="error-modal-overlay"
          onClick={(e) => {
            if (e.target.classList.contains("error-modal-overlay")) {
              setConfirmFolderDelete(null);
            }
          }}
        >
          <div className="error-modal">
            <div className="error-modal-header">
              <span className="error-modal-title">폴더 삭제</span>
            </div>
            <div className="error-modal-body">
              <p className="error-modal-guide">
                이 폴더를 정말 삭제하시겠습니까? 폴더 안의 채팅은 삭제되지
                않고 아래 &quot;채팅&quot; 목록으로 이동합니다.
              </p>
              <p className="error-modal-hint">
                폴더 이름: {confirmFolderDelete.name || "이름 없음"}
              </p>
            </div>
            <div className="error-modal-footer">
              <button
                className="error-modal-secondary"
                onClick={() => setConfirmFolderDelete(null)}
              >
                아니요
              </button>
              <button
                className="error-modal-primary"
                onClick={() => {
                  handleDeleteFolder(confirmFolderDelete.id);
                  setConfirmFolderDelete(null);
                }}
              >
                예
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 새 폴더 생성 모달 ===== */}
      {folderCreateModalOpen && (
        <div className="error-modal-overlay">
          <div className="error-modal">
            <div className="error-modal-header">
              <span className="error-modal-title">새 폴더 만들기</span>
            </div>
            <div className="error-modal-body">
              <p className="error-modal-guide">
                새 폴더의 이름을 입력해 주세요.
              </p>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreateFolderConfirm();
                  }
                }}
                style={{
                  width: "100%",
                  marginTop: "0.5rem",
                  padding: "0.45rem 0.6rem",
                  borderRadius: "0.5rem",
                  border: "1px solid #d1d5db",
                  fontSize: "0.85rem",
                  outline: "none",
                }}
              />
            </div>
            <div className="error-modal-footer">
              <button
                className="error-modal-secondary"
                onClick={() => {
                  setFolderCreateModalOpen(false);
                  setNewFolderName("");
                  setPendingFolderConvId(null);
                }}
              >
                취소
              </button>
              <button
                className="error-modal-primary"
                onClick={handleCreateFolderConfirm}
              >
                생성
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 폴더 이름 변경 모달 ===== */}
      {folderRenameInfo && (
        <div className="error-modal-overlay">
          <div className="error-modal">
            <div className="error-modal-header">
              <span className="error-modal-title">폴더 이름 변경</span>
            </div>
            <div className="error-modal-body">
              <p className="error-modal-guide">
                폴더의 새로운 이름을 입력해 주세요.
              </p>
              <input
                type="text"
                value={folderRenameInfo.value}
                onChange={(e) =>
                  setFolderRenameInfo((prev) => ({
                    ...prev,
                    value: e.target.value,
                  }))
                }
                style={{
                  width: "100%",
                  marginTop: "0.5rem",
                  padding: "0.45rem 0.6rem",
                  borderRadius: "0.5rem",
                  border: "1px solid #d1d5db",
                  fontSize: "0.85rem",
                  outline: "none",
                }}
              />
            </div>
            <div className="error-modal-footer">
              <button
                className="error-modal-secondary"
                onClick={() => setFolderRenameInfo(null)}
              >
                취소
              </button>
              <button
                className="error-modal-primary"
                onClick={handleRenameFolderConfirm}
              >
                변경
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 대화 이름 변경 모달 ===== */}
      {renameInfo && (
        <div className="error-modal-overlay">
          <div className="error-modal">
            <div className="error-modal-header">
              <span className="error-modal-title">대화 이름 변경</span>
            </div>
            <div className="error-modal-body">
              <p className="error-modal-guide">
                대화의 새로운 제목을 입력해 주세요.
              </p>
              <input
                type="text"
                value={renameInfo.value}
                onChange={(e) =>
                  setRenameInfo((prev) => ({
                    ...prev,
                    value: e.target.value,
                  }))
                }
                style={{
                  width: "100%",
                  marginTop: "0.5rem",
                  padding: "0.45rem 0.6rem",
                  borderRadius: "0.5rem",
                  border: "1px solid #d1d5db",
                  fontSize: "0.85rem",
                  outline: "none",
                }}
              />
            </div>
            <div className="error-modal-footer">
              <button
                className="error-modal-secondary"
                onClick={() => setRenameInfo(null)}
              >
                취소
              </button>
              <button
                className="error-modal-primary"
                onClick={() => {
                  handleRenameConversation(renameInfo.id, renameInfo.value);
                  setRenameInfo(null);
                }}
              >
                변경
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 가운데 에러 모달 ===== */}
      {errorInfo && (
        <div
          className="error-modal-overlay"
          onClick={(e) => {
            if (e.target.classList.contains("error-modal-overlay")) {
              setErrorInfo(null);
            }
          }}
        >
          <div className="error-modal">
            <div className="error-modal-header">
              <span className="error-modal-title">{errorInfo.title}</span>
              <button
                className="error-modal-close"
                onClick={() => setErrorInfo(null)}
              >
                ✕
              </button>
            </div>
            <div className="error-modal-body">
              <p className="error-modal-guide">{errorInfo.guide}</p>
              <p className="error-modal-hint">{errorInfo.hint}</p>
            </div>
            <div className="error-modal-footer">
              <button
                className="error-modal-secondary"
                onClick={() => setErrorInfo(null)}
              >
                닫기
              </button>
              <button
                className="error-modal-primary"
                onClick={openErrorDetailWindow}
              >
                원본 오류 상세 새 창에서 보기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/chat" element={<ChatPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
