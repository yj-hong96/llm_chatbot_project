// src/pages/VoiceChatPage.jsx
import { useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";

// ✅ 공통 유틸
import {
  STORAGE_KEY_VOICE,
  VOICE_GREETING_TEXT,
  getInitialChatState,
  createNewConversation,
  makeErrorInfo,
  summarizeTitleFromMessages,
  getDraggedChatId,
  getDraggedFolderId,
} from "../utils/chatUtils";

// ✅ 공통 컴포넌트
import ChatHeader from "../components/common/ChatHeader";
import ChatSidebar from "../components/common/ChatSidebar";
import GlobalModals from "../components/common/GlobalModals";

// ✅ 음성 전용 컴포넌트
import VoiceChatMessages from "../components/voice/VoiceChatMessages";
import VoiceControls from "../components/voice/VoiceControls";

import "../voicechatApp.css";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5000";

function VoiceChatPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // -------------------------------------------------------
  // 1. 상태 관리
  // -------------------------------------------------------
  const [isOnline, setIsOnline] = useState(true);

  // 메시지 UI 상태
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

  // 채팅 데이터 & 입력
  const [chatState, setChatState] = useState(() =>
    getInitialChatState(STORAGE_KEY_VOICE)
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorInfo, setErrorInfo] = useState(null);
  const [focusArea, setFocusArea] = useState("chat");

  // 검색 & 모달
  const [chatSearch, setChatSearch] = useState("");
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [pendingConvId, setPendingConvId] = useState(null);

  // 컨텍스트 메뉴
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [menuPosition, setMenuPosition] = useState(null);
  const [menuInFolder, setMenuInFolder] = useState(false);

  // 폴더 메뉴
  const [folderMenuOpenId, setFolderMenuOpenId] = useState(null);
  const [folderMenuPosition, setFolderMenuPosition] = useState(null);

  // 모달 상태
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [renameInfo, setRenameInfo] = useState(null);
  const [confirmFolderDelete, setConfirmFolderDelete] = useState(null);
  const [folderCreateModalOpen, setFolderCreateModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderRenameInfo, setFolderRenameInfo] = useState(null);
  const [pendingFolderConvId, setPendingFolderConvId] = useState(null);
  const [detailsModalChat, setDetailsModalChat] = useState(null);

  // 사이드바
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState(null);

  // 음성 상태
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speakingText, setSpeakingText] = useState("");
  const [speakingMessageIndex, setSpeakingMessageIndex] = useState(null);
  const [speakingCharIndex, setSpeakingCharIndex] = useState(0);

  // 드래그 상태
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverFolderId, setDragOverFolderId] = useState(null);
  const [folderDraggingId, setFolderDraggingId] = useState(null);
  const [folderDragOverId, setFolderDragOverId] = useState(null);

  // ref
  const messagesEndRef = useRef(null);
  const startedFromHomeRef = useRef(false);
  const recognitionRef = useRef(null);
  const synthRef = useRef(null);
  const initialGreetingSpokenRef = useRef(false);

  // -------------------------------------------------------
  // 2. 파생 값
  // -------------------------------------------------------
  const conversations = chatState.conversations || [];
  const folders = chatState.folders || [];
  const currentId = chatState.currentId;
  const currentConv =
    conversations.find((c) => c.id === currentId) || conversations[0];
  const messages = currentConv ? currentConv.messages : [];

  const hasSpeakableBotMessage =
    messages && messages.some((m) => m.role === "bot" && m.text);

  const isCurrentPending =
    loading && currentConv && pendingConvId && currentConv.id === pendingConvId;

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

  // -------------------------------------------------------
  // 3. useEffect
  // -------------------------------------------------------

  // 음성 합성 초기화
  useEffect(() => {
    if (typeof window !== "undefined") {
      synthRef.current = window.speechSynthesis;
    }
  }, []);

  // 로컬스토리지 저장
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
      messagesEndRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }
  }, [messages, pendingConvId]);

  // 언마운트 클린업
  useEffect(() => {
    return () => {
      phaseTimersRef.current.forEach((id) => clearTimeout(id));
      phaseTimersRef.current = [];
      if (synthRef.current) synthRef.current.cancel();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
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

  // 전역 단축키: Ctrl/Cmd+K, Ctrl/Cmd+N
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
  }, []);

  // online / offline
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

  // ESC & Enter 모달 제어
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

  // Delete 키 삭제
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

  // Home → Voice 새 대화 시작
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

  // 인사 자동 읽기 플래그
  useEffect(() => {
    if (!currentConv || !currentConv.messages || currentConv.messages.length === 0)
      return;

    const hasUserMsg = currentConv.messages.some((m) => m.role === "user");
    if (hasUserMsg) {
      initialGreetingSpokenRef.current = true;
      return;
    }

    const firstBotIndex = currentConv.messages.findIndex(
      (m) => m.role === "bot"
    );
    if (firstBotIndex === -1) {
      initialGreetingSpokenRef.current = true;
      return;
    }

    const firstBot = currentConv.messages[firstBotIndex];
    if (!firstBot || !firstBot.text) {
      initialGreetingSpokenRef.current = true;
      return;
    }

    if (!location?.state?.newChat) {
      initialGreetingSpokenRef.current = true;
    }
  }, [currentConv, location]);

  // -------------------------------------------------------
  // 4. 음성 합성 (TTS)
  // -------------------------------------------------------
  const speak = (text, messageIndex = null) => {
    if (typeof window === "undefined") return;
    if (!text) return;

    if (!synthRef.current && window.speechSynthesis) {
      synthRef.current = window.speechSynthesis;
    }
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

    let voices = synthRef.current.getVoices();

    const setKoreanVoiceAndSpeak = () => {
      const korVoice =
        voices.find(
          (v) =>
            v.lang.includes("ko") ||
            v.name.includes("Korean") ||
            v.name.includes("한국어")
        ) || null;

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

  // -------------------------------------------------------
  // 5. 음성 인식 (STT)
  // -------------------------------------------------------
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
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    setIsListening(false);
  };

  // -------------------------------------------------------
  // 6. 메시지 전송
  // -------------------------------------------------------
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

    phaseTimersRef.current.forEach((id) => clearTimeout(id));
    phaseTimersRef.current = [];

    setLoadingPhase("understanding");
    const t1 = setTimeout(() => {
      setLoadingPhase((prev) =>
        prev === "understanding" ? "searching" : prev
      );
    }, 900);
    const t2 = setTimeout(() => {
      setLoadingPhase((prev) => (prev === "searching" ? "composing" : prev));
    }, 1800);
    phaseTimersRef.current.push(t1, t2);

    setChatState((prev) => {
      const now = Date.now();
      const updated = (prev.conversations || []).map((conv) => {
        if (conv.id !== targetConvId) return conv;

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
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      setIsOnline(true);

      const data = await res.json();
      if (data.error) {
        const info = makeErrorInfo(data.error);
        setErrorInfo(info);
        const msgText =
          "죄송합니다. 오류 때문에 지금은 답변을 생성하지 못했습니다. 화면 가운데 나타난 오류 안내 창을 확인해 주세요.";
        appendBotMessageAndSpeak(targetConvId, msgText);
      } else {
        const answer = data.answer || "(응답이 없습니다)";
        appendBotMessageAndSpeak(targetConvId, answer);
      }
    } catch (err) {
      setIsOnline(false);
      const info = makeErrorInfo(err?.message || err);
      setErrorInfo(info);
      const msgText =
        "서버에 연결하는 중 오류가 발생했습니다. 화면 가운데 오류 안내 창을 확인해 주세요.";
      appendBotMessageAndSpeak(targetConvId, msgText);
    } finally {
      setLoading(false);
      setPendingConvId(null);
      phaseTimersRef.current.forEach((id) => clearTimeout(id));
      phaseTimersRef.current = [];
      setLoadingPhase(null);
    }
  };

  // -------------------------------------------------------
  // 7. 버튼 핸들러
  // -------------------------------------------------------
  const handlePlayClick = () => {
    if (typeof window === "undefined") return;

    if (!synthRef.current && window.speechSynthesis) {
      synthRef.current = window.speechSynthesis;
    }
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

    if (!currentConv || !currentConv.messages || currentConv.messages.length === 0)
      return;

    const msgs = currentConv.messages;
    let targetIndex = null;
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      if (msgs[i].role === "bot" && msgs[i].text) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === null) return;

    const text = msgs[targetIndex].text;
    if (!text) return;

    speak(text, targetIndex);
  };

  const handleMicClick = () => {
    if (loading) return;

    setupRecognition();
    if (!recognitionRef.current) return;

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

  // -------------------------------------------------------
  // 8. 채팅 / 폴더 관리
  // -------------------------------------------------------
  const handleNewChat = () => {
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
    setIsPaused(false);
    setInput("");
    setSpeakingText("");
    setSpeakingMessageIndex(null);
    setSpeakingCharIndex(0);

    const newConv = createNewConversation(VOICE_GREETING_TEXT);
    setChatState((prev) => {
      const prevList = prev.conversations || [];
      const newList = [...prevList, newConv];
      return { ...prev, conversations: newList, currentId: newConv.id };
    });

    setTimeout(() => {
      speak(VOICE_GREETING_TEXT, 0);
    }, 100);

    setSelectedFolderId(null);
    setErrorInfo(null);
    setMenuOpenId(null);
    setFolderMenuOpenId(null);
    setFocusArea("chat");
    setChatSearch("");
  };

  const handleSelectConversation = (id) => {
    setChatState((prev) => ({ ...prev, currentId: id }));
    setSelectedFolderId(null);
    setErrorInfo(null);
    setMenuOpenId(null);
    setFolderMenuOpenId(null);
    setFocusArea("chat");
    setIsSearchModalOpen(false);

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
    setIsPaused(false);
    setInput("");
    setSpeakingText("");
    setSpeakingMessageIndex(null);
    setSpeakingCharIndex(0);
  };

  const handleDeleteConversation = (id) => {
    setChatState((prev) => {
      const list = prev.conversations || [];
      const deleteIndex = list.findIndex((c) => c.id === id);
      if (deleteIndex === -1) return prev;

      let filtered = list.filter((c) => c.id !== id);
      let newCurrentId = prev.currentId;

      if (filtered.length === 0) {
        const newConv = createNewConversation(VOICE_GREETING_TEXT);
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

  // 폴더
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

  // -------------------------------------------------------
  // 9. 드래그 핸들러 (ChatSidebar 로 전달)
  // -------------------------------------------------------
  const dragHandlers = {
    handleDragStart: (e, id) => {
      setDraggingId(id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-chat-id", id);
      e.dataTransfer.setData("text/plain", id);
    },
    handleDragEnd: () => {
      setDraggingId(null);
      setDragOverId(null);
      setDragOverFolderId(null);
      setFolderDraggingId(null);
      setFolderDragOverId(null);
    },
    handleFolderItemDragStart: (e, folderId) => {
      setFolderDraggingId(folderId);
      setSelectedFolderId(folderId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-folder-id", folderId);
      e.dataTransfer.setData("text/plain", folderId);
    },
    handleDropChatOnFolderHeader: (e, folderId, isNewFolder = false) => {
      e.preventDefault();
      e.stopPropagation();
      const convId = draggingId || getDraggedChatId(e);
      if (!convId) return;

      if (isNewFolder) {
        setPendingFolderConvId(convId);
        setFolderCreateModalOpen(true);
      } else {
        setChatState((prev) => ({
          ...prev,
          conversations: (prev.conversations || []).map((c) =>
            c.id === convId ? { ...c, folderId } : c
          ),
        }));
      }

      setDraggingId(null);
      setDragOverId(null);
      setDragOverFolderId(null);
    },
    handleFolderDrop: (e, folderId) => {
      e.preventDefault();
      e.stopPropagation();
      const draggedFolderId = folderDraggingId || getDraggedFolderId(e);
      if (draggedFolderId) {
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
      }
      setDraggingId(null);
      setFolderDraggingId(null);
      setDragOverFolderId(null);
    },
    handleDropOnFolderChat: (e, targetConvId, folderId) => {
      e.preventDefault();
      e.stopPropagation();
      const candidate = draggingId || getDraggedChatId(e);
      if (!candidate) return;
      setChatState((prev) => {
        const list = [...(prev.conversations || [])];
        const fromIndex = list.findIndex((c) => c.id === candidate);
        const toIndex = list.findIndex((c) => c.id === targetConvId);
        if (fromIndex === -1 || toIndex === -1) return prev;
        const [movedRaw] = list.splice(fromIndex, 1);
        const moved = { ...movedRaw, folderId };
        list.splice(toIndex, 0, moved);
        return { ...prev, conversations: list };
      });
    },
    handleDropOnRootItem: (e, targetConvId) => {
      e.preventDefault();
      e.stopPropagation();
      const candidate = draggingId || getDraggedChatId(e);
      if (!candidate) return;
      setChatState((prev) => {
        const list = [...(prev.conversations || [])];
        const fromIndex = list.findIndex((c) => c.id === candidate);
        if (fromIndex === -1) return prev;
        const [movedRaw] = list.splice(fromIndex, 1);
        const moved =
          movedRaw.folderId !== null ? { ...movedRaw, folderId: null } : movedRaw;
        const toIndex = list.findIndex((c) => c.id === targetConvId);
        list.splice(toIndex, 0, moved);
        return { ...prev, conversations: list };
      });
      setSelectedFolderId(null);
      setFocusArea("chat");
    },
    handleRootListDrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      const candidate = draggingId || getDraggedChatId(e);
      if (!candidate) return;
      setChatState((prev) => {
        const list = [...(prev.conversations || [])];
        const fromIndex = list.findIndex((c) => c.id === candidate);
        if (fromIndex === -1) return prev;
        const [movedRaw] = list.splice(fromIndex, 1);
        const moved =
          movedRaw.folderId !== null ? { ...movedRaw, folderId: null } : movedRaw;
        list.push(moved);
        return { ...prev, conversations: list };
      });
      setSelectedFolderId(null);
      setFocusArea("chat");
    },
    onOpenSearch: () => setIsSearchModalOpen(true),
    setFocusArea,
  };

  // -------------------------------------------------------
  // 10. 메시지 삭제 / 복사 / 에러 상세
  // -------------------------------------------------------
  const handleDeleteMessage = (idx) => {
    if (!currentConv) return;
    if (idx === speakingMessageIndex) {
      stopGlobalSpeak();
    }

    setChatState((prev) => {
      const now = Date.now();
      const updated = (prev.conversations || []).map((conv) => {
        if (conv.id !== currentConv.id) return conv;
        const newMessages = conv.messages.filter((_, i) => i !== idx);
        return { ...conv, messages: newMessages, updatedAt: now };
      });
      return { ...prev, conversations: updated };
    });
  };

  const handleCopyMessage = (text) => {
    if (!navigator.clipboard) {
      alert("클립보드 복사를 지원하지 않는 브라우저입니다.");
      return;
    }

    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopyToastVisible(false);
        requestAnimationFrame(() => setCopyToastVisible(true));
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

  // -------------------------------------------------------
  // 11. 렌더링
  // -------------------------------------------------------
  return (
    <div className="page chat-page voice-mode">
      {/* ChatPage 와 동일한 폰트/모달/보이스 스타일 */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap');

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

        /* 음성 컨트롤 */
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
          text-align: center;
        }

        .voice-button-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
        }

        .play-button {
          width: 48px;
          height: 48px;
          border-radius: 999px;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          box-shadow: 0 8px 18px rgba(0,0,0,0.12);
          background: linear-gradient(135deg, #111827, #4b5563);
          color: #f9fafb;
          transition: all 0.2s ease;
        }
        .play-button:hover:not(.disabled) {
          transform: translateY(-1px) scale(1.03);
          box-shadow: 0 12px 22px rgba(0,0,0,0.16);
        }
        .play-button:active:not(.disabled) {
          transform: translateY(1px) scale(0.97);
          box-shadow: 0 6px 14px rgba(0,0,0,0.12);
        }
        .play-button.playing {
          background: linear-gradient(135deg, #10b981, #059669);
        }
        .play-button.paused {
          background: linear-gradient(135deg, #6b7280, #4b5563);
        }
        .play-button.disabled {
          opacity: 0.35;
          cursor: default;
          box-shadow: none;
          transform: none;
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

        .chat-tts-highlight {
          background: #fff3b0;
          transition: background-color 0.15s ease-out;
        }
      `}</style>

      {/* 모바일용 사이드바 토글 버튼 (ChatPage 와 동일 구조) */}
      <button
        className="sidebar-toggle-btn"
        onClick={(e) => {
          e.stopPropagation();
          setSidebarOpen((prev) => !prev);
        }}
        aria-label="사이드바 토글"
      />

      {/* ChatPage 와 같은 레이아웃 래퍼 */}
      <div className="chat-layout">
        {/* 좌측 사이드바 */}
        <ChatSidebar
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          sidebarCollapsed={sidebarCollapsed}
          setSidebarCollapsed={setSidebarCollapsed}
          folders={folders}
          conversations={conversations}
          currentId={currentId}
          selectedFolderId={selectedFolderId}
          loading={loading}
          pendingConvId={pendingConvId}
          onNewChat={handleNewChat}
          onSelectConversation={handleSelectConversation}
          onSelectFolder={setSelectedFolderId}
          onCreateFolder={handleCreateFolder}
          onToggleFolder={toggleFolder}
          isFolderCollapsed={isFolderCollapsed}
          setMenuOpenId={setMenuOpenId}
          setMenuPosition={setMenuPosition}
          setMenuInFolder={setMenuInFolder}
          setFolderMenuOpenId={setFolderMenuOpenId}
          setFolderMenuPosition={setFolderMenuPosition}
          dragHandlers={dragHandlers}
        />

        {/* 우측 챗봇 영역 */}
        <div
          className="chat-shell"
          onMouseDown={() => {
            setFocusArea("chat");
            setSelectedFolderId(null);
          }}
        >
          <ChatHeader isOnline={isOnline} onClickLogo={() => navigate("/")} />

          <main className="chat-main">
            <div className="chat-container">
              {/* 음성 전용 메시지 리스트 */}
              <VoiceChatMessages
                messages={messages}
                isCurrentPending={isCurrentPending}
                loadingPhase={loadingPhase}
                hoveredMessageIndex={hoveredMessageIndex}
                setHoveredMessageIndex={setHoveredMessageIndex}
                openMessageMenuIndex={openMessageMenuIndex}
                setOpenMessageMenuIndex={setOpenMessageMenuIndex}
                handleCopyMessage={handleCopyMessage}
                handleDeleteMessage={handleDeleteMessage}
                messagesEndRef={messagesEndRef}
                speakingMessageIndex={speakingMessageIndex}
                speakingCharIndex={speakingCharIndex}
                onStopGlobalSpeak={stopGlobalSpeak}
              />

              {/* 음성 컨트롤 UI */}
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
      </div>

      {/* 공통 모달들 */}
      <GlobalModals
        isSearchModalOpen={isSearchModalOpen}
        chatSearch={chatSearch}
        onSearchChange={(e) => setChatSearch(e.target.value)}
        searchResults={modalSearchResults}
        onSearchResultClick={handleSelectConversation}
        onCloseSearch={() => setIsSearchModalOpen(false)}
        menuOpenId={menuOpenId}
        menuPosition={menuPosition}
        menuInFolder={menuInFolder}
        onMenuAction={(action, id) => {
          if (!id) return;
          if (action === "delete") {
            openDeleteConfirmModal(id, activeMenuConversation?.title);
          } else if (action === "rename") {
            openRenameModal(id, activeMenuConversation?.title);
          } else if (action === "details") {
            setDetailsModalChat(activeMenuConversation || null);
          } else if (action === "moveToRoot") {
            handleMoveConversationToRoot(id);
          }
        }}
        folderMenuOpenId={folderMenuOpenId}
        folderMenuPosition={folderMenuPosition}
        onFolderMenuAction={(action, id) => {
          if (!id) return;
          if (action === "delete") {
            openFolderDeleteConfirmModal(id, activeMenuFolder?.name);
          } else if (action === "rename") {
            handleRenameFolder(id);
          }
        }}
        confirmDelete={confirmDelete}
        onDeleteConfirm={() => {
          if (!confirmDelete) return;
          handleDeleteConversation(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancelDelete={() => setConfirmDelete(null)}
        confirmFolderDelete={confirmFolderDelete}
        onDeleteFolderConfirm={() => {
          if (!confirmFolderDelete) return;
          handleDeleteFolder(confirmFolderDelete.id);
          setConfirmFolderDelete(null);
        }}
        onCancelFolderDelete={() => setConfirmFolderDelete(null)}
        folderCreateModalOpen={folderCreateModalOpen}
        newFolderName={newFolderName}
        onNewFolderNameChange={(e) => setNewFolderName(e.target.value)}
        onCreateFolderConfirm={handleCreateFolderConfirm}
        onCancelCreateFolder={() => {
          setFolderCreateModalOpen(false);
          setNewFolderName("");
          setPendingFolderConvId(null);
        }}
        renameInfo={renameInfo}
        onRenameChange={(e) =>
          setRenameInfo((prev) =>
            prev ? { ...prev, value: e.target.value } : prev
          )
        }
        onRenameConfirm={() => {
          if (!renameInfo) return;
          handleRenameConversation(renameInfo.id, renameInfo.value);
          setRenameInfo(null);
        }}
        onCancelRename={() => setRenameInfo(null)}
        folderRenameInfo={folderRenameInfo}
        onFolderRenameChange={(e) =>
          setFolderRenameInfo((prev) =>
            prev ? { ...prev, value: e.target.value } : prev
          )
        }
        onFolderRenameConfirm={handleRenameFolderConfirm}
        onCancelFolderRename={() => setFolderRenameInfo(null)}
        detailsModalChat={detailsModalChat}
        onCloseDetails={() => setDetailsModalChat(null)}
        folders={folders}
        errorInfo={errorInfo}
        onCloseError={() => setErrorInfo(null)}
        onOpenErrorDetail={openErrorDetailWindow}
        copyToastVisible={copyToastVisible}
      />
    </div>
  );
}

export default VoiceChatPage;
