// src/pages/VoiceChatPage.jsx
import { useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";

import ChatHeader from "../components/chat/ChatHeader.jsx";
import ChatMessages from "../components/chat/ChatMessages.jsx";

const STORAGE_KEY = "voiceConversations_v1";
const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5000";

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_INIT_WIDTH = 220;

// ---------------------------------------------------------
// 유틸: 날짜 포맷팅 (YYYY. MM. DD. HH:mm)
// ---------------------------------------------------------
function formatDateTime(timestamp) {
  if (!timestamp) return "-";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${year}. ${month}. ${day}. ${hour}:${min}`;
}

// ---------------------------------------------------------
// 유틸: 새 음성 대화(기본 인사 포함) 생성
// ---------------------------------------------------------
function createNewConversation() {
  const now = Date.now();
  return {
    id: String(now),
    title: "새 음성 대화",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        role: "bot",
        text: "안녕하세요! 말씀해 주시면 듣고 대답해 드립니다.",
      },
    ],
    folderId: null,
  };
}

// ---------------------------------------------------------
// 유틸: 초기 상태 로드(localStorage 호환)
// ---------------------------------------------------------
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
          return { conversations: convs, folders, currentId };
        }

        // 예전 구조: 배열만 저장돼 있었던 경우
        if (Array.isArray(parsed) && parsed.length > 0) {
          const convs = parsed;
          return { conversations: convs, folders: [], currentId: convs[0].id };
        }
      }
    } catch (e) {
      console.error("저장된 음성 대화 목록을 불러오는 중 오류:", e);
    }
  }
  // 저장된 게 없거나 오류 시 새 대화 1개 생성하여 리턴
  const conv = createNewConversation();
  return { conversations: [conv], folders: [], currentId: conv.id };
}

// ---------------------------------------------------------
// 에러 텍스트 파싱 → 사용자 친화적 안내 (ChatPage와 동일)
// ---------------------------------------------------------
function makeErrorInfo(rawError) {
  const text =
    typeof rawError === "string" ? rawError : JSON.stringify(rawError, null, 2);

  let errorCode = null;
  const codeMatch =
    text.match(/Error code:\s*(\d{3})/) ||
    text.match(/"status"\s*:\s*(\d{3})/) ||
    text.match(/"statusCode"\s*:\s*(\d{3})/);
  if (codeMatch) errorCode = codeMatch[1];

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

  // ... (나머지 에러 처리 로직은 동일하게 유지)
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

// ---------------------------------------------------------
// 유틸: 첫 사용자 메시지로 사이드바 제목 요약
// ---------------------------------------------------------
function summarizeTitleFromMessages(messages) {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser || !firstUser.text) return "새 음성 대화";
  const t = firstUser.text.trim();
  if (!t) return "새 음성 대화";
  return t.length > 18 ? t.slice(0, 18) + "…" : t;
}

// ---------------------------------------------------------
// 유틸: 리스트 자동 스크롤
// ---------------------------------------------------------
function autoScroll(container, clientY) {
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const margin = 36;
  const maxSpeed = 16;
  let dy = 0;

  if (clientY < rect.top + margin) {
    dy = -((rect.top + margin) - clientY) / (margin / maxSpeed);
  } else if (clientY > rect.bottom - margin) {
    dy = (clientY - (rect.bottom - margin)) / (margin / maxSpeed);
  }

  if (dy !== 0) {
    container.scrollTop += dy;
  }
}

// ---------------------------------------------------------
// 유틸: DataTransfer에서 채팅/폴더 ID 안전 추출
// ---------------------------------------------------------
function getDraggedChatId(e) {
  return (
    e.dataTransfer.getData("application/x-chat-id") ||
    e.dataTransfer.getData("text/x-chat-id") ||
    e.dataTransfer.getData("text/plain") ||
    ""
  );
}
function getDraggedFolderId(e) {
  return (
    e.dataTransfer.getData("application/x-folder-id") ||
    e.dataTransfer.getData("text/x-folder-id") ||
    e.dataTransfer.getData("text/plain") ||
    ""
  );
}

// =========================================================
// 음성 채팅 페이지
// =========================================================
function VoiceChatPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [isOnline, setIsOnline] = useState(true);
  const [hoveredMessageIndex, setHoveredMessageIndex] = useState(null);
  const [openMessageMenuIndex, setOpenMessageMenuIndex] = useState(null);
  const [copyToastVisible, setCopyToastVisible] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState(null);
  const phaseTimersRef = useRef([]);

  // 폴더별 접힘 상태 관리
  const [collapsedFolderIds, setCollapsedFolderIds] = useState(() => new Set());
  const isFolderCollapsed = (id) => collapsedFolderIds.has(id);
  const toggleFolder = (id) =>
    setCollapsedFolderIds((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  // 채팅/사이드바/모달 상태
  const [chatState, setChatState] = useState(getInitialChatState);
  const [input, setInput] = useState(""); // 음성 인식 텍스트(전송용)
  const [loading, setLoading] = useState(false);
  const [errorInfo, setErrorInfo] = useState(null);
  const [focusArea, setFocusArea] = useState("chat");

  const [chatSearch, setChatSearch] = useState("");
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [pendingConvId, setPendingConvId] = useState(null);

  const [menuOpenId, setMenuOpenId] = useState(null);
  const [menuPosition, setMenuPosition] = useState(null); // {x,y}
  const [menuInFolder, setMenuInFolder] = useState(false);

  const [folderMenuOpenId, setFolderMenuOpenId] = useState(null);
  const [folderMenuPosition, setFolderMenuPosition] = useState(null);

  const [confirmDelete, setConfirmDelete] = useState(null); // {id, title}
  const [renameInfo, setRenameInfo] = useState(null); // {id, value}
  const [confirmFolderDelete, setConfirmFolderDelete] = useState(null);
  const [folderCreateModalOpen, setFolderCreateModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderRenameInfo, setFolderRenameInfo] = useState(null);
  const [pendingFolderConvId, setPendingFolderConvId] = useState(null);
  const [detailsModalChat, setDetailsModalChat] = useState(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_INIT_WIDTH);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverFolderId, setDragOverFolderId] = useState(null);
  const [folderDraggingId, setFolderDraggingId] = useState(null);
  const [folderDragOverId, setFolderDragOverId] = useState(null);

  // 음성 상태
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  // speakingText unused but kept for compatibility if needed
  // const [speakingText, setSpeakingText] = useState("");

  // refs
  const rootListRef = useRef(null);
  const folderChatsRefs = useRef({});
  const messagesEndRef = useRef(null);
  const sidebarResizeRef = useRef(null);
  const startedFromHomeRef = useRef(false);
  const recognitionRef = useRef(null);
  const synthRef = useRef(null);
  const initialGreetingSpokenRef = useRef(false);

  const conversations = chatState.conversations || [];
  const folders = chatState.folders || [];
  const currentId = chatState.currentId;
  const currentConv =
    conversations.find((c) => c.id === currentId) || conversations[0];
  const messages = currentConv ? currentConv.messages : [];

  const isCurrentPending =
    loading && currentConv && pendingConvId && currentConv.id === pendingConvId;

  const rootConversations = conversations.filter((c) => !c.folderId);

  const modalSearchResults = chatSearch.trim()
    ? conversations.filter((conv) =>
        conv.title.toLowerCase().includes(chatSearch.toLowerCase())
      )
    : [];

  const activeMenuConversation = menuOpenId
    ? conversations.find((c) => c.id === menuOpenId)
    : null;
  const activeMenuFolder = folderMenuOpenId
    ? folders.find((f) => f.id === folderMenuOpenId)
    : null;

  // ----------------------------- synth 초기화
  useEffect(() => {
    if (typeof window !== "undefined") {
      synthRef.current = window.speechSynthesis;
    }
  }, []);

  // ----------------------------- 저장
  useEffect(() => {
    try {
      const payload = { conversations, folders, currentId };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.error("음성 대화 목록 저장 중 오류:", e);
    }
  }, [conversations, folders, currentId]);

  // ----------------------------- 채팅창 끝으로 스크롤
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }
  }, [messages, pendingConvId]);

  // ----------------------------- 언마운트 시 정리
  useEffect(() => {
    return () => {
      phaseTimersRef.current.forEach((id) => clearTimeout(id));
      phaseTimersRef.current = [];
      if (synthRef.current) {
        synthRef.current.cancel();
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // ----------------------------- 빈 곳 클릭 시 더보기 메뉴 닫기
  useEffect(() => {
    const handleWindowClick = () => {
      setMenuOpenId(null);
      setFolderMenuOpenId(null);
      setOpenMessageMenuIndex(null);
    };
    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  // ----------------------------- 전역 단축키: Ctrl/Cmd+K, Ctrl/Cmd+N
  useEffect(() => {
    const onGlobalHotkey = (e) => {
      const target = e.target;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      const isMac = navigator.platform.toLowerCase().includes("mac");
      const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;
      if (!ctrlOrCmd) return;

      const key = e.key.toLowerCase();

      if (key === "k") {
        e.preventDefault();
        setChatSearch("");
        setIsSearchModalOpen(true);
      } else if (key === "n") {
        e.preventDefault();
        handleNewChat();
      }
    };

    window.addEventListener("keydown", onGlobalHotkey);
    return () => window.removeEventListener("keydown", onGlobalHotkey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------------------------- online/offline
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // ----------------------------- ESC / Enter 모달 제어
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setConfirmDelete(null);
        setConfirmFolderDelete(null);
        setFolderCreateModalOpen(false);
        setFolderRenameInfo(null);
        setRenameInfo(null);
        setMenuOpenId(null);
        setFolderMenuOpenId(null);
        setIsSearchModalOpen(false);
        setOpenMessageMenuIndex(null);
        setDetailsModalChat(null);
        return;
      }
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
      folderRenameInfo?.value ||
      renameInfo ||
      renameInfo?.value ||
      menuOpenId ||
      folderMenuOpenId ||
      folderCreateModalOpen ||
      isSearchModalOpen ||
      detailsModalChat
    ) {
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
  }, [
    confirmDelete,
    confirmFolderDelete,
    folderRenameInfo,
    folderRenameInfo?.value,
    renameInfo,
    renameInfo?.value,
    menuOpenId,
    folderMenuOpenId,
    folderCreateModalOpen,
    isSearchModalOpen,
    detailsModalChat,
  ]);

  // ----------------------------- Delete 키: focusArea
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
        return;
      }

      if (focusArea === "chat") {
        if (!currentConv) return;
        setConfirmDelete({ id: currentConv.id, title: currentConv.title });
        return;
      }

      if (focusArea === "folder") {
        if (selectedFolderId) {
          const folder = folders.find((f) => f.id === selectedFolderId);
          if (!folder) return;
          setConfirmFolderDelete({ id: folder.id, name: folder.name });
        }
        return;
      }

      if (selectedFolderId) {
        const folder = folders.find((f) => f.id === selectedFolderId);
        if (!folder) return;
        setConfirmFolderDelete({ id: folder.id, name: folder.name });
        return;
      }
      if (!currentConv) return;
      setConfirmDelete({ id: currentConv.id, title: currentConv.title });
    };

    window.addEventListener("keydown", handleDeleteKey);
    return () => window.removeEventListener("keydown", handleDeleteKey);
  }, [currentConv, selectedFolderId, folders, focusArea]);

  // ----------------------------- 사이드바 드래그 리사이즈
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
    sidebarResizeRef.current = { startX: e.clientX, startWidth: sidebarWidth };
    setIsResizingSidebar(true);
  };

  // ----------------------------- 음성 합성(TTS)
  const speak = (text) => {
    if (typeof window === "undefined") return;
    if (!text) return;

    if (!synthRef.current && window.speechSynthesis) {
      synthRef.current = window.speechSynthesis;
    }
    if (!synthRef.current || !window.SpeechSynthesisUtterance) return;

    synthRef.current.cancel(); // 기존 음성 중단
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = "ko-KR";
    utterance.onstart = () => {
      setIsSpeaking(true);
      setIsListening(false);
    };
    utterance.onend = () => {
      setIsSpeaking(false);
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
    };
    synthRef.current.speak(utterance);
  };

  // ----------------------------- Home → VoiceChat 새 대화 시작 (수정됨)
  // ✅ 2개 생기는 문제 해결 및 자동 재생
  useEffect(() => {
    if (!location?.state?.newChat) return;
    
    // Strict Mode 등에서 두 번 실행되는 것 방지
    if (startedFromHomeRef.current) return;
    startedFromHomeRef.current = true;

    // 중요: HomePage에서 localStorage를 지우고 왔다면,
    // getInitialChatState()가 이미 "새 음성 대화" 하나를 만들어 둔 상태입니다.
    // 여기서 handleNewChat()을 또 부르면 대화가 2개가 됩니다.
    // 따라서 "방금 초기화된 상태"인지 확인합니다.
    const isFreshlyInitialized = 
      conversations.length === 1 &&
      conversations[0].title === "새 음성 대화" &&
      conversations[0].messages.length === 1;

    if (isFreshlyInitialized) {
      // 대화방을 새로 만들지 않고, 이미 있는 1번 대화방의 인사를 바로 읽습니다.
      speak("안녕하세요! 말씀해 주시면 듣고 대답해 드립니다.");
    } else {
      // 기존 대화가 쌓여있는 상태에서 홈에서 '음성 시작하기'를 누른 경우
      handleNewChat();
    }

    // state 초기화 (새로고침 시 반복 방지)
    navigate(location.pathname, { replace: true, state: {} });
  }, [location, navigate, conversations]);


  // ✅ 일반적인 접근(새로고침 등) 시, 현재 대화의 첫 bot 인사를 한 번만 읽어주기
  useEffect(() => {
    // newChat 플래그로 들어왔을 때는 위 로직이 처리하므로 패스
    if (location?.state?.newChat) return;

    // 이미 한 번 읽어줬으면 끝
    if (initialGreetingSpokenRef.current) return;
    
    if (!currentConv || !currentConv.messages || currentConv.messages.length === 0)
      return;

    // 유저 메시지가 있으면 "초기 상태"가 아니라고 보고 패스
    const hasUserMsg = currentConv.messages.some((m) => m.role === "user");
    if (hasUserMsg) {
      initialGreetingSpokenRef.current = true;
      return;
    }

    const firstBot = currentConv.messages.find((m) => m.role === "bot");
    if (!firstBot || !firstBot.text) {
      initialGreetingSpokenRef.current = true;
      return;
    }

    // 자동 재생
    initialGreetingSpokenRef.current = true;
    speak(firstBot.text);
  }, [currentConv, location]);


  // ----------------------------- 음성 인식 설정
  const setupRecognition = () => {
    if (recognitionRef.current) return;
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("이 브라우저는 음성 인식을 지원하지 않습니다.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "ko-KR";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
      setIsSpeaking(false);
    };
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };
    recognition.onerror = () => {
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
  };

  const stopRecognition = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    setIsListening(false);
  };

  // ----------------------------- 메시지 전송 (음성 전용)
  const sendMessage = async (content) => {
    const trimmed = (content || "").trim();
    if (!trimmed || loading || !currentConv) return;

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setIsOnline(false);
      setErrorInfo(makeErrorInfo("Network is offline"));
      return;
    }

    const targetConvId = currentConv.id;

    setErrorInfo(null);
    setLoading(true);
    setPendingConvId(targetConvId);
    setMenuOpenId(null);
    setFolderMenuOpenId(null);

    // 이전 로딩 단계 타이머 초기화
    phaseTimersRef.current.forEach((id) => clearTimeout(id));
    phaseTimersRef.current = [];

    // 단계별 텍스트 변경: understanding → searching → composing
    setLoadingPhase("understanding");
    const t1 = setTimeout(() => {
      setLoadingPhase((prev) =>
        prev === "understanding" ? "searching" : prev
      );
    }, 900);
    const t2 = setTimeout(() => {
      setLoadingPhase((prev) =>
        prev === "searching" ? "composing" : prev
      );
    }, 1800);
    phaseTimersRef.current.push(t1, t2);

    // 사용자 메시지 추가 + 제목 자동 요약
    setChatState((prev) => {
      const now = Date.now();
      const updated = (prev.conversations || []).map((conv) => {
        if (conv.id !== targetConvId) return conv;

        const newMessages = [...conv.messages, { role: "user", text: trimmed }];

        const hasUserBefore = conv.messages.some((m) => m.role === "user");
        const newTitle = hasUserBefore
          ? conv.title
          : summarizeTitleFromMessages(newMessages);

        return { ...conv, messages: newMessages, updatedAt: now, title: newTitle };
      });
      return { ...prev, conversations: updated };
    });

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      setIsOnline(true);

      const data = await res.json();
      if (data.error) {
        const info = makeErrorInfo(data.error);

        setChatState((prev) => {
          const now = Date.now();
          const updated = (prev.conversations || []).map((conv) => {
            if (conv.id !== targetConvId) return conv;
            const newMessages = [
              ...conv.messages,
              {
                role: "bot",
                text:
                  "죄송합니다. 오류 때문에 지금은 답변을 생성하지 못했습니다. 화면 가운데 나타난 오류 안내 창을 확인해 주세요.",
              },
            ];
            return { ...conv, messages: newMessages, updatedAt: now };
          });
          return { ...prev, conversations: updated };
        });

        setErrorInfo(info);
        speak("죄송합니다. 오류 때문에 지금은 답변을 드릴 수 없습니다.");
      } else {
        const answer = data.answer || "(응답이 없습니다)";
        setChatState((prev) => {
          const now = Date.now();
          const updated = (prev.conversations || []).map((conv) => {
            if (conv.id !== targetConvId) return conv;
            const newMessages = [...conv.messages, { role: "bot", text: answer }];
            return { ...conv, messages: newMessages, updatedAt: now };
          });
          return { ...prev, conversations: updated };
        });
        speak(answer);
      }
    } catch (err) {
      setIsOnline(false);

      const info = makeErrorInfo(err?.message || err);

      setChatState((prev) => {
        const now = Date.now();
        const updated = (prev.conversations || []).map((conv) => {
          if (conv.id !== targetConvId) return conv;
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
      speak("서버에 연결하는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
      setPendingConvId(null);
      phaseTimersRef.current.forEach((id) => clearTimeout(id));
      phaseTimersRef.current = [];
      setLoadingPhase(null);
    }
  };

  // ----------------------------- Mic 버튼 클릭
  const handleMicClick = () => {
    // 말하는 중이면 TTS 중단
    if (isSpeaking) {
      if (synthRef.current) {
        synthRef.current.cancel();
      }
      setIsSpeaking(false);
      return;
    }

    setupRecognition();
    if (!recognitionRef.current) return;

    // 이미 듣는 중이면 → 녹음 종료 + 전송
    if (isListening) {
      stopRecognition();
      const trimmed = input.trim();
      if (trimmed) {
        setTimeout(() => {
          sendMessage(trimmed);
          setInput("");
        }, 200);
      } else {
        setInput("");
      }
    } else {
      // 새로운 음성 입력 시작
      setInput("");
      try {
        recognitionRef.current.start();
      } catch {
        try {
          recognitionRef.current.stop();
          recognitionRef.current.start();
        } catch (e2) {
          console.error("음성 인식 시작 실패:", e2);
        }
      }
    }
  };

  // ----------------------------- 새 음성 채팅
  const handleNewChat = () => {
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    setIsSpeaking(false);
    setIsListening(false);
    setInput("");

    const newConv = createNewConversation();
    setChatState((prev) => {
      const prevList = prev.conversations || [];
      const newList = [...prevList, newConv];
      return { ...prev, conversations: newList, currentId: newConv.id };
    });
    setSelectedFolderId(null);
    setErrorInfo(null);
    setMenuOpenId(null);
    setFolderMenuOpenId(null);
    setFocusArea("chat");
    setChatSearch("");

    speak("안녕하세요! 말씀해 주시면 듣고 대답해 드립니다.");
  };

  // ----------------------------- 대화 선택/삭제/이름변경
  const handleSelectConversation = (id) => {
    setChatState((prev) => ({ ...prev, currentId: id }));
    setSelectedFolderId(null);
    setErrorInfo(null);
    setMenuOpenId(null);
    setFolderMenuOpenId(null);
    setFocusArea("chat");
    setIsSearchModalOpen(false);

    // 다른 대화 선택 시 음성/인식 중단
    if (synthRef.current) synthRef.current.cancel();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    setIsSpeaking(false);
    setIsListening(false);
    setInput("");
  };

  const handleDeleteConversation = (id) => {
    setChatState((prev) => {
      const list = prev.conversations || [];
      const deleteIndex = list.findIndex((c) => c.id === id);
      if (deleteIndex === -1) return prev;

      let filtered = list.filter((c) => c.id !== id);
      let newCurrentId = prev.currentId;

      if (filtered.length === 0) {
        const newConv = createNewConversation();
        filtered = [newConv];
        newCurrentId = newConv.id;
      } else if (prev.currentId === id) {
        const samePosIndex =
          deleteIndex >= 0 && deleteIndex < filtered.length
            ? deleteIndex
            : filtered.length - 1;
        newCurrentId = filtered[samePosIndex].id;
      }
      return { ...prev, conversations: filtered, currentId: newCurrentId };
    });

    if (id === pendingConvId) {
      setPendingConvId(null);
      setLoading(false);
    }

    setMenuOpenId(null);
    setFolderMenuOpenId(null);
    setFocusArea("chat");
  };

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

  const openDeleteConfirmModal = (id, title) => {
    setConfirmDelete({ id, title });
    setMenuOpenId(null);
    setFolderMenuOpenId(null);
    setFocusArea("chat");
  };

  const openFolderDeleteConfirmModal = (id, name) => {
    setConfirmFolderDelete({ id, name });
    setFolderMenuOpenId(null);
    setMenuOpenId(null);
    setFocusArea("folder");
  };

  const openRenameModal = (id, title) => {
    setRenameInfo({ id, value: title || "" });
    setMenuOpenId(null);
    setFolderMenuOpenId(null);
    setFocusArea("chat");
  };

  // ----------------------------- 폴더 생성/이름변경/삭제
  const handleCreateFolder = () => {
    setNewFolderName("");
    setFolderCreateModalOpen(true);
    setPendingFolderConvId(null);
    setFocusArea("folder");
  };

  const handleCreateFolderConfirm = () => {
    const trimmed = (newFolderName || "").trim();
    if (!trimmed) return;

    const now = Date.now();
    const folderId = String(now);
    const newFolder = { id: folderId, name: trimmed, createdAt: now };

    setChatState((prev) => {
      const nextFolders = [...(prev.folders || []), newFolder];
      let nextConversations = prev.conversations || [];

      if (pendingFolderConvId) {
        nextConversations = nextConversations.map((c) =>
          c.id === pendingFolderConvId ? { ...c, folderId } : c
        );
      }
      return { ...prev, folders: nextFolders, conversations: nextConversations };
    });
    setFolderCreateModalOpen(false);
    setNewFolderName("");
    setPendingFolderConvId(null);
  };

  const handleRenameFolder = (folderId) => {
    const target = folders.find((f) => f.id === folderId);
    setFolderRenameInfo({ id: folderId, value: target?.name || "" });
    setFolderMenuOpenId(null);
    setMenuOpenId(null);
  };

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

  // 폴더 삭제 (안의 채팅은 루트로 이동)
  const handleDeleteFolder = (folderId) => {
    setChatState((prev) => {
      const list = prev.folders || [];
      const filtered = list.filter((f) => f.id !== folderId);

      return {
        ...prev,
        folders: filtered,
        conversations: (prev.conversations || []).map((c) =>
          c.folderId === folderId ? { ...c, folderId: null } : c
        ),
      };
    });

    setSelectedFolderId((prevSelectedId) => {
      if (prevSelectedId !== folderId) return prevSelectedId;
      const remaining = (folders || []).filter((f) => f.id !== folderId);
      return remaining.length ? remaining[0].id : null;
    });

    setFocusArea("folder");
  };

  // ----------------------------- 폴더 드래그 관련
  const handleFolderDragOver = (e, folderId) => {
    e.preventDefault();
    if (folderDraggingId) {
      setFolderDragOverId(folderId);
    } else {
      setDragOverFolderId(folderId);
    }

    const el = folderChatsRefs.current[folderId];
    if (el) autoScroll(el, e.clientY);
  };

  const handleDropChatOnFolderHeader = (e, folderId) => {
    e.preventDefault();
    e.stopPropagation();
    const convId = draggingId || getDraggedChatId(e);
    if (!convId) return;

    setChatState((prev) => ({
      ...prev,
      conversations: (prev.conversations || []).map((c) =>
        c.id === convId ? { ...c, folderId } : c
      ),
    }));
    setDraggingId(null);
    setDragOverId(null);
    setDragOverFolderId(null);
  };

  const handleFolderDrop = (e, folderId) => {
    e.preventDefault();
    e.stopPropagation();

    const draggedFolderId = folderDraggingId || getDraggedFolderId(e);
    if (draggedFolderId) {
      // 폴더 재정렬
      setChatState((prev) => {
        const list = [...(prev.folders || [])];
        const fromIndex = list.findIndex((f) => f.id === draggedFolderId);
        const toIndex = list.findIndex((f) => f.id === folderId);
        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex)
          return prev;

        const [moved] = list.splice(fromIndex, 1);
        list.splice(toIndex, 0, moved);
        return { ...prev, folders: list };
      });

      setFolderDraggingId(null);
      setFolderDragOverId(null);
      setDragOverFolderId(null);
      return;
    }

    const convId = draggingId || getDraggedChatId(e);
    if (!convId) {
      setDraggingId(null);
      setDragOverId(null);
      setDragOverFolderId(null);
      return;
    }

    // 채팅을 폴더로 이동
    setChatState((prev) => {
      const exist = (prev.conversations || []).some((c) => c.id === convId);
      if (!exist) return prev;

      const nextConversations = (prev.conversations || []).map((c) =>
        c.id === convId ? { ...c, folderId } : c
      );
      return { ...prev, conversations: nextConversations };
    });

    setDraggingId(null);
    setDragOverId(null);
    setDragOverFolderId(null);
  };

  const handleMoveConversationToRoot = (id) => {
    setChatState((prev) => ({
      ...prev,
      conversations: (prev.conversations || []).map((c) =>
        c.id === id ? { ...c, folderId: null } : c
      ),
    }));
    setMenuOpenId(null);
    setFolderMenuOpenId(null);
    setFocusArea("chat");
  };

  const handleFolderItemDragStart = (e, folderId) => {
    setFolderDraggingId(folderId);
    setSelectedFolderId(folderId);
    setFolderDragOverId(null);
    setDragOverFolderId(null);
    setDraggingId(null);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-folder-id", folderId);
    e.dataTransfer.setData("text/plain", folderId);
  };
  const handleFolderItemDragEnd = () => {
    setFolderDraggingId(null);
    setFolderDragOverId(null);
    setDragOverFolderId(null);
  };

  // ----------------------------- 채팅 드래그
  const handleDragStart = (e, id) => {
    setDraggingId(id);
    setDragOverId(null);
    setDragOverFolderId(null);
    setFolderDraggingId(null);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-chat-id", id);
    e.dataTransfer.setData("text/x-chat-id", id);
    e.dataTransfer.setData("text/plain", id);
  };
  const handleDragOver = (e, id) => {
    e.preventDefault();
    if (id !== dragOverId) setDragOverId(id);
  };

  const handleDropOnRootItem = (e, targetConvId) => {
    e.preventDefault();
    e.stopPropagation();

    const candidate = draggingId || getDraggedChatId(e);
    if (
      !candidate ||
      candidate === targetConvId ||
      !(conversations || []).some((c) => c.id === candidate)
    ) {
      setDraggingId(null);
      setDragOverId(null);
      setDragOverFolderId(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const insertAfter = e.clientY > centerY;

    setChatState((prev) => {
      const list = [...(prev.conversations || [])];
      const fromIndex = list.findIndex((c) => c.id === candidate);
      let toIndex = list.findIndex((c) => c.id === targetConvId);
      if (fromIndex === -1 || toIndex === -1) return prev;

      const [movedRaw] = list.splice(fromIndex, 1);
      const moved =
        movedRaw.folderId !== null ? { ...movedRaw, folderId: null } : movedRaw;

      if (fromIndex < toIndex) {
        toIndex -= 1;
      }

      let insertIndex = insertAfter ? toIndex + 1 : toIndex;

      if (insertIndex < 0) insertIndex = 0;
      if (insertIndex > list.length) insertIndex = list.length;

      list.splice(insertIndex, 0, moved);
      return { ...prev, conversations: list };
    });

    setDraggingId(null);
    setDragOverId(null);
    setDragOverFolderId(null);
  };

  const handleDropOnFolderChat = (e, targetConvId, folderId) => {
    e.preventDefault();
    e.stopPropagation();

    const candidate = draggingId || getDraggedChatId(e);
    if (
      !candidate ||
      candidate === targetConvId ||
      !(conversations || []).some((c) => c.id === candidate)
    ) {
      setDraggingId(null);
      setDragOverId(null);
      setDragOverFolderId(null);
      return;
    }

    setChatState((prev) => {
      const list = [...(prev.conversations || [])];
      const fromIndex = list.findIndex((c) => c.id === candidate);
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

  const handleFolderChatsDragOver = (e, folderId) => {
    e.preventDefault();
    setDragOverFolderId(folderId);
    const el = folderChatsRefs.current[folderId];
    if (el) autoScroll(el, e.clientY);
  };

  const handleRootListDragOver = (e) => {
    e.preventDefault();
    setDragOverFolderId(null);
    if (rootListRef.current) autoScroll(rootListRef.current, e.clientY);
  };

  const handleRootListDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (folderDraggingId) {
      setFolderDraggingId(null);
      setFolderDragOverId(null);
      setDragOverFolderId(null);
      setDraggingId(null);
      setDragOverId(null);
      return;
    }

    const candidate = draggingId || getDraggedChatId(e);
    if (!candidate || !(conversations || []).some((c) => c.id === candidate)) {
      setDraggingId(null);
      setDragOverId(null);
      setDragOverFolderId(null);
      return;
    }

    let targetId = null;
    const container = rootListRef.current;
    if (container) {
      const items = Array.from(
        container.querySelectorAll(".sidebar-chat-item")
      );
      if (items.length > 0) {
        const mouseY = e.clientY;
        let nearestId = null;
        let nearestDist = Infinity;

        items.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const centerY = rect.top + rect.height / 2;
          const dist = Math.abs(mouseY - centerY);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestId = el.dataset.chatId;
          }
        });

        targetId = nearestId;
      }
    }

    setChatState((prev) => {
      const list = [...(prev.conversations || [])];
      const fromIndex = list.findIndex((c) => c.id === candidate);
      if (fromIndex === -1) return prev;

      const [movedRaw] = list.splice(fromIndex, 1);
      const moved =
        movedRaw.folderId !== null ? { ...movedRaw, folderId: null } : movedRaw;

      if (!targetId) {
        list.push(moved);
      } else {
        const toIndex = list.findIndex((c) => c.id === targetId);
        if (toIndex === -1) {
          list.push(moved);
        } else {
          let insertIndex = toIndex;
          if (container) {
            const targetEl = container.querySelector(
              `.sidebar-chat-item[data-chat-id="${targetId}"]`
            );
            if (targetEl) {
              const rect = targetEl.getBoundingClientRect();
              const centerY = rect.top + rect.height / 2;
              if (e.clientY > centerY) {
                insertIndex = toIndex + 1;
              }
            }
          }
          list.splice(insertIndex, 0, moved);
        }
      }

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

  // ----------------------------- 개별 메시지 삭제
  const handleDeleteMessage = (messageIndex) => {
    if (!currentConv) return;

    setChatState((prev) => {
      const now = Date.now();
      const updated = (prev.conversations || []).map((conv) => {
        if (conv.id !== currentConv.id) return conv;

        const newMessages = conv.messages.filter(
          (_, idx) => idx !== messageIndex
        );

        return {
          ...conv,
          messages: newMessages,
          updatedAt: now,
        };
      });

      return { ...prev, conversations: updated };
    });
  };

  // ----------------------------- 메시지 복사
  const handleCopyMessage = (text) => {
    if (!navigator.clipboard) {
      alert("클립보드 복사를 지원하지 않는 브라우저입니다.");
      return;
    }

    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopyToastVisible(false);
        requestAnimationFrame(() => {
          setCopyToastVisible(true);
        });
      })
      .catch(() => {
        alert("복사에 실패했습니다. 다시 시도해 주세요.");
      });
  };

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
<html lang="ko"><head><meta charset="utf-8" />
<title>오류 상세 정보</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Noto Sans KR',sans-serif;padding:16px;white-space:pre-wrap;background:#fff;color:#222}
h1{font-size:18px;margin-bottom:8px}h2{font-size:14px;margin:16px 0 4px}
pre{font-size:12px;background:#f7f7f7;padding:12px;border-radius:8px;max-height:420px;overflow:auto;white-space:pre-wrap;word-break:break-all}
</style></head>
<body>
<h1>${escapeHtml(errorInfo.title)}</h1>
<p>${escapeHtml(errorInfo.guide)}</p>
<p style="color:#666;">${escapeHtml(errorInfo.hint)}</p>
<h2>원본 오류 메시지</h2>
<pre>${escapeHtml(errorInfo.detail)}</pre>
</body></html>`);
      win.document.close();
    } catch (e) {
      console.error("오류 상세 창 생성 중 오류:", e);
    }
  };

  // ------------------------------------------------------- 렌더링
  return (
    <div className="page chat-page voice-mode">
      {/* 검색 모달 + 로딩/복사/상세 모달 전용 스타일 + 음성 UI 스타일 */}
      <style>{`
        /* 구글 폰트 불러오기 (Noto Sans KR) */
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap');

        /* 페이지 전체에 부드러운 고딕 폰트 적용 */
        body, button, input, textarea, .chat-page, .chat-shell, .chat-sidebar {
          font-family: 'Noto Sans KR', -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif !important;
        }

        .sidebar-search-trigger {
          width: calc(100% - 24px);
          margin: 0 12px 12px 12px;
          padding: 10px;
          border: 1px dashed #ccc;
          border-radius: 8px;
          background-color: transparent;
          color: #666;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        }
        .sidebar-search-trigger:hover {
          background-color: #f9f9f9;
          border-color: #bbb;
          color: #333;
        }
        .sidebar-search-trigger svg {
          margin-right: 6px;
          opacity: 0.6;
        }
        .search-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.4);
          backdrop-filter: blur(2px);
          z-index: 9999;
          display: flex;
          justify-content: center;
          align-items: flex-start;
          padding-top: 120px;
        }
        .search-modal-content {
          width: 600px;
          max-width: 90%;
          background: #fff;
          border-radius: 12px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
          overflow: hidden;
          animation: fadeIn 0.2s ease-out;
        }
        .search-modal-header {
          padding: 16px;
          border-bottom: 1px solid #f0f0f0;
          display: flex;
          align-items: center;
        }
        .search-modal-input {
          flex: 1;
          border: none;
          font-size: 16px;
          outline: none;
          padding: 4px;
        }
        .search-modal-close {
          background: none;
          border: none;
          font-size: 20px;
          color: #999;
          cursor: pointer;
          padding: 0 8px;
        }
        .search-modal-results {
          max-height: 400px;
          overflow-y: auto;
          padding: 8px 0;
        }
        .search-result-item {
          padding: 12px 20px;
          cursor: pointer;
          display: flex;
          align-items: center;
          transition: background 0.15s;
        }
        .search-result-item:hover {
          background: #f3f4f6;
        }
        .search-result-icon {
          margin-right: 12px;
          color: #9ca3af;
        }
        .search-result-text {
          font-size: 14px;
          color: #374151;
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .search-result-date {
          font-size: 12px;
          color: #9aa0a6;
          margin-left: 12px;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .search-empty-state {
          padding: 32px;
          text-align: center;
          color: #9ca3af;
          font-size: 14px;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* typing dots (로딩중 ... 애니메이션) */
        .typing-dots {
          display: inline-flex;
          align-items: center;
          gap: 3px;
        }
        .typing-dots .dot {
          width: 4px;
          height: 4px;
          border-radius: 999px;
          background: currentColor;
          opacity: 0.4;
          animation: typingDots 1s infinite ease-in-out;
        }
        .typing-dots .dot:nth-child(2) {
          animation-delay: 0.15s;
        }
        .typing-dots .dot:nth-child(3) {
          animation-delay: 0.3s;
        }
        @keyframes typingDots {
          0%, 80%, 100% {
            transform: translateY(0);
            opacity: 0.4;
          }
          40% {
            transform: translateY(-2px);
            opacity: 1;
          }
        }
        .sidebar-chat-pending {
          font-size: 11px;
          color: #9ca3af;
        }

        /* 복사 완료 모달 (가운데) */
        .copy-modal-overlay {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.35);
          z-index: 10000;
        }
        .copy-modal {
          background: #ffffff;
          border-radius: 12px;
          padding: 20px 24px 16px;
          min-width: 220px;
          max-width: 280px;
          text-align: center;
          box-shadow:
            0 20px 25px -5px rgba(0, 0, 0, 0.1),
            0 10px 10px -5px rgba(0, 0, 0, 0.04);
          animation: copyModalFadeIn 0.2s ease-out;
        }
        .copy-modal-body {
          font-size: 14px;
          color: #111827;
          margin-bottom: 16px;
        }
        .copy-modal-footer {
          display: flex;
          justify-content: center;
        }
        .copy-modal-button {
          padding: 6px 18px;
          border-radius: 999px;
          border: none;
          background: #2563eb;
          color: #ffffff;
          font-size: 13px;
          cursor: pointer;
        }
        .copy-modal-button:hover {
          background: #1d4ed8;
        }
        @keyframes copyModalFadeIn {
          from {
            opacity: 0;
            transform: translateY(4px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        /* ===== 상세 정보 모달 스타일 ===== */
        .details-modal {
          width: min(520px, 90vw);
          background: #ffffff;
          border-radius: 16px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
          border: 1px solid #e5e7eb;
          padding: 24px;
          animation: modalFadeIn 0.2s ease-out;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .details-section-title {
          font-size: 14px;
          font-weight: 600;
          color: #374151;
          margin-bottom: 10px;
          border-bottom: 2px solid #f3f4f6;
          padding-bottom: 6px;
        }
        .details-grid {
          display: grid;
          grid-template-columns: 100px 1fr;
          gap: 8px 12px;
          font-size: 13px;
        }
        .details-label {
          color: #6b7280;
          font-weight: 500;
        }
        .details-value {
          color: #111827;
          word-break: break-all;
        }
        .details-preview-box {
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 12px;
          font-size: 13px;
          color: #4b5563;
          line-height: 1.5;
          max-height: 120px;
          overflow-y: auto;
        }

        @keyframes modalFadeIn {
          from {
            opacity: 0;
            transform: translateY(8px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        /* ===== 음성 컨트롤 UI ===== */
        .voice-controls {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 12px 16px 20px;
          background: #ffffff;
          border-top: 1px solid #e5e7eb;
          min-height: 140px;
          gap: 10px;
        }
        .voice-transcript {
          font-size: 1.05rem;
          color: #1f2937;
          min-height: 28px;
          line-height: 1.4;
          text-align: center;
          width: 90%;
          max-width: 600px;
          background: #f9fafb;
          padding: 6px 12px;
          border-radius: 8px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .voice-status {
          font-size: 0.85rem;
          color: #6b7280;
        }
        .mic-button {
          width: 64px;
          height: 64px;
          border-radius: 50%;
          border: none;
          cursor: pointer;
          font-size: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 8px 20px rgba(0,0,0,0.1);
          color: white;
          position: relative;
        }
        .mic-button:hover {
          transform: translateY(-2px) scale(1.05);
          box-shadow: 0 12px 25px rgba(0,0,0,0.15);
        }
        .mic-button:active {
          transform: translateY(1px) scale(0.95);
        }
        .mic-button.idle {
          background: linear-gradient(135deg, #6366f1, #4f46e5);
        }
        .mic-button.listening {
          background: linear-gradient(135deg, #ef4444, #dc2626);
          animation: pulse-red 1.6s infinite;
        }
        .mic-button.speaking {
          background: linear-gradient(135deg, #10b981, #059669);
          animation: pulse-green 1.6s infinite;
        }
        .mic-button.loading {
          background: #d1d5db;
          cursor: wait;
          animation: none;
          box-shadow: none;
          transform: none;
        }
        @keyframes pulse-red {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.6); }
          70% { box-shadow: 0 0 0 15px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
        @keyframes pulse-green {
          0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); }
          70% { box-shadow: 0 0 0 15px rgba(16, 185, 129, 0); }
          100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }

        /* 컨텍스트 메뉴 */
        .sidebar-chat-menu {
          position: fixed;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          padding: 4px 0;
          z-index: 10000;
          min-width: 140px;
        }
        .sidebar-chat-menu button {
          display: block;
          width: 100%;
          text-align: left;
          padding: 8px 16px;
          background: none;
          border: none;
          font-size: 14px;
          color: #374151;
          cursor: pointer;
        }
        .sidebar-chat-menu button:hover {
          background-color: #f3f4f6;
        }

        .sidebar-chat-item.dragging,
        .sidebar-folder-item.dragging {
          opacity: 0.5;
        }
        .sidebar-folder-item.drag-over,
        .sidebar-folder-empty-drop.drop-chat {
          background: #eff6ff;
        }
        .sidebar-folder-item.drop-chat {
          outline: 1px dashed #60a5fa;
        }
      `}</style>

      {/* 모바일용 사이드바 토글 버튼 */}
      <button
        className="sidebar-toggle-btn"
        onClick={(e) => {
          e.stopPropagation();
          setSidebarOpen((prev) => !prev);
        }}
        aria-label="사이드바 토글"
      ></button>

      <div className="chat-layout">
        {/* ===== 좌측: 사이드바 ===== */}
        <aside
          className={
            "chat-sidebar" +
            (sidebarCollapsed ? " collapsed" : "") +
            (sidebarOpen ? " open" : "")
          }
          style={!sidebarCollapsed ? { flex: `0 0 ${sidebarWidth}px` } : undefined}
        >
          <div className="sidebar-top">
            <button
              className="sidebar-menu-toggle"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              aria-label={sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
            >
              <img src="/img/menu.png" alt="사이드바" />
            </button>

            {!sidebarCollapsed && (
              <button className="sidebar-new-chat-btn" onClick={handleNewChat}>
                새 채팅
              </button>
            )}
          </div>

          {!sidebarCollapsed && (
            <>
              {/* 채팅 검색 트리거 버튼 */}
              <button
                className="sidebar-search-trigger"
                onClick={() => {
                  setChatSearch("");
                  setIsSearchModalOpen(true);
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                채팅 검색
              </button>

              {/* ================== 폴더 섹션 ================== */}
              <div className="sidebar-section-title">폴더</div>

              <div
                className="sidebar-folder-list"
                onMouseDown={() => setFocusArea("folder")}
              >
                {folders.length === 0 ? (
                  <div
                    className="sidebar-folder-empty"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const convId = draggingId || getDraggedChatId(e);
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
                    const isDropChat =
                      dragOverFolderId === folder.id && !folderDraggingId;
                    const isDragOverFolderSort =
                      folderDragOverId === folder.id && !!folderDraggingId;

                    const collapsed = isFolderCollapsed(folder.id);

                    return (
                      <div
                        key={folder.id}
                        className={
                          "sidebar-folder-item" +
                          (selectedFolderId === folder.id ? " selected" : "") +
                          (folderDraggingId === folder.id ? " dragging" : "") +
                          (isDragOverFolderSort ? " drag-over" : "") +
                          (isDropChat ? " drop-chat" : "") +
                          (collapsed ? " collapsed" : "")
                        }
                        draggable
                        onDragStart={(e) => handleFolderItemDragStart(e, folder.id)}
                        onDragOver={(e) => handleFolderDragOver(e, folder.id)}
                        onDrop={(e) => handleFolderDrop(e, folder.id)}
                        onDragEnd={handleFolderItemDragEnd}
                        onClick={() => setSelectedFolderId(folder.id)}
                        aria-label={`폴더 ${folder.name}`}
                      >
                        <div
                          className="sidebar-folder-header"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setFocusArea("folder");
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFolderId(folder.id);
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (folderDraggingId || getDraggedFolderId(e)) {
                              setFolderDragOverId(folder.id);
                            } else {
                              setDragOverFolderId(folder.id);
                            }
                          }}
                          onDrop={(e) => {
                            if (folderDraggingId || getDraggedFolderId(e)) {
                              handleFolderDrop(e, folder.id);
                            } else {
                              handleDropChatOnFolderHeader(e, folder.id);
                            }
                          }}
                        >
                          <button
                            title={collapsed ? "대화 펼치기" : "대화 접기"}
                            aria-label={collapsed ? "대화 펼치기" : "대화 접기"}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFolder(folder.id);
                            }}
                            className="sidebar-folder-toggle"
                          >
                            {collapsed ? "+" : "−"}
                          </button>

                          <span className="sidebar-folder-name">
                            {folder.name}
                          </span>

                          <div className="sidebar-folder-controls">
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
                                setMenuOpenId(null);
                                setFocusArea("folder");
                                setFolderMenuOpenId((prev) =>
                                  prev === folder.id ? null : folder.id
                                );
                              }}
                              aria-label="폴더 더보기"
                            >
                              ⋯
                            </button>
                          </div>
                        </div>

                        {childConvs.length === 0 && (
                          <div
                            className={
                              "sidebar-folder-empty-drop" +
                              (dragOverFolderId === folder.id ? " drop-chat" : "")
                            }
                            onDragOver={(e) => {
                              e.preventDefault();
                              setDragOverFolderId(folder.id);
                            }}
                            onDrop={(e) =>
                              handleDropChatOnFolderHeader(e, folder.id)
                            }
                          >
                            대화 없음 — 여기로 드롭
                          </div>
                        )}

                        {childConvs.length > 0 && (
                          <div
                            className="sidebar-folder-chats"
                            ref={(el) => {
                              folderChatsRefs.current[folder.id] = el;
                            }}
                            onDragOver={(e) =>
                              handleFolderChatsDragOver(e, folder.id)
                            }
                          >
                            {childConvs.map((conv) => {
                              const isDragging = draggingId === conv.id;
                              const isDragOver = dragOverId === conv.id;
                              const isPending =
                                loading && pendingConvId === conv.id;

                              return (
                                <div
                                  key={conv.id}
                                  className={
                                    "sidebar-folder-chat-row" +
                                    (isDragging ? " dragging" : "") +
                                    (isDragOver ? " drag-over" : "")
                                  }
                                  onDragOver={(e) => handleDragOver(e, conv.id)}
                                  onDrop={(e) =>
                                    handleDropOnFolderChat(e, conv.id, folder.id)
                                  }
                                >
                                  <button
                                    className={
                                      "sidebar-folder-chat" +
                                      (conv.id === currentId ? " active" : "")
                                    }
                                    onClick={() => {
                                      setFocusArea("chat");
                                      handleSelectConversation(conv.id);
                                    }}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, conv.id)}
                                    onDragEnd={handleDragEnd}
                                  >
                                    <span className="sidebar-folder-chat-title">
                                      {conv.title}
                                    </span>

                                    {isPending && (
                                      <span
                                        className="sidebar-chat-pending typing-dots"
                                        style={{ marginLeft: 4 }}
                                        aria-label="응답 대기 중"
                                      >
                                        <span className="dot" />
                                        <span className="dot" />
                                        <span className="dot" />
                                      </span>
                                    )}
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
                                      setFolderMenuOpenId(null);
                                      setFocusArea("chat");
                                      setMenuOpenId((prev) =>
                                        prev === conv.id ? null : conv.id
                                      );
                                    }}
                                    aria-label="채팅 더보기"
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
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const convId = draggingId || getDraggedChatId(e);
                    if (!convId) return;
                    setPendingFolderConvId(convId);
                    setFolderCreateModalOpen(true);
                  }}
                >
                  + 새 폴더
                </button>
              </div>

              {/* ================== 채팅(루트) 섹션 ================== */}
              <div
                className="sidebar-chat-section"
                onDragOver={handleRootListDragOver}
                onDrop={handleRootListDrop}
                onMouseDown={() => {
                  setFocusArea("chat");
                  setSelectedFolderId(null);
                }}
              >
                <div className="sidebar-section-title">채팅</div>

                <div
                  className={
                    "sidebar-chat-list" +
                    (rootConversations.length > 20 ? " sidebar-chat-list-limit" : "")
                  }
                  ref={rootListRef}
                  onDragOver={handleRootListDragOver}
                  onDrop={handleRootListDrop}
                  onMouseDown={() => {
                    setFocusArea("chat");
                    setSelectedFolderId(null);
                  }}
                >
                  {rootConversations.map((conv, idx) => {
                    const isActive = conv.id === currentId;
                    const isDragging = conv.id === draggingId;
                    const isDragOver = conv.id === dragOverId;
                    const isPending =
                      loading && pendingConvId === conv.id;

                    return (
                      <div
                        key={conv.id}
                        data-chat-id={conv.id}
                        className={
                          "sidebar-chat-item" +
                          (isActive ? " active" : "") +
                          (isDragging ? " dragging" : "") +
                          (isDragOver ? " drag-over" : "")
                        }
                        draggable
                        onClick={() => {
                          setFocusArea("chat");
                          setSelectedFolderId(null);
                        }}
                        onDragStart={(e) => handleDragStart(e, conv.id)}
                        onDragOver={(e) => handleDragOver(e, conv.id)}
                        onDrop={(e) => handleDropOnRootItem(e, conv.id)}
                        onDragEnd={handleDragEnd}
                      >
                        <button
                          className="sidebar-chat-main"
                          onClick={() => {
                            setFocusArea("chat");
                            handleSelectConversation(conv.id);
                          }}
                        >
                          <span className="sidebar-chat-index">{idx + 1}</span>
                          <span className="sidebar-chat-title">{conv.title}</span>

                          {isPending && (
                            <span
                              className="sidebar-chat-pending typing-dots"
                              style={{ marginLeft: 4 }}
                              aria-label="응답 대기 중"
                            >
                              <span className="dot" />
                              <span className="dot" />
                              <span className="dot" />
                            </span>
                          )}
                        </button>

                        <button
                          className="sidebar-chat-more"
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
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
                            setFolderMenuOpenId(null);
                            setSelectedFolderId(null);
                            setFocusArea("chat");
                            setMenuOpenId((prev) =>
                              prev === conv.id ? null : conv.id
                            );
                          }}
                          aria-label="채팅 더보기"
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

          {!sidebarCollapsed && (
            <div
              className="sidebar-resize-handle"
              onMouseDown={handleSidebarResizeMouseDown}
            />
          )}
        </aside>

        {/* ===== 우측: 실제 챗봇 화면 ===== */}
        <div
          className="chat-shell"
          onMouseDown={() => {
            setFocusArea("chat");
            setSelectedFolderId(null);
          }}
        >
          <ChatHeader
            isOnline={isOnline}
            onClickLogo={() => navigate("/")}
          />

          <main className="chat-main">
            <div className="chat-container">
              {/* ====== 대화 말풍선 영역 ====== */}
              <ChatMessages
                messages={messages}
                isCurrentPending={isCurrentPending}
                hoveredMessageIndex={hoveredMessageIndex}
                loadingPhase={loadingPhase}
                setHoveredMessageIndex={setHoveredMessageIndex}
                openMessageMenuIndex={openMessageMenuIndex}
                setOpenMessageMenuIndex={setOpenMessageMenuIndex}
                handleCopyMessage={handleCopyMessage}
                handleDeleteMessage={handleDeleteMessage}
                messagesEndRef={messagesEndRef}
              />

              {/* ====== 음성 입력/재생 영역 ====== */}
              <div className="voice-controls">
                <div className="voice-transcript">
                  {isListening ? input || "듣고 있습니다..." : ""}
                </div>
                <button
                  className={
                    "mic-button " +
                    (loading
                      ? "loading"
                      : isSpeaking
                      ? "speaking"
                      : isListening
                      ? "listening"
                      : "idle")
                  }
                  onClick={handleMicClick}
                  disabled={loading}
                  aria-label="음성으로 질문하기"
                >
                  {loading ? "⏳" : isSpeaking ? "🔊" : isListening ? "📡" : "🎤"}
                </button>
                <div className="voice-status">
                  {loading
                    ? "답변을 생성하고 있어요..."
                    : isSpeaking
                    ? "AI가 답변을 읽어주는 중입니다."
                    : isListening
                    ? "말씀이 끝나면 마이크 버튼을 다시 눌러 주세요."
                    : "마이크 버튼을 눌러 음성으로 질문해 보세요."}
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* ===== 채팅 검색 모달 ===== */}
      {isSearchModalOpen && (
        <div
          className="search-modal-overlay"
          onClick={() => setIsSearchModalOpen(false)}
        >
          <div
            className="search-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="search-modal-header">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#999"
                strokeWidth="2"
                style={{ marginRight: 8 }}
              >
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                className="search-modal-input"
                autoFocus
                placeholder="채팅 검색..."
                value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
              />
              <button
                className="search-modal-close"
                onClick={() => setIsSearchModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="search-modal-results">
              {modalSearchResults.length === 0 ? (
                <div className="search-empty-state">
                  {chatSearch ? "검색 결과가 없습니다." : "검색어를 입력하세요."}
                </div>
              ) : (
                modalSearchResults.map((conv) => (
                  <div
                    key={conv.id}
                    className="search-result-item"
                    onClick={() => {
                      handleSelectConversation(conv.id);
                      setIsSearchModalOpen(false);
                    }}
                  >
                    <div className="search-result-icon">💬</div>
                    <div className="search-result-text">{conv.title}</div>
                    <div className="search-result-date">
                      {formatDateTime(conv.updatedAt)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== 전역 채팅 더보기 메뉴 ===== */}
      {activeMenuConversation && menuPosition && (
        <div
          className="sidebar-chat-menu"
          style={{ top: menuPosition.y, left: menuPosition.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDetailsModalChat(activeMenuConversation);
              setMenuOpenId(null);
            }}
          >
            상세 정보
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

      {/* ===== 상세 정보 모달 ===== */}
      {detailsModalChat && (
        <div
          className="error-modal-overlay"
          onClick={(e) => {
            if (e.target.classList.contains("error-modal-overlay")) {
              setDetailsModalChat(null);
            }
          }}
        >
          <div className="details-modal" role="dialog" aria-modal="true">
            <div className="error-modal-header">
              <span className="error-modal-title">대화 상세 정보</span>
              <button
                className="error-modal-close"
                onClick={() => setDetailsModalChat(null)}
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            <div>
              <div className="details-section-title">기본 정보</div>
              <div className="details-grid">
                <span className="details-label">제목</span>
                <span className="details-value">{detailsModalChat.title}</span>

                <span className="details-label">생성일</span>
                <span className="details-value">
                  {formatDateTime(detailsModalChat.createdAt)}
                </span>

                <span className="details-label">마지막 활동</span>
                <span className="details-value">
                  {formatDateTime(detailsModalChat.updatedAt)}
                </span>

                <span className="details-label">ID</span>
                <span className="details-value">{detailsModalChat.id}</span>

                <span className="details-label">메시지 수</span>
                <span className="details-value">
                  {detailsModalChat.messages?.length || 0}개
                </span>

                {detailsModalChat.folderId && (
                  <>
                    <span className="details-label">폴더</span>
                    <span className="details-value">
                      {folders.find(
                        (f) => f.id === detailsModalChat.folderId
                      )?.name || "삭제된 폴더"}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div>
              <div className="details-section-title">대화 전체 내용</div>
              <div className="details-preview-box">
                {detailsModalChat.messages &&
                detailsModalChat.messages.length > 0 ? (
                  detailsModalChat.messages.map((msg, index) => (
                    <div key={index} style={{ marginBottom: "6px" }}>
                      <strong style={{ marginRight: "4px" }}>
                        {msg.role === "user" ? "👤 나" : "🤖 AI"}:
                      </strong>
                      <span>{msg.text}</span>
                    </div>
                  ))
                ) : (
                  "(대화 내용 없음)"
                )}
              </div>
            </div>

            <div className="error-modal-footer">
              <button
                className="error-modal-secondary"
                onClick={() => setDetailsModalChat(null)}
              >
                닫기
              </button>
            </div>
          </div>
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
          <div className="error-modal" role="dialog" aria-modal="true">
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
          <div className="error-modal" role="dialog" aria-modal="true">
            <div className="error-modal-header">
              <span className="error-modal-title">폴더 삭제</span>
            </div>
            <div className="error-modal-body">
              <p className="error-modal-guide">
                이 폴더를 정말 삭제하시겠습니까? 폴더 안의 채팅은 삭제되지 않고 아래
                &quot;채팅&quot; 목록으로 이동합니다.
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
          <div className="error-modal" role="dialog" aria-modal="true">
            <div className="error-modal-header">
              <span className="error-modal-title">새 폴더 만들기</span>
            </div>
            <div className="error-modal-body">
              <p className="error-modal-guide">새 폴더의 이름을 입력해 주세요.</p>
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
                className="modal-input"
                autoFocus
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
          <div className="error-modal" role="dialog" aria-modal="true">
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
                className="modal-input"
                autoFocus
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
          <div className="error-modal" role="dialog" aria-modal="true">
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
                  setRenameInfo((prev) => ({ ...prev, value: e.target.value }))
                }
                className="modal-input"
                autoFocus
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
          <div className="error-modal" role="dialog" aria-modal="true">
            <div className="error-modal-header">
              <span className="error-modal-title">{errorInfo.title}</span>
              <button
                className="error-modal-close"
                onClick={() => setErrorInfo(null)}
                aria-label="오류창 닫기"
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

      {/* ===== 복사 완료 모달 (가운데) ===== */}
      {copyToastVisible && (
        <div
          className="copy-modal-overlay"
          onClick={() => setCopyToastVisible(false)}
        >
          <div className="copy-modal" onClick={(e) => e.stopPropagation()}>
            <div className="copy-modal-body">복사되었습니다.</div>
            <div className="copy-modal-footer">
              <button
                className="copy-modal-button"
                onClick={() => setCopyToastVisible(false)}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default VoiceChatPage;