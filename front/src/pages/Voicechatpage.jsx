import { useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useRef, useCallback } from "react";

// ---------------------------------------------------------
// [설정] 환경 변수 및 상수
// ---------------------------------------------------------
const STORAGE_KEY = "voiceConversations_v1"; 
const API_BASE = "http://127.0.0.1:5000"; 

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_INIT_WIDTH = 220;

// ---------------------------------------------------------
// [스타일] 전체 CSS (단일 파일 통합)
// ---------------------------------------------------------
const PAGE_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap');
  body, .chat-page { font-family: 'Noto Sans KR', sans-serif !important; }

  /* Voice Controls */
  .voice-controls { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 12px; background: #fff; border-top: 1px solid #e5e7eb; min-height: 140px; gap: 10px; }
  .voice-transcript { font-size: 1.1rem; color: #1f2937; min-height: 28px; line-height: 1.4; text-align: center; width: 90%; max-width: 600px; background: #f9fafb; padding: 6px 12px; border-radius: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .voice-status { font-size: 0.85rem; color: #6b7280; }

  /* Mic Button */
  .mic-button { width: 64px; height: 64px; border-radius: 50%; border: none; cursor: pointer; font-size: 28px; display: flex; align-items: center; justify-content: center; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 8px 20px rgba(0,0,0,0.1); color: white; position: relative; }
  .mic-button:hover { transform: translateY(-2px) scale(1.05); box-shadow: 0 12px 25px rgba(0,0,0,0.15); }
  .mic-button:active { transform: translateY(1px) scale(0.95); }
  .mic-button.idle { background: linear-gradient(135deg, #6366f1, #4f46e5); }
  .mic-button.listening { background: linear-gradient(135deg, #ef4444, #dc2626); animation: pulse-red 1.6s infinite; }
  .mic-button.speaking { background: linear-gradient(135deg, #10b981, #059669); animation: pulse-green 1.6s infinite; }
  .mic-button.loading { background: #d1d5db; cursor: wait; animation: none; box-shadow: none; transform: none; }
  
  @keyframes pulse-red { 0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.6); } 70% { box-shadow: 0 0 0 15px rgba(239, 68, 68, 0); } 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } }
  @keyframes pulse-green { 0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); } 70% { box-shadow: 0 0 0 15px rgba(16, 185, 129, 0); } 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); } }

  /* Modals */
  .search-modal-overlay, .error-modal-overlay, .copy-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); backdrop-filter: blur(2px); z-index: 9999; display: flex; align-items: center; justify-content: center; }
  .search-modal-content { width: 600px; max-width: 90%; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1); }
  .search-modal-header { padding: 16px; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; }
  .search-modal-input { flex: 1; border: none; outline: none; font-size: 16px; margin: 0 12px; }
  .search-modal-results { max-height: 400px; overflow-y: auto; padding: 8px 0; }
  .search-result-item { padding: 12px 20px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
  .search-result-item:hover { background: #f3f4f6; }
  .search-result-date { font-size: 12px; color: #9ca3af; }
  
  .error-modal { background: #fff; border-radius: 12px; width: 400px; padding: 24px; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2); }
  .error-modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .error-modal-title { font-weight: 700; font-size: 18px; }
  .error-modal-footer { margin-top: 24px; display: flex; justify-content: flex-end; gap: 8px; }
  .error-modal-primary { background: #dc2626; color: white; padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; }
  .error-modal-secondary { background: #f3f4f6; color: #374151; padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; }
  .modal-input { width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; margin-top: 12px; font-size: 15px; }

  /* Sidebar & Layout Fixes */
  .chat-sidebar { display: flex; flex-direction: column; height: 100%; background-color: #fff; border-right: 1px solid #e5e7eb; }
  .sidebar-folder-list { flex-shrink: 0; max-height: 40%; overflow-y: auto; }
  .sidebar-chat-section { flex: 1; overflow-y: auto; min-height: 0; display: flex; flex-direction: column; }
  .sidebar-chat-list { flex: 1; overflow-y: auto; }

  /* Context Menu */
  .sidebar-chat-menu { position: fixed; background: white; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); padding: 4px 0; z-index: 10000; min-width: 140px; }
  .sidebar-chat-menu button { display: block; width: 100%; text-align: left; padding: 8px 16px; background: none; border: none; font-size: 14px; color: #374151; cursor: pointer; }
  .sidebar-chat-menu button:hover { background-color: #f3f4f6; }

  /* Drag & Drop */
  .sidebar-chat-item.dragging { opacity: 0.5; background: #f0f9ff; border: 1px dashed #3b82f6; }
  .sidebar-chat-item.drag-over { border-top: 2px solid #3b82f6; }
  .sidebar-folder-item.drag-over { background: #eff6ff; }
  .sidebar-folder-item.dragging { opacity: 0.5; border: 1px dashed #6366f1; }
`;

// ---------------------------------------------------------
// [내부 컴포넌트] ChatHeader
// ---------------------------------------------------------
const ChatHeader = ({ isOnline, onClickLogo }) => (
  <header className="chat-header" style={{
    height: '60px',
    padding: '0 20px',
    borderBottom: '1px solid #e5e7eb',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center', // ✅ 중앙 정렬
    backgroundColor: '#fff',
    flexShrink: 0,
    position: 'relative'
  }}>
    <div className="logo-box" onClick={onClickLogo} style={{ cursor: 'pointer', fontWeight: '700', fontSize: '2rem', color: '#333' }}>
      챗봇
    </div>
    <div className="status-indicator" style={{ 
      position: 'absolute', 
      right: '20px',
      fontSize: '0.85rem', 
      color: isOnline ? '#10b981' : '#9ca3af', 
      display: 'flex', 
      alignItems: 'center', 
      gap: '6px' 
    }}>
      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: isOnline ? '#10b981' : '#9ca3af', display: 'inline-block' }}></span>
      <span className="status-text" style={{ display: 'none' }}>{isOnline ? '온라인' : '오프라인'}</span>
    </div>
  </header>
);

// ---------------------------------------------------------
// [내부 컴포넌트] ChatMessages
// ---------------------------------------------------------
const ChatMessages = ({ 
  messages, 
  isCurrentPending, 
  hoveredMessageIndex, 
  setHoveredMessageIndex, 
  loadingPhase, 
  messagesEndRef, 
  handleCopyMessage,
  openMessageMenuIndex,
  setOpenMessageMenuIndex 
}) => {
  return (
    <div className="chat-messages" style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', backgroundColor: '#f9fafb' }}>
      {messages.map((msg, idx) => {
        const isUser = msg.role === 'user';
        return (
          <div key={idx} 
               className={`message-row ${isUser ? 'user' : 'bot'}`} 
               style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}
               onMouseEnter={() => setHoveredMessageIndex(idx)}
               onMouseLeave={() => setHoveredMessageIndex(null)}
          >
            <div className="message-bubble" style={{
              maxWidth: '70%',
              padding: '12px 16px',
              borderRadius: '16px',
              borderTopRightRadius: isUser ? '4px' : '16px',
              borderTopLeftRadius: isUser ? '16px' : '4px',
              backgroundColor: isUser ? '#3b82f6' : '#ffffff',
              color: isUser ? '#ffffff' : '#1f2937',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              border: isUser ? 'none' : '1px solid #e5e7eb',
              lineHeight: '1.5',
              position: 'relative'
            }}>
              {msg.text}
              {hoveredMessageIndex === idx && (
                <button 
                  onClick={() => handleCopyMessage(msg.text)}
                  style={{
                    position: 'absolute',
                    top: '50%',
                    right: isUser ? '100%' : 'auto',
                    left: isUser ? 'auto' : '100%',
                    transform: 'translateY(-50%)',
                    margin: '0 8px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    opacity: 0.6,
                    fontSize: '1.2rem'
                  }}
                  title="복사"
                >
                  📋
                </button>
              )}
            </div>
          </div>
        );
      })}
      
      {isCurrentPending && (
        <div className="message-row bot" style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <div className="message-bubble loading" style={{
             padding: '12px 16px',
             borderRadius: '16px',
             borderTopLeftRadius: '4px',
             backgroundColor: '#ffffff',
             border: '1px solid #e5e7eb',
             color: '#6b7280',
             fontSize: '0.9rem'
          }}>
            {loadingPhase === 'understanding' ? '이해하는 중...' : 
             loadingPhase === 'searching' ? '정보를 찾는 중...' : '답변 생성 중...'}
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
};

// ---------------------------------------------------------
// [유틸] 헬퍼 함수
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

function createNewConversation() {
  const now = Date.now();
  return {
    id: String(now),
    title: "새 음성 대화",
    createdAt: now,
    updatedAt: now,
    messages: [{ role: "bot", text: "안녕하세요! 말씀해 주시면 듣고 대답해 드립니다." }],
    folderId: null,
  };
}

function getInitialChatState() {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.conversations)) {
          const convs = parsed.conversations || [];
          const folders = parsed.folders || [];
          let currentId = parsed.currentId;
          if (!currentId && convs.length > 0) currentId = convs[0].id;
          else if (!currentId && convs.length === 0) {
             const newConv = createNewConversation();
             return { conversations: [newConv], folders: [], currentId: newConv.id };
          }
          return { conversations: convs, folders, currentId };
        }
      }
    } catch (e) { console.error(e); }
  }
  const conv = createNewConversation();
  return { conversations: [conv], folders: [], currentId: conv.id };
}

function makeErrorInfo(rawError) {
  const text = typeof rawError === "string" ? rawError : JSON.stringify(rawError, null, 2);
  return { title: "오류 발생", guide: "요청 처리 중 문제가 발생했습니다.", hint: "잠시 후 다시 시도해주세요.", detail: text };
}

function summarizeTitleFromMessages(messages) {
  const firstUser = messages.find((m) => m.role === "user");
  const t = firstUser?.text?.trim();
  return t ? (t.length > 18 ? t.slice(0, 18) + "…" : t) : "새 음성 대화";
}

function getDraggedChatId(e) { return e.dataTransfer.getData("application/x-chat-id") || ""; }
function getDraggedFolderId(e) { return e.dataTransfer.getData("application/x-folder-id") || ""; }

// =========================================================
// [메인] VoiceChatPage
// =========================================================
function VoiceChatPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // ----------------------------- 1. State Management
  const [chatState, setChatState] = useState(getInitialChatState);
  const [loading, setLoading] = useState(false);
  const [errorInfo, setErrorInfo] = useState(null);
  const [focusArea, setFocusArea] = useState("chat");
  const [isOnline, setIsOnline] = useState(true);

  const [hoveredMessageIndex, setHoveredMessageIndex] = useState(null);
  const [openMessageMenuIndex, setOpenMessageMenuIndex] = useState(null);
  const [copyToastVisible, setCopyToastVisible] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState(null);
  
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_INIT_WIDTH);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState(() => new Set());
  
  const [chatSearch, setChatSearch] = useState("");
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [pendingConvId, setPendingConvId] = useState(null);

  const [menuOpenId, setMenuOpenId] = useState(null);
  const [menuPosition, setMenuPosition] = useState(null);
  const [menuInFolder, setMenuInFolder] = useState(false);
  const [folderMenuOpenId, setFolderMenuOpenId] = useState(null);
  const [folderMenuPosition, setFolderMenuPosition] = useState(null);

  const [confirmDelete, setConfirmDelete] = useState(null);
  const [renameInfo, setRenameInfo] = useState(null);
  const [confirmFolderDelete, setConfirmFolderDelete] = useState(null);
  const [folderCreateModalOpen, setFolderCreateModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderRenameInfo, setFolderRenameInfo] = useState(null);
  const [pendingFolderConvId, setPendingFolderConvId] = useState(null);
  const [detailsModalChat, setDetailsModalChat] = useState(null);

  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverFolderId, setDragOverFolderId] = useState(null);
  const [folderDraggingId, setFolderDraggingId] = useState(null);
  const [folderDragOverId, setFolderDragOverId] = useState(null);

  const [input, setInput] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const rootListRef = useRef(null);
  const folderChatsRefs = useRef({});
  const messagesEndRef = useRef(null);
  const phaseTimersRef = useRef([]);
  const sidebarResizeRef = useRef(null);
  const recognitionRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis);
  const startedFromHomeRef = useRef(false); 

  const conversations = chatState.conversations || [];
  const folders = chatState.folders || [];
  const currentId = chatState.currentId;
  const currentConv = conversations.find((c) => c.id === currentId) || conversations[0];
  const messages = currentConv ? currentConv.messages : [];
  const isCurrentPending = loading && currentConv && pendingConvId && currentConv.id === pendingConvId;
  const rootConversations = conversations.filter((c) => !c.folderId);
  
  const modalSearchResults = chatSearch.trim()
    ? conversations.filter((conv) => conv.title.toLowerCase().includes(chatSearch.toLowerCase()))
    : [];

  const activeMenuConversation = menuOpenId ? conversations.find(c => c.id === menuOpenId) : null;
  const activeMenuFolder = folderMenuOpenId ? folders.find(f => f.id === folderMenuOpenId) : null;

  const isFolderCollapsed = (id) => collapsedFolderIds.has(id);
  const toggleFolder = (id) => setCollapsedFolderIds(prev => {
      const s = new Set(prev); if(s.has(id)) s.delete(id); else s.add(id); return s;
  });

  // ----------------------------- 2. Effects
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversations, folders, currentId }));
    } catch (e) { console.error(e); }
  }, [conversations, folders, currentId]);

  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pendingConvId, input]);

  useEffect(() => {
    if (location.state?.newChat && !startedFromHomeRef.current) {
        startedFromHomeRef.current = true;
        handleNewChat();
        navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, navigate]);

  useEffect(() => {
    const handleGlobalClick = () => {
        setMenuOpenId(null); setFolderMenuOpenId(null); setOpenMessageMenuIndex(null);
    };
    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            setIsSearchModalOpen(false); setConfirmDelete(null); setConfirmFolderDelete(null);
            setFolderCreateModalOpen(false); setRenameInfo(null); setFolderRenameInfo(null);
            setDetailsModalChat(null); setMenuOpenId(null);
            return;
        }
        if (e.key === 'Enter') {
            if (folderCreateModalOpen) { e.preventDefault(); handleCreateFolderConfirm(); }
            if (renameInfo) { e.preventDefault(); handleRenameConversationConfirm(); }
            if (folderRenameInfo) { e.preventDefault(); handleRenameFolderConfirm(); }
            if (confirmDelete) { e.preventDefault(); handleDeleteConversation(confirmDelete.id); }
            if (confirmFolderDelete) { e.preventDefault(); handleDeleteFolder(confirmFolderDelete.id); }
            return;
        }
        if (e.key === 'Delete') {
            if (['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) return;
            if (focusArea === 'folder' && selectedFolderId) {
                const f = folders.find(x => x.id === selectedFolderId);
                if(f) setConfirmFolderDelete({id:f.id, name:f.name});
            } else if (currentId) {
                const c = conversations.find(x => x.id === currentId);
                if(c) setConfirmDelete({id:c.id, title:c.title});
            }
        }
    };
    window.addEventListener("click", handleGlobalClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
        window.removeEventListener("click", handleGlobalClick);
        window.removeEventListener("keydown", handleKeyDown);
        if (synthRef.current) synthRef.current.cancel();
        if (recognitionRef.current) recognitionRef.current.stop();
        phaseTimersRef.current.forEach(clearTimeout);
    };
  }, [focusArea, selectedFolderId, currentId, folders, conversations, folderCreateModalOpen, renameInfo, folderRenameInfo, confirmDelete, confirmFolderDelete]);

  // ----------------------------- 3. Voice Logic
  const speak = useCallback((text) => {
    if (!synthRef.current) return;
    synthRef.current.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ko-KR";
    utterance.onstart = () => { setIsSpeaking(true); setIsListening(false); };
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    synthRef.current.speak(utterance);
  }, []);

  const setupRecognition = useCallback(() => {
    if (recognitionRef.current) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("이 브라우저는 음성 인식을 지원하지 않습니다.");
    const recognition = new SpeechRecognition();
    recognition.lang = "ko-KR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (e) => {
        let transcript = "";
        for (let i = e.resultIndex; i < e.results.length; ++i) transcript += e.results[i][0].transcript;
        if (transcript) setInput(transcript);
    };
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
  }, []);

  const handleMicClick = () => {
      if (isSpeaking) { synthRef.current.cancel(); setIsSpeaking(false); return; }
      if (!recognitionRef.current) setupRecognition();
      if (isListening) {
          recognitionRef.current.stop();
          setIsListening(false);
          setTimeout(() => { if (input.trim()) sendMessage(); else setInput(""); }, 500);
      } else {
          setInput("");
          try { recognitionRef.current.start(); } catch { recognitionRef.current.stop(); setTimeout(()=>recognitionRef.current.start(), 200); }
      }
  };

  const sendMessage = async () => {
      const trimmed = input.trim();
      if (!trimmed || loading || !currentConv) return;
      const targetConvId = currentConv.id;
      setInput(""); setLoading(true); setPendingConvId(targetConvId); setLoadingPhase("understanding");
      setChatState(prev => ({
          ...prev,
          conversations: prev.conversations.map(c => {
              if (c.id !== targetConvId) return c;
              const newMsgs = [...c.messages, { role: "user", text: trimmed }];
              const newTitle = c.messages.length > 0 ? c.title : summarizeTitleFromMessages(newMsgs);
              return { ...c, messages: newMsgs, updatedAt: Date.now(), title: newTitle };
          })
      }));
      try {
          const res = await fetch(`${API_BASE}/chat`, {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: trimmed })
          });
          const data = await res.json();
          if (data.error) throw new Error(JSON.stringify(data.error));
          const answer = data.answer || "(응답 없음)";
          setChatState(prev => ({
              ...prev,
              conversations: prev.conversations.map(c => c.id === targetConvId ? { ...c, messages: [...c.messages, { role: "bot", text: answer }], updatedAt: Date.now() } : c)
          }));
          speak(answer);
      } catch (err) {
          setErrorInfo(makeErrorInfo(err?.message || err));
          speak("오류가 발생했습니다.");
      } finally {
          setLoading(false); setPendingConvId(null); setLoadingPhase(null);
      }
  };

  // ----------------------------- 4. 핸들러
  const handleNewChat = useCallback(() => {
    if (synthRef.current) synthRef.current.cancel();
    if (recognitionRef.current) recognitionRef.current.stop();
    setIsSpeaking(false); setIsListening(false); setInput("");

    const newConv = createNewConversation();
    setChatState((prev) => ({ ...prev, conversations: [...prev.conversations, newConv], currentId: newConv.id }));
    setSelectedFolderId(null); setFocusArea("chat");
    setTimeout(() => speak("안녕하세요! 무엇을 도와드릴까요?"), 500);
  }, [speak]);

  const handleCreateFolder = () => { setNewFolderName(""); setFolderCreateModalOpen(true); };
  const handleCreateFolderConfirm = () => {
    if (!newFolderName.trim()) return;
    const id = String(Date.now());
    setChatState(prev => ({
        ...prev, 
        folders: [...prev.folders, {id, name: newFolderName.trim(), createdAt: Date.now()}],
        conversations: pendingFolderConvId ? prev.conversations.map(c => c.id === pendingFolderConvId ? {...c, folderId: id} : c) : prev.conversations
    }));
    setFolderCreateModalOpen(false); setNewFolderName(""); setPendingFolderConvId(null);
  };

  const handleSelectConversation = (id) => {
    setChatState(prev => ({ ...prev, currentId: id }));
    setFocusArea("chat"); setSelectedFolderId(null);
    if (synthRef.current) synthRef.current.cancel();
    if (recognitionRef.current) recognitionRef.current.stop();
    setIsSpeaking(false); setIsListening(false);
  };

  const handleRenameConversationConfirm = () => {
      if(!renameInfo || !renameInfo.value.trim()) return;
      setChatState(prev => ({...prev, conversations: prev.conversations.map(c => c.id === renameInfo.id ? {...c, title: renameInfo.value} : c)}));
      setRenameInfo(null);
  };

  const handleRenameFolder = (id) => { 
      const f = folders.find(x => x.id === id); 
      setFolderRenameInfo({ id, value: f.name }); setFolderMenuOpenId(null); 
  };
  const handleRenameFolderConfirm = () => {
      if(!folderRenameInfo || !folderRenameInfo.value.trim()) return;
      setChatState(prev => ({...prev, folders: prev.folders.map(f => f.id === folderRenameInfo.id ? {...f, name: folderRenameInfo.value} : f)}));
      setFolderRenameInfo(null);
  };

  const handleMoveConversationToRoot = (id) => {
      setChatState(prev => ({...prev, conversations: prev.conversations.map(c => c.id === id ? {...c, folderId: null} : c)}));
      setMenuOpenId(null);
  };

  const handleDeleteConversation = (id) => {
      setChatState(prev => {
          const list = prev.conversations;
          const deleteIndex = list.findIndex(c => c.id === id);
          if (deleteIndex === -1) return prev;
          const filtered = list.filter(c => c.id !== id);
          let newCurrentId = prev.currentId;
          if (prev.currentId === id) {
              if (filtered.length === 0) {
                  const newConv = createNewConversation();
                  filtered.push(newConv);
                  newCurrentId = newConv.id;
              } else {
                  const newIndex = deleteIndex > 0 ? deleteIndex - 1 : 0;
                  newCurrentId = filtered[newIndex].id;
              }
          }
          return { ...prev, conversations: filtered, currentId: newCurrentId };
      });
      setConfirmDelete(null); setMenuOpenId(null);
  };

  const handleDeleteFolder = (id) => {
      setChatState(prev => ({
          ...prev,
          folders: prev.folders.filter(f => f.id !== id),
          conversations: prev.conversations.map(c => c.folderId === id ? {...c, folderId: null} : c)
      }));
      setConfirmFolderDelete(null); setFolderMenuOpenId(null);
  };

  const handleCopyMessage = (text) => {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(text).then(() => setCopyToastVisible(true));
  };

  const handleFolderItemDragStart = (e, id) => { setFolderDraggingId(id); e.dataTransfer.setData("application/x-folder-id", id); };
  const handleDragStart = (e, id) => { setDraggingId(id); e.dataTransfer.setData("application/x-chat-id", id); };
  
  const handleFolderDrop = (e, targetFolderId) => {
      e.preventDefault(); e.stopPropagation();
      const draggedFolderId = folderDraggingId || getDraggedFolderId(e);
      if (draggedFolderId) {
          if (draggedFolderId === targetFolderId) return;
          setChatState(prev => {
              const newFolders = [...prev.folders];
              const fromIndex = newFolders.findIndex(f => f.id === draggedFolderId);
              const toIndex = newFolders.findIndex(f => f.id === targetFolderId);
              if (fromIndex === -1 || toIndex === -1) return prev;
              const [movedFolder] = newFolders.splice(fromIndex, 1);
              newFolders.splice(toIndex, 0, movedFolder);
              return { ...prev, folders: newFolders };
          });
          setFolderDraggingId(null); setDragOverFolderId(null);
          return;
      }
      const cid = draggingId || getDraggedChatId(e);
      if (cid) {
          setChatState(prev => ({
              ...prev, 
              conversations: prev.conversations.map(c => c.id === cid ? {...c, folderId: targetFolderId} : c)
          }));
          setDraggingId(null); setDragOverFolderId(null);
      }
  };

  const handleRootListDrop = (e) => {
      e.preventDefault(); e.stopPropagation();
      const cid = draggingId || getDraggedChatId(e);
      if (!cid) return;
      const dropTarget = e.target.closest('.sidebar-chat-item');
      setChatState(prev => {
          const list = [...prev.conversations];
          const fromIndex = list.findIndex(c => c.id === cid);
          if (fromIndex === -1) return prev;
          const [movedItem] = list.splice(fromIndex, 1);
          movedItem.folderId = null;
          let toIndex;
          if (dropTarget) {
              const targetId = dropTarget.dataset.chatId;
              toIndex = list.findIndex(c => c.id === targetId);
              const rect = dropTarget.getBoundingClientRect();
              if (e.clientY > rect.top + rect.height / 2) toIndex += 1;
              if (toIndex === -1) toIndex = list.length;
          } else {
              toIndex = list.length;
          }
          list.splice(toIndex, 0, movedItem);
          return { ...prev, conversations: list };
      });
      setDraggingId(null); setDragOverId(null);
  };

  const handleDropOnFolderChat = (e, targetId, fid) => {
      e.preventDefault(); e.stopPropagation();
      const cid = draggingId || getDraggedChatId(e);
      if(!cid || cid === targetId) return;
      setChatState(prev => {
          const list = [...prev.conversations];
          const fromIdx = list.findIndex(c => c.id === cid);
          if(fromIdx < 0) return prev;
          const [moved] = list.splice(fromIdx, 1);
          moved.folderId = fid;
          const toIdx = list.findIndex(c => c.id === targetId);
          list.splice(toIdx, 0, moved);
          return { ...prev, conversations: list };
      });
      setDraggingId(null); setDragOverId(null);
  };

  const handleDropChatOnFolderHeader = (e, fid) => {
     e.preventDefault(); e.stopPropagation();
     const cid = draggingId || getDraggedChatId(e);
     if(cid) {
         setChatState(prev => ({...prev, conversations: prev.conversations.map(c => c.id === cid ? {...c, folderId: fid} : c)}));
     }
     setDraggingId(null); setDragOverFolderId(null);
  };

  const handleSidebarResizeMouseDown = (e) => { e.preventDefault(); sidebarResizeRef.current = { startX: e.clientX, startWidth: sidebarWidth }; setIsResizingSidebar(true); };
  useEffect(() => {
      if(!isResizingSidebar) return;
      const onMove = (e) => setSidebarWidth(Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, sidebarResizeRef.current.startWidth + (e.clientX - sidebarResizeRef.current.startX))));
      const onUp = () => setIsResizingSidebar(false);
      window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
      return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [isResizingSidebar]);

  // ----------------------------- 5. 렌더링
  return (
    <div className="page chat-page voice-mode">
       {/* 스타일 주입 */}
       <style>{PAGE_STYLES}</style>

       <button className="sidebar-toggle-btn" onClick={() => setSidebarOpen(!sidebarOpen)} />

       <div className="chat-layout">
         {/* ========== 사이드바 ========== */}
         <aside className={`chat-sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${sidebarOpen ? 'open' : ''}`} style={!sidebarCollapsed ? { flex: `0 0 ${sidebarWidth}px` } : undefined}>
            <div className="sidebar-top">
                <button className="sidebar-menu-toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
                    <img src="/img/menu.png" alt="메뉴" style={{width:24, opacity:0.6}} />
                </button>
                {!sidebarCollapsed && <button className="sidebar-new-chat-btn" onClick={handleNewChat}>새 채팅</button>}
            </div>

            {!sidebarCollapsed && (
              <>
                <button className="sidebar-search-trigger" onClick={() => { setChatSearch(""); setIsSearchModalOpen(true); }}>
                    <span>🔍 채팅 검색</span>
                </button>

                {/* 폴더 리스트 */}
                <div className="sidebar-section-title">폴더</div>
                <div className="sidebar-folder-list"
                     onDragOver={(e) => e.preventDefault()}
                     onDrop={(e) => {
                         e.preventDefault();
                         const cid = draggingId || getDraggedChatId(e);
                         if(cid) { setPendingFolderConvId(cid); setFolderCreateModalOpen(true); }
                     }}>
                    {folders.map(folder => {
                        const childConvs = conversations.filter(c => c.folderId === folder.id);
                        const collapsed = isFolderCollapsed(folder.id);
                        return (
                            <div key={folder.id} 
                                 className={`sidebar-folder-item ${selectedFolderId === folder.id ? 'selected' : ''} ${dragOverFolderId === folder.id ? 'drag-over' : ''} ${folderDraggingId === folder.id ? 'dragging' : ''}`}
                                 draggable onDragStart={(e) => handleFolderItemDragStart(e, folder.id)}
                                 onDragOver={(e) => { e.preventDefault(); setDragOverFolderId(folder.id); }}
                                 onDrop={(e) => handleFolderDrop(e, folder.id)}
                                 onClick={() => { setSelectedFolderId(folder.id); setFocusArea("folder"); }}
                            >
                                <div className="sidebar-folder-header" onDrop={(e) => handleDropChatOnFolderHeader(e, folder.id)}>
                                    <button className="sidebar-folder-toggle" onClick={(e) => { e.stopPropagation(); toggleFolder(folder.id); }}>{collapsed ? "+" : "−"}</button>
                                    <span className="sidebar-folder-name">{folder.name}</span>
                                    {childConvs.length > 0 && <span className="sidebar-folder-count">{childConvs.length}</span>}
                                    <button className="sidebar-chat-more" onClick={(e) => { 
                                        e.stopPropagation(); 
                                        const rect = e.currentTarget.getBoundingClientRect(); 
                                        
                                        // ✅ 메뉴 위치 계산 (화면 하단이면 위로)
                                        const isBottom = rect.top > window.innerHeight * 0.7;
                                        setFolderMenuPosition({
                                            x: rect.right, 
                                            y: isBottom ? rect.top : rect.bottom,
                                            placement: isBottom ? 'top' : 'bottom'
                                        });
                                        setFolderMenuOpenId(folder.id); 
                                    }}>⋯</button>
                                </div>
                                {!collapsed && (
                                    <div className="sidebar-folder-chats" ref={el => folderChatsRefs.current[folder.id] = el}>
                                        {childConvs.map(c => (
                                            <div key={c.id} className={`sidebar-folder-chat ${c.id === currentId ? 'active' : ''}`}
                                                 draggable onDragStart={(e) => handleDragStart(e, c.id)}
                                                 onDragOver={(e) => { e.preventDefault(); setDragOverId(c.id); }}
                                                 onDrop={(e) => handleDropOnFolderChat(e, c.id, folder.id)}
                                                 onClick={(e) => { e.stopPropagation(); handleSelectConversation(c.id); }}
                                            >
                                                <span className="sidebar-folder-chat-title">{c.title}</span>
                                                <button className="sidebar-chat-more" onClick={(e) => { 
                                                    e.stopPropagation(); 
                                                    const rect = e.currentTarget.getBoundingClientRect(); 
                                                    const isBottom = rect.top > window.innerHeight * 0.7;
                                                    setMenuPosition({
                                                        x: rect.right, 
                                                        y: isBottom ? rect.top : rect.bottom,
                                                        placement: isBottom ? 'top' : 'bottom'
                                                    });
                                                    setMenuInFolder(true); 
                                                    setMenuOpenId(c.id); 
                                                }}>⋯</button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                    <button className="sidebar-new-folder-btn" onClick={() => { setNewFolderName(""); setFolderCreateModalOpen(true); }}>+ 새 폴더</button>
                </div>

                {/* 루트 채팅 리스트 */}
                <div className="sidebar-chat-section">
                    <div className="sidebar-section-title">채팅</div>
                    <div className="sidebar-chat-list" ref={rootListRef} 
                         onDragOver={(e) => e.preventDefault()}
                         onDrop={handleRootListDrop}>
                        {rootConversations.map((c, idx) => (
                            <div key={c.id} 
                                 className={`sidebar-chat-item ${c.id === currentId ? 'active' : ''} ${dragOverId === c.id ? 'drag-over' : ''}`}
                                 data-chat-id={c.id}
                                 draggable onDragStart={(e) => handleDragStart(e, c.id)}
                                 onDragOver={(e) => { e.preventDefault(); setDragOverId(c.id); }}
                                 onDrop={handleRootListDrop}
                                 onClick={() => handleSelectConversation(c.id)}
                            >
                                <button className="sidebar-chat-main">
                                    <span className="sidebar-chat-index">{idx + 1}</span>
                                    <span className="sidebar-chat-title">{c.title}</span>
                                </button>
                                <button className="sidebar-chat-more" onClick={(e) => { 
                                    e.stopPropagation(); 
                                    const rect = e.currentTarget.getBoundingClientRect(); 
                                    const isBottom = rect.top > window.innerHeight * 0.7;
                                    setMenuPosition({
                                        x: rect.right, 
                                        y: isBottom ? rect.top : rect.bottom,
                                        placement: isBottom ? 'top' : 'bottom'
                                    });
                                    setMenuInFolder(false); 
                                    setMenuOpenId(c.id); 
                                }}>⋯</button>
                            </div>
                        ))}
                    </div>
                </div>
              </>
            )}
            {!sidebarCollapsed && <div className="sidebar-resize-handle" onMouseDown={handleSidebarResizeMouseDown} />}
         </aside>

         <div className="chat-shell" onMouseDown={() => { setMenuOpenId(null); setFolderMenuOpenId(null); setFocusArea("chat"); }}>
             <ChatHeader isOnline={isOnline} onClickLogo={() => navigate("/")} />
             <main className="chat-main">
                 <div className="chat-container">
                     <ChatMessages 
                         messages={messages} 
                         isCurrentPending={isCurrentPending}
                         hoveredMessageIndex={hoveredMessageIndex}
                         setHoveredMessageIndex={setHoveredMessageIndex}
                         loadingPhase={loadingPhase}
                         messagesEndRef={messagesEndRef}
                         handleCopyMessage={handleCopyMessage}
                         openMessageMenuIndex={openMessageMenuIndex}
                         setOpenMessageMenuIndex={setOpenMessageMenuIndex}
                     />
                     
                     <div className="voice-controls">
                         <div className="voice-transcript">{isListening ? (input || "듣고 있습니다...") : ""}</div>
                         <button className={`mic-button ${loading ? 'loading' : isSpeaking ? 'speaking' : isListening ? 'listening' : 'idle'}`}
                                 onClick={handleMicClick} disabled={loading}
                         >
                            {loading ? "⏳" : isSpeaking ? "🔊" : isListening ? "📡" : "🎤"}
                         </button>
                         <div className="voice-status">
                             {loading ? "답변 생성 중..." : isSpeaking ? "답변을 읽는 중입니다." : isListening ? "말씀이 끝나면 버튼을 다시 눌러주세요." : "마이크 버튼을 눌러 대화를 시작하세요."}
                         </div>
                     </div>
                 </div>
             </main>
         </div>
       </div>

       {/* ========== 각종 모달 및 팝업 ========== */}
       {isSearchModalOpen && (
           <div className="search-modal-overlay" onClick={() => setIsSearchModalOpen(false)}>
               <div className="search-modal-content" onClick={e=>e.stopPropagation()}>
                   <div className="search-modal-header">
                       <input className="search-modal-input" autoFocus placeholder="검색어 입력..." value={chatSearch} onChange={e=>setChatSearch(e.target.value)} />
                       <button onClick={()=>setIsSearchModalOpen(false)}>✕</button>
                   </div>
                   <div className="search-modal-results">
                       {modalSearchResults.map(c => (
                           <div key={c.id} className="search-result-item" onClick={() => { handleSelectConversation(c.id); setIsSearchModalOpen(false); }}>
                               <div>💬 {c.title}</div>
                               <div className="search-result-date">{formatDateTime(c.updatedAt)}</div>
                           </div>
                       ))}
                       {modalSearchResults.length === 0 && <div style={{padding:20, textAlign:'center', color:'#999'}}>결과 없음</div>}
                   </div>
               </div>
           </div>
       )}

       {/* 컨텍스트 메뉴 */}
       {activeMenuConversation && menuPosition && (
           <div className="sidebar-chat-menu" 
                style={{
                    top: menuPosition.y, 
                    left: menuPosition.x,
                    transform: menuPosition.placement === 'top' ? 'translateY(-100%)' : 'none'
                }} 
                onClick={e=>e.stopPropagation()}
           >
               <button onClick={() => { setDetailsModalChat(activeMenuConversation); setMenuOpenId(null); }}>상세 정보</button>
               <button onClick={() => { setRenameInfo({id: activeMenuConversation.id, value: activeMenuConversation.title}); setMenuOpenId(null); }}>이름 변경</button>
               {menuInFolder && <button onClick={() => { handleMoveConversationToRoot(activeMenuConversation.id); }}>목록으로 이동</button>}
               <button onClick={() => { setConfirmDelete({id: activeMenuConversation.id, title: activeMenuConversation.title}); setMenuOpenId(null); }}>삭제</button>
           </div>
       )}

       {activeMenuFolder && folderMenuPosition && (
           <div className="sidebar-chat-menu" 
                style={{
                    top: folderMenuPosition.y, 
                    left: folderMenuPosition.x,
                    transform: folderMenuPosition.placement === 'top' ? 'translateY(-100%)' : 'none'
                }} 
                onClick={e=>e.stopPropagation()}
           >
               <button onClick={() => handleRenameFolder(activeMenuFolder.id)}>이름 변경</button>
               <button onClick={() => { setConfirmFolderDelete({id:activeMenuFolder.id, name:activeMenuFolder.name}); setFolderMenuOpenId(null); }}>삭제</button>
           </div>
       )}

       {/* 모달: 이름 변경 / 생성 / 삭제 */}
       {folderCreateModalOpen && (
           <div className="error-modal-overlay">
               <div className="error-modal">
                   <div className="error-modal-header"><span className="error-modal-title">새 폴더</span></div>
                   <div className="error-modal-body"><input className="modal-input" autoFocus value={newFolderName} onChange={e=>setNewFolderName(e.target.value)} placeholder="폴더 이름" onKeyDown={e=>{if(e.key==='Enter') handleCreateFolderConfirm()}} /></div>
                   <div className="error-modal-footer"><button className="error-modal-secondary" onClick={()=>setFolderCreateModalOpen(false)}>취소</button><button className="error-modal-primary" onClick={handleCreateFolderConfirm}>생성</button></div>
               </div>
           </div>
       )}

       {renameInfo && (
           <div className="error-modal-overlay">
               <div className="error-modal">
                   <div className="error-modal-header"><span className="error-modal-title">이름 변경</span></div>
                   <div className="error-modal-body"><input className="modal-input" autoFocus value={renameInfo.value} onChange={e=>setRenameInfo({...renameInfo, value:e.target.value})} onKeyDown={e=>{if(e.key==='Enter') handleRenameConversationConfirm()}} /></div>
                   <div className="error-modal-footer"><button className="error-modal-secondary" onClick={()=>setRenameInfo(null)}>취소</button><button className="error-modal-primary" onClick={handleRenameConversationConfirm}>변경</button></div>
               </div>
           </div>
       )}

       {folderRenameInfo && (
           <div className="error-modal-overlay">
               <div className="error-modal">
                   <div className="error-modal-header"><span className="error-modal-title">폴더 이름 변경</span></div>
                   <div className="error-modal-body"><input className="modal-input" autoFocus value={folderRenameInfo.value} onChange={e=>setFolderRenameInfo({...folderRenameInfo, value:e.target.value})} onKeyDown={e=>{if(e.key==='Enter') handleRenameFolderConfirm()}} /></div>
                   <div className="error-modal-footer"><button className="error-modal-secondary" onClick={()=>setFolderRenameInfo(null)}>취소</button><button className="error-modal-primary" onClick={handleRenameFolderConfirm}>변경</button></div>
               </div>
           </div>
       )}

       {confirmDelete && (
           <div className="error-modal-overlay">
               <div className="error-modal">
                   <div className="error-modal-header"><span className="error-modal-title">삭제 확인</span></div>
                   <div className="error-modal-body"><p>"{confirmDelete.title}" 대화를 삭제하시겠습니까?</p></div>
                   <div className="error-modal-footer"><button className="error-modal-secondary" onClick={()=>setConfirmDelete(null)}>취소</button><button className="error-modal-primary" onClick={()=>handleDeleteConversation(confirmDelete.id)}>삭제</button></div>
               </div>
           </div>
       )}

       {confirmFolderDelete && (
           <div className="error-modal-overlay">
               <div className="error-modal">
                   <div className="error-modal-header"><span className="error-modal-title">삭제 확인</span></div>
                   <div className="error-modal-body"><p>"{confirmFolderDelete.name}" 폴더를 삭제하시겠습니까?</p></div>
                   <div className="error-modal-footer"><button className="error-modal-secondary" onClick={()=>setConfirmFolderDelete(null)}>취소</button><button className="error-modal-primary" onClick={()=>handleDeleteFolder(confirmFolderDelete.id)}>삭제</button></div>
               </div>
           </div>
       )}

       {detailsModalChat && (
           <div className="error-modal-overlay" onClick={()=>setDetailsModalChat(null)}>
               <div className="error-modal">
                   <div className="error-modal-header"><span className="error-modal-title">상세 정보</span></div>
                   <div className="error-modal-body">
                       <p><strong>제목:</strong> {detailsModalChat.title}</p>
                       <p><strong>생성일:</strong> {formatDateTime(detailsModalChat.createdAt)}</p>
                       <p><strong>메시지:</strong> {detailsModalChat.messages.length}개</p>
                   </div>
                   <div className="error-modal-footer"><button className="error-modal-secondary" onClick={()=>setDetailsModalChat(null)}>닫기</button></div>
               </div>
           </div>
       )}
       
       {copyToastVisible && <div className="copy-modal-overlay" onClick={()=>setCopyToastVisible(false)}><div style={{background:'white', padding:'12px 24px', borderRadius:8}}>복사되었습니다.</div></div>}
       {errorInfo && <div className="error-modal-overlay" onClick={()=>setErrorInfo(null)}><div className="error-modal"><p>{errorInfo.guide}</p><button className="error-modal-secondary" onClick={()=>setErrorInfo(null)}>닫기</button></div></div>}
    </div>
  );
}

export default VoiceChatPage;