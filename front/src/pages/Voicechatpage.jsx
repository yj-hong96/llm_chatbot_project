// src/pages/VoiceChatPage.jsx
import { useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";

// ✅ [Import] 공통 유틸 함수 불러오기
import {
  STORAGE_KEY_VOICE,
  VOICE_GREETING_TEXT,
  getInitialChatState,
  createNewConversation,
  makeErrorInfo,
  summarizeTitleFromMessages,
  getDraggedChatId,
  getDraggedFolderId
} from "../utils/chatUtils";

// ✅ [Import] 분리된 컴포넌트 불러오기
import ChatHeader from "../components/common/ChatHeader";
import ChatSidebar from "../components/common/ChatSidebar";
import GlobalModals from "../components/common/GlobalModals";
import VoiceChatMessages from "../components/voice/VoiceChatMessages";
import VoiceControls from "../components/voice/VoiceControls";

// API Base URL 설정
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5000";

function VoiceChatPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // -------------------------------------------------------
  // 1. 상태 관리 (State Management)
  // -------------------------------------------------------

  // 온라인 여부
  const [isOnline, setIsOnline] = useState(true);
  
  // 메시지 관련 UI 상태
  const [hoveredMessageIndex, setHoveredMessageIndex] = useState(null);
  const [openMessageMenuIndex, setOpenMessageMenuIndex] = useState(null);
  const [copyToastVisible, setCopyToastVisible] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState(null);
  const phaseTimersRef = useRef([]);

  // 폴더 접힘 상태
  const [collapsedFolderIds, setCollapsedFolderIds] = useState(() => new Set());
  const isFolderCollapsed = (id) => collapsedFolderIds.has(id);
  const toggleFolder = (id) =>
    setCollapsedFolderIds((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  // 채팅 데이터 & 입력 상태
  // ✅ 유틸 함수 사용: getInitialChatState
  const [chatState, setChatState] = useState(() => getInitialChatState(STORAGE_KEY_VOICE));
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorInfo, setErrorInfo] = useState(null);
  const [focusArea, setFocusArea] = useState("chat");

  // 검색 및 대기 상태
  const [chatSearch, setChatSearch] = useState("");
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [pendingConvId, setPendingConvId] = useState(null);

  // 컨텍스트 메뉴(우클릭/더보기) 상태
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [menuPosition, setMenuPosition] = useState(null);
  const [menuInFolder, setMenuInFolder] = useState(false);
  const [folderMenuOpenId, setFolderMenuOpenId] = useState(null);
  const [folderMenuPosition, setFolderMenuPosition] = useState(null);

  // 모달(팝업) 관련 상태
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [renameInfo, setRenameInfo] = useState(null);
  const [confirmFolderDelete, setConfirmFolderDelete] = useState(null);
  const [folderCreateModalOpen, setFolderCreateModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderRenameInfo, setFolderRenameInfo] = useState(null);
  const [pendingFolderConvId, setPendingFolderConvId] = useState(null);
  const [detailsModalChat, setDetailsModalChat] = useState(null);

  // 사이드바 UI 상태
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState(null);

  // 음성 관련 상태
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speakingText, setSpeakingText] = useState("");
  const [speakingMessageIndex, setSpeakingMessageIndex] = useState(null);
  const [speakingCharIndex, setSpeakingCharIndex] = useState(0);

  // Refs
  const messagesEndRef = useRef(null);
  const startedFromHomeRef = useRef(false);
  const recognitionRef = useRef(null);
  const synthRef = useRef(null);
  const initialGreetingSpokenRef = useRef(false);

  // 데이터 추출 편의 변수
  const conversations = chatState.conversations || [];
  const folders = chatState.folders || [];
  const currentId = chatState.currentId;
  const currentConv = conversations.find((c) => c.id === currentId) || conversations[0];
  const messages = currentConv ? currentConv.messages : [];
  const hasSpeakableBotMessage = messages && messages.some((m) => m.role === "bot" && m.text);
  const isCurrentPending = loading && currentConv && pendingConvId && currentConv.id === pendingConvId;
  
  // 검색 결과 필터링
  const modalSearchResults = chatSearch.trim()
    ? conversations.filter((conv) => conv.title.toLowerCase().includes(chatSearch.toLowerCase()))
    : [];

  // -------------------------------------------------------
  // 2. useEffect 로직 (LifeCycle)
  // -------------------------------------------------------

  // 음성 합성(SpeechSynthesis) 초기화
  useEffect(() => {
    if (typeof window !== "undefined") {
      synthRef.current = window.speechSynthesis;
    }
  }, []);

  // 로컬 스토리지 저장
  useEffect(() => {
    try {
      const payload = { conversations, folders, currentId };
      localStorage.setItem(STORAGE_KEY_VOICE, JSON.stringify(payload));
    } catch (e) {
      console.error("음성 대화 목록 저장 중 오류:", e);
    }
  }, [conversations, folders, currentId]);

  // 자동 스크롤
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, pendingConvId]);

  // 언마운트 시 클린업 (타이머, 음성 정지)
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
        } catch { /* ignore */ }
      }
    };
  }, []);

  // 화면 클릭 시 메뉴 닫기
  useEffect(() => {
    const handleWindowClick = () => {
      setMenuOpenId(null);
      setFolderMenuOpenId(null);
      setOpenMessageMenuIndex(null);
    };
    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  // 단축키 (Ctrl+K, Ctrl+N)
  useEffect(() => {
    const onGlobalHotkey = (e) => {
      const target = e.target;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
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
  }, []);

  // 온라인 상태 감지
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

  // Delete 키 핸들러
  useEffect(() => {
    const handleDeleteKey = (e) => {
      if (e.key !== "Delete") return;
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
      if (focusArea === "chat") {
        if (!currentConv) return;
        setConfirmDelete({ id: currentConv.id, title: currentConv.title });
        return;
      }
      if (selectedFolderId) {
        const folder = folders.find((f) => f.id === selectedFolderId);
        if (!folder) return;
        setConfirmFolderDelete({ id: folder.id, name: folder.name });
      }
    };
    window.addEventListener("keydown", handleDeleteKey);
    return () => window.removeEventListener("keydown", handleDeleteKey);
  }, [currentConv, selectedFolderId, folders, focusArea]);

  // Home에서 넘어왔을 때 새 대화 생성
  useEffect(() => {
    if (location.state?.newChat) {
      if (!startedFromHomeRef.current) {
        startedFromHomeRef.current = true;
        handleNewChat();
        navigate(location.pathname, { replace: true, state: {} });
      }
    } else if (conversations.length === 0) {
      if (!startedFromHomeRef.current) {
        startedFromHomeRef.current = true;
        handleNewChat();
      }
    }
  }, [location, navigate, conversations.length]);


  // -------------------------------------------------------
  // 3. 기능 핸들러 (Functions)
  // -------------------------------------------------------

  // --- 음성 합성 (TTS) ---
  const speak = (text, messageIndex = null) => {
    if (typeof window === "undefined") return;
    if (!text) return;
    if (!synthRef.current && window.speechSynthesis) synthRef.current = window.speechSynthesis;
    if (!synthRef.current || !window.SpeechSynthesisUtterance) {
      console.warn("이 브라우저에서는 음성 합성을 사용할 수 없습니다.");
      return;
    }

    setIsPaused(false);
    setSpeakingText(text);
    if (typeof messageIndex === "number") {
      setSpeakingMessageIndex(messageIndex);
      setSpeakingCharIndex(0);
    } else {
      setSpeakingMessageIndex(null);
      setSpeakingCharIndex(0);
    }

    synthRef.current.cancel();

    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.1;
    utterance.volume = 1.0;

    utterance.onstart = () => {
      setIsSpeaking(true);
      setIsListening(false);
      setIsPaused(false);
      setSpeakingCharIndex(0);
    };
    utterance.onboundary = (event) => {
      const idx = typeof event.charIndex === "number" ? event.charIndex : 0;
      if (idx >= 0) setSpeakingCharIndex(idx);
    };
    const resetSpeakState = () => {
      setIsSpeaking(false);
      setSpeakingText("");
      setSpeakingMessageIndex(null);
      setSpeakingCharIndex(0);
      setIsPaused(false);
    };
    utterance.onend = resetSpeakState;
    utterance.onerror = resetSpeakState;

    // 한국어 음성 선택
    let voices = synthRef.current.getVoices();
    const setKoreanVoiceAndSpeak = () => {
      const korVoice = voices.find((v) => v.lang.includes("ko") || v.name.includes("Korean") || v.name.includes("한국어")) || null;
      if (korVoice) {
        utterance.voice = korVoice;
        utterance.lang = korVoice.lang;
      } else {
        utterance.lang = "ko-KR";
      }
      synthRef.current.speak(utterance);
    };

    if (!voices || voices.length === 0) {
      synthRef.current.onvoiceschanged = () => {
        voices = synthRef.current.getVoices();
        setKoreanVoiceAndSpeak();
      };
    } else {
      setKoreanVoiceAndSpeak();
    }
  };

  const stopGlobalSpeak = () => {
    if (typeof window !== "undefined") {
      if (synthRef.current) synthRef.current.cancel();
      else if (window.speechSynthesis) window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setIsPaused(false);
    setSpeakingText("");
    setSpeakingMessageIndex(null);
    setSpeakingCharIndex(0);
  };

  const appendBotMessageAndSpeak = (targetConvId, text) => {
    if (!text) return;
    let newIndex = null;
    setChatState((prev) => {
      const now = Date.now();
      const updated = (prev.conversations || []).map((conv) => {
        if (conv.id !== targetConvId) return conv;
        const newMessages = [...conv.messages, { role: "bot", text }];
        newIndex = newMessages.length - 1;
        return { ...conv, messages: newMessages, updatedAt: now };
      });
      return { ...prev, conversations: updated };
    });
    setTimeout(() => {
      speak(text, newIndex);
    }, 50);
  };

  // --- 음성 인식 (STT) ---
  const setupRecognition = () => {
    if (recognitionRef.current) return;
    if (typeof window === "undefined") return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
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
      setIsPaused(false);
      if (synthRef.current) synthRef.current.cancel();
    };
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
  };

  const stopRecognition = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }
    setIsListening(false);
  };

  // --- 메시지 전송 ---
  const sendMessage = async (content) => {
    const trimmed = (content || "").trim();
    if (!trimmed || loading || !currentConv) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setIsOnline(false);
      // ✅ 유틸 함수 사용: makeErrorInfo
      setErrorInfo(makeErrorInfo("Network is offline"));
      return;
    }

    const targetConvId = currentConv.id;
    setErrorInfo(null);
    setLoading(true);
    setPendingConvId(targetConvId);
    setMenuOpenId(null);
    setFolderMenuOpenId(null);

    // 로딩 페이즈 타이머
    phaseTimersRef.current.forEach((id) => clearTimeout(id));
    phaseTimersRef.current = [];
    setLoadingPhase("understanding");
    const t1 = setTimeout(() => setLoadingPhase((prev) => prev === "understanding" ? "searching" : prev), 900);
    const t2 = setTimeout(() => setLoadingPhase((prev) => prev === "searching" ? "composing" : prev), 1800);
    phaseTimersRef.current.push(t1, t2);

    setChatState((prev) => {
      const now = Date.now();
      const updated = (prev.conversations || []).map((conv) => {
        if (conv.id !== targetConvId) return conv;
        const newMessages = [...conv.messages, { role: "user", text: trimmed }];
        const hasUserBefore = conv.messages.some((m) => m.role === "user");
        // ✅ 유틸 함수 사용: summarizeTitleFromMessages
        const newTitle = hasUserBefore ? conv.title : summarizeTitleFromMessages(newMessages);
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
        // ✅ 유틸 함수 사용
        setErrorInfo(makeErrorInfo(data.error));
        appendBotMessageAndSpeak(targetConvId, "죄송합니다. 오류 때문에 지금은 답변을 생성하지 못했습니다.");
      } else {
        const answer = data.answer || "(응답이 없습니다)";
        appendBotMessageAndSpeak(targetConvId, answer);
      }
    } catch (err) {
      setIsOnline(false);
      // ✅ 유틸 함수 사용
      setErrorInfo(makeErrorInfo(err?.message || err));
      appendBotMessageAndSpeak(targetConvId, "서버에 연결하는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
      setPendingConvId(null);
      phaseTimersRef.current.forEach((id) => clearTimeout(id));
      phaseTimersRef.current = [];
      setLoadingPhase(null);
    }
  };

  // --- 버튼 핸들러 ---
  const handlePlayClick = () => {
    if (typeof window === "undefined") return;
    if (!synthRef.current && window.speechSynthesis) synthRef.current = window.speechSynthesis;
    if (!synthRef.current) return;

    if (isSpeaking) {
      if (synthRef.current.paused) {
        synthRef.current.resume();
        setIsPaused(false);
      } else {
        synthRef.current.pause();
        setIsPaused(true);
      }
      return;
    }
    if (!currentConv || !currentConv.messages) return;
    const msgs = currentConv.messages;
    let targetIndex = null;
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      if (msgs[i].role === "bot" && msgs[i].text) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex !== null) speak(msgs[targetIndex].text, targetIndex);
  };

  const handleMicClick = () => {
    if (loading) return;
    setupRecognition();
    if (!recognitionRef.current) return;
    if (isListening) {
      stopRecognition();
      const trimmed = input.trim();
      if (trimmed) {
        setTimeout(() => { sendMessage(trimmed); setInput(""); }, 200);
      } else { setInput(""); }
    } else {
      setInput("");
      try { recognitionRef.current.start(); } catch {
        try { recognitionRef.current.stop(); recognitionRef.current.start(); } catch (e) { console.error(e); }
      }
    }
  };

  // --- 채팅/폴더 관리 핸들러 ---
  const handleNewChat = () => {
    if (synthRef.current) synthRef.current.cancel();
    stopRecognition();
    setIsSpeaking(false); setIsListening(false); setIsPaused(false);
    setInput(""); setSpeakingText(""); setSpeakingMessageIndex(null); setSpeakingCharIndex(0);

    // ✅ 유틸 함수 사용: createNewConversation
    const newConv = createNewConversation(VOICE_GREETING_TEXT);
    setChatState((prev) => {
      const prevList = prev.conversations || [];
      const newList = [...prevList, newConv];
      return { ...prev, conversations: newList, currentId: newConv.id };
    });

    setTimeout(() => { speak(VOICE_GREETING_TEXT, 0); }, 100);
    setSelectedFolderId(null); setErrorInfo(null); setMenuOpenId(null);
    setFolderMenuOpenId(null); setFocusArea("chat"); setChatSearch("");
  };

  const handleSelectConversation = (id) => {
    setChatState((prev) => ({ ...prev, currentId: id }));
    setSelectedFolderId(null); setErrorInfo(null); setMenuOpenId(null);
    setFolderMenuOpenId(null); setFocusArea("chat"); setIsSearchModalOpen(false);
    if (synthRef.current) synthRef.current.cancel();
    stopRecognition();
    setIsSpeaking(false); setIsListening(false); setIsPaused(false);
    setInput(""); setSpeakingText(""); setSpeakingMessageIndex(null); setSpeakingCharIndex(0);
  };

  const handleDeleteConversation = (id) => {
    setChatState((prev) => {
      const list = prev.conversations || [];
      const deleteIndex = list.findIndex((c) => c.id === id);
      if (deleteIndex === -1) return prev;
      let filtered = list.filter((c) => c.id !== id);
      let newCurrentId = prev.currentId;
      if (filtered.length === 0) {
        // ✅ 유틸 함수 사용
        const newConv = createNewConversation(VOICE_GREETING_TEXT);
        filtered = [newConv]; newCurrentId = newConv.id;
      } else if (prev.currentId === id) {
        const samePosIndex = deleteIndex >= 0 && deleteIndex < filtered.length ? deleteIndex : filtered.length - 1;
        newCurrentId = filtered[samePosIndex].id;
      }
      return { ...prev, conversations: filtered, currentId: newCurrentId };
    });
    if (id === pendingConvId) { setPendingConvId(null); setLoading(false); }
    setMenuOpenId(null); setFolderMenuOpenId(null); setFocusArea("chat");
  };

  const handleRenameConversation = (id, newTitle) => {
    const trimmed = (newTitle || "").trim();
    if (!trimmed) return;
    setChatState((prev) => ({
      ...prev,
      conversations: (prev.conversations || []).map((c) => c.id === id ? { ...c, title: trimmed, updatedAt: Date.now() } : c),
    }));
    setMenuOpenId(null); setFolderMenuOpenId(null);
  };

  // --- 폴더 관리 핸들러 ---
  const handleCreateFolder = () => { setNewFolderName(""); setFolderCreateModalOpen(true); setPendingFolderConvId(null); setFocusArea("folder"); };
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
        nextConversations = nextConversations.map((c) => c.id === pendingFolderConvId ? { ...c, folderId } : c);
      }
      return { ...prev, folders: nextFolders, conversations: nextConversations };
    });
    setFolderCreateModalOpen(false); setNewFolderName(""); setPendingFolderConvId(null);
  };

  const handleRenameFolder = (folderId) => {
    const target = folders.find((f) => f.id === folderId);
    setFolderRenameInfo({ id: folderId, value: target?.name || "" });
    setFolderMenuOpenId(null); setMenuOpenId(null);
  };
  const handleRenameFolderConfirm = () => {
    if (!folderRenameInfo) return;
    const trimmed = (folderRenameInfo.value || "").trim();
    if (!trimmed) return;
    setChatState((prev) => ({
      ...prev,
      folders: (prev.folders || []).map((f) => f.id === folderRenameInfo.id ? { ...f, name: trimmed } : f),
    }));
    setFolderRenameInfo(null);
  };
  const handleDeleteFolder = (folderId) => {
    setChatState((prev) => {
      const list = prev.folders || [];
      const filtered = list.filter((f) => f.id !== folderId);
      return {
        ...prev,
        folders: filtered,
        conversations: (prev.conversations || []).map((c) => c.folderId === folderId ? { ...c, folderId: null } : c),
      };
    });
    setSelectedFolderId((prev) => prev === folderId ? null : prev);
    setFocusArea("folder");
  };

  // --- 드래그 핸들러 묶음 (사이드바에 전달) ---
  const dragHandlers = {
      handleDragStart: (e, id) => {
          setDraggingId(id);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("application/x-chat-id", id);
          e.dataTransfer.setData("text/plain", id);
      },
      handleDragEnd: () => {
          setDraggingId(null); setDragOverId(null); setDragOverFolderId(null);
          setFolderDraggingId(null); setFolderDragOverId(null);
      },
      handleFolderItemDragStart: (e, folderId) => {
          setFolderDraggingId(folderId);
          setSelectedFolderId(folderId);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("application/x-folder-id", folderId);
          e.dataTransfer.setData("text/plain", folderId);
      },
      handleDropChatOnFolderHeader: (e, folderId, isNewFolder = false) => {
          e.preventDefault(); e.stopPropagation();
          // ✅ 유틸 함수 사용: getDraggedChatId
          const convId = draggingId || getDraggedChatId(e);
          if (!convId) return;
          if (isNewFolder) {
              setPendingFolderConvId(convId);
              setFolderCreateModalOpen(true);
          } else {
              setChatState((prev) => ({
                ...prev, conversations: (prev.conversations || []).map((c) => c.id === convId ? { ...c, folderId } : c),
              }));
          }
          setDraggingId(null); setDragOverId(null); setDragOverFolderId(null);
      },
      handleFolderDrop: (e, folderId) => {
          e.preventDefault(); e.stopPropagation();
          // ✅ 유틸 함수 사용: getDraggedFolderId
          const draggedFolderId = folderDraggingId || getDraggedFolderId(e);
          if (draggedFolderId) {
             setChatState((prev) => {
               const list = [...(prev.folders || [])];
               const fromIndex = list.findIndex((f) => f.id === draggedFolderId);
               const toIndex = list.findIndex((f) => f.id === folderId);
               if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;
               const [moved] = list.splice(fromIndex, 1);
               list.splice(toIndex, 0, moved);
               return { ...prev, folders: list };
             });
          }
          setDraggingId(null); setFolderDraggingId(null); setDragOverFolderId(null);
      },
      handleDropOnFolderChat: (e, targetConvId, folderId) => {
          e.preventDefault(); e.stopPropagation();
          const candidate = draggingId || getDraggedChatId(e);
          if (!candidate) return;
          setChatState((prev) => {
             const list = [...(prev.conversations || [])];
             const fromIndex = list.findIndex((c) => c.id === candidate);
             const toIndex = list.findIndex((c) => c.id === targetConvId);
             if (fromIndex === -1 || toIndex === -1) return prev;
             const [movedRaw] = list.splice(fromIndex, 1);
             const moved = { ...movedRaw, folderId };
             list.splice(toIndex, 0, moved); // Insert logic simplified
             return { ...prev, conversations: list };
          });
      },
      handleDropOnRootItem: (e, targetConvId) => {
          e.preventDefault(); e.stopPropagation();
          const candidate = draggingId || getDraggedChatId(e);
          if (!candidate) return;
          setChatState((prev) => {
             const list = [...(prev.conversations || [])];
             const fromIndex = list.findIndex((c) => c.id === candidate);
             if (fromIndex === -1) return prev;
             const [movedRaw] = list.splice(fromIndex, 1);
             const moved = movedRaw.folderId !== null ? { ...movedRaw, folderId: null } : movedRaw;
             const toIndex = list.findIndex(c => c.id === targetConvId);
             list.splice(toIndex, 0, moved);
             return { ...prev, conversations: list };
          });
          setSelectedFolderId(null); setFocusArea("chat");
      },
      handleRootListDrop: (e) => {
         e.preventDefault(); e.stopPropagation();
         const candidate = draggingId || getDraggedChatId(e);
         if (!candidate) return;
         setChatState((prev) => {
            const list = [...(prev.conversations || [])];
            const fromIndex = list.findIndex((c) => c.id === candidate);
            if (fromIndex === -1) return prev;
            const [movedRaw] = list.splice(fromIndex, 1);
            const moved = movedRaw.folderId !== null ? { ...movedRaw, folderId: null } : movedRaw;
            list.push(moved);
            return { ...prev, conversations: list };
         });
         setSelectedFolderId(null); setFocusArea("chat");
      },
      onOpenSearch: () => setIsSearchModalOpen(true),
      setFocusArea: setFocusArea
  };

  // -------------------------------------------------------
  // 4. 렌더링
  // -------------------------------------------------------
  return (
    <div className="page chat-page voice-mode">
      {/* 1. 사이드바 (공통 컴포넌트 사용) */}
      <ChatSidebar 
          sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}
          sidebarCollapsed={sidebarCollapsed} setSidebarCollapsed={setSidebarCollapsed}
          folders={chatState.folders}
          conversations={chatState.conversations}
          currentId={chatState.currentId}
          selectedFolderId={selectedFolderId}
          loading={loading}
          pendingConvId={pendingConvId}
          
          onNewChat={handleNewChat}
          onSelectConversation={handleSelectConversation}
          onSelectFolder={setSelectedFolderId}
          onCreateFolder={handleCreateFolder}
          onToggleFolder={toggleFolder}
          isFolderCollapsed={isFolderCollapsed}
          
          setMenuOpenId={setMenuOpenId} setMenuPosition={setMenuPosition}
          setMenuInFolder={setMenuInFolder}
          setFolderMenuOpenId={setFolderMenuOpenId} setFolderMenuPosition={setFolderMenuPosition}
          dragHandlers={dragHandlers}
      />

      <div className="chat-shell" onMouseDown={() => { setFocusArea("chat"); setSelectedFolderId(null); }}>
        <ChatHeader isOnline={isOnline} onClickLogo={() => navigate("/")} />
        <main className="chat-main">
          <div className="chat-container">
            {/* 2. 음성 전용 메시지 리스트 */}
            <VoiceChatMessages
                messages={messages}
                isCurrentPending={isCurrentPending}
                loadingPhase={loadingPhase}
                hoveredMessageIndex={hoveredMessageIndex} setHoveredMessageIndex={setHoveredMessageIndex}
                openMessageMenuIndex={openMessageMenuIndex} setOpenMessageMenuIndex={setOpenMessageMenuIndex}
                handleCopyMessage={handleCopyMessage}
                handleDeleteMessage={(idx) => { 
                   if (idx === speakingMessageIndex) stopGlobalSpeak();
                   setChatState(prev => {
                       const now = Date.now();
                       const updated = prev.conversations.map(c => c.id === currentConv.id ? {...c, messages: c.messages.filter((_, i) => i !== idx), updatedAt: now} : c);
                       return {...prev, conversations: updated};
                   });
                }}
                messagesEndRef={messagesEndRef}
                speakingMessageIndex={speakingMessageIndex}
                speakingCharIndex={speakingCharIndex}
                onStopGlobalSpeak={stopGlobalSpeak}
            />

            {/* 3. 음성 컨트롤러 (분리된 컴포넌트) */}
            <VoiceControls 
                isListening={isListening}
                isSpeaking={isSpeaking}
                isPaused={isPaused}
                loading={loading}
                input={input}
                hasSpeakableBotMessage={hasSpeakableBotMessage}
                onPlayClick={handlePlayClick}
                onMicClick={handleMicClick}
            />
          </div>
        </main>
      </div>

      {/* 4. 공통 모달 (통합된 컴포넌트) */}
      <GlobalModals 
          isSearchModalOpen={isSearchModalOpen}
          chatSearch={chatSearch} onSearchChange={(e) => setChatSearch(e.target.value)}
          searchResults={modalSearchResults}
          onSearchResultClick={handleSelectConversation}
          onCloseSearch={() => setIsSearchModalOpen(false)}

          menuOpenId={menuOpenId} menuPosition={menuPosition} menuInFolder={menuInFolder}
          onMenuAction={(action, id) => {
              if (action === "delete") openDeleteConfirmModal(id, activeMenuConversation?.title);
              if (action === "rename") openRenameModal(id, activeMenuConversation?.title);
              if (action === "details") setDetailsModalChat(activeMenuConversation);
              if (action === "moveToRoot") {
                   setChatState(prev => ({...prev, conversations: prev.conversations.map(c => c.id === id ? {...c, folderId: null} : c)}));
                   setMenuOpenId(null);
              }
          }}

          folderMenuOpenId={folderMenuOpenId} folderMenuPosition={folderMenuPosition}
          onFolderMenuAction={(action, id) => {
              if (action === "delete") openFolderDeleteConfirmModal(id, activeMenuFolder?.name);
              if (action === "rename") handleRenameFolder(id);
          }}
          
          confirmDelete={confirmDelete} onDeleteConfirm={() => { handleDeleteConversation(confirmDelete.id); setConfirmDelete(null); }} onCancelDelete={() => setConfirmDelete(null)}
          confirmFolderDelete={confirmFolderDelete} onDeleteFolderConfirm={() => { handleDeleteFolder(confirmFolderDelete.id); setConfirmFolderDelete(null); }} onCancelFolderDelete={() => setConfirmFolderDelete(null)}
          
          folderCreateModalOpen={folderCreateModalOpen} newFolderName={newFolderName} onNewFolderNameChange={(e) => setNewFolderName(e.target.value)} onCreateFolderConfirm={handleCreateFolderConfirm} onCancelCreateFolder={() => setFolderCreateModalOpen(false)}
          renameInfo={renameInfo} onRenameChange={(e) => setRenameInfo({...renameInfo, value: e.target.value})} onRenameConfirm={() => { handleRenameConversation(renameInfo.id, renameInfo.value); setRenameInfo(null); }} onCancelRename={() => setRenameInfo(null)}
          folderRenameInfo={folderRenameInfo} onFolderRenameChange={(e) => setFolderRenameInfo({...folderRenameInfo, value: e.target.value})} onFolderRenameConfirm={handleRenameFolderConfirm} onCancelFolderRename={() => setFolderRenameInfo(null)}

          detailsModalChat={detailsModalChat} onCloseDetails={() => setDetailsModalChat(null)} folders={folders}
          
          errorInfo={errorInfo} onCloseError={() => setErrorInfo(null)} onOpenErrorDetail={() => { /* window.open logic */ }}
          copyToastVisible={copyToastVisible}
      />
    </div>
  );
}

export default VoiceChatPage;